// ============================================================
// LRP Gallery — Worker de imagens ASSINADAS (R2)
//
// GET  /<key>?exp=<epoch>&sig=<hmac>   → serve a foto se a assinatura
//      for válida e não expirada. Se SIGNING_SECRET não estiver definido,
//      serve sem exigir assinatura (modo compatível para testes).
// PUT  /<key>   (header x-upload-secret: <UPLOAD_SECRET>)  → grava no R2.
// DELETE /<key> (x-upload-secret OU ?exp=&sig= assinado com suffix ':del')
//      → apaga de PHOTOS e BACKUP.
//
// Segredos (via `wrangler secret put`):
//   SIGNING_SECRET  — mesmo valor guardado no Supabase (app_secrets)
//   UPLOAD_SECRET   — usado pelo upload.mjs para enviar fotos
// Binding R2:  PHOTOS  (definido no wrangler.toml)
// ============================================================

// client-zip@nozip64 (1.x) de propósito: a versão 2.x gera SEMPRE arquivos
// ZIP64 marcados como "requer versão 4.5", e o Utilitário de Compactação do
// macOS recusa esses arquivos ("tipo de arquivo inadequado"). A 1.x gera ZIP
// clássico (versão 2.0), que o Finder abre. Custo: o ZIP não pode passar de
// 4GB — por isso a verificação de tamanho em handleZip.
import { downloadZip } from 'client-zip';
import { PhotonImage, resize, watermark as photonWatermark, SamplingFilter } from '@cf-wasm/photon';

