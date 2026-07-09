-- ============================================================
-- LRP Gallery — Migração 7: segredo de assinatura no Supabase Vault
-- Move 'r2_signing_secret' de app_secrets (texto puro) para o Vault
-- (criptografado em repouso). Retrocompatível: um helper lê o Vault
-- primeiro e cai em app_secrets se preciso — nada quebra durante a troca.
-- Rode DEPOIS das migrações 3 e 6.
-- ============================================================
set search_path = public;

-- 1. Vault disponível
create extension if not exists supabase_vault with schema vault;

-- 2. Copia o valor atual (de app_secrets) para o Vault, idempotente.
do $$
declare v text; sid uuid;
begin
  select value into v from public.app_secrets where key = 'r2_signing_secret';
  if v is null then
    raise notice 'sem r2_signing_secret em app_secrets — nada a mover';
  else
    select id into sid from vault.secrets where name = 'r2_signing_secret';
    if sid is null then perform vault.create_secret(v, 'r2_signing_secret', 'HMAC das URLs assinadas do R2');
    else perform vault.update_secret(sid, v); end if;
  end if;
end $$;

-- 3. Helper único: lê o Vault; se não achar, cai em app_secrets.
create or replace function public._get_secret(p_name text)
returns text language plpgsql stable security definer
set search_path = public, vault, extensions as $$
declare v text;
begin
  begin
    select decrypted_secret into v from vault.decrypted_secrets where name = p_name limit 1;
  exception when others then v := null; end;
  if v is null then
    select value into v from public.app_secrets where app_secrets.key = p_name;
  end if;
  return v;
end $$;
revoke execute on function public._get_secret(text) from public, anon, authenticated;

-- 4. Aponta o assinador de URLs para o helper (base pública continua em app_secrets).
create or replace function public._sign_r2_url(p_url text)
returns text language plpgsql stable security definer
set search_path = public, extensions as $$
declare
  secret text; base text; win int := 21600;
  okey text; exp bigint; sig text;
begin
  if p_url is null then return p_url; end if;
  secret := public._get_secret('r2_signing_secret');
  base   := public._get_secret('r2_signed_base');
  if secret is null or base is null then return p_url; end if;

  okey := regexp_replace(p_url, '^https?://[^/]+/', '');
  okey := split_part(okey, '?', 1);
  if okey not like 'galleries/%' then return p_url; end if;

  exp := (floor(extract(epoch from now()) / win)::bigint + 2) * win;
  sig := encode(hmac(okey || ':' || exp::text, secret, 'sha256'), 'hex');
  return base || '/' || okey || '?exp=' || exp::text || '&sig=' || sig;
end; $$;

-- 5. Idem para o manifesto do ZIP (migração 6).
create or replace function public.get_zip_manifest(p_token text, p_ids uuid[] default null)
returns jsonb language plpgsql security definer stable
set search_path = public, extensions as $$
declare
  gid uuid; dl boolean; secret text;
  keys text[]; names text[];
  win int := 21600; exp bigint; sig text;
begin
  select id, coalesce(download_enabled, true) into gid, dl
    from galleries where access_token = p_token and status = 'live';
  if gid is null then return jsonb_build_object('error','not_found'); end if;
  if not dl then return jsonb_build_object('error','downloads_disabled'); end if;

  select array_agg(k order by ord), array_agg(nm order by ord) into keys, names
  from (
    select split_part(regexp_replace(p.full_url, '^https?://[^/]+/', ''), '?', 1) as k,
           coalesce(nullif(p.filename,''), 'foto-' || p.position::text || '.jpg')  as nm,
           p.position as ord
    from photos p
    where p.gallery_id = gid
      and (p_ids is null or p.id = any(p_ids))
      and split_part(regexp_replace(p.full_url, '^https?://[^/]+/', ''), '?', 1) like 'galleries/%'
    order by p.position asc limit 2000
  ) s;
  if keys is null or array_length(keys,1) is null then
    return jsonb_build_object('error','no_photos'); end if;

  exp := (floor(extract(epoch from now()) / win)::bigint + 2) * win;
  secret := public._get_secret('r2_signing_secret');
  if secret is null then sig := '';
  else sig := encode(hmac(array_to_string(keys, E'\n') || ':' || exp::text, secret, 'sha256'), 'hex'); end if;

  return jsonb_build_object('keys', keys, 'names', names, 'exp', exp, 'sig', sig);
end; $$;

-- ============================================================
-- DEPOIS de validar (imagens carregam + download ok), remova o texto puro:
--   delete from public.app_secrets where key = 'r2_signing_secret';
-- (a base pública 'r2_signed_base' pode ficar em app_secrets — não é segredo.)
--
-- Reverter: reinserir em app_secrets e as funções voltam a lê-lo pelo fallback.
-- ============================================================
