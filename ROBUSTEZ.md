# Pacote de Robustez — LRP Gallery

Três defesas contra os maiores riscos operacionais.

## 1. Rate limiting (anti-abuso)
- Só o endpoint caro `POST /zip` é limitado: **6 req / 60s por IP** (binding `ZIP_RL` no Worker).
- Excedeu → **429** com `Retry-After: 60`. Um download humano normal nunca esbarra.
- GET de imagem **não** é limitado (é barato, cacheado na borda e já exige assinatura).

## 2. Backup das fotos (R2 → bucket privado `gallery-photos-backup`)
- **Dual-write**: todo upload novo (`PUT`) grava em `PHOTOS` **e** em `BACKUP` na hora. Backup incremental sem varredura.
- **Backfill inicial**: `node backfill-backup.mjs` copia o acervo já existente, em lotes resumíveis. (Rodado uma vez; idempotente — pode rodar de novo sem risco.)
- **Cron de reconciliação** (04:00 UTC, no Worker): varre um lote/dia retomando por cursor salvo em `_state/replica_after` — rede de segurança caso um dual-write falhe.
- O bucket de BACKUP **nunca é servido publicamente** (sem rota de leitura assinada para ele).

## 3. Backup do banco (dump diário → bucket privado)
- `backup-db.mjs` exporta `galleries`, `photos`, `photo_events` em JSON e envia para `backups/db/AAAA-MM-DD.json` no bucket de BACKUP (via `PUT` no Worker).
- Roda no **GitHub Actions** (`.github/workflows/backup.yml`, cron 05:00 UTC) ou local.
- **Retenção**: lifecycle no R2 expira dumps com mais de **90 dias** (prefixo `backups/db/`).

---

## ⚙️ Único passo seu: segredos do GitHub Actions
Em **GitHub → repositório → Settings → Secrets and variables → Actions → New repository secret**, adicione:

| Secret | Valor |
|---|---|
| `SUPABASE_URL` | `https://vtblxwaxwuztehtxkygp.supabase.co` |
| `SUPABASE_SERVICE_KEY` | sua service_role (mesma do `.env.upload`) |
| `R2_UPLOAD_URL` | `https://lrp-gallery-signed.lrp-gallery.workers.dev` |
| `R2_UPLOAD_SECRET` | mesmo `UPLOAD_SECRET` do Worker |

Depois, dispare uma vez em **Actions → backup-db → Run workflow** para validar. (O smoke test já usa `SMOKE_TOKEN`.)

---

## 🔧 Restaurar (em caso de desastre)
- **Fotos**: já estão no bucket `gallery-photos-backup`. Reaponte o Worker (binding `PHOTOS`) para ele, ou copie de volta.
- **Banco**: baixe o último `backups/db/*.json` e re-insira as tabelas (`galleries`, `photos`, `photo_events`).

## Operação manual
- Backfill/verificação de fotos: `node backfill-backup.mjs`
- Backup do banco agora: `node backup-db.mjs`
- Forçar um lote de réplica: `POST /backup-now?after=<key>&n=<80..400>` (header `x-upload-secret`)
