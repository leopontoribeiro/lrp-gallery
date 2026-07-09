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

async function signCoverUrl(key, secret) {
  const exp = Math.floor(Date.now() / 1000) + COVER_TTL;
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(key + ':' + exp));
  const sig = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${R2_BASE}/${key}?exp=${exp}&sig=${sig}`;
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

  const res = await next();
  if (!token) return res;
  const ct = res.headers.get('content-type') || '';
  if (!ct.includes('text/html')) return res;

  try {
    const SB = env.SUPABASE_URL || FALLBACK_SUPABASE_URL;
    const KEY = env.SUPABASE_ANON || FALLBACK_SUPABASE_ANON;
    const secret = env.SIGNING_SECRET;

    const r = await fetch(`${SB}/rest/v1/rpc/get_og_meta`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: KEY, Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ p_token: token }),
    });
    if (!r.ok) return res;
    const rows = await r.json();
    const meta = Array.isArray(rows) ? rows[0] : rows;
    if (!meta || !meta.name) return res; // token não é de galeria (ex.: grupo) → não mexe

    const title = `${meta.name} · @eusouleandroribeiro`;
    let imageUrl = '';
    if (meta.cover_key && secret) imageUrl = await signCoverUrl(meta.cover_key, secret);

    let rw = new HTMLRewriter()
      .on('title', new SetText(title))
      .on('meta#og-title', new SetAttr(title))
      .on('meta#tw-title', new SetAttr(title))
      .on('meta#og-url', new SetAttr(url.toString()));
    if (imageUrl) {
      rw = rw.on('meta#og-image', new SetAttr(imageUrl)).on('meta#tw-image', new SetAttr(imageUrl));
    }
    return rw.transform(res);
  } catch (e) {
    return res;
  }
}
