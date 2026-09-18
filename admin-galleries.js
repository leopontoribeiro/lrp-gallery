// ── SELEÇÕES DO CLIENTE + VENDAS + DASHBOARD + NEW GALLERY ──
// Extraído de admin.html (fatia de modularização). Depende de globals do
// script principal (sb, toast, signUrls, galleries, pendingFiles,
// openDetail) — só usados dentro das funções.
function updateSelectionsBadge(n) {
  const b = document.getElementById('nav-badge-selections');
  if (!b) return;
  if (n > 0) { b.textContent = n; b.style.display = ''; } else { b.style.display = 'none'; }
}

async function refreshSelectionsBadge() {
  const { count, error } = await sb.from('selections')
    .select('id', { count: 'exact', head: true }).eq('seen', false);
  if (!error) updateSelectionsBadge(count || 0);
}

let _selPhotoMap = {};   // cache: photo_id -> {name, thumb}
let _selById = {};       // cache: selection_id -> selection

async function initSelectionsScreen() {
  const wrap  = document.getElementById('selections-list');
  const empty = document.getElementById('selections-empty');
  wrap.innerHTML = '<div style="color:var(--muted);font-size:0.7rem;padding:20px">Carregando...</div>';
  const { data, error } = await sb.from('selections')
    .select('*, galleries(name, access_token)')
    .order('created_at', { ascending: false });
  if (error) { wrap.innerHTML = ''; empty.style.display = 'block'; empty.textContent = 'Erro: ' + error.message; return; }
  updateSelectionsBadge(data.filter(s => !s.seen).length);
  if (!data.length) { wrap.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';

  // Resolve thumbnails de todas as fotos selecionadas (assinadas), de uma vez.
  const allIds = [...new Set(data.flatMap(s => s.photo_ids || []))];
  _selPhotoMap = {};
  if (allIds.length) {
    const { data: phs } = await sb.from('photos').select('id, filename, thumb_url').in('id', allIds);
    const signed = await signUrls((phs || []).map(p => p.thumb_url));
    (phs || []).forEach((p, i) => { _selPhotoMap[p.id] = { name: p.filename, thumb: signed[i] }; });
  }
  _selById = {}; data.forEach(s => { _selById[s.id] = s; });
  wrap.innerHTML = data.map(s => renderSelectionCard(s, _selPhotoMap)).join('');
}

function renderSelectionCard(s, photoMap) {
  const ids = s.photo_ids || [];
  const date = new Date(s.created_at).toLocaleString('pt-BR');
  const gname = s.galleries?.name || '—';
  const thumbs = ids.slice(0, 14).map(id => {
    const p = photoMap[id];
    return p ? `<img src="${p.thumb}" title="${(p.name||'').replace(/"/g,'')}" loading="lazy"
        style="width:56px;height:56px;object-fit:cover;border-radius:6px;border:1px solid var(--border)">` : '';
  }).join('');
  const more = ids.length > 14 ? `<span style="font-size:0.7rem;color:var(--muted);align-self:center">+${ids.length - 14}</span>` : '';
  const contact = s.client_contact ? ` · <span style="color:var(--muted)">${esc(s.client_contact)}</span>` : '';
  const msg = s.message ? `<div style="font-size:0.8rem;color:var(--text);margin:6px 0 0;font-style:italic">"${esc(s.message)}"</div>` : '';
  return `
    <div style="background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:16px 18px;margin-bottom:12px;${s.seen ? 'opacity:.62' : ''}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap">
        <div>
          <div style="font-size:0.95rem;font-weight:700;color:var(--text)">
            ${esc(s.client_name || 'Cliente')} ${s.seen ? '' : '<span style="font-size:0.6rem;background:var(--accent);color:#fff;padding:2px 7px;border-radius:20px;vertical-align:middle;margin-left:6px">NOVO</span>'}
          </div>
          <div style="font-size:0.72rem;color:var(--muted);margin-top:2px">${esc(gname)} · ${ids.length} foto(s) · ${date}${contact}</div>
          ${msg}
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-ghost" style="font-size:0.68rem" onclick="copySelectionNames(${s.id})">Copiar arquivos</button>
          ${s.seen ? '' : `<button class="btn btn-primary" style="font-size:0.68rem" onclick="markSelectionSeen(${s.id})">Marcar visto</button>`}
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px">${thumbs}${more}</div>
    </div>`;
}

function copySelectionNames(selId) {
  const s = _selById[selId]; if (!s) return;
  const names = (s.photo_ids || []).map(id => (_selPhotoMap[id]?.name) || id);
  navigator.clipboard.writeText(names.join('\n')).then(
    () => toast(`${names.length} nome(s) de arquivo copiados`, 'success'),
    () => toast('Não foi possível copiar', 'error'));
}
async function markSelectionSeen(id) {
  const { error } = await sb.from('selections').update({ seen: true }).eq('id', id);
  if (error) { toast('Erro ao marcar', 'error'); return; }
  toast('Marcada como vista', 'success');
  initSelectionsScreen();
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// ── VENDAS ──
function brlAdmin(c) { return ((c || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
async function initSalesScreen() {
  const wrap = document.getElementById('sales-list'), empty = document.getElementById('sales-empty');
  wrap.innerHTML = '<div style="color:var(--muted);font-size:.7rem;padding:20px">Carregando...</div>';
  const { data, error } = await sb.from('orders').select('*, galleries(name)').neq('status', 'pending').order('created_at', { ascending: false });
  if (error) { wrap.innerHTML = ''; empty.style.display = 'block'; empty.textContent = 'Erro: ' + error.message; return; }
  const approved = data.filter(o => o.status === 'approved');
  document.getElementById('sales-total').textContent = brlAdmin(approved.reduce((a, o) => a + (o.amount_cents || 0), 0));
  document.getElementById('sales-count').textContent = approved.length;
  document.getElementById('sales-photos').textContent = approved.reduce((a, o) => a + ((o.photo_ids || []).length), 0);
  if (!data.length) { wrap.innerHTML = ''; empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  wrap.innerHTML = data.map(o => {
    const d = new Date(o.created_at).toLocaleString('pt-BR');
    const badge = o.status === 'approved' ? '<span style="color:#2a9d5c">aprovado</span>' : `<span style="color:#e04444">${esc(o.status)}</span>`;
    return `<div style="background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:12px 16px;margin-bottom:8px;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap">
      <div><div style="font-weight:700;color:var(--text)">${brlAdmin(o.amount_cents)} · ${(o.photo_ids || []).length} foto(s)</div>
      <div style="font-size:.72rem;color:var(--muted)">${esc(o.galleries && o.galleries.name || '—')} · ${d} · ${esc(o.email || 'sem e-mail')}</div></div>
      <div style="font-size:.72rem;align-self:center">${badge}</div></div>`;
  }).join('');
}

function toggleMobileSidebar() {
  document.getElementById('sidebar').classList.toggle('mobile-open');
}

// ── DASHBOARD ──
async function renderDashboard() {
  const grid = document.getElementById('gallery-grid');
  const empty = document.getElementById('empty-dash');
  grid.innerHTML = '<div style="color:var(--muted);font-size:0.7rem;padding:20px">Carregando...</div>';

  const { data, error } = await sb
    .from('galleries')
    .select('*')
    .is('deleted_at', null)
    .order('created_at', { ascending: false });

  if(error) { toast('Erro ao carregar galerias: ' + error.message, 'error'); return; }
  galleries = data || [];

  // Contagem exata e capa por galeria (não puxa todas as fotos — funciona com 1500+)
  await Promise.all(galleries.map(async g => {
    const { count } = await sb.from('photos')
      .select('*', { count: 'exact', head: true }).eq('gallery_id', g.id);
    g._count = count || 0;
    let coverQ = g.cover_photo_id
      ? sb.from('photos').select('thumb_url').eq('id', g.cover_photo_id).maybeSingle()
      : sb.from('photos').select('thumb_url').eq('gallery_id', g.id).order('position').limit(1).maybeSingle();
    const { data: cover } = await coverQ;
    g._coverThumb = cover?.thumb_url || null;
  }));

  // Assina as capas (worker exige assinatura)
  const signedCovers = await signUrls(galleries.map(g => g._coverThumb || ''));
  galleries.forEach((g, i) => { if (g._coverThumb) g._coverThumb = signedCovers[i] || g._coverThumb; });

  const active = galleries.filter(g => g.status === 'live').length;
  const totalPhotos = galleries.reduce((s,g) => s + (g._count||0), 0);
  document.getElementById('stat-active').textContent = active;
  document.getElementById('stat-photos').textContent = totalPhotos;
  document.getElementById('stat-clients').textContent = galleries.length;
  document.getElementById('nav-badge').textContent = galleries.length;

  // Grupos: renderizados como card único no dashboard — os álbuns filhos não
  // aparecem soltos aqui (só dentro do grupo, via "Gerenciar grupo").
  const { data: groupsData } = await sb.from('gallery_groups')
    .select('id,name,status,access_token,cover_photo_id')
    .is('deleted_at', null).order('created_at', { ascending: false });
  const groups = groupsData || [];
  const kidsByGroupId = {};
  galleries.forEach(g => { if (g.gallery_group_id) (kidsByGroupId[g.gallery_group_id] ||= []).push(g); });

  const ownCoverIds = groups.filter(gr => gr.cover_photo_id).map(gr => gr.cover_photo_id);
  let ownCoverRaw = {};
  if (ownCoverIds.length) {
    const { data: covPhotos } = await sb.from('photos').select('id,thumb_url').in('id', ownCoverIds);
    (covPhotos || []).forEach(p => { ownCoverRaw[p.id] = p.thumb_url; });
  }
  const ownCoverSigned = await signUrls(groups.map(gr => (gr.cover_photo_id && ownCoverRaw[gr.cover_photo_id]) || ''));
  groups.forEach((gr, i) => {
    gr._kids = kidsByGroupId[gr.id] || [];
    gr._photoCount = gr._kids.reduce((s,k) => s + (k._count||0), 0);
    gr._coverThumb = ownCoverSigned[i] || (gr._kids[0] && gr._kids[0]._coverThumb) || null;
  });

  const ungrouped = sortByEventDate(galleries.filter(g => !g.gallery_group_id));
  const sortedGroups = sortByEventDate(groups);

  if (galleries.length === 0 && groups.length === 0) {
    grid.style.display = 'none';
    empty.style.display = 'block';
    return;
  }

  grid.style.display = 'grid';
  empty.style.display = 'none';
  grid.innerHTML = '';

  sortedGroups.forEach(gr => {
    const thumb = gr._coverThumb || `https://picsum.photos/400/225?random=${gr.id}`;
    const card = document.createElement('div');
    card.className = 'gallery-card';
    card.innerHTML = `
      <img class="gallery-card-thumb" src="${thumb}" alt="${esc(gr.name)}" loading="lazy"
        ondblclick="manageGroup('${gr.id}')" title="Duplo clique para gerenciar o grupo" style="cursor:pointer">
      <div class="gallery-card-body">
        <div class="gallery-card-name">
          <span style="font-family:var(--mono);font-size:.55rem;letter-spacing:.1em;color:var(--accent);border:1px solid var(--accent);border-radius:3px;padding:1px 5px;margin-right:6px;vertical-align:middle">GRUPO</span>${esc(gr.name)}
        </div>
        <div class="gallery-card-meta">
          <span class="gallery-card-info">${gr._kids.length} álbum(ns) · ${gr._photoCount} fotos</span>
          <span class="status-badge ${gr.status==='live'?'status-live':'status-draft'}">${gr.status==='live'?'Compartilhado':'Desligado'}</span>
        </div>
      </div>
      <div class="gallery-card-actions">
        <button class="btn btn-ghost" style="padding:6px 12px;font-size:0.65rem" onclick="manageGroup('${gr.id}')">
          <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" fill="none" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Gerenciar grupo
        </button>
        <button class="btn btn-ghost" style="padding:6px 12px;font-size:0.65rem" onclick="copyGroupLink('${gr.access_token}')">
          <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" fill="none" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          Copiar link
        </button>
      </div>
    `;
    grid.appendChild(card);
  });

  ungrouped.forEach(g => {
    const thumb = g._coverThumb || `https://picsum.photos/400/225?random=${g.id}`;
    const coverPos = `${g.cover_position_x ?? 50}% ${g.cover_position_y ?? 50}%`;
    const card = document.createElement('div');
    card.className = 'gallery-card';
    card.innerHTML = `
      <img class="gallery-card-thumb" src="${thumb}" alt="${esc(g.name)}" loading="lazy"
        ondblclick="openDetail('${g.id}')" title="Duplo clique para gerenciar a galeria"
        style="object-position:${coverPos};cursor:pointer">
      <div class="gallery-card-body">
        <div class="gallery-card-name">${g.password_hash ? '<span title="Protegido por senha" style="margin-right:5px">&#128274;</span>' : ''}${esc(g.name)}</div>
        <div class="gallery-card-meta">
          <span class="gallery-card-info">${g._count||0} fotos · ${esc(g.date)||'—'}</span>
          <span class="status-badge ${g.status==='live'?'status-live':'status-draft'}">${g.status==='live'?'Live':'Rascunho'}</span>
        </div>
      </div>
      <div class="gallery-card-actions">
        <button class="btn btn-ghost" style="padding:6px 12px;font-size:0.65rem" onclick="openDetail('${g.id}')">
          <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" fill="none" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          Gerenciar
        </button>
        <button class="btn btn-ghost" style="padding:6px 12px;font-size:0.65rem" onclick="copyClientLink('${g.id}')">
          <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" fill="none" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
          Copiar link
        </button>
        <button class="btn btn-ghost" title="Renomear" style="padding:6px 10px;font-size:0.65rem" onclick="renameGallery('${g.id}')">
          <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" fill="none" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>
        </button>
        <button class="btn btn-ghost" title="${g.status==='live'?'Desligar compartilhamento':'Ligar compartilhamento'}" style="padding:6px 10px;font-size:0.65rem" onclick="toggleGalleryShare('${g.id}')">
          ${g.status==='live'
            ? '<svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" fill="none" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
            : '<svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" fill="none" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>'}
        </button>
        <button class="btn btn-ghost" title="Apagar" style="padding:6px 10px;font-size:0.65rem" onclick="softDeleteGallery('${g.id}')">
          <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" fill="none" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>
      </div>
    `;
    grid.appendChild(card);
  });
}

// ── NEW GALLERY ──
function resetNewForm() {
  document.getElementById('input-name').value = '';
  document.getElementById('input-date').value = '';
  document.getElementById('input-location').value = '';
  document.getElementById('upload-list').innerHTML = '';
  pendingFiles = [];
  clearCoverFile();
}

// ── CAPA (seleção na criação da galeria) ──
function handleCoverFile(file) {
  if (!file) return;
  pendingCoverFile = file;
  document.getElementById('cover-preview-img').src = URL.createObjectURL(file);
  document.getElementById('cover-zone-empty').style.display = 'none';
  document.getElementById('cover-zone-preview').style.display = 'block';
}
function clearCoverFile() {
  pendingCoverFile = null;
  const input = document.getElementById('cover-file-input');
  if (input) input.value = '';
  const empty = document.getElementById('cover-zone-empty');
  const preview = document.getElementById('cover-zone-preview');
  if (empty) empty.style.display = '';
  if (preview) preview.style.display = 'none';
}

// Fotos vivem no R2 (worker lrp-gallery-signed), não no Supabase Storage —
// esse bucket foi apagado na migração pro R2. Mesma convenção do upload.mjs
// (CLI): key = galleries/<id>/<ts>_<pos>_<nome>, thumb = key + "_thumb.jpg".
// (JPEG desde 16/set/2026 — o encoder WebP do canvas variava demais entre
// navegadores: a mesma foto podia sair com 40KB ou 700KB dependendo de qual
// Chrome/Safari gerou o upload. JPEG do canvas é muito mais consistente.
// Fotos enviadas antes disso ainda têm "_thumb.webp" no R2 — por isso as
// rotinas de exclusão abaixo tentam apagar as duas extensões.)
const R2_UPLOAD_BASE = 'https://lrp-gallery-signed.lrp-gallery.workers.dev';

function _loadImageEl(file) {
  return new Promise(resolve => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload  = () => resolve({ im, url, w: im.naturalWidth, h: im.naturalHeight });
    im.onerror = () => { URL.revokeObjectURL(url); resolve({ im: null, url: null, w: null, h: null }); };
    im.src = url;
  });
}

// Derivado médio (1600px, JPEG). Serve de fonte para a marca d'água no Worker:
// aplicar marca no ORIGINAL estourava a memória do isolate (um JPEG de 24MP
// vira ~96MB descompactado, acima do limite de 128MB) e o pedido morria com
// "unreachable". Redimensionar aqui, no navegador, sai de graça — a imagem já
// está decodificada para gerar a miniatura.
function _makeLgBlob(im, w, h) {
  if (!im) return Promise.resolve(null);
  const MAX = 1600;
  const scale = Math.min(1, MAX / Math.max(w, h));
  const lw = Math.max(1, Math.round(w * scale)), lh = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = lw; canvas.height = lh;
  canvas.getContext('2d').drawImage(im, 0, 0, lw, lh);
  return new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85));
}

function _makeThumbBlob(im, w, h) {
  if (!im) return Promise.resolve(null);
  const MAX = 800;
  const scale = Math.min(1, MAX / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * scale)), th = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement('canvas');
  canvas.width = tw; canvas.height = th;
  canvas.getContext('2d').drawImage(im, 0, 0, tw, th);
  return new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.8));
}

