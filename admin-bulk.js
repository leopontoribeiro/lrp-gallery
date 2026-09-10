// ── PROCESSAR EM LOTE ──
// Converte até ~1500 fotos de tamanhos/formatos diferentes pra JPEG dentro
// de um teto de tamanho (1.2–2MB), renomeando em sequência, e sobe pra uma
// galeria nova (via uploadProcessedPhoto/_putR2, mesma infra de R2 do resto
// do admin) ou empacota tudo num .zip pra baixar (JSZip, já carregado).
// Depende de globals do admin: sb, toast, _putR2 (admin-galleries.js).

let pendingBulkFiles = [];

function handleBulkFolder(fileList) {
  const IMG_RE = /\.(jpe?g|png|webp|gif|tiff?|bmp|avif)$/i;
  const HEIC_RE = /\.hei[cf]$/i;
  const all = Array.from(fileList);
  const imgs = all.filter(f => IMG_RE.test(f.name));
  const heic = all.filter(f => HEIC_RE.test(f.name));
  imgs.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));

  pendingBulkFiles = imgs;
  const countEl = document.getElementById('bulk-file-count');
  let msg = `${imgs.length} foto(s) prontas para processar`;
  if (heic.length) msg += ` · ${heic.length} .heic/.heif ignorada(s) — exporte como JPG antes (Preview → Exportar)`;
  countEl.textContent = imgs.length ? msg : 'Nenhuma foto em formato suportado encontrada.';
  document.getElementById('bulk-start-btn').disabled = imgs.length === 0;
}

function resetBulkForm() {
  pendingBulkFiles = [];
  const nameEl = document.getElementById('bulk-name');
  if (nameEl) nameEl.value = '';
  const countEl = document.getElementById('bulk-file-count');
  if (countEl) countEl.textContent = '';
  const input = document.getElementById('bulk-file-input');
  if (input) input.value = '';
  const wrap = document.getElementById('bulk-progress-wrap');
  if (wrap) wrap.style.display = 'none';
  const startBtn = document.getElementById('bulk-start-btn');
  if (startBtn) startBtn.disabled = true;
}

// Recomprime uma foto pra JPEG buscando o maior arquivo possível ainda
// dentro do teto — reduz qualidade primeiro (barato, mesmo canvas), só
// reduz dimensão se nem a qualidade mínima da rodada couber.
async function compressImageToTarget(file, maxBytes) {
  const bmp = await createImageBitmap(file);
  const width = bmp.width, height = bmp.height;
  const qualities = [0.92, 0.85, 0.78, 0.70, 0.62, 0.54, 0.46];

  try {
    let scale = 1;
    for (let round = 0; round < 7; round++) {
      const tw = Math.max(500, Math.round(width * scale));
      const th = Math.max(1, Math.round(height * tw / width));
      const canvas = document.createElement('canvas');
      canvas.width = tw; canvas.height = th;
      canvas.getContext('2d').drawImage(bmp, 0, 0, tw, th);
      for (const q of qualities) {
        const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', q));
        if (blob && blob.size <= maxBytes) return { blob, width: tw, height: th, over: false };
      }
      scale *= 0.82;
    }
    const tw = Math.max(400, Math.round(width * scale));
    const th = Math.max(1, Math.round(height * tw / width));
    const canvas = document.createElement('canvas');
    canvas.width = tw; canvas.height = th;
    canvas.getContext('2d').drawImage(bmp, 0, 0, tw, th);
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.4));
    return { blob, width: tw, height: th, over: blob.size > maxBytes };
  } finally {
    bmp.close();
  }
}

