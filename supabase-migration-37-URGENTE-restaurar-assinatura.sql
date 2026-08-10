-- ============================================================
-- LRP Gallery — Migração 37: URGENTE — restaura a assinatura das URLs
--
-- O QUE QUEBROU: ao reescrever get_public_photos na migração 34, eu me baseei
-- na versão da migração 17, que devolve p.thumb_url e p.full_url CRUS. Mas a
-- versão que estava em produção vinha da migração 8, que passa as duas pela
-- função _sign_r2_url (assina com HMAC e aplica marca d'água quando a galeria
-- pede). Sem assinatura, o Worker responde 403 e NENHUMA foto carrega — em
-- todas as galerias, não só nas protegidas por senha.
--
-- Mesmo erro em get_photo_full_url (foto em alta) e em get_purchased_photos
-- não foi tocada, então essa seguiu funcionando.
--
-- RODE ESTA MIGRAÇÃO IMEDIATAMENTE. Ela mantém tudo que a 34 trouxe
-- (validação de senha no servidor) e devolve a assinatura.
-- ============================================================
set search_path = public;

drop function if exists public.get_public_photos(text, int, int, text);
drop function if exists public.get_photo_full_url(text, uuid, text, text[], text);

-- ── Fotos: assinadas, com marca d'água conforme a flag da galeria ──
create function public.get_public_photos(
  p_token text, p_offset int default 0, p_limit int default 500, p_pw text default null)
returns table (id uuid, filename text, thumb_url text, full_url text,
               "position" int, width int, height int, group_name text)
language sql security definer stable set search_path = public as $$
  select p.id, p.filename,
         public._sign_r2_url(p.thumb_url, coalesce(g.watermark, false)) as thumb_url,
         case when g.full_url_delivery_disabled then null
              else public._sign_r2_url(p.full_url, coalesce(g.watermark, false)) end as full_url,
         p.position, p.width, p.height, p.group_name
  from photos p
  join galleries g on g.id = p.gallery_id
  where g.id = public._gallery_ok(p_token, p_pw)
  order by p.position asc
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(coalesce(p_limit, 500), 500);
$$;
grant execute on function public.get_public_photos(text, int, int, text) to anon, authenticated;

-- ── Foto em alta: assinada e SEM marca (é a versão comprada/liberada) ──
create function public.get_photo_full_url(
  p_token text, p_photo_id uuid, p_visitor text,
  p_codes text[] default null, p_pw text default null)
returns text language plpgsql security definer stable set search_path = public as $$
declare gid uuid; is_paid boolean;
begin
  gid := public._gallery_ok(p_token, p_pw);
  if gid is null then return null; end if;

  is_paid := exists(
      select 1 from orders o
      where o.gallery_id = gid and o.visitor_id = p_visitor
        and o.status = 'approved' and p_photo_id = any(o.photo_ids))
    or (p_codes is not null and array_length(p_codes, 1) > 0 and exists(
      select 1 from orders o
      where o.gallery_id = gid and o.status = 'approved'
        and o.unlock_code = any(p_codes) and p_photo_id = any(o.photo_ids)));

  if not is_paid and exists(
       select 1 from galleries g
       where g.id = gid and coalesce(g.paywall_enabled, false)) then
    return null;
  end if;

  return (select public._sign_r2_url(p.full_url) from photos p
          where p.gallery_id = gid and p.id = p_photo_id);
end $$;
grant execute on function public.get_photo_full_url(text, uuid, text, text[], text) to anon, authenticated;

-- ── Conferência: a URL devolvida TEM que conter 'sig=' ──
-- select left(thumb_url, 120) from public.get_public_photos('<TOKEN>', 0, 1, null);
