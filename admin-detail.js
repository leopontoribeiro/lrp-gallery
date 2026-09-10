// ── DETAIL + GRUPOS(admin) + COVER EDITOR + SETTINGS ──
// Extraído de admin.html (fatia de modularização). Depende de globals do
// script principal (sb, toast, signPhotos, BASE_URL, currentGalleryId,
// currentGalleryCoverPhotoId, coverEditorPhotoId, coverEditorPosX,
// coverEditorPosY, galleries, goTo, hashSHA256, loadFaceIndexInfo) —
// só usados dentro das funções.

// Busca todas as fotos paginando (contorna o teto de 1000 do PostgREST — funciona com 1500+)
async function fetchGalleryPhotos(galleryId) {
  let all = [], from = 0;
  while (true) {
    const { data: rows, error } = await sb.from('photos')
      .select('id, filename, storage_path, thumb_url, full_url, position, group_name, taken_at')
      // Mesma ordem que o cliente vê (get_public_photos, migração 39):
      // taken_at (EXIF) manda, position é só o desempate de quem não tem EXIF.
      .eq('gallery_id', galleryId)
      .order('taken_at', { ascending: true, nullsFirst: false })
      .order('position', { ascending: true })
      .range(from, from + 499);
    if (error) throw error;
    if (!rows?.length) break;
    all = all.concat(rows);
    if (rows.length < 500) break;
    from += 500;
  }
  return all;
}

// Mesmo critério do ORDER BY de fetchGalleryPhotos/get_public_photos —
// usado depois que g.photos já está em memória (evita repetir a query).
function _byTakenThenPosition(a, b) {
  if (a.taken_at && b.taken_at) return a.taken_at < b.taken_at ? -1 : a.taken_at > b.taken_at ? 1 : a.position - b.position;
  if (a.taken_at) return -1;
  if (b.taken_at) return 1;
  return a.position - b.position;
}

async function openDetail(id) {
  const { data: g, error } = await sb
    .from('galleries').select('*').eq('id', id).single();

  if(error || !g) { toast('Erro ao carregar galeria', 'error'); return; }
  try { g.photos = await fetchGalleryPhotos(id); await signPhotos(g.photos); }
  catch(e) { toast('Erro ao carregar fotos: ' + e.message, 'error'); return; }

  currentGalleryId = id;
  currentGalleryGroupId = g.gallery_group_id || null;
  const link = `${BASE_URL}/gallery.html?t=${g.access_token}`;

  document.getElementById('detail-title').textContent = g.name.toUpperCase();
  document.getElementById('detail-meta').textContent = `${g.date||'—'} · ${g.location||'—'} · ${new Date(g.created_at).toLocaleDateString('pt-BR')}`;
  document.getElementById('detail-link').textContent = link;
  g._link = link;
  renderResLinks(g);
  renderDetailPassword(g);

  g.photos?.sort(_byTakenThenPosition);
  renderDetailPhotos(g);
  goTo('detail');
  document.getElementById('topbar-title').textContent = g.name.toUpperCase();

  // O escaneamento de rostos é sob demanda (botão "Escanear rostos") —
  // aqui só atualizamos o rótulo com quantas fotos ainda faltam.
  if (typeof refreshDetailFacesBtn === 'function') refreshDetailFacesBtn(id);
  if (typeof loadGalleryVideos === 'function') loadGalleryVideos(id);
}

