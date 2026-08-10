-- ============================================================
-- LRP Gallery — Migração 29: galeria permanente (R$127, pagamento único)
--
-- Substitui a venda de "extensão por meses" por um produto único:
--   GALERIA PERMANENTE — R$ 127,00, uma vez, o link nunca expira.
-- Prazo padrão dos álbuns passa a ser 1 ANO (era 90 dias / 2 anos).
-- A compra de quota de vídeo (R$30/GB) continua igual.
--
-- Permanente = expires_at NULL. Isso já é entendido como "não expira" por
-- get_public_gallery, get_public_photos e retention_cleanup (todos checam
-- `expires_at is not null` antes de expirar/limpar) — por isso esta migração
-- NÃO precisa mexer nessas funções.
-- Rode depois da migração 27.
-- ============================================================
set search_path = public;

alter table public.galleries add column if not exists is_permanent boolean not null default false;
alter table public.orders    add column if not exists permanent    boolean not null default false;

-- Prazo padrão: 1 ano.
alter table public.galleries
  alter column expires_at set default (now() + interval '1 year');

-- Álbuns existentes: 1 ano contado da criação (não mexe nos permanentes).
update public.galleries
   set expires_at = created_at + interval '1 year'
 where deleted_at is null and is_permanent = false;

-- ── Pedido: permanente e/ou quota de vídeo ──
-- Assinatura mudou (p_extend_months int -> p_permanent boolean), então dropa a antiga.
drop function if exists public.create_storage_order(text,text,int,int,text);

create or replace function public.create_storage_order(
  p_token text, p_visitor text, p_permanent boolean, p_quota_mb int, p_origin text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare gid uuid; gname text; perm boolean; amount int; oid uuid;
begin
  select id, name, is_permanent into gid, gname, perm
    from galleries where access_token = p_token and status = 'live' and deleted_at is null;
  if gid is null then return jsonb_build_object('error','not_found'); end if;

  -- Já é permanente: não deixa comprar de novo.
  if coalesce(p_permanent,false) and coalesce(perm,false) then
    return jsonb_build_object('error','already_permanent');
  end if;
  if not coalesce(p_permanent,false) and coalesce(p_quota_mb,0) <= 0 then
    return jsonb_build_object('error','bad_request');
  end if;

  -- R$127,00 pela galeria permanente + R$30,00 por GB de vídeo.
  amount := (case when coalesce(p_permanent,false) then 12700 else 0 end)
          + round(coalesce(p_quota_mb,0) / 1024.0 * 3000)::int;
  if amount <= 0 then return jsonb_build_object('error','bad_request'); end if;

  insert into orders(gallery_id, visitor_id, photo_ids, amount_cents, status, origin,
                     product_type, permanent, quota_mb)
  values (gid, p_visitor, '{}'::uuid[], amount, 'pending', p_origin,
          'storage', coalesce(p_permanent,false), p_quota_mb)
  returning id into oid;

  return jsonb_build_object('order_id', oid, 'amount_cents', amount, 'gallery_name', gname,
    'permanent', coalesce(p_permanent,false), 'quota_mb', p_quota_mb);
end; $$;
grant execute on function public.create_storage_order(text,text,boolean,int,text) to anon, authenticated;

-- ── Liquidação: permanente zera o expires_at (nunca mais expira) ──
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
      is_permanent = is_permanent or coalesce(o.permanent, false),
      -- permanente => expires_at NULL (não expira nunca mais)
      expires_at = case when coalesce(o.permanent,false) then null else expires_at end,
      video_quota_mb = video_quota_mb + coalesce(o.quota_mb, 0)
    where id = o.gallery_id;
    return jsonb_build_object('status','approved','already',false,'product_type','storage',
      'permanent',o.permanent,'quota_mb',o.quota_mb,'amount_cents',o.amount_cents,'origin',o.origin,'email',o.email);
  end if;

  update orders set status = 'approved', mp_ref = p_mp_ref,
    unlock_code = coalesce(unlock_code, upper(substr(encode(gen_random_bytes(6),'hex'),1,8))),
    email = coalesce(p_email, email)
  where id = p_order_id;
  select * into o from orders where id = p_order_id;
  return jsonb_build_object('status','approved','already',false,'code',o.unlock_code,
    'origin',o.origin,'amount_cents',o.amount_cents,'photo_count',array_length(o.photo_ids,1),'email',o.email);
end; $$;

-- ── Status do pedido (cliente confere ao voltar do Mercado Pago) ──
create or replace function public.get_storage_order_status(p_token text, p_order_id uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare o record;
begin
  select o2.status, o2.permanent, o2.quota_mb into o
  from orders o2 join galleries g on g.id = o2.gallery_id
  where o2.id = p_order_id and g.access_token = p_token and o2.product_type = 'storage';
  if not found then return jsonb_build_object('error','not_found'); end if;
  return jsonb_build_object('status', o.status, 'permanent', o.permanent, 'quota_mb', o.quota_mb);
end; $$;
grant execute on function public.get_storage_order_status(text,uuid) to anon, authenticated;

-- Reverter: dropar create_storage_order(text,text,boolean,int,text), recriar a
-- versão da migração 25, e voltar o default de expires_at pro prazo anterior.
