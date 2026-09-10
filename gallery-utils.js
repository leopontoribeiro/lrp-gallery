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

// Encolhe a fonte de um título até caber na largura do container, sem
// nunca partir uma palavra no meio (ex.: "@eusouleandroribeiro" tem que
// ficar inteiro numa linha, mesmo em telas estreitas). Combinar com
// word-break:keep-all no CSS — sem isso o navegador quebraria a palavra
// em vez de só ela ficar mais larga que o container.
function fitTitleText(el, minPx = 15) {
  if (!el) return;
  el.style.fontSize = '';
  let size = parseFloat(getComputedStyle(el).fontSize);
  let guard = 0;
  // Margem de 3px: scrollWidth/clientWidth arredondam pra inteiro e podem
  // reportar "cabe" com 1px de sobra que na prática ainda corta a última letra.
  while (el.scrollWidth > el.clientWidth - 3 && size > minPx && guard < 60) {
    size -= 1;
    el.style.fontSize = size + 'px';
    guard++;
  }
}

// Uma foto pode ter várias etiquetas de grupo — guardadas como texto
// separado por vírgula na mesma coluna group_name (sem mudar o schema).
function parseTags(s) { return String(s || '').split(',').map(t => t.trim()).filter(Boolean); }
function joinTags(arr) { return arr.join(','); }

// Extrai a data de eventos do tipo "NOME-13JUL26" / "NOME 15JUL26" do nome
// da galeria/grupo, pra ordenar os álbuns na ordem cronológica do evento
// (não pela data de criação no banco, que segue a ordem de upload).
const _EVENT_MONTHS = { JAN:0, FEV:1, FEB:1, MAR:2, ABR:3, APR:3, MAI:4, MAY:4, JUN:5, JUL:6, AGO:7, AUG:7, SET:8, SEP:8, OUT:9, OCT:9, NOV:10, DEZ:11, DEC:11 };
function parseEventDate(name) {
  const m = String(name || '').toUpperCase().match(/(\d{1,2})\s*[-\/]?\s*([A-Z]{3})\s*[-\/]?\s*(\d{2,4})/);
  if (!m) return null;
  const mon = _EVENT_MONTHS[m[2]];
  if (mon === undefined) return null;
  let year = parseInt(m[3], 10); if (year < 100) year += 2000;
  const d = new Date(year, mon, parseInt(m[1], 10));
  return isNaN(d.getTime()) ? null : d;
}
function sortByCreatedDesc(list) {
  return list.slice().sort((a, b) => {
    const t = new Date(b.created_at) - new Date(a.created_at);
    return t !== 0 ? t : String(a.name || '').localeCompare(String(b.name || ''));
  });
}
function sortByEventDate(list, nameKey = 'name') {
  return list.slice().sort((a, b) => {
    const da = parseEventDate(a[nameKey]), db = parseEventDate(b[nameKey]);
    if (da && db) return da - db;
    if (da) return -1;
    if (db) return 1;
    return String(a[nameKey] || '').localeCompare(String(b[nameKey] || ''));
  });
}

// Data de captura real da foto (EXIF DateTimeOriginal), pra ordenar a
// galeria pela hora que a câmera gravou — não pela ordem de upload (que é
// só a ordem em que os arquivos foram selecionados no Finder/picker, sem
// relação garantida com a hora real; ver migração 39). Só existe no admin
// (exifr.js carregado lá, não no gallery.html do cliente). Se a foto não
// tiver EXIF (recomprimida, print, sem câmera), volta null — a foto cai no
// fallback por position (ver get_public_photos).
async function extractTakenAt(file) {
  if (typeof exifr === 'undefined') return null;
  try {
    const tags = await exifr.parse(file, { pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate'] });
    const d = tags?.DateTimeOriginal || tags?.CreateDate || tags?.ModifyDate;
    return (d instanceof Date && !isNaN(d)) ? d.toISOString() : null;
  } catch (e) { return null; }
}

// Toast simples. `type` ('success'|'error') é opcional — CSS de cada página
// decide se estiliza a variante; a base (#toast + .show) é comum às duas.
function toast(msg, type = '') {
  const t = document.getElementById('toast-box');
  t.textContent = msg;
  t.className = 'toast show' + (type ? ` ${type}` : '');
  setTimeout(() => t.className = 'toast', 3000);
}
