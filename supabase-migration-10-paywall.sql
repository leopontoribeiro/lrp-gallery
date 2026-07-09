-- ============================================================
-- LRP Gallery — Migração 10: paywall por foto (Mercado Pago)
-- Álbum com marca d'água + preço por foto. Cliente compra as favoritas;
-- só quem pagou recebe o ORIGINAL LIMPO (URL assinada sem marca).
-- Rode depois das migrações 3, 7 e 8. Reversível.
-- ============================================================
set search_path = public;

create extension if not exists pgcrypto;

-- Preço por foto (em centavos). 0 = sem paywall.
alter table public.galleries add column if not exists price_cents int default 0;

-- get_public_gallery passa a informar price_cents (muda o tipo de retorno -> drop)
drop function if exists public.get_public_gallery(text, text);
create or replace function public.get_public_gallery(p_token text default null, p_slug text default null)
returns table (
  id uuid, name text, slug text, status text,
  cover_photo_id uuid, cover_position_x float8, cover_position_y float8,
  expires_at timestamptz, download_enabled boolean, has_password boolean,
  watermark boolean, price_cents int
) language sql security definer stable set search_path = public as $$
  select g.id, g.name, g.slug, g.status, g.cover_photo_id,
         g.cover_position_x, g.cover_position_y, g.expires_at, g.download_enabled,
         (g.password_hash is not null), coalesce(g.watermark,false), coalesce(g.price_cents,0)
  from galleries g
  where g.status = 'live'
    and ((p_token is not null and g.access_token = p_token)
      or (p_token is null and p_slug is not null and g.slug = p_slug)
      or (p_token is null and p_slug is null))
  order by g.created_at desc limit 1;
$$;
grant execute on function public.get_public_gallery(text, text) to anon, authenticated;

-- Pedidos. Um pedido = fotos compradas por um visitante.
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  gallery_id uuid references public.galleries(id) on delete cascade,
  visitor_id text,
  photo_ids uuid[] not null,
  amount_cents int not null,
  status text default 'pending',      -- pending | approved
  mp_ref text,
  created_at timestamptz default now()
);
create index if not exists idx_orders_gallery_visitor on public.orders(gallery_id, visitor_id, status);
alter table public.orders enable row level security;
drop policy if exists "admin_all_orders" on public.orders;
create policy "admin_all_orders" on public.orders for all to authenticated
  using ((auth.jwt() ->> 'email') = 'souleandroribeiro@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'souleandroribeiro@gmail.com');
revoke all on public.orders from anon;   -- criado/atualizado só pelo Worker (service key)

-- Fotos JÁ COMPRADAS por um visitante -> URL LIMPA assinada (sem marca).
create or replace function public.get_purchased_photos(p_token text, p_visitor text)
returns table (id uuid, filename text, full_url text)
language sql security definer stable set search_path = public, extensions as $$
  select p.id, p.filename, public._sign_r2_url(p.full_url, false)
  from photos p join galleries g on g.id = p.gallery_id
  where g.access_token = p_token and g.status = 'live'
    and exists (
      select 1 from orders o
      where o.gallery_id = g.id and o.visitor_id = p_visitor and o.status = 'approved'
        and p.id = any(o.photo_ids)
    );
$$;
grant execute on function public.get_purchased_photos(text, text) to anon, authenticated;

-- Manifesto de ZIP das fotos compradas (originais limpos), ignora download_enabled.
create or replace function public.get_paid_zip_manifest(p_token text, p_visitor text)
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
      and exists (select 1 from orders o where o.gallery_id=gid and o.visitor_id=p_visitor
                    and o.status='approved' and p.id = any(o.photo_ids))
    order by p.position asc limit 2000
  ) s;
  if keys is null then return jsonb_build_object('error','no_photos'); end if;
  exp := (floor(extract(epoch from now())/win)::bigint + 2)*win;
  secret := public._get_secret('r2_signing_secret');
  if secret is null then sig := '';
  else sig := encode(hmac(array_to_string(keys,E'\n')||':'||exp::text, secret, 'sha256'),'hex'); end if;
  return jsonb_build_object('keys',keys,'names',names,'exp',exp,'sig',sig);
end; $$;
grant execute on function public.get_paid_zip_manifest(text, text) to anon, authenticated;

-- ============================================================
-- Reverter: drop as 4 funções/coluna/tabela acima.
-- Setup Mercado Pago (Worker secrets): MP_ACCESS_TOKEN, SUPABASE_SERVICE_KEY,
-- SUPABASE_URL. Defina o preço por foto em cada galeria (admin).
-- ============================================================
