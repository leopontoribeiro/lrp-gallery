// ── PAYWALL (Mercado Pago) ──
// Extraído de gallery.html (fatia de modularização). Depende de globals do
// script principal (_paywall, _purchased, liked, _galleryToken, _usingRpc,
// ZIP_WORKER, sb, toast, reportError, saveAs, facialRecognitionEnabled) e de gallery-utils.js
// (brl, getVisitorId) — só usados dentro das funções.
const CHECKOUT_URL = 'https://lrp-gallery-signed.lrp-gallery.workers.dev/checkout';
function updatePaywallUI() {
  const buy = document.getElementById('drawer-buy'), dl = document.getElementById('drawer-buydl'), code = document.getElementById('drawer-code');
  const facial = document.getElementById('drawer-facial');
  if (buy) { buy.style.display = _paywall ? 'block' : 'none'; buy.textContent = `Comprar originais (favoritas · ${brl(galleryPrice)}/foto)`; }
  if (dl)   dl.style.display = _purchased.size ? 'block' : 'none';
  if (code) code.style.display = _paywall ? 'block' : 'none';
  if (facial) facial.style.display = facialRecognitionEnabled ? 'block' : 'none';
}
async function buyFavorites() {
  if (!_paywall) return;
  const ids = [...liked].filter(id => !_purchased.has(id));
  if (!ids.length) { toast('Favorite (♡) as fotos que quer comprar'); return; }
  toast('Abrindo pagamento...');
  try {
    const r = await fetch(CHECKOUT_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: _galleryToken, visitor_id: getVisitorId(), photo_ids: ids, origin: location.href.split('?')[0] })
    });
    const d = await r.json();
    if (d.init_point) location.href = d.init_point;
    else toast('Pagamento indisponível no momento.');
  } catch (e) { toast('Falha ao iniciar o pagamento.'); reportError('checkout', e.message); }
}
// Códigos de desbloqueio guardados neste aparelho (por galeria)
function loadCodes() {
  try { const all = JSON.parse(localStorage.getItem('lrp_unlock_codes') || '{}'); return all[_galleryToken] || []; }
  catch (e) { return []; }
}
function addCode(c) {
  try {
    const all = JSON.parse(localStorage.getItem('lrp_unlock_codes') || '{}');
    const set = new Set(all[_galleryToken] || []); set.add(c);
    all[_galleryToken] = [...set]; localStorage.setItem('lrp_unlock_codes', JSON.stringify(all));
  } catch (e) {}
}
async function refreshPurchases() {
  if (!_usingRpc || !_galleryToken) return;
  try {
    const { data, error } = await sb.rpc('get_purchased_photos', { p_token: _galleryToken, p_visitor: getVisitorId(), p_codes: loadCodes() });
    if (error || !Array.isArray(data)) return;
    _purchased = new Set(data.map(p => p.id));
    updatePaywallUI();
  } catch (e) {}
}
async function downloadPurchased() {
  if (!_purchased.size) { toast('Você ainda não comprou fotos deste álbum'); return; }
  try {
    const { data, error } = await sb.rpc('get_paid_zip_manifest', { p_token: _galleryToken, p_visitor: getVisitorId(), p_codes: loadCodes() });
    if (error || !data || data.error || !data.sig) { toast('Nada para baixar ainda.'); return; }
    toast(`Preparando ${data.keys.length} original(is)...`);
    const resp = await fetch(ZIP_WORKER, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    if (!resp.ok) { toast('Falha no download.'); return; }
    saveAs(await resp.blob(), 'originais-comprados.zip');
  } catch (e) { toast('Falha no download.'); reportError('paid-zip', e.message); }
}
async function enterUnlockCode() {
  const c = (prompt('Digite o código de desbloqueio (recebido por e-mail após a compra):') || '').trim().toUpperCase();
  if (!c) return;
  addCode(c);
  await refreshPurchases();
  toast(_purchased.size ? `Desbloqueado! ${_purchased.size} foto(s). Baixe no menu.` : 'Código guardado. Se a compra estiver aprovada, já desbloqueia.');
}
function handlePaidReturn(params) {
  if (params.get('paid') !== '1') return;
  const oid = params.get('o');
  let tries = 0;
  const iv = setInterval(async () => {
    tries++;
    // busca o código do pedido (aparece quando o pagamento é aprovado)
    if (oid) {
      try {
        const { data } = await sb.rpc('get_order_code', { p_token: _galleryToken, p_order_id: oid });
        if (data && data.status === 'approved' && data.code) {
          addCode(data.code); await refreshPurchases(); clearInterval(iv);
          toast(`Compra confirmada! Código: ${data.code} — guardado neste aparelho.`);
          alert(`Compra confirmada ✅\n\nSeu código de desbloqueio: ${data.code}\n\nGuarde-o para baixar em outro aparelho (menu → "Tenho um código"). Também enviamos por e-mail.`);
          return;
        }
      } catch (e) {}
    }
    if (tries >= 8) { clearInterval(iv); await refreshPurchases(); }
  }, 3000);
}
