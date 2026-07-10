// ── DETAIL + GRUPOS(admin) + COVER EDITOR + SETTINGS ──
// Extraído de admin.html (fatia de modularização). Depende de globals do
// script principal (sb, toast, signPhotos, BASE_URL, currentGalleryId,
// currentGalleryCoverPhotoId, coverEditorPhotoId, coverEditorPosX,
// coverEditorPosY, galleries, BUCKET, goTo, hashSHA256, loadFaceIndexInfo) —
// só usados dentro das funções.

// Busca todas as fotos paginando (contorna o teto de 1000 do PostgREST — funciona com 1500+)
async function fetchGalleryPhotos(galleryId) {
  let all = [], from = 0;
  while (true) {
    const { data: rows, error } = await sb.from('photos')
      .select('id, filename, storage_path, thumb_url, full_url, position, group_name')
      .eq('gallery_id', galleryId).order('position', { ascending: true })
      .range(from, from + 499);
    if (error) throw error;
    if (!rows?.length) break;
    all = all.concat(rows);
    if (rows.length < 500) break;
    from += 500;
  }
  return all;
}

async function openDetail(id) {
  const { data: g, error } = await sb
    .from('galleries').select('*').eq('id', id).single();

  if(error || !g) { toast('Erro ao carregar galeria', 'error'); return; }
  try { g.photos = await fetchGalleryPhotos(id); await signPhotos(g.photos); }
  catch(e) { toast('Erro ao carregar fotos: ' + e.message, 'error'); return; }

  currentGalleryId = id;
  const link = `${BASE_URL}/gallery.html?t=${g.access_token}`;

  document.getElementById('detail-title').textContent = g.name.toUpperCase();
  document.getElementById('detail-meta').textContent = `${g.date||'—'} · ${g.location||'—'} · ${new Date(g.created_at).toLocaleDateString('pt-BR')}`;
  document.getElementById('detail-link').textContent = link;
  g._link = link;

  g.photos?.sort((a,b) => a.position - b.position);
  renderDetailPhotos(g);
  goTo('detail');
  document.getElementById('topbar-title').textContent = g.name.toUpperCase();
}

function makeDetailPhotoEl(photo) {
  const isCover = photo.id === currentGalleryCoverPhotoId;
  const div = document.createElement('div');
  div.className = 'detail-photo' + (isCover ? ' is-cover' : '') +
                  (groupSelection.has(String(photo.id)) ? ' selected' : '');
  div.dataset.id = photo.id;
  div.innerHTML = `
    <img src="${photo.thumb_url}" alt="${esc(photo.filename)}" loading="lazy">
    ${photo.group_name ? `<span class="detail-photo-group">${esc(photo.group_name)}</span>` : ''}
    <button class="detail-photo-cover" onclick="openCoverEditor('${photo.id}','${photo.full_url}',event)" title="${isCover ? 'Capa atual — clique para reposicionar' : 'Definir como capa'}">
      <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
    </button>
    <button class="detail-photo-del" onclick="deletePhoto('${photo.id}','${photo.storage_path}')" title="Remover">
      <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  `;
  div.addEventListener('click', (e) => {
    if (!groupMode) return;
    e.stopPropagation();
    const key = String(photo.id);
    if (groupSelection.has(key)) groupSelection.delete(key);
    else groupSelection.add(key);
    updateGroupBar();
  }, true); // captura antes dos botões internos no modo grupos
  return div;
}

let _detailRenderToken = 0;
function renderDetailPhotos(g) {
  const grid = document.getElementById('detail-grid');
  const count = document.getElementById('detail-photo-count');
  const photos = g.photos || [];
  count.textContent = `${photos.length} fotos`;
  grid.innerHTML = '';
  currentGalleryCoverPhotoId = g.cover_photo_id || null;

  // Render em blocos para não travar a UI com 1500+ fotos
  const token = ++_detailRenderToken;
  const CHUNK = 150;
  let i = 0;
  const step = () => {
    if (token !== _detailRenderToken) return; // outra galeria foi aberta
    const frag = document.createDocumentFragment();
    for (let n = 0; n < CHUNK && i < photos.length; n++, i++) {
      frag.appendChild(makeDetailPhotoEl(photos[i]));
    }
    grid.appendChild(frag);
    if (i < photos.length) requestAnimationFrame(step);
  };
  step();

  // Sugestões de grupos existentes no datalist
  const names = [...new Set(photos.map(p => p.group_name).filter(Boolean))];
  document.getElementById('group-names').innerHTML = names.map(n => `<option value="${esc(n)}">`).join('');
}

