-- ============================================================
-- LRP Gallery — Migração 22: fecha tabelas sem RLS (alerta do Supabase)
--
-- 9 tabelas foram criadas em migrações antigas sem "enable row level
-- security" — ficaram sem RLS desde a criação. Testei com a ANON KEY
-- (a mesma que fica pública no navegador): biometric_deletion_logs,
-- rights_exercise_requests, admin_action_logs, consent_audit_logs,
-- download_history e email_templates estavam de fato legíveis por
-- QUALQUER UM sem login (HTTP 200). app_secrets/photo_events/client_errors
-- não tinham GRANT pro anon (por isso HTTP 401/403 já bloqueava), mas
-- ficam sem essa segunda camada — fechando aqui como defesa em profundidade.
--
-- Confirmado que nenhuma dessas tabelas é escrita direto pelo visitante
-- anônimo da galeria: os fluxos públicos (curtir, ver, baixar) passam por
-- RPCs (log_photo_event, log_error) que rodam como security definer e
-- continuam funcionando normalmente — só o acesso DIRETO à tabela é fechado.
--
-- Rode agora no SQL Editor. Reversível (só habilita RLS + policy admin).
-- ============================================================
set search_path = public;

do $$
declare t text;
begin
  foreach t in array array[
    'app_secrets', 'biometric_deletion_logs', 'rights_exercise_requests',
    'consent_audit_logs', 'email_templates', 'admin_action_logs',
    'download_history', 'photo_events', 'client_errors'
  ] loop
    if to_regclass('public.' || t) is not null then
      execute format('alter table public.%I enable row level security', t);
      execute format('drop policy if exists admin_all_%I on public.%I', t, t);
      execute format(
        'create policy admin_all_%I on public.%I for all to authenticated using (public._admin_ok()) with check (public._admin_ok())',
        t, t
      );
    end if;
  end loop;
end $$;

-- Reverter uma tabela específica: alter table public.<nome> disable row level security;