// Pede à RPC (admin autenticado) uma assinatura de curta duração pra essa key
// e sobe os bytes pro worker R2. Nunca carrega o UPLOAD_SECRET no navegador.
async function _putR2(key, body, contentType) {
  const { data: auth, error: authErr } = await sb.rpc('get_upload_sig', { p_key: key });
  if (authErr || !auth || auth.error) { console.error('_putR2 (auth):', authErr || auth); return null; }
  const res = await fetch(`${R2_UPLOAD_BASE}/${key}?exp=${auth.exp}&sig=${auth.sig}`, {
    method: 'PUT', headers: { 'Content-Type': contentType }, body
  });
  if (!res.ok) { console.error('_putR2 (upload):', res.status, await res.text().catch(() => '')); return null; }
  return `${R2_UPLOAD_BASE}/${key}`;
}

// Mesmo esquema do upload, mas com RPC/suffix próprios (get_delete_sig, ':del')
// — uma assinatura de upload vazada não serve pra apagar. Idempotente: apagar
// uma key que não existe no R2 não é erro.
async function _deleteR2(key) {
  const { data: auth, error: authErr } = await sb.rpc('get_delete_sig', { p_key: key });
  if (authErr || !auth || auth.error) { console.error('_deleteR2 (auth):', authErr || auth); return false; }
  const res = await fetch(`${R2_UPLOAD_BASE}/${key}?exp=${auth.exp}&sig=${auth.sig}`, { method: 'DELETE' });
  if (!res.ok) { console.error('_deleteR2:', res.status, await res.text().catch(() => '')); return false; }
  return true;
}