// ── GRUPOS (admin) ──
let groupMode = false;
const groupSelection = new Set();

function toggleGroupMode() {
  groupMode = !groupMode;
  groupSelection.clear();
  document.getElementById('group-bar').style.display = groupMode ? 'flex' : 'none';
  document.getElementById('btnGroupMode').classList.toggle('btn-primary', groupMode);
  updateGroupBar();
  if (!groupMode) openDetail(currentGalleryId);
  else toast('Clique nas fotos para selecionar, depois dê um nome ao grupo', '');
}

function updateGroupBar() {
  document.getElementById('group-sel-count').textContent = `${groupSelection.size} SELECIONADAS`;
  document.querySelectorAll('.detail-photo').forEach(d =>
    d.classList.toggle('selected', groupSelection.has(d.dataset.id)));
}

async function applyGroup(remove = false) {
  if (!groupSelection.size) { toast('Selecione fotos primeiro', 'error'); return; }
  const name = document.getElementById('group-name-input').value.trim();
  if (!remove && !name) { toast('Digite o nome do grupo', 'error'); return; }
  const ids = [...groupSelection];
  const { error } = await sb.from('photos')
    .update({ group_name: remove ? null : name })
    .in('id', ids);
  if (error) { toast('Erro: ' + error.message, 'error'); return; }
  toast(remove ? `Grupo removido de ${ids.length} foto(s)` : `${ids.length} foto(s) → "${name}"`, 'success');
  groupSelection.clear();
  // Recarrega mantendo o modo grupos ativo
  const { data: g } = await sb.from('galleries').select('*').eq('id', currentGalleryId).single();
  if (g) {
    try { g.photos = await fetchGalleryPhotos(currentGalleryId); await signPhotos(g.photos); } catch(e) { g.photos = []; }
    g.photos.sort((a,b) => a.position - b.position);
    renderDetailPhotos(g);
  }
  updateGroupBar();
}

