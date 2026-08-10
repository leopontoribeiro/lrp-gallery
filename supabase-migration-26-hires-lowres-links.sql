-- ============================================================
-- LRP Gallery — Migração 26: links externos de fotos em alta/baixa
-- (ex.: pasta do Google Drive), definidos pelo admin e exibidos
-- como botões na capa da galeria pro cliente.
-- ============================================================
set search_path = public;

alter table public.galleries add column if not exists high_res_url text;
alter table public.galleries add column if not exists low_res_url text;

drop function if exists public.get_public_gallery(text, text);

create function public.get_public_gallery(p_token text default null, p_slug text default null)
returns table (id uuid, name text, slug text, status text, cover_photo_id uuid, cover_position_x float8, cover_position_y float8, expires_at timestamptz, download_enabled boolean, has_password boolean, facial_recognition_enabled boolean, paywall_enabled boolean, full_url_delivery_disabled boolean, high_res_url text, low_res_url text)
language sql security definer stable set search_path = public as
'select g.id, g.name, g.slug, g.status, g.cover_photo_id, g.cover_position_x, g.cover_position_y, g.expires_at, g.download_enabled, (g.password_hash is not null), coalesce(g.facial_recognition_enabled, true), coalesce(g.paywall_enabled, false), coalesce(g.full_url_delivery_disabled, false), g.high_res_url, g.low_res_url
from galleries g
where g.status = ''live'' and ((p_token is not null and g.access_token = p_token) or (p_token is null and p_slug is not null and g.slug = p_slug) or (p_token is null and p_slug is null))
and (g.expires_at is null or g.expires_at > now())
order by g.created_at desc limit 1';

grant execute on function public.get_public_gallery(text,text) to anon, authenticated;

-- Reverter: dropar a função, recriar a versão da migração 17 (sem high_res_url/low_res_url),
-- e dropar as duas colunas novas de galleries.
