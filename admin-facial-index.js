// ── ÍNDICE FACIAL (Arquitetura A — roda no navegador do admin) ──
// Extraído de admin.html (fatia de modularização). Depende de globals do
// script principal (sb, toast, signUrls, currentSettingsGalleryId) —
// só usados dentro das funções, chamadas após o app carregar, então a
// ordem de carregamento deste arquivo não importa.
let _faceApiAdminReady = false;
function _loadScriptAdmin(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}
async function loadFaceApiAdmin() {
  if (_faceApiAdminReady) return;
  await _loadScriptAdmin('https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/dist/face-api.min.js');
  const M = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model';
  await faceapi.nets.tinyFaceDetector.loadFromUri(M);
  await faceapi.nets.faceLandmark68Net.loadFromUri(M);
  await faceapi.nets.faceRecognitionNet.loadFromUri(M);
  _faceApiAdminReady = true;
}
async function loadFaceIndexInfo(galleryId) {
  const info = document.getElementById('face-index-info');
  if (!info) return;
  info.textContent = '';
  const { data } = await sb.from('face_indexes').select('face_count,photo_count,updated_at').eq('gallery_id', galleryId).maybeSingle();
  if (!data) { info.textContent = 'Nenhum índice gerado ainda.'; return; }
  const { count } = await sb.from('photos').select('id', { count: 'exact', head: true }).eq('gallery_id', galleryId);
  const stale = (count || 0) - (data.photo_count || 0);
  info.innerHTML = `Índice: ${data.face_count} rosto(s) em ${data.photo_count} foto(s) · ${new Date(data.updated_at).toLocaleDateString('pt-BR')}`
    + (stale > 0 ? ` · <b style="color:var(--accent)">${stale} nova(s) sem índice — atualize</b>` : '');
}
function _loadImageEl(url) {
  return new Promise((res, rej) => { const img = new Image(); img.crossOrigin = 'anonymous'; img.onload = () => res(img); img.onerror = rej; img.src = url; });
}
async function generateFaceIndex() {
  if (!currentSettingsGalleryId) return;
  const btn = document.getElementById('face-index-btn');
  const status = document.getElementById('face-index-status');
  const barWrap = document.getElementById('face-index-bar-wrap');
  const bar = document.getElementById('face-index-bar');
  btn.disabled = true; status.textContent = 'Carregando modelos...'; barWrap.style.display = 'block'; bar.style.width = '0';
  try {
    await loadFaceApiAdmin();
    // índice existente (para atualização incremental)
    const { data: existing } = await sb.from('face_indexes').select('data').eq('gallery_id', currentSettingsGalleryId).maybeSingle();
    // Só reaproveita o índice anterior se ele JÁ estiver quantizado (qv=1).
    // Índice antigo (float) é reconstruído do zero, agora quantizado (int8).
    const _prevOk = existing && existing.data && existing.data.qv === 1;
    const prevFaces = _prevOk ? (existing.data.faces || []) : [];
    const alreadyDone = new Set(_prevOk ? (existing.data.photos || []) : []);
    // busca as fotos da galeria (paginado)
    let photos = [], from = 0;
    for (;;) {
      const { data, error } = await sb.from('photos').select('id,thumb_url,full_url')
        .eq('gallery_id', currentSettingsGalleryId).order('position').range(from, from + 499);
      if (error) throw error;
      photos.push(...data);
      if (data.length < 500) break; from += 500;
    }
    if (!photos.length) { status.textContent = 'Sem fotos nesta galeria.'; btn.disabled = false; return; }
    // só processa as que ainda não estão no índice (incremental)
    const todo = photos.filter(p => !alreadyDone.has(p.id));
    if (!todo.length) { status.textContent = 'Índice já atualizado — nenhuma foto nova.'; btn.disabled = false; barWrap.style.display = 'none'; return; }
    const signed = await signUrls(todo.map(p => p.thumb_url || p.full_url));
    const opts = new faceapi.TinyFaceDetectorOptions({ inputSize: 512, scoreThreshold: 0.4 });
    const newFaces = []; const processed = []; let done = 0, withFace = 0;
    const r3 = x => Math.round(x * 1000) / 1000;
    // Quantização do descritor: float -> int8 [-127..127]. ~3x menos dados.
    const q1 = x => Math.max(-127, Math.min(127, Math.round(x * 127)));
    for (let i = 0; i < todo.length; i++) {
      try {
        const img = await _loadImageEl(signed[i]);
        const W = img.naturalWidth || img.width, H = img.naturalHeight || img.height;
        const dets = await faceapi.detectAllFaces(img, opts).withFaceLandmarks().withFaceDescriptors();
        for (const d of dets) {
          const bx = d.detection.box;   // caixa do rosto (px) -> normaliza 0..1 p/ recorte no cliente
          newFaces.push({
            p: todo[i].id,
            d: Array.from(d.descriptor).map(q1),
            b: [r3(bx.x / W), r3(bx.y / H), r3(bx.width / W), r3(bx.height / H)]
          });
        }
        if (dets.length) withFace++;
      } catch (e) { /* pula imagem problemática */ }
      processed.push(todo[i].id);
      done++;
      bar.style.width = (done / todo.length * 100) + '%';
      if (done % 5 === 0 || done === todo.length) status.textContent = `Processando ${done}/${todo.length} · +${newFaces.length} rosto(s)`;
    }
    status.textContent = 'Salvando índice...';
    const faces = prevFaces.concat(newFaces);
    const allPhotos = [...alreadyDone, ...processed];
    const { error } = await sb.from('face_indexes').upsert({
      gallery_id: currentSettingsGalleryId,
      data: { faces, photos: allPhotos, qv: 1, built_at: new Date().toISOString() },
      face_count: faces.length, photo_count: allPhotos.length, updated_at: new Date().toISOString()
    });
    if (error) throw error;
    status.textContent = `Pronto: +${newFaces.length} rosto(s) em ${todo.length} foto(s) novas. Total: ${faces.length} rosto(s).`;
    toast('Índice facial atualizado!', 'success');
    loadFaceIndexInfo(currentSettingsGalleryId);
  } catch (e) {
    status.textContent = 'Erro: ' + (e.message || e);
    toast('Falha ao gerar índice', 'error');
  } finally {
    btn.disabled = false; setTimeout(() => { barWrap.style.display = 'none'; }, 1500);
  }
}
