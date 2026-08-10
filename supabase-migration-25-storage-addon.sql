-- ============================================================
-- LRP Gallery — Migração 25: cliente compra armazenamento
-- (estender prazo de guarda + quota de vídeo pro próprio cliente subir)
-- Pagamento único por período, reaproveitando o Mercado Pago já integrado.
-- Rode depois da migração 24.
-- ============================================================
set search_path = public;

alter table public.galleries add column if not exists video_quota_mb integer not null default 0;
alter table public.orders add column if not exists product_type text not null default 'photos';
alter table public.orders add column if not exists extend_months int;
alter table public.orders add column if not exists quota_mb int;
alter table public.gallery_videos add column if not exists uploaded_by_client boolean not null default false;

-- 1. Cria o pedido (o Worker chama isso a partir de /checkout-storage).
create or replace function public.create_storage_order(p_token text, p_visitor text, p_extend_months int, p_quota_mb int, p_origin text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare gid uuid; gname text; amount int; oid uuid;
begin
  select id, name into gid, gname from galleries where access_token = p_token and status = 'live' and deleted_at is null;
  if gid is null then return jsonb_build_object('error','not_found'); end if;
  if coalesce(p_extend_months,0) <= 0 and coalesce(p_quota_mb,0) <= 0 then return jsonb_build_object('error','bad_request'); end if;

  -- Preço de exemplo — ajuste aqui: R$15/mês estendido, R$30/GB de vídeo extra.
  amount := coalesce(p_extend_months,0) * 1500 + round(coalesce(p_quota_mb,0) / 1024.0 * 3000)::int;
  if amount <= 0 then return jsonb_build_object('error','bad_request'); end if;

  insert into orders(gallery_id, visitor_id, photo_ids, amount_cents, status, origin, product_type, extend_months, quota_mb)
  values (gid, p_visitor, '{}'::uuid[], amount, 'pending', p_origin, 'storage', p_extend_months, p_quota_mb)
  returning id into oid;
  return jsonb_build_object('order_id', oid, 'amount_cents', amount, 'gallery_name', gname,
    'extend_months', p_extend_months, 'quota_mb', p_quota_mb);
end; $$;
grant execute on function public.create_storage_order(text,text,int,int,text) to anon, authenticated;

-- 2. settle_order: agora trata os dois produtos (fotos = original; storage = novo).
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

  if o.status = 'approved' and o.product_type = 'storage' then
    return jsonb_build_object('status','approved','already',true,'product_type','storage');
  end if;
  if o.status = 'approved' and o.product_type <> 'storage' and o.unlock_code is not null then
    return jsonb_build_object('status','approved','already',true,'code',o.unlock_code);
  end if;

  if o.product_type = 'storage' then
    update orders set status = 'approved', mp_ref = p_mp_ref, email = coalesce(p_email, email) where id = p_order_id;
    update galleries set
      expires_at = case when coalesce(o.extend_months,0) > 0
        then greatest(coalesce(expires_at, now()), now()) + (o.extend_months || ' months')::interval
        else expires_at end,
      video_quota_mb = video_quota_mb + coalesce(o.quota_mb, 0)
    where id = o.gallery_id;
    return jsonb_build_object('status','approved','already',false,'product_type','storage',
      'extend_months',o.extend_months,'quota_mb',o.quota_mb,'amount_cents',o.amount_cents,'origin',o.origin,'email',o.email);
  end if;

  update orders set status = 'approved', mp_ref = p_mp_ref,
    unlock_code = coalesce(unlock_code, upper(substr(encode(gen_random_bytes(6),'hex'),1,8))),
    email = coalesce(p_email, email)
  where id = p_order_id;
  select * into o from orders where id = p_order_id;
  return jsonb_build_object('status','approved','already',false,'code',o.unlock_code,
    'origin',o.origin,'amount_cents',o.amount_cents,'photo_count',array_length(o.photo_ids,1),'email',o.email);
end; $$;

-- 3. Quota restante (pra mostrar na tela do cliente).
create or replace function public.get_video_quota(p_token text)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare gid uuid; quota_mb int; used bigint;
begin
  select id, video_quota_mb into gid, quota_mb from galleries where access_token = p_token and status = 'live' and deleted_at is null;
  if gid is null then return jsonb_build_object('error','not_found'); end if;
  select coalesce(sum(size_bytes),0) into used from gallery_videos where gallery_id = gid and uploaded_by_client = true;
  return jsonb_build_object('quota_mb', quota_mb, 'used_bytes', used, 'remaining_bytes', greatest(0, quota_mb::bigint*1024*1024 - used));
end; $$;
grant execute on function public.get_video_quota(text) to anon, authenticated;

-- 4. Assinatura de upload PRO CLIENTE (escopada: só na própria galeria, só se sobrar quota).
create or replace function public.get_client_upload_sig(p_token text, p_key text, p_size_bytes bigint)
returns jsonb language plpgsql security definer stable set search_path = public, extensions as $$
declare gid uuid; quota_mb int; used bigint; secret text; win int := 300; exp bigint; sig text;
begin
  select id, video_quota_mb into gid, quota_mb from galleries where access_token = p_token and status = 'live' and deleted_at is null;
  if gid is null then return jsonb_build_object('error','not_found'); end if;
  if p_key !~ ('^galleries/' || gid::text || '/client_video_[a-zA-Z0-9._-]+$') then return jsonb_build_object('error','bad_key'); end if;

  select coalesce(sum(size_bytes),0) into used from gallery_videos where gallery_id = gid and uploaded_by_client = true;
  if used + coalesce(p_size_bytes,0) > quota_mb::bigint*1024*1024 then return jsonb_build_object('error','quota_exceeded'); end if;

  exp := extract(epoch from now())::bigint + win;
  secret := public._get_secret('r2_signing_secret');
  if secret is null then return jsonb_build_object('error','no_secret'); end if;
  sig := encode(hmac(p_key || ':' || exp::text, secret, 'sha256'), 'hex');
  return jsonb_build_object('key', p_key, 'exp', exp, 'sig', sig);
end; $$;
grant execute on function public.get_client_upload_sig(text,text,bigint) to anon, authenticated;

-- 5. Registra o vídeo depois do upload (INSERT direto é bloqueado pra anon por RLS).
create or replace function public.add_client_video(p_token text, p_key text, p_thumb_key text, p_name text, p_size_bytes bigint, p_duration numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare gid uuid; quota_mb int; used bigint; base text; vid uuid; pos int;
begin
  select id, video_quota_mb into gid, quota_mb from galleries where access_token = p_token and status = 'live' and deleted_at is null;
  if gid is null then return jsonb_build_object('error','not_found'); end if;
  if p_key !~ ('^galleries/' || gid::text || '/client_video_[a-zA-Z0-9._-]+$') then return jsonb_build_object('error','bad_key'); end if;

  select coalesce(sum(size_bytes),0) into used from gallery_videos where gallery_id = gid and uploaded_by_client = true;
  if used + coalesce(p_size_bytes,0) > quota_mb::bigint*1024*1024 then return jsonb_build_object('error','quota_exceeded'); end if;

  base := public._get_secret('r2_signed_base');
  select coalesce(max(position),-1)+1 into pos from gallery_videos where gallery_id = gid;
  insert into gallery_videos (gallery_id, name, video_url, thumb_url, filename, size_bytes, duration_seconds, position, uploaded_by_client)
  values (gid, coalesce(nullif(trim(p_name),''),'Vídeo do cliente'), base || '/' || p_key,
          case when p_thumb_key is not null then base || '/' || p_thumb_key else null end,
          p_name, p_size_bytes, p_duration, pos, true)
  returning id into vid;
  return jsonb_build_object('id', vid);
end; $$;
grant execute on function public.add_client_video(text,text,text,text,bigint,numeric) to anon, authenticated;

-- 6. Status do pedido de armazenamento (pro cliente conferir depois de voltar do MP).
create or replace function public.get_storage_order_status(p_token text, p_order_id uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare o record;
begin
  select o2.status, o2.extend_months, o2.quota_mb into o
  from orders o2 join galleries g on g.id = o2.gallery_id
  where o2.id = p_order_id and g.access_token = p_token and o2.product_type = 'storage';
  if not found then return jsonb_build_object('error','not_found'); end if;
  return jsonb_build_object('status', o.status, 'extend_months', o.extend_months, 'quota_mb', o.quota_mb);
end; $$;
grant execute on function public.get_storage_order_status(text,uuid) to anon, authenticated;

-- Reverter: derrubar as 5 functions novas + as colunas adicionadas (video_quota_mb,
-- product_type/extend_months/quota_mb em orders, uploaded_by_client em gallery_videos).
