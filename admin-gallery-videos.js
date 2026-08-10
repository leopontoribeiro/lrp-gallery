// ── VÍDEOS DA GALERIA (múltiplos, com cards) ──
// Diferente do vídeo único do GRUPO (admin-groups-clean.js): aqui cada
// galeria pode ter vários vídeos, cada um com nome/capa/tamanho/duração
// próprios — tabela gallery_videos. Depende de globals do admin: sb, toast,
// esc, BASE_URL, currentGalleryId, _putR2, _deleteR2, showQRForLink.

function _fmtVideoSize(bytes) {
  if (!bytes) return '—';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}
function _fmtVideoDuration(sec) {
  if (!sec) return '—';
  const m = Math.floor(sec / 60), s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

async function loadGalleryVideos(galleryId) {
  const wrap = document.getElementById('detail-videos');
  if (!wrap) return;
  const { data, error } = await sb.from('gallery_videos').select('*').eq('gallery_id', galleryId).order('position');
  if (error) { console.error('loadGalleryVideos:', error); wrap.style.display = 'none'; return; }
  renderVideoCards(data || [], galleryId);
}

function renderVideoCards(videos, galleryId) {
  const wrap = document.getElementById('detail-videos');
  if (!videos.length) { wrap.style.display = 'none'; wrap.innerHTML = ''; return; }
  wrap.style.display = 'grid';
  wrap.innerHTML = videos.map(v => `
    <div style="border:1px solid var(--border);border-radius:10px;overflow:hidden;background:var(--bg)">
      <div style="aspect-ratio:16/9;background:#1c1c1c;position:relative">
        ${v.thumb_url ? `<img src="${esc(v.thumb_url)}" alt="${esc(v.name)}" style="width:100%;height:100%;object-fit:cover;display:block">` : ''}
        <div style="position:absolute;bottom:6px;right:6px;background:rgba(0,0,0,.7);color:#fff;font-size:.6rem;padding:2px 6px;border-radius:4px;font-family:var(--mono)">${_fmtVideoDuration(v.duration_seconds)}</div>
      </div>
      <div style="padding:9px 11px">
        <div style="color:var(--text);font-size:.82rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(v.name)}</div>
        <div style="color:var(--muted);font-size:.64rem;margin-top:2px">${_fmtVideoSize(v.size_bytes)}</div>
      </div>
      <div style="display:flex;gap:4px;flex-wrap:wrap;padding:0 9px 10px">
        <button onclick="showVideoQR('${v.id}')" style="flex:1;min-width:40px;padding:6px 4px;font-size:.6rem;border-radius:6px;cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--text)">QR</button>
        <button onclick="renameGalleryVideo('${v.id}','${esc(v.name).replace(/'/g, "\\'")}')" style="flex:1;min-width:52px;padding:6px 4px;font-size:.6rem;border-radius:6px;cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--text)">Renomear</button>
        <button onclick="changeVideoCoverPick('${v.id}')" style="flex:1;min-width:52px;padding:6px 4px;font-size:.6rem;border-radius:6px;cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--text)">Capa</button>
        <button onclick="deleteGalleryVideo('${v.id}','${esc(v.name).replace(/'/g, "\\'")}')" style="flex:1;min-width:52px;padding:6px 4px;font-size:.6rem;border-radius:6px;cursor:pointer;border:1px solid var(--border);background:transparent;color:#ff8a8a">Apagar</button>
      </div>
    </div>`).join('');
}

function _loadVideoEl(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true; v.src = url;
    v.onloadedmetadata = () => res({ v, url });
    v.onerror = rej;
  });
}
function _grabPoster(videoEl) {
  return new Promise(res => {
    const c = document.createElement('canvas');
    c.width = videoEl.videoWidth; c.height = videoEl.videoHeight;
    c.getContext('2d').drawImage(videoEl, 0, 0);
    c.toBlob(res, 'image/jpeg', 0.85);
  });
}

