-- ============================================================
-- LRP Gallery — Migração 42: preview do WhatsApp também para /grupo.html
--
-- POR QUÊ: o middleware (functions/_middleware.js) já injeta og:title/
-- og:image ANTES de entregar o HTML, pro robô do WhatsApp/Facebook (que
-- não executa JavaScript) mostrar nome + capa. Mas a RPC get_og_meta
-- (migração 33) só buscava em `galleries` — um link de GRUPO
-- (grupo.html?t=...) sempre caía em "não é galeria" e saía sem preview.
-- O próprio código já previa isso (comentário "token não é de galeria
-- (ex.: grupo)"), só faltava implementar o lado do grupo.
--
-- Esta migração troca get_og_meta por uma versão que tenta `galleries`
-- primeiro (comportamento IDÊNTICO ao de hoje, nada muda pra link de
-- galeria) e, se não achar, tenta `gallery_groups`: usa a capa do grupo
-- se tiver, senão cai pra 1ª foto da 1ª galeria "live" dentro do grupo
-- (mesmo fallback que get_public_group já usa pro grupo.html renderizar
-- a capa na tela).
-- ============================================================
set search_path = public;

create or replace function public.get_og_meta(p_token text)
returns table(name text, cover_key text)
language plpgsql security definer stable
set search_path = public as $$
declare
  found boolean;
begin
  -- 1) Galeria (comportamento de sempre — migração 33 inalterada em espírito)
  return query
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

  get diagnostics found = row_count > 0;
  if found then return; end if;

  -- 2) Grupo de galerias: capa do próprio grupo, senão 1ª foto da 1ª
  --    galeria "live" dentro dele (mesmo fallback do get_public_group).
  return query
    with grp as (
      select id, name, cover_photo_id
      from gallery_groups
      where access_token = p_token and status = 'live' and deleted_at is null
      limit 1
    ),
    cover as (
      select p.thumb_url, p.full_url
      from grp
      join photos p on p.id = coalesce(
        grp.cover_photo_id,
        (
          select p2.id from photos p2
          join galleries g2 on g2.id = p2.gallery_id
          where g2.gallery_group_id = grp.id and g2.status = 'live' and g2.deleted_at is null
          order by g2.created_at asc, p2.position asc
          limit 1
        )
      )
      limit 1
    )
    select grp.name,
      split_part(
        regexp_replace(
          case
            when c.thumb_url is not null
             and split_part(c.thumb_url, '/', 3) = split_part(c.full_url, '/', 3)
            then c.thumb_url
            else c.full_url
          end, '^https?://[^/]+/', ''),
        '?', 1) as cover_key
    from grp
    left join cover c on true;
end $$;

grant execute on function public.get_og_meta(text) to anon, authenticated;
