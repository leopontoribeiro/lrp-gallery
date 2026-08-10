// ============================================================
// LRP Gallery — Verificação e restauração do backup
//
// Um backup que ninguém testou restaurar é suposição, não garantia.
// Esta ferramenta baixa o backup do R2 (bucket privado gallery-photos-backup,
// gravado todo dia às 04:00 pelo Worker) e responde três perguntas:
//   1. os arquivos existem e estão íntegros?
//   2. os dados são coerentes entre si (foto aponta pra galeria que existe)?
//   3. o que se perderia hoje se o banco sumisse?
//
// Uso:
//   node restore-backup.mjs                      verifica o backup mais recente
//   node restore-backup.mjs --date 2026-07-27    verifica uma data específica
//   node restore-backup.mjs --restore --confirm  RESTAURA o que está faltando
//
// Sem --restore ele NÃO escreve nada no banco. Precisa do .env.upload
// (SUPABASE_URL, SUPABASE_SERVICE_KEY) e do wrangler logado na Cloudflare.
// ============================================================

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const exec = promisify(execFile);
const URL_BASE = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = process.env.BACKUP_BUCKET || 'gallery-photos-backup';

const C = { r:'\x1b[0m', dim:'\x1b[2m', g:'\x1b[32m', red:'\x1b[31m', c:'\x1b[36m', y:'\x1b[33m', b:'\x1b[1m' };
const log = m => console.log(m);
const die = m => { console.error(`${C.red}✗ ${m}${C.r}`); process.exit(1); };

if (!URL_BASE || !SERVICE) die('Faltam SUPABASE_URL / SUPABASE_SERVICE_KEY no .env.upload.');

const args = process.argv.slice(2);
const flag = n => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : null; };
const DO_RESTORE = args.includes('--restore');
const CONFIRMED = args.includes('--confirm');

// Ordem importa: quem é referenciado entra antes de quem referencia.
const TABLES = ['gallery_groups', 'galleries', 'photos', 'gallery_videos', 'orders', 'selections'];

