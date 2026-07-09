// ── SCROLL / OBSERVER + VIRTUAL SCROLL + GRUPOS + GRID SIZE/ESPAÇAMENTO/COR + LIKE/VIEWS ──
// Extraído de gallery.html (fatia de modularização). É o motor de grade da
// galeria — carregado ANTES do script principal (que chama init()) para que
// tudo aqui já esteja definido quando init() precisar (renderGrid, etc.).
// Depende de globals do script principal (liked, saveLiked, PHOTOS, lbPhotos,
// lbIndex, galleryId, dominantColor, bgMode, gridSize, gridGap, currentView,
// toast, sb, trackEvent, hideFacialActions) e de gallery-utils.js.
const cover  = document.getElementById('cover');
const header = document.getElementById('site-header');
const obs    = new IntersectionObserver(
  e => header.classList.toggle('hidden-on-cover', e[0].isIntersecting),
  { threshold: 0.1 }
);
obs.observe(cover);

function scrollToGrid() {
  document.getElementById('grid-section').scrollIntoView({ behavior: 'smooth' });
}

// ── VIRTUAL SCROLL ──
let _vLayout   = null;   // { rows:[{y,h,entries:[{photo,x,w}]}], totalHeight }
let _vRendered = new Set();
let _vScrollRAF = null;
let _vRecomputeTimer = null;
let lbPhotoIndex = new Map();
const V_BUFFER = 800;

function rowHeight() {
  const w = window.innerWidth;
  const base = { sm: 170, md: 280, lg: 430, frame: 330 }[gridSize] || 280;
  return w < 700 ? Math.round(base * 0.6) : base;
}

function getGridGap() {
  if (gridSize === 'frame') return 20;
  return { sm: 2, md: 4, lg: 14 }[gridGap] || 4;
}
function getGridPad() {
  if (gridSize === 'frame') return 20;
  return { sm: 2, md: 4, lg: 14 }[gridGap] || 4;
}

function computeLayout(photos) {
  const grid = document.getElementById('masonry');
  const gap  = getGridGap(), pad = getGridPad();
  const W    = grid.clientWidth - pad * 2;
  const R    = rowHeight(), maxH = R * 1.35;

  const rows = []; let row = [], sum = 0, y = pad;
  const flush = h => {
    let x = pad;
    const entries = row.map(({ photo, r }) => {
      const w = r * h; const e = { photo, x, w }; x += w + gap; return e;
    });
    rows.push({ y, h, entries });
    y += h + gap; row = []; sum = 0;
  };
  photos.forEach(photo => {
    const r = photo.ratio || 1.5;
    row.push({ photo, r }); sum += r;
    const h = (W - (row.length - 1) * gap) / sum;
    if (h <= maxH) flush(Math.min(h, maxH));
  });
  if (row.length) flush(Math.min((W - (row.length - 1) * gap) / sum, R));
  return { rows, totalHeight: y + pad };
}

function makeCard(photo, w, h) {
  const idx = lbPhotoIndex.get(photo.id) ?? 0;
  const card = document.createElement('div');
  card.id = 'vc-' + photo.id;
  card.className = 'photo-card' + (liked.has(photo.id) ? ' liked' : '');
  card.dataset.id = photo.id;
  card.style.cssText = `position:absolute;width:${w}px;height:${h}px;opacity:0;transform:translateY(16px);transition:opacity .25s,transform .25s`;
  card.innerHTML = `
    <img src="${photo.thumb}" loading="lazy" decoding="async" alt="${esc(photo.name)}"
         onload="photoCardSized(this)"
         onclick="openLightbox(${idx},event)">
    <button class="card-heart" onclick="toggleLike(event,${photo.id},this)" title="Favoritar">
      <svg viewBox="0 0 24 24" stroke-width="1.8">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
      </svg>
    </button>`;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    card.style.opacity = '1'; card.style.transform = 'translateY(0)';
  }));
  return card;
}

function vRenderVisible() {
  if (!_vLayout) return;
  const grid   = document.getElementById('masonry');
  const gridTop = grid.getBoundingClientRect().top + window.scrollY;
  const sTop   = window.scrollY, vH = window.innerHeight;
  const minY   = sTop - gridTop - V_BUFFER, maxY = sTop - gridTop + vH + V_BUFFER;

  const visible = new Set();
  _vLayout.rows.forEach((row, i) => {
    if (row.y + row.h > minY && row.y < maxY) visible.add(i);
  });

  _vRendered.forEach(i => {
    if (!visible.has(i)) {
      _vLayout.rows[i].entries.forEach(({ photo }) =>
        document.getElementById('vc-' + photo.id)?.remove());
      _vRendered.delete(i);
    }
  });

  const frag = document.createDocumentFragment();
  visible.forEach(i => {
    if (_vRendered.has(i)) return;
    _vLayout.rows[i].entries.forEach(({ photo, x, w }) => {
      const row = _vLayout.rows[i];
      const card = makeCard(photo, w, row.h);
      card.style.top  = row.y + 'px';
      card.style.left = x + 'px';
      frag.appendChild(card);
    });
    _vRendered.add(i);
  });
  grid.appendChild(frag);
}

