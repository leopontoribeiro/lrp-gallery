# RUNBOOK — Restauração (Disaster Recovery)

Objetivo: provar que o backup funciona. **Backup não testado = falsa segurança (#9).**
Faça este drill uma vez agora e repita a cada trimestre. RTO alvo: < 2h.

## O que existe de backup
- **Fotos**: dual-write no upload (`PHOTOS` → `BACKUP` = bucket R2 `gallery-photos-backup`) + reconciliação diária (cron 04:00 UTC no worker `lrp-gallery-signed`).
- **Banco (Supabase)**: dump diário via GitHub Action `backup.yml` → gravado em `backups/` no bucket `BACKUP` (via `backup-db.mjs`).

## A. Restaurar o banco (Supabase)
1. Baixe o dump mais recente do R2: prefixo `backups/` no bucket `gallery-photos-backup` (ordene por data).
2. Em Supabase → SQL Editor (ou `psql` com a connection string do projeto), rode o dump num **projeto de teste** primeiro (nunca direto em produção no 1º drill).
3. Reaplique as migrações que forem mais novas que o dump (`supabase-migration-*.sql` em ordem).
4. Confirme contagens: `select count(*) from galleries; select count(*) from photos; select count(*) from orders;`

## B. Restaurar fotos (R2)
- As fotos vivem em `gallery-photos`. O espelho é `gallery-photos-backup`.
- Se o bucket primário for perdido: recrie `gallery-photos` e copie do backup.
  - Rápido (server-side, sem baixar): use o endpoint `POST /backup-now` **invertendo origem/destino** (exige `x-upload-secret`) OU `rclone copy r2:gallery-photos-backup r2:gallery-photos`.
- Verifique uma foto assinada abre: `/<key>?exp=...&sig=...`.

## C. Segredos (recriar do zero)
Sem estes o sistema não sobe. Guarde-os num gerenciador de senhas:
- Worker `lrp-gallery-signed`: `SIGNING_SECRET`, `UPLOAD_SECRET`, `WORKER_SECRET`, `MP_ACCESS_TOKEN`, `RESEND_API_KEY`, `RESEND_FROM`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
- Supabase `app_secrets`: `worker_secret`, `r2_signing_secret`, `r2_signed_base` (o `r2_signing_secret` **tem que ser igual** ao `SIGNING_SECRET` do worker).
- Router `souleandroribeiro-router`: `ADMIN_PASSWORD`.

## Checklist do drill (marque ao concluir)
- [ ] Dump do banco restaurado num projeto de teste, contagens conferem.
- [ ] Uma foto do backup abre com URL assinada.
- [ ] Tempo total medido (RTO) e anotado.
- [ ] Lista de segredos confirmada num cofre de senhas.
