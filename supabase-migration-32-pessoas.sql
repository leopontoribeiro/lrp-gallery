-- ============================================================
-- LRP Gallery — Migração 32: memória das pessoas identificadas
--
-- Hoje a tela "Pessoas" reagrupa tudo do zero a cada abertura: você nomeia a
-- Karine, fecha, abre de novo e ela volta como card anônimo. Pior, os cards
-- que você escondeu com o ✕ reaparecem todos.
--
-- Esta tabela guarda, por galeria, o "centro" do rosto de cada pessoa já
-- nomeada (a média dos vetores dela). Na abertura seguinte, comparamos os
-- grupos novos com esses centros: quem bate já vem com o nome preenchido, e
-- quem você mandou ignorar continua escondido. Também faz as fotos novas de
-- um evento serem atribuídas sozinhas a quem já foi identificado.
--
-- Tabela pequena de propósito (uma linha por pessoa, não por rosto) — assim
-- não precisa reescrever o índice facial inteiro a cada nome dado.
-- ============================================================
set search_path = public;

create table if not exists public.gallery_people (
  id          uuid primary key default gen_random_uuid(),
  gallery_id  uuid not null references public.galleries(id) on delete cascade,
  name        text,                       -- nulo quando é um grupo ignorado
  centroid    smallint[] not null,        -- 128 números, mesma escala int8 do índice
  ignored     boolean not null default false,
  photo_count int not null default 0,
  updated_at  timestamptz not null default now()
);
create index if not exists idx_gallery_people_gallery on public.gallery_people(gallery_id);
-- Um nome por galeria: renomear a mesma pessoa duas vezes atualiza, não duplica.
create unique index if not exists idx_gallery_people_nome
  on public.gallery_people(gallery_id, name) where name is not null;

alter table public.gallery_people enable row level security;
drop policy if exists admin_all_gallery_people on public.gallery_people;
create policy admin_all_gallery_people on public.gallery_people
  for all to authenticated using (public._admin_ok()) with check (public._admin_ok());
revoke all on public.gallery_people from anon;

-- Reverter: drop table public.gallery_people;
