// ============================================================
// LRP Gallery — utilitários puros (sem estado nem DOM de app).
// Carregado ANTES do script principal; expõe funções globais.
// Extraído de gallery.html no início da modularização.
// ============================================================

// Formata centavos em BRL.
function brl(cents) { return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }

// Carrega um <script> externo sob demanda.
function _loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej;
    document.head.appendChild(s);
  });
}

// Distância euclidiana entre dois descritores faciais (128-d).
function _dist(a, b) { let s = 0; for (let i = 0; i < 128; i++) { const x = a[i] - b[i]; s += x * x; } return Math.sqrt(s); }
function _minDist(d, list) { let m = Infinity; for (const r of list) { const v = _dist(d, r); if (v < m) m = v; } return m; }

// Identificador anônimo do visitante (localStorage).
function getVisitorId() {
  const KEY = 'lrp_vid';
  let vid = localStorage.getItem(KEY);
  if (!vid) {
    vid = (crypto.randomUUID
      ? crypto.randomUUID()
      : 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2));
    localStorage.setItem(KEY, vid);
  }
  return vid;
}

// SHA-256 hex (para verificação de senha no cliente).
async function hashSHA256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Escapa texto antes de inserir em innerHTML/atributo — nome de arquivo e de
// galeria vêm do upload (controlado pelo fotógrafo), mas ainda assim não
// deve virar HTML/atributo cru na tela do cliente.
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

// Toast simples. `type` ('success'|'error') é opcional — CSS de cada página
// decide se estiliza a variante; a base (#toast + .show) é comum às duas.
function toast(msg, type = '') {
  const t = document.getElementById('toast-box');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ` ${type}` : '');
  setTimeout(() => t.className = 'toast', 3000);
}
