-- ============================================================
-- LRP Gallery — Migração 4: assinar URLs no painel admin
-- Permite que o admin (role authenticated) obtenha URLs assinadas
-- para exibir thumbnails sem depender do worker público antigo.
-- Rode ANTES de deletar o worker lrp-gallery-r2.
-- ============================================================

create or replace function public.sign_urls(p_urls text[])
returns text[] language sql security definer stable
set search_path = public, extensions as $$
  select array(
    select public._sign_r2_url(u)
    from unnest(p_urls) with ordinality as t(u, ord)
    order by ord
  );
$$;

revoke execute on function public.sign_urls(text[]) from public, anon;
grant  execute on function public.sign_urls(text[]) to authenticated;
