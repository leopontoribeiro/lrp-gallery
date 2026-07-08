-- ============================================================
-- LRP GALLERY - QUERIES ÚTEIS PARA OPERAÇÃO
-- Cole no Supabase SQL Editor quando necessário
-- ============================================================

-- ========== DIAGNOSTICS ==========

-- Ver todos os clientes e quantos eventos tem cada um
SELECT
  c.id, c.name, c.slug, c.owner_id,
  COUNT(e.id) as events_count,
  COUNT(DISTINCT sl.id) as share_links_count
FROM clients c
LEFT JOIN events e ON c.id = e.client_id
LEFT JOIN share_links sl ON e.id = sl.event_id
GROUP BY c.id, c.name, c.slug, c.owner_id
ORDER BY c.name;

-- Ver eventos que expiram em breve
SELECT
  e.id, e.name, c.name as client,
  e.created_at,
  (e.created_at + INTERVAL '180 days') as expires_at,
  (EXTRACT(DAY FROM (e.created_at + INTERVAL '180 days') - now()))::INT as days_left,
  e.auto_delete_enabled
FROM events e
JOIN clients c ON c.id = e.client_id
WHERE e.auto_delete_enabled = true
ORDER BY expires_at ASC;

-- Ver share links com view counts
SELECT
  sl.token,
  e.name as event,
  c.name as client,
  sl.view_count,
  sl.created_at,
  sl.qr_code_url
FROM share_links sl
JOIN events e ON e.id = sl.event_id
JOIN clients c ON c.id = e.client_id
ORDER BY sl.created_at DESC;

-- Ver erros não resolvidos
SELECT
  id, level, message, error_code,
  created_at, user_id
FROM error_logs
WHERE resolved_at IS NULL
ORDER BY created_at DESC
LIMIT 20;

-- Ver eventos de segurança críticos
SELECT
  id, event_type, severity, user_id,
  details, created_at
FROM security_events
WHERE is_resolved = false
AND severity IN ('high', 'critical')
ORDER BY created_at DESC;

-- Ver performance lenta (>5s)
SELECT
  endpoint, method,
  COUNT(*) as count,
  ROUND(AVG(response_time_ms)::NUMERIC, 2) as avg_ms,
  ROUND(MAX(response_time_ms)::NUMERIC, 2) as max_ms
FROM performance_metrics
WHERE response_time_ms > 5000
GROUP BY endpoint, method
ORDER BY avg_ms DESC;

-- ========== MANUTENÇÃO ==========

-- Regenerar QR codes que faltam
UPDATE share_links
SET
  qr_code_url = generate_qr_code_url(token),
  qr_code_generated_at = now()
WHERE qr_code_url IS NULL;

-- Marcar evento para deleção manual
SELECT mark_event_for_deletion('EVENT_ID'::uuid);

-- Deletar evento e tudo relacionado (cascata)
SELECT delete_event_and_galleries('EVENT_ID'::uuid);

-- Limpar tentativas de login falhadas antigas
DELETE FROM password_attempts
WHERE ts < now() - INTERVAL '24 hours';

-- Limpar rate limits antigos
DELETE FROM rate_limits
WHERE window_start < now() - INTERVAL '7 days';

-- Limpar error logs resolvidos antigos (>30 dias)
DELETE FROM error_logs
WHERE resolved_at IS NOT NULL
AND resolved_at < now() - INTERVAL '30 days';

-- ========== AUDITORIA ==========

-- Ver quem criou quais clientes
SELECT
  cl.id, cl.name,
  u.email as created_by,
  al.created_at
FROM clients cl
JOIN audit_log al ON al.record_id = cl.id AND al.table_name = 'clients' AND al.action = 'INSERT'
JOIN auth.users u ON u.id = al.user_id
ORDER BY al.created_at DESC;

-- Ver histórico de mudanças em evento específico
SELECT
  action, new_data, old_data,
  u.email as changed_by,
  created_at
FROM audit_log al
LEFT JOIN auth.users u ON u.id = al.user_id
WHERE table_name = 'events'
AND record_id = 'EVENT_ID'::uuid
ORDER BY created_at DESC;

-- Ver quem deletou o quê
SELECT
  table_name, record_id,
  old_data,
  u.email as deleted_by,
  created_at
FROM audit_log al
LEFT JOIN auth.users u ON u.id = al.user_id
WHERE action = 'DELETE'
ORDER BY created_at DESC
LIMIT 20;