// Origens que podem falar com o Worker via browser (fetch/XHR e canvas com
// crossOrigin — usado por cor dominante e recorte de rosto). '*' era aberto
// demais: qualquer site podia embutir chamadas autenticadas por engano.
const ALLOWED_ORIGINS = ['https://www.souleandroribeiro.com.br', 'https://lrp-gallery.pages.dev'];
function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  return /^https:\/\/[a-z0-9-]+\.lrp-gallery\.pages\.dev$/.test(origin); // deploys de preview
}
function corsFor(req) {
  const origin = req.headers.get('Origin');
  return {
    'Access-Control-Allow-Origin': isAllowedOrigin(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET,HEAD,PUT,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'content-type,x-upload-secret',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const CORS = corsFor(req);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    const ip = req.headers.get('cf-connecting-ip') || 'anon';

    // ── ZIP server-side ──────────────────────────────────────
    // POST /zip  body: { keys[], names[], exp, sig }  (manifesto assinado
    // pelo Supabase). Monta o ZIP em streaming lendo do R2. Sem baixar
    // tudo pro navegador; escala pra 1500+ fotos.
    // Planejamento do download: divide o pedido em partes que cabem no ZIP
    // clássico (4GB) e no teto de subrequests do Worker. Devolve os intervalos
    // que o site deve pedir. Sem isso, álbum grande = arquivo corrompido.
    if (req.method === 'POST' && url.pathname === '/zip-plan') {
      return handleZipPlan(req, env, CORS);
    }
    if (req.method === 'POST' && url.pathname === '/zip') {
      if (env.ZIP_RL) {
        const { success } = await env.ZIP_RL.limit({ key: ip });
        if (!success) return new Response('rate limited', { status: 429, headers: { ...CORS, 'Retry-After': '60' } });
      }
      return handleZip(req, env, CORS);
    }

    // ── Backup: um lote resumível (para o backfill inicial) ──
    // POST /backup-now?after=<key>&n=<qtd>  (header x-upload-secret)
    // Copia até n objetos após 'after'. Devolve {last, done} para o loop.
    if (req.method === 'POST' && url.pathname === '/backup-now') {
      if (!env.UPLOAD_SECRET || req.headers.get('x-upload-secret') !== env.UPLOAD_SECRET)
        return new Response('forbidden', { status: 403, headers: CORS });
      const after = url.searchParams.get('after') || '';
      const n = Math.min(Math.max(Number(url.searchParams.get('n')) || 100, 1), 400);
      const r = await replicate(env, after, n);
      return new Response(JSON.stringify(r), { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
    }

    // ── Paywall: cria pedido + preferência do Mercado Pago ──
    if (req.method === 'POST' && url.pathname === '/checkout') {
      if (env.CHECKOUT_RL) {
        const { success } = await env.CHECKOUT_RL.limit({ key: ip });
        if (!success) return new Response('rate limited', { status: 429, headers: { ...CORS, 'Retry-After': '60' } });
      }
      return handleCheckout(req, env, url, CORS);
    }
    // ── Cliente compra armazenamento (estender prazo + quota de vídeo) ──
    if (req.method === 'POST' && url.pathname === '/checkout-storage') {
      if (env.CHECKOUT_RL) {
        const { success } = await env.CHECKOUT_RL.limit({ key: ip });
        if (!success) return new Response('rate limited', { status: 429, headers: { ...CORS, 'Retry-After': '60' } });
      }
      return handleStorageCheckout(req, env, url, CORS);
    }
    // ── Paywall: cliente perdeu o codigo -> reenvio por e-mail ──
    // Resposta SEMPRE generica: nao confirmamos se aquele e-mail comprou ou
    // nao (senao vira ferramenta de sondagem de quem esteve no evento).
    if (req.method === 'POST' && url.pathname === '/recover') {
      if (env.CHECKOUT_RL) {
        const { success } = await env.CHECKOUT_RL.limit({ key: ip });
        if (!success) return new Response('rate limited', { status: 429, headers: { ...CORS, 'Retry-After': '60' } });
      }
      return handleRecover(req, env, CORS);
    }
    // ── Paywall: webhook do Mercado Pago (confirma pagamento) ──
    if (url.pathname === '/mp-webhook') {
      return handleMpWebhook(req, env, url, CORS);
    }

    // key do objeto = caminho sem a barra inicial (ex: galleries/<id>/<arquivo>)
    const key = decodeURIComponent(url.pathname.replace(/^\/+/, ''));
    if (!key) return new Response('missing key', { status: 400, headers: CORS });

    // ── Upload autenticado ───────────────────────────────────
    // Dois modos: segredo estático (x-upload-secret, usado pelo upload.mjs
    // via CLI) OU assinatura HMAC de curta duração (?exp=&sig=, gerada pela
    // RPC get_upload_sig — usada pelo painel admin no navegador, que nunca
    // pode carregar o UPLOAD_SECRET estático).
    if (req.method === 'PUT') {
      const hasStaticSecret = env.UPLOAD_SECRET && req.headers.get('x-upload-secret') === env.UPLOAD_SECRET;
      let authorized = hasStaticSecret;
      if (!authorized) {
        const exp = url.searchParams.get('exp');
        const sig = url.searchParams.get('sig');
        if (exp && sig && Number(exp) >= Math.floor(Date.now() / 1000)) {
          authorized = await validSigAny(env, key, exp, sig);
        }
      }
      if (!authorized) return new Response('forbidden', { status: 403, headers: CORS });
      const contentType = req.headers.get('content-type') || 'application/octet-stream';
      // 'backups/...' (dumps do banco) vão direto pro bucket privado de BACKUP.
      if (key.startsWith('backups/') && env.BACKUP) {
        await env.BACKUP.put(key, req.body, { httpMetadata: { contentType } });
      } else {
        // Fotos NÃO são replicadas pro BACKUP — o usuário já mantém 2 outras
        // cópias fora do R2 (Google Drive + backup interno próprio), então
        // uma 3ª cópia aqui só dobrava o armazenamento cobrado sem adicionar
        // proteção real. Só PHOTOS é a fonte das fotos agora; BACKUP guarda
        // apenas os dumps do banco (branch 'backups/' acima) e os arquivos
        // de estado dos crons (_state/*.json).
        const buf = await req.arrayBuffer();
        await env.PHOTOS.put(key, buf, { httpMetadata: { contentType } });
      }
      return new Response('ok', { status: 200, headers: CORS });
    }

    // ── Delete autenticado ───────────────────────────────────
    // Mesmo esquema de auth do PUT, mas com suffix ':del' na assinatura HMAC —
    // isola o escopo da sig (uma assinatura de upload vazada não serve pra apagar).
    if (req.method === 'DELETE') {
      const hasStaticSecret = env.UPLOAD_SECRET && req.headers.get('x-upload-secret') === env.UPLOAD_SECRET;
      let authorized = hasStaticSecret;
      if (!authorized) {
        const exp = url.searchParams.get('exp');
        const sig = url.searchParams.get('sig');
        if (exp && sig && Number(exp) >= Math.floor(Date.now() / 1000)) {
          authorized = await validSigAny(env, key, exp, sig, ':del');
        }
      }
      if (!authorized) return new Response('forbidden', { status: 403, headers: CORS });
      await env.PHOTOS.delete(key);
      if (env.BACKUP) await env.BACKUP.delete(key);
      return new Response('ok', { status: 200, headers: CORS });
    }

    // ── Leitura (com verificação de assinatura, se habilitada) ─
    if (req.method === 'GET' || req.method === 'HEAD') {
      const wm = url.searchParams.get('wm') === '1';   // álbum com marca d'água
      // Capa do preview de link (WhatsApp/Facebook). O robô do WhatsApp
      // DESISTE de imagens grandes (na prática acima de ~600KB ele não
      // renderiza o card) e não lê WebP. Aqui devolvemos sempre um JPEG
      // reduzido (máx 1200px, ~150-250KB), cacheado na borda.
      const og = url.searchParams.get('og') === '1';
      // FAIL-CLOSED: sem SIGNING_SECRET não servimos nada (nunca vaza originais).
      if (!env.SIGNING_SECRET) return new Response('signing not configured', { status: 503, headers: CORS });
      {
        const exp = url.searchParams.get('exp');
        const sig = url.searchParams.get('sig');
        if (!exp || !sig) return new Response('missing signature', { status: 403, headers: CORS });
        if (Number(exp) < Math.floor(Date.now() / 1000)) return new Response('expired', { status: 403, headers: CORS });
        const ok = await validSigAny(env, key, exp, sig, wm ? ':wm' : (og ? ':og' : ''));
        if (!ok) return new Response('bad signature', { status: 403, headers: CORS });
      }

      // ── Capa reduzida pro preview de link ────────────────
      if (og) {
        const cache = caches.default;
        const cacheKey = new Request(url.toString(), { method: 'GET' });
        const hit = await cache.match(cacheKey);
        if (hit) return req.method === 'HEAD' ? new Response(null, { headers: hit.headers }) : hit;
        const obj = await env.PHOTOS.get(key);
        if (!obj) return new Response('not found', { status: 404, headers: CORS });
        const src = new Uint8Array(await obj.arrayBuffer());
        let out;
        // O photon decodifica pra RGBA cru: um JPEG de 24MP vira ~96MB e
        // estoura o limite de 128MB do isolate ("unreachable" do WASM).
        // Se acontecer, devolvemos o arquivo original em vez de 500 — o
        // preview pode não renderizar, mas nada quebra.
        try { out = await makeOgJpeg(src); }
        catch (e) { out = src; }
        const headers = new Headers(CORS);
        headers.set('Content-Type', out === src
          ? (obj.httpMetadata?.contentType || 'image/jpeg')
          : 'image/jpeg');
        headers.set('x-og-resized', out === src ? 'no' : 'yes');
        headers.set('Cache-Control', 'public, max-age=604800, immutable');
        const resp = new Response(out, { headers });
        ctx.waitUntil(cache.put(cacheKey, resp.clone()));
        return req.method === 'HEAD' ? new Response(null, { headers }) : resp.clone();
      }

      // ── Marca d'água server-side ──────────────────────────
      // Aplica a marca sob demanda e cacheia na borda (a janela de 6h mantém
      // a URL estável → só o primeiro visitante paga o processamento).
      if (wm) {
        const cache = caches.default;
        const cacheKey = new Request(url.toString(), { method: 'GET' });
        const hit = await cache.match(cacheKey);
        if (hit) return req.method === 'HEAD' ? new Response(null, { headers: hit.headers }) : hit;
        // Múltiplas requisições simultâneas pra mesma foto (link viral, ainda
        // sem cache) reaproveitam o mesmo cálculo em vez de rodar o WASM N
        // vezes em paralelo no mesmo isolate.
        const resp = await computeWatermarked(env, ctx, cache, cacheKey, key, CORS);
        return req.method === 'HEAD' ? new Response(null, { headers: resp.headers }) : resp.clone();
      }

      // Range (bytes=start-end): necessário pra vídeo dar seek/scrub sem
      // baixar o arquivo inteiro primeiro. Fotos ignoram (não mandam Range).
      let r2Range;
      const rangeHeader = req.headers.get('Range');
      if (rangeHeader) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
        if (m && (m[1] || m[2])) {
          if (m[1] && m[2]) r2Range = { offset: +m[1], length: +m[2] - +m[1] + 1 };
          else if (m[1]) r2Range = { offset: +m[1] };
          else r2Range = { suffix: +m[2] };
        }
      }

      const obj = await env.PHOTOS.get(key, r2Range ? { range: r2Range } : undefined);
      if (!obj) return new Response('not found', { status: 404, headers: CORS });
      const headers = new Headers(CORS);
      obj.writeHttpMetadata(headers);
      headers.set('etag', obj.httpEtag);
      headers.set('accept-ranges', 'bytes');
      headers.set('Cache-Control', 'public, max-age=86400, immutable');

      // 206 só quando o CLIENTE pediu Range (r2Range) — obj.range do R2 não é
      // um sinal confiável disso: testei ao vivo e ele vem preenchido mesmo
      // num get() sem range nenhum (descrevendo "o objeto inteiro").
      if (r2Range) {
        const total = obj.size;
        let start, len;
        if (obj.range) { start = obj.range.offset ?? 0; len = obj.range.length ?? (total - start); }
        else if ('offset' in r2Range) { start = r2Range.offset; len = r2Range.length ?? (total - start); }
        else { start = Math.max(0, total - r2Range.suffix); len = total - start; }
        headers.set('content-range', `bytes ${start}-${start + len - 1}/${total}`);
        headers.set('content-length', String(len));
        return new Response(req.method === 'HEAD' ? null : obj.body, { status: 206, headers });
      }
      return new Response(req.method === 'HEAD' ? null : obj.body, { headers });
    }

    return new Response('method not allowed', { status: 405, headers: CORS });
  },

  // Cron diário.
  async scheduled(event, env, ctx) {
    // Cron novo (a cada 10min, ver wrangler.toml): so o backfill de taken_at,
    // roda mais vezes pra zerar o backlog rapido sem competir com os jobs
    // diarios abaixo.
    if (event.cron === '*/10 * * * *') {
      ctx.waitUntil(backfillTakenAt(env));
      return;
    }
    // reconcile() (replicava PHOTOS -> BACKUP) foi desligado: o usuário
    // mantém as fotos em 2 outras cópias fora do R2 (Google Drive + backup
    // interno), então essa 3ª cópia só dobrava o armazenamento cobrado. A
    // função continua definida abaixo (histórico/caso precise reativar),
    // só não é mais chamada aqui.
    ctx.waitUntil(cleanupPendingOrders(env));
    ctx.waitUntil(retentionCleanup(env));
    ctx.waitUntil(backupDatabase(env));
    ctx.waitUntil(cleanupOldBackupDumps(env));
    ctx.waitUntil(purgeReplicatedPhotos(env));
    ctx.waitUntil(healthcheck(env));
  },
};

// Copia para BACKUP até 'n' objetos APÓS a key 'after' (resumível no nível do
// objeto via startAfter). Pula o que já existe com o mesmo tamanho.
// Devolve { last, done } para o chamador continuar o loop.
// Derivados (_thumb.jpg, _thumb.webp, _lg.jpg) são sempre recriáveis a
// partir do original que ainda está em PHOTOS — não precisam de uma segunda
// cópia em BACKUP. Sem isso, o backup replicava 3 arquivos por foto (original
// + thumb + lg) quando só o original é insubstituível se PHOTOS for perdido.
function _isReplicableDerivative(key) {
  return key.endsWith('_thumb.jpg') || key.endsWith('_thumb.webp') || key.endsWith('_lg.jpg');
}

async function replicate(env, after = '', n = 100) {
  if (!env.BACKUP) return { error: 'no BACKUP bucket' };
  const list = await env.PHOTOS.list({ startAfter: after || undefined, limit: n });
  let copied = 0, skipped = 0, failed = 0, last = after || '', failedKeys = [];
  for (const o of list.objects) {
    // Isola cada objeto: um problemático é pulado (não trava o lote nem o cursor).
    try {
      if (o.key.startsWith('backups/')) { last = o.key; continue; } // dumps não se replicam
      if (_isReplicableDerivative(o.key)) { last = o.key; continue; } // recriável a partir do original
      const b = await env.BACKUP.head(o.key);
      if (b && b.size === o.size) skipped++;
      else {
        const src = await env.PHOTOS.get(o.key);
        if (src) { await env.BACKUP.put(o.key, src.body, { httpMetadata: src.httpMetadata }); copied++; }
      }
    } catch (e) { failed++; failedKeys.push(o.key); }
    last = o.key;   // avança o cursor mesmo em falha
  }
  return { last, copied, skipped, failed, failedKeys, scanned: list.objects.length, done: !list.truncated };
}

// Reconciliação agendada: retoma do cursor salvo em BACKUP (_state/replica_after),
// processa um lote e regrava o cursor. Ao terminar a varredura, recomeça do zero.
// n = 200 varria 200 objetos/dia: numa base de dezenas de milhares de fotos,
// um ciclo completo levava mais de um ano — ou seja, a rede de segurança não
// protegia nada. 2000 por noite fecha um ciclo em semanas e cabe folgado no
// tempo do cron, porque o caso comum é HEAD + skip (o dual-write já copiou).
async function reconcile(env, n = 2000) {
  if (!env.BACKUP) return;
  const stObj = await env.BACKUP.get('_state/replica_after');
  let after = stObj ? await stObj.text() : '';
  const PAGE = 500;                 // o list() do R2 limita a 1000 por chamada
  const t0 = Date.now();
  const BUDGET_MS = 20000;          // folga dentro do tempo do cron
  let done = false, scanned = 0;
  const failedAll = [];

  while (scanned < n && Date.now() - t0 < BUDGET_MS) {
    const r = await replicate(env, after, PAGE);
    if (r.error) break;
    scanned += r.scanned;
    after = r.last;
    if (r.failedKeys && r.failedKeys.length) failedAll.push(...r.failedKeys);
    if (r.done) { done = true; break; }
  }

  // Terminou a varredura → recomeça do zero no próximo cron.
  await env.BACKUP.put('_state/replica_after', done ? '' : after);

  // Keys que falharam ficam registradas para uma 2ª passada manual.
  if (failedAll.length) {
    let prev = [];
    try { const o = await env.BACKUP.get('_state/failed.json'); if (o) prev = JSON.parse(await o.text()); } catch (e) {}
    const merged = [...new Set([...prev, ...failedAll])].slice(-500);
    await env.BACKUP.put('_state/failed.json', JSON.stringify(merged));
  }

  // Registro da última execução — sem isto você não sabe se o cron rodou.
  await env.BACKUP.put('_state/last_reconcile.json', JSON.stringify({
    at: new Date().toISOString(), scanned, done, falhas: failedAll.length,
    ms: Date.now() - t0,
  }));
}

// Autoverificação diária do link do cliente. Existe porque o preview do
// WhatsApp ficou quebrado por meses sem ninguém perceber: nada no sistema
// olhava a página do jeito que um robô externo olha.
// Resultado em BACKUP/_state/healthcheck.json — se 'ok' for false, algo
// que o cliente vê está quebrado.
async function healthcheck(env) {
  if (!env.BACKUP || !env.HEALTHCHECK_URL) return;
  const out = { at: new Date().toISOString(), ok: false, etapas: {} };
  try {
    // 1. A página responde para um robô de preview?
    const r = await fetch(env.HEALTHCHECK_URL, {
      headers: { 'User-Agent': 'facebookexternalhit/1.1' },
      cf: { cacheTtl: 0 },
    });
    out.etapas.pagina = r.status;
    const html = await r.text();

    // 2. O middleware preencheu as meta tags?
    out.etapas.x_og = r.headers.get('x-og');
    const m = html.match(/<meta property="og:image"[^>]*content="([^"]+)"/i);
    out.etapas.og_image = !!m;
    if (!m) { await save(env, out); return; }

    // 3. A capa abre e cabe no limite do robô?
    const img = await fetch(m[1]);
    const bytes = (await img.arrayBuffer()).byteLength;
    out.etapas.capa_status = img.status;
    out.etapas.capa_kb = Math.round(bytes / 1024);

    out.ok = r.status === 200 && img.status === 200 && bytes < 600 * 1024;
  } catch (e) {
    out.erro = String(e && e.message);
  }
  await save(env, out);

  async function save(env, o) {
    await env.BACKUP.put('_state/healthcheck.json', JSON.stringify(o, null, 2));
  }
}

// ============================================================
// Backfill automatico de taken_at (Migracao 40)
//
// POR QUE: taken_at so era preenchido em upload novo (admin-galleries.js/
// admin-bulk.js), ou por um script manual (backfill-taken-at.mjs) que
// alguem tinha que lembrar de rodar toda vez que uma galeria antiga ou uma
// falha de extracao deixava fotos sem data — ate la, a galeria ordenava por
// "position" (ordem de upload), que pode vir de tras pra frente. Isso virou
// rotina do sistema: um cron a parte (mais frequente que o diario, ver
// wrangler.toml) le a foto direto do R2 (sem custo de rede pro Supabase),
// acha o EXIF DateTimeOriginal na unha (parser proprio abaixo — mais barato
// e mais previsivel em CPU do que trazer uma lib pensada pra Node/browser
// pro isolate do Worker) e grava via RPC segura (mesmo padrao WORKER_SECRET
// das migracoes 12/35). So le os primeiros ~128KB de cada arquivo (o EXIF
// fica sempre pertinho do inicio) — nunca decodifica a imagem inteira, entao
// nao esbarra no limite de CPU que ja quebrou o ZIP uma vez (ver
// gallery-lightbox.js).
//
// Fuso: EXIF nao carrega timezone, so "YYYY:MM:DD HH:MM:SS" da hora local da
// camera. Assume America/Sao_Paulo (UTC-3 fixo, sem horario de verao desde
// 2019) pra bater com a mesma suposicao do backfill-taken-at.mjs manual (que
// interpretava a mesma string na hora local do Mac) — evita misturar dois
// fusos diferentes numa mesma galeria e embaralhar a ordem nas fotos que
// ainda faltavam quando esse cron entrou em producao.
//
// Fotos sem EXIF ficam marcadas taken_at_checked=true (taken_at continua
// null, cai no fallback por position) pra nao serem relidas pra sempre a
// cada 10 minutos. Falha de leitura (rede/R2) NAO marca checked — tenta de
// novo no proximo cron.
const TZ_OFFSET_MIN_BRASIL = 3 * 60; // America/Sao_Paulo = UTC-3

function parseExifDateToIso(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xFF || bytes[1] !== 0xD8) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let off = 2;
  while (off + 4 <= bytes.length) {
    if (bytes[off] !== 0xFF) break;
    const marker = bytes[off + 1];
    if (marker === 0xD8 || marker === 0xD9) { off += 2; continue; }
    if (marker === 0xDA) break; // inicio dos dados de imagem — acabou o header
    if (off + 4 > bytes.length) break;
    const segLen = dv.getUint16(off + 2, false);
    if (marker === 0xE1) {
      const segStart = off + 4;
      if (segStart + 6 <= bytes.length &&
          bytes[segStart] === 0x45 && bytes[segStart + 1] === 0x78 && bytes[segStart + 2] === 0x69 &&
          bytes[segStart + 3] === 0x66 && bytes[segStart + 4] === 0x00 && bytes[segStart + 5] === 0x00) {
        const iso = parseTiffForDate(dv, bytes, segStart + 6);
        if (iso) return iso;
      }
    }
    if (segLen < 2) break;
    off += 2 + segLen;
  }
  return null;
}

