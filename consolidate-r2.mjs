// ============================================================
// LRP Gallery — Consolidação para o R2
// Copia as fotos que estão no Supabase Storage para o R2 (via worker),
// gera o thumbnail .webp e reescreve full_url/thumb_url/width/height.
// Idempotente: fotos já no R2 são ignoradas (o filtro é pela URL).
//
// Uso:  set -a; . ./.env.upload; set +a; node consolidate-r2.mjs
// ============================================================

import sharp from 'sharp';

const U   = process.env.SUPABASE_URL;
const K   = process.env.SUPABASE_SERVICE_KEY;
const R2  = (process.env.R2_UPLOAD_URL || '').replace(/\/+$/, '');
const UPS = process.env.R2_UPLOAD_SECRET;
const R2_BASE = 'https://lrp-gallery-r2.lrp-gallery.workers.dev'; // base gravada no banco (o assinador ignora o domínio)
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

if (!U || !K || !R2 || !UPS) { console.error('✗ Faltam variáveis do .env.upload (SUPABASE_*, R2_UPLOAD_*).'); process.exit(1); }
const H = { apikey: K, Authorization: `Bearer ${K}`, 'Content-Type': 'application/json' };

async function sget(qs) {
  const r = await fetch(`${U}/rest/v1/${qs}`, { headers: H });
  if (!r.ok) throw new Error(`select ${r.status} ${await r.text()}`);
  return r.json();
}
async function spatch(id, body) {
  const r = await fetch(`${U}/rest/v1/photos?id=eq.${id}`, {
    method: 'PATCH', headers: { ...H, Prefer: 'return=minimal' }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`patch ${r.status} ${await r.text()}`);
}
async function putR2(key, bytes, contentType) {
  for (let a = 0; a < 3; a++) {
    const r = await fetch(`${R2}/${key}`, {
      method: 'PUT', headers: { 'content-type': contentType, 'x-upload-secret': UPS, 'User-Agent': UA }, body: bytes,
    });
    if (r.ok) return;
    if (a === 2) throw new Error(`R2 PUT ${r.status} ${await r.text()}`);
    await new Promise(s => setTimeout(s, 500 * (a + 1)));
  }
}
async function download(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`download ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

const ctOf = (name) => {
  const e = (name.split('.').pop() || '').toLowerCase();
  return { jpg:'image/jpeg', jpeg:'image/jpeg', png:'image/png', webp:'image/webp', gif:'image/gif', tif:'image/tiff', tiff:'image/tiff' }[e] || 'application/octet-stream';
};

async function main() {
  // total a migrar
  const head = await fetch(`${U}/rest/v1/photos?select=id&full_url=like.*storage/v1*`, { headers: { ...H, Prefer: 'count=exact', Range: '0-0' } });
  const total = Number((head.headers.get('content-range') || '/0').split('/')[1]) || 0;
  console.log(`Fotos no Supabase Storage a migrar: ${total}\n`);

  let done = 0, failed = 0; const fails = [];
  while (true) {
    // sempre pega o "topo" — as já migradas saem do filtro
    const rows = await sget(`photos?select=id,filename,storage_path,full_url,width,height&full_url=like.*storage/v1*&order=id.asc&limit=40`);
    const pending = rows.filter(r => !fails.includes(r.id));
    if (pending.length === 0) break;

    for (let i = 0; i < pending.length; i += 3) {
      await Promise.all(pending.slice(i, i + 3).map(async (p) => {
        const key = p.storage_path;
        try {
          const orig = await download(p.full_url);
          let w = p.width, h = p.height;
          if (!w || !h) { try { const m = await sharp(orig).metadata(); w = m.width || null; h = m.height || null; } catch {} }
          let thumb; try { thumb = await sharp(orig).resize(800, 800, { fit: 'inside' }).webp({ quality: 80 }).toBuffer(); } catch { thumb = null; }

          await putR2(key, orig, ctOf(p.filename || key));
          if (thumb) await putR2(`${key}_thumb.webp`, thumb, 'image/webp');

          await spatch(p.id, {
            full_url:  `${R2_BASE}/${key}`,
            thumb_url: thumb ? `${R2_BASE}/${key}_thumb.webp` : `${R2_BASE}/${key}`,
            width: w, height: h,
          });
          done++;
        } catch (e) {
          failed++; fails.push(p.id);
          process.stderr.write(`\n✗ ${key}: ${e.message}\n`);
        }
      }));
      process.stdout.write(`\rMigradas: ${done}/${total}  (falhas: ${failed})   `);
    }
  }
  console.log(`\n\n✓ Concluído. ${done} migradas, ${failed} falha(s).`);
  if (fails.length) console.log('IDs com falha:', fails.join(', '));
}
main().catch(e => { console.error('\n✗', e.message); process.exit(1); });
