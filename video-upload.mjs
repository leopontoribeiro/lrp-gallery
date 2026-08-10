// ============================================================
// LRP Gallery — Vídeo do grupo via ffmpeg local (Rota 3)
// Converte um vídeo (até ~10min) pra MP4 H.264/AAC padrão (faststart —
// toca sem baixar tudo primeiro), sobe pro mesmo R2 das fotos e associa
// ao grupo escolhido (gallery_groups.video_url/video_thumb_url).
//
// Uso:  node video-upload.mjs "/caminho/do/video.mov"
// Requer ffmpeg + ffprobe instalados (brew install ffmpeg) e .env.upload
// (mesmo arquivo do upload.mjs/bulk-process.mjs).
// ============================================================

import { readFile, unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import readline from 'node:readline';

const C = { reset:'\x1b[0m', dim:'\x1b[2m', green:'\x1b[32m', red:'\x1b[31m', cyan:'\x1b[36m', yellow:'\x1b[33m', bold:'\x1b[1m' };
const log = (m) => console.log(m);
const die = (m) => { console.error(`${C.red}✗ ${m}${C.reset}`); process.exit(1); };

const env = {};
try {
  for (const line of (await readFile(new URL('./.env.upload', import.meta.url), 'utf8')).split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const [k, ...rest] = t.split('=');
    env[k] = rest.join('=');
  }
} catch { die('Arquivo .env.upload não encontrado (mesmo usado pelo upload.mjs).'); }

const SB = env.SUPABASE_URL, SERVICE = env.SUPABASE_SERVICE_KEY;
const R2_URL = (env.R2_UPLOAD_URL || '').replace(/\/+$/, ''), R2_SECRET = env.R2_UPLOAD_SECRET;
if (!SB || !SERVICE) die('Faltam SUPABASE_URL / SUPABASE_SERVICE_KEY no .env.upload.');
if (!R2_URL || !R2_SECRET) die('Faltam R2_UPLOAD_URL / R2_UPLOAD_SECRET no .env.upload.');

const inputPath = process.argv[2];
if (!inputPath) die('Uso: node video-upload.mjs "/caminho/do/video.mov"');

function which(cmd) { return spawnSync('which', [cmd]).status === 0; }
if (!which('ffmpeg') || !which('ffprobe')) die('ffmpeg não encontrado. Instale com: brew install ffmpeg');

const headersJSON = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
async function api(path, init = {}) {
  const res = await fetch(`${SB}/rest/v1/${path}`, { ...init, headers: { ...headersJSON, ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}
async function putR2(key, bytes, contentType) {
  const res = await fetch(`${R2_URL}/${key}`, { method: 'PUT', headers: { 'content-type': contentType, 'x-upload-secret': R2_SECRET }, body: bytes });
  if (!res.ok) throw new Error(`R2 PUT ${res.status} ${await res.text()}`);
  return `${R2_URL}/${key}`;
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(res => rl.question(q, res));

function ffprobeDuration(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return parseFloat(r.stdout.toString().trim()) || 0;
}
function runFfmpeg(args, label) {
  log(`${C.dim}${label}...${C.reset}`);
  const r = spawnSync('ffmpeg', args, { stdio: ['ignore', 'ignore', 'inherit'] });
  if (r.status !== 0) throw new Error(`ffmpeg falhou (${label})`);
}

async function main() {
  const groups = await api('gallery_groups?deleted_at=is.null&select=id,name&order=created_at.desc');
  if (!groups.length) die('Nenhum grupo encontrado. Crie um grupo no painel admin primeiro.');
  log(`\n${C.bold}${C.cyan}LRP Gallery — Vídeo do grupo${C.reset}\n`);
  log('Grupos disponíveis:');
  groups.forEach((g, i) => log(`  ${i + 1}) ${g.name}`));
  const idx = await ask('\nNúmero do grupo: ');
  const group = groups[parseInt(idx, 10) - 1];
  if (!group) die('Opção inválida.');

  const kids = await api(`galleries?gallery_group_id=eq.${group.id}&deleted_at=is.null&select=id&order=created_at.asc&limit=1`);
  if (!kids.length) die(`O grupo "${group.name}" ainda não tem nenhum álbum — crie um no painel admin primeiro.`);
  const galleryId = kids[0].id;

  const dur = ffprobeDuration(inputPath);
  if (!dur) die('Não consegui ler o vídeo (arquivo inválido ou corrompido?).');
  log(`${C.dim}Duração:${C.reset} ${Math.round(dur)}s`);
  if (dur > 600) {
    const ok = await ask(`${C.yellow}Vídeo tem ${(dur / 60).toFixed(1)} min — acima do recomendado (10 min). Continuar? (s/N): ${C.reset}`);
    if (!/^s/i.test(ok)) { rl.close(); die('Cancelado.'); }
  }
  rl.close();

  const stamp = Date.now();
  const outPath = join(tmpdir(), `lrp-video-${stamp}.mp4`);
  const posterPath = join(tmpdir(), `lrp-poster-${stamp}.jpg`);

  // H.264/AAC padrão, faststart (toca sem baixar tudo), largura máx 1920 —
  // formato que qualquer navegador reconhece, independente do arquivo original.
  runFfmpeg(['-y', '-i', inputPath,
    '-c:v', 'libx264', '-preset', 'faster', '-crf', '20',
    '-vf', "scale='min(1920,iw)':-2",
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', outPath
  ], 'Convertendo vídeo (pode demorar alguns minutos)');

  runFfmpeg(['-y', '-ss', String(Math.min(1, dur / 2)), '-i', outPath, '-frames:v', '1', '-q:v', '3', posterPath], 'Gerando thumbnail');

  log(`${C.dim}Enviando pro armazenamento...${C.reset}`);
  const safe = basename(inputPath).replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.[^.]+$/, '');
  const baseKey = `galleries/${galleryId}/video_${stamp}_${safe}.mp4`;
  const videoUrl = await putR2(baseKey, await readFile(outPath), 'video/mp4');
  const posterUrl = await putR2(`${baseKey}_poster.jpg`, await readFile(posterPath), 'image/jpeg');

  await api(`gallery_groups?id=eq.${group.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ video_url: videoUrl, video_thumb_url: posterUrl, video_filename: basename(inputPath) }),
  });

  await unlink(outPath).catch(() => {});
  await unlink(posterPath).catch(() => {});

  log(`\n${C.green}${C.bold}✓ Pronto!${C.reset} Vídeo do grupo "${group.name}" atualizado.`);
}

main().catch(e => { rl.close(); die(e.message); });
