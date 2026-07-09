-- ============================================================
-- LGPD CONSENT TABLES & INFRASTRUCTURE
-- Execute isto ANTES de supabase-migration-auto-delete-biometric.sql
-- ============================================================

-- 1. Tabela principal de consentimentos
create table if not exists public.consent_records (
  id uuid primary key default uuid_generate_v4(),
  user_id text not null,
  consent_data jsonb not null default '{}'::jsonb,
  accepted boolean default false,
  reason text,
  deleted_at timestamp,
  created_at timestamp default now(),
  updated_at timestamp default now()
);

-- 2. Índices para performance
create index if not exists idx_consent_records_user_id on consent_records(user_id);
create index if not exists idx_consent_records_accepted on consent_records(accepted);
create index if not exists idx_consent_records_created_at on consent_records(created_at);

-- 3. Tabela para requisições de exercício de direitos LGPD
create table if not exists public.rights_exercise_requests (
  id uuid primary key default uuid_generate_v4(),
  user_id text not null,
  request_type text not null,
  status text default 'pending',
  request_data jsonb default '{}'::jsonb,
  response_data jsonb,
  deadline_at timestamp,
  completed_at timestamp,
  created_at timestamp default now(),
  updated_at timestamp default now()
);

-- 4. Índices para rights_exercise_requests
create index if not exists idx_rights_user_id on rights_exercise_requests(user_id);
create index if not exists idx_rights_status on rights_exercise_requests(status);
create index if not exists idx_rights_deadline on rights_exercise_requests(deadline_at);

-- 5. Tabela de audit trail para consentimentos
create table if not exists public.consent_audit_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id text not null,
  action text not null,
  details jsonb default '{}'::jsonb,
  ip_address text,
  user_agent text,
  created_at timestamp default now()
);

-- 6. Índice para audit logs
create index if not exists idx_consent_audit_user on consent_audit_logs(user_id);
create index if not exists idx_consent_audit_created on consent_audit_logs(created_at);

-- 7. Tabela para armazenar templates de email LGPD
create table if not exists public.email_templates (
  id uuid primary key default uuid_generate_v4(),
  template_key text unique not null,
  subject text not null,
  body_html text not null,
  variables jsonb default '{}'::jsonb,
  created_at timestamp default now()
);

-- 8. Inserir templates padrão
insert into email_templates (template_key, subject, body_html, variables) values
('consent_confirmation',
 'Confirmação de Consentimento - LRP Gallery',
 '<h2>Obrigado por aceitar nossos Termos</h2><p>Seus dados biométricos serão mantidos por 180 dias e então deletados automaticamente, conforme LGPD.</p>',
 '{"email": "user@example.com", "timestamp": "2024-01-01"}'::jsonb
),
('deletion_warning',
 'Aviso: Seus dados serão deletados em 30 dias',
 '<h2>Notificação Importante</h2><p>Seus dados biométricos foram armazenados há 150 dias. Serão deletados automaticamente em 30 dias.</p>',
 '{"email": "user@example.com"}'::jsonb
),
('deletion_confirmation',
 'Confirmação: Seus dados foram deletados',
 '<h2>Exclusão Realizada</h2><p>Conforme sua solicitação e em conformidade com LGPD, seus dados biométricos foram permanentemente deletados de nossos sistemas.</p>',
 '{"email": "user@example.com", "deletion_date": "2024-01-01"}'::jsonb
)
on conflict (template_key) do nothing;

-- 9. RLS (Row Level Security) para consent_records
alter table public.consent_records enable row level security;

-- 10. Política para usuários verem seus próprios registros
create policy "Users can read their own consent records"
  on public.consent_records
  for select
  using (auth.uid()::text = user_id);

-- 11. Política para inserir consentimento
create policy "Users can insert own consent records"
  on public.consent_records
  for insert
  with check (auth.uid()::text = user_id);

-- Verificação
select 'consent_records' as table_name, count(*) as row_count from consent_records
union all
select 'rights_exercise_requests', count(*) from rights_exercise_requests
union all
select 'consent_audit_logs', count(*) from consent_audit_logs
union all
select 'email_templates', count(*) from email_templates;
