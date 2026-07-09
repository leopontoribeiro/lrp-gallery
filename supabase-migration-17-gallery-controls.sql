-- LRP Gallery — Migração 17: Controles granulares por galeria
-- Rode tudo de uma vez no Supabase SQL Editor

alter table public.galleries add column if not exists facial_recognition_enabled boolean default true;
alter table public.galleries add column if not exists paywall_enabled boolean default false;
alter table public.galleries add column if not exists full_url_delivery_disabled boolean default false;
alter table public.galleries alter column expires_at set default (now() + interval '90 days');

drop function if exists public.get_public_photos(text, int, int);
drop function if exists public.get_public_gallery(text, text);

create function public.get_public_photos(p_token text, p_offset int default 0, p_limit int default 500)
returns table (id uuid, filename text, thumb_url text, full_url text, "position" int, width int, height int, group_name text)
language sql security definer stable set search_path = public as
'select p.id, p.filename, p.thumb_url, case when g.full_url_delivery_disabled then null else p.full_url end, p.position, p.width, p.height, p.group_name
from photos p join galleries g on g.id = p.gallery_id
where g.access_token = p_token and g.status = ''live'' and (g.expires_at is null or g.expires_at > now())
order by p.position asc offset greatest(coalesce(p_offset,0),0) limit least(coalesce(p_limit,500), 500)';

create function public.get_photo_full_url(p_token text, p_photo_id uuid, p_visitor text, p_codes text[] default null)
returns text language plpgsql security definer set search_path = public as
'declare gid uuid; has_paywall boolean; is_paid boolean;
begin
  select g.id, coalesce(g.paywall_enabled, false) into gid, has_paywall from galleries g
  where g.access_token = p_token and g.status = ''live'' and (g.expires_at is null or g.expires_at > now());
  if gid is null then return null; end if;
  if has_paywall then
    is_paid := exists(select 1 from orders o where o.gallery_id = gid and o.visitor_id = p_visitor and o.status = ''approved'' and p_photo_id = any(o.photo_ids))
    or (p_codes is not null and array_length(p_codes, 1) > 0 and exists(select 1 from orders o where o.gallery_id = gid and o.status = ''approved'' and o.unlock_code = any(p_codes) and p_photo_id = any(o.photo_ids)));
    if not is_paid then return null; end if;
  end if;
  return (select p.full_url from photos p where p.gallery_id = gid and p.id = p_photo_id);
end';

grant execute on function public.get_photo_full_url(text,uuid,text,text[]) to anon, authenticated;

create function public.get_public_gallery(p_token text default null, p_slug text default null)
returns table (id uuid, name text, slug text, status text, cover_photo_id uuid, cover_position_x float8, cover_position_y float8, expires_at timestamptz, download_enabled boolean, has_password boolean, facial_recognition_enabled boolean, paywall_enabled boolean, full_url_delivery_disabled boolean)
language sql security definer stable set search_path = public as
'select g.id, g.name, g.slug, g.status, g.cover_photo_id, g.cover_position_x, g.cover_position_y, g.expires_at, g.download_enabled, (g.password_hash is not null), coalesce(g.facial_recognition_enabled, true), coalesce(g.paywall_enabled, false), coalesce(g.full_url_delivery_disabled, false)
from galleries g
where g.status = ''live'' and ((p_token is not null and g.access_token = p_token) or (p_token is null and p_slug is not null and g.slug = p_slug) or (p_token is null and p_slug is null))
and (g.expires_at is null or g.expires_at > now())
order by g.created_at desc limit 1';
