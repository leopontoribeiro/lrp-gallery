-- ============================================================
-- EXECUTE TUDO ISTO NO SUPABASE SQL EDITOR
-- Copie e cole tudo de uma vez, depois clique "Run"
-- ============================================================

-- 1. Criar tabela para logs de deleção
create table if not exists public.biometric_deletion_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id text not null,
  deletion_type text not null,
  deleted_at timestamp default now(),
  records_count int,
  reason text,
  created_at timestamp default now()
);

-- 2. Função para deletar dados > 180 dias
create or replace function public.auto_delete_expired_biometric_data()
returns table(deleted_count int, affected_users int, message text)
language plpgsql
security definer
set search_path = public as $$
declare
  _deleted_count int := 0;
  _affected_users int := 0;
  _threshold_date timestamp;
begin
  _threshold_date := now() - interval '180 days';

  with expired_records as (
    select id from consent_records
    where (consent_data ->> 'timestamp')::timestamp < _threshold_date
      and deleted_at is null
  )
  delete from consent_records where id in (select id from expired_records);

  get diagnostics _deleted_count = row_count;

  select count(distinct (consent_data ->> 'email'))
  into _affected_users
  from consent_records
  where (consent_data ->> 'timestamp')::timestamp < _threshold_date;

  insert into biometric_deletion_logs (id, user_id, deletion_type, records_count, reason)
  values (uuid_generate_v4(), 'system', 'auto_expiry', _deleted_count, 'Records older than 180 days');

  return query select _deleted_count, _affected_users,
    format('Deletados %s registros de %s usuários', _deleted_count, _affected_users);
end; $$;

-- 3. Função para avisar ANTES de deletar (dia 150)
create or replace function public.notify_before_biometric_deletion()
returns table(notified_count int, message text)
language plpgsql
security definer
set search_path = public as $$
declare
  _notified_count int := 0;
begin
  with users_to_notify as (
    select distinct (consent_data ->> 'email') as email
    from consent_records
    where (consent_data ->> 'timestamp')::timestamp < now() - interval '150 days'
      and (consent_data ->> 'timestamp')::timestamp >= now() - interval '180 days'
      and deleted_at is null
  )
  select count(*) into _notified_count from users_to_notify;

  return query select _notified_count,
    format('Notificados %s usuários', _notified_count);
end; $$;

-- 4. Função de manutenção diária
create or replace function public.daily_biometric_maintenance()
returns json
language plpgsql
security definer
set search_path = public as $$
begin
  perform notify_before_biometric_deletion();
  perform auto_delete_expired_biometric_data();
  return json_build_object('timestamp', now(), 'status', 'success');
end; $$;

-- 5. View para monitorar status
create or replace view public.biometric_deletion_status as
select
  (select count(*) from consent_records where deleted_at is null)::int as total_active_records,
  (select count(*) from consent_records where (consent_data ->> 'timestamp')::timestamp < now() - interval '180 days' and deleted_at is null)::int as ready_for_deletion,
  (select count(*) from consent_records where (consent_data ->> 'timestamp')::timestamp < now() - interval '150 days' and (consent_data ->> 'timestamp')::timestamp >= now() - interval '180 days' and deleted_at is null)::int as near_deletion_warning,
  (select count(*) from biometric_deletion_logs where created_at > now() - interval '7 days')::int as last_7_days_deletions;

-- ============================================================
-- VERIFICAR INSTALAÇÃO
-- ============================================================

-- Ver status
select * from public.biometric_deletion_status;

-- Ver logs
select * from public.biometric_deletion_logs order by deleted_at desc limit 5;

-- ============================================================
-- AGENDAR CRON JOB (executar DEPOIS que migration acima funcionar)
-- ============================================================

-- Descomente a linha abaixo DEPOIS de executar tudo acima com sucesso
-- select cron.schedule('auto-delete-biometric-180days', '0 2 * * *', 'select public.daily_biometric_maintenance()');