async function addVideosToDetail(files) {
  if (!currentGalleryId) return;
  const arr = Array.from(files);
  if (!arr.length) return;
  toast(`Enviando ${arr.length} vídeo(s)... isso pode demorar`, '');

  const { data: existing } = await sb.from('gallery_videos').select('position').eq('gallery_id', currentGalleryId).order('position', { ascending: false }).limit(1);
  let pos = (existing?.[0]?.position ?? -1) + 1;

  let ok = 0;
  for (const file of arr) {
    try { await _uploadOneVideo(file, currentGalleryId, pos++); ok++; }
    catch (e) { console.error('addVideosToDetail:', e); }
  }
  toast(`${ok} de ${arr.length} vídeo(s) adicionado(s)`, ok ? 'success' : 'error');
  loadGalleryVideos(currentGalleryId);
}

async function _uploadOneVideo(file, galleryId, position) {
  const { v: videoEl, url } = await _loadVideoEl(file);
  const duration = videoEl.duration || null;
  videoEl.currentTime = Math.min(1, duration / 2 || 0);
  await new Promise(res => { videoEl.onseeked = res; });
  const posterBlob = await _grabPoster(videoEl);
  URL.revokeObjectURL(url);

  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const baseKey = `galleries/${galleryId}/video_${Date.now()}_${position}_${safe}`;
  const videoUrl = await _putR2(baseKey, file, file.type || 'video/mp4');
  if (!videoUrl) throw new Error('falha no upload do vídeo');
  const thumbUrl = posterBlob ? await _putR2(`${baseKey}_poster.jpg`, posterBlob, 'image/jpeg') : null;

  const name = file.name.replace(/\.[^.]+$/, '');
  const { error } = await sb.from('gallery_videos').insert({
    gallery_id: galleryId, name, video_url: videoUrl, thumb_url: thumbUrl,
    filename: file.name, size_bytes: file.size, duration_seconds: duration, position
  });
  if (error) throw error;
}

async function renameGalleryVideo(id, current) {
  const name = prompt('Novo nome do vídeo:', current);
  if (name == null) return;
  const clean = name.trim();
  if (!clean) { toast('Nome vazio', 'error'); return; }
  const { error } = await sb.from('gallery_videos').update({ name: clean }).eq('id', id);
  if (error) { toast('Erro: ' + error.message, 'error'); return; }
  toast('Vídeo renomeado', 'success');
  loadGalleryVideos(currentGalleryId);
}

async function deleteGalleryVideo(id, name) {
  if (!confirm(`Apagar o vídeo "${name}"? Essa ação não pode ser desfeita.`)) return;
  const { data: v } = await sb.from('gallery_videos').select('video_url,thumb_url').eq('id', id).maybeSingle();
  if (v) {
    const keyOf = (u) => u ? u.split('?')[0].replace(/^https?:\/\/[^/]+\//, '') : null;
    const vk = keyOf(v.video_url), tk = keyOf(v.thumb_url);
    if (vk) await _deleteR2(vk);
    if (tk) await _deleteR2(tk);
  }
  const { error } = await sb.from('gallery_videos').delete().eq('id', id);
  if (error) { toast('Erro ao apagar: ' + error.message, 'error'); return; }
  toast('Vídeo apagado', 'error');
  loadGalleryVideos(currentGalleryId);
}

function changeVideoCoverPick(id) {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'image/*';
  input.onchange = () => { if (input.files[0]) changeVideoCoverSet(id, input.files[0]); };
  input.click();
}
async function changeVideoCoverSet(id, file) {
  toast('Enviando nova capa...', '');
  const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const key = `galleries/${currentGalleryId}/video_poster_${Date.now()}_${safe}`;
  const url = await _putR2(key, file, file.type || 'image/jpeg');
  if (!url) { toast('Erro ao enviar capa', 'error'); return; }
  const { error } = await sb.from('gallery_videos').update({ thumb_url: url }).eq('id', id);
  if (error) { toast('Erro: ' + error.message, 'error'); return; }
  toast('Capa do vídeo atualizada', 'success');
  loadGalleryVideos(currentGalleryId);
}

// QR aponta pro link estável da galeria (nunca expira), com ?v=<id> pra abrir
// direto nesse vídeo — não pro arquivo assinado (que expira em horas).
function showVideoQR(videoId) {
  const g = galleries.find(x => x.id === currentGalleryId);
  if (!g) return;
  showQRForLink(`${BASE_URL}/gallery.html?t=${g.access_token}&v=${videoId}`);
}
