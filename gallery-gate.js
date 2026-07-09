// ── PASSWORD GATE + EXPIRED OVERLAY ──
// Extraído de gallery.html (fatia de modularização). Depende de globals do
// script principal (_pendingPwResolve, sb) e de gallery-utils.js (hashSHA256).
// passwordHash != null  → modo hash (fallback, compara no cliente)
// passwordHash == null  → modo rpc  (valida no servidor via verify_gallery_password)
function showPasswordGate(passwordHash, galleryName, token) {
  return new Promise(resolve => {
    _pendingPwResolve = resolve;
    const gate = document.getElementById('pw-gate');
    if (galleryName) document.getElementById('pw-gallery-name').textContent = galleryName.toUpperCase();
    gate.style.display = 'flex';
    document.getElementById('pw-input').focus();
    if (passwordHash != null) { gate.dataset.mode = 'hash'; gate.dataset.pw = passwordHash; }
    else { gate.dataset.mode = 'rpc'; gate.dataset.token = token || ''; }
  });
}

async function checkPw() {
  const gate  = document.getElementById('pw-gate');
  const input = document.getElementById('pw-input');
  const err   = document.getElementById('pw-error');
  const hashed = await hashSHA256(input.value);
  let ok;
  if (gate.dataset.mode === 'rpc') {
    const r = await sb.rpc('verify_gallery_password', { p_token: gate.dataset.token, p_hash: hashed });
    ok = !r.error && r.data === true;
  } else {
    ok = hashed === gate.dataset.pw;
  }
  if (ok) {
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
