-- ============================================================
-- LRP Gallery — Migração 3: URLs assinadas (privacidade dos originais)
-- Rode DEPOIS da migração 2. É retrocompatível: enquanto os segredos
-- não forem inseridos em app_secrets, as URLs voltam iguais às atuais.
-- ============================================================

create extension if not exists pgcrypto;

-- Tabela privada de segredos (nunca exposta ao anon/authenticated)
create table if not exists public.app_secrets (
  key   text primary key,
  value text not null
);
revoke all on public.app_secrets from anon, authenticated;

-- Assina uma URL de objeto do R2. Se não houver segredo/base configurados,
-- devolve a URL original (modo compatível — nada muda).
create or replace function public._sign_r2_url(p_url text)
returns text language plpgsql stable security definer
set search_path = public, extensions as $$
declare
  secret text; base text; win int := 21600; -- janela de 6h (mantém cache eficiente)
  okey text; exp bigint; sig text;
begin
  if p_url is null then return p_url; end if;
  select value into secret from app_secrets where app_secrets.key = 'r2_signing_secret';
  select value into base   from app_secrets where app_secrets.key = 'r2_signed_base';
  if secret is null or base is null then return p_url; end if;

  -- extrai a "key" do objeto (tudo após o domínio; remove querystring)
  okey := regexp_replace(p_url, '^https?://[^/]+/', '');
  okey := split_part(okey, '?', 1);

  -- só assina objetos nossos do R2 (galleries/...); ignora demo/picsum etc.
  if okey not like 'galleries/%' then return p_url; end if;

  -- expiração alinhada à janela → mesma URL dentro do período = cacheável
  exp := (floor(extract(epoch from now()) / win)::bigint + 2) * win;
  sig := encode(hmac(okey || ':' || exp::text, secret, 'sha256'), 'hex');
  return base || '/' || okey || '?exp=' || exp::text || '&sig=' || sig;
end; $$;

-- anon NÃO pode assinar keys arbitrárias diretamente
revoke execute on function public._sign_r2_url(text) from public, anon, authenticated;

-- Recria get_public_photos assinando thumb_url e full_url
create or replace function public.get_public_photos(p_token text, p_offset int default 0, p_limit int default 500)
returns table (
  id uuid, filename text, thumb_url text, full_url text,
  "position" int, width int, height int, group_name text
) language sql security definer stable
set search_path = public as $$
  select p.id, p.filename,
         public._sign_r2_url(p.thumb_url) as thumb_url,
         public._sign_r2_url(p.full_url)  as full_url,
         p.position, p.width, p.height, p.group_name
  from photos p
  join galleries g on g.id = p.gallery_id
  where g.access_token = p_token and g.status = 'live'
  order by p.position asc
  offset greatest(coalesce(p_offset,0),0)
  limit least(coalesce(p_limit,500), 500);
$$;

-- ============================================================
-- ATIVAÇÃO (só quando o worker novo estiver no ar e testado):
--   Insira os MESMOS valores que você configurou no worker.
--   'r2_signed_base' = URL pública do worker novo (sem barra no fim).
--
-- insert into public.app_secrets(key, value) values
--   ('r2_signing_secret', 'COLE_O_MESMO_SIGNING_SECRET_DO_WORKER'),
--   ('r2_signed_base',    'https://lrp-gallery-signed.SEU-SUBDOMINIO.workers.dev')
-- on conflict (key) do update set value = excluded.value;
--
-- Para DESATIVAR (voltar ao comportamento atual):
--   delete from public.app_secrets where key in ('r2_signing_secret','r2_signed_base');
-- ============================================================
