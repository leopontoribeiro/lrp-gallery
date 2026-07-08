# 📋 RUNBOOKS - LRP Gallery System

Procedimentos operacionais para situações críticas.

---

## 🚨 RUNBOOK 1: Admin Login Issue

**Quando**: Admin não consegue fazer login
**Tempo**: 5-10 min
**Severidade**: ALTO

### Steps

1. **Verificar status do Supabase**
   ```
   Acesse: https://status.supabase.io
   Verifique se há outages
   ```

2. **Verificar logs de autenticação**
   ```sql
   SELECT * FROM security_events 
   WHERE event_type = 'failed_auth' 
   ORDER BY created_at DESC LIMIT 10;
   ```

3. **Testar conexão Supabase**
   ```javascript
   // No console do navegador
   const { data, error } = await supabase.auth.getSession();
   console.log(error);
   ```

4. **Se problema persiste**
   - Limpar cache e cookies do navegador
   - Tentar em navegador privado
   - Testar em outro dispositivo

### Resolução
- Se erro 401/403: Verificar se user tem owner_id em clientes
- Se erro conexão: Contatar Supabase support
- Se MFA travado: Resetar MFA em auth.users table

---

## 🚨 RUNBOOK 2: Link/QR Code Não Gerado

**Quando**: Ao criar novo evento, link não aparece
**Tempo**: 5 min
**Severidade**: MÉDIO

### Steps

1. **Verificar trigger de QR code**
   ```sql
   SELECT * FROM share_links 
   ORDER BY created_at DESC LIMIT 5;
   ```

2. **Se qr_code_url é NULL**
   ```sql
   -- Regenerar QR codes
   UPDATE share_links 
   SET qr_code_url = generate_qr_code_url(token),
       qr_code_generated_at = now()
   WHERE qr_code_url IS NULL;
   ```

3. **Verificar function**
   ```sql
   SELECT * FROM pg_proc WHERE proname = 'create_qr_code_on_insert';
   ```

4. **Se função não existe**
   - Rodar migration: `migration-qr-codes-auth-monitoring.sql`

---

## 🚨 RUNBOOK 3: Upload de Imagem Falha

**Quando**: Erro ao fazer upload de cover_image_url
**Tempo**: 10 min
**Severidade**: MÉDIO

### Steps

1. **Verificar limite Storage**
   ```sql
   SELECT * FROM storage.buckets 
   WHERE name = 'event_covers';
   ```

2. **Verificar permissões**
   ```sql
   SELECT * FROM storage.objects 
   WHERE bucket_id = 'event_covers' 
   LIMIT 5;
   ```

3. **Se espaço cheio**
   - Limpar uploads antigos
   - Aumentar quota Supabase

4. **Se erro de MIME**
   - Verificar se arquivo é realmente imagem
   - Reconverter para JPG/PNG

---

## 🚨 RUNBOOK 4: Performance Lenta

**Quando**: Admin/Galeria carrega lentamente
**Tempo**: 15 min
**Severidade**: MÉDIO

### Steps

1. **Verificar métricas**
   ```sql
   SELECT endpoint, avg(response_time_ms) as avg_time, 
          max(response_time_ms) as max_time
   FROM performance_metrics
   WHERE created_at > now() - interval '1 hour'
   GROUP BY endpoint
   ORDER BY avg_time DESC;
   ```

2. **Verificar índices**
   ```sql
   EXPLAIN ANALYZE SELECT * FROM events 
   WHERE client_id = 'YOUR_CLIENT_ID' 
   ORDER BY event_date DESC;
   ```

3. **Se queries lentas**
   - Adicionar índices faltando
   - Denormalizar dados
   - Aumentar connection pool

4. **Se problema no frontend**
   - Verificar network tab no DevTools
   - Minificar JS/CSS
   - Lazy-load imagens

---

## 🚨 RUNBOOK 5: Erro de LGPD Compliance

**Quando**: Dados não foram deletados após 180 dias
**Tempo**: 30 min
**Severidade**: CRÍTICO

### Steps

1. **Verificar status de deleção**
   ```sql
   SELECT id, event_date, auto_delete_enabled, 
          get_days_until_deletion(created_at, 180) as days_left
   FROM events 
   WHERE auto_delete_enabled = true
   ORDER BY created_at ASC;
   ```

