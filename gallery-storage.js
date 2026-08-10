// ── GALERIA PERMANENTE + ARMAZENAMENTO DE VÍDEO ──
// Produto único: R$127 uma vez e o álbum nunca expira. Quota de vídeo é
// vendida à parte (R$30/GB). Depende de globals do script principal
// (sb, toast, reportError, _galleryToken, galleryId) e de gallery-utils.js
// (getVisitorId, brl).
const STORAGE_CHECKOUT_URL = 'https://lrp-gallery-signed.lrp-gallery.workers.dev/checkout-storage';
const PRICE_PERMANENT_CENTS = 12700;  // espelha create_storage_order — só exibição, servidor recalcula
const PRICE_PER_GB_CENTS = 3000;

let _galleryExpiresAt = null;   // Date ou null (null = permanente)

function openStorageModal() {
  const perm = document.getElementById('sm-permanent');
  const row = document.getElementById('sm-permanent-row');
  // Já é permanente? Esconde a opção (o servidor também recusa).
  const isPerm = !_galleryExpiresAt;
  row.style.display = isPerm ? 'none' : '';
  perm.checked = !isPerm;
  document.getElementById('sm-perm-done').style.display = isPerm ? '' : 'none';
  document.getElementById('sm-gb').value = 0;
  _updateStoragePrice();
  document.getElementById('storage-modal').style.display = 'flex';
}
function closeStorageModal() { document.getElementById('storage-modal').style.display = 'none'; }
function _updateStoragePrice() {
  const perm = document.getElementById('sm-permanent').checked && _galleryExpiresAt;
  const gb = parseFloat(document.getElementById('sm-gb').value) || 0;
  const cents = (perm ? PRICE_PERMANENT_CENTS : 0) + gb * PRICE_PER_GB_CENTS;
  document.getElementById('sm-price').textContent = brl(cents);
}
async function confirmBuyStorage() {
  const permanent = document.getElementById('sm-permanent').checked && !!_galleryExpiresAt;
  const gb = parseFloat(document.getElementById('sm-gb').value) || 0;
  if (!permanent && gb <= 0) { toast('Escolha ao menos uma opção'); return; }
  toast('Abrindo pagamento...');
  try {
    const r = await fetch(STORAGE_CHECKOUT_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: _galleryToken, visitor_id: getVisitorId(),
        permanent, quota_mb: Math.round(gb * 1024),
        origin: location.href.split('?')[0]
      })
    });
    const d = await r.json();
    if (d.init_point) location.href = d.init_point;
    else toast('Pagamento indisponível no momento.');
  } catch (e) { toast('Falha ao iniciar o pagamento.'); reportError('checkout-storage', e.message); }
}
function handleStorageReturn(params) {
  if (params.get('paid') !== '1') return;
  const oid = params.get('o');
  if (!oid) return;
  let tries = 0;
  const iv = setInterval(async () => {
    tries++;
    try {
      const { data } = await sb.rpc('get_storage_order_status', { p_token: _galleryToken, p_order_id: oid });
      if (data && data.status === 'approved') {
        clearInterval(iv);
        if (data.permanent) {
          _galleryExpiresAt = null;
          _dismissExpiryBanner();
          toast('Galeria permanente ativada!', 'success');
          alert('Compra confirmada ✅\n\nEsta galeria não expira mais. Guarde o link!');
        } else {
          toast('Espaço liberado!', 'success');
          alert('Compra confirmada ✅\n\nO espaço já foi liberado neste álbum.');
        }
        refreshVideoQuota();
        return;
      }
      if (data && data.error) { clearInterval(iv); return; } // não é pedido de storage — ignora (paywall de fotos cuida disso)
    } catch (e) {}
    if (tries >= 8) clearInterval(iv);
  }, 3000);
}