const H = { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' };
async function api(path, init = {}) {
  // 3 tentativas: uma falha de rede não pode virar "sumiu do banco" no relatório.
  let ultimo;
  for (let tentativa = 0; tentativa < 3; tentativa++) {
    try {
      const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      const t = await res.text();
      return t ? JSON.parse(t) : null;
    } catch (e) {
      ultimo = e;
      await new Promise(r => setTimeout(r, 500 * (tentativa + 1)));
    }
  }
  throw ultimo;
}

// O PostgREST devolve no máximo 1000 linhas por chamada. Sem paginar, uma
// tabela com 10 mil fotos parecia ter só 1000 e o relatório acusava 9 mil
// registros "sumidos" que na verdade estavam lá.
async function apiTodos(tabela) {
  const todos = [];
  for (let de = 0; ; de += 1000) {
    const lote = await api(`${tabela}?select=id&order=id&offset=${de}&limit=1000`);
    if (!lote || !lote.length) break;
    todos.push(...lote);
    if (lote.length < 1000) break;
  }
  return todos;
}

async function r2get(key, destino) {
  // wrangler não lista objetos, então buscamos por caminho conhecido.
  await exec('npx', ['wrangler', 'r2', 'object', 'get', `${BUCKET}/${key}`, `--file=${destino}`, '--remote'],
    { cwd: join(process.cwd(), 'r2-signed-worker'), maxBuffer: 64 * 1024 * 1024 });
}

// Procura o backup mais recente andando pra trás a partir de hoje.
async function acharBackup(dir) {
  const alvo = flag('date');
  const dias = alvo ? [alvo] : Array.from({ length: 30 }, (_, i) => {
    const d = new Date(); d.setUTCDate(d.getUTCDate() - i);
    return d.toISOString().slice(0, 10);
  });
  for (const dia of dias) {
    try {
      await r2get(`backups/${dia}/_resumo.json`, join(dir, '_resumo.json'));
      return dia;
    } catch { /* não existe nesse dia, tenta o anterior */ }
  }
  return null;
}

function contaPorId(linhas) { return new Map(linhas.map(l => [l.id, l])); }

async function main() {
  const dir = await mkdtemp(join(tmpdir(), 'lrp-restore-'));
  try {
    log(`\n${C.b}${C.c}LRP Gallery — Verificação do backup${C.r}`);
    log(`${C.dim}Procurando o backup mais recente no R2...${C.r}`);

    const dia = await acharBackup(dir);
    if (!dia) die('Nenhum backup encontrado nos últimos 30 dias. O cron das 04:00 já rodou alguma vez?');

    const resumo = JSON.parse(await readFile(join(dir, '_resumo.json'), 'utf8'));
    log(`${C.g}✓ Backup de ${dia}${C.r} ${C.dim}(gerado ${new Date(resumo.at).toLocaleString('pt-BR')})${C.r}\n`);

    // 1) baixa e valida cada tabela
    const dados = {};
    for (const t of TABLES) {
      try {
        const f = join(dir, `${t}.json`);
        await r2get(`backups/${dia}/${t}.json`, f);
        dados[t] = JSON.parse(await readFile(f, 'utf8'));
        const esperado = resumo.resumo?.[t];
        const ok = typeof esperado !== 'number' || esperado === dados[t].length;
        log(`  ${ok ? C.g + '✓' : C.y + '⚠'} ${t.padEnd(16)} ${String(dados[t].length).padStart(6)} registro(s)${ok ? '' : ` (resumo dizia ${esperado})`}${C.r}`);
      } catch (e) {
        dados[t] = [];
        log(`  ${C.red}✗ ${t.padEnd(16)} não foi possível ler: ${e.message}${C.r}`);
      }
    }

    // 2) coerência interna: referência apontando pra registro que não existe
    log(`\n${C.b}Coerência dos dados${C.r}`);
    const gid = new Set(dados.galleries.map(g => g.id));
    const pid = new Set(dados.photos.map(p => p.id));
    const grid = new Set(dados.gallery_groups.map(g => g.id));
    const problemas = [];
    const orfas = dados.photos.filter(p => !gid.has(p.gallery_id)).length;
    if (orfas) problemas.push(`${orfas} foto(s) apontam pra galeria que não está no backup`);
    const capaQuebrada = dados.galleries.filter(g => g.cover_photo_id && !pid.has(g.cover_photo_id)).length;
    if (capaQuebrada) problemas.push(`${capaQuebrada} galeria(s) com capa que não está no backup`);
    const grupoQuebrado = dados.galleries.filter(g => g.gallery_group_id && !grid.has(g.gallery_group_id)).length;
    if (grupoQuebrado) problemas.push(`${grupoQuebrado} galeria(s) apontam pra grupo inexistente`);
    const semToken = dados.galleries.filter(g => !g.access_token).length;
    if (semToken) problemas.push(`${semToken} galeria(s) sem token de acesso (link do cliente perdido)`);
    const semArquivo = dados.photos.filter(p => !p.storage_path).length;
    if (semArquivo) problemas.push(`${semArquivo} foto(s) sem caminho do arquivo no R2`);

    if (problemas.length) problemas.forEach(p => log(`  ${C.y}⚠ ${p}${C.r}`));
    else log(`  ${C.g}✓ Nenhuma referência quebrada — o backup se sustenta sozinho.${C.r}`);

    // 3) o que mudou em relação ao banco de hoje
    log(`\n${C.b}Comparação com o banco atual${C.r}`);
    const faltando = {};
    for (const t of TABLES) {
      let vivos = [];
      try { vivos = await apiTodos(t); } catch (e) {
        log(`  ${C.red}${t}: não consegui ler o banco (${e.message.slice(0, 60)}) — comparação inconclusiva${C.r}`);
        continue;
      }
      const idsVivos = new Set(vivos.map(v => v.id));
      const ausentes = dados[t].filter(l => !idsVivos.has(l.id));
      faltando[t] = ausentes;
      const novos = vivos.length - (dados[t].length - ausentes.length);
      const sinal = ausentes.length ? C.y : C.g;
      log(`  ${sinal}${t.padEnd(16)} backup ${String(dados[t].length).padStart(6)} · banco ${String(vivos.length).padStart(6)}`
        + `${ausentes.length ? ` · ${ausentes.length} sumiram do banco` : ''}`
        + `${novos > 0 ? ` · ${novos} criados depois do backup` : ''}${C.r}`);
    }

    const totalFaltando = Object.values(faltando).reduce((a, b) => a + b.length, 0);

    if (!DO_RESTORE) {
      log(`\n${C.b}Resultado${C.r}`);
      if (!problemas.length && dados.galleries.length && dados.photos.length) {
        log(`  ${C.g}O backup de ${dia} está íntegro e é restaurável.${C.r}`);
      } else {
        log(`  ${C.y}O backup tem ressalvas — veja os avisos acima.${C.r}`);
      }
      if (totalFaltando) {
        log(`  ${C.y}${totalFaltando} registro(s) existem no backup mas não no banco.${C.r}`);
        log(`  ${C.dim}Para repor: node restore-backup.mjs --date ${dia} --restore --confirm${C.r}`);
      } else {
        log(`  ${C.dim}Nada a repor: o banco tem tudo o que o backup guarda.${C.r}`);
      }
      log('');
      return;
    }

    // ── Restauração ──
    if (!CONFIRMED) die('Restauração exige --confirm junto de --restore (medida de segurança).');
    if (!totalFaltando) { log(`\n${C.g}Nada a restaurar — o banco já tem tudo.${C.r}\n`); return; }

    log(`\n${C.b}${C.y}Restaurando ${totalFaltando} registro(s)...${C.r}`);
    for (const t of TABLES) {
      const linhas = faltando[t] || [];
      if (!linhas.length) continue;
      let ok = 0, erro = 0;
      // galleries.cover_photo_id aponta pra photos, que ainda não entrou:
      // grava sem a capa agora e conserta no fim.
      const adiarCapa = t === 'galleries';
      for (let i = 0; i < linhas.length; i += 200) {
        const lote = linhas.slice(i, i + 200).map(l => adiarCapa ? { ...l, cover_photo_id: null } : l);
        try {
          await api(t, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(lote) });
          ok += lote.length;
        } catch (e) { erro += lote.length; log(`  ${C.red}erro em ${t}: ${e.message.slice(0, 120)}${C.r}`); }
      }
      log(`  ${erro ? C.y : C.g}${t}: ${ok} restaurado(s)${erro ? `, ${erro} falharam` : ''}${C.r}`);
    }
    // devolve as capas agora que as fotos existem
    const comCapa = (faltando.galleries || []).filter(g => g.cover_photo_id);
    for (const g of comCapa) {
      try { await api(`galleries?id=eq.${g.id}`, { method: 'PATCH', body: JSON.stringify({ cover_photo_id: g.cover_photo_id }) }); } catch {}
    }
    if (comCapa.length) log(`  ${C.g}capas reatribuídas: ${comCapa.length}${C.r}`);
    log(`\n${C.g}${C.b}✓ Restauração concluída.${C.r}\n`);

  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

main().catch(e => die(e.message));