function vScheduleRender() {
  if (_vScrollRAF) cancelAnimationFrame(_vScrollRAF);
  _vScrollRAF = requestAnimationFrame(() => { _vScrollRAF = null; vRenderVisible(); });
}

function renderGrid(photos) {
  lbPhotos = photos;
  lbPhotoIndex = new Map(photos.map((p, i) => [p.id, i]));
  const grid = document.getElementById('masonry');
  grid.innerHTML = '';
  _vRendered.clear();
  if (!photos.length) { grid.style.height = '0'; _vLayout = null; return; }
  _vLayout = computeLayout(photos);
  grid.style.height = _vLayout.totalHeight + 'px';
  vRenderVisible();
}

function photoCardSized(img) {
  img.classList.add('loaded');
  const card = img.closest('.photo-card');
  if (!card) return;
  const pid  = parseInt(card.dataset.id);
  const photo = PHOTOS.find(p => p.id === pid) || lbPhotos.find(p => p.id === pid);
  if (!photo || photo.ratio) return;
  photo.ratio = (img.naturalWidth / img.naturalHeight) || 1.5;
  clearTimeout(_vRecomputeTimer);
  _vRecomputeTimer = setTimeout(() => renderGrid(lbPhotos), 80);
}

// ── GRUPOS ──
let currentGroup = null; // null = todas

function buildGroupTabs() {
  const bar = document.getElementById('group-tabs');
  const groups = [...new Set(PHOTOS.map(p => p.group).filter(Boolean))];
  if (!groups.length) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex';
  bar.innerHTML = '';
  const mkBtn = (label, group, active) => {
    const btn = document.createElement('button');
    btn.className = 'group-tab' + (active ? ' active' : '');
    btn.textContent = label;
    btn.addEventListener('click', function() { selectGroup(group, this); });
    bar.appendChild(btn);
  };
  mkBtn('Todas as Fotos', null, true);
  groups.forEach(g => mkBtn(g, g, false));
}

function selectGroup(name, btn) {
  currentGroup = name;
  currentView = 'all';
  document.querySelectorAll('.group-tab').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const subset = name ? PHOTOS.filter(p => p.group === name) : [...PHOTOS];
  lbPhotos = subset;
  renderGrid(subset);
  document.getElementById('grid-section').scrollIntoView();
}

// ── GRID SIZE ──
function setGridSize(size) {
  const grid = document.getElementById('masonry');
  grid.classList.remove('size-sm','size-md','size-lg','size-frame');
  grid.classList.add('size-' + size);
  gridSize = size;
  ['Sm','Md','Lg','Frame'].forEach(s =>
    document.getElementById('btnSize'+s).classList.toggle('active', size === s.toLowerCase())
  );
  renderGrid(lbPhotos);
}

window.addEventListener('scroll', vScheduleRender, { passive: true });
let _resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(_resizeTimer);
  _resizeTimer = setTimeout(() => { if (lbPhotos.length) renderGrid(lbPhotos); }, 180);
});

// ── ESPAÇAMENTO ──
function setGap(gap) {
  const grid = document.getElementById('masonry');
  grid.classList.remove('gap-sm','gap-md','gap-lg');
  grid.classList.add('gap-' + gap);
  gridGap = gap;
  ['Sm','Md','Lg'].forEach(s =>
    document.getElementById('btnGap'+s).classList.toggle('active', gap === s.toLowerCase())
  );
  renderGrid(lbPhotos);
}

// ── COR DE FUNDO ──
function setBg(mode) {
  const map = {
    white: '#ffffff',
    gray:  '#888888',
    black: '#111111',
    auto:  dominantColor || '#7a7a7a'
  };
  const color = map[mode] || '#ffffff';
  bgMode = mode;
  document.body.style.setProperty('--bg', color);
  document.body.classList.toggle('bg-dark',
    mode === 'gray' || mode === 'black' || (mode === 'auto' && isDark(dominantColor))
  );
  ['White','Gray','Black','Auto'].forEach(s =>
    document.getElementById('btnBg'+s).classList.toggle('active', mode === s.toLowerCase())
  );
}

