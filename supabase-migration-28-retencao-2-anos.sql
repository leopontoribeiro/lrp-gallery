-- ============================================================
-- LRP Gallery — Migração 28: retenção padrão de 2 anos
-- Antes eram 90 dias (migração 17). Vale pros álbuns novos (default da
-- coluna) e também reajusta os que já existem, contando 2 anos a partir
-- da data de criação de cada um.
-- ============================================================
set search_path = public;

alter table public.galleries
  alter column expires_at set default (now() + interval '2 years');

-- Álbuns existentes: 2 anos contados da criação.
-- (não mexe em apagados; a compra de armazenamento da migração 25 continua
--  somando meses por cima disso normalmente)
update public.galleries
   set expires_at = created_at + interval '2 years'
 where deleted_at is null;

-- Reverter: alter column expires_at set default (now() + interval '90 days');
-- e recalcular os expires_at que quiser de volta pra created_at + 90 days.