async function addPhotosToDetail(files) {
  if(!currentGalleryId) return;
  toast(`Enviando ${files.length} foto(s)...`, '');

  const { data: existing } = await sb.from('photos').select('position').eq('gallery_id', currentGalleryId).order('position', {ascending: false}).limit(1);
  let pos = (existing?.[0]?.position ?? -1) + 1;

  for(const file of Array.from(files)) {
    const path = `galleries/${currentGalleryId}/${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
    const { error } = await sb.storage.from(BUCKET).upload(path, file, { upsert: true, contentType: file.type });
    if(error) continue;

    const { data: u } = sb.storage.from(BUCKET).getPublicUrl(path);
    const { data: t } = sb.storage.from(BUCKET).getPublicUrl(path, { transform: { width: 800, height: 800, resize: 'contain', quality: 80, format: 'webp' } });

    // Dimensões reais — usadas pelo layout justificado da galeria
    const dims = await new Promise(res => {
      const url = URL.createObjectURL(file);
      const im = new Image();
      im.onload  = () => { URL.revokeObjectURL(url); res({ w: im.naturalWidth, h: im.naturalHeight }); };
      im.onerror = () => { URL.revokeObjectURL(url); res({ w: null, h: null }); };
      im.src = url;
    });

    await sb.from('photos').insert({
      gallery_id: currentGalleryId, filename: file.name,
      storage_path: path, thumb_url: t.publicUrl,
      full_url: u.publicUrl, size_bytes: file.size, position: pos++,
      width: dims.w, height: dims.h
    });
  }

  toast(`${files.length} foto(s) adicionada(s)!`, 'success');
  openDetail(currentGalleryId);
}

async function deletePhoto(photoId, storagePath) {
  await sb.storage.from(BUCKET).remove([storagePath]);
  await sb.from('photos').delete().eq('id', photoId);
  logAdminAction('delete_photo', { photoId, galleryId: currentGalleryId });
  openDetail(currentGalleryId);
}

function showConfirmModal(msg) {
  return new Promise(resolve => {
    document.getElementById('confirm-msg').textContent = msg;
    document.getElementById('confirm-modal').classList.add('open');
    const onOk     = () => { document.getElementById('confirm-modal').classList.remove('open'); resolve(true); };
    const onCancel = () => { document.getElementById('confirm-modal').classList.remove('open'); resolve(false); };
    document.getElementById('confirm-ok').addEventListener('click', onOk, { once: true });
    document.getElementById('confirm-cancel').addEventListener('click', onCancel, { once: true });
  });
}

async function deleteCurrentGallery() {
  const confirmed = await showConfirmModal('Apagar esta galeria? O link do cliente deixará de funcionar. É reversível — a galeria fica recuperável.');
  if (!confirmed) return;
  const g = galleries.find(g => g.id === currentGalleryId);
  // Soft delete: preserva fotos e permite recuperar; desliga o compartilhamento.
  const { error } = await sb.from('galleries')
    .update({ deleted_at: new Date().toISOString(), status: 'draft' })
    .eq('id', currentGalleryId);
  if (error) { toast('Erro ao apagar: ' + error.message, 'error'); return; }
  logAdminAction('delete_gallery', { galleryId: currentGalleryId, name: g && g.name, soft: true });
  toast('Galeria apagada (recuperável)', 'error');
  goTo('dashboard');
  renderDashboard();
}

// ── AÇÕES RÁPIDAS POR GALERIA (cards do dashboard) ──
// Trabalham no schema real: name (renomear), status live/draft (liga/desliga
// compartilhamento — é o que a galeria pública checa) e deleted_at (soft delete).
async function renameGallery(id) {
  const g = galleries.find(x => x.id === id); if (!g) return;
  const name = prompt('Novo nome da galeria:', g.name || '');
  if (name == null) return;
  const clean = name.trim();
  if (!clean) { toast('O nome não pode ficar vazio', 'error'); return; }
  const { error } = await sb.from('galleries').update({ name: clean }).eq('id', id);
  if (error) { toast('Erro ao renomear: ' + error.message, 'error'); return; }
  g.name = clean;
  try { logAdminAction('rename_gallery', { galleryId: id, name: clean }); } catch(e) {}
  toast('Galeria renomeada', 'success');
  renderDashboard();
}

async function toggleGalleryShare(id) {
  const g = galleries.find(x => x.id === id); if (!g) return;
  const next = g.status === 'live' ? 'draft' : 'live';
  const { error } = await sb.from('galleries')
    .update({ status: next, sharing_enabled: next === 'live' }).eq('id', id);
  if (error) { toast('Erro ao alterar compartilhamento: ' + error.message, 'error'); return; }
  g.status = next;
  try { logAdminAction('toggle_share', { galleryId: id, status: next }); } catch(e) {}
  toast(next === 'live'
    ? 'Compartilhamento ligado — link do cliente ativo'
    : 'Compartilhamento desligado — link não abre mais', next === 'live' ? 'success' : '');
  renderDashboard();
}

async function softDeleteGallery(id) {
  const g = galleries.find(x => x.id === id); if (!g) return;
  const ok = await showConfirmModal(`Apagar "${g.name}"? Ela sai da lista e o link do cliente para de funcionar. É reversível — dá para recuperar depois.`);
  if (!ok) return;
  const { error } = await sb.from('galleries')
    .update({ deleted_at: new Date().toISOString(), status: 'draft' }).eq('id', id);
  if (error) { toast('Erro ao apagar: ' + error.message, 'error'); return; }
  try { logAdminAction('soft_delete_gallery', { galleryId: id, name: g.name }); } catch(e) {}
  toast('Galeria apagada (recuperável)', 'error');
  renderDashboard();
}

function copyLink() {
  const link = document.getElementById('detail-link').textContent;
  navigator.clipboard.writeText(link).then(() => toast('Link copiado!', 'success'));
}

function copyClientLink(id) {
  const g = galleries.find(g => g.id === id);
  if(!g) return;
  const link = `${BASE_URL}/gallery.html?t=${g.access_token}`;
  navigator.clipboard.writeText(link).then(() => toast('Link copiado!', 'success'));
}

function previewGallery() {
  const g = galleries.find(g => g.id === currentGalleryId);
  if(!g) return;
  window.open(`${BASE_URL}/gallery.html?t=${g.access_token}`, '_blank');
}

// ── AÇÕES DA GALERIA ABERTA (mesmas da galeria-mãe) ──
async function renameCurrentGallery() {
  if (!currentGalleryId) return;
  const cur = document.getElementById('detail-title')?.textContent || '';
  const name = prompt('Novo nome da galeria:', cur);
  if (name == null) return;
  const clean = name.trim(); if (!clean) { toast('Nome vazio', 'error'); return; }
  const { error } = await sb.from('galleries').update({ name: clean }).eq('id', currentGalleryId);
  if (error) { toast('Erro ao renomear: ' + error.message, 'error'); return; }
  document.getElementById('detail-title').textContent = clean.toUpperCase();
  const tb = document.getElementById('topbar-title'); if (tb) tb.textContent = clean.toUpperCase();
  try { logAdminAction('rename_gallery', { galleryId: currentGalleryId, name: clean }); } catch(e) {}
  toast('Galeria renomeada', 'success');
  if (typeof renderDashboard === 'function') renderDashboard();
}

async function toggleCurrentGalleryShare() {
  if (!currentGalleryId) return;
  const { data: g } = await sb.from('galleries').select('status').eq('id', currentGalleryId).maybeSingle();
  const next = (g && g.status === 'live') ? 'draft' : 'live';
  const { error } = await sb.from('galleries')
    .update({ status: next, sharing_enabled: next === 'live' }).eq('id', currentGalleryId);
  if (error) { toast('Erro: ' + error.message, 'error'); return; }
  toast(next === 'live' ? 'Compartilhamento ligado — link ativo' : 'Compartilhamento desligado — link não abre', next === 'live' ? 'success' : '');
  if (typeof renderDashboard === 'function') renderDashboard();
}

function qrCurrentGallery() {
  const link = document.getElementById('detail-link')?.textContent;
  if (!link || link === '—') { toast('Link indisponível', 'error'); return; }
  if (typeof showQRForLink === 'function') showQRForLink(link);
  else toast('QR indisponível', 'error');
}

// ── COVER EDITOR ──
function openCoverEditor(photoId, photoUrl, e) {
  if (e) e.stopPropagation();
  coverEditorPhotoId = photoId;
  coverEditorPosX = 50; coverEditorPosY = 50;
  const img = document.getElementById('coverPreviewImg');
  img.src = photoUrl;
  img.style.objectPosition = '50% 50%';
  document.getElementById('coverFocalDot').style.cssText = 'left:50%;top:50%';
  document.getElementById('cover-editor').style.display = 'flex';
  setupCoverEditorDrag();
}

function closeCoverEditor() {
  document.getElementById('cover-editor').style.display = 'none';
}

function setCoverFocalPoint(x, y) {
  coverEditorPosX = Math.round(Math.max(0, Math.min(100, x)) * 10) / 10;
  coverEditorPosY = Math.round(Math.max(0, Math.min(100, y)) * 10) / 10;
  const dot = document.getElementById('coverFocalDot');
  dot.style.left = coverEditorPosX + '%';
  dot.style.top  = coverEditorPosY + '%';
  document.getElementById('coverPreviewImg').style.objectPosition = `${coverEditorPosX}% ${coverEditorPosY}%`;
}

function setupCoverEditorDrag() {
  const el = document.getElementById('coverPreview');
  const getPos = (cx, cy) => {
    const r = el.getBoundingClientRect();
    return { x: (cx - r.left) / r.width * 100, y: (cy - r.top) / r.height * 100 };
  };
  el.onmousedown = (e) => {
    e.preventDefault();
    const p = getPos(e.clientX, e.clientY); setCoverFocalPoint(p.x, p.y);
    const onMove = (ev) => { const p2 = getPos(ev.clientX, ev.clientY); setCoverFocalPoint(p2.x, p2.y); };
    const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };
  el.ontouchstart = (e) => {
    e.preventDefault();
    const t = e.touches[0]; const p = getPos(t.clientX, t.clientY); setCoverFocalPoint(p.x, p.y);
    el.ontouchmove = (ev) => { ev.preventDefault(); const t2 = ev.touches[0]; const p2 = getPos(t2.clientX, t2.clientY); setCoverFocalPoint(p2.x, p2.y); };
    el.ontouchend = () => { el.ontouchmove = null; el.ontouchend = null; };
  };
}

async function saveCoverPhoto() {
  if (!currentGalleryId || !coverEditorPhotoId) return;
  toast('Salvando...', '');
  const { error } = await sb.from('galleries').update({
    cover_photo_id: coverEditorPhotoId,
    cover_position_x: coverEditorPosX,
    cover_position_y: coverEditorPosY,
  }).eq('id', currentGalleryId);
  if (error) { toast('Erro: ' + error.message, 'error'); return; }
  currentGalleryCoverPhotoId = coverEditorPhotoId;
  toast('Capa atualizada!', 'success');
  closeCoverEditor();
  const g = galleries.find(g => g.id === currentGalleryId);
  if (g) { g.cover_photo_id = coverEditorPhotoId; g.cover_position_x = coverEditorPosX; g.cover_position_y = coverEditorPosY; }
  openDetail(currentGalleryId);
}

// ── SETTINGS ──
let currentSettingsGalleryId = null;

async function initSettingsScreen() {
  refreshMfaStatus();
  refreshAuditLog();
  const sel = document.getElementById('settings-gallery-select');
  sel.innerHTML = '<option value="">Selecione uma galeria</option>';
  galleries.forEach(g => {
    sel.innerHTML += `<option value="${g.id}">${esc(g.name)}</option>`;
  });
  document.getElementById('settings-form').style.display  = 'none';
  document.getElementById('settings-empty').style.display = 'block';
}

async function loadGallerySettings(galleryId) {
  const form  = document.getElementById('settings-form');
  const empty = document.getElementById('settings-empty');
  if (!galleryId) { form.style.display = 'none'; empty.style.display = 'block'; return; }

  currentSettingsGalleryId = galleryId;
  const { data, error } = await sb.from('galleries').select('*').eq('id', galleryId).single();
  if (error || !data) { toast('Erro ao carregar galeria', 'error'); return; }

  document.getElementById('set-name').value     = data.name || '';
  document.getElementById('set-date').value     = data.date || '';
  document.getElementById('set-location').value = data.location || '';
  document.getElementById('set-password').value = '';
  document.getElementById('set-password').placeholder = data.password_hash ? 'Senha definida (deixe vazio para manter)' : 'Ex: evento2024';
  document.getElementById('set-expires').value  = data.expires_at
    ? data.expires_at.slice(0,16) : '';

  setToggle('set-download',  data.download_enabled !== false);
  setToggle('set-watermark', data.watermark === true);
  setToggle('set-status',    data.status === 'live');
  setToggle('set-facial-recognition', data.facial_recognition_enabled !== false);
  setToggle('set-full-url-delivery', data.full_url_delivery_disabled !== true);
  document.getElementById('set-price').value = data.price_cents ? (data.price_cents / 100) : '';
  loadFaceIndexInfo(galleryId);
  document.getElementById('face-index-status').textContent = '';

  empty.style.display = 'none';
  form.style.display  = 'block';
}

function setToggle(id, on) {
  const btn = document.getElementById(id);
  btn.dataset.on = on ? 'true' : 'false';
}

function toggleDownload() {
  const btn = document.getElementById('set-download');
  btn.dataset.on = btn.dataset.on === 'true' ? 'false' : 'true';
}

function toggleStatus() {
  const btn = document.getElementById('set-status');
  btn.dataset.on = btn.dataset.on === 'true' ? 'false' : 'true';
}

function toggleWatermark() {
  const btn = document.getElementById('set-watermark');
  btn.dataset.on = btn.dataset.on === 'true' ? 'false' : 'true';
}

function toggleFacialRecognition() {
  const btn = document.getElementById('set-facial-recognition');
  btn.dataset.on = btn.dataset.on === 'true' ? 'false' : 'true';
}

function toggleFullUrlDelivery() {
  const btn = document.getElementById('set-full-url-delivery');
  btn.dataset.on = btn.dataset.on === 'true' ? 'false' : 'true';
}

async function saveGallerySettings() {
  if (!currentSettingsGalleryId) return;
  const expiresRaw = document.getElementById('set-expires').value;
  const pwRaw = document.getElementById('set-password').value.trim();
  const payload = {
    name:             document.getElementById('set-name').value.trim(),
    date:             document.getElementById('set-date').value || null,
    location:         document.getElementById('set-location').value.trim() || null,
    expires_at:       expiresRaw ? new Date(expiresRaw).toISOString() : null,
    download_enabled: document.getElementById('set-download').dataset.on === 'true',
    watermark:        document.getElementById('set-watermark').dataset.on === 'true',
    paywall_enabled:  document.getElementById('set-watermark').dataset.on === 'true',
    price_cents:      Math.max(0, Math.round((parseFloat(document.getElementById('set-price').value) || 0) * 100)),
    status:           document.getElementById('set-status').dataset.on === 'true' ? 'live' : 'draft',
    facial_recognition_enabled: document.getElementById('set-facial-recognition').dataset.on === 'true',
    full_url_delivery_disabled: document.getElementById('set-full-url-delivery').dataset.on === 'false'
  };
  if (pwRaw) {
    payload.password_hash = await hashSHA256(pwRaw);
  }
  const { error } = await sb.from('galleries').update(payload).eq('id', currentSettingsGalleryId);
  if (error) { toast('Erro ao salvar: ' + error.message, 'error'); return; }
  logAdminAction('save_gallery_settings', {
    galleryId: currentSettingsGalleryId, name: payload.name, watermark: payload.watermark,
    price_cents: payload.price_cents, status: payload.status,
    password_changed: !!pwRaw, download_enabled: payload.download_enabled,
    facial_recognition_enabled: payload.facial_recognition_enabled,
    full_url_delivery_disabled: payload.full_url_delivery_disabled
  });
  toast('Configurações salvas!', 'success');
  const g = galleries.find(g => g.id === currentSettingsGalleryId);
  if (g) Object.assign(g, payload);
}
