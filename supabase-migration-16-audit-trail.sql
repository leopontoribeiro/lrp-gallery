-- ============================================================
-- LRP Gallery — Migração 16: trilha de auditoria do admin
-- Hoje não existe registro de "quem mudou o quê" no painel — se a conta
-- for compartilhada ou comprometida temporariamente, não há como saber o
-- que foi feito. Esta migração cria uma tabela simples de log, protegida
-- pela mesma checagem de admin (_admin_ok, migração 15), e passa a
-- registrar revogação de pedido (estorno/chargeback) direto no settle_order.
-- Rode depois da migração 15. Reversível (só cria tabela/policy e
-- substitui a function settle_order).
-- ============================================================
set search_path = public;

create table if not exists public.admin_actions (
  id bigint generated always as identity primary key,
  action text not null,
  detail jsonb,
  created_at timestamptz default now()
);
create index if not exists idx_admin_actions_created on public.admin_actions(created_at desc);

alter table public.admin_actions enable row level security;
drop policy if exists "admin_all_actions" on public.admin_actions;
create policy "admin_all_actions" on public.admin_actions for all to authenticated
  using (public._admin_ok()) with check (public._admin_ok());

-- settle_order (migração 13) passa a registrar toda revogação (estorno/
-- chargeback/cancelamento) na trilha — é o único fluxo que muda dinheiro
-- sem sessão de admin (webhook do Mercado Pago).
create or replace function public.settle_order(p_secret text, p_order_id uuid, p_status text, p_mp_ref text, p_email text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare ws text; o record;
begin
  ws := public._get_secret('worker_secret');
  if ws is null or p_secret is null or p_secret <> ws then return jsonb_build_object('error','forbidden'); end if;
  if p_status not in ('approved','revoked') then return jsonb_build_object('error','bad_status'); end if;

  select * into o from orders where id = p_order_id for update;
  if not found then return jsonb_build_object('error','not_found'); end if;

  if p_status = 'revoked' then
    update orders set status = 'revoked', mp_ref = p_mp_ref where id = p_order_id;
    insert into public.admin_actions(action, detail) values ('order_revoked',
      jsonb_build_object('order_id', p_order_id, 'mp_ref', p_mp_ref, 'gallery_id', o.gallery_id, 'amount_cents', o.amount_cents));
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

-- ============================================================
-- Rode no Supabase → SQL Editor depois da migração 15.
-- ============================================================
