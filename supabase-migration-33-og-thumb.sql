-- ============================================================
-- LRP Gallery — Migração 33: capa do preview vem da MINIATURA, não do original
--
-- Por que: a migração 27 passou a usar full_url (o JPEG original) como
-- og:image. Medido em produção: 4,6 MB. Dois problemas:
--   1. O robô do WhatsApp/Facebook ignora imagens desse peso — o card do
--      link sai sem foto.
--   2. O Worker não consegue redimensionar: decodificar um JPEG de ~24MP
--      pra RGBA cru passa de 90MB e estoura o limite de 128MB do isolate
--      (o WASM aborta com "unreachable").
--
-- A miniatura já existe, é pequena e o Worker converte pra JPEG sem esforço.
-- Só usamos a miniatura quando ela está no MESMO host do original (ou seja,
-- é um objeto do R2 servido pelo worker assinado). Se a miniatura vier de
-- outro lugar (URLs antigas do Supabase Storage), continuamos no full_url —
-- nesse caso o Worker tem fallback e serve o arquivo como está.
-- ============================================================
set search_path = public;

create or replace function public.get_og_meta(p_token text)
returns table(name text, cover_key text)
language sql security definer stable
set search_path = public as $$
  with cover as (
    select p.thumb_url, p.full_url
    from galleries g
    join photos p on p.id = coalesce(
      g.cover_photo_id,
      (select p2.id from photos p2 where p2.gallery_id = g.id order by p2.position asc limit 1)
    )
    where g.access_token = p_token and g.status = 'live' and g.deleted_at is null
    limit 1
  )
  select g.name,
    split_part(
      regexp_replace(
        case
          when c.thumb_url is not null
           and split_part(c.thumb_url, '/', 3) = split_part(c.full_url, '/', 3)
          then c.thumb_url
          else c.full_url
        end, '^https?://[^/]+/', ''),
      '?', 1) as cover_key
  from galleries g
  left join cover c on true
  where g.access_token = p_token and g.status = 'live' and g.deleted_at is null
  limit 1;
$$;

grant execute on function public.get_og_meta(text) to anon, authenticated;
