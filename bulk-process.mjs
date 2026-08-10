// ============================================================
// LRP Gallery — Processamento em lote (até ~1500 fotos)
//
// Lê uma pasta com fotos de tamanhos/formatos variados, converte cada uma
// pra JPEG com o MENOR tamanho de arquivo que caiba no teto configurado
// (1.2–2MB), renomeia em sequência com um nome-base, e:
//   --out "<pasta>"   salva tudo numa pasta local (sem tocar no Supabase/R2)
//   --gallery          cria uma galeria nova e já sobe cada foto pro R2
//
// Uso:
//   node bulk-process.mjs "<pasta origem>" --name "Casamento" --max-mb 1.5 --out "<pasta destino>"
//   node bulk-process.mjs "<pasta origem>" --name "Casamento" --max-mb 1.5 --gallery
//
// Requer sharp (já usado por upload.mjs). Modo --gallery requer o mesmo
// .env.upload do upload.mjs (SUPABASE_URL, SUPABASE_SERVICE_KEY, R2_UPLOAD_URL,
// R2_UPLOAD_SECRET). Modo --out não precisa de nenhuma credencial.
// ============================================================

import sharp from 'sharp';
import exifr from 'exifr';
import { initFaceApi, detectFacesInJpeg, toDetectionJpeg, buildIndexPayload } from './face-index-node.mjs';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { basename, join, extname } from 'node:path';
import { randomBytes } from 'node:crypto';

const C = { reset:'\x1b[0m', dim:'\x1b[2m', green:'\x1b[32m', red:'\x1b[31m', cyan:'\x1b[36m', yellow:'\x1b[33m', bold:'\x1b[1m' };
const log = (m) => console.log(m);
const die = (m) => { console.error(`${C.red}✗ ${m}${C.reset}`); process.exit(1); };

// ── Argumentos ──
const args = process.argv.slice(2);
const folder = args[0];
if (!folder || folder.startsWith('--')) {
  die('Informe a pasta de origem. Ex: node bulk-process.mjs "/caminho/fotos" --name "Casamento" --max-mb 1.5 --out "/caminho/destino"');
}
function flag(name) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
}
const baseName = (flag('name') || '').trim();
const maxMb = parseFloat(flag('max-mb') || '1.5');
const outDir = flag('out');
const toGallery = args.includes('--gallery');

if (!baseName) die('Informe --name "Nome base" (ex: --name "Casamento Ana e João").');
if (!Number.isFinite(maxMb) || maxMb < 1.2 || maxMb > 2) die('--max-mb precisa estar entre 1.2 e 2.');
if (!outDir && !toGallery) die('Escolha um destino: --out "<pasta>" (salvar local) ou --gallery (subir pra galeria nova).');
if (outDir && toGallery) die('Use só um destino por vez: --out OU --gallery, não os dois.');

const MAX_BYTES = Math.round(maxMb * 1024 * 1024);
const IMG_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.tif', '.tiff', '.bmp', '.avif']);
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

async function captureTime(path) {
  try {
    const tags = await exifr.parse(path, ['DateTimeOriginal', 'CreateDate']);
    const d = tags?.DateTimeOriginal || tags?.CreateDate;
    return d instanceof Date && !isNaN(d) ? d.getTime() : null;
  } catch { return null; }
}
async function sortByCaptureTime(folder, names) {
  const withTime = [];
  const CONC = 8;
  for (let i = 0; i < names.length; i += CONC) {
    const batch = names.slice(i, i + CONC);
    const times = await Promise.all(batch.map(n => captureTime(join(folder, n))));
    batch.forEach((n, k) => withTime.push({ name: n, time: times[k] }));
  }
  withTime.sort((a, b) => {
    if (a.time != null && b.time != null) return a.time - b.time;
    if (a.time != null) return -1;
    if (b.time != null) return 1;
    return collator.compare(a.name, b.name);
  });
  return withTime.map(x => x.name);
}

function sanitizeName(s) {
  return String(s).replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim();
}

// Comprime pra JPEG buscando o maior arquivo possível ainda dentro do teto —
// primeiro reduz qualidade (rápido, não redecodifica), só reduz dimensão se
// nem a qualidade mínima da rodada couber (fotos gigantes de câmera/RAW).
async function compressToTarget(inputBuffer, maxBytes) {
  const meta = await sharp(inputBuffer, { failOn: 'none' }).rotate().metadata();
  const width = meta.width || 3000;
  const qualities = [92, 85, 78, 70, 62, 54, 46];

  let scale = 1;
  for (let round = 0; round < 7; round++) {
    const targetW = Math.max(500, Math.round(width * scale));
    for (const q of qualities) {
      const buf = await sharp(inputBuffer, { failOn: 'none' }).rotate()
        .resize({ width: targetW, withoutEnlargement: true })
        .jpeg({ quality: q, mozjpeg: true })
        .toBuffer();
      if (buf.length <= maxBytes) return { buf, width: targetW, quality: q, over: false };
    }
    scale *= 0.82;
  }
  // Não coube nem no piso — devolve o menor conseguido, mas avisa.
  const targetW = Math.max(400, Math.round(width * scale));
  const buf = await sharp(inputBuffer, { failOn: 'none' }).rotate()
    .resize({ width: targetW, withoutEnlargement: true })
    .jpeg({ quality: 40, mozjpeg: true }).toBuffer();
  return { buf, width: targetW, quality: 40, over: buf.length > maxBytes };
}

