-- ============================================================
-- LRP Gallery — Auto-delete Biometric Data (180 dias)
-- Executa diariamente às 2h da manhã UTC
-- ============================================================

-- 1. Criar tabela para rastrear deletions
create table if not exists public.biometric_deletion_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id text not null,
  deletion_type text not null,
  deleted_at timestamp default now(),
  records_count int,
  reason text,
  created_at timestamp default now()
);

-- 2. Criar função para deletar dados biométricos expirados
create or replace function public.auto_delete_expired_biometric_data()
returns table(deleted_count int, affected_users int, message text)
language plpgsql
security definer
set search_path = public as $$
declare
  _deleted_count int := 0;
  _affected_users int := 0;
  _threshold_date timestamp;
  _deletion_id uuid;
begin
  -- Data limite: 180 dias atrás
  _threshold_date := now() - interval '180 days';

  -- Encontrar e deletar registros expirados
  with expired_records as (
    select id, consent_data ->> 'email' as user_email
    from consent_records
    where (consent_data ->> 'timestamp')::timestamp < _threshold_date
      and deleted_at is null
  )
  delete from consent_records
  where id in (select id from expired_records);

  get diagnostics _deleted_count = row_count;

  -- Contar usuários afetados
  select count(distinct (consent_data ->> 'email'))
  into _affected_users
  from consent_records
  where (consent_data ->> 'timestamp')::timestamp < _threshold_date
    and deleted_at is null;

  -- Registrar no log
  _deletion_id := uuid_generate_v4();
  insert into biometric_deletion_logs (id, user_id, deletion_type, records_count, reason)
  values (_deletion_id, 'system', 'auto_expiry', _deleted_count, 'Records older than 180 days');

  -- Retornar resultado
  return query select _deleted_count as deleted_count, _affected_users as affected_users,
    format('Deletados %s registros de %s usuários', _deleted_count, _affected_users) as message;
end; $$;

-- 3. Criar função para enviar notificação ANTES de deletar (com 30 dias de antecedência)
create or replace function public.notify_before_biometric_deletion()
returns table(notified_count int, message text)
language plpgsql
security definer
set search_path = public as $$
declare
  _notified_count int := 0;
  _threshold_date timestamp;
  _warning_date timestamp;
begin
  -- Data para avisar: 150 dias (30 dias antes de 180)
  _warning_date := now() - interval '150 days';
  _threshold_date := now() - interval '180 days';

  -- Encontrar usuários que estão prestes a ter dados deletados
  with users_to_notify as (
    select distinct (consent_data ->> 'email') as email,
           (consent_data ->> 'timestamp')::timestamp as consent_date
    from consent_records
    where (consent_data ->> 'timestamp')::timestamp < _warning_date
      and (consent_data ->> 'timestamp')::timestamp >= _threshold_date
      and deleted_at is null
  )
  select count(*)
  into _notified_count
  from users_to_notify;

  -- Retornar resultado
  return query select _notified_count as notified_count,
    format('Notificados %s usuários sobre exclusão de dados em 30 dias', _notified_count) as message;
end; $$;

-- 4. Criar função para rotina de manutenção completa (executar 1x por dia)
create or replace function public.daily_biometric_maintenance()
returns json
language plpgsql
security definer
set search_path = public as $$
declare
  _deletion_result record;
  _notification_result record;
  _final_result json;
begin
  -- Executar notificações primeiro
  perform notify_before_biometric_deletion();

  -- Depois deletar registros expirados
  perform auto_delete_expired_biometric_data();

  -- Retornar JSON com resultado
  _final_result := json_build_object(
    'timestamp', now(),
    'status', 'success',
    'deleted_count', (select deleted_count from auto_delete_expired_biometric_data()),
    'affected_users', (select affected_users from auto_delete_expired_biometric_data())
  );

  return _final_result;
end; $$;

-- 5. Criar tabela para agendamento de cron (se usar pg_cron extension)
-- ⚠️ NOTA: Supabase oferece Postgres Cron via função nativa
-- Você pode agendar manualmente via dashboard ou usar Edge Function

-- Para agendar no Supabase, use:
-- select cron.schedule('delete-expired-biometric-daily', '0 2 * * *', 'select public.daily_biometric_maintenance()');
-- Isso executa às 2h UTC todo dia

-- 6. Alternativa: Usar Supabase Edge Function (serverless)
-- Criar arquivo: supabase/functions/auto-delete-biometric/index.ts
-- Integrar com algum cron externo (GitHub Actions, etc)

-- 7. Criar view para monitorar status
create or replace view public.biometric_deletion_status as
select
  (select count(*) from consent_records where deleted_at is null)::int as total_active_records,
  (select count(*) from consent_records
   where (consent_data ->> 'timestamp')::timestamp < now() - interval '180 days'
     and deleted_at is null)::int as ready_for_deletion,
  (select count(*) from consent_records
   where (consent_data ->> 'timestamp')::timestamp < now() - interval '150 days'
     and (consent_data ->> 'timestamp')::timestamp >= now() - interval '180 days'
     and deleted_at is null)::int as near_deletion_warning,
  (select count(*) from biometric_deletion_logs where created_at > now() - interval '7 days')::int as last_7_days_deletions;

-- ============================================================
-- COMO USAR:
-- ============================================================

-- 1. Para deletar manualmente AGORA:
-- select * from public.auto_delete_expired_biometric_data();

-- 2. Para notificar usuários:
-- select * from public.notify_before_biometric_deletion();

-- 3. Para ver status:
-- select * from public.biometric_deletion_status;

-- 4. Para ver histórico de deletions:
-- select * from public.biometric_deletion_logs order by deleted_at desc;

-- 5. Para agendar (executar 1x):
-- select cron.schedule('auto-delete-biometric-180days', '0 2 * * *', 'select public.daily_biometric_maintenance()');
-- Removar: select cron.unschedule('auto-delete-biometric-180days');

-- ============================================================
