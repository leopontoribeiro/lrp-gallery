// ── SELEÇÃO DO CLIENTE + AÇÃO PRINCIPAL + DRAWER + VISITOR ID + EVENT TRACKING ──
// Extraído de gallery.html (fatia de modularização). Depende de globals do
// script principal (liked, toast, sb, _usingRpc, _galleryToken, galleryId,
// reportError, downloadFavorites) e de gallery-utils.js (getVisitorId).
let _selIds = [];
function openSelection(ids) {
  _selIds = (ids && ids.length) ? ids : [...liked];
  if (!_selIds.length) { toast('Favorite fotos com ♡ para montar sua seleção'); return; }
  document.getElementById('sel-count').textContent = _selIds.length;
  document.getElementById('sel-error').textContent = '';
  const g = document.getElementById('sel-gate');
  g.style.display = 'flex';
  document.getElementById('sel-name').focus();
}
function closeSelection() { document.getElementById('sel-gate').style.display = 'none'; }
async function submitSelection() {
  const btn = document.getElementById('sel-btn');
  const err = document.getElementById('sel-error');
  const name = document.getElementById('sel-name').value.trim();
  if (!name) { err.style.color = '#e04444'; err.textContent = 'Informe seu nome'; return; }
  const ids = _selIds.length ? _selIds : [...liked];
  if (!ids.length) { err.style.color = '#e04444'; err.textContent = 'Nenhuma foto selecionada'; return; }
  if (!_usingRpc || !_galleryToken) { err.style.color = '#e04444'; err.textContent = 'Indisponível nesta galeria'; return; }
  btn.disabled = true; btn.textContent = 'Enviando...';
  try {
    const { data, error } = await sb.rpc('submit_selection', {
      p_token: _galleryToken, p_name: name,
      p_contact: document.getElementById('sel-contact').value.trim(),
      p_message: document.getElementById('sel-message').value.trim(),
      p_photo_ids: ids
    });
    if (error || data !== true) throw new Error(error ? error.message : 'falha');
    closeSelection();
    toast(`Seleção de ${ids.length} foto(s) enviada. Obrigado!`);
  } catch (e) {
    err.style.color = '#e04444'; err.textContent = 'Não foi possível enviar. Tente novamente.';
    reportError('submit_selection', e.message);
  } finally { btn.disabled = false; btn.textContent = 'Enviar seleção'; }
}

// ── AÇÃO PRINCIPAL ──
function handleBarAction() {
  liked.size > 0
    ? downloadFavorites()
    : toast('Favorite fotos com ♡ ou use o menu para salvar todas');
}

// ── DRAWER ──
function openDrawer()  { document.getElementById('drawer').classList.add('open'); }
function closeDrawer() { document.getElementById('drawer').classList.remove('open'); }

// ── EVENT TRACKING ──
const _tracked = new Set();
async function trackEvent(type, photoId) {
  if (!galleryId || !photoId) return;
  const key = type + ':' + photoId;
  if (_tracked.has(key)) return;
  _tracked.add(key);
  try {
    if (_usingRpc && _galleryToken) {
      await sb.rpc('log_photo_event', {
        p_token: _galleryToken, p_photo_id: photoId, p_type: type, p_visitor: getVisitorId()
      });
    } else {
      await sb.from('photo_events').insert({
        gallery_id: galleryId, photo_id: photoId, event_type: type, visitor_id: getVisitorId()
      });
    }
  } catch(e) { /* silencioso */ }
}
