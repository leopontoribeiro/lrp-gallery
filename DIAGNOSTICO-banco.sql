-- ============================================================
-- LRP Gallery — Diagnóstico do banco (só leitura, seguro rodar a qualquer hora)
-- Cole no SQL Editor do Supabase. Cada bloco responde uma pergunta.
-- ============================================================

-- 1. FUNÇÕES DUPLICADAS (sobrecargas)
-- Quando a mesma função existe com assinaturas diferentes, o PostgREST pode
-- responder "Could not choose the best candidate function" e a chamada falha.
-- Já aconteceu com get_public_gallery. Tudo que aparecer aqui com qtd > 1
-- precisa de decisão: manter só a assinatura em uso e dropar as outras.
select p.proname as funcao,
       count(*) as qtd,
       string_agg(pg_get_function_identity_arguments(p.oid), '  |  ') as assinaturas
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
group by p.proname
having count(*) > 1
order by qtd desc, funcao;

-- 2. TABELAS SEM RLS
-- Qualquer tabela sem row level security fica acessível conforme os grants.
-- Se 'anon' tiver select nela, é dado público.
select c.relname as tabela, c.relrowsecurity as rls_ligado
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relrowsecurity, c.relname;

-- 3. O QUE O PAPEL 'anon' ENXERGA DIRETO
-- O ideal é que anon não tenha NADA em tabela — só execute de funções
-- security definer. Cada linha aqui é uma porta lateral.
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public'
order by table_name, privilege_type;

-- 4. O HASH DA SENHA ESTÁ EXPOSTO?
-- Se anon puder ler galleries.password_hash, a migração 34 é anulada.
select grantee, privilege_type
from information_schema.column_privileges
where table_schema = 'public' and table_name = 'galleries'
  and column_name = 'password_hash';

-- 5. FUNÇÕES SECURITY DEFINER SEM search_path FIXO
-- Sem 'set search_path', dá pra sequestrar a resolução de nomes.
select p.proname, pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and (p.proconfig is null or not exists (
        select 1 from unnest(p.proconfig) cfg where cfg like 'search_path=%'))
order by p.proname;

-- 6. VOLUME (pra dimensionar backup e retenção)
select
  (select count(*) from galleries) as galerias,
  (select count(*) from galleries where status = 'live') as galerias_live,
  (select count(*) from photos)    as fotos,
  (select count(*) from orders where status = 'approved') as pedidos_pagos;