function parseTiffForDate(dv, bytes, tiffStart) {
  if (tiffStart + 8 > bytes.length) return null;
  const little = bytes[tiffStart] === 0x49 && bytes[tiffStart + 1] === 0x49;
  const big = bytes[tiffStart] === 0x4D && bytes[tiffStart + 1] === 0x4D;
  if (!little && !big) return null;
  const le = little;
  const ifd0Off = dv.getUint32(tiffStart + 4, le);
  const exifIfdOff = findIfdTag(dv, bytes, tiffStart + ifd0Off, 0x8769, le);
  if (exifIfdOff == null) return null;
  const dateStr = readAsciiIfdTag(dv, bytes, tiffStart, tiffStart + exifIfdOff, 0x9003, le)
               || readAsciiIfdTag(dv, bytes, tiffStart, tiffStart + exifIfdOff, 0x9004, le);
  return dateStr ? exifDateStringToIso(dateStr) : null;
}

function findIfdTag(dv, bytes, ifdStart, wantTag, le) {
  if (ifdStart + 2 > bytes.length) return null;
  const count = dv.getUint16(ifdStart, le);
  for (let i = 0; i < count; i++) {
    const entry = ifdStart + 2 + i * 12;
    if (entry + 12 > bytes.length) break;
    if (dv.getUint16(entry, le) === wantTag) return dv.getUint32(entry + 8, le);
  }
  return null;
}