function isDark(hex) {
  if (!hex) return false;
  const m = hex.match(/\d+/g);
  if (!m || m.length < 3) return false;
  const [r,g,b] = m.map(Number);
  return (r*0.299 + g*0.587 + b*0.114) < 140;
}

// ── COR DOMINANTE ──
function extractDominantColor() {
  if (PHOTOS.length === 0) return;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 40; canvas.height = 40;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, 40, 40);
      const d = ctx.getImageData(0, 0, 40, 40).data;
      let r=0, g=0, b=0, n = d.length / 4;
      for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i+1]; b += d[i+2]; }
      r = Math.round(r/n); g = Math.round(g/n); b = Math.round(b/n);
      dominantColor = `rgb(${r},${g},${b})`;
      document.getElementById('btnBgAuto').style.background = dominantColor;
      // Atualiza fundo se já estava em modo auto
      if (bgMode === 'auto') setBg('auto');
    } catch(e) { /* CORS — mantém gradiente decorativo */ }
  };
  img.src = PHOTOS[0].thumb;
}

// ── FOTO DE CAPA ──
async function setCoverPhoto() {
  const photo = lbPhotos[lbIndex];
  if (!photo) return;

  // Atualiza visualmente
  const coverImg = document.getElementById('cover-img');
  coverImg.style.opacity = '0';
  setTimeout(() => { coverImg.src = photo.lg || photo.full; coverImg.style.opacity = '1'; }, 200);

  coverPhotoId = photo.id;
  document.getElementById('lbCoverBtn').classList.add('is-cover');
  setTimeout(() => document.getElementById('lbCoverBtn').classList.remove('is-cover'), 1800);

  // Persiste no Supabase
  if (galleryId) {
    const { error } = await sb
      .from('galleries')
      .update({ cover_photo_id: photo.id })
      .eq('id', galleryId);
    toast(error ? 'Erro ao salvar capa' : 'Foto de capa atualizada!');
  } else {
    toast('Capa definida (demo)');
  }
}

// ── LIKE ──
function toggleLike(e, id, btn) {
  if (e) e.stopPropagation();
  const wasLiked = liked.has(id);
  wasLiked ? liked.delete(id) : liked.add(id);
  saveLiked();
  if (!wasLiked) trackEvent('like', id);

  if (!wasLiked && btn) {
    btn.classList.add('pop');
    btn.addEventListener('animationend', () => btn.classList.remove('pop'), {once:true});
  }

  const card = document.querySelector(`.photo-card[data-id="${id}"]`);
  if (card) card.classList.toggle('liked', !wasLiked);

  if (currentView === 'liked') {
    const favs = PHOTOS.filter(p => liked.has(p.id));
    if (favs.length === 0) showAll(); else renderGrid(favs);
  }
  updateBottomBar();
  updateLbHeart();
}

function toggleLikeLb() {
  const photo = lbPhotos[lbIndex];
  if (!photo) return;
  const btn = document.getElementById('lbHeart');
  const wasLiked = liked.has(photo.id);
  wasLiked ? liked.delete(photo.id) : liked.add(photo.id);
  saveLiked();
  if (!wasLiked) trackEvent('like', photo.id);
  btn.classList.toggle('liked', !wasLiked);
  const card = document.querySelector(`.photo-card[data-id="${photo.id}"]`);
  if (card) card.classList.toggle('liked', !wasLiked);
  updateBottomBar();
}

function updateLbHeart() {
  if (!lbPhotos[lbIndex]) return;
  document.getElementById('lbHeart').classList.toggle('liked', liked.has(lbPhotos[lbIndex].id));
}

function updateBottomBar() {
  const n = liked.size;
  document.getElementById('barCount').textContent = n;
  document.getElementById('barHeartBtn').classList.toggle('has-likes', n > 0);
  document.getElementById('barActionBtn').title = n > 0 ? `Salvar ${n} favorita(s)` : 'Salvar todas';
}

// ── VIEWS ──
function showAll() {
  currentView = 'all'; currentGroup = null;
  hideFacialActions();
  document.querySelectorAll('.group-tab').forEach((b, i) => b.classList.toggle('active', i === 0));
  lbPhotos = [...PHOTOS]; renderGrid(PHOTOS);
}
function showLiked() {
  const favs = PHOTOS.filter(p => liked.has(p.id));
  if (favs.length === 0) { toast('Nenhuma foto favoritada ainda'); return; }
  currentView = 'liked'; lbPhotos = favs; hideFacialActions(); renderGrid(favs);
}
function openLikedView() {
  if (liked.size === 0) { toast('Toque no ♡ das fotos para favoritar'); return; }
  showLiked();
  document.getElementById('grid-section').scrollIntoView({behavior:'smooth'});
}
