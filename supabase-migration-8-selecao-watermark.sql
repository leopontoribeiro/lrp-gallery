-- ============================================================
-- LRP Gallery — Migração 8: seleção do cliente + marca d'água por álbum
-- Rode DEPOIS das migrações 3 e 7. Reversível.
-- ============================================================
set search_path = public;

-- 1. Flag de marca d'água por galeria (default: sem marca = galeria aberta)
alter table public.galleries add column if not exists watermark boolean default false;

-- 2. get_public_gallery agora informa 'watermark' ao frontend
--    (o tipo de retorno mudou, então precisa DROP antes do CREATE)
drop function if exists public.get_public_gallery(text, text);
create or replace function public.get_public_gallery(p_token text default null, p_slug text default null)
returns table (
  id uuid, name text, slug text, status text,
  cover_photo_id uuid, cover_position_x float8, cover_position_y float8,
  expires_at timestamptz, download_enabled boolean, has_password boolean, watermark boolean
) language sql security definer stable set search_path = public as $$
  select g.id, g.name, g.slug, g.status, g.cover_photo_id,
         g.cover_position_x, g.cover_position_y, g.expires_at, g.download_enabled,
         (g.password_hash is not null) as has_password, coalesce(g.watermark,false)
  from galleries g
  where g.status = 'live'
    and (
      (p_token is not null and g.access_token = p_token) or
      (p_token is null and p_slug is not null and g.slug = p_slug) or
      (p_token is null and p_slug is null)
    )
  order by g.created_at desc
  limit 1;
$$;
grant execute on function public.get_public_gallery(text, text) to anon, authenticated;

-- 3. Sobrecarga do assinador com marca d'água. Para wm=true a assinatura cobre
--    'okey:exp:wm' e a URL ganha &wm=1 — o Worker então entrega a versão
--    marcada e NUNCA o original limpo (cuja assinatura a RPC não gera).
--    (A versão de 1 argumento continua existindo para o admin, sem marca.)
create or replace function public._sign_r2_url(p_url text, p_wm boolean)
returns text language plpgsql stable security definer
set search_path = public, extensions as $$
declare
  secret text; base text; win int := 21600;
  okey text; exp bigint; sig text; msg text;
begin
  if p_url is null then return p_url; end if;
  secret := public._get_secret('r2_signing_secret');
  base   := public._get_secret('r2_signed_base');
  if secret is null or base is null then return p_url; end if;
  okey := split_part(regexp_replace(p_url, '^https?://[^/]+/', ''), '?', 1);
  if okey not like 'galleries/%' then return p_url; end if;
  exp := (floor(extract(epoch from now()) / win)::bigint + 2) * win;
  if p_wm then
    msg := okey || ':' || exp::text || ':wm';
    sig := encode(hmac(msg, secret, 'sha256'), 'hex');
    return base || '/' || okey || '?exp=' || exp::text || '&sig=' || sig || '&wm=1';
  else
    sig := encode(hmac(okey || ':' || exp::text, secret, 'sha256'), 'hex');
    return base || '/' || okey || '?exp=' || exp::text || '&sig=' || sig;
  end if;
end; $$;
revoke execute on function public._sign_r2_url(text, boolean) from public, anon, authenticated;

-- 4. get_public_photos aplica a marca conforme a flag da galeria
create or replace function public.get_public_photos(p_token text, p_offset int default 0, p_limit int default 500)
returns table (
  id uuid, filename text, thumb_url text, full_url text,
  "position" int, width int, height int, group_name text
) language sql security definer stable set search_path = public as $$
  select p.id, p.filename,
         public._sign_r2_url(p.thumb_url, coalesce(g.watermark,false)),
         public._sign_r2_url(p.full_url,  coalesce(g.watermark,false)),
         p.position, p.width, p.height, p.group_name
  from photos p join galleries g on g.id = p.gallery_id
  where g.access_token = p_token and g.status = 'live'
  order by p.position asc
  offset greatest(coalesce(p_offset,0),0)
  limit least(coalesce(p_limit,500), 500);
$$;

-- 5. SELEÇÃO DO CLIENTE ----------------------------------------------------
create table if not exists public.selections (
  id bigserial primary key,
  gallery_id uuid references public.galleries(id) on delete cascade,
  client_name text, client_contact text, message text,
  photo_ids uuid[] not null,
  created_at timestamptz default now(),
  seen boolean default false
);
create index if not exists idx_selections_gallery on public.selections (gallery_id, created_at desc);

-- Só o admin lê/gerencia as seleções (via painel logado)
alter table public.selections enable row level security;
drop policy if exists "admin_all_selections" on public.selections;
create policy "admin_all_selections" on public.selections for all to authenticated
  using ((auth.jwt() ->> 'email') = 'souleandroribeiro@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'souleandroribeiro@gmail.com');
revoke all on public.selections from anon;

-- O cliente envia a seleção por RPC (valida que as fotos são da galeria)
create or replace function public.submit_selection(
  p_token text, p_name text, p_contact text, p_message text, p_photo_ids uuid[]
) returns boolean language plpgsql security definer set search_path = public as $$
declare gid uuid; valid uuid[];
begin
  select id into gid from galleries where access_token = p_token and status = 'live';
  if gid is null then return false; end if;
  if p_photo_ids is null or array_length(p_photo_ids,1) is null then return false; end if;
  select array_agg(id) into valid from photos where gallery_id = gid and id = any(p_photo_ids);
  if valid is null then return false; end if;
  insert into selections(gallery_id, client_name, client_contact, message, photo_ids)
  values (gid, left(coalesce(p_name,''),120), left(coalesce(p_contact,''),160),
          left(coalesce(p_message,''),1000), valid);
  return true;
end; $$;
grant execute on function public.submit_selection(text,text,text,text,uuid[]) to anon, authenticated;

-- ============================================================
-- Reverter:
--   drop function public.submit_selection(text,text,text,text,uuid[]);
--   drop table public.selections;
--   drop function public._sign_r2_url(text, boolean);
--   alter table public.galleries drop column watermark;
-- ============================================================