function readAsciiIfdTag(dv, bytes, tiffStart, ifdStart, wantTag, le) {
  if (ifdStart + 2 > bytes.length) return null;
  const count = dv.getUint16(ifdStart, le);
  for (let i = 0; i < count; i++) {
    const entry = ifdStart + 2 + i * 12;
    if (entry + 12 > bytes.length) break;
    if (dv.getUint16(entry, le) !== wantTag) continue;
    if (dv.getUint16(entry + 2, le) !== 2) return null; // esperado ASCII
    const cnt = dv.getUint32(entry + 4, le);
    const strStart = cnt <= 4 ? entry + 8 : tiffStart + dv.getUint32(entry + 8, le);
    if (strStart < 0 || strStart + cnt > bytes.length) return null;
    let s = '';
    for (let j = 0; j < cnt; j++) {
      const c = bytes[strStart + j];
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s || null;
  }
  return null;
}

function exifDateStringToIso(s) {
  const m = s.match(/^(\d{4}):(\d{2}):(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3], h = +m[4], mi = +m[5], se = +m[6];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // hora local do Brasil -> UTC: soma o offset (UTC-3 => +3h pra chegar em UTC)
  const utcMs = Date.UTC(y, mo - 1, d, h, mi, se) + TZ_OFFSET_MIN_BRASIL * 60 * 1000;
  return new Date(utcMs).toISOString();
}

// Lote: le do R2 so o comeco de cada arquivo (128KB cobre o EXIF de qualquer
// camera/celular na pratica), roda em paralelo (R2 e I/O, nao CPU — mesmo
// raciocinio do reconcile() acima, que varre milhares de objetos por noite
// sem esbarrar no limite de CPU do plano Gratuito).
async function backfillTakenAt(env) {
  if (!env.WORKER_SECRET || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return;
  const t0 = Date.now();
  const BUDGET_MS = 20000;
  const BATCH = 200;
  const RANGE_BYTES = 131072;
  let totalOk = 0, totalNoExif = 0, totalFailed = 0, rounds = 0;

  while (Date.now() - t0 < BUDGET_MS) {
    const rows = await sbRpc(env, 'get_photos_missing_taken_at', { p_secret: env.WORKER_SECRET, p_limit: BATCH });
    if (!rows || !rows.length) break;
    rounds++;

    const updates = [];
    await Promise.all(rows.map(async (r) => {
      try {
        const obj = await env.PHOTOS.get(r.r2_key, { range: { offset: 0, length: RANGE_BYTES } });
        if (!obj) { totalFailed++; return; } // objeto sumiu — nao marca checked, tenta de novo
        const buf = new Uint8Array(await obj.arrayBuffer());
        const iso = parseExifDateToIso(buf);
        if (iso) { updates.push({ id: r.id, taken_at: iso }); totalOk++; }
        else { updates.push({ id: r.id, taken_at: null }); totalNoExif++; } // checado, sem EXIF
      } catch (e) { totalFailed++; } // erro de leitura/parse — nao marca checked
    }));

    if (!updates.length) break; // ninguem processou nessa rodada — nao gira em falso
    await sbRpc(env, 'set_taken_at_batch', { p_secret: env.WORKER_SECRET, p_updates: updates });
  }

  if (env.BACKUP) {
    await env.BACKUP.put('_state/last_backfill_taken_at.json', JSON.stringify({
      at: new Date().toISOString(), comExif: totalOk, semExif: totalNoExif, falhas: totalFailed,
      rounds, ms: Date.now() - t0,
    })).catch(() => {});
  }
}

// ── ZIP: valida o manifesto e faz streaming do ZIP a partir do R2 ──
// ── Limites de uma PARTE do download ────────────────────────
// 3,5GB: folga sob o teto de 4GB do ZIP clássico (o único formato que o
//        Utilitário de Compactação do macOS abre sem reclamar).
// 700 arquivos: folga sob o teto de ~1000 subrequests por invocação do Worker.
// O álbum inteiro pode ter qualquer tamanho — ele é entregue em N partes.
const ZIP_MAX_BYTES = 3.5 * 1024 * 1024 * 1024;
const ZIP_MAX_FILES = 700;

// Lê o manifesto assinado e devolve como o álbum deve ser dividido.
// Resposta: { parts: [{ from, to, count, bytes }], total_bytes, total_files }
async function handleZipPlan(req, env, CORS) {
  const J = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { ...CORS, 'Content-Type': 'application/json' } });
  if (!env.SIGNING_SECRET) return J({ error: 'signing disabled' }, 403);
  let m;
  try { m = await req.json(); } catch { return J({ error: 'bad json' }, 400); }
  const { keys, exp, sig } = m || {};
  if (!Array.isArray(keys) || !keys.length || !exp || !sig) return J({ error: 'bad manifest' }, 400);
  if (Number(exp) < Math.floor(Date.now() / 1000)) return J({ error: 'expired' }, 403);
  if (!await validSigAny(env, keys.join('\n'), exp, sig)) return J({ error: 'bad signature' }, 403);
  if (keys.some(k => typeof k !== 'string' || !k.startsWith('galleries/'))) return J({ error: 'bad keys' }, 403);

  // Tamanhos vêm de list() por prefixo (1 subrequest por 1000 objetos),
  // muito mais barato que um head() por foto.
  const sizes = new Map();
  const prefixes = new Set(keys.map(k => k.slice(0, k.lastIndexOf('/') + 1)));
  for (const prefix of prefixes) {
    let cursor;
    do {
      const r = await env.PHOTOS.list({ prefix, limit: 1000, cursor });
      for (const o of r.objects) sizes.set(o.key, o.size);
      cursor = r.truncated ? r.cursor : undefined;
    } while (cursor);
  }

  // Média das fotos conhecidas cobre eventuais keys não listadas.
  const conhecidos = keys.filter(k => sizes.has(k));
  const media = conhecidos.length
    ? conhecidos.reduce((a, k) => a + sizes.get(k), 0) / conhecidos.length
    : 5 * 1024 * 1024;

  const parts = [];
  let from = 0, bytes = 0, count = 0, total = 0;
  for (let i = 0; i < keys.length; i++) {
    const sz = sizes.has(keys[i]) ? sizes.get(keys[i]) : media;
    // Fecha a parte ANTES de estourar qualquer um dos dois limites.
    if (count > 0 && (bytes + sz > ZIP_MAX_BYTES || count >= ZIP_MAX_FILES)) {
      parts.push({ from, to: i, count, bytes: Math.round(bytes) });
      from = i; bytes = 0; count = 0;
    }
    bytes += sz; count++; total += sz;
  }
  if (count > 0) parts.push({ from, to: keys.length, count, bytes: Math.round(bytes) });

  return J({ parts, total_files: keys.length, total_bytes: Math.round(total) });
}

async function handleZip(req, env, CORS) {
  if (!env.SIGNING_SECRET) return new Response('signing disabled', { status: 403, headers: CORS });
  let m;
  try { m = await req.json(); } catch { return new Response('bad json', { status: 400, headers: CORS }); }
  const { keys, names, exp, sig } = m || {};
  if (!Array.isArray(keys) || !keys.length || !exp || !sig)
    return new Response('bad manifest', { status: 400, headers: CORS });
  if (Number(exp) < Math.floor(Date.now() / 1000))
    return new Response('expired', { status: 403, headers: CORS });
  // assinatura sobre keys.join('\n') + ':' + exp  (igual ao pgcrypto)
  const ok = await validSigAny(env, keys.join('\n'), exp, sig);
  if (!ok) return new Response('bad signature', { status: 403, headers: CORS });
  // só objetos nossos
  if (keys.some(k => typeof k !== 'string' || !k.startsWith('galleries/')))
    return new Response('bad keys', { status: 403, headers: CORS });

  // Gera as entradas sob demanda: cada objeto é lido do R2 quando o
  // client-zip pede — mantém o uso de memória baixo mesmo com 1500 fotos.
  // Recorte: o site pede o álbum em partes (?from=&to=). A assinatura continua
  // valendo sobre a lista COMPLETA de keys — fatiar não exige assinar de novo.
  const u = new URL(req.url);
  const from = Math.max(0, Number(u.searchParams.get('from')) || 0);
  const to = Math.min(keys.length, Number(u.searchParams.get('to')) || keys.length);
  if (to - from > ZIP_MAX_FILES)
    return new Response(JSON.stringify({ error: 'part_too_big', max: ZIP_MAX_FILES }), { status: 413, headers: { ...CORS, 'Content-Type': 'application/json' } });

  const files = (async function* () {
    const seen = {};
    for (let i = from; i < to; i++) {
      const obj = await env.PHOTOS.get(keys[i]);
      if (!obj) continue;
      let name = (names && names[i]) || keys[i].split('/').pop();
      // evita nomes duplicados dentro do ZIP
      if (seen[name]) { const n = ++seen[name]; const d = name.lastIndexOf('.');
        name = d > 0 ? `${name.slice(0,d)} (${n})${name.slice(d)}` : `${name} (${n})`; }
      else seen[name] = 1;
      yield { name, input: obj.body, lastModified: obj.uploaded };
    }
  })();

  const zip = downloadZip(files).body;
  const headers = new Headers(CORS);
  headers.set('Content-Type', 'application/zip');
  headers.set('Content-Disposition', 'attachment; filename="galeria.zip"');
  return new Response(zip, { headers });
}

// ── PAYWALL (Mercado Pago) ──────────────────────────────────
// O Worker NÃO usa mais a service key: fala com o Supabase por RPCs escopadas,
// usando a ANON key; ações privilegiadas exigem o WORKER_SECRET.
async function sbRpc(env, fn, body) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.ok ? r.json() : null;
}
function json503(CORS) { return new Response(JSON.stringify({ error: 'paywall não configurado' }), { status: 503, headers: { ...CORS, 'Content-Type': 'application/json' } }); }
// Nunca deixa a falha de e-mail derrubar a liberação da compra — mas registra
// o motivo. Antes engolia tudo calado: chave errada ou domínio não verificado
// no Resend passavam despercebidos e a venda ficava sem aviso nenhum.
// Para ver: npx wrangler tail --format pretty
// Reenvia por e-mail os codigos de desbloqueio ja comprados. O codigo nunca
// volta na resposta HTTP — so pelo e-mail do comprador.
async function handleRecover(req, env, CORS) {
  const generic = () => new Response(
    JSON.stringify({ ok: true, message: 'Se houver compra com esse e-mail, enviamos o acesso.' }),
    { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });

  let body;
  try { body = await req.json(); } catch { return generic(); }
  const token = String(body.token || '');
  const email = String(body.email || '').trim();
  if (!token || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return generic();
  if (!env.WORKER_SECRET || !env.SUPABASE_URL) return generic();

  const res = await sbRpc(env, 'get_unlock_codes_for_email', {
    p_secret: env.WORKER_SECRET, p_token: token, p_email: email,
  });
  const codes = (res && Array.isArray(res.codes)) ? res.codes : [];
  if (!codes.length) return generic();

  const origin = req.headers.get('Origin') || '';
  const link = origin ? `${origin}/gallery/gallery.html?t=${encodeURIComponent(token)}` : '';
  const lista = codes.map(c => `<li><b>${c}</b></li>`).join('');
  await sendEmail(env, email,
    'Seu acesso as fotos — @eusouleandroribeiro',
    `<p>Voce pediu para recuperar o acesso as fotos de <b>${res.gallery_name || 'sua galeria'}</b>.</p>`
    + `<p>Codigo(s) de desbloqueio:</p><ul>${lista}</ul>`
    + (link ? `<p><a href="${link}">Abrir a galeria</a> e usar a opcao "Ja comprei" para colar o codigo.</p>` : '')
    + '<p>Guarde este e-mail: ele funciona em qualquer aparelho.</p>');
  return generic();
}

async function sendEmail(env, to, subject, html) {
  if (!env.RESEND_API_KEY || !env.RESEND_FROM) {
    console.log('sendEmail: Resend não configurado (RESEND_API_KEY/RESEND_FROM) — e-mail não enviado para', to);
    return;
  }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.RESEND_FROM, to, subject, html }),
    });
    if (!r.ok) await logServerError(env, 'Resend recusou o e-mail (' + r.status + ')', (await r.text().catch(() => '')).slice(0, 300));
  } catch (e) {
    console.error('sendEmail: falha de rede', e.message);
  }
}
// Erro do servidor vai pra mesma tabela que o painel já mostra em
// Configurações → Erros recentes. Antes só existia no `wrangler tail`, que é
// efêmero: uma falha de madrugada sumia sem deixar rastro.
async function logServerError(env, msg, detail) {
  console.error('worker:', msg, detail || '');
  try {
    await sbRpc(env, 'log_error', {
      p_page: 'worker',
      p_message: String(msg || '').slice(0, 500),
      p_detail: String(detail || '').slice(0, 2000),
      p_ua: 'cloudflare-worker',
    });
  } catch (e) { /* registrar erro nunca pode gerar outro erro */ }
}

