-- ============================================================
-- LRP Gallery — Migração 18: correções de segurança (revisão sênior)
--  #5  Guard NULL em funções privilegiadas (p_secret NULL burlava a checagem:
--      em SQL, `null <> ws` = NULL, e o IF não dispara -> executava sem auth).
--      Correção: `p_secret is distinct from ws` (trata NULL como diferente).
--  #6  Rate-limit em verify_gallery_password (brute-force de senha de álbum).
-- Rode DEPOIS da 12/13/16. Reversível. Idempotente.
-- ============================================================
set search_path = public;

-- ---------- #5a: cleanup_pending_orders ----------
create or replace function public.cleanup_pending_orders(p_secret text)
returns int language plpgsql security definer set search_path = public as $$
declare ws text; n int;
begin
  ws := public._get_secret('worker_secret');
  if ws is null or p_secret is distinct from ws then return -1; end if;
  with d as (delete from orders where status = 'pending' and created_at < now() - interval '24 hours' returning 1)
  select count(*) into n from d;
  return n;
end; $$;
grant execute on function public.cleanup_pending_orders(text) to anon, authenticated;

-- ---------- #5b: retention_cleanup ----------
create or replace function public.retention_cleanup(p_secret text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ws text; a int; b int; c int; d int;
begin
  ws := public._get_secret('worker_secret');
  if ws is null or p_secret is distinct from ws then return jsonb_build_object('error','forbidden'); end if;
  with x as (delete from face_indexes fi using galleries g
    where g.id = fi.gallery_id and g.expires_at is not null and g.expires_at < now() - interval '30 days' returning 1)
  select count(*) into a from x;
  with x as (delete from orders o using galleries g
    where g.id = o.gallery_id and g.expires_at is not null and g.expires_at < now() - interval '180 days' returning 1)
  select count(*) into b from x;
  with x as (update orders set email = null where email is not null and created_at < now() - interval '180 days' returning 1)
  select count(*) into c from x;
  with x as (delete from selections s using galleries g
    where g.id = s.gallery_id and g.expires_at is not null and g.expires_at < now() - interval '90 days' returning 1)
  select count(*) into d from x;
  return jsonb_build_object('face_indexes', a, 'orders', b, 'emails_cleared', c, 'selections', d);
end; $$;
grant execute on function public.retention_cleanup(text) to anon, authenticated;

-- (settle_order já trata `p_secret is null` explicitamente — não precisa mexer.)

-- ---------- #6: rate-limit de senha de álbum ----------
-- Tabela de tentativas (não exposta ao anon; só a função definer escreve).
create table if not exists public.password_attempts (
  token text not null,
  ts    timestamptz not null default now()
);
create index if not exists idx_pw_attempts_token_ts on public.password_attempts(token, ts);
alter table public.password_attempts enable row level security;
revoke all on public.password_attempts from anon, authenticated;

-- verify_gallery_password agora limita a 8 tentativas por álbum a cada 60s.
-- Usuário legítimo acerta na 1ª tentativa (não é afetado); atacante fica preso
-- ao teto. Não trava permanentemente -> baixo risco de DoS. O ideal (rate-limit
-- por IP na borda) fica como evolução; isto já torna o brute-force inviável.
create or replace function public.verify_gallery_password(p_token text, p_hash text)
returns boolean language plpgsql security definer set search_path = public as $$
declare cnt int; ok boolean;
begin
  delete from password_attempts where ts < now() - interval '10 minutes';
  select count(*) into cnt from password_attempts
    where token = p_token and ts > now() - interval '60 seconds';
  if cnt >= 8 then return false; end if;              -- throttled
  insert into password_attempts(token) values (p_token);
  select exists(
    select 1 from galleries where access_token = p_token and password_hash = p_hash
  ) into ok;
  return ok;
end; $$;
grant execute on function public.verify_gallery_password(text,text) to anon;