// Upload genérico de 1 foto p/ uma galeria (R2 + insert em `photos`).
// Reusado pela criação de galeria, "Adicionar fotos" e o picker de capa
// (nova galeria, detalhe da galeria, grupos).
// 'replace-all' fica valendo pro resto do lote atual (reset a cada novo upload em lote,
// ver resetDupePolicy em createGallery/addPhotosToDetail) — evita perguntar foto por foto.
let _dupePolicy = null;
function resetDupePolicy() { _dupePolicy = null; }

async function uploadGalleryPhoto(file, galleryId, position) {
  // Já existe foto com esse nome nesta galeria? Pergunta substituir ou duplicar.
  const { data: dup } = await sb.from('photos').select('id,storage_path,size_bytes')
    .eq('gallery_id', galleryId).eq('filename', file.name).maybeSingle();
  if (dup) {
    // Mesmo nome + mesmo tamanho = essa foto já subiu numa tentativa anterior
    // (retomando um envio que parou na metade) — não reenvia, não pergunta nada.
    if (dup.size_bytes === file.size) return dup.id;
    const choice = _dupePolicy === 'replace-all' ? 'replace-all'
      : await showDupeChoice(`Já existe uma foto chamada "${file.name}" nesta galeria.`);
    if (choice === 'replace-all') _dupePolicy = 'replace-all';
    if (choice === 'replace' || choice === 'replace-all') {
      if (dup.storage_path) { await _deleteR2(dup.storage_path); await _deleteR2(`${dup.storage_path}_thumb.jpg`); await _deleteR2(`${dup.storage_path}_thumb.webp`); await _deleteR2(`${dup.storage_path}_lg.jpg`); }
      await sb.from('photos').delete().eq('id', dup.id);
    }
  }

  // Lê a data de captura (EXIF) do arquivo original ANTES de qualquer
  // processamento — em paralelo com o resto, já que não depende de nada.
  const takenAtP = extractTakenAt(file);

  const { im, url, w, h } = await _loadImageEl(file);
  const thumbBlob = await _makeThumbBlob(im, w, h);
  const lgBlob    = await _makeLgBlob(im, w, h);
  if (url) URL.revokeObjectURL(url);

  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const baseKey = `galleries/${galleryId}/${Date.now()}_${position}_${safe}`;

  const fullUrl = await _putR2(baseKey, file, file.type || 'application/octet-stream');
  if (!fullUrl) return null;
  const thumbUrl = thumbBlob ? await _putR2(`${baseKey}_thumb.jpg`, thumbBlob, 'image/jpeg') : fullUrl;
  // Falha aqui não impede o envio da foto — só faz a marca d'água cair no
  // caminho lento (e limitado) de processar o original.
  if (lgBlob) { try { await _putR2(`${baseKey}_lg.jpg`, lgBlob, 'image/jpeg'); } catch (e) {} }

  const { data: photo, error: insErr } = await sb.from('photos').insert({
    gallery_id: galleryId, filename: file.name,
    storage_path: baseKey, thumb_url: thumbUrl || fullUrl,
    full_url: fullUrl, size_bytes: file.size, position,
    width: w, height: h, taken_at: await takenAtP
  }).select('id').single();
  if (insErr) console.error('uploadGalleryPhoto (insert):', insErr);
  return photo?.id || null;
}

