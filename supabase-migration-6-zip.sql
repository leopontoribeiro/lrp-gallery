-- ============================================================
-- LRP Gallery — Migração 6: ZIP server-side (download escalável)
-- Rode DEPOIS da migração 3 (usa app_secrets / assinatura).
-- Gera um "manifesto" assinado que o Worker usa para montar o ZIP
-- lendo os objetos direto do R2 — sem baixar tudo pro navegador.
-- Reversível: dropar a função não afeta nada.
-- ============================================================
set search_path = public;

-- Retorna { keys[], names[], exp, sig } assinado.
--   p_ids = null  -> todas as fotos da galeria (respeita ordem)
--   p_ids = [..]  -> só essas fotos (favoritas), ainda validadas contra a galeria
-- Respeita download_enabled e status='live'. Se não houver segredo
-- configurado, devolve sig vazio (o Worker recusa) — modo seguro.
create or replace function public.get_zip_manifest(p_token text, p_ids uuid[] default null)
returns jsonb
language plpgsql security definer stable
set search_path = public, extensions as $$
declare
  gid uuid; dl boolean; secret text;
  keys text[]; names text[];
  win int := 21600; exp bigint; sig text;
begin
  select id, coalesce(download_enabled, true)
    into gid, dl
    from galleries where access_token = p_token and status = 'live';
  if gid is null then return jsonb_build_object('error','not_found'); end if;
  if not dl then return jsonb_build_object('error','downloads_disabled'); end if;

  -- extrai keys (galleries/...) e nomes, na ordem da galeria, com limite de segurança
  select array_agg(k order by ord), array_agg(nm order by ord)
    into keys, names
  from (
    select
      split_part(regexp_replace(p.full_url, '^https?://[^/]+/', ''), '?', 1) as k,
      coalesce(nullif(p.filename,''), 'foto-' || p.position::text || '.jpg')  as nm,
      p.position as ord
    from photos p
    where p.gallery_id = gid
      and (p_ids is null or p.id = any(p_ids))
      and split_part(regexp_replace(p.full_url, '^https?://[^/]+/', ''), '?', 1) like 'galleries/%'
    order by p.position asc
    limit 2000
  ) s;

  if keys is null or array_length(keys,1) is null then
    return jsonb_build_object('error','no_photos');
  end if;

  exp := (floor(extract(epoch from now()) / win)::bigint + 2) * win;

  select value into secret from app_secrets where app_secrets.key = 'r2_signing_secret';
  if secret is null then
    sig := '';  -- sem segredo: Worker recusa (não vaza objetos)
  else
    sig := encode(hmac(array_to_string(keys, E'\n') || ':' || exp::text, secret, 'sha256'), 'hex');
  end if;

  return jsonb_build_object('keys', keys, 'names', names, 'exp', exp, 'sig', sig);
end; $$;

grant execute on function public.get_zip_manifest(text, uuid[]) to anon, authenticated;

-- ============================================================
-- Para reverter:  drop function public.get_zip_manifest(text, uuid[]);
-- ============================================================
