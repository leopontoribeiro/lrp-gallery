-- ============================================================
-- LRP Gallery — Migração 19: assinatura de upload (R2)
--
-- O painel admin subia fotos pro Supabase Storage (bucket "gallery-photos"),
-- que não existe mais desde a migração pro R2 — todo upload pelo site
-- (criar galeria com fotos, "Adicionar fotos", "Adicionar capa") estava
-- silenciosamente quebrado (bucket 404).
--
-- Esta RPC assina uma key de upload com o MESMO segredo (r2_signing_secret,
-- Vault) já usado pra assinar leituras — o Worker passa a aceitar essa
-- assinatura no PUT também (ver r2-signed-worker/src/index.js). Só o admin
-- autenticado (_admin_ok()) consegue gerar uma assinatura válida; expira em
-- 5 min — tempo de sobra pra 1 upload, curto o bastante pra não valer nada
-- se vazar de algum jeito.
--
-- Rode depois da migração 15. Reversível (só cria 1 function nova).
-- ============================================================
set search_path = public;

create or replace function public.get_upload_sig(p_key text)
returns jsonb language plpgsql security definer stable
set search_path = public, extensions as $$
declare
  secret text; win int := 300; exp bigint; sig text;
begin
  if not public._admin_ok() then return jsonb_build_object('error','forbidden'); end if;
  if p_key !~ '^galleries/[a-zA-Z0-9_-]+/[^/]+$' then return jsonb_build_object('error','bad_key'); end if;

  exp := extract(epoch from now())::bigint + win;
  secret := public._get_secret('r2_signing_secret');
  if secret is null then return jsonb_build_object('error','no_secret'); end if;
  sig := encode(hmac(p_key || ':' || exp::text, secret, 'sha256'), 'hex');
  return jsonb_build_object('key', p_key, 'exp', exp, 'sig', sig);
end; $$;

grant execute on function public.get_upload_sig(text) to authenticated;

-- Reverter: drop function public.get_upload_sig(text);
