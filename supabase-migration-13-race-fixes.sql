-- ============================================================
-- LRP Gallery — Migração 13: corrige 2 condições de corrida no paywall
-- 1) settle_order: trava a linha (FOR UPDATE) antes de checar/gravar status,
--    evitando aprovação dupla quando o Mercado Pago reenvia o webhook em
--    paralelo (acontece com frequência em caso de latência/timeout).
-- 2) create_paid_order: se já existe um pedido 'pending' idêntico (mesmo
--    visitante+galeria+fotos) criado nos últimos 10 minutos, devolve ele em
--    vez de criar outro — evita duplo-clique gerando duas cobranças.
-- Rode depois da migração 12. Reversível (substitui só as functions).
-- ============================================================
set search_path = public;

create or replace function public.settle_order(p_secret text, p_order_id uuid, p_status text, p_mp_ref text, p_email text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare ws text; o record;
begin
  ws := public._get_secret('worker_secret');
  if ws is null or p_secret is null or p_secret <> ws then return jsonb_build_object('error','forbidden'); end if;
  if p_status not in ('approved','revoked') then return jsonb_build_object('error','bad_status'); end if;

  -- FOR UPDATE: trava a linha até o fim da transação. Uma 2ª chamada concorrente
  -- (reentrega de webhook) espera aqui e só enxerga o estado já atualizado.
  select * into o from orders where id = p_order_id for update;
  if not found then return jsonb_build_object('error','not_found'); end if;

  if p_status = 'revoked' then
    update orders set status = 'revoked', mp_ref = p_mp_ref where id = p_order_id;
    return jsonb_build_object('status','revoked');
  end if;

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

create or replace function public.create_paid_order(p_token text, p_visitor text, p_photo_ids uuid[], p_origin text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare gid uuid; price int; gname text; valid uuid[]; amount int; oid uuid; existing record;
begin
  select id, coalesce(price_cents,0), name into gid, price, gname
  from galleries where access_token = p_token and status = 'live' and coalesce(watermark,false) = true;
  if gid is null or price <= 0 then return jsonb_build_object('error','no_paywall'); end if;
  select array_agg(id order by id) into valid from photos where gallery_id = gid and id = any(p_photo_ids);
  if valid is null then return jsonb_build_object('error','no_photos'); end if;

  -- Duplo-clique / reenvio: pedido pendente idêntico recém-criado -> devolve o mesmo.
  select id, amount_cents into existing from orders
    where gallery_id = gid and visitor_id = p_visitor and status = 'pending'
      and created_at > now() - interval '10 minutes'
      and photo_ids = (select array_agg(x order by x) from unnest(valid) x)
    order by created_at desc limit 1;
  if found then
    return jsonb_build_object('order_id', existing.id, 'amount_cents', existing.amount_cents, 'gallery_name', gname, 'count', array_length(valid,1));
  end if;

  amount := price * array_length(valid,1);
  insert into orders(gallery_id, visitor_id, photo_ids, amount_cents, status, origin)
  values (gid, p_visitor, valid, amount, 'pending', p_origin) returning id into oid;
  return jsonb_build_object('order_id', oid, 'amount_cents', amount, 'gallery_name', gname, 'count', array_length(valid,1));
end; $$;
grant execute on function public.create_paid_order(text,text,uuid[],text) to anon, authenticated;

-- ============================================================
-- Rode este SQL no Supabase → SQL Editor. Não precisa mexer em secrets nem
-- no Worker para esta parte.
-- ============================================================
