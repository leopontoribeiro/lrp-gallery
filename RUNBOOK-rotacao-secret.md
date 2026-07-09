# Runbook — Rotação do SIGNING_SECRET (R2)

O `SIGNING_SECRET` assina as URLs das fotos (Worker) e é a mesma chave guardada
no Supabase (Vault, via migração 7). Rotacione se suspeitar de vazamento — ou
por higiene, a cada ~6–12 meses.

**Impacto:** URLs já entregues ao navegador valem até `exp` (janela de 6h). Ao
trocar, elas param de abrir; a página assina de novo no próximo load. Faça fora
do horário de pico e troque Worker + Vault na sequência (janela curta de erro).

## Passos

1. **Gerar novo segredo**
   ```sh
   openssl rand -hex 32
   ```

2. **Atualizar o Worker** (Cloudflare) — cole o novo valor quando pedir:
   ```sh
   cd lrp-gallery/r2-signed-worker
   npx wrangler secret put SIGNING_SECRET
   ```

3. **Atualizar o Vault** (Supabase → SQL Editor), colando o MESMO valor:
   ```sql
   do $$
   declare sid uuid;
   begin
     select id into sid from vault.secrets where name = 'r2_signing_secret';
     perform vault.update_secret(sid, 'NOVO_SEGREDO_HEX');
   end $$;
   ```
   > Se ainda houver texto puro: `delete from public.app_secrets where key='r2_signing_secret';`

4. **Atualizar o `.env.upload`** (uploads futuros) — trocar `R2_UPLOAD_SECRET`
   NÃO é necessário (esse é o de PUT, separado). Só rode o passo se você
   rotacionar também o `UPLOAD_SECRET` (opcional).

5. **Validar**
   ```sh
   cd lrp-gallery && SMOKE_TOKEN=<token_de_uma_galeria> node smoke-test.mjs
   ```
   Esperado: `foto assinada carrega (200)` e `9 ok, 0 falha(s)`.

## Reverter
Recolocar o valor antigo no Worker (passo 2) e no Vault (passo 3).
