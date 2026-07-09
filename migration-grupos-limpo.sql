-- ============================================================
-- CRIAR GRUPO — schema limpo, sobre os primitivos que já funcionam.
-- A "galeria-mãe" é um gallery_groups (tem capa + link próprio + on/off).
-- Cada "filha" é uma galeria normal (name, access_token, capa, status,
-- deleted_at) apontando para o grupo via galleries.gallery_group_id.
-- Cole no Supabase > SQL Editor e clique Run. Idempotente.
-- ============================================================

create extension if not exists pgcrypto;

create table if not exists public.gallery_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  access_token text unique not null,
  status text not null default 'live',              -- 'live' = compartilhado
  cover_photo_id uuid,                              -- foto (de qualquer filha) usada como capa
  cover_position_x double precision default 50,
  cover_position_y double precision default 50,
  deleted_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.galleries
  add column if not exists gallery_group_id uuid
  references public.gallery_groups(id) on delete set null;

create index if not exists idx_galleries_group on public.galleries(gallery_group_id);

-- RLS: admin autenticado gerencia os grupos (mesmo modelo das galerias).
alter table public.gallery_groups enable row level security;
drop policy if exists gg_admin_all on public.gallery_groups;
create policy gg_admin_all on public.gallery_groups
  for all to authenticated using (true) with check (true);

-- Leitura pública da galeria-mãe: nome + capa + filhas (com capas assinadas).
create or replace function public.get_public_group(p_token text)
returns jsonb language plpgsql security definer stable
set search_path = public as $$
declare grp record; kids jsonb;
begin
  select id, name, cover_photo_id
    into grp
    from gallery_groups
   where access_token = p_token and status = 'live' and deleted_at is null;
  if grp.id is null then return jsonb_build_object('error','not_found'); end if;

  select coalesce(jsonb_agg(x order by created_at desc), '[]'::jsonb) into kids
  from (
    select g.created_at,
      jsonb_build_object(
        'name', g.name,
        'token', g.access_token,
        'count', (select count(*) from photos p where p.gallery_id = g.id),
        'cover', public._sign_r2_url(coalesce(
          (select p.thumb_url from photos p where p.id = g.cover_photo_id),
          (select p.thumb_url from photos p where p.gallery_id = g.id order by p.position asc limit 1)))
      ) as x
    from galleries g
    where g.gallery_group_id = grp.id and g.status = 'live' and g.deleted_at is null
  ) s;

  return jsonb_build_object(
    'name', grp.name,
    'cover', public._sign_r2_url((select p.thumb_url from photos p where p.id = grp.cover_photo_id)),
    'galleries', kids
  );
end $$;

grant execute on function public.get_public_group(text) to anon, authenticated;
