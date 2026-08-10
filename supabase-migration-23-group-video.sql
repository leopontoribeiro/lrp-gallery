-- ============================================================
-- LRP Gallery — Migração 23: vídeo do evento (por grupo, opcional)
--
-- Vídeo fica só como referência em gallery_groups — não vira uma "foto"
-- (não entra no grid, no zip, no índice facial). O ARQUIVO em si é
-- guardado no R2 sob a key de um álbum-filho do grupo (galleries/<id>/...),
-- reaproveitando 100% da assinatura/upload que já existe pras fotos —
-- por isso as colunas guardam a URL completa, já assinável por
-- _sign_r2_url() do mesmo jeito que a capa do grupo.
--
-- Rode depois da migração 15 (usa _admin_ok/_sign_r2_url já existentes).
-- Reversível: as 3 colunas podem ser removidas sem afetar mais nada.
-- ============================================================
set search_path = public;

alter table public.gallery_groups
  add column if not exists video_url text,
  add column if not exists video_thumb_url text,
  add column if not exists video_filename text;

-- get_public_group (migration-grupos-limpo.sql) passa a devolver o vídeo
-- assinado também, do mesmo jeito que já assina a capa.
create or replace function public.get_public_group(p_token text)
returns jsonb language plpgsql security definer stable
set search_path = public as $$
declare grp record; kids jsonb;
begin
  select id, name, cover_photo_id, video_url, video_thumb_url, video_filename
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
    'video', public._sign_r2_url(grp.video_url),
    'video_thumb', public._sign_r2_url(grp.video_thumb_url),
    'video_filename', grp.video_filename,
    'galleries', kids
  );
end $$;

grant execute on function public.get_public_group(text) to anon, authenticated;

-- Reverter: alter table public.gallery_groups drop column video_url, drop column video_thumb_url, drop column video_filename;
