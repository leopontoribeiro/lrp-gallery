# Setup: Auto-Delete via Edge Function + GitHub Actions

Como `pg_cron` não está habilitado, usaremos Supabase Edge Functions + GitHub Actions para agendar a execução diária.

---

## 📋 PASSO 1: Deploy Edge Function

```bash
# 1. Criar pasta
mkdir -p supabase/functions/auto-delete-biometric

# 2. Copiar arquivo
cp supabase-edge-function-auto-delete.ts supabase/functions/auto-delete-biometric/index.ts

# 3. Deploy
supabase functions deploy auto-delete-biometric --project-id vtblxwaxwuztehtxkygp
```

**Resultado esperado:**
```
✓ Deployed auto-delete-biometric to https://vtblxwaxwuztehtxkygp.supabase.co/functions/v1/auto-delete-biometric
```

---

## 🔑 PASSO 2: Configurar Secrets no GitHub

No repositório GitHub, adicione em **Settings > Secrets and variables > Actions**:

1. `SUPABASE_URL`: `https://vtblxwaxwuztehtxkygp.supabase.co`
2. `SUPABASE_ANON_KEY`: Cole sua chave anon do Supabase

---

## ⚙️ PASSO 3: Setup GitHub Actions

```bash
# 1. Criar pasta
mkdir -p .github/workflows

# 2. Copiar arquivo
cp .github-workflows-auto-delete-biometric-cron.yml .github/workflows/auto-delete-biometric-cron.yml

# 3. Commit e push
git add .github/workflows/auto-delete-biometric-cron.yml
git commit -m "Setup auto-delete biometric cron job"
git push
```

---

## ✅ PASSO 4: Verificar Setup

### No GitHub:
1. Ir para **Actions**
2. Procurar **"Auto Delete Biometric Data (Daily)"**
3. Ver se workflow está ativo

### Testar Manualmente:
```bash
curl -X POST \
  -H "Authorization: Bearer SEU_ANON_KEY" \
  "https://vtblxwaxwuztehtxkygp.supabase.co/functions/v1/auto-delete-biometric" \
  -d '{}'
```

**Resposta esperada:**
```json
{
  "success": true,
  "timestamp": "2024-07-08T02:00:00.000Z",
  "message": "Auto-delete biometric data executed successfully"
}
```

---

## 📊 Verificar Execução

Depois que cron rodar (amanhã às 2h UTC), verifique no Supabase:

```sql
select * from public.biometric_deletion_status;
select * from public.biometric_deletion_logs order by created_at desc limit 5;
```

---

## ⚠️ Troubleshooting

**"Function not found"**
- Aguarde 1-2 minutos após deploy
- Verificar: `supabase functions list --project-id vtblxwaxwuztehtxkygp`

**"Unauthorized"**
- Verificar SUPABASE_ANON_KEY no GitHub Secrets
- Garantir que está sem espaços no final

**Workflow não executou**
- GitHub Actions demora até 5 minutos para disparar
- Verificar em Actions > All workflows
- Clicar em "Run workflow" manualmente para teste

---

## 📌 Próximos Passos

✅ Migrations SQL: Feitas  
✅ Auto-delete function: Criada  
⏳ Edge Function deploy: Aguardando seu comando  
⏳ GitHub Actions: Aguardando push  

**Comando rápido:**
```bash
cd /Users/eusouleandroribeiro/lrp-gallery
git add .
git commit -m "Add LGPD auto-delete infrastructure"
git push
```

---

**Status:** Pronto para implementação  
**Próximo:** Tasks #22-#26 (Dashboards e Testes)
