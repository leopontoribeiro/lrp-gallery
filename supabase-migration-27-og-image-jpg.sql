-- ============================================================
-- LRP Gallery — Migração 27: capa do preview do WhatsApp em JPEG, não WebP
-- O WhatsApp/Facebook tem um bug conhecido: não renderiza og:image em .webp
-- (a imagem carrega normal em qualquer lugar, só o preview do link que falha).
-- Troca a fonte da capa de thumb_url (.webp) pra full_url (formato original,
-- normalmente .jpg) só pro preview — a galeria em si não muda em nada.
-- ============================================================
set search_path = public;

create or replace function public.get_og_meta(p_token text)
returns table(name text, cover_key text)
language sql security definer stable
set search_path = public as $$
  select g.name,
    split_part(
      regexp_replace(
        coalesce(
          (select p.full_url from photos p where p.id = g.cover_photo_id),
          (select p.full_url from photos p where p.gallery_id = g.id order by p.position asc limit 1)
        ), '^https?://[^/]+/', ''),
      '?', 1) as cover_key
  from galleries g
  where g.access_token = p_token and g.status = 'live'
    and g.deleted_at is null
  limit 1;
$$;

grant execute on function public.get_og_meta(text) to anon, authenticated;
