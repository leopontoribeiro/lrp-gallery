// ── RECONHECIMENTO FACIAL (client-side, Arquitetura A) ──
// Extraído de gallery.html (fatia de modularização). A selfie é processada
// 100% no aparelho (face-api.js). Nada é enviado nem armazenado: extraímos
// só o "vetor" do rosto e comparamos com o índice do álbum.
// Depende de globals do script principal (toast, sb, _galleryToken, PHOTOS,
// currentView, lbPhotos, renderGrid, liked, saveLiked, openSelection,
// reportError) e de gallery-utils.js (_loadScript, _minDist) — só usados
// dentro das funções, então a ordem de carregamento não importa.
let _faceApiReady = false;
let _facialStream = null;

function openFacial() {
  // Verificar consentimento LGPD antes de abrir facial search
  if (!consentManager.isConsentValid()) {
    showConsentModalIfNeeded();
    return;
  }

  document.getElementById('facial-consent').style.display = '';
  document.getElementById('facial-camera').style.display  = 'none';
  document.getElementById('facial-review').style.display  = 'none';
  const chk = document.getElementById('facial-consent-check');
  chk.checked = false;
  const go = document.getElementById('facial-go');
  go.disabled = true;
  chk.onchange = () => { go.disabled = !chk.checked; };
  document.getElementById('facial-saved-note').style.display = loadFaceProfile().length ? 'block' : 'none';
  document.getElementById('facial-gate').style.display = 'flex';
}
function forgetFace(e) {
  if (e) e.preventDefault();
  clearFaceProfile();
  document.getElementById('facial-saved-note').style.display = 'none';
  toast('Rosto removido deste aparelho.');
}
function closeFacial() {
  document.getElementById('facial-gate').style.display = 'none';
  if (_facialStream) { _facialStream.getTracks().forEach(t => t.stop()); _facialStream = null; }
}
async function facialConsentContinue() {
  if (!document.getElementById('facial-consent-check').checked) return;
  document.getElementById('facial-consent').style.display = 'none';
  document.getElementById('facial-camera').style.display  = '';
  const status = document.getElementById('facial-status');
  const capBtn = document.getElementById('facial-capture');
  try {
    status.textContent = 'Preparando a câmera...';
    _facialStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 480, height: 480 } });
    document.getElementById('facial-video').srcObject = _facialStream;
    status.textContent = 'Carregando o reconhecimento...';
    await loadFaceApi();
    status.textContent = 'Enquadre seu rosto e toque em buscar.';
    capBtn.disabled = false;
  } catch (e) {
    status.textContent = 'Não foi possível acessar a câmera. Verifique a permissão do navegador.';
    reportError('facial-camera', e.message);
  }
}
async function loadFaceApi() {
  if (_faceApiReady) return;
  await _loadScript('https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/dist/face-api.min.js');
  const M = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model';
  await faceapi.nets.tinyFaceDetector.loadFromUri(M);
  await faceapi.nets.faceLandmark68Net.loadFromUri(M);
  await faceapi.nets.faceRecognitionNet.loadFromUri(M);
  _faceApiReady = true;
}
// Limiares de distância euclidiana (menor = mais parecido)
const FACE_STRONG = 0.46;   // < isto: é você (inclui automático)
const FACE_MAYBE  = 0.58;   // entre STRONG e isto: dúvida -> pergunta
// Estado da busca facial (Opção 1: aprendizado ativo na sessão)
let _facialIndex = null, _facialRefs = [], _facialNegs = [], _facialAnswered = new Set();
let _facialIncluded = new Set(), _facialQueue = [], _facialCurrent = null;
let _facialScopeIds = null; // null = busca em todas; Set = restringe ao grupo/aba aberto

// Listener para quando consentimento é aceito
window.addEventListener('consentAccepted', (e) => {
  // Agora pode abrir o facial search normalmente
  openFacial();
});

