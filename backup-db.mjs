// ============================================================
// LRP Gallery — Backup do banco (galleries, photos, photo_events)
// Exporta tudo em JSON e envia pro bucket PRIVADO de BACKUP via Worker
// (backups/db/AAAA-MM-DD.json). Roda no GitHub Actions (cron) ou local.
//
// Variáveis (env, ou lidas de .env.upload no local):
//   SUPABASE_URL, SUPABASE_SERVICE_KEY, R2_UPLOAD_URL, R2_UPLOAD_SECRET
// ============================================================
import { readFileSync, existsSync } from 'node:fs';

function env(name) {
  if (process.env[name]) return process.env[name];
  const p = new URL('./.env.upload', import.meta.url);
  if (existsSync(p)) { const m = readFileSync(p, 'utf8').match(new RegExp(name + '=(\\S+)')); if (m) return m[1]; }
  const s = new URL('./r2-signed-worker/SIGNING_SECRET.local.txt', import.meta.url);
  if (existsSync(s)) { const m = readFileSync(s, 'utf8').match(new RegExp(name + '=(\\S+)')); if (m) return m[1]; }
  throw new Error('faltando variável ' + name);
}

const U = env('SUPABASE_URL'), KEY = env('SUPABASE_SERVICE_KEY');
const WORKER = env('R2_UPLOAD_URL'), UP = env('R2_UPLOAD_SECRET');
const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };

async function dump(table) {
  const rows = []; const page = 1000;
  for (let from = 0; ; from += page) {
    const r = await fetch(`${U}/rest/v1/${table}?select=*&order=id.asc`, {
      headers: { ...H, Range: `${from}-${from + page - 1}` }
    });
    if (!r.ok) throw new Error(`${table} ${r.status} ${await r.text()}`);
    const batch = await r.json();
    rows.push(...batch);
    if (batch.length < page) break;
  }
  return rows;
}

const galleries = await dump('galleries');
const photos = await dump('photos');
let photo_events = [];
try { photo_events = await dump('photo_events'); } catch (e) { console.log('aviso: photo_events', e.message); }

const payload = {
  generated_at: new Date().toISOString(),
  counts: { galleries: galleries.length, photos: photos.length, photo_events: photo_events.length },
  galleries, photos, photo_events,
};
const body = JSON.stringify(payload);
const date = new Date().toISOString().slice(0, 10);
const key = `backups/db/${date}.json`;

const put = await fetch(`${WORKER}/${key}`, {
  method: 'PUT',
  headers: { 'x-upload-secret': UP, 'content-type': 'application/json', 'User-Agent': 'Mozilla/5.0' },
  body,
});
if (!put.ok) { console.error('PUT falhou', put.status, await put.text()); process.exit(1); }
console.log(`✅ backup enviado: ${key} (${(body.length / 1048576).toFixed(2)} MB) —`,
  `galleries=${galleries.length} photos=${photos.length} events=${photo_events.length}`);
