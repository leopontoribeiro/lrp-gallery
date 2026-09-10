// ============================================================
// LRP Gallery — Backfill de taken_at (data de captura via EXIF)
// Preenche taken_at das fotos que ainda não têm (migração 39). Sem isso,
// essas fotos continuam ordenadas só por "position" (ordem de upload, não
// de captura) — o mesmo padrão do backfill-dimensions.mjs, trocando sharp
// (dimensão) por exifr (data EXIF).
//
// Uso:  set -a; . ./.env.upload; set +a; node backfill-taken-at.mjs
// Requer: SUPABASE_URL, SUPABASE_SERVICE_KEY, R2_UPLOAD_URL
//         e o SIGNING_SECRET em r2-signed-worker/SIGNING_SECRET.local.txt
// ============================================================

import exifr from 'exifr';
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
  const r = await fetch(`${U}/rest/v1/photos?select=id,full_url&taken_at=is.null&full_url=like.*galleries*&order=id.asc&limit=100`, { headers: H });
  if (!r.ok) throw new Error(`select ${r.status} ${await r.text()}`);
  return r.json();
}
async function patchTakenAt(id, iso) {
  const r = await fetch(`${U}/rest/v1/photos?id=eq.${id}`, {
    method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify({ taken_at: iso }),
  });
  if (!r.ok) throw new Error(`patch ${r.status}`);
}
async function takenAtOf(rawUrl) {
  const r = await fetch(signedUrl(rawUrl), { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`fetch ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const tags = await exifr.parse(buf, { pick: ['DateTimeOriginal', 'CreateDate', 'ModifyDate'] });
  const d = tags?.DateTimeOriginal || tags?.CreateDate || tags?.ModifyDate;
  return (d instanceof Date && !isNaN(d)) ? d.toISOString() : null;
}

const main = async () => {
  const failed = new Set();   // erro de rede/leitura — tenta de novo na próxima rodada
  const noExif = new Set();   // sem EXIF (recomprimida/sem câmera) — não tem o que preencher
  let done = 0;
  while (true) {
    const rows = (await getPage()).filter(r => !failed.has(r.id) && !noExif.has(r.id));
    if (rows.length === 0) break;
    for (let i = 0; i < rows.length; i += 6) {
      await Promise.all(rows.slice(i, i + 6).map(async r => {
        try {
          const iso = await takenAtOf(r.full_url);
          if (iso) { await patchTakenAt(r.id, iso); done++; } else noExif.add(r.id);
        } catch (e) { failed.add(r.id); process.stderr.write(`\n✗ id=${r.id}: ${e.message}`); }
      }));
      process.stdout.write(`\rPreenchidas: ${done}  (sem EXIF: ${noExif.size}, falhas: ${failed.size})   `);
    }
  }
  console.log(`\n✓ Concluído. ${done} preenchidas, ${noExif.size} sem EXIF (ficam pelo position), ${failed.size} falha(s) de rede — rode de novo se falhas > 0.`);
};
main().catch(e => { console.error('\n✗', e.message); process.exit(1); });
