// ── QR CODE por galeria ──
// Extraído de admin.html (fatia de modularização). Depende de globals do
// script principal (galleries, currentGalleryId, BASE_URL, toast).
let _qrLibReady = false;
function _loadQRLib() {
  if (_qrLibReady) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js';
    s.onload = () => { _qrLibReady = true; res(); }; s.onerror = rej;
    document.head.appendChild(s);
  });
}
async function showQR() {
  const g = galleries.find(g => g.id === currentGalleryId);
  if (!g) { toast('Abra uma galeria primeiro', 'error'); return; }
  const link = `${BASE_URL}/gallery.html?t=${g.access_token}`;
  try { await _loadQRLib(); } catch (e) { toast('Falha ao carregar o gerador de QR', 'error'); return; }
  const wrap = document.getElementById('qr-canvas-wrap');
  wrap.innerHTML = '';
  const canvas = document.createElement('canvas');
  wrap.appendChild(canvas);
  QRCode.toCanvas(canvas, link, { width: 240, margin: 1 }, err => { if (err) toast('Erro ao gerar QR', 'error'); });
  document.getElementById('qr-title').textContent = `QR — ${g.name || 'álbum'}`;
  document.getElementById('qr-modal').dataset.name = (g.name || 'album').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  document.getElementById('qr-modal').style.display = 'flex';
}
function closeQR() { document.getElementById('qr-modal').style.display = 'none'; }
function downloadQR() {
  const canvas = document.querySelector('#qr-canvas-wrap canvas');
  if (!canvas) return;
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = `qr-${document.getElementById('qr-modal').dataset.name || 'album'}.png`;
  a.click();
}
