-- ============================================================
-- LRP Gallery — Migração 34: a senha da galeria passa a valer NO SERVIDOR
--
-- PROBLEMA (crítico): a senha era só um overlay no navegador.
--   get_public_photos(p_token) devolvia todas as fotos sem checar senha
--   nenhuma, e a chave anon é pública por design. Ou seja: qualquer pessoa
--   com o link chamava a RPC direto e recebia a galeria inteira sem digitar
--   a senha. No modo antigo "hash", o próprio hash era ENTREGUE ao
--   navegador para comparação local — bastava abrir o inspetor.
--
-- SOLUÇÃO: toda RPC que devolve conteúdo passa a receber p_pw (o mesmo
--   SHA-256 que o gate já calcula) e só devolve dados se:
--     - a galeria não tem senha, OU
--     - o hash enviado bate com o armazenado.
--   Sem isso, retorna vazio — nunca um erro que diferencie "senha errada"
--   de "galeria inexistente" (não damos pista para quem sonda tokens).
--
-- COMPATIBILIDADE: as assinaturas antigas são REMOVIDAS de propósito.
--   Um cliente velho em cache passa a receber vazio numa galeria com senha
--   (falha fechada) em vez de continuar vazando. Galerias SEM senha seguem
--   funcionando igual, porque p_pw tem default null.
--
-- Rodar DEPOIS de publicar o site novo (gallery.html + gallery-gate.js).
-- ============================================================
set search_path = public;

-- ── Porteiro único: devolve o id da galeria se o acesso é legítimo ──
create or replace function public._gallery_ok(p_token text, p_pw text default null)
returns uuid language sql security definer stable
set search_path = public as $$
  select g.id
  from galleries g
  where g.access_token = p_token
    and g.status = 'live'
    and g.deleted_at is null
    and (g.expires_at is null or g.expires_at > now())
    and (g.password_hash is null or g.password_hash = p_pw)
  limit 1;
$$;
revoke execute on function public._gallery_ok(text, text) from anon, authenticated;

-- Remove TODAS as sobrecargas antigas (algumas migrações deixaram duplicatas
-- que causavam "Could not choose the best candidate function").
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('get_public_photos','get_public_photo_count',
                        'get_photo_full_url','get_public_gallery_videos',
                        'get_paid_zip_manifest')
  loop
    execute 'drop function ' || r.sig;
  end loop;
end $$;

-- ── Fotos ───────────────────────────────────────────────────
create function public.get_public_photos(
  p_token text, p_offset int default 0, p_limit int default 500, p_pw text default null)
returns table (id uuid, filename text, thumb_url text, full_url text,
               "position" int, width int, height int, group_name text)
language sql security definer stable set search_path = public as $$
  select p.id, p.filename, p.thumb_url,
         case when g.full_url_delivery_disabled then null else p.full_url end,
         p.position, p.width, p.height, p.group_name
  from photos p
  join galleries g on g.id = p.gallery_id
  where g.id = public._gallery_ok(p_token, p_pw)
  order by p.position asc
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(coalesce(p_limit, 500), 500);
$$;
grant execute on function public.get_public_photos(text, int, int, text) to anon, authenticated;

-- ── Contagem ────────────────────────────────────────────────
create function public.get_public_photo_count(p_token text, p_pw text default null)
returns integer language sql security definer stable set search_path = public as $$
  select count(*)::int from photos p
  where p.gallery_id = public._gallery_ok(p_token, p_pw);
$$;
grant execute on function public.get_public_photo_count(text, text) to anon, authenticated;

-- ── URL da foto em alta (respeita paywall como antes) ───────
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

  return (select p.full_url from photos p
          where p.gallery_id = gid and p.id = p_photo_id);
end $$;
grant execute on function public.get_photo_full_url(text, uuid, text, text[], text) to anon, authenticated;

-- ── Vídeos ──────────────────────────────────────────────────
create function public.get_public_gallery_videos(p_token text, p_pw text default null)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare gid uuid;
begin
  gid := public._gallery_ok(p_token, p_pw);
  if gid is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', v.id, 'name', v.name,
      'video', public._sign_r2_url(v.video_url),
      'thumb', public._sign_r2_url(v.thumb_url),
      'size_bytes', v.size_bytes, 'duration', v.duration_seconds
    ) order by v.position)
    from gallery_videos v where v.gallery_id = gid
  ), '[]'::jsonb);
end $$;
grant execute on function public.get_public_gallery_videos(text, text) to anon, authenticated;

-- ── ZIP das fotos compradas ─────────────────────────────────
create function public.get_paid_zip_manifest(
  p_token text, p_visitor text, p_codes text[] default null, p_pw text default null)
returns jsonb language plpgsql security definer stable
set search_path = public, extensions as $$
declare gid uuid; secret text; keys text[]; names text[]; win int := 21600; exp bigint; sig text;
begin
  gid := public._gallery_ok(p_token, p_pw);
  if gid is null then return jsonb_build_object('error','not_found'); end if;
  select array_agg(k order by ord), array_agg(nm order by ord) into keys, names
  from (
    select split_part(regexp_replace(p.full_url,'^https?://[^/]+/',''),'?',1) as k,
           coalesce(nullif(p.filename,''),'foto-'||p.position::text||'.jpg') as nm, p.position as ord
    from photos p
    where p.gallery_id = gid
      and split_part(regexp_replace(p.full_url,'^https?://[^/]+/',''),'?',1) like 'galleries/%'
      and exists (select 1 from orders o where o.gallery_id=gid and o.status='approved' and p.id = any(o.photo_ids)
                    and (o.visitor_id = p_visitor or (p_codes is not null and o.unlock_code = any(p_codes))))
    order by p.position asc limit 2000
  ) s;
  if keys is null then return jsonb_build_object('error','no_photos'); end if;
  exp := (floor(extract(epoch from now())/win)::bigint + 2)*win;
  secret := public._get_secret('r2_signing_secret');
  if secret is null then sig := '';
  else sig := encode(hmac(array_to_string(keys,E'\n')||':'||exp::text, secret, 'sha256'),'hex'); end if;
  return jsonb_build_object('keys',keys,'names',names,'exp',exp,'sig',sig);
end $$;
grant execute on function public.get_paid_zip_manifest(text, text, text[], text) to anon, authenticated;

-- ── Nunca mais entregar o hash da senha ao navegador ────────
-- get_public_gallery já devolve só o booleano has_password. Reforçando:
-- se alguma view/policy expuser galleries.password_hash ao anon, isso
-- anula toda esta migração. Confira com:
--   select grantee, privilege_type from information_schema.column_privileges
--   where table_name='galleries' and column_name='password_hash';