// ── Modo --gallery: mesmas credenciais/rotina do upload.mjs ──
let api, putR2, SITE;
async function initGalleryMode() {
  const URL_BASE = process.env.SUPABASE_URL;
  const SERVICE  = process.env.SUPABASE_SERVICE_KEY;
  const R2_URL   = (process.env.R2_UPLOAD_URL || '').replace(/\/+$/, '');
  const R2_SECRET= process.env.R2_UPLOAD_SECRET;
  SITE = process.env.GALLERY_SITE || 'https://www.souleandroribeiro.com.br/gallery';
  if (!URL_BASE || !SERVICE) die('Faltam SUPABASE_URL / SUPABASE_SERVICE_KEY no .env.upload.');
  if (!R2_URL || !R2_SECRET) die('Faltam R2_UPLOAD_URL / R2_UPLOAD_SECRET no .env.upload.');

  const headersJSON = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
  api = async (path, init = {}) => {
    const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { ...init, headers: { ...headersJSON, ...(init.headers || {}) } });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  };
  putR2 = async (key, bytes, contentType) => {
    const res = await fetch(`${R2_URL}/${key}`, {
      method: 'PUT', headers: { 'content-type': contentType, 'x-upload-secret': R2_SECRET }, body: bytes,
    });
    if (!res.ok) throw new Error(`R2 PUT ${res.status} ${await res.text()}`);
    return `${R2_URL}/${key}`;
  };
}

function slugify(name) {
  return name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}
async function uniqueSlug(base) {
  let slug = base || 'galeria', suffix = 2;
  while (true) {
    const rows = await api(`galleries?slug=eq.${encodeURIComponent(slug)}&select=id`);
    if (!rows || rows.length === 0) return slug;
    slug = `${base}-${suffix++}`;
  }
}

