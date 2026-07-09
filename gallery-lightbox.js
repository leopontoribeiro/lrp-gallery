// ── LIGHTBOX + DOWNLOAD ──
// Extraído de gallery.html (fatia de modularização). Depende de globals do
// script principal (lbPhotos, lbIndex, touchStartX, PHOTOS, liked, toast,
// sb, trackEvent, _usingRpc, _galleryToken) e de libs CDN (JSZip, saveAs).
function openLightbox(idx, e) {
  if (e) e.stopPropagation();
  lbIndex = idx;
  setLbPhoto(lbPhotos[idx], 0);
  document.getElementById('lbCounter').textContent = `${idx+1} / ${lbPhotos.length}`;
  document.getElementById('lightbox').classList.add('open');
  document.addEventListener('keydown', lbKey);
  trackEvent('view', lbPhotos[idx].id);
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
  document.removeEventListener('keydown', lbKey);
}

function setLbPhoto(photo, dir) {
  const img = document.getElementById('lbImg');

  // Abertura instantânea: mostra o thumb (já em cache do grid) e anima na hora
  img.classList.remove('lb-anim-right', 'lb-anim-left', 'lb-anim-open');
  img.src = photo.thumb;
  void img.offsetWidth;          // força reflow para reiniciar animation
  const cls = dir > 0 ? 'lb-anim-right' : dir < 0 ? 'lb-anim-left' : 'lb-anim-open';
  img.classList.add(cls);
  img.addEventListener('animationend', () => img.classList.remove(cls), { once: true });

  // Se fullUrlDeliveryDisabled e ainda não temos full_url, buscar via RPC
  if (fullUrlDeliveryDisabled && !photo.lg && photo.full === null) {
    // Mostrar botão "Baixar original" em vez de tentar carregar
    img.alt = 'Clique no botão "Baixar original" para obter a foto em alta qualidade';
    // (O botão de download já está no HTML e será ativado)
  } else if (photo.lg) {
    // Troca pela versão grande assim que carregar (sem nova animação)
    const pre = new Image();
    pre.onload = () => { if (lbPhotos[lbIndex] === photo) img.src = photo.lg; };
    pre.src = photo.lg;

    // Pré-carrega vizinhas para navegação instantânea
    [1, -1].forEach(d => {
      const nb = lbPhotos[(lbIndex + d + lbPhotos.length) % lbPhotos.length];
      if (nb && nb.lg) new Image().src = nb.lg;
    });
  }

  document.getElementById('lbFilename').textContent = photo.name;
  updateLbHeart();
}

function lbNav(dir) {
  lbIndex = (lbIndex + dir + lbPhotos.length) % lbPhotos.length;
  setLbPhoto(lbPhotos[lbIndex], dir);
  document.getElementById('lbCounter').textContent = `${lbIndex+1} / ${lbPhotos.length}`;
  trackEvent('view', lbPhotos[lbIndex].id);
}

function lbKey(e) {
  if (e.key === 'ArrowRight') lbNav(1);
  if (e.key === 'ArrowLeft')  lbNav(-1);
  if (e.key === 'Escape')     closeLightbox();
}

// Swipe mobile — ignora toques nas setas laterais
document.getElementById('lbImgArea').addEventListener('touchstart',
  e => { touchStartX = e.changedTouches[0].clientX; }, { passive: true });
document.getElementById('lbImgArea').addEventListener('touchend', e => {
  const dx = e.changedTouches[0].clientX - touchStartX;
  if (Math.abs(dx) > 48) lbNav(dx < 0 ? 1 : -1);
}, { passive: true });

// ── DOWNLOAD ──
async function downloadCurrent() {
  const p = lbPhotos[lbIndex];
  trackEvent('save', p.id);
  let fullUrl = p.full;
  // Se fullUrlDeliveryDisabled e não temos a URL ainda, buscar via RPC
  if (fullUrlDeliveryDisabled && !fullUrl) {
    toast('Obtendo foto em alta qualidade...');
    fullUrl = await getFullUrlOnDemand(p.id);
    if (fullUrl) p.full = fullUrl; // cache para próximos cliques
  }
  if (!fullUrl) { toast('Não foi possível obter a foto. Tente novamente.', 'error'); return; }
  dl(fullUrl, p.name);
  toast('Download iniciado');
}
// Worker que monta o ZIP server-side (streaming direto do R2).
const ZIP_WORKER = 'https://lrp-gallery-signed.lrp-gallery.workers.dev/zip';

