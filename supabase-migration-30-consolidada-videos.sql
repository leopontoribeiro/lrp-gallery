-- ============================================================
-- LRP Gallery — Migração 30 (CONSOLIDADA): o que faltou das 23/24/25
--
-- Conferi o banco: as migrações 23, 24 e 25 nunca chegaram a rodar. Por isso
-- a tabela gallery_videos não existe (o botão "Adicionar vídeos" nunca teve
-- onde gravar) e orders.product_type/quota_mb também não — o que faria a
-- compra da galeria permanente (migração 29) falhar na hora de criar o pedido.
--
-- Esta migração junta só o que está faltando. NÃO recria create_storage_order
-- nem settle_order: as versões boas são as da migração 29, que já rodou.
-- É idempotente — rodar de novo não quebra nada.
-- ============================================================
set search_path = public;

-- ── da 23: vídeo único do GRUPO de galerias ──
alter table public.gallery_groups
  add column if not exists video_url text,
  add column if not exists video_thumb_url text,
  add column if not exists video_filename text;

-- ── da 24: vários vídeos por GALERIA ──
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

-- Leitura pública: o cliente vê os vídeos da galeria cujo token ele tem.
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

-- ── da 25: colunas que a compra de armazenamento/permanente usa ──
alter table public.galleries add column if not exists video_quota_mb integer not null default 0;
alter table public.orders    add column if not exists product_type text not null default 'photos';
alter table public.orders    add column if not exists quota_mb int;
alter table public.gallery_videos add column if not exists uploaded_by_client boolean not null default false;

-- ── da 25: cliente subir o próprio vídeo dentro da quota comprada ──
create or replace function public.get_video_quota(p_token text)
returns jsonb language plpgsql security definer stable set search_path = public as $$
declare gid uuid; quota_mb int; used bigint;
begin
  select id, video_quota_mb into gid, quota_mb from galleries
   where access_token = p_token and status = 'live' and deleted_at is null;
  if gid is null then return jsonb_build_object('error','not_found'); end if;
  select coalesce(sum(size_bytes),0) into used from gallery_videos
   where gallery_id = gid and uploaded_by_client = true;
  return jsonb_build_object('quota_mb', quota_mb, 'used_bytes', used,
    'remaining_bytes', greatest(0, quota_mb::bigint*1024*1024 - used));
end; $$;
grant execute on function public.get_video_quota(text) to anon, authenticated;

create or replace function public.get_client_upload_sig(p_token text, p_key text, p_size_bytes bigint)
returns jsonb language plpgsql security definer stable set search_path = public, extensions as $$
declare gid uuid; quota_mb int; used bigint; secret text; win int := 300; exp bigint; sig text;
begin
  select id, video_quota_mb into gid, quota_mb from galleries
   where access_token = p_token and status = 'live' and deleted_at is null;
  if gid is null then return jsonb_build_object('error','not_found'); end if;
  if p_key !~ ('^galleries/' || gid::text || '/client_video_[a-zA-Z0-9._-]+$') then
    return jsonb_build_object('error','bad_key');
  end if;
  select coalesce(sum(size_bytes),0) into used from gallery_videos
   where gallery_id = gid and uploaded_by_client = true;
  if used + coalesce(p_size_bytes,0) > quota_mb::bigint*1024*1024 then
    return jsonb_build_object('error','quota_exceeded');
  end if;
  exp := extract(epoch from now())::bigint + win;
  secret := public._get_secret('r2_signing_secret');
  if secret is null then return jsonb_build_object('error','no_secret'); end if;
  sig := encode(hmac(p_key || ':' || exp::text, secret, 'sha256'), 'hex');
  return jsonb_build_object('key', p_key, 'exp', exp, 'sig', sig);
end; $$;
grant execute on function public.get_client_upload_sig(text,text,bigint) to anon, authenticated;

create or replace function public.add_client_video(p_token text, p_key text, p_thumb_key text, p_name text, p_size_bytes bigint, p_duration numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare gid uuid; quota_mb int; used bigint; base text; vid uuid; pos int;
begin
  select id, video_quota_mb into gid, quota_mb from galleries
   where access_token = p_token and status = 'live' and deleted_at is null;
  if gid is null then return jsonb_build_object('error','not_found'); end if;
  if p_key !~ ('^galleries/' || gid::text || '/client_video_[a-zA-Z0-9._-]+$') then
    return jsonb_build_object('error','bad_key');
  end if;
  select coalesce(sum(size_bytes),0) into used from gallery_videos
   where gallery_id = gid and uploaded_by_client = true;
  if used + coalesce(p_size_bytes,0) > quota_mb::bigint*1024*1024 then
    return jsonb_build_object('error','quota_exceeded');
  end if;
  base := public._get_secret('r2_signed_base');
  select coalesce(max(position),-1)+1 into pos from gallery_videos where gallery_id = gid;
  insert into gallery_videos (gallery_id, name, video_url, thumb_url, filename,
                              size_bytes, duration_seconds, position, uploaded_by_client)
  values (gid, coalesce(nullif(trim(p_name),''),'Vídeo do cliente'), base || '/' || p_key,
          case when p_thumb_key is not null then base || '/' || p_thumb_key else null end,
          p_name, p_size_bytes, p_duration, pos, true)
  returning id into vid;
  return jsonb_build_object('id', vid);
end; $$;
grant execute on function public.add_client_video(text,text,text,text,bigint,numeric) to anon, authenticated;

-- Reverter: drop table public.gallery_videos cascade; e dropar as 3 functions
-- de vídeo do cliente + as colunas novas de galleries/orders/gallery_groups.