async function main() {
  let entries;
  try { entries = await readdir(folder, { withFileTypes: true }); }
  catch { die(`Pasta não encontrada: ${folder}`); }

  const allNames = entries.filter(e => e.isFile() && !e.name.startsWith('.')).map(e => e.name);
  const files = await sortByCaptureTime(folder, allNames.filter(n => IMG_EXT.has(extname(n).toLowerCase())));
  const skippedFormats = allNames.filter(n => !IMG_EXT.has(extname(n).toLowerCase()));
  const heicSkipped = skippedFormats.filter(n => /\.hei[cf]$/i.test(n));

  if (files.length === 0) die('Nenhuma imagem em formato suportado encontrada na pasta.');

  log(`\n${C.bold}${C.cyan}LRP Gallery — Processamento em lote${C.reset}`);
  log(`${C.dim}Pasta origem:${C.reset}  ${folder}`);
  log(`${C.dim}Fotos:${C.reset}         ${files.length}`);
  log(`${C.dim}Nome-base:${C.reset}     ${baseName}`);
  log(`${C.dim}Teto por foto:${C.reset} ${maxMb}MB`);
  log(`${C.dim}Destino:${C.reset}       ${toGallery ? 'nova galeria (R2)' : outDir}\n`);
  if (heicSkipped.length) {
    log(`${C.yellow}⚠ ${heicSkipped.length} arquivo(s) .heic/.heif ignorado(s) — este conversor não lê HEIC (limitação da lib sharp). Exporte como JPG antes (Preview.app → Exportar) e rode de novo.${C.reset}\n`);
  } else if (skippedFormats.length) {
    log(`${C.yellow}⚠ ${skippedFormats.length} arquivo(s) em formato não suportado ignorado(s).${C.reset}\n`);
  }

  if (toGallery) await initGalleryMode();

  let gallery = null, access_token = null;
  if (toGallery) {
    const slug = await uniqueSlug(slugify(baseName));
    access_token = randomBytes(16).toString('hex');
    [gallery] = await api('galleries', {
      method: 'POST', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ name: baseName, slug, status: 'live', access_token }),
    });
    log(`${C.green}✓ Galeria criada${C.reset} ${C.dim}(slug: ${slug})${C.reset}\n`);
  } else {
    await mkdir(outDir, { recursive: true });
  }

  const pad = Math.max(4, String(files.length).length);
  const safeBase = sanitizeName(baseName) || 'foto';

  // Reconhecimento facial local — só faz sentido quando vai pra galeria.
  const wantFaces = args.includes('--faces');
  const faceApi = (toGallery && wantFaces) ? await initFaceApi() : { ok: false, reason: 'não pedido' };
  if (toGallery && wantFaces && !faceApi.ok) log(`${C.yellow}Reconhecimento facial indisponível (${faceApi.reason}).${C.reset}`);
  else if (toGallery && wantFaces) log(`${C.dim}Reconhecimento facial: ligado.${C.reset}`);
  const faceRows = []; const facePhotoIds = []; let faceFailed = 0;

  const BATCH = 4;
  let done = 0, failed = 0, overTarget = 0;
  const failures = [];

  for (let i = 0; i < files.length; i += BATCH) {
    await Promise.all(files.slice(i, i + BATCH).map(async (name, k) => {
      const position = i + k;
      const seq = String(position + 1).padStart(pad, '0');
      const newName = `${safeBase} ${seq}.jpg`;
      try {
        const original = await readFile(join(folder, name));
        const { buf, width: outW, over } = await compressToTarget(original, MAX_BYTES);
        if (over) overTarget++;

        if (toGallery) {
          let bWidth = outW, bHeight = null;
          try { const m = await sharp(buf).metadata(); bHeight = m.height || null; } catch {}

          let thumbBytes;
          try { thumbBytes = await sharp(buf).resize(800, 800, { fit: 'inside' }).webp({ quality: 80 }).toBuffer(); }
          catch { thumbBytes = null; }

          const baseKey  = `galleries/${gallery.id}/${Date.now()}_${position}_${newName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
          const thumbKey = `${baseKey}_thumb.webp`;
          const fullUrl  = await putR2(baseKey, buf, 'image/jpeg');
          const thumbUrl = thumbBytes ? await putR2(thumbKey, thumbBytes, 'image/webp') : fullUrl;

          const [photo] = await api('photos', {
            method: 'POST', headers: { Prefer: 'return=representation' },
            body: JSON.stringify({
              gallery_id: gallery.id, filename: newName,
              storage_path: baseKey, thumb_url: thumbUrl, full_url: fullUrl,
              size_bytes: buf.length, position, width: bWidth, height: bHeight,
            }),
          });

          // Índice facial durante o envio (mesmo formato do painel).
          if (faceApi && faceApi.ok && photo && photo.id) {
            try {
              const found = await detectFacesInJpeg(faceApi, await toDetectionJpeg(sharp, buf));
              for (const f of found) faceRows.push({ p: photo.id, d: f.d, b: f.b });
              facePhotoIds.push(photo.id);
            } catch (e) { faceFailed++; }
          }
        } else {
          await writeFile(join(outDir, newName), buf);
        }
        done++;
      } catch (err) {
        failed++; failures.push(`${name}: ${err.message}`);
      }
    }));
    const pct = Math.round(((done + failed) / files.length) * 100);
    process.stdout.write(`\r${C.cyan}Processando...${C.reset} ${done + failed}/${files.length} (${pct}%)   `);
  }

  if (toGallery && done > 0) {
    const [firstPhoto] = await api(`photos?gallery_id=eq.${gallery.id}&order=position.asc&limit=1&select=id`);
    if (firstPhoto) await api(`galleries?id=eq.${gallery.id}`, { method: 'PATCH', body: JSON.stringify({ cover_photo_id: firstPhoto.id }) });

    if (faceApi.ok && facePhotoIds.length) {
      try {
        await api('face_indexes', {
          method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({ gallery_id: gallery.id, ...buildIndexPayload(faceRows, facePhotoIds) }),
        });
        log(`\n${C.green}✓ Índice facial:${C.reset} ${faceRows.length} rosto(s) em ${facePhotoIds.length} foto(s)`
          + (faceFailed ? ` ${C.yellow}(${faceFailed} não processada(s))${C.reset}` : ''));
      } catch (e) {
        log(`\n${C.yellow}Índice facial não pôde ser salvo (${e.message}). Abra a galeria no painel para gerar.${C.reset}`);
      }
    }
  }

  log(`\n\n${C.green}${C.bold}✓ Concluído!${C.reset} ${done} foto(s) processada(s)${failed ? `, ${C.red}${failed} falha(s)${C.reset}` : ''}.`);
  if (overTarget) log(`${C.yellow}⚠ ${overTarget} foto(s) não couberam no teto de ${maxMb}MB mesmo na qualidade mínima (dimensão original muito grande) — foram salvas do jeito mais leve possível.${C.reset}`);
  if (failed) log(`${C.yellow}Falhas:${C.reset}\n  ${failures.join('\n  ')}`);
  if (toGallery && gallery) {
    const link = `${SITE}/gallery.html?t=${access_token}`;
    log(`\n${C.bold}Link do cliente:${C.reset}\n${C.cyan}${link}${C.reset}\n`);
  } else {
    log(`\n${C.bold}Pasta de saída:${C.reset}\n${C.cyan}${outDir}${C.reset}\n`);
  }
}

main().catch(err => die(err.message));