// Backup diário dos DADOS (as fotos já são replicadas por replicate()).
// Sem isto, perder o banco significaria ter os arquivos no R2 sem saber a que
// álbum cada um pertence — e sem os tokens de acesso dos clientes.
// Guarda em backups/AAAA-MM-DD/<tabela>.json no bucket privado BACKUP.
const BACKUP_TABLES = ['galleries', 'gallery_groups', 'photos', 'gallery_videos', 'orders', 'selections'];
async function backupDatabase(env) {
  if (!env.BACKUP || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.WORKER_SECRET) return;
  const day = new Date().toISOString().slice(0, 10);
  const resumo = {};
  for (const table of BACKUP_TABLES) {
    try {
      const all = [];
      // Teto de 40 páginas (80 mil linhas) pra uma tabela inesperadamente
      // grande não estourar o tempo do cron.
      for (let page = 0; page < 40; page++) {
        const r = await sbRpc(env, 'backup_dump', {
          p_secret: env.WORKER_SECRET, p_table: table, p_offset: page * 1000, p_limit: 1000,
        });
        if (!r || r.error) { resumo[table] = 'erro: ' + ((r && r.error) || 'sem resposta'); break; }
        all.push(...(r.rows || []));
        if ((r.count || 0) < 1000) break;
      }
      if (typeof resumo[table] === 'string') continue;
      await env.BACKUP.put(`backups/${day}/${table}.json`, JSON.stringify(all), {
        httpMetadata: { contentType: 'application/json' },
      });
      resumo[table] = all.length;
    } catch (e) {
      resumo[table] = 'exceção: ' + e.message;
    }
  }
  await env.BACKUP.put(`backups/${day}/_resumo.json`, JSON.stringify({ day, at: new Date().toISOString(), resumo }), {
    httpMetadata: { contentType: 'application/json' },
  });
  console.log('backup do banco', day, JSON.stringify(resumo));

  const falhou = Object.entries(resumo).filter(([, v]) => typeof v === 'string');
  if (falhou.length) await logServerError(env, 'Backup do banco falhou em: ' + falhou.map(([k]) => k).join(', '), JSON.stringify(resumo));
  if (falhou.length) {
    await sendEmail(env, 'souleandroribeiro@gmail.com', '⚠ Backup do Gallery com falha',
      `<p>O backup de ${day} teve problema em: <b>${falhou.map(([k]) => k).join(', ')}</b></p>`
      + `<pre>${JSON.stringify(resumo, null, 2)}</pre>`);
  }
}

