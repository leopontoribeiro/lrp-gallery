-- ============================================================
-- LRP Gallery — Migração 9: índice facial por álbum (Arquitetura A)
-- O admin gera o índice no navegador (face-api.js) e salva aqui.
-- O cliente lê via get_face_index e compara a selfie localmente.
-- Reversível. Rode depois da migração 2.
-- ============================================================
set search_path = public;

-- Um índice por galeria: data = { faces: [{ p: photo_id, d: [128 floats] }], ... }
create table if not exists public.face_indexes (
  gallery_id uuid primary key references public.galleries(id) on delete cascade,
  data       jsonb not null,
  face_count int default 0,
  photo_count int default 0,
  updated_at timestamptz default now()
);

-- Só o admin gerencia o índice (painel logado)
alter table public.face_indexes enable row level security;
drop policy if exists "admin_all_face_indexes" on public.face_indexes;
create policy "admin_all_face_indexes" on public.face_indexes for all to authenticated
  using ((auth.jwt() ->> 'email') = 'souleandroribeiro@gmail.com')
  with check ((auth.jwt() ->> 'email') = 'souleandroribeiro@gmail.com');
revoke all on public.face_indexes from anon;

-- O cliente (anon) só lê o índice do álbum ao qual tem o token
create or replace function public.get_face_index(p_token text)
returns jsonb language sql security definer stable set search_path = public as $$
  select fi.data
  from face_indexes fi
  join galleries g on g.id = fi.gallery_id
  where g.access_token = p_token and g.status = 'live';
$$;
grant execute on function public.get_face_index(text) to anon, authenticated;

-- ============================================================
-- Reverter:
--   drop function public.get_face_index(text);
--   drop table public.face_indexes;
-- ============================================================
