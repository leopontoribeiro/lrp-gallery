-- ============================================================
-- MIGRATION: Add Manual Delete Control (sem auto-delete)
-- ============================================================

-- 1. Adicionar coluna de controle de deleção em events
alter table if exists public.events add column if not exists auto_delete_enabled boolean default false;
alter table if exists public.events add column if not exists delete_after_days integer default 180;
alter table if exists public.events add column if not exists marked_for_deletion boolean default false;
alter table if exists public.events add column if not exists deletion_date timestamp;
alter table if exists public.events add column if not exists days_until_deletion integer generated always as (
  case
    when delete_after_days is null or created_at is null then null
    when (extract(day from now()) - extract(day from created_at::timestamp)) >= delete_after_days then 0
    else delete_after_days - (extract(day from now()) - extract(day from created_at::timestamp))
  end
) stored;

-- 2. Adicionar função para calcular dias até deleção
create or replace function public.get_days_until_deletion(created_at timestamp, delete_after_days integer)
returns integer as $$
begin
  return greatest(0, delete_after_days - extract(day from now() - created_at)::integer);
end;
$$ language plpgsql immutable;

-- 3. View atualizada com informações de deleção
create or replace view public.client_events_with_links as
select
  c.id as client_id,
  c.name as client_name,
  c.slug as client_slug,
  e.id as event_id,
  e.name as event_name,
  e.event_date,
  e.cover_image_url,
  e.description,
  e.auto_delete_enabled,
  e.delete_after_days,
  e.marked_for_deletion,
  public.get_days_until_deletion(e.created_at, e.delete_after_days) as days_remaining,
  sl.token as share_token,
  sl.access_type,
  sl.expires_at,
  (sl.expires_at > now()) as is_active
from clients c
left join events e on c.id = e.client_id
left join share_links sl on e.id = sl.event_id
where e.status = 'active'
order by c.name, e.event_date desc;

-- 4. Função para marcar evento para deleção manual
create or replace function public.mark_event_for_deletion(event_id uuid)
returns void as $$
begin
  update public.events
  set marked_for_deletion = true, deletion_date = now()
  where id = event_id;
end;
$$ language plpgsql;

-- 5. Função para deletar evento e suas galerias
create or replace function public.delete_event_and_galleries(event_id uuid)
returns void as $$
begin
  -- Deletar galerias (cascata delete fotos automaticamente)
  delete from public.galleries where event_id = event_id;
  -- Deletar evento (cascata delete share_links automaticamente)
  delete from public.events where id = event_id;
end;
$$ language plpgsql;

-- 6. Verificação
select 'Migration concluída' as status;
