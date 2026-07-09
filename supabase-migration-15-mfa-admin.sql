-- ============================================================
-- LRP Gallery — Migração 15: 2FA (TOTP) para o admin
--
-- Hoje o admin é só e-mail (auth.jwt()->>'email') nas policies de RLS —
-- uma senha vazada = acesso total (fotos, vendas, seleções). Esta migração
-- prepara a EXIGÊNCIA de segundo fator SEM risco de te trancar pra fora:
-- só passa a exigir aal2 quando você já tiver um fator TOTP verificado
-- (auth.mfa_factors). Antes de você cadastrar o fator (ver admin.html →
-- Ajustes → "Autenticação em duas etapas"), o comportamento é IDÊNTICO ao
-- de hoje. Depois de cadastrar, toda sessão nova exige o código do app
-- autenticador.
--
-- Rode depois da migração 14. Reversível (substitui só functions/policies).
-- ============================================================
set search_path = public;

-- Verdadeiro se: é o e-mail do admin E (já provou aal2 OU ainda não tem
-- fator MFA verificado cadastrado — evita lockout antes do primeiro setup).
create or replace function public._admin_ok()
returns boolean language sql stable security definer
set search_path = public, auth as $$
  select (auth.jwt() ->> 'email') = 'souleandroribeiro@gmail.com'
     and (
       (auth.jwt() ->> 'aal') = 'aal2'
       or not exists (
         select 1 from auth.mfa_factors
         where user_id = auth.uid() and status = 'verified'
       )
     );
$$;
grant execute on function public._admin_ok() to authenticated;

-- Policies de RLS que hoje checam só o e-mail: passam a exigir aal2 quando
-- houver fator verificado.
alter policy "admin_all_galleries"      on public.galleries      using (public._admin_ok()) with check (public._admin_ok());
alter policy "admin_all_photos"         on public.photos         using (public._admin_ok()) with check (public._admin_ok());
alter policy "admin_all_events"         on public.photo_events   using (public._admin_ok()) with check (public._admin_ok());
alter policy "admin_all_orders"         on public.orders         using (public._admin_ok()) with check (public._admin_ok());
alter policy "admin_all_selections"     on public.selections     using (public._admin_ok()) with check (public._admin_ok());
alter policy "admin_all_face_indexes"   on public.face_indexes   using (public._admin_ok()) with check (public._admin_ok());

-- sign_urls() (migração 14) passa a usar a mesma checagem centralizada.
create or replace function public.sign_urls(p_urls text[])
returns text[] language sql security definer stable
set search_path = public, extensions as $$
  select case when public._admin_ok() then
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
-- Rode no Supabase → SQL Editor DEPOIS da migração 14.
-- Depois de rodar, o próximo passo é seu: abrir admin.html → Ajustes →
-- cadastrar o autenticador (QR code) e guardar os códigos de recuperação
-- que o Supabase mostrar. Só a partir do cadastro concluído a exigência
-- de aal2 passa a valer de fato.
-- ============================================================
