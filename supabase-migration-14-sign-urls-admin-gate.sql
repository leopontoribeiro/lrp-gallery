-- ============================================================
-- LRP Gallery — Migração 14: fecha brecha crítica em sign_urls()
--
-- ACHADO (revisão de segurança 2026-07-05): sign_urls() (migração 4) só
-- exige role 'authenticated' — SEM checar o e-mail do admin. As policies de
-- RLS em galleries/photos checam e-mail (migração 5), mas essa RPC não
-- passa pelas tabelas: ela chama _sign_r2_url() diretamente e devolve URL
-- assinada de QUALQUER key para QUALQUER usuário autenticado no projeto
-- Supabase — mesmo alguém que nunca deveria ter acesso (ex.: uma conta
-- Google que completou o OAuth mas não é o admin; a UI barra na tela,
-- mas a sessão/JWT já existe e pode ser usada direto via API).
-- Resultado prático: vazamento de fotos originais sem marca d'água de
-- qualquer galeria, para qualquer pessoa que consiga uma sessão
-- 'authenticated' no projeto.
--
-- FIX: mesma checagem de e-mail usada nas policies de RLS.
-- Rode ANTES ou depois da 12/13, é independente. Reversível.
-- ============================================================
set search_path = public;

create or replace function public.sign_urls(p_urls text[])
returns text[] language sql security definer stable
set search_path = public, extensions as $$
  select case when (auth.jwt() ->> 'email') = 'souleandroribeiro@gmail.com' then
    array(
      select public._sign_r2_url(u)
      from unnest(p_urls) with ordinality as t(u, ord)
      order by ord
    )
  else null end;
$$;

revoke execute on function public.sign_urls(text[]) from public, anon;
grant  execute on function public.sign_urls(text[]) to authenticated;

-- ============================================================
-- Rode este SQL no Supabase → SQL Editor agora — é o achado mais sério
-- desta revisão. Sem custo de downtime, não precisa mexer no Worker.
-- ============================================================
