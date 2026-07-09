// ============================================================
// LRP Gallery — Backfill de dimensões (width/height)
// Preenche width/height das fotos sem dimensão. Busca as imagens
// pelo worker assinado (o worker público antigo foi removido).
//
// Uso:  set -a; . ./.env.upload; set +a; node backfill-dimensions.mjs
// Requer: SUPABASE_URL, SUPABASE_SERVICE_KEY, R2_UPLOAD_URL
//         e o SIGNING_SECRET em r2-signed-worker/SIGNING_SECRET.local.txt
// ============================================================

import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';

const U    = process.env.SUPABASE_URL;
const K    = process.env.SUPABASE_SERVICE_KEY;
const BASE = (process.env.R2_UPLOAD_URL || '').replace(/\/+$/, '');
const UA   = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
let SECRET = '';
try { SECRET = readFileSync('r2-signed-worker/SIGNING_SECRET.local.txt', 'utf8').split('SIGNING_SECRET=')[1].split(/\s/)[0].trim(); } catch {}

if (!U || !K || !BASE || !SECRET) { console.error('✗ Faltam SUPABASE_URL/SERVICE_KEY, R2_UPLOAD_URL ou SIGNING_SECRET.local.txt'); process.exit(1); }
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' };

function signedUrl(rawUrl) {
  const key = rawUrl.replace(/^https?:\/\/[^/]+\//, '').split('?')[0];
  const win = 21600;
  const exp = (Math.floor(Date.now() / 1000 / win) + 2) * win;
  const sig = createHmac('sha256', SECRET).update(`${key}:${exp}`).digest('hex');
  return `${BASE}/${key}?exp=${exp}&sig=${sig}`;
}

async function getPage() {
  const r = await fetch(`${U}/rest/v1/photos?select=id,full_url&width=is.null&full_url=like.*galleries*&order=id.asc&limit=100`, { headers: H });
  if (!r.ok) throw new Error(`select ${r.status} ${await r.text()}`);
  return r.json();
}
async function patchDims(id, w, h) {
  const r = await fetch(`${U}/rest/v1/photos?id=eq.${id}`, {
    method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ width: w, height: h }),
  });
  if (!r.ok) throw new Error(`patch ${r.status}`);
}
async function dimsOf(rawUrl) {
  const r = await fetch(signedUrl(rawUrl), { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`fetch ${r.status}`);
  const m = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
  return { w: m.width || null, h: m.height || null };
}

const main = async () => {
  const failed = new Set();
  let done = 0;
  while (true) {
    const rows = (await getPage()).filter(r => !failed.has(r.id));
    if (rows.length === 0) break;
    for (let i = 0; i < rows.length; i += 6) {
      await Promise.all(rows.slice(i, i + 6).map(async r => {
        try {
          const { w, h } = await dimsOf(r.full_url);
          if (w && h) { await patchDims(r.id, w, h); done++; } else failed.add(r.id);
        } catch (e) { failed.add(r.id); process.stderr.write(`\n✗ id=${r.id}: ${e.message}`); }
      }));
      process.stdout.write(`\rAtualizadas: ${done}  (falhas: ${failed.size})   `);
    }
  }
  console.log(`\n✓ Concluído. ${done} atualizadas, ${failed.size} falha(s).`);
};
main().catch(e => { console.error('\n✗', e.message); process.exit(1); });
