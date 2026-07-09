// ── ANALYTICS ──
// Extraído de admin.html (fatia de modularização). Depende de globals do
// script principal (sb, galleries, signUrls).
let analyticsData   = [];
let analyticsSortBy = 'views';

async function initAnalyticsScreen() {
  // Totais globais agregados no banco (1 chamada) — escala com milhões de eventos
  const { data: tot } = await sb.rpc('global_event_totals');
  const t = Array.isArray(tot) ? tot[0] : tot;
  document.getElementById('astat-views').textContent = t?.views ?? '—';
  document.getElementById('astat-likes').textContent = t?.likes ?? '—';
  document.getElementById('astat-saves').textContent = t?.saves ?? '—';
  // Popula selector de galerias
  const sel = document.getElementById('analytics-gallery-select');
  sel.innerHTML = '<option value="">Selecione uma galeria</option>';
  galleries.forEach(g => {
    sel.innerHTML += `<option value="${g.id}">${esc(g.name)}</option>`;
  });
}

async function loadGalleryAnalytics(galleryId) {
  const empty = document.getElementById('analytics-empty');
  const wrap  = document.getElementById('analytics-table-wrap');
  if (!galleryId) { wrap.style.display = 'none'; empty.style.display = 'block'; return; }

  empty.textContent = 'Carregando...';
  empty.style.display = 'block';
  wrap.style.display  = 'none';

  const { data: photos } = await sb.from('photos')
    .select('id, thumb_url, filename, position')
    .eq('gallery_id', galleryId).order('position');
  if (photos) { const s = await signUrls(photos.map(p => p.thumb_url || '')); photos.forEach((p,i)=>{ if(p.thumb_url) p.thumb_url = s[i] || p.thumb_url; }); }

  if (!photos?.length) { empty.textContent = 'Nenhuma foto nesta galeria.'; return; }

  // Estatísticas agregadas no banco (GROUP BY) — não traz os eventos crus
  const { data: statsRows } = await sb.rpc('gallery_photo_stats', { p_gallery_id: galleryId });
  const byId = {};
  (statsRows || []).forEach(r => { byId[r.photo_id] = r; });

  analyticsData = photos.map(p => ({
    photo: p,
    views: byId[p.id]?.views || 0,
    likes: byId[p.id]?.likes || 0,
    saves: byId[p.id]?.saves || 0,
  }));
  analyticsSortBy = 'views';
  renderAnalyticsTable();
  empty.style.display = 'none';
  wrap.style.display  = 'block';
}

function sortAnalytics(by) {
  analyticsSortBy = by;
  ['views','likes','saves'].forEach(k =>
    document.getElementById('sort-' + k).classList.toggle('active', k === by)
  );
  renderAnalyticsTable();
}

function renderAnalyticsTable() {
  const sorted = [...analyticsData].sort((a,b) => b[analyticsSortBy] - a[analyticsSortBy]);
  const body = document.getElementById('analytics-table-body');
  body.innerHTML = '';
  sorted.forEach(row => {
    const d = document.createElement('div');
    d.className = 'atbl-row';
    d.innerHTML = `
      <img class="atbl-thumb" src="${row.photo.thumb_url || ''}" loading="lazy" alt="">
      <div class="atbl-name">${esc(row.photo.filename) || '—'}</div>
      <div class="atbl-num ${analyticsSortBy==='views'?'accent':''}">${row.views}</div>
      <div class="atbl-num ${analyticsSortBy==='likes'?'accent':''}">${row.likes}</div>
      <div class="atbl-num ${analyticsSortBy==='saves'?'accent':''}">${row.saves}</div>
    `;
    body.appendChild(d);
  });
}