-- ========== COMPLIANCE LGPD ==========

-- Ver dados de cliente para direito ao esquecimento
SELECT
  c.id, c.name, c.contact_email,
  COUNT(e.id) as events,
  COUNT(DISTINCT p.id) as photos
FROM clients c
LEFT JOIN events e ON c.id = e.client_id
LEFT JOIN galleries g ON e.id = g.event_id
LEFT JOIN photos p ON g.id = p.gallery_id
WHERE c.id = 'CLIENT_ID'::uuid
GROUP BY c.id, c.name, c.contact_email;

-- Deletar todos os dados de cliente (GDPR/LGPD)
-- CUIDADO: Isto é permanente!
BEGIN;
DELETE FROM photos WHERE gallery_id IN (
  SELECT g.id FROM galleries g
  JOIN events e ON e.id = g.event_id
  WHERE e.client_id = 'CLIENT_ID'::uuid
);

DELETE FROM galleries WHERE event_id IN (
  SELECT id FROM events WHERE client_id = 'CLIENT_ID'::uuid
);

DELETE FROM share_links WHERE event_id IN (
  SELECT id FROM events WHERE client_id = 'CLIENT_ID'::uuid
);

DELETE FROM events WHERE client_id = 'CLIENT_ID'::uuid;

DELETE FROM clients WHERE id = 'CLIENT_ID'::uuid;

-- Log a auditoria
INSERT INTO audit_log(table_name, record_id, action, old_data, user_id)
VALUES ('clients', 'CLIENT_ID'::uuid, 'DELETE', null, auth.uid());

COMMIT;

-- Ver consentimentos LGPD
SELECT
  id, visitor_id, consent_type,
  consent_given, created_at
FROM consent_records
WHERE consent_type = 'biometric'
ORDER BY created_at DESC
LIMIT 50;

-- ========== BACKUP ==========

-- Registrar backup executado
INSERT INTO backup_history(backup_name, backup_type, status, started_at, completed_at)
VALUES (
  'manual-' || to_char(now(), 'YYYYMMDDHH24MI'),
  'full',
  'completed',
  now() - INTERVAL '5 minutes',
  now()
);

-- Ver histórico de backups
SELECT
  backup_name, backup_type, status,
  completed_at, size_bytes,
  test_restore_status, test_restore_date
FROM backup_history
ORDER BY completed_at DESC
LIMIT 10;

-- ========== REPORTING ==========

-- Dashboard: Atividade do mês
SELECT
  'Clientes ativos' as metric,
  COUNT(DISTINCT c.id)::TEXT as value
FROM clients c
WHERE c.created_at > now() - INTERVAL '30 days'

UNION ALL

SELECT 'Eventos criados' as metric,
  COUNT(DISTINCT e.id)::TEXT as value
FROM events e
WHERE e.created_at > now() - INTERVAL '30 days'

UNION ALL

SELECT 'Links compartilhados' as metric,
  COUNT(DISTINCT sl.id)::TEXT as value
FROM share_links sl
WHERE sl.created_at > now() - INTERVAL '30 days'

UNION ALL

SELECT 'Total de views' as metric,
  SUM(sl.view_count)::TEXT as value
FROM share_links sl

UNION ALL

SELECT 'Erros não resolvidos' as metric,
  COUNT(DISTINCT id)::TEXT as value
FROM error_logs
WHERE resolved_at IS NULL;

-- ========== DESENVOLVIMENTO ==========

-- Testar função de QR code
SELECT generate_qr_code_url('test_token_12345');

-- Testar função de cálculo de dias
SELECT get_days_until_deletion(now() - INTERVAL '50 days', 180);

-- Testar RLS policy (como anon)
SET ROLE anon;
SELECT * FROM clients LIMIT 1;
RESET ROLE;

-- Testar RLS policy (como user autenticado)
SET ROLE authenticated;
SET "request.jwt.claims" = '{"sub":"USER_ID","email":"user@email.com"}';
SELECT * FROM clients WHERE owner_id = 'USER_ID'::uuid;
RESET ROLE;

-- ============================================================
-- DICAS:
-- 1. Sempre fazer SELECT antes de DELETE
-- 2. Usar EXPLAIN ANALYZE para queries lentas
-- 3. Índices por padrão em colunas de join
-- 4. RLS policies sempre testadas com SET ROLE
-- 5. Audit trail registrado automaticamente
-- ============================================================
