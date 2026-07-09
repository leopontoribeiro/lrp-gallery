// ============================================================
// LRP Gallery — Uploader CLI (envia para o R2 via worker assinado)
// Cria uma galeria nova a partir do nome de uma pasta e envia
// todas as fotos: original + thumbnail (.webp gerado com sharp).
//
// Uso:  node upload.mjs "/caminho/para/a/pasta"
// Requer no .env.upload:
//   SUPABASE_URL, SUPABASE_SERVICE_KEY
//   R2_UPLOAD_URL     (ex: https://lrp-gallery-signed.SEU-SUB.workers.dev)
//   R2_UPLOAD_SECRET  (mesmo UPLOAD_SECRET configurado no worker)
// ============================================================

import sharp from 'sharp';
import { readdir, readFile } from 'node:fs/promises';
import { basename, join, extname } from 'node:path';
import { randomBytes } from 'node:crypto';

const URL_BASE = process.env.SUPABASE_URL;
const SERVICE  = process.env.SUPABASE_SERVICE_KEY;
const R2_URL   = (process.env.R2_UPLOAD_URL || '').replace(/\/+$/, '');
const R2_SECRET= process.env.R2_UPLOAD_SECRET;
const SITE     = process.env.GALLERY_SITE || 'https://www.souleandroribeiro.com.br/gallery';

const C = { reset:'\x1b[0m', dim:'\x1b[2m', green:'\x1b[32m', red:'\x1b[31m', cyan:'\x1b[36m', yellow:'\x1b[33m', bold:'\x1b[1m' };
const log = (m) => console.log(m);
const die = (m) => { console.error(`${C.red}✗ ${m}${C.reset}`); process.exit(1); };

if (!URL_BASE || !SERVICE) die('Faltam SUPABASE_URL / SUPABASE_SERVICE_KEY no .env.upload.');
if (!R2_URL || !R2_SECRET) die('Faltam R2_UPLOAD_URL / R2_UPLOAD_SECRET no .env.upload (worker de imagens).');

const folder = process.argv[2];
if (!folder) die('Informe a pasta de fotos. Ex: node upload.mjs "/Users/voce/Desktop/Casamento"');

const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.tif', '.tiff']);
const CT = { '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.webp':'image/webp', '.gif':'image/gif', '.tif':'image/tiff', '.tiff':'image/tiff' };

const headersJSON = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function slugify(name) {
  return name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

async function api(path, init = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { ...init, headers: { ...headersJSON, ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}

async function uniqueSlug(base) {
  let slug = base || 'galeria', suffix = 2;
  while (true) {
    const rows = await api(`galleries?slug=eq.${encodeURIComponent(slug)}&select=id`);
    if (!rows || rows.length === 0) return slug;
    slug = `${base}-${suffix++}`;
  }
}

// Envia bytes para o R2 via worker (PUT autenticado). Devolve a URL pública canônica.
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
  let entries;
  try { entries = await readdir(folder, { withFileTypes: true }); }
  catch { die(`Pasta não encontrada: ${folder}`); }

  const files = entries
    .filter(e => e.isFile() && IMG_EXT.has(extname(e.name).toLowerCase()) && !e.name.startsWith('.'))
    .map(e => e.name).sort(collator.compare);
  if (files.length === 0) die('Nenhuma imagem encontrada na pasta.');

  const galleryName = basename(folder).trim();
  log(`\n${C.bold}${C.cyan}LRP Gallery — Uploader (R2)${C.reset}`);
  log(`${C.dim}Pasta:${C.reset}   ${folder}`);
  log(`${C.dim}Galeria:${C.reset} ${galleryName}`);
  log(`${C.dim}Fotos:${C.reset}   ${files.length}\n`);

  const slug = await uniqueSlug(slugify(galleryName));
  const access_token = randomBytes(16).toString('hex');
  const [gallery] = await api('galleries', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ name: galleryName, slug, status: 'live', access_token }),
  });
  log(`${C.green}✓ Galeria criada${C.reset} ${C.dim}(slug: ${slug})${C.reset}\n`);

  const BATCH = 4;
  let done = 0, failed = 0; const failures = [];
  for (let i = 0; i < files.length; i += BATCH) {
    await Promise.all(files.slice(i, i + BATCH).map(async (name, k) => {
      const position = i + k;
      try {
        const bytes = await readFile(join(folder, name));
        let width = null, height = null;
        try { const m = await sharp(bytes).metadata(); width = m.width || null; height = m.height || null; } catch {}

        // thumb .webp (800x800 contain, q80) — igual ao pipeline atual
        let thumbBytes;
        try { thumbBytes = await sharp(bytes).resize(800, 800, { fit: 'inside' }).webp({ quality: 80 }).toBuffer(); }
        catch { thumbBytes = null; }

        const safe = name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const baseKey  = `galleries/${gallery.id}/${Date.now()}_${position}_${safe}`;
        const fullKey  = baseKey;
        const thumbKey = `${baseKey}_thumb.webp`;
        const ct = CT[extname(name).toLowerCase()] || 'application/octet-stream';

        const fullUrl  = await putR2(fullKey, bytes, ct);
        const thumbUrl = thumbBytes ? await putR2(thumbKey, thumbBytes, 'image/webp') : fullUrl;

        await api('photos', {
          method: 'POST',
          body: JSON.stringify({
            gallery_id: gallery.id, filename: name,
            storage_path: fullKey, thumb_url: thumbUrl, full_url: fullUrl,
            size_bytes: bytes.length, position, width, height,
          }),
        });
        done++;
      } catch (err) {
        failed++; failures.push(name);
        process.stderr.write(`\n${C.red}✗ ${name}: ${err.message}${C.reset}\n`);
      }
    }));
    const pct = Math.round(((done + failed) / files.length) * 100);
    process.stdout.write(`\r${C.cyan}Enviando...${C.reset} ${done + failed}/${files.length} (${pct}%)   `);
  }

  const [firstPhoto] = await api(`photos?gallery_id=eq.${gallery.id}&order=position.asc&limit=1&select=id`);
  if (firstPhoto) await api(`galleries?id=eq.${gallery.id}`, { method: 'PATCH', body: JSON.stringify({ cover_photo_id: firstPhoto.id }) });

  const link = `${SITE}/gallery.html?t=${access_token}`;
  log(`\n\n${C.green}${C.bold}✓ Concluído!${C.reset} ${done} foto(s) enviada(s)${failed ? `, ${C.red}${failed} falha(s)${C.reset}` : ''}.`);
  if (failed) log(`${C.yellow}Falhas:${C.reset} ${failures.join(', ')}`);
  log(`\n${C.bold}Link do cliente:${C.reset}\n${C.cyan}${link}${C.reset}\n`);
}

main().catch(err => die(err.message));
