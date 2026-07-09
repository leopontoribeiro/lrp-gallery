-- ============================================================
-- LRP Gallery — Migração 5: hardening (autorização, analytics, eventos, erros)
-- Rode no SQL Editor. Reversível.
-- ============================================================
set search_path = public;

-- 1. AUTORIZAÇÃO: só o admin (por e-mail) tem CRUD. Antes: qualquer logado.
--    O gallery público usa RPCs security-definer, então não é afetado.
drop policy if exists "auth_all_galleries" on galleries;
drop policy if exists "auth_all_photos"    on photos;
drop policy if exists "auth_all_events"    on photo_events;

create policy "admin_all_galleries" on galleries for all to authenticated
  using ((auth.jwt() ->> 'email') = 'souleandroribeiro@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'souleandroribeiro@gmail.com');
create policy "admin_all_photos" on photos for all to authenticated
  using ((auth.jwt() ->> 'email') = 'souleandroribeiro@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'souleandroribeiro@gmail.com');
create policy "admin_all_events" on photo_events for all to authenticated
  using ((auth.jwt() ->> 'email') = 'souleandroribeiro@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'souleandroribeiro@gmail.com');

-- 2. EVENTOS: remove duplicados e cria índice único (1 evento por visitante/foto/tipo).
--    Neutraliza flood e o crescimento descontrolado da tabela.
delete from photo_events a using photo_events b
 where a.id > b.id and a.gallery_id = b.gallery_id and a.photo_id = b.photo_id
   and a.event_type = b.event_type and a.visitor_id = b.visitor_id
   and a.photo_id is not null and a.visitor_id is not null;

create unique index if not exists uq_photo_events_dedup
  on photo_events (gallery_id, photo_id, event_type, visitor_id)
  where photo_id is not null and visitor_id is not null;

-- log_photo_event agora ignora duplicados
create or replace function public.log_photo_event(p_token text, p_photo_id uuid, p_type text, p_visitor text)
returns void language plpgsql security definer set search_path = public as $$
declare gid uuid;
begin
  if p_type not in ('view','like','save') then return; end if;
  select id into gid from galleries where access_token = p_token and status = 'live';
  if gid is null then return; end if;
  insert into photo_events(gallery_id, photo_id, event_type, visitor_id)
  values (gid, p_photo_id, p_type, p_visitor)
  on conflict do nothing;
end; $$;

-- 3. ANALYTICS em SQL (em vez de agregar no navegador lendo tudo)
create or replace function public.gallery_photo_stats(p_gallery_id uuid)
returns table(photo_id uuid, views int, likes int, saves int)
language sql security definer stable set search_path = public as $$
  select photo_id,
    count(*) filter (where event_type='view')::int,
    count(*) filter (where event_type='like')::int,
    count(*) filter (where event_type='save')::int
  from photo_events where gallery_id = p_gallery_id and photo_id is not null
  group by photo_id;
$$;
create or replace function public.global_event_totals()
returns table(views bigint, likes bigint, saves bigint)
language sql security definer stable set search_path = public as $$
  select count(*) filter (where event_type='view'),
         count(*) filter (where event_type='like'),
         count(*) filter (where event_type='save')
  from photo_events;
$$;
grant execute on function public.gallery_photo_stats(uuid) to authenticated;
grant execute on function public.global_event_totals()     to authenticated;

-- 4. OBSERVABILIDADE: tabela de erros do cliente + RPC para registrar
create table if not exists public.client_errors (
  id bigserial primary key, created_at timestamptz default now(),
  page text, message text, detail text, ua text
);
revoke all on public.client_errors from anon, authenticated;
create or replace function public.log_error(p_page text, p_message text, p_detail text, p_ua text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into client_errors(page, message, detail, ua)
  values (left(p_page,40), left(p_message,500), left(p_detail,2000), left(p_ua,300));
end; $$;
grant execute on function public.log_error(text,text,text,text) to anon, authenticated;

-- ============================================================
-- LEMBRETE: em Authentication → Providers → Email, desative "Enable Sign Ups"
-- (defesa extra; as policies acima já bloqueiam quem não é o admin).
-- ============================================================
