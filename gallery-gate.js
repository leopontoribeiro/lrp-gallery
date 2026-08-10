// ── PASSWORD GATE + EXPIRED OVERLAY ──
// Extraído de gallery.html (fatia de modularização). Depende de globals do
// script principal (_pendingPwResolve, sb) e de gallery-utils.js (hashSHA256).
//
// A validação acontece NO SERVIDOR (migração 34). O hash correto nunca é
// enviado ao navegador — o antigo "modo hash", que comparava no cliente,
// foi removido: ele entregava o hash no DOM e qualquer pessoa contornava
// o modal pelo inspetor. Depois de acertar a senha, guardamos o hash em
// window._pwHash e ele acompanha toda RPC que devolve conteúdo; sem ele o
// servidor responde vazio.
window._pwHash = null;

function showPasswordGate(_ignored, galleryName, token) {
  return new Promise(resolve => {
    _pendingPwResolve = resolve;
    const gate = document.getElementById('pw-gate');
    if (galleryName) document.getElementById('pw-gallery-name').textContent = galleryName.toUpperCase();
    gate.style.display = 'flex';
    document.getElementById('pw-input').focus();
    gate.dataset.token = token || '';
  });
}

async function checkPw() {
  const gate  = document.getElementById('pw-gate');
  const input = document.getElementById('pw-input');
  const err   = document.getElementById('pw-error');
  const hashed = await hashSHA256(input.value);
  const r = await sb.rpc('verify_gallery_password', { p_token: gate.dataset.token, p_hash: hashed });
  const ok = !r.error && r.data === true;
  if (ok) {
    window._pwHash = hashed;
    gate.style.display = 'none';
    if (_pendingPwResolve) { _pendingPwResolve(true); _pendingPwResolve = null; }
  } else {
    err.textContent = 'Senha incorreta';
    input.value = '';
    input.classList.add('shake');
    input.addEventListener('animationend', () => input.classList.remove('shake'), {once:true});
  }
}

// ── EXPIRED OVERLAY ──
function showExpiredOverlay() {
  document.getElementById('expired-gate').style.display = 'flex';
}

// ── FALHA VISÍVEL ──
// Reaproveita a tela de "galeria expirada" com outro texto. Existe porque o
// modo de falha antigo era o pior possível: página em branco, sem mensagem
// para o cliente e sem registro para o fotógrafo.
function showFatalGate(titulo, htmlSub) {
  const gate = document.getElementById('expired-gate');
  if (!gate) return;
  const t = document.getElementById('expired-title');
  const sub = document.getElementById('expired-sub');
  if (t) t.textContent = titulo;
  if (sub) sub.innerHTML = htmlSub;
  gate.style.display = 'flex';
}
