// Backfill inicial do bucket de BACKUP: chama /backup-now em lotes resumíveis
// até done:true. Resiliente a 503 intermitente + checkpoint local (retoma).
// Uso: node backfill-backup.mjs   (rode quantas vezes precisar; continua de onde parou)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const up = readFileSync(new URL('./r2-signed-worker/SIGNING_SECRET.local.txt', import.meta.url), 'utf8').match(/UPLOAD_SECRET=(\S+)/)[1];
const W = 'https://lrp-gallery-signed.lrp-gallery.workers.dev/backup-now';
const CKPT = new URL('./.backfill-checkpoint', import.meta.url);
const N = 40;                 // lotes menores: get+put por objeto é pesado
let after = existsSync(CKPT) ? readFileSync(CKPT, 'utf8').trim() : '';
let copied = 0, skipped = 0, batches = 0;
const t0 = Date.now();
if (after) console.log('retomando do checkpoint:', after.slice(-40));

async function batch(after) {
  for (let attempt = 1; ; attempt++) {          // retry por lote (não perde o cursor)
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 180000);
    try {
      const r = await fetch(`${W}?n=${N}&after=${encodeURIComponent(after)}`,
        { method: 'POST', headers: { 'x-upload-secret': up }, signal: ac.signal });
      clearTimeout(to);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) {
      clearTimeout(to);
      if (attempt >= 40) throw e;               // muito paciente: 503 é transitório
      const wait = Math.min(2000 * attempt, 20000);
      console.log(`  lote falhou (${e.message}); esperando ${wait/1000}s e tentando de novo (${attempt+1})...`);
      await new Promise(res => setTimeout(res, wait));
    }
  }
}

for (;;) {
  const j = await batch(after);
  copied += j.copied; skipped += j.skipped; batches++; after = j.last;
  writeFileSync(CKPT, after);                    // checkpoint após cada lote OK
  console.log(`lote ${batches}: +${j.copied} copiadas, ${j.skipped} já ok | total copiadas=${copied} puladas=${skipped} | ${((Date.now()-t0)/1000).toFixed(0)}s`);
  if (j.done) break;
}
console.log(`\n✅ backfill concluído: ${copied} copiadas, ${skipped} já existiam, ${batches} lotes, ${((Date.now()-t0)/1000).toFixed(0)}s`);