// ── AVISO DE EXPIRAÇÃO ──
// Marcos: 2 meses, 1 mês e depois a cada semana restante. O aviso reaparece
// a cada marco novo mesmo que o cliente já tenha fechado o anterior.
const EXPIRY_MILESTONES = [60, 30, 21, 14, 7];
function _expiryKey() { return 'lrp_exp_dismiss_' + (galleryId || _galleryToken || ''); }
function _dismissExpiryBanner() {
  const el = document.getElementById('expiry-banner');
  if (el) el.style.display = 'none';
}
function dismissExpiryBanner() {
  const m = document.getElementById('expiry-banner')?.dataset.milestone;
  try { if (m) localStorage.setItem(_expiryKey(), m); } catch (e) {}
  _dismissExpiryBanner();
}
function checkExpiryWarning(expiresAt) {
  _galleryExpiresAt = expiresAt ? new Date(expiresAt) : null;
  if (!_galleryExpiresAt) { _dismissExpiryBanner(); return; }  // permanente — nada a avisar

  const days = Math.ceil((_galleryExpiresAt - Date.now()) / 86400000);
  if (days <= 0) { _dismissExpiryBanner(); return; }           // já expirou: o overlay de expirada cuida disso

  // Menor marco que ainda cobre os dias restantes (60 -> 30 -> 21 -> 14 -> 7).
  const milestone = EXPIRY_MILESTONES.filter(m => days <= m).pop();
  if (!milestone) return;           // falta mais de 2 meses

  let dismissed = null;
  try { dismissed = localStorage.getItem(_expiryKey()); } catch (e) {}
  if (String(milestone) === dismissed) return;

  const el = document.getElementById('expiry-banner');
  if (!el) return;
  el.dataset.milestone = String(milestone);
  const quando = days === 1 ? 'amanhã'
    : days <= 14 ? `em ${days} dias`
    : days <= 45 ? `em ${Math.round(days / 7)} semanas`
    : `em ${Math.round(days / 30)} meses`;
  document.getElementById('expiry-text').innerHTML =
    `Esta galeria sai do ar <b>${quando}</b> (${_galleryExpiresAt.toLocaleDateString('pt-BR')}).`
    + ` Garanta o acesso para sempre por <b>${brl(PRICE_PERMANENT_CENTS)}</b>, pagamento único.`;
  el.style.display = 'flex';
  // Perto do fim fica vermelho em vez de âmbar.
  el.style.background = days <= 14 ? '#7f1d1d' : '#78350f';
}

// ── Upload do cliente contra a quota comprada ──
let _videoQuota = null;
async function refreshVideoQuota() {
  try {
    const { data, error } = await sb.rpc('get_video_quota', { p_token: _galleryToken });
    if (error || !data || data.error) return;
    _videoQuota = data;
    const btn = document.getElementById('drawer-add-video');
    if (btn) btn.style.display = data.quota_mb > 0 ? 'block' : 'none';
  } catch (e) {}
}
function pickClientVideo() {
  if (!_videoQuota || _videoQuota.remaining_bytes <= 0) { toast('Sem espaço disponível — compre mais armazenamento.'); return; }
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'video/*';
  input.onchange = () => { if (input.files[0]) uploadClientVideo(input.files[0]); };
  input.click();
}
async function uploadClientVideo(file) {
  if (file.size > _videoQuota.remaining_bytes) {
    toast(`Vídeo muito grande — sobram ${(_videoQuota.remaining_bytes / 1024 / 1024).toFixed(0)}MB de espaço.`, 'error');
    return;
  }
  toast('Enviando seu vídeo...', '');
  try {
    const url = URL.createObjectURL(file);
    const v = document.createElement('video');
    v.muted = true; v.src = url;
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = rej; });
    const duration = v.duration || null;
    v.currentTime = Math.min(1, duration / 2 || 0);
    await new Promise(res => { v.onseeked = res; });
    const canvas = document.createElement('canvas');
    canvas.width = v.videoWidth; canvas.height = v.videoHeight;
    canvas.getContext('2d').drawImage(v, 0, 0);
    const posterBlob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.85));
    URL.revokeObjectURL(url);

    // A chave só é aceita pelas RPCs se bater com esta galeria — não dá pra forjar.
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `client_video_${Date.now()}_${safe}`;
    const { data: sig, error: sigErr } = await sb.rpc('get_client_upload_sig', { p_token: _galleryToken, p_key: `galleries/${galleryId}/${key}`, p_size_bytes: file.size });
    if (sigErr || !sig || sig.error) { toast(sig?.error === 'quota_exceeded' ? 'Sem espaço suficiente.' : 'Erro ao autorizar envio.', 'error'); return; }

    const putRes = await fetch(`https://lrp-gallery-signed.lrp-gallery.workers.dev/${sig.key}?exp=${sig.exp}&sig=${sig.sig}`, { method: 'PUT', headers: { 'Content-Type': file.type || 'video/mp4' }, body: file });
    if (!putRes.ok) throw new Error('upload falhou');

    let thumbKey = null;
    if (posterBlob) {
      const { data: tsig } = await sb.rpc('get_client_upload_sig', { p_token: _galleryToken, p_key: `galleries/${galleryId}/${key}_poster.jpg`, p_size_bytes: posterBlob.size });
      if (tsig && !tsig.error) {
        const r2 = await fetch(`https://lrp-gallery-signed.lrp-gallery.workers.dev/${tsig.key}?exp=${tsig.exp}&sig=${tsig.sig}`, { method: 'PUT', headers: { 'Content-Type': 'image/jpeg' }, body: posterBlob });
        if (r2.ok) thumbKey = tsig.key;
      }
    }

    const { error: addErr } = await sb.rpc('add_client_video', {
      p_token: _galleryToken, p_key: sig.key, p_thumb_key: thumbKey,
      p_name: file.name, p_size_bytes: file.size, p_duration: duration
    });
    if (addErr) throw addErr;

    toast('Vídeo adicionado!', 'success');
    refreshVideoQuota();
    loadClientVideos(_galleryToken);
  } catch (e) {
    toast('Falha ao enviar o vídeo.', 'error');
    reportError('client-video-upload', e.message || String(e));
  }
}
