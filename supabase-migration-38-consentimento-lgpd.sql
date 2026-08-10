-- ============================================================
-- LRP Gallery — Migração 38: o consentimento biométrico passa a ser gravado
--
-- ACHADO: o registro de consentimento NUNCA funcionou. Três defeitos somados:
--
--   1. A política de RLS exige `auth.uid()::text = user_id`. Quem abre a
--      galeria é anônimo — `auth.uid()` é sempre null. Todo insert era
--      recusado, sem exceção.
--   2. O front enviava as colunas `version` e `timestamp`, que não existem
--      na tabela; e não enviava `user_id`, que é NOT NULL.
--   3. O erro caía num `console.warn`. Ninguém nunca soube.
--
-- Ou seja: a prova de consentimento existia só no localStorage do visitante
-- — apagável por ele, invisível para você, sem valor probatório.
--
-- SOLUÇÃO: uma RPC `security definer` que grava o registro com os dados que
-- de fato servem como evidência — inclusive IP e user-agent, que o PostgREST
-- expõe ao servidor e que o navegador não teria como forjar sozinho.
-- ============================================================
set search_path = public;

-- Colunas de evidência (idempotente).
alter table public.consent_records add column if not exists gallery_id  uuid;
alter table public.consent_records add column if not exists visitor_id  text;
alter table public.consent_records add column if not exists version     text;
alter table public.consent_records add column if not exists ip          text;
alter table public.consent_records add column if not exists user_agent  text;
alter table public.consent_records add column if not exists accepted_at timestamptz default now();

create index if not exists idx_consent_gallery on public.consent_records (gallery_id, accepted_at desc);
create index if not exists idx_consent_visitor on public.consent_records (visitor_id);

-- ── Gravação do consentimento ───────────────────────────────
create or replace function public.record_biometric_consent(
  p_token    text,
  p_visitor  text,
  p_accepted boolean,
  p_version  text default null,
  p_data     jsonb default '{}'::jsonb)
returns uuid
language plpgsql security definer
set search_path = public as $$
declare gid uuid; hdrs json; novo uuid;
begin
  select id into gid from galleries
  where access_token = p_token and status = 'live' and deleted_at is null;
  if gid is null then return null; end if;

  -- IP e user-agent vêm do PostgREST, não do corpo da requisição: o visitante
  -- não consegue forjá-los pelo navegador. É isso que dá peso ao registro.
  begin
    hdrs := current_setting('request.headers', true)::json;
  exception when others then hdrs := null;
  end;

  insert into consent_records (
    user_id, gallery_id, visitor_id, accepted, version, consent_data,
    ip, user_agent, accepted_at)
  values (
    coalesce(p_visitor, 'anon'), gid, p_visitor, coalesce(p_accepted, false),
    p_version, coalesce(p_data, '{}'::jsonb),
    coalesce(hdrs ->> 'x-forwarded-for', hdrs ->> 'cf-connecting-ip'),
    left(coalesce(hdrs ->> 'user-agent', ''), 400),
    now())
  returning id into novo;

  return novo;
end $$;

grant execute on function public.record_biometric_consent(text, text, boolean, text, jsonb) to anon, authenticated;

-- ── Políticas antigas ───────────────────────────────────────
-- Exigiam auth.uid(), o que nunca vale para o visitante anônimo. A gravação
-- agora passa pela função acima (security definer), então elas só atrapalham.
drop policy if exists "Users can insert own consent records" on public.consent_records;
drop policy if exists "Users can read their own consent records" on public.consent_records;
revoke all on public.consent_records from anon;

-- ── Conferência ─────────────────────────────────────────────
-- Depois de aceitar o termo numa galeria, esta consulta tem que trazer a linha:
--   select accepted_at, accepted, version, ip, left(user_agent,40), visitor_id
--   from consent_records order by accepted_at desc limit 5;
