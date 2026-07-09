-- ============================================================
-- LRP Gallery — Migração 11: código de desbloqueio (compra vale em qualquer aparelho)
-- Após pagar, o cliente recebe um código por e-mail (via Mercado Pago/Resend).
-- Com o código, desbloqueia os originais em outro aparelho/navegador.
-- Rode depois da migração 10. Reversível.
-- ============================================================
set search_path = public;

alter table public.orders add column if not exists unlock_code text;
alter table public.orders add column if not exists email text;
alter table public.orders add column if not exists origin text;

-- Fotos compradas: casa por visitante OU por código de desbloqueio conhecido.
drop function if exists public.get_purchased_photos(text, text);
create or replace function public.get_purchased_photos(p_token text, p_visitor text, p_codes text[] default null)
returns table (id uuid, filename text, full_url text)
language sql security definer stable set search_path = public, extensions as $$
  select p.id, p.filename, public._sign_r2_url(p.full_url, false)
  from photos p join galleries g on g.id = p.gallery_id
  where g.access_token = p_token and g.status = 'live'
    and exists (
      select 1 from orders o
      where o.gallery_id = g.id and o.status = 'approved' and p.id = any(o.photo_ids)
        and (o.visitor_id = p_visitor or (p_codes is not null and o.unlock_code = any(p_codes)))
    );
$$;
grant execute on function public.get_purchased_photos(text, text, text[]) to anon, authenticated;

-- ZIP das compradas (mesma regra: visitante OU código).
create or replace function public.get_paid_zip_manifest(p_token text, p_visitor text, p_codes text[] default null)
returns jsonb language plpgsql security definer stable
set search_path = public, extensions as $$
declare gid uuid; secret text; keys text[]; names text[]; win int := 21600; exp bigint; sig text;
begin
  select id into gid from galleries where access_token = p_token and status = 'live';
  if gid is null then return jsonb_build_object('error','not_found'); end if;
  select array_agg(k order by ord), array_agg(nm order by ord) into keys, names
  from (
    select split_part(regexp_replace(p.full_url,'^https?://[^/]+/',''),'?',1) as k,
           coalesce(nullif(p.filename,''),'foto-'||p.position::text||'.jpg') as nm, p.position as ord
    from photos p
    where p.gallery_id = gid
      and split_part(regexp_replace(p.full_url,'^https?://[^/]+/',''),'?',1) like 'galleries/%'
      and exists (select 1 from orders o where o.gallery_id=gid and o.status='approved' and p.id = any(o.photo_ids)
                    and (o.visitor_id = p_visitor or (p_codes is not null and o.unlock_code = any(p_codes))))
    order by p.position asc limit 2000
  ) s;
  if keys is null then return jsonb_build_object('error','no_photos'); end if;
  exp := (floor(extract(epoch from now())/win)::bigint + 2)*win;
  secret := public._get_secret('r2_signing_secret');
  if secret is null then sig := '';
  else sig := encode(hmac(array_to_string(keys,E'\n')||':'||exp::text, secret, 'sha256'),'hex'); end if;
  return jsonb_build_object('keys',keys,'names',names,'exp',exp,'sig',sig);
end; $$;
grant execute on function public.get_paid_zip_manifest(text, text, text[]) to anon, authenticated;

-- Status + código de um pedido (para a tela de retorno mostrar o código).
create or replace function public.get_order_code(p_token text, p_order_id uuid)
returns jsonb language sql security definer stable set search_path = public as $$
  select jsonb_build_object('status', o.status,
           'code', case when o.status = 'approved' then o.unlock_code else null end)
  from orders o join galleries g on g.id = o.gallery_id
  where g.access_token = p_token and o.id = p_order_id;
$$;
grant execute on function public.get_order_code(text, uuid) to anon, authenticated;

-- ============================================================
-- E-mail (opcional): Worker secrets RESEND_API_KEY e RESEND_FROM
-- (ex.: 'LRP Gallery <no-reply@seudominio.com>'). Sem eles, o código
-- ainda aparece pro cliente na tela de retorno após o pagamento.
-- ============================================================