async function facialCapture() {
  const status = document.getElementById('facial-status');
  const capBtn = document.getElementById('facial-capture');
  const video  = document.getElementById('facial-video');
  capBtn.disabled = true; status.textContent = 'Analisando seu rosto...';
  try {
    const det = await faceapi
      .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
      .withFaceLandmarks().withFaceDescriptor();
    if (!det) { status.textContent = 'Não detectei um rosto. Tente com mais luz e de frente.'; capBtn.disabled = false; return; }
    // libera a câmera na hora — a selfie não é guardada
    if (_facialStream) { _facialStream.getTracks().forEach(t => t.stop()); _facialStream = null; }
    status.textContent = 'Procurando suas fotos...';
    _facialIndex = await loadFaceIndex();
    if (!_facialIndex) { closeFacial(); toast('O índice facial deste álbum ainda está sendo preparado. Em breve!'); return; }
    // Se há um grupo/aba aberto, busca só dentro dele (mais rápido e certeiro).
    _facialScopeIds = (typeof currentGroup !== 'undefined' && currentGroup)
      ? new Set(PHOTOS.filter(p => p.group === currentGroup).map(p => p.id))
      : null;
    // Referências = sua selfie + rosto salvo neste aparelho (Opção 2)
    _facialRefs = [Array.from(det.descriptor), ...loadFaceProfile()];
    _facialNegs = []; _facialAnswered = new Set();
    const { included, uncertain } = classifyFaces();
    _facialIncluded = included; _facialQueue = uncertain;
    if (!uncertain.length) { finishFacial(); return; }
    showReviewStep();               // há dúvidas -> perguntar
  } catch (e) {
    status.textContent = 'Algo deu errado. Tente novamente.';
    reportError('facial-capture', e.message); capBtn.disabled = false;
  }
}
async function loadFaceIndex() {
  try {
    // Otimização: se há grupo/aba aberto, baixa só os rostos daquele grupo
    // (filtro no servidor) — muito menos dados no celular.
    const grp = (typeof currentGroup !== 'undefined' && currentGroup) ? currentGroup : null;
    let { data } = await sb.rpc('get_face_index', { p_token: _galleryToken, p_group: grp });
    // Grupo sem rostos indexados → cai pro índice inteiro (não deixa o cliente na mão).
    if (grp && (!data || !Array.isArray(data.faces) || !data.faces.length)) {
      _facialScopeIds = null;
      const r = await sb.rpc('get_face_index', { p_token: _galleryToken, p_group: null });
      data = r.data;
    }
    if (!data || !Array.isArray(data.faces) || !data.faces.length) return null;
    // Índice quantizado (int8) → volta pra float antes de comparar.
    if (data.qv === 1) { for (const f of data.faces) if (Array.isArray(f.d)) f.d = f.d.map(v => v / 127); }
    return data; // { faces: [{ p: photo_id, d: [128 floats], b: [x,y,w,h] }, ...] }
  } catch (e) { return null; }
}