// Apaga dumps de backup do banco (backups/AAAA-MM-DD/*) com mais de
// RETENTION_DAYS dias. Sem isso, backupDatabase() grava ~7 arquivos JSON
// TODO dia pra sempre — pequenos individualmente, mas acumulam sem limite
// e pesam no armazenamento do R2 (é cobrado por GB/mes, continuo, nao e
// coisa que "some sozinha"). 30 dias cobre qualquer investigacao razoavel
// de "o que mudou" sem virar um historico infinito.
const BACKUP_DUMP_RETENTION_DAYS = 30;
async function cleanupOldBackupDumps(env) {
  if (!env.BACKUP) return;
  try {
    const cutoff = new Date(Date.now() - BACKUP_DUMP_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const cutoffDay = cutoff.toISOString().slice(0, 10); // "AAAA-MM-DD", comparavel como string

    let cursor, toDelete = [];
    do {
      const list = await env.BACKUP.list({ prefix: 'backups/', cursor, limit: 1000 });
      for (const o of list.objects) {
        const m = o.key.match(/^backups\/(\d{4}-\d{2}-\d{2})\//);
        if (m && m[1] < cutoffDay) toDelete.push(o.key);
      }
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);

    for (let i = 0; i < toDelete.length; i += 1000) {
      await env.BACKUP.delete(toDelete.slice(i, i + 1000));
    }

    await env.BACKUP.put('_state/last_backup_dump_cleanup.json', JSON.stringify({
      at: new Date().toISOString(), apagados: toDelete.length, corteDias: BACKUP_DUMP_RETENTION_DAYS,
    })).catch(() => {});
  } catch (e) {
    await logServerError(env, 'cleanupOldBackupDumps falhou', e.message);
  }
}

// Apaga do BACKUP TODA foto que já tinha sido replicada (original E
// derivados) — o usuário mantém as fotos em 2 outras cópias fora do R2
// (Google Drive + backup interno próprio), então essa réplica no R2 é uma
// 3ª camada que ele decidiu não precisar mais. NÃO toca em 'backups/'
// (dumps do banco — continuam, o usuário pediu pra manter) nem em
// '_state/' (arquivos de controle dos próprios crons).
//
// Roda em lotes pequenos por execução (mesmo padrão de reconcile()) e é
// resumível via cursor salvo — pra um bucket grande não estourar o tempo
// do cron, e pra dar pra acompanhar o progresso dia a dia.
const PURGE_PHOTOS_BATCH = 3000;
function _isPurgeablePhotoKey(key) {
  return !key.startsWith('backups/') && !key.startsWith('_state/');
}
async function purgeReplicatedPhotos(env) {
  if (!env.BACKUP) return;
  try {
    const stObj = await env.BACKUP.get('_state/purge_photos_after');
    const startAfter = stObj ? await stObj.text() : '';
    let scanned = 0, toDelete = [], last = startAfter, done = false;

    while (scanned < PURGE_PHOTOS_BATCH) {
      const list = await env.BACKUP.list({ startAfter: last || undefined, limit: 1000 });
      for (const o of list.objects) {
        if (_isPurgeablePhotoKey(o.key)) toDelete.push(o.key);
        last = o.key;
      }
      scanned += list.objects.length;
      if (!list.truncated) { done = true; break; }
      if (scanned >= PURGE_PHOTOS_BATCH) break;
    }

    for (let i = 0; i < toDelete.length; i += 1000) {
      await env.BACKUP.delete(toDelete.slice(i, i + 1000));
    }

    await env.BACKUP.put('_state/purge_photos_after', done ? '' : last);
    await env.BACKUP.put('_state/last_purge_photos.json', JSON.stringify({
      at: new Date().toISOString(), apagados: toDelete.length, scanned, done,
    })).catch(() => {});
  } catch (e) {
    await logServerError(env, 'purgeReplicatedPhotos falhou', e.message);
  }
}

// Pendentes abandonados (>24h) — RPC escopada.
async function cleanupPendingOrders(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.WORKER_SECRET) return;
  try { await sbRpc(env, 'cleanup_pending_orders', { p_secret: env.WORKER_SECRET }); } catch (e) {}
}
// Retenção diária (LGPD): apaga dados de galerias expiradas + PII antiga.
async function retentionCleanup(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !env.WORKER_SECRET) return;
  try { await sbRpc(env, 'retention_cleanup', { p_secret: env.WORKER_SECRET }); } catch (e) {}
}