2. **Forçar deleção manual**
   ```sql
   -- Para evento específico
   SELECT delete_event_and_galleries('EVENT_ID'::uuid);
   ```

3. **Verificar audit log**
   ```sql
   SELECT * FROM audit_log 
   WHERE action = 'DELETE' 
   ORDER BY created_at DESC 
   LIMIT 10;
   ```

4. **Se cron job falhou**
   - Verificar GitHub Actions logs
   - Re-executar manualmente
   - Notificar legal team

---

## 🚨 RUNBOOK 6: Segurança - Suspeita de Breach

**Quando**: Tokens expostos ou acesso suspeito
**Tempo**: 5 min (imediato)
**Severidade**: CRÍTICO

### Steps

1. **Invalidar tokens comprometidos**
   ```sql
   -- Remover links de compartilhamento suspeitos
   DELETE FROM share_links 
   WHERE token = 'SUSPICIOUS_TOKEN';
   ```

2. **Registrar security event**
   ```sql
   INSERT INTO security_events(event_type, severity, details)
   VALUES ('breach_suspicion', 'critical', 
     jsonb_build_object('action', 'manual_investigation'));
   ```

3. **Notificar**
   - Email para admin
   - Slack/Discord alert
   - Log em Sentry

4. **Análise**
   ```sql
   SELECT * FROM error_logs 
   WHERE level = 'error' 
   ORDER BY created_at DESC LIMIT 50;
   ```

5. **Ações corretivas**
   - Forçar re-auth de todos admins
   - Regenerar API keys
   - Auditar access logs

---

## 🚨 RUNBOOK 7: Backup/Restore

**Quando**: Dados foram perdidos ou banco está corrompido
**Tempo**: 30-60 min
**Severidade**: CRÍTICO

### Steps

1. **Fazer backup manual**
   ```bash
   # Via Supabase CLI
   supabase db pull --db-url postgresql://...

   # Via pg_dump
   pg_dump -U postgres -h db.supabase.co lrp_gallery > backup.sql
   ```

2. **Testar restore**
   ```bash
   # Em servidor de teste
   psql -U postgres -h test-db.supabase.co < backup.sql
   ```

3. **Se restaurar é necessário**
   - Supabase > Backups > Restore Point
   - Selecionar timestamp antes da falha
   - Aguardar 10-30 min

4. **Verificação pós-restore**
   ```sql
   SELECT COUNT(*) FROM clients;
   SELECT COUNT(*) FROM events;
   SELECT COUNT(*) FROM share_links;
   ```

---

## 📊 RUNBOOK 8: Monitoring + Alertas

**Quando**: Setup de observabilidade
**Tempo**: 1-2 horas
**Severidade**: IMPORTANTE

### Checklist

- [ ] Sentry DSN configurado
- [ ] GitHub Actions secrets setados
- [ ] Alertas Supabase ativados
- [ ] Dashboard Grafana/Datadog pronto
- [ ] Slack/Discord integrado
- [ ] PagerDuty para on-call
- [ ] Error logs salvando em banco
- [ ] Performance metrics sendo capturadas

### Verificar Sentry

```javascript
// Testar captura de erro
throw new Error('Test Sentry integration');
// Deve aparecer em https://sentry.io em 1-2 min
```

### Verificar Monitoring

```sql
-- Ver últimos erros
SELECT * FROM error_logs 
WHERE level = 'error' 
ORDER BY created_at DESC LIMIT 5;

-- Ver eventos de segurança não resolvidos
SELECT * FROM security_events 
WHERE is_resolved = false;
```

---

## 📋 Checklist Diário

- [ ] Verificar Sentry para novos erros
- [ ] Revisar security_events não resolvidos
- [ ] Checar performance metrics
- [ ] Validar backups rodaram
- [ ] Verificar taxa de erro < 1%

---

## 🔄 Escalation Path

**Nível 1** (Você): Tentar runbooks 1-5
**Nível 2** (Tech Lead): Se problema não resolvido em 15 min
**Nível 3** (CTO): Se impacta business (>30 min downtime)
**Nível 4** (Supabase Support): Se problema está no infrastructure

---

## 📞 Contatos de Emergência

- Supabase Support: support@supabase.com
- Security Team: security@souleandroribeiro.com.br
- Admin Email: seu@email.com

---

**Última atualização**: 8 de julho de 2026
