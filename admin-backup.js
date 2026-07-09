// ── BACKUP ──
// Extraído de admin.html (fatia de modularização). Depende de globals do
// script principal (sb, toast) — só usados dentro das funções.

function initBackupScreen() {
  const last = localStorage.getItem('lrp_last_backup');
  const wrap = document.getElementById('backup-last-wrap');
  if (last) {
    wrap.style.display = 'block';
    document.getElementById('backup-last-label').textContent =
      'Realizado em ' + new Date(last).toLocaleString('pt-BR');
  } else {
    wrap.style.display = 'none';
  }
  document.getElementById('backup-progress-wrap').style.display = 'none';
}

async function fetchAllBackupData() {
  const { data: galleriesData, error: gErr } = await sb
    .from('galleries').select('*').order('created_at', { ascending: false });
  if (gErr) throw gErr;

  const { data: photosData, error: pErr } = await sb
    .from('photos').select('*').order('gallery_id, position');
  if (pErr) throw pErr;

  // photo_events paginado — Supabase retorna no máx 1000/request
  let events = [], from = 0;
  while (true) {
    const { data, error } = await sb
      .from('photo_events').select('*').range(from, from + 999);
    if (error || !data?.length) break;
    events = events.concat(data);
    if (data.length < 1000) break;
    from += 1000;
  }

  return {
    exported_at: new Date().toISOString(),
    version: '1.0',
    stats: { galleries: galleriesData.length, photos: photosData.length, events: events.length },
    galleries: galleriesData,
    photos: photosData,
    photo_events: events,
  };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function backupJSON() {
  toast('Exportando dados...', '');
  try {
    const data = await fetchAllBackupData();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `lrp-gallery-backup-${new Date().toISOString().slice(0,10)}.json`);
    localStorage.setItem('lrp_last_backup', new Date().toISOString());
    toast('JSON exportado!', 'success');
    initBackupScreen();
  } catch (err) {
    toast('Erro: ' + err.message, 'error');
  }
}

async function backupZIP() {
  const btn = document.getElementById('btn-backup-zip');
  const progressWrap = document.getElementById('backup-progress-wrap');
  btn.disabled = true;
  progressWrap.style.display = 'block';

  function setProgress(label, pct) {
    document.getElementById('backup-progress-label').textContent = label;
    document.getElementById('backup-progress-pct').textContent = pct + '%';
    document.getElementById('backup-progress-bar').style.width = pct + '%';
  }

  try {
    setProgress('Buscando dados do banco...', 5);
    const data = await fetchAllBackupData();

    const zip = new JSZip();
    zip.file('backup.json', JSON.stringify(data, null, 2));

    const gallerySlugMap = {};
    data.galleries.forEach(g => { gallerySlugMap[g.id] = g.slug || g.id; });

    const photos = data.photos;
    const total = photos.length;

    if (total === 0) {
      setProgress('Nenhuma foto encontrada.', 10);
    } else {
      let done = 0;
      const BATCH = 5;
      for (let i = 0; i < photos.length; i += BATCH) {
        await Promise.all(photos.slice(i, i + BATCH).map(async (photo) => {
          try {
            const res = await fetch(photo.full_url);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const blob = await res.blob();
            const slug = gallerySlugMap[photo.gallery_id] || photo.gallery_id;
            const name = photo.filename || photo.storage_path.split('/').pop();
            zip.folder(`galleries/${slug}`).file(name, blob);
          } catch (_) { /* foto inacessível — ignora */ }
          done++;
          setProgress(`Baixando fotos (${done} de ${total})...`, Math.round(10 + (done / total) * 80));
        }));
      }
    }

    setProgress('Comprimindo ZIP...', 92);
    const zipBlob = await zip.generateAsync(
      { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
      (meta) => setProgress('Comprimindo ZIP...', Math.round(92 + meta.percent * 0.08))
    );

    downloadBlob(zipBlob, `lrp-gallery-backup-${new Date().toISOString().slice(0,10)}.zip`);
    localStorage.setItem('lrp_last_backup', new Date().toISOString());
    setProgress('Concluído!', 100);
    toast('Backup ZIP baixado!', 'success');
    initBackupScreen();
  } catch (err) {
    toast('Erro no backup: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" fill="none" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Baixar ZIP completo`;
  }
}
