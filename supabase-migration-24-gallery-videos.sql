-- ============================================================
-- LRP Gallery — Migração 24: vídeos por galeria (múltiplos, com cards)
--
-- Diferente do vídeo único do GRUPO (migração 23): aqui cada GALERIA pode
-- ter vários vídeos, cada um com identidade própria (nome, capa, tamanho,
-- duração) — por isso é tabela própria, não colunas soltas.
-- Arquivo fica no R2 sob galleries/<id>/video_... (mesma assinatura de
-- sempre); esta tabela só guarda a referência + metadados.
--
-- Rode depois da migração 21. Reversível: drop table gallery_videos.
-- ============================================================
set search_path = public;

create table if not exists public.gallery_videos (
  id uuid primary key default gen_random_uuid(),
  gallery_id uuid not null references public.galleries(id) on delete cascade,
  name text not null,
  video_url text not null,
  thumb_url text,
  filename text,
  size_bytes bigint,
  duration_seconds numeric,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_gallery_videos_gallery on public.gallery_videos(gallery_id);

alter table public.gallery_videos enable row level security;
drop policy if exists admin_all_gallery_videos on public.gallery_videos;
create policy admin_all_gallery_videos on public.gallery_videos
  for all to authenticated using (public._admin_ok()) with check (public._admin_ok());

-- Leitura pública (cliente vê os vídeos da galeria que tem o token).
create or replace function public.get_public_gallery_videos(p_token text)
returns jsonb language plpgsql security definer stable
set search_path = public as $$
declare gid uuid;
begin
  select id into gid from galleries where access_token = p_token and status = 'live' and deleted_at is null;
  if gid is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', v.id, 'name', v.name,
      'video', public._sign_r2_url(v.video_url),
      'thumb', public._sign_r2_url(v.thumb_url),
      'size_bytes', v.size_bytes, 'duration', v.duration_seconds
    ) order by v.position)
    from gallery_videos v where v.gallery_id = gid
  ), '[]'::jsonb);
end $$;
grant execute on function public.get_public_gallery_videos(text) to anon, authenticated;

-- Reverter: drop function public.get_public_gallery_videos(text); drop table public.gallery_videos;
