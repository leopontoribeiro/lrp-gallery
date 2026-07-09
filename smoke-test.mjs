// ============================================================
// LRP Gallery — Smoke test (verifica segurança + entrega assinada)
// Uso:  node smoke-test.mjs
//   SMOKE_TOKEN=<access_token> node smoke-test.mjs   (testa uma galeria real)
// Sai com código != 0 se algo essencial falhar.
// ============================================================
import { readFileSync } from 'node:fs';

const cfg = readFileSync(new URL('./supabase-config.js', import.meta.url), 'utf8');
const U   = cfg.match(/SUPABASE_URL\s*=\s*'([^']+)'/)[1];
const ANON= cfg.match(/SUPABASE_KEY\s*=\s*'([^']+)'/)[1];
const WORKER = 'https://lrp-gallery-signed.lrp-gallery.workers.dev';
const UA = { 'User-Agent': 'Mozilla/5.0' };
const H = { apikey: ANON, Authorization: `Bearer ${ANON}`, 'Content-Type': 'application/json' };

let pass = 0, fail = 0;
const ok  = (n) => { console.log(`  ✓ ${n}`); pass++; };
const bad = (n, d='') => { console.log(`  ✗ ${n} ${d}`); fail++; };

async function status(url, opt) { try { return (await fetch(url, opt)).status; } catch { return 0; } }
async function rpc(fn, body) {
  const r = await fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  return { status: r.status, data: r.ok ? await r.json() : null };
}

const SITE = 'https://www.souleandroribeiro.com.br/gallery';

console.log('ARQUIVOS JS (admin.html/gallery.html referenciam tudo que existe):');
for (const page of ['admin.html', 'gallery.html']) {
  const html = await fetch(`${SITE}/${page}`).then(r => r.ok ? r.text() : '');
  if (!html) { bad(`${page} não carregou`); continue; }
  const localScripts = [...html.matchAll(/<script src="([a-zA-Z0-9_-]+\.js)">/g)].map(m => m[1]);
  for (const f of new Set(localScripts)) {
    const s = await status(`${SITE}/${f}`);
    s === 200 ? ok(`${page} → ${f} (200)`) : bad(`${page} → ${f} não carregou`, `(${s})`);
  }
}

console.log('\nSEGURANÇA (chave anon):');
for (const t of ['galleries', 'photos', 'photo_events', 'client_errors', 'app_secrets']) {
  const s = await status(`${U}/rest/v1/${t}?select=*&limit=1`, { headers: H });
  (s === 401 || s === 403 || s === 404) ? ok(`${t} bloqueado (${s})`) : bad(`${t} exposto`, `(${s})`);
}
console.log('\nWORKER assinado:');
const naked = await status(`${WORKER}/galleries/x/y.jpg`, { headers: UA });
naked === 403 ? ok(`acesso sem assinatura negado (403)`) : bad('worker sem assinatura não deu 403', `(${naked})`);

const token = process.env.SMOKE_TOKEN;
if (token) {
  console.log('\nGALERIA (token fornecido):');
  const g = await rpc('get_public_gallery', { p_token: token });
  const row = g.data && g.data[0];
  if (row && !('access_token' in row) && !('password_hash' in row)) ok(`get_public_gallery ok (${row.name})`);
  else bad('get_public_gallery falhou/expôs campo', JSON.stringify(g).slice(0,80));

  const ph = await rpc('get_public_photos', { p_token: token, p_limit: 2 });
  const p = ph.data && ph.data[0];
  if (!p) { bad('get_public_photos não retornou fotos', JSON.stringify(ph).slice(0,80)); }
  else if (!/\/galleries\//.test(p.full_url)) { ok('galeria demo (picsum) — assinatura não se aplica'); }
  else {
    (/\?exp=.*&sig=/.test(p.full_url) && p.full_url.includes('lrp-gallery-signed'))
      ? ok('get_public_photos devolve URL assinada') : bad('get_public_photos sem URL assinada', p.full_url.slice(0,80));
    const sf = await status(p.full_url, { headers: UA });
    sf === 200 ? ok('foto assinada carrega (200)') : bad('foto assinada não carregou', `(${sf})`);
  }
} else {
  console.log('\n(defina SMOKE_TOKEN=<access_token> para testar uma galeria real)');
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} ok, ${fail} falha(s)`);
process.exit(fail === 0 ? 0 : 1);
