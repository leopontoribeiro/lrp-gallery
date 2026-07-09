# LRP Gallery — Runbook (o que só você faz)

Tudo abaixo já está codado, testado e é retrocompatível: nada muda em produção
até você executar cada passo. Ordem recomendada.

---

## 1. Segurança do banco (5 min) — PRIORIDADE
Supabase → SQL Editor → cole e rode **`supabase-migration-2-seguranca.sql`**.
Fecha o vazamento (hoje qualquer um lê o `access_token` e `full_url` de todas as
galerias). O `gallery.html` já usa as RPCs com fallback — ativa sozinho.

Verificação (deve dar "permission denied"):
```sql
set role anon; select access_token from galleries limit 1; reset role;
```

---

## 2. Chave local para os scripts (2 min)
```
cd ~/lrp-gallery
cp .env.upload.example .env.upload
open -e .env.upload      # cole a SUPABASE_SERVICE_KEY e salve
```

## 3. Corrigir 555 fotos sem dimensão
```
cd ~/lrp-gallery
set -a; . ./.env.upload; set +a
node backfill-dimensions.mjs
```

---

## 4. Imagens ASSINADAS (privacidade dos originais) — worker novo isolado

O worker está pronto em `r2-signed-worker/`. Ele NÃO substitui nada; roda em
paralelo. Passos:

**4a. Descobrir o nome do bucket R2 e colocar no wrangler.toml**
```
cd ~/lrp-gallery/r2-signed-worker
npx wrangler r2 bucket list
```
Edite `wrangler.toml` → troque `CONFIRMAR_NOME_DO_BUCKET` pelo nome real.

**4b. Definir os 2 segredos** (invente valores fortes; guarde o SIGNING_SECRET)
```
npx wrangler secret put SIGNING_SECRET     # ex: uma string aleatória longa
npx wrangler secret put UPLOAD_SECRET      # outra string aleatória
```

**4c. Deploy do worker**
```
npx wrangler deploy
```
Anote a URL final (ex: `https://lrp-gallery-signed.SEU-SUB.workers.dev`).

**4d. Testar SEM assinatura ainda** — abra no navegador:
`https://lrp-gallery-signed.SEU-SUB.workers.dev/galleries/<id>/<arquivo>`
(pegue um caminho real de `full_url` no banco). Deve exibir a imagem.
→ enquanto `SIGNING_SECRET` está setado, ele já exige assinatura; se quiser
testar o objeto cru primeiro, faça 4d ANTES de 4b.

**4e. Ativar assinatura no Supabase** → SQL Editor:
   - rode **`supabase-migration-3-signed-urls.sql`**
   - depois rode (com SEUS valores):
```sql
insert into public.app_secrets(key, value) values
  ('r2_signing_secret', 'O_MESMO_SIGNING_SECRET_DO_WORKER'),
  ('r2_signed_base',    'https://lrp-gallery-signed.SEU-SUB.workers.dev')
on conflict (key) do update set value = excluded.value;
```
A galeria pública passa a receber URLs assinadas que expiram (~6–12 h) e só o
worker novo serve. Para reverter: `delete from public.app_secrets where key like 'r2_%';`

**4f. (Depois de confirmar que tudo funciona)** desative o worker antigo público
`lrp-gallery-r2` para fechar o acesso direto aos originais (senão ele continua
servindo sem assinatura para quem souber o caminho).

---

## 5. Uploader alinhado ao R2 (usa o worker do passo 4)
No `.env.upload`, preencha `R2_UPLOAD_URL` (a URL do worker) e `R2_UPLOAD_SECRET`
(o mesmo `UPLOAD_SECRET`). Depois, duplo-clique em **Upload para Galeria.command**
ou:
```
node upload.mjs "/caminho/da/pasta"
```
Ele cria a galeria, gera thumbs `.webp` com sharp e envia original + thumb ao R2.

---

## Resumo dos segredos (o "plugar")
| Onde | Segredo | Igual a |
|------|---------|---------|
| Worker (`wrangler secret`) | `SIGNING_SECRET` | app_secrets.r2_signing_secret (Supabase) |
| Worker (`wrangler secret`) | `UPLOAD_SECRET`  | R2_UPLOAD_SECRET (.env.upload) |
| Supabase (app_secrets) | `r2_signing_secret` | = SIGNING_SECRET |
| Supabase (app_secrets) | `r2_signed_base` | URL do worker |
| .env.upload | `SUPABASE_SERVICE_KEY` | service_role do Supabase |
| .env.upload | `R2_UPLOAD_URL` / `R2_UPLOAD_SECRET` | URL do worker / UPLOAD_SECRET |
