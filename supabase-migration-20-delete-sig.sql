-- ============================================================
-- LRP Gallery — Migração 20: assinatura de delete (R2)
--
-- deletePhoto() no painel admin chamava sb.storage.from(BUCKET).remove(),
-- mas o bucket "gallery-photos" do Supabase Storage não existe mais desde a
-- migração pro R2 (ver migração 19) — a chamada era um no-op silencioso: não
-- dava erro, mas também não apagava nada. O objeto real (full + thumb) ficava
-- órfão no R2 pra sempre.
--
-- Esta RPC assina uma key de delete com o MESMO segredo (r2_signing_secret,
-- Vault) usado pra assinar upload/leitura, mas com suffix ':del' — escopa a
-- assinatura só pra delete, então uma sig de upload vazada não serve pra
-- apagar nada (ver validSigAny em r2-signed-worker/src/index.js). Só o admin
-- autenticado (_admin_ok()) gera uma assinatura válida; expira em 5 min.
--
-- Rode depois da migração 19. Reversível (só cria 1 function nova).
-- ============================================================
set search_path = public;

create or replace function public.get_delete_sig(p_key text)
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
  sig := encode(hmac(p_key || ':' || exp::text || ':del', secret, 'sha256'), 'hex');
  return jsonb_build_object('key', p_key, 'exp', exp, 'sig', sig);
end; $$;

grant execute on function public.get_delete_sig(text) to authenticated;

-- Reverter: drop function public.get_delete_sig(text);