function makeDetailPhotoEl(photo) {
  const isCover = photo.id === currentGalleryCoverPhotoId;
  const div = document.createElement('div');
  div.className = 'detail-photo' + (isCover ? ' is-cover' : '') +
                  (groupSelection.has(String(photo.id)) ? ' selected' : '');
  div.dataset.id = photo.id;
  div.draggable = reorderMode;
  div.innerHTML = `
    <img src="${photo.thumb_url}" alt="${esc(photo.filename)}" loading="lazy">
    ${photo.group_name ? `<span class="detail-photo-group">${esc(parseTags(photo.group_name).join(' · '))}</span>` : ''}
    <button class="detail-photo-cover" data-full="${esc(photo.full_url)}" onclick="openCoverEditor('${photo.id}', this.dataset.full, event)" title="${isCover ? 'Capa atual — clique para reposicionar' : 'Definir como capa'}">
      <svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
    </button>
    <button class="detail-photo-del" onclick="deletePhoto('${photo.id}','${photo.storage_path}')" title="Remover">
      <svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button>
  `;
  // Arrastar-para-reordenar (só ativo em modo reordenar — ver toggleReorderMode).
  // Move o próprio elemento no DOM a cada dragover; nada é salvo no banco até
  // "Salvar ordem" (saveReorderedPositions), então Cancelar é só re-renderizar.
  div.addEventListener('dragstart', (e) => {
    if (!reorderMode) return;
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', String(photo.id)); } catch (err) {}
    div.classList.add('dragging');
    _reorderTouched.add(String(photo.id));
  });
  div.addEventListener('dragend', () => {
    div.classList.remove('dragging');
    document.querySelectorAll('.detail-photo.drag-over').forEach(el => el.classList.remove('drag-over'));
  });
  div.addEventListener('dragover', (e) => {
    if (!reorderMode) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const dragging = document.querySelector('.detail-photo.dragging');
    if (!dragging || dragging === div) return;
    div.classList.add('drag-over');
    const rect = div.getBoundingClientRect();
    const before = (e.clientX - rect.left) < rect.width / 2;
    document.getElementById('detail-grid').insertBefore(dragging, before ? div : div.nextSibling);
    _reorderDirty = true;
  });
  div.addEventListener('dragleave', () => div.classList.remove('drag-over'));
  div.addEventListener('drop', (e) => {
    if (!reorderMode) return;
    e.preventDefault();
    div.classList.remove('drag-over');
  });
  div.addEventListener('click', (e) => {
    if (!groupMode) return;
    e.stopPropagation();
    e.preventDefault();
    const key = String(photo.id);
    const idx = _detailPhotoIds.indexOf(key);
    // Shift+clique: seleciona (marca) todo o intervalo entre a última foto
    // clicada e esta — igual ao Finder/Explorer.
    if (e.shiftKey && _lastSelIndex >= 0 && idx >= 0) {
      const [a, b] = _lastSelIndex < idx ? [_lastSelIndex, idx] : [idx, _lastSelIndex];
      for (let i = a; i <= b; i++) groupSelection.add(_detailPhotoIds[i]);
    } else {
      if (groupSelection.has(key)) groupSelection.delete(key);
      else groupSelection.add(key);
      _lastSelIndex = idx;
    }
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
  _detailPhotoIds = photos.map(p => String(p.id)); // ordem p/ Shift-range
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

  // Sugestões de grupos existentes no datalist (uma foto pode ter várias etiquetas)
  const names = [...new Set(photos.flatMap(p => parseTags(p.group_name)))];
  document.getElementById('group-names').innerHTML = names.map(n => `<option value="${esc(n)}">`).join('');
}

// ── GRUPOS (admin) ──
let groupMode = false;
const groupSelection = new Set();
let _detailPhotoIds = [];   // ordem atual das fotos (p/ seleção por Shift)
let _lastSelIndex = -1;     // índice da última foto clicada (âncora do Shift)

// ── REORDENAR (arrastar-e-soltar) ──
let reorderMode = false;
let _reorderDirty = false;  // true assim que alguma foto foi arrastada nesta sessão de reordenação
let _reorderTouched = new Set(); // ids realmente soltos em outro lugar (não os que só deslizaram por tabela)

async function toggleReorderMode() {
  if (!reorderMode) {
    if (groupMode) toggleGroupMode(); // os dois modos mexem no clique da foto — não rolam juntos
    reorderMode = true;
    _reorderTouched = new Set();
    document.getElementById('reorder-bar').style.display = 'flex';
    document.getElementById('detail-grid').classList.add('reorder-mode');
    document.getElementById('btnReorderMode').classList.add('btn-primary');
    document.querySelectorAll('.detail-photo').forEach(el => { el.draggable = true; });
  } else {
    if (_reorderDirty && !(await showConfirmModal('Descartar a nova ordem sem salvar?'))) return;
    cancelReorder();
  }
}

// Descarta o arraste e recarrega a galeria do banco (mesmo padrão usado no
// resto do arquivo — ex.: deletePhoto — pra voltar a um estado conhecido em
// vez de tentar reconstruir a ordem salva a partir de memória local).
function cancelReorder() {
  reorderMode = false;
  _reorderDirty = false;
  _reorderTouched = new Set();
  document.getElementById('reorder-bar').style.display = 'none';
  document.getElementById('detail-grid').classList.remove('reorder-mode');
  document.getElementById('btnReorderMode').classList.remove('btn-primary');
  openDetail(currentGalleryId);
}

// Lê a ordem atual do DOM, compara com a position gravada agora no banco e
// manda só o que mudou (UPDATE direto — não a RPC batch_update_photo_positions,
// que existe no banco mas nunca teve grant/uso; ver migração 36).
async function saveReorderedPositions() {
  const domIds = Array.from(document.querySelectorAll('#detail-grid .detail-photo')).map(el => el.dataset.id);
  if (!domIds.length) { cancelReorder(); return; }

  // Busca já na mesma ordem que o cliente vê (taken_at manda, position desempata).
  const { data: rows, error: fetchErr } = await sb.from('photos')
    .select('id, position, taken_at').eq('gallery_id', currentGalleryId)
    .order('taken_at', { ascending: true, nullsFirst: false })
    .order('position', { ascending: true });
  if (fetchErr) { toast('Erro ao conferir a ordem atual: ' + fetchErr.message, 'error'); return; }
  const byId = new Map(rows.map(r => [String(r.id), r]));
  const curOrderIds = rows.map(r => String(r.id));

  // position: renumera 0..N-1 na ordem final — fica como desempate/fallback
  // pras fotos sem EXIF (nulls last no ORDER BY).
  const patches = new Map();
  domIds.forEach((id, i) => {
    if (curOrderIds[i] !== id) patches.set(id, { id, position: i });
  });

  // taken_at: só pras fotos que você REALMENTE arrastou (_reorderTouched) —
  // ganham um horário sintético entre os novos vizinhos, pra valer de
  // verdade na ordenação (que agora prioriza taken_at sobre position). As
  // fotos que só deslizaram de lugar por causa do arraste de outra mantêm
  // a data EXIF real que já tinham.
  const effectiveTime = (id) => { const r = byId.get(id); return r?.taken_at ? new Date(r.taken_at).getTime() : null; };
  for (const id of _reorderTouched) {
    if (!byId.has(id)) continue;
    const idx = domIds.indexOf(id);
    if (idx === -1) continue;
    let before = null, after = null;
    for (let i = idx - 1; i >= 0 && before === null; i--) before = effectiveTime(domIds[i]);
    for (let i = idx + 1; i < domIds.length && after === null; i++) after = effectiveTime(domIds[i]);
    const t = (before !== null && after !== null) ? before + (after - before) / 2
            : before !== null ? before + 1000
            : after !== null ? after - 1000
            : Date.now();
    patches.set(id, { ...(patches.get(id) || { id }), taken_at: new Date(t).toISOString() });
  }

  if (!patches.size) { toast('A ordem já estava assim', ''); cancelReorder(); return; }

  const btn = document.getElementById('reorder-save-btn');
  btn.disabled = true; btn.textContent = 'Salvando...';
  try {
    // UPDATE direto na tabela (mesmo padrão do resto do admin — a policy
    // auth_all_photos já libera authenticated pra isso). Em lotes de 20 em
    // paralelo pra não abrir uma conexão por foto de uma vez só.
    const updates = [...patches.values()];
    for (let i = 0; i < updates.length; i += 20) {
      const batch = updates.slice(i, i + 20);
      const results = await Promise.all(batch.map(u => {
        const patch = {};
        if (u.position !== undefined) patch.position = u.position;
        if (u.taken_at !== undefined) patch.taken_at = u.taken_at;
        return sb.from('photos').update(patch).eq('id', u.id);
      }));
      const failed = results.find(r => r.error);
      if (failed) throw failed.error;
    }
    logAdminAction('reorder_photos', { galleryId: currentGalleryId, count: updates.length });
    toast(`Ordem salva — ${updates.length} foto(s) atualizada(s)`, 'success');
    reorderMode = false; _reorderDirty = false; _reorderTouched = new Set();
    document.getElementById('reorder-bar').style.display = 'none';
    document.getElementById('detail-grid').classList.remove('reorder-mode');
    document.getElementById('btnReorderMode').classList.remove('btn-primary');
    document.querySelectorAll('.detail-photo').forEach(el => { el.draggable = false; });
    openDetail(currentGalleryId); // recarrega já na ordem nova, confirmada pelo banco
  } catch (e) {
    console.error('saveReorderedPositions:', e);
    toast('Erro ao salvar ordem: ' + (e.message || e), 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Salvar ordem';
  }
}

async function toggleGroupMode() {
  if (!groupMode && reorderMode) {
    if (_reorderDirty && !(await showConfirmModal('Descartar a nova ordem sem salvar?'))) return;
    cancelReorder();
  }
  groupMode = !groupMode;
  groupSelection.clear();
  _lastSelIndex = -1;
  document.getElementById('group-bar').style.display = groupMode ? 'flex' : 'none';
  document.getElementById('btnGroupMode').classList.toggle('btn-primary', groupMode);
  updateGroupBar();
  if (!groupMode) openDetail(currentGalleryId);
  else toast('Clique para selecionar · Shift+clique marca o intervalo', '');
}

// Selecionar todas / limpar (botão da barra de grupos)
function toggleSelectAllPhotos() {
  if (groupSelection.size === _detailPhotoIds.length) groupSelection.clear();
  else _detailPhotoIds.forEach(id => groupSelection.add(id));
  _lastSelIndex = -1;
  updateGroupBar();
}

function updateGroupBar() {
  document.getElementById('group-sel-count').textContent = `${groupSelection.size} SELECIONADAS`;
  const btnAll = document.getElementById('group-select-all');
  if (btnAll) btnAll.textContent = (groupSelection.size === _detailPhotoIds.length && _detailPhotoIds.length)
    ? 'Limpar seleção' : 'Selecionar todas';
  document.querySelectorAll('.detail-photo').forEach(d =>
    d.classList.toggle('selected', groupSelection.has(d.dataset.id)));
}

// Uma foto pode ter várias etiquetas (parseTags/joinTags, gallery-utils.js) —
// "Aplicar" ADICIONA a etiqueta à lista da foto (não apaga as outras que já
// tinha); "Remover" tira só essa etiqueta específica, mantendo o resto.
async function applyGroup(remove = false) {
  if (!groupSelection.size) { toast('Selecione fotos primeiro', 'error'); return; }
  const name = document.getElementById('group-name-input').value.trim();
  if (!name) { toast('Digite o nome do grupo', 'error'); return; }
  const ids = [...groupSelection];
  const { data: rows, error: selErr } = await sb.from('photos').select('id,group_name').in('id', ids);
  if (selErr) { toast('Erro: ' + selErr.message, 'error'); return; }
  for (const r of rows) {
    const tags = parseTags(r.group_name);
    const next = remove ? tags.filter(t => t !== name) : (tags.includes(name) ? tags : [...tags, name]);
    await sb.from('photos').update({ group_name: joinTags(next) || null }).eq('id', r.id);
  }
  toast(remove ? `Etiqueta "${name}" removida de ${ids.length} foto(s)` : `"${name}" adicionada a ${ids.length} foto(s)`, 'success');
  groupSelection.clear();
  // Recarrega mantendo o modo grupos ativo
  const { data: g } = await sb.from('galleries').select('*').eq('id', currentGalleryId).single();
  if (g) {
    try { g.photos = await fetchGalleryPhotos(currentGalleryId); await signPhotos(g.photos); } catch(e) { g.photos = []; }
    g.photos.sort(_byTakenThenPosition);
    renderDetailPhotos(g);
  }
  updateGroupBar();
}

// Renomeia o grupo (etiqueta) em TODAS as fotos que o têm — não precisa selecionar.
// Usa o nome digitado/escolhido no campo de grupo como o grupo a renomear.
async function renamePhotoGroup() {
  const oldName = document.getElementById('group-name-input').value.trim();
  if (!oldName) { toast('Digite (ou escolha) o nome do grupo a renomear', 'error'); return; }
  const newName = prompt(`Novo nome para o grupo "${oldName}":`, oldName);
  if (newName == null) return;
  const clean = newName.trim();
  if (!clean || clean === oldName) return;
  // group_name pode ter várias etiquetas — busca por substring (over-fetch)
  // e confere/reescreve a lista de cada foto certinha no cliente.
  const { data: rows, error } = await sb.from('photos').select('id,group_name')
    .eq('gallery_id', currentGalleryId).ilike('group_name', `%${oldName}%`);
  if (error) { toast('Erro: ' + error.message, 'error'); return; }
  let count = 0;
  for (const r of (rows || [])) {
    const tags = parseTags(r.group_name);
    if (!tags.includes(oldName)) continue;
    await sb.from('photos').update({ group_name: joinTags(tags.map(t => t === oldName ? clean : t)) }).eq('id', r.id);
    count++;
  }
  toast(`Grupo "${oldName}" → "${clean}" (${count} foto(s))`, 'success');
  document.getElementById('group-name-input').value = '';
  openDetail(currentGalleryId);
}

// ── Ações em lote (modo grupos): apagar e renomear ──
async function deleteSelectedPhotos() {
  if (!groupSelection.size) { toast('Selecione fotos primeiro', 'error'); return; }
  const ids = [...groupSelection];
  const ok = await showConfirmModal(`Apagar ${ids.length} foto(s) selecionada(s)? Essa ação não pode ser desfeita.`);
  if (!ok) return;

  const { data: rows } = await sb.from('photos').select('id,storage_path').in('id', ids);
  for (const r of (rows || [])) {
    if (r.storage_path) {
      await _deleteR2(r.storage_path);
      await _deleteR2(`${r.storage_path}_thumb.webp`);
    }
  }
  const { error } = await sb.from('photos').delete().in('id', ids);
  if (error) { toast('Erro ao apagar: ' + error.message, 'error'); return; }
  logAdminAction('bulk_delete_photos', { galleryId: currentGalleryId, count: ids.length });
  toast(`${ids.length} foto(s) apagada(s)`, 'error');
  groupSelection.clear();
  openDetail(currentGalleryId);
}

// Apaga fotos com filename repetido, mantendo 1 por nome. Prioridade pra
// ficar: quem tem etiqueta de grupo; se as duplicatas empatam nisso
// (nenhuma ou ambas com etiqueta), fica a de posição mais alta (a "segunda").
async function removeDuplicatePhotos() {
  if (!currentGalleryId) return;
  const { data: gal } = await sb.from('galleries').select('cover_photo_id').eq('id', currentGalleryId).maybeSingle();
  const { data: photos, error } = await sb.from('photos')
    .select('id,filename,storage_path,group_name,position')
    .eq('gallery_id', currentGalleryId).order('position', { ascending: true });
  if (error) { toast('Erro: ' + error.message, 'error'); return; }

  // Map (não objeto): evita colisão com nomes tipo "constructor"/"toString".
  // Ignora filename vazio/nulo — não dá pra saber se são "o mesmo nome" de verdade.
  const byName = new Map();
  (photos || []).forEach(p => {
    if (!p.filename) return;
    if (!byName.has(p.filename)) byName.set(p.filename, []);
    byName.get(p.filename).push(p);
  });
  const toDelete = [];
  let newCover = null;
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    let keep = group[0];
    for (const cur of group.slice(1)) {
      const curTagged = !!cur.group_name, keepTagged = !!keep.group_name;
      if (curTagged || !keepTagged) keep = cur; // tag ganha; empate = fica o de posição maior (mais recente no loop)
    }
    group.forEach(p => {
      if (p.id === keep.id) return;
      toDelete.push(p);
      if (gal && gal.cover_photo_id === p.id) newCover = keep.id; // capa era uma duplicata apagada
    });
  }
  if (!toDelete.length) { toast('Nenhuma foto duplicada encontrada', ''); return; }

  const ok = await showConfirmModal(`${toDelete.length} foto(s) duplicada(s) encontrada(s). Apagar, mantendo só 1 de cada nome?`);
  if (!ok) return;

  for (const p of toDelete) {
    if (p.storage_path) { await _deleteR2(p.storage_path); await _deleteR2(`${p.storage_path}_thumb.webp`); }
  }
  const { error: delErr } = await sb.from('photos').delete().in('id', toDelete.map(p => p.id));
  if (delErr) { toast('Erro ao apagar: ' + delErr.message, 'error'); return; }
  if (newCover) await sb.from('galleries').update({ cover_photo_id: newCover }).eq('id', currentGalleryId);
  logAdminAction('remove_duplicate_photos', { galleryId: currentGalleryId, count: toDelete.length });
  toast(`${toDelete.length} duplicada(s) apagada(s)`, 'success');
  openDetail(currentGalleryId);
}

// Renomeia em sequência (ordem de posição), preservando a extensão original de cada arquivo.
async function _renamePhotoRows(rows, base) {
  if (!rows.length) return 0;
  const pad = Math.max(3, String(rows.length).length);
  let n = 1, ok = 0;
  for (const r of rows) {
    const ext = (r.filename.match(/\.[a-zA-Z0-9]+$/) || [''])[0];
    const newName = `${base} ${String(n).padStart(pad, '0')}${ext}`;
    const { error } = await sb.from('photos').update({ filename: newName }).eq('id', r.id);
    if (!error) ok++;
    n++;
  }
  return ok;
}

async function renameSelectedPhotos() {
  if (!groupSelection.size) { toast('Selecione fotos primeiro', 'error'); return; }
  const base = prompt(`Novo nome-base para as ${groupSelection.size} foto(s) selecionada(s) (ex: "Cerimônia"):`, '');
  if (base == null) return;
  const clean = base.trim();
  if (!clean) { toast('Nome vazio', 'error'); return; }

  const { data: rows } = await sb.from('photos').select('id,filename,position')
    .in('id', [...groupSelection]).order('position', { ascending: true });
  const ok = await _renamePhotoRows(rows || [], clean);
  logAdminAction('rename_photos', { galleryId: currentGalleryId, count: ok, scope: 'selected' });
  toast(`${ok} foto(s) renomeada(s)`, 'success');
  groupSelection.clear();
  openDetail(currentGalleryId);
}

async function renameAllPhotos() {
  if (!currentGalleryId) return;
  const base = prompt('Novo nome-base para TODAS as fotos desta galeria (ex: "Casamento"):', '');
  if (base == null) return;
  const clean = base.trim();
  if (!clean) { toast('Nome vazio', 'error'); return; }
  const ok = await showConfirmModal(`Renomear TODAS as fotos desta galeria para "${clean} 001", "${clean} 002"...?`);
  if (!ok) return;

  const { data: rows } = await sb.from('photos').select('id,filename,position')
    .eq('gallery_id', currentGalleryId).order('position', { ascending: true });
  const done = await _renamePhotoRows(rows || [], clean);
  logAdminAction('rename_photos', { galleryId: currentGalleryId, count: done, scope: 'all' });
  toast(`${done} foto(s) renomeada(s)`, 'success');
  openDetail(currentGalleryId);
}

// Mesmo padrão de barra de progresso da tela "Nova Galeria" (.upload-item +
// setProgress, admin-galleries.js) — reaproveitado aqui em vez de um toast
// mudo, que não dava nenhum feedback de evolução durante o envio.
async function addPhotosToDetail(files) {
  if(!currentGalleryId) return;
  resetDupePolicy();
  const fileArr = Array.from(files);
  if (!fileArr.length) return;

  const list = document.getElementById('detail-upload-list');
  list.innerHTML = '';
  document.getElementById('detail-upload-continue')?.remove();
  const items = fileArr.map(file => {
    const id = Date.now() + Math.random();
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
    return { id, file, done: false };
  });

  await _runUploadBatch(items, list);
}

// Roda (ou retoma) um lote: pula quem já subiu (done=true) e, se o upload de
// algum arquivo falhar (rede caiu, arquivo corrompido etc.), não derruba o
// lote inteiro — segue pros próximos e deixa o botão "Continuar" reenviar só
// os que faltaram. uploadGalleryPhoto já detecta nome+tamanho repetido e não
// reenvia à toa, então retomar depois de fechar a aba também funciona.
async function _runUploadBatch(items, list) {
  const { data: existing } = await sb.from('photos').select('position').eq('gallery_id', currentGalleryId).order('position', {ascending: false}).limit(1);
  let pos = (existing?.[0]?.position ?? -1) + 1;

  let ok = 0, failed = 0;
  for (const it of items) {
    if (it.done) { ok++; continue; }
    setProgress(it.id, 30);
    let photoId = null;
    try { photoId = await uploadGalleryPhoto(it.file, currentGalleryId, pos++); }
    catch (e) { console.error('addPhotosToDetail:', e); }
    setProgress(it.id, 100, !!photoId, !photoId);
    if (photoId) { it.done = true; ok++; } else { failed++; }
  }

  document.getElementById('detail-upload-continue')?.remove();

  if (failed > 0) {
    toast(`${ok} de ${items.length} enviada(s) — ${failed} falharam.`, 'error');
    const btn = document.createElement('button');
    btn.id = 'detail-upload-continue';
    btn.className = 'btn btn-primary';
    btn.style.marginTop = '10px';
    btn.textContent = `Continuar envio (${failed} restante${failed > 1 ? 's' : ''})`;
    btn.onclick = () => { btn.remove(); _runUploadBatch(items, list); };
    list.insertAdjacentElement('afterend', btn);
    return;
  }

  toast(`${ok} de ${items.length} foto(s) adicionada(s)!`, 'success');
  if (typeof refreshDetailFacesBtn === 'function') refreshDetailFacesBtn(currentGalleryId);
  setTimeout(() => { list.innerHTML = ''; openDetail(currentGalleryId); }, 600);
}

// Envia uma foto nova e já define como capa (usa uploadGalleryPhoto, de admin-galleries.js).
async function addCoverToDetail(file) {
  if (!currentGalleryId || !file) return;
  toast('Enviando capa...', '');
  const { data: existing } = await sb.from('photos').select('position')
    .eq('gallery_id', currentGalleryId).order('position', { ascending: false }).limit(1);
  const pos = (existing?.[0]?.position ?? -1) + 1;

  const photoId = await uploadGalleryPhoto(file, currentGalleryId, pos);
  if (!photoId) { toast('Erro ao enviar a capa', 'error'); return; }

  const { error } = await sb.from('galleries')
    .update({ cover_photo_id: photoId, cover_position_x: 50, cover_position_y: 50 }).eq('id', currentGalleryId);
  if (error) { toast('Erro ao definir capa: ' + error.message, 'error'); return; }

  const g = galleries.find(g => g.id === currentGalleryId);
  if (g) { g.cover_photo_id = photoId; g.cover_position_x = 50; g.cover_position_y = 50; }

  toast('Capa definida!', 'success');
  if (typeof refreshDetailFacesBtn === 'function') refreshDetailFacesBtn(currentGalleryId);
  openDetail(currentGalleryId);
}

async function deletePhoto(photoId, storagePath) {
  // Fotos vivem no R2 (worker lrp-gallery-signed), não mais no Supabase Storage.
  if (storagePath) {
    await _deleteR2(storagePath);
    await _deleteR2(`${storagePath}_thumb.webp`);
  }
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

// Mesmo modal, com 3 saídas — usado quando o upload encontra um nome repetido.
// Reaproveita #confirm-ok/#confirm-cancel (textos trocados) + o botão extra.
function showDupeChoice(msg) {
  return new Promise(resolve => {
    const modal = document.getElementById('confirm-modal');
    const ok = document.getElementById('confirm-ok'), cancel = document.getElementById('confirm-cancel'), extra = document.getElementById('confirm-extra');
    document.getElementById('confirm-msg').textContent = msg;
    ok.textContent = 'Substituir'; cancel.textContent = 'Manter as duas'; extra.style.display = '';
    modal.classList.add('open');
    const close = (val) => {
      modal.classList.remove('open'); extra.style.display = 'none';
      ok.textContent = 'Excluir'; cancel.textContent = 'Cancelar'; // devolve o modal ao estado padrão
      resolve(val);
    };
    ok.addEventListener('click', () => close('replace'), { once: true });
    extra.addEventListener('click', () => close('replace-all'), { once: true });
    cancel.addEventListener('click', () => close('keep'), { once: true });
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

// ── LINKS EXTERNOS (fotos em alta/baixa — ex.: Google Drive) ──
function renderResLinks(g) {
  _setResLinkRow('high', g.high_res_url || null);
  _setResLinkRow('low', g.low_res_url || null);
}
function _setResLinkRow(kind, url) {
  const prefix = kind === 'high' ? 'detail-link-hi' : 'detail-link-lo';
  document.getElementById(prefix).textContent = url || '— não definido —';
  document.getElementById(prefix + '-qr').style.display = url ? 'inline-flex' : 'none';
  document.getElementById(prefix + '-del').style.display = url ? 'inline-flex' : 'none';
}
async function setResLink(kind) {
  if (!currentGalleryId) return;
  const col = kind === 'high' ? 'high_res_url' : 'low_res_url';
  const cur = document.getElementById(kind === 'high' ? 'detail-link-hi' : 'detail-link-lo').textContent;
  const url = prompt(`Cole o link do Google Drive (fotos em ${kind === 'high' ? 'alta' : 'baixa'}):`, cur === '— não definido —' ? '' : cur);
  if (url == null) return;
  const clean = url.trim();
  const { error } = await sb.from('galleries').update({ [col]: clean || null }).eq('id', currentGalleryId);
  if (error) { toast('Erro ao salvar: ' + error.message, 'error'); return; }
  _setResLinkRow(kind, clean || null);
  toast('Link salvo', 'success');
}
async function clearResLink(kind) {
  if (!currentGalleryId) return;
  const col = kind === 'high' ? 'high_res_url' : 'low_res_url';
  const { error } = await sb.from('galleries').update({ [col]: null }).eq('id', currentGalleryId);
  if (error) { toast('Erro ao apagar: ' + error.message, 'error'); return; }
  _setResLinkRow(kind, null);
  toast('Link removido', '');
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
  if (typeof refreshErrorLog === 'function') refreshErrorLog();
  const sel = document.getElementById('settings-gallery-select');
  sel.innerHTML = '<option value="">Selecione uma galeria</option>';
  sortByCreatedDesc(galleries).forEach(g => {
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

// ── Senha do álbum, direto no detalhe da galeria ────────────
// Antes só existia em Configurações, que obriga a escolher a galeria de novo
// mesmo já estando dentro de uma. Resultado: ninguém achava, e não dava para
// saber se um álbum estava protegido sem abrir a tela e olhar o placeholder.
function renderDetailPassword(g) {
  const status = document.getElementById('detail-pw-status');
  const clear  = document.getElementById('detail-pw-clear');
  const input  = document.getElementById('detail-pw-input');
  if (!status) return;
  const tem = !!g.password_hash;
  status.textContent = tem ? '🔒 Protegido' : 'Sem senha — qualquer um com o link abre';
  status.style.color = tem ? 'var(--text)' : 'var(--muted)';
  if (clear) clear.style.display = tem ? '' : 'none';
  if (input) { input.value = ''; input.placeholder = tem ? 'Digite para trocar' : 'Digite a senha'; }
}

async function saveDetailPassword() {
  const input = document.getElementById('detail-pw-input');
  const raw = (input.value || '').trim();
  if (!raw) { toast('Digite uma senha', 'error'); return; }
  if (raw.length < 4) { toast('Use pelo menos 4 caracteres', 'error'); return; }
  const hash = await hashSHA256(raw);
  const { error } = await sb.from('galleries')
    .update({ password_hash: hash }).eq('id', currentGalleryId);
  if (error) { toast('Erro ao salvar: ' + error.message, 'error'); return; }
  const g = galleries.find(x => x.id === currentGalleryId);
  if (g) { g.password_hash = hash; renderDetailPassword(g); }
  if (typeof renderDashboard === 'function') renderDashboard();
  toast('Senha definida. O cliente vai precisar dela para abrir.', 'success');
}

async function clearDetailPassword() {
  const ok = await showConfirmModal('Remover a senha? Qualquer pessoa com o link passa a abrir o álbum.');
  if (!ok) return;
  const { error } = await sb.from('galleries')
    .update({ password_hash: null }).eq('id', currentGalleryId);
  if (error) { toast('Erro ao remover: ' + error.message, 'error'); return; }
  const g = galleries.find(x => x.id === currentGalleryId);
  if (g) { g.password_hash = null; renderDetailPassword(g); }
  if (typeof renderDashboard === 'function') renderDashboard();
  toast('Senha removida.', 'success');
}
