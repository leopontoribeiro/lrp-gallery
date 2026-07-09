-- ============================================================
-- LRP Gallery — Migração 12: Worker sem service key + retenção de dados
-- Substitui o uso da service_role no Worker por RPCs escopadas, protegidas
-- por um segredo próprio ('worker_secret' em app_secrets). Se o Worker vazar,
-- o dano fica limitado a pedidos — não é o banco inteiro.
-- Rode depois das migrações 10 e 11. Reversível.
-- ============================================================
set search_path = public;
create extension if not exists pgcrypto;

-- 1. Criar pedido pendente (inofensivo -> anon pode). Valida galeria/preço/fotos.
create or replace function public.create_paid_order(p_token text, p_visitor text, p_photo_ids uuid[], p_origin text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare gid uuid; price int; gname text; valid uuid[]; amount int; oid uuid;
begin
  select id, coalesce(price_cents,0), name into gid, price, gname
  from galleries where access_token = p_token and status = 'live' and coalesce(watermark,false) = true;
  if gid is null or price <= 0 then return jsonb_build_object('error','no_paywall'); end if;
  select array_agg(id) into valid from photos where gallery_id = gid and id = any(p_photo_ids);
  if valid is null then return jsonb_build_object('error','no_photos'); end if;
  amount := price * array_length(valid,1);
  insert into orders(gallery_id, visitor_id, photo_ids, amount_cents, status, origin)
  values (gid, p_visitor, valid, amount, 'pending', p_origin) returning id into oid;
  return jsonb_build_object('order_id', oid, 'amount_cents', amount, 'gallery_name', gname, 'count', array_length(valid,1));
end; $$;
grant execute on function public.create_paid_order(text,text,uuid[],text) to anon, authenticated;

-- 2. Liquidar pedido (aprovar/revogar) — PRIVILEGIADO: exige o worker_secret.
--    O código de desbloqueio é gerado aqui (não depende do Worker).
create or replace function public.settle_order(p_secret text, p_order_id uuid, p_status text, p_mp_ref text, p_email text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare ws text; o record;
begin
  ws := public._get_secret('worker_secret');
  if ws is null or p_secret is null or p_secret <> ws then return jsonb_build_object('error','forbidden'); end if;
  if p_status not in ('approved','revoked') then return jsonb_build_object('error','bad_status'); end if;
  select * into o from orders where id = p_order_id;
  if not found then return jsonb_build_object('error','not_found'); end if;

  if p_status = 'revoked' then
    update orders set status = 'revoked', mp_ref = p_mp_ref where id = p_order_id;
    return jsonb_build_object('status','revoked');
  end if;

  -- approved (idempotente): se já aprovado com código, devolve 'already'
  if o.status = 'approved' and o.unlock_code is not null then
    return jsonb_build_object('status','approved','already',true,'code',o.unlock_code);
  end if;
  update orders set status = 'approved', mp_ref = p_mp_ref,
    unlock_code = coalesce(unlock_code, upper(substr(encode(gen_random_bytes(6),'hex'),1,8))),
    email = coalesce(p_email, email)
  where id = p_order_id;
  select * into o from orders where id = p_order_id;
  return jsonb_build_object('status','approved','already',false,'code',o.unlock_code,
    'origin',o.origin,'amount_cents',o.amount_cents,'photo_count',array_length(o.photo_ids,1),'email',o.email);
end; $$;
grant execute on function public.settle_order(text,uuid,text,text,text) to anon, authenticated;

-- 3. Limpeza de pendentes abandonados (>24h) — PRIVILEGIADO.
create or replace function public.cleanup_pending_orders(p_secret text)
returns int language plpgsql security definer set search_path = public as $$
declare ws text; n int;
begin
  ws := public._get_secret('worker_secret');
  if ws is null or p_secret <> ws then return -1; end if;
  with d as (delete from orders where status = 'pending' and created_at < now() - interval '24 hours' returning 1)
  select count(*) into n from d;
  return n;
end; $$;
grant execute on function public.cleanup_pending_orders(text) to anon, authenticated;

-- 4. RETENÇÃO automática — PRIVILEGIADO. Apaga dados de galerias expiradas
--    e minimiza PII (e-mails antigos). Roda no cron do Worker.
create or replace function public.retention_cleanup(p_secret text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ws text; a int; b int; c int; d int;
begin
  ws := public._get_secret('worker_secret');
  if ws is null or p_secret <> ws then return jsonb_build_object('error','forbidden'); end if;
  -- índices faciais de galerias expiradas há +30 dias (biometria não fica pra sempre)
  with x as (delete from face_indexes fi using galleries g
    where g.id = fi.gallery_id and g.expires_at is not null and g.expires_at < now() - interval '30 days' returning 1)
  select count(*) into a from x;
  -- pedidos de galerias expiradas há +180 dias
  with x as (delete from orders o using galleries g
    where g.id = o.gallery_id and g.expires_at is not null and g.expires_at < now() - interval '180 days' returning 1)
  select count(*) into b from x;
  -- minimiza PII: apaga e-mail de pedidos com mais de 180 dias
  with x as (update orders set email = null where email is not null and created_at < now() - interval '180 days' returning 1)
  select count(*) into c from x;
  -- seleções de galerias expiradas há +90 dias
  with x as (delete from selections s using galleries g
    where g.id = s.gallery_id and g.expires_at is not null and g.expires_at < now() - interval '90 days' returning 1)
  select count(*) into d from x;
  return jsonb_build_object('face_indexes', a, 'orders', b, 'emails_cleared', c, 'selections', d);
end; $$;
grant execute on function public.retention_cleanup(text) to anon, authenticated;

-- ============================================================
-- Depois de rodar: defina o 'worker_secret' (o assistente faz isso via API,
-- e configura os secrets WORKER_SECRET + SUPABASE_ANON_KEY no Worker,
-- removendo a SUPABASE_SERVICE_KEY do Worker).
-- ============================================================
