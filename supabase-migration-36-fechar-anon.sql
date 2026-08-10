-- ============================================================
-- LRP Gallery — Migração 36: fechar o que o papel 'anon' alcança
--
-- ACHADO (verificado no banco de produção): o papel 'anon' tem
--   DELETE, INSERT, SELECT, TRUNCATE, UPDATE, TRIGGER, REFERENCES
-- em praticamente todas as tabelas do schema public — inclusive
-- clients, consent_records, download_history, admin_action_logs,
-- gallery_videos e email_templates.
--
-- HOJE NÃO ESTÁ VAZANDO: o RLS está ligado nessas tabelas e as consultas
-- anônimas voltam vazias. Ou seja, a única coisa entre o público e esses
-- dados é a política de RLS. Uma policy nova mal escrita, ou um
-- `alter table ... disable row level security` num debug, abre tudo na
-- hora — sem aviso.
--
-- galleries, photos e orders JÁ estão corretos (a migração 2 revogou; o
-- anon recebe 401 neles). Esta migração aplica a mesma regra ao resto.
--
-- DUAS VIEWS ESTÃO SEM PROTEÇÃO NENHUMA (RLS não se aplica a view):
--   - client_events_with_links   (hoje devolve [] só porque as tabelas
--                                 base estão vazias — quando você começar
--                                 a usar clientes/eventos, vira lista
--                                 pública de clientes)
--   - biometric_deletion_status  (devolve contagens agregadas de biometria)
--
-- PRINCÍPIO: o navegador do cliente não precisa de acesso a tabela nenhuma.
-- Ele só chama funções `security definer`, que decidem o que devolver.
-- ============================================================
set search_path = public;

-- ── 1. Tirar o anon de todas as tabelas do schema public ────
do $$
declare r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
  loop
    execute format('revoke all on public.%I from anon', r.relname);
  end loop;
end $$;

-- Impede que tabela NOVA já nasça aberta para o anon.
alter default privileges in schema public revoke all on tables from anon;

-- ── 2. As duas views que não têm RLS ────────────────────────
-- security_invoker faz a view rodar com as permissões de QUEM CHAMA, então
-- o RLS das tabelas base passa a valer também através dela.
do $$
begin
  if exists (select 1 from pg_views where schemaname='public' and viewname='client_events_with_links') then
    execute 'alter view public.client_events_with_links set (security_invoker = true)';
  end if;
  if exists (select 1 from pg_views where schemaname='public' and viewname='biometric_deletion_status') then
    execute 'alter view public.biometric_deletion_status set (security_invoker = true)';
  end if;
end $$;

-- ── 3. Conferência (rode depois; o esperado é ZERO linhas) ──
-- select table_name, privilege_type
-- from information_schema.role_table_grants
-- where grantee = 'anon' and table_schema = 'public';
--
-- E o teste que importa, do lado de fora (deve dar 401 em tudo):
--   curl -s -o /dev/null -w '%{http_code}\n' \
--     -H "apikey: <ANON_KEY>" \
--     "https://vtblxwaxwuztehtxkygp.supabase.co/rest/v1/clients?select=*&limit=1"

-- ============================================================
-- ROLLBACK, se algo do site parar de funcionar:
--   grant select on public.<tabela> to anon;
-- Mas antes verifique se não é o caso de criar/usar uma RPC —
-- acesso direto a tabela pelo navegador é a exceção, não a regra.
-- ============================================================
