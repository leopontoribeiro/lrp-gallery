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

  // Troca direta, sem fade: em cliques rápidos nas setas, qualquer transição de
  // opacidade fica se interrompendo no meio e dá a impressão de fotos sobrepostas.
  img.src = photo.thumb;

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

// Tenta o ZIP server-side: pega o manifesto assinado no Supabase, pergunta ao
// Worker como dividir o álbum e baixa parte por parte. Retorna true se conseguiu.
//
// Por que em partes: o ZIP clássico (único que o Utilitário de Compactação do
// macOS abre) não passa de 4GB, e cada invocação do Worker tem teto de
// subrequests. O álbum pode ter QUALQUER tamanho — quem se divide é o arquivo,
// não a entrega. Álbuns pequenos continuam saindo em um arquivo só.
// Baixa um manifesto assinado em partes. Usado pelo download normal E pelo
// download de fotos compradas — os dois batem no mesmo /zip, que tem teto de
// 700 arquivos por requisição. Sem passar por aqui, álbum grande dá 413.
window.zipEmPartes = async function (data, filename) {
    // 1. Plano de divisão
    let parts = [{ from: 0, to: data.keys.length }];
    try {
      const pr = await fetch(ZIP_WORKER + '-plan', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: data.keys, exp: data.exp, sig: data.sig })
      });
      if (pr.ok) {
        const plan = await pr.json();
        if (Array.isArray(plan.parts) && plan.parts.length) parts = plan.parts;
      }
    } catch (e) { /* sem plano: tenta em um arquivo só */ }

    const n = parts.length;
    if (n > 1) {
      const gb = (parts.reduce((a, p) => a + (p.bytes || 0), 0) / 1073741824).toFixed(1);
      toast(`${data.keys.length} fotos (${gb}GB) — o download vem em ${n} arquivos. Aguarde cada um.`);
    } else {
      toast(`Preparando ${data.keys.length} foto(s)...`);
    }

    const base = filename.replace(/\.zip$/i, '');
    for (let i = 0; i < n; i++) {
      const { from, to } = parts[i];
      if (n > 1) toast(`Baixando parte ${i + 1} de ${n}...`);
      const resp = await fetch(`${ZIP_WORKER}?from=${from}&to=${to}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!resp.ok) {
        if (i === 0) return false;
        toast(`Falhou na parte ${i + 1}. As anteriores foram salvas — tente de novo.`);
        return true;
      }
      saveAs(await resp.blob(), n > 1 ? `${base} (parte ${i + 1} de ${n}).zip` : `${base}.zip`);
      if (i < n - 1) await new Promise(r => setTimeout(r, 1500));
    }
    if (n > 1) toast(`Pronto — ${n} arquivos salvos.`);
    return true;
};

async function serverZip(ids, filename) {
  if (!_usingRpc || !_galleryToken) return false;
  try {
    const { data, error } = await sb.rpc('get_zip_manifest', {
      p_token: _galleryToken, p_ids: ids && ids.length ? ids : null
    });
    if (error || !data || data.error || !Array.isArray(data.keys) || !data.keys.length || !data.sig)
      return false;
    return await window.zipEmPartes(data, filename);
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
  const inGroup = PHOTOS.filter(p => (p.groups || []).includes(g));
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
