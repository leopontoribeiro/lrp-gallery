// ============================================================
// LRP Gallery — Adiciona fotos a uma galeria JÁ EXISTENTE
// (variação de upload.mjs, que sempre cria galeria nova)
//
// Uso: node add-to-gallery.mjs <gallery_id> <arquivo1> <arquivo2> ...
// Requer as mesmas variáveis de .env.upload que upload.mjs
// ============================================================

import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';

const URL_BASE = process.env.SUPABASE_URL;
const SERVICE  = process.env.SUPABASE_SERVICE_KEY;
const R2_URL   = (process.env.R2_UPLOAD_URL || '').replace(/\/+$/, '');
const R2_SECRET= process.env.R2_UPLOAD_SECRET;

const C = { reset:'\x1b[0m', dim:'\x1b[2m', green:'\x1b[32m', red:'\x1b[31m', cyan:'\x1b[36m', yellow:'\x1b[33m', bold:'\x1b[1m' };
const log = (m) => console.log(m);
const die = (m) => { console.error(`${C.red}✗ ${m}${C.reset}`); process.exit(1); };

if (!URL_BASE || !SERVICE) die('Faltam SUPABASE_URL / SUPABASE_SERVICE_KEY no .env.upload.');
if (!R2_URL || !R2_SECRET) die('Faltam R2_UPLOAD_URL / R2_UPLOAD_SECRET no .env.upload.');

const galleryId = process.argv[2];
const files = process.argv.slice(3);
if (!galleryId || files.length === 0) die('Uso: node add-to-gallery.mjs <gallery_id> <arquivo1> <arquivo2> ...');

const CT = { '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.webp':'image/webp', '.gif':'image/gif', '.tif':'image/tiff', '.tiff':'image/tiff' };

const headersJSON = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };

async function api(path, init = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { ...init, headers: { ...headersJSON, ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function putR2(key, bytes, contentType) {
  const res = await fetch(`${R2_URL}/${key}`, {
    method: 'PUT',
    headers: { 'content-type': contentType, 'x-upload-secret': R2_SECRET },
    body: bytes,
  });
  if (!res.ok) throw new Error(`R2 PUT ${res.status} ${await res.text()}`);
  return `${R2_URL}/${key}`;
}

async function main() {
  const [gallery] = await api(`galleries?id=eq.${galleryId}&select=id,name,cover_photo_id`);
  if (!gallery) die(`Galeria não encontrada: ${galleryId}`);

  const [last] = await api(`photos?gallery_id=eq.${galleryId}&select=position&order=position.desc&limit=1`);
  let nextPosition = last ? last.position + 1 : 0;

  log(`\n${C.bold}${C.cyan}LRP Gallery — Adicionar fotos${C.reset}`);
  log(`${C.dim}Galeria:${C.reset} ${gallery.name}`);
  log(`${C.dim}Fotos:${C.reset}   ${files.length} (a partir da posição ${nextPosition})\n`);

  let done = 0, failed = 0; const failures = [];
  for (const filePath of files) {
    const name = basename(filePath);
    const position = nextPosition++;
    try {
      const bytes = await readFile(filePath);
      let width = null, height = null;
      try { const m = await sharp(bytes).metadata(); width = m.width || null; height = m.height || null; } catch {}

      let thumbBytes;
      try { thumbBytes = await sharp(bytes).resize(800, 800, { fit: 'inside' }).webp({ quality: 80 }).toBuffer(); }
      catch { thumbBytes = null; }

      const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const baseKey  = `galleries/${gallery.id}/${Date.now()}_${position}_${safe}`;
      const thumbKey = `${baseKey}_thumb.webp`;
      const ct = CT[extname(name).toLowerCase()] || 'application/octet-stream';

      const fullUrl  = await putR2(baseKey, bytes, ct);
      const thumbUrl = thumbBytes ? await putR2(thumbKey, thumbBytes, 'image/webp') : fullUrl;

      await api('photos', {
        method: 'POST',
        body: JSON.stringify({
          gallery_id: gallery.id, filename: name,
          storage_path: baseKey, thumb_url: thumbUrl, full_url: fullUrl,
          size_bytes: bytes.length, position, width, height,
        }),
      });
      done++;
      process.stdout.write(`\r${C.cyan}Enviando...${C.reset} ${done + failed}/${files.length}   `);
    } catch (err) {
      failed++; failures.push(name);
      process.stderr.write(`\n${C.red}✗ ${name}: ${err.message}${C.reset}\n`);
    }
  }

  if (!gallery.cover_photo_id) {
    const [firstPhoto] = await api(`photos?gallery_id=eq.${gallery.id}&order=position.asc&limit=1&select=id`);
    if (firstPhoto) await api(`galleries?id=eq.${gallery.id}`, { method: 'PATCH', body: JSON.stringify({ cover_photo_id: firstPhoto.id }) });
  }

  log(`\n\n${C.green}${C.bold}✓ Concluído!${C.reset} ${done} foto(s) enviada(s)${failed ? `, ${C.red}${failed} falha(s)${C.reset}` : ''}.`);
  if (failed) log(`${C.yellow}Falhas:${C.reset} ${failures.join(', ')}`);
}

main().catch(err => die(err.message));