// Tenta o ZIP server-side: pega o manifesto assinado no Supabase e faz
// o Worker montar/entregar o arquivo. Retorna true se conseguiu.
async function serverZip(ids, filename) {
  if (!_usingRpc || !_galleryToken) return false;
  try {
    const { data, error } = await sb.rpc('get_zip_manifest', {
      p_token: _galleryToken, p_ids: ids && ids.length ? ids : null
    });
    if (error || !data || data.error || !Array.isArray(data.keys) || !data.keys.length || !data.sig)
      return false;
    toast(`Preparando ${data.keys.length} foto(s)...`);
    const resp = await fetch(ZIP_WORKER, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!resp.ok) return false;
    const blob = await resp.blob();
    saveAs(blob, filename);
    return true;
  } catch (e) { return false; }
}

// Fallback (galerias antigas sem RPC/segredo): baixa no navegador via JSZip.
async function clientZip(photos, filename, label) {
  toast(`Preparando ${photos.length} ${label}...`);
  const zip = new JSZip();
  let done = 0;
  for (const p of photos) {
    try {
      const resp = await fetch(p.lg || p.full);
      zip.file(p.name, await resp.blob());
      done++;
      if (done % 10 === 0) toast(`Baixando... ${done}/${photos.length}`);
    } catch(e) {}
  }
  toast(`Gerando ZIP com ${done} ${label}...`);
  const blob = await zip.generateAsync({ type: 'blob' });
  saveAs(blob, filename.replace('%N', done));
}

// Nome-base do ZIP = nome da galeria (facilita o cliente achar o arquivo).
// Remove caracteres inválidos em nome de arquivo e normaliza espaços.
function _zipBase() {
  const n = (typeof galleryName !== 'undefined' && galleryName) ? galleryName : 'galeria';
  return n.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim() || 'galeria';
}
async function downloadFavorites() {
  const favs = PHOTOS.filter(p => liked.has(p.id));
  if (favs.length === 0) { toast('Nenhuma foto favoritada ainda'); return; }
  favs.forEach(p => trackEvent('save', p.id));
  if (await serverZip(favs.map(p => p.id), `${_zipBase()} - favoritas.zip`)) return;
  await clientZip(favs, `${_zipBase()} - favoritas (%N).zip`, 'favorita(s)');
}
// Baixa só o grupo/aba selecionado no momento (ex.: NOIVOS, Palestrantes).
// É o caminho mais usado e mais seguro: subconjunto menor = ZIP estável.
async function downloadCurrentGroup() {
  const g = (typeof currentGroup !== 'undefined') ? currentGroup : null;
  if (!g) { toast('Abra uma aba de grupo primeiro (ou use "Salvar todas")'); return; }
  const inGroup = PHOTOS.filter(p => p.group === g);
  if (!inGroup.length) { toast('Nenhuma foto neste grupo'); return; }
  inGroup.forEach(p => trackEvent && trackEvent('save', p.id));
  const safe = String(g).replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim() || 'grupo';
  const base = `${_zipBase()} - ${safe}`;
  if (await serverZip(inGroup.map(p => p.id), `${base}.zip`)) return;
  await clientZip(inGroup, `${base} (%N).zip`, 'fotos');
}
const DOWNLOAD_CAP = 200;
async function downloadAll() {
  if (!PHOTOS.length) return;
  if (await serverZip(null, `${_zipBase()}.zip`)) return;
  // Fallback client-side é limitado (memória do navegador).
  const photos = PHOTOS.slice(0, DOWNLOAD_CAP);
  if (PHOTOS.length > DOWNLOAD_CAP)
    toast(`Limitado a ${DOWNLOAD_CAP} fotos por download neste modo.`);
  await clientZip(photos, `${_zipBase()} (%N).zip`, 'fotos');
}
function dl(url, filename) {
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.target = '_blank';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}
