-- ============================================================
-- RPC para o preview do WhatsApp (Open Graph no edge).
-- Devolve o nome da galeria e a "key" da capa (thumb) no R2, sem assinar
-- (a assinatura de 90 dias é feita na Pages Function com o SIGNING_SECRET).
-- Cole no Supabase > SQL Editor e clique Run.
-- ============================================================

create or replace function public.get_og_meta(p_token text)
returns table(name text, cover_key text)
language sql security definer stable
set search_path = public as $$
  select g.name,
    split_part(
      regexp_replace(
        coalesce(
          (select p.thumb_url from photos p where p.id = g.cover_photo_id),
          (select p.thumb_url from photos p where p.gallery_id = g.id order by p.position asc limit 1)
        ), '^https?://[^/]+/', ''),
      '?', 1) as cover_key
  from galleries g
  where g.access_token = p_token and g.status = 'live'
    and g.deleted_at is null
  limit 1;
$$;

grant execute on function public.get_og_meta(text) to anon, authenticated;
