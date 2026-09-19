// ============================================================
// Cloudflare Pages Function (raiz) — injeta og:title / og:image no HTML
// da galeria ANTES de entregar, para o robô do WhatsApp/Facebook/Google
// (que NÃO executam JavaScript) mostrarem nome + capa no preview.
//
// Roda em toda requisição, mas SÓ age quando há ?t=<token> e a resposta
// é HTML. Em qualquer outro caso passa direto (custo ~zero).
//
// Variáveis de ambiente no Cloudflare Pages (Settings > Environment variables):
//   SIGNING_SECRET  = o MESMO segredo do worker de imagens (assina a capa)
//   SUPABASE_URL    = opcional (tem fallback)
//   SUPABASE_ANON   = opcional (tem fallback)
// ============================================================

const FALLBACK_SUPABASE_URL = 'https://vtblxwaxwuztehtxkygp.supabase.co';
const FALLBACK_SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0Ymx4d2F4d3V6dGVodHhreWdwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5NDQzMjMsImV4cCI6MjA5NjUyMDMyM30.0oscbNInwJzc2YN5eDYN76IBXvR0cTDbaLe4LDe0aKw';
const R2_BASE = 'https://lrp-gallery-signed.lrp-gallery.workers.dev';
const COVER_TTL = 90 * 24 * 60 * 60; // 90 dias

// A URL da capa aponta pro modo ?og=1 do worker: JPEG reduzido (máx 1200px).
// O robô do WhatsApp não renderiza WebP e ignora imagens pesadas — servir o
// original de 5-10MB fazia o card sair sem foto.
// exp é arredondado pra "fatias" de 1 dia: a URL fica estável, então o cache
// do WhatsApp e da borda continua valendo entre um compartilhamento e outro.
async function signCoverUrl(key, secret) {
  const DAY = 86400;
  const exp = (Math.floor(Date.now() / 1000 / DAY) * DAY) + COVER_TTL;
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(key + ':' + exp + ':og'));
  const sig = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${R2_BASE}/${encodeURI(key)}?exp=${exp}&sig=${sig}&og=1`;
}

class SetAttr {
  constructor(val) { this.val = val; }
  element(el) { if (this.val) el.setAttribute('content', this.val); }
}
class SetText {
  constructor(val) { this.val = val; }
  element(el) { if (this.val) el.setInnerContent(this.val); }
}

export async function onRequest(context) {
  const { request, next, env } = context;
  const url = new URL(request.url);
  const token = url.searchParams.get('t');

  let res = await next();
  const ct = res.headers.get('content-type') || '';

  // Câmera só é permitida em /gallery (seleção por rosto usa selfie) — bloqueada
  // no resto do site. Não dá pra fazer isso por rota só no _headers: Cloudflare
  // Pages SOMA os headers de regras que colidem em vez de sobrescrever, então
  // duas Permissions-Policy juntas (uma delas negando) travam a câmera em
  // qualquer caso. Aqui a gente reescreve o header explicitamente por path.
  if (ct.includes('text/html')) {
    // O link que sai do admin é /gallery/gallery.html?t=... (BASE_URL já
    // termina em /gallery). A regex antiga só cobria /gallery e /gallery.html,
    // então a câmera ficava BLOQUEADA justamente no link real do cliente.
    const needsCamera = /(^|\/)gallery(\.html)?$/.test(url.pathname);
    const headers = new Headers(res.headers);
    headers.set('Permissions-Policy', needsCamera
      ? 'camera=(self), microphone=(), geolocation=()'
      : 'camera=(), microphone=(), geolocation=()');
    res = new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }

  if (!token || !ct.includes('text/html')) return res;

  try {
    const SB = env.SUPABASE_URL || FALLBACK_SUPABASE_URL;
    const KEY = env.SUPABASE_ANON || FALLBACK_SUPABASE_ANON;
    const secret = env.SIGNING_SECRET;

    const r = await fetch(`${SB}/rest/v1/rpc/get_og_meta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ p_token: token }),
    });
    if (!r.ok) return withDebug(res, 'rpc-' + r.status);
    const rows = await r.json();
    const meta = Array.isArray(rows) ? rows[0] : rows;
    if (!meta || !meta.name) return withDebug(res, 'no-meta'); // token não existe/não está live (get_og_meta já tenta galeria e grupo)

    const pageTitle = `${meta.name} · @eusouleandroribeiro`;
    // og:site_name já é "@eusouleandroribeiro" — repetir no og:title fazia o
    // WhatsApp mostrar o nome duplicado no card de preview do link.
    const ogTitle = meta.name;
    let imageUrl = '';
    if (meta.cover_key && secret) imageUrl = await signCoverUrl(meta.cover_key, secret);

    // Diagnóstico rápido: `curl -sI "<link>" | grep x-og` diz em qual etapa
    // parou, sem precisar abrir o depurador do Facebook.
    const debug = imageUrl ? 'ok' : (!meta.cover_key ? 'sem-cover-key' : 'sem-SIGNING_SECRET');
    res = withDebug(res, debug);

    let rw = new HTMLRewriter()
      .on('title', new SetText(pageTitle))
      .on('meta#og-title', new SetAttr(ogTitle))
      .on('meta#tw-title', new SetAttr(ogTitle))
      .on('meta#og-url', new SetAttr(url.toString()));
    if (imageUrl) {
      rw = rw
        .on('meta#og-image', new SetAttr(imageUrl))
        .on('meta#og-image-secure', new SetAttr(imageUrl))
        .on('meta#tw-image', new SetAttr(imageUrl));
    }
    return rw.transform(res);
  } catch (e) {
    return withDebug(res, 'erro: ' + (e && e.message));
  }
}

function withDebug(res, value) {
  const headers = new Headers(res.headers);
  headers.set('x-og', value);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
