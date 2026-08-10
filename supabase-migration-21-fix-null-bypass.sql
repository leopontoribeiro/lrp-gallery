-- ============================================================
-- LRP Gallery — Migração 21: corrige bypass de admin em NULL
--
-- Bug real encontrado testando get_upload_sig: em PL/pgSQL, "IF NOT x THEN"
-- pula o bloco quando x é NULL (NULL é tratado como falso no IF, mas "NOT
-- NULL" também é NULL, e "IF NULL" não entra no bloco) — ou seja, quando
-- _admin_ok() retorna NULL (ex.: chamada sem claim de e-mail no JWT: anon,
-- service_role, ou qualquer sessão fora do padrão), a função pulava o
-- "return forbidden" e devolvia uma assinatura válida do mesmo jeito.
-- Testado ao vivo: get_upload_sig com service_role (sem e-mail no JWT)
-- devolveu sig válida em vez de {"error":"forbidden"}.
--
-- RLS (USING/WITH CHECK) trata NULL como "linha bloqueada" corretamente —
-- só esse IF procedural nas duas RPCs novas (migrações 19 e 20) tinha o
-- bug. Corrige com coalesce(_admin_ok(), false).
--
-- Rode depois da migração 20. Reversível (só troca 2 functions).
-- ============================================================
set search_path = public;

create or replace function public.get_upload_sig(p_key text)
returns jsonb language plpgsql security definer stable
set search_path = public, extensions as $$
declare
  secret text; win int := 300; exp bigint; sig text;
begin
  if not coalesce(public._admin_ok(), false) then return jsonb_build_object('error','forbidden'); end if;
  if p_key !~ '^galleries/[a-zA-Z0-9_-]+/[^/]+$' then return jsonb_build_object('error','bad_key'); end if;

  exp := extract(epoch from now())::bigint + win;
  secret := public._get_secret('r2_signing_secret');
  if secret is null then return jsonb_build_object('error','no_secret'); end if;
  sig := encode(hmac(p_key || ':' || exp::text, secret, 'sha256'), 'hex');
  return jsonb_build_object('key', p_key, 'exp', exp, 'sig', sig);
end; $$;

create or replace function public.get_delete_sig(p_key text)
returns jsonb language plpgsql security definer stable
set search_path = public, extensions as $$
declare
  secret text; win int := 300; exp bigint; sig text;
begin
  if not coalesce(public._admin_ok(), false) then return jsonb_build_object('error','forbidden'); end if;
  if p_key !~ '^galleries/[a-zA-Z0-9_-]+/[^/]+$' then return jsonb_build_object('error','bad_key'); end if;

  exp := extract(epoch from now())::bigint + win;
  secret := public._get_secret('r2_signing_secret');
  if secret is null then return jsonb_build_object('error','no_secret'); end if;
  sig := encode(hmac(p_key || ':' || exp::text || ':del', secret, 'sha256'), 'hex');
  return jsonb_build_object('key', p_key, 'exp', exp, 'sig', sig);
end; $$;

-- Reverter: colar de novo o corpo original das migrações 19/20.