// Classifica cada foto em: incluída / dúvida / fora, usando referências e negativos.
function classifyFaces() {
  const included = new Set(), perPhoto = new Map();
  for (const f of _facialIndex.faces) {
    const d = f.d; if (!d || d.length !== 128) continue;
    if (_facialScopeIds && !_facialScopeIds.has(f.p)) continue; // fora do grupo aberto
    const dRef = _minDist(d, _facialRefs);
    const dNeg = _facialNegs.length ? _minDist(d, _facialNegs) : Infinity;
    if (dNeg < dRef && dNeg < FACE_STRONG) continue;           // mais perto de um "não sou eu"
    if (dRef < FACE_STRONG) { included.add(f.p); }
    else if (dRef < FACE_MAYBE) {
      const cur = perPhoto.get(f.p);
      if (!cur || dRef < cur.dist) perPhoto.set(f.p, { d, dist: dRef, b: f.b });
    }
  }
  const uncertain = [];
  for (const [pid, info] of perPhoto) {
    if (!included.has(pid) && !_facialAnswered.has(pid)) uncertain.push({ pid, d: info.d, dist: info.dist, b: info.b });
  }
  uncertain.sort((a, b) => a.dist - b.dist);
  return { included, uncertain: uncertain.slice(0, 12) };     // pergunta no máx. as 12 mais prováveis
}
function showReviewStep() {
  document.getElementById('facial-camera').style.display = 'none';
  document.getElementById('facial-review').style.display = '';
  showNextReview();
}
function showNextReview() {
  const { included, uncertain } = classifyFaces();
  _facialIncluded = included; _facialQueue = uncertain;
  if (!uncertain.length) { finishFacial(); return; }
  _facialCurrent = uncertain[0];
  const p = PHOTOS.find(x => x.id === _facialCurrent.pid);
  drawFaceCrop(p, _facialCurrent.b);
  document.getElementById('facial-review-count').textContent = `${included.size} confirmada(s) · ${uncertain.length} para revisar`;
  document.getElementById('facial-see').textContent = `Ver minhas fotos (${included.size})`;
}
// Mostra o rosto em dúvida recortado (usa a caixa 'b' do índice). Sem 'b'
// (índice antigo) ou erro de CORS -> mostra a foto inteira.
function drawFaceCrop(p, b) {
  const img = document.getElementById('facial-review-img');
  const canvas = document.getElementById('facial-review-canvas');
  const showWhole = () => { if (p) img.src = p.thumb || p.full; img.style.display = ''; canvas.style.display = 'none'; };
  if (!p || !b || b.length !== 4) { showWhole(); return; }
  const im = new Image(); im.crossOrigin = 'anonymous';
  im.onload = () => {
    try {
      const W = im.naturalWidth, H = im.naturalHeight;
      let x = b[0] * W, y = b[1] * H, w = b[2] * W, h = b[3] * H;
      const pad = Math.max(w, h) * 0.7;                 // folga ao redor do rosto
      let cx = Math.max(0, x - pad), cy = Math.max(0, y - pad);
      let cw = Math.min(W - cx, w + pad * 2), ch = Math.min(H - cy, h + pad * 2);
      canvas.width = cw; canvas.height = ch;
      canvas.getContext('2d').drawImage(im, cx, cy, cw, ch, 0, 0, cw, ch);
      canvas.style.display = ''; img.style.display = 'none';
    } catch (e) { showWhole(); }
  };
  im.onerror = showWhole;
  im.src = p.thumb || p.full;
}
function facialAnswer(yes) {
  const cur = _facialCurrent; if (!cur) return;
  _facialAnswered.add(cur.pid);
  if (yes) _facialRefs.push(cur.d); else _facialNegs.push(cur.d);  // aprende com a resposta
  showNextReview();
}
function finishFacial() {
  // Opção 2: memória local (só neste aparelho) se o cliente optar
  if (document.getElementById('facial-remember')?.checked) saveFaceProfile(_facialRefs);
  const ids = [..._facialIncluded];
  closeFacial();
  if (!ids.length) { toast('Não encontramos fotos suas. Veja o álbum completo.'); return; }
  const set = new Set(ids);
  const subset = PHOTOS.filter(p => set.has(p.id));
  currentView = 'facial'; lbPhotos = subset; renderGrid(subset);
  _facialResultIds = subset.map(p => p.id);
  document.getElementById('grid-section')?.scrollIntoView({ behavior: 'smooth' });
  showFacialActions(subset.length);
  toast(`Encontramos ${subset.length} foto(s) com você${_facialScopeIds ? ' neste grupo' : ''}!`);
}
// ── Combo facial + seleção ──
let _facialResultIds = [];
function showFacialActions(n) {
  document.getElementById('facial-actions-txt').textContent = `${n} foto(s) com você`;
  document.getElementById('facial-actions').style.display = 'flex';
}
function hideFacialActions() { document.getElementById('facial-actions').style.display = 'none'; }
function favoriteAllFacial() {
  if (!_facialResultIds.length) return;
  _facialResultIds.forEach(id => liked.add(id));
  saveLiked();
  if (currentView === 'facial') renderGrid(PHOTOS.filter(p => _facialResultIds.includes(p.id)));
  toast(`${_facialResultIds.length} foto(s) favoritada(s)`);
}
function sendSelectionFacial() {
  if (!_facialResultIds.length) return;
  openSelection(_facialResultIds);
}
// ── Memória local do rosto (Opção 2) — nunca sai do aparelho ──
function loadFaceProfile() {
  try { return JSON.parse(localStorage.getItem('lrp_faceprofile') || '[]').filter(a => Array.isArray(a) && a.length === 128); }
  catch (e) { return []; }
}
function saveFaceProfile(refs) {
  try {
    const arr = refs.map(r => Array.from(r).map(x => Math.round(x * 1000) / 1000)).filter(a => a.length === 128).slice(-20);
    localStorage.setItem('lrp_faceprofile', JSON.stringify(arr));
    toast('Rosto salvo neste aparelho.');
  } catch (e) {}
}
function clearFaceProfile() { try { localStorage.removeItem('lrp_faceprofile'); } catch (e) {} }
