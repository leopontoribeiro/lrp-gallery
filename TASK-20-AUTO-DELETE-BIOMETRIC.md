# ⏰ TASK #20: Cron Job - Auto-delete Biometric Data (180 dias)

## Status: ⏳ Em Execução

Sistema automático de exclusão de dados biométricos conforme LGPD.

---

## 📋 O QUE ACONTECE

**A cada dia às 2h da manhã (UTC):**
1. Sistema verifica dados com mais de 180 dias
2. Envia email de aviso 30 dias antes (dia 150)
3. Deleta automaticamente no dia 180
4. Registra em log de auditoria

---

## 🔧 PASSO 1: Executar Migration

**Supabase → SQL Editor → Cole e execute:**

```sql
-- Copie todo o conteúdo de supabase-migration-auto-delete-biometric.sql
-- E execute no SQL Editor do Supabase
```

**Resultado esperado:** "Success. No rows returned."

---

## ✅ PASSO 2: Verificar Instalação

Execute no SQL Editor:

```sql
-- Ver status de dados biométricos
select * from public.biometric_deletion_status;

-- Deve retornar:
-- total_active_records | ready_for_deletion | near_deletion_warning | last_7_days_deletions
```

---

## 📅 PASSO 3: Agendar Cron Job

### Opção A: Usar Postgres Cron (Recomendado)

Se Supabase tem extensão `pg_cron` habilitada:

```sql
-- Executar 1x para agendar
select cron.schedule('auto-delete-biometric-180days', '0 2 * * *', 'select public.daily_biometric_maintenance()');

-- Verificar agendamentos
select * from cron.job;

-- Para cancelar:
-- select cron.unschedule('auto-delete-biometric-180days');
```

**Resultado:**
```
┌─────┬──────────────────────────────┬──────────────┬───────────┐
│ jobid│ schedule                      │ command      │ nodename  │
├─────┼──────────────────────────────┼──────────────┼───────────┤
│ 42  │ 0 2 * * *                    │ select...    │ localhost │
└─────┴──────────────────────────────┴──────────────┴───────────┘
```

### Opção B: Usar Supabase Edge Function (Se pg_cron não disponível)

1. Criar arquivo: `supabase/functions/auto-delete-biometric/index.ts`

```typescript
import { createClient } from '@supabase/supabase-js';

export default async (req: Request) => {
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data, error } = await supabase.rpc('daily_biometric_maintenance');

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400 });
  }

  return new Response(JSON.stringify({ success: true, data }), { status: 200 });
};
```

2. Deploy:
```bash
supabase functions deploy auto-delete-biometric
```

3. Agendar com GitHub Actions ou Vercel Cron:
```yaml
# .github/workflows/auto-delete-cron.yml
name: Auto Delete Biometric
on:
  schedule:
    - cron: '0 2 * * *'  # 2h UTC todo dia
jobs:
  delete:
    runs-on: ubuntu-latest
    steps:
      - run: curl -X POST https://seu-supabase-url/functions/v1/auto-delete-biometric \
              -H "Authorization: Bearer ${{ secrets.SUPABASE_ANON_KEY }}"
```

---

## 🧪 PASSO 4: Testar

### Test 1: Deletar Manualmente
```sql
-- Simular 180+ dias e deletar
select * from public.auto_delete_expired_biometric_data();
```

### Test 2: Ver Histórico
```sql
-- Ver todos os deletions
select * from public.biometric_deletion_logs order by deleted_at desc;
```

### Test 3: Criar Dado de Teste
```sql
-- Criar registro com data antiga (para testes)
insert into consent_records (consent_data) values (
  jsonb_build_object(
    'timestamp', (now() - interval '181 days')::text,
    'email', 'test@example.com',
    'accepted', true
  )
);

-- Agora rodar delete
select * from public.auto_delete_expired_biometric_data();
```

---

## 📊 MONITORAMENTO

### Ver Status Atual
```sql
select * from public.biometric_deletion_status;
```

**Respostas esperadas:**
- `total_active_records`: Total de registros vigentes
- `ready_for_deletion`: Registros > 180 dias (serão deletados hoje)
- `near_deletion_warning`: Registros entre 150-180 dias (aviso enviado)
- `last_7_days_deletions`: Deletions nos últimos 7 dias

### Ver Detalhes de Cada Deletion
```sql
select * from public.biometric_deletion_logs 
where created_at > now() - interval '30 days'
order by created_at desc;
```

---

## 🔔 EMAIL DE AVISO (30 DIAS ANTES)

Quando atinge 150 dias:
- Email enviado para o usuário
- Aviso de deleção em 30 dias
- Link para portal de privacidade
- Opção para deletar imediatamente

---

## 📈 CONFORMIDADE LGPD

✅ Checklist:
- [ ] Dados deletados automaticamente
- [ ] Log de auditoria completo
- [ ] Email de aviso enviado (30 dias antes)
- [ ] Certificado de deleção gerado
- [ ] Usuário pode deletar antes (manual)
- [ ] Usuário pode renovar consentimento (antes de expirar)

---

## 🚨 TROUBLESHOOTING

### "pg_cron não está habilitado"
```sql
-- Verificar se extensão está ativa
select extname from pg_extension where extname = 'pg_cron';

-- Se retornar nada, criar extensão (requer superuser no Supabase)
-- Abrir ticket: support.supabase.com para solicitar
```

### "Cron job não está rodando"
- Verificar timezone: `show timezone;`
- Verificar se função existe: `select * from pg_proc where proname = 'daily_biometric_maintenance';`
- Ver logs: `select * from cron.job_run_details order by start_time desc limit 5;`

### "Nenhum dado foi deletado"
- Verificar se existem dados > 180 dias: `select * from biometric_deletion_status;`
- Testar função manualmente: `select * from auto_delete_expired_biometric_data();`

---

## 📋 Checklist Final

- [ ] Migration SQL executada no Supabase
- [ ] Cron job agendado (pg_cron OU Edge Function)
- [ ] Teste manual realizado
- [ ] Email de aviso configurado (SendGrid)
- [ ] Logs de auditoria verificados
- [ ] Status monitorado

---

**Status:** Pronto para implementação  
**Arquivo:** `/Users/eusouleandroribeiro/lrp-gallery/supabase-migration-auto-delete-biometric.sql`  
**Próximo:** Task #21 (Integrar Tutorial Screen)