// Sobe uma foto já processada (blob JPEG + nome novo) pra uma galeria via R2.
// Reaproveita _putR2 (admin-galleries.js) — mesma assinatura/RPC do resto do admin.
async function uploadProcessedPhoto(blob, newName, galleryId, position, width, height, takenAt) {
  const safe = newName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const baseKey = `galleries/${galleryId}/${Date.now()}_${position}_${safe}`;
  const fullUrl = await _putR2(baseKey, blob, 'image/jpeg');
  if (!fullUrl) return null;

  let thumbUrl = fullUrl;
  try {
    const bmp = await createImageBitmap(blob);
    const MAXT = 800;
    const scale = Math.min(1, MAXT / Math.max(bmp.width, bmp.height));
    const tw = Math.max(1, Math.round(bmp.width * scale)), th = Math.max(1, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = tw; canvas.height = th;
    canvas.getContext('2d').drawImage(bmp, 0, 0, tw, th);
    bmp.close();
    const tblob = await new Promise(res => canvas.toBlob(res, 'image/webp', 0.8));
    if (tblob) { const u = await _putR2(`${baseKey}_thumb.webp`, tblob, 'image/webp'); if (u) thumbUrl = u; }
  } catch (e) {}

  const { data: photo, error } = await sb.from('photos').insert({
    gallery_id: galleryId, filename: newName,
    storage_path: baseKey, thumb_url: thumbUrl, full_url: fullUrl,
    size_bytes: blob.size, position, width, height, taken_at: takenAt,
  }).select('id').single();
  if (error) console.error('uploadProcessedPhoto (insert):', error);
  return photo?.id || null;
}

function updateBulkProgress(processed, total, done, failed) {
  const pct = Math.round((processed / total) * 100);
  document.getElementById('bulk-progress-fill').style.width = pct + '%';
  document.getElementById('bulk-progress-text').textContent =
    `${processed}/${total} (${pct}%) · ${done} ok${failed ? ` · ${failed} falha(s)` : ''}`;
}

async function startBulkProcess() {
  const name = document.getElementById('bulk-name').value.trim();
  if (!name) { toast('Digite um nome-base', 'error'); return; }
  const maxMb = parseFloat(document.getElementById('bulk-max-mb').value);
  if (!Number.isFinite(maxMb) || maxMb < 1.2 || maxMb > 2) { toast('Tamanho máximo deve estar entre 1.2 e 2MB', 'error'); return; }
  if (!pendingBulkFiles.length) { toast('Selecione uma pasta com fotos primeiro', 'error'); return; }

  const dest = document.querySelector('input[name="bulk-dest"]:checked').value; // 'gallery' | 'zip'
  const maxBytes = Math.round(maxMb * 1024 * 1024);
  const files = pendingBulkFiles;
  const pad = Math.max(4, String(files.length).length);
  const safeBase = name.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim() || 'foto';

  const startBtn = document.getElementById('bulk-start-btn');
  startBtn.disabled = true;
  document.getElementById('bulk-progress-wrap').style.display = 'block';
  updateBulkProgress(0, files.length, 0, 0);

  let galleryId = null;
  if (dest === 'gallery') {
    let slug = safeBase.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    let finalSlug = slug, suffix = 2;
    while (true) {
      const { data: existing } = await sb.from('galleries').select('id').eq('slug', finalSlug).maybeSingle();
      if (!existing) break;
      finalSlug = slug + '-' + suffix++;
    }
    const access_token = Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join('');
    const { data: gallery, error } = await sb.from('galleries')
      .insert({ name, slug: finalSlug, status: 'live', access_token }).select().single();
    if (error) { toast('Erro ao criar galeria: ' + error.message, 'error'); startBtn.disabled = false; return; }
    galleryId = gallery.id;
    toast('Galeria criada — processando fotos...', '');
  }

  const zip = dest === 'zip' ? new JSZip() : null;
  let firstPhotoId = null, done = 0, failed = 0, over = 0;
  const BATCH = 3; // processamento de imagem é pesado (CPU) — lote pequeno evita travar a aba

  for (let i = 0; i < files.length; i += BATCH) {
    await Promise.all(files.slice(i, i + BATCH).map(async (file, k) => {
      const position = i + k;
      const seq = String(position + 1).padStart(pad, '0');
      const newName = `${safeBase} ${seq}.jpg`;
      try {
        // Lê o EXIF do arquivo ORIGINAL — compressImageToTarget passa por
        // canvas.toBlob, que apaga todo metadado (é por isso que a hora de
        // captura tem que ser lida antes, não depois, da recompressão).
        const takenAtP = extractTakenAt(file);
        const { blob, width, height, over: wasOver } = await compressImageToTarget(file, maxBytes);
        if (wasOver) over++;
        if (dest === 'gallery') {
          const photoId = await uploadProcessedPhoto(blob, newName, galleryId, position, width, height, await takenAtP);
          if (!photoId) throw new Error('upload falhou');
          if (position === 0) firstPhotoId = photoId;
        } else {
          zip.file(newName, blob);
        }
        done++;
      } catch (e) {
        failed++;
        console.error('bulk process:', file.name, e);
      }
      updateBulkProgress(done + failed, files.length, done, failed);
    }));
  }

  if (dest === 'gallery' && firstPhotoId) {
    await sb.from('galleries').update({ cover_photo_id: firstPhotoId }).eq('id', galleryId);
  }
  if (dest === 'zip' && zip && done > 0) {
    toast('Gerando .zip...', '');
    const blob = await zip.generateAsync({ type: 'blob' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${safeBase}.zip`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  startBtn.disabled = false;
  let msg = `${done} de ${files.length} foto(s) processada(s)`;
  if (over) msg += ` · ${over} não coube no teto mesmo no mínimo`;
  toast(msg, failed ? 'error' : 'success');

  if (dest === 'gallery' && galleryId && done > 0) {
    setTimeout(() => openDetail(galleryId), 800);
  }
}