async function handleCheckout(req, env, url, CORS) {
  if (!env.MP_ACCESS_TOKEN || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return json503(CORS);
  let body;
  try { body = await req.json(); } catch { return new Response('bad json', { status: 400, headers: CORS }); }
  const { token, visitor_id, photo_ids, origin } = body || {};
  if (!token || !visitor_id || !Array.isArray(photo_ids) || !photo_ids.length)
    return new Response('bad request', { status: 400, headers: CORS });

  const base = `${url.protocol}//${url.host}`;
  const back = origin || base;
  // cria o pedido pendente (a RPC valida galeria/preço/fotos)
  const ord = await sbRpc(env, 'create_paid_order', { p_token: token, p_visitor: visitor_id, p_photo_ids: photo_ids, p_origin: back });
  if (!ord || ord.error || !ord.order_id) return new Response('sem paywall', { status: 400, headers: CORS });

  const prefRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [{ title: `${ord.count} foto(s) — ${ord.gallery_name || 'Galeria'}`, quantity: ord.count, unit_price: (ord.amount_cents / ord.count) / 100, currency_id: 'BRL' }],
      external_reference: ord.order_id,
      notification_url: `${base}/mp-webhook`,
      back_urls: { success: `${back}?paid=1&o=${ord.order_id}`, pending: `${back}?paid=pending`, failure: `${back}?paid=0` },
      auto_return: 'approved',
    }),
  });
  const pref = await prefRes.json();
  if (!pref.init_point) return new Response(JSON.stringify({ error: 'mp', detail: pref }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
  return new Response(JSON.stringify({ init_point: pref.init_point, order_id: ord.order_id }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// Mesmo fluxo do handleCheckout, mas pro produto "armazenamento" (estender
// prazo de guarda da galeria + quota de vídeo pro próprio cliente subir).
async function handleStorageCheckout(req, env, url, CORS) {
  if (!env.MP_ACCESS_TOKEN || !env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return json503(CORS);
  let body;
  try { body = await req.json(); } catch { return new Response('bad json', { status: 400, headers: CORS }); }
  const { token, visitor_id, permanent, quota_mb, origin } = body || {};
  if (!token || !visitor_id || (!permanent && !quota_mb))
    return new Response('bad request', { status: 400, headers: CORS });

  const base = `${url.protocol}//${url.host}`;
  const back = origin || base;
  const ord = await sbRpc(env, 'create_storage_order', { p_token: token, p_visitor: visitor_id, p_permanent: !!permanent, p_quota_mb: quota_mb || 0, p_origin: back });
  if (!ord || ord.error || !ord.order_id) return new Response('erro ao criar pedido', { status: 400, headers: CORS });

  const parts = [];
  if (permanent) parts.push('Galeria permanente (não expira)');
  if (quota_mb) parts.push(`+${(quota_mb / 1024).toFixed(1)}GB de vídeo`);

  const prefRes = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      items: [{ title: `${parts.join(' + ')} — ${ord.gallery_name || 'Galeria'}`, quantity: 1, unit_price: ord.amount_cents / 100, currency_id: 'BRL' }],
      external_reference: ord.order_id,
      notification_url: `${base}/mp-webhook`,
      back_urls: { success: `${back}?paid=1&o=${ord.order_id}`, pending: `${back}?paid=pending`, failure: `${back}?paid=0` },
      auto_return: 'approved',
    }),
  });
  const pref = await prefRes.json();
  if (!pref.init_point) return new Response(JSON.stringify({ error: 'mp', detail: pref }), { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
  return new Response(JSON.stringify({ init_point: pref.init_point, order_id: ord.order_id }), { headers: { ...CORS, 'Content-Type': 'application/json' } });
}

async function handleMpWebhook(req, env, url, CORS) {
  // Não confiamos no corpo: pegamos o id e RECONSULTAMOS o pagamento na API do MP.
  let paymentId = url.searchParams.get('data.id') || url.searchParams.get('id');
  if (!paymentId && req.method === 'POST') {
    try { const b = await req.json(); paymentId = (b.data && b.data.id) || b.id; } catch {}
  }
  if (!paymentId || !env.MP_ACCESS_TOKEN || !env.WORKER_SECRET) return new Response('ok', { status: 200, headers: CORS });
  try {
    const pr = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, { headers: { Authorization: `Bearer ${env.MP_ACCESS_TOKEN}` } });
    const pay = await pr.json();
    const oid = pay && pay.external_reference;
    if (!oid) return new Response('ok', { status: 200, headers: CORS });

    // Estorno / cancelamento / chargeback -> revoga (RPC escopada).
    if (['refunded', 'charged_back', 'cancelled', 'rejected'].includes(pay.status)) {
      const r = await sbRpc(env, 'settle_order', { p_secret: env.WORKER_SECRET, p_order_id: oid, p_status: 'revoked', p_mp_ref: String(paymentId), p_email: null });
      if (!r || r.error) return new Response('settle failed', { status: 500, headers: CORS }); // MP re-tenta
      return new Response('ok', { status: 200, headers: CORS });
    }

    if (pay.status === 'approved') {
      const email = (pay.payer && pay.payer.email) || null;
      const res = await sbRpc(env, 'settle_order', { p_secret: env.WORKER_SECRET, p_order_id: oid, p_status: 'approved', p_mp_ref: String(paymentId), p_email: email });
      // Aprovado no MP mas falhou ao liberar: alerta o dono e retorna 5xx (MP re-tenta).
      if (!res || res.error || res.status !== 'approved') {
        await logServerError(env, 'PAGAMENTO APROVADO SEM LIBERAR — pedido ' + oid, 'mp_payment=' + paymentId + ' resposta=' + JSON.stringify(res));
        await sendEmail(env, 'souleandroribeiro@gmail.com', 'ALERTA: pagamento aprovado sem liberar',
          `<p>Pagamento ${paymentId} aprovado no Mercado Pago, mas settle_order falhou (pedido ${oid}). Verifique manualmente.</p>`);
        return new Response('settle failed', { status: 500, headers: CORS });
      }
      // e-mails só na primeira aprovação (não 'already') e se Resend configurado
      if (!res.already && env.RESEND_API_KEY && env.RESEND_FROM) {
        const valor = (res.amount_cents / 100).toFixed(2);
        const buyer = res.email || email;
        if (res.product_type === 'storage') {
          const parts = [];
          if (res.permanent) parts.push('Galeria permanente — o link não expira mais');
          if (res.quota_mb) parts.push(`+${(res.quota_mb / 1024).toFixed(1)}GB de vídeo`);
          const link = res.origin || '';
          if (buyer) await sendEmail(env, buyer, res.permanent ? 'Sua galeria agora é permanente — @eusouleandroribeiro' : 'Armazenamento liberado — @eusouleandroribeiro',
            `<p>Obrigado pela compra!</p><p>${parts.join(' + ')}.</p>`
            + (res.permanent ? '<p>Suas fotos ficam no ar por tempo indeterminado — guarde este link.</p>' : '')
            + (link ? `<p><a href="${link}">Abrir o álbum</a></p>` : ''));
          await sendEmail(env, 'souleandroribeiro@gmail.com', `💰 Venda${res.permanent ? ' — GALERIA PERMANENTE' : ' de armazenamento'}: R$ ${valor}`,
            `<p>${parts.join(' + ')} — <b>R$ ${valor}</b>.</p><p>Comprador: ${buyer || '—'}</p>`);
        } else {
          const code = res.code, link = res.origin || '';
          const nfotos = res.photo_count || '?';
          if (buyer) await sendEmail(env, buyer, 'Seu código para baixar as fotos — @eusouleandroribeiro',
            `<p>Obrigado pela compra!</p><p>Código para baixar em qualquer aparelho:</p>`
            + `<p style="font-size:22px;font-weight:bold;letter-spacing:2px">${code}</p>`
            + (link ? `<p><a href="${link}">Abrir o álbum</a> → menu → "Tenho um código".</p>` : ''));
          await sendEmail(env, 'souleandroribeiro@gmail.com', `💰 Nova venda: R$ ${valor}`,
            `<p>Venda aprovada de <b>${nfotos} foto(s)</b> — <b>R$ ${valor}</b>.</p><p>Comprador: ${buyer || '—'}</p>`);
        }
      }
    }
  } catch (e) {
    return new Response('error', { status: 500, headers: CORS }); // exceção transitória: MP re-tenta
  }
  return new Response('ok', { status: 200, headers: CORS });
}

// Aceita o segredo atual e (durante rotação) o anterior — troca sem downtime.
// 'suffix' permite variar a mensagem assinada (ex.: ':wm' para marca d'água).
async function validSigAny(env, key, exp, sig, suffix = '') {
  for (const s of [env.SIGNING_SECRET, env.SIGNING_SECRET_PREV]) {
    if (s && await validSig(s, key, exp, sig, suffix)) return true;
  }
  return false;
}

// HMAC-SHA256(key + ':' + exp + suffix) em hex — precisa bater com o pgcrypto do Supabase
async function validSig(secret, key, exp, sig, suffix = '') {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(key + ':' + exp + suffix));
  const hex = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
  if (hex.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0; // comparação em tempo ~constante
}

// Coalescing por isolate: enquanto o cálculo de uma key está em andamento,
// requisições concorrentes pela MESMA key esperam a mesma Promise em vez de
// rodar o watermark de novo. Não substitui o cache de borda (que cobre
// requisições entre isolates/colos) — reduz o pico de CPU no instante em que
// várias pessoas abrem o mesmo link ainda "frio".
// Acima disto a decodificação estoura o isolate (ver guarda no GET ?wm=1).
const WM_MAX_BYTES = 8 * 1024 * 1024;
const _inflightWm = new Map();
async function computeWatermarked(env, ctx, cache, cacheKey, key, CORS) {
  const k = cacheKey.url;
  let p = _inflightWm.get(k);
  if (!p) {
    p = (async () => {
      // Fonte preferida: o derivado de 1600px gravado no upload. Aplicar a
      // marca sobre o ORIGINAL estourava a memória do isolate (um JPEG de
      // 24MP vira ~96MB descompactado, acima do limite de 128MB) e o pedido
      // morria com "unreachable". Com o derivado, o pico fica em ~10MB.
      let obj = await env.PHOTOS.get(key + '_lg.jpg');
      if (!obj) {
        // Fotos enviadas antes desta mudança não têm o derivado. Segue pelo
        // original, mas só até o tamanho que a memória aguenta — e NUNCA
        // devolve o arquivo sem marca, que vazaria a foto limpa.
        obj = await env.PHOTOS.get(key);
        if (!obj) return new Response('not found', { status: 404, headers: CORS });
        if (obj.size > WM_MAX_BYTES) {
          return new Response('watermark: foto antiga e grande demais (' +
            Math.round(obj.size / 1048576) + 'MB). Reenvie a foto para gerar o derivado.',
            { status: 413, headers: CORS });
        }
      }
      let out;
      try { out = await applyWatermark(env, new Uint8Array(await obj.arrayBuffer())); }
      catch (e) { return new Response('watermark error: ' + e.message, { status: 500, headers: CORS }); }
      const headers = new Headers(CORS);
      headers.set('Content-Type', 'image/jpeg');
      headers.set('Cache-Control', 'public, max-age=86400, immutable');
      const resp = new Response(out, { headers });
      ctx.waitUntil(cache.put(cacheKey, resp.clone()));
      return resp;
    })();
    _inflightWm.set(k, p);
    p.finally(() => _inflightWm.delete(k));
  }
  return p;
}

// Capa do preview de link: JPEG no máx. 1200px de lado maior, qualidade 78.
// Formato e tamanho escolhidos pelas limitações do robô do WhatsApp/Facebook
// (não lê WebP; ignora imagens muito pesadas).
const OG_MAX = 1200;
async function makeOgJpeg(imgBytes) {
  let img = PhotonImage.new_from_byteslice(imgBytes);
  const w = img.get_width(), h = img.get_height();
  if (w > OG_MAX || h > OG_MAX) {
    const sc = Math.min(OG_MAX / w, OG_MAX / h);
    const small = resize(img, Math.max(1, Math.round(w * sc)), Math.max(1, Math.round(h * sc)), SamplingFilter.Lanczos3);
    img.free(); img = small;
  }
  const out = img.get_bytes_jpeg(78);
  img.free();
  return out;
}

// Compõe a marca d'água (assets/watermark.png, redimensionada à foto) sobre a
// imagem original. Roda em WASM (photon) no Worker. Devolve JPEG.
let _wmBytes = null;
async function applyWatermark(env, imgBytes) {
  if (!_wmBytes) {
    const w = await env.PHOTOS.get('assets/watermark.png');
    if (!w) throw new Error('watermark asset ausente');
    _wmBytes = new Uint8Array(await w.arrayBuffer());
  }
  let base = PhotonImage.new_from_byteslice(imgBytes);
  let bw = base.get_width(), bh = base.get_height();
  // Limita a dimensão do preview marcado (memória do isolate ~128MB + banda).
  const MAX = 1600;
  if (bw > MAX || bh > MAX) {
    const sc = Math.min(MAX / bw, MAX / bh);
    const nw = Math.max(1, Math.round(bw * sc)), nh = Math.max(1, Math.round(bh * sc));
    const small = resize(base, nw, nh, SamplingFilter.Nearest);
    base.free(); base = small; bw = nw; bh = nh;
  }
  const mark = PhotonImage.new_from_byteslice(_wmBytes);
  const fit = resize(mark, bw, bh, SamplingFilter.Nearest);
  photonWatermark(base, fit, 0n, 0n);
  const out = base.get_bytes_jpeg(82);
  base.free(); mark.free(); fit.free();
  return out;
}