function handleFiles(files) {
  const list = document.getElementById('upload-list');
  Array.from(files).forEach(file => {
    const id = Date.now() + Math.random();
    pendingFiles.push({ id, file });
    const item = document.createElement('div');
    item.className = 'upload-item';
    item.id = `upload-${id}`;
    item.innerHTML = `
      <span class="upload-item-name">${esc(file.name)}</span>
      <span class="upload-item-size">${(file.size/1024/1024).toFixed(1)}MB</span>
      <div class="upload-progress-bar"><div class="upload-progress-fill" id="prog-${id}" style="width:0%"></div></div>
      <span class="upload-status uploading" id="status-${id}">—</span>
    `;
    list.appendChild(item);
  });
}

function setProgress(id, pct, done=false, err=false) {
  const bar = document.getElementById(`prog-${id}`);
  const status = document.getElementById(`status-${id}`);
  if(bar) bar.style.width = pct + '%';
  if(status) {
    if(done)  { status.textContent = '✓'; status.className = 'upload-status done'; }
    else if(err) { status.textContent = '✗'; status.className = 'upload-status error'; }
    else { status.textContent = pct + '%'; }
  }
}

async function createGallery() {
  resetDupePolicy();
  const name = document.getElementById('input-name').value.trim();
  if(!name) { toast('Digite o nome do evento', 'error'); return; }

  const date = document.getElementById('input-date').value;
  const location = document.getElementById('input-location').value.trim();
  let slug = name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'-').replace(/(^-|-$)/g,'');

  // Garante unicidade do slug
  let finalSlug = slug, suffix = 2;
  while (true) {
    const { data: existing } = await sb.from('galleries').select('id').eq('slug', finalSlug).maybeSingle();
    if (!existing) break;
    finalSlug = slug + '-' + suffix++;
  }
  slug = finalSlug;

  toast('Criando galeria...', '');

  // 1. Cria galeria no banco
  const { data: gallery, error: gErr } = await sb
    .from('galleries')
    .insert({ name, slug, date, location, status: 'live', access_token: Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b=>b.toString(16).padStart(2,'0')).join('') })
    .select().single();

  if(gErr) { toast('Erro: ' + gErr.message, 'error'); return; }

  let pos = 0;

  // 2. Upload da capa (se escolhida) — fica em position 0.
  let coverPhotoId = null;
  if (pendingCoverFile) {
    coverPhotoId = await uploadGalleryPhoto(pendingCoverFile, gallery.id, pos++);
  }

  // 3. Upload das fotos do álbum
  if(pendingFiles.length > 0) {
    for(const {id, file} of pendingFiles) {
      setProgress(id, 30);
      let photoId = null;
      try { photoId = await uploadGalleryPhoto(file, gallery.id, pos++); }
      catch (e) { console.error('createGallery (foto):', e); }
      setProgress(id, 100, !!photoId, !photoId);
    }
  }

  if (coverPhotoId) {
    await sb.from('galleries').update({ cover_photo_id: coverPhotoId }).eq('id', gallery.id);
  }

  logAdminAction('create_gallery', { galleryId: gallery.id, name, photoCount: pendingFiles.length + (coverPhotoId ? 1 : 0) });
  toast(`"${name}" criada!`, 'success');
  setTimeout(() => openDetail(gallery.id), 600);
}
