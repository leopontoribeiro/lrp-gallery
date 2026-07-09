-- ============================================================
-- LRP Gallery — Migração 2: Segurança (RPCs + fecho do vazamento)
-- Rode no SQL Editor do Supabase, de uma vez.
--
-- O que faz:
--  • Cria funções seguras que a galeria pública passa a usar.
--  • Revoga a leitura/escrita direta da chave anon nas tabelas
--    (hoje qualquer um lê access_token, full_url e password_hash).
--  • O painel admin (usuário logado = role authenticated) NÃO é afetado.
--  • O gallery.html já está preparado: usa as RPCs se existirem,
--    senão cai no modo antigo. Após rodar isto, a segurança ativa sozinha.
-- ============================================================

-- 1. Metadados públicos da galeria (sem access_token, sem password_hash)
create or replace function public.get_public_gallery(p_token text default null, p_slug text default null)
returns table (
  id uuid, name text, slug text, status text,
  cover_photo_id uuid, cover_position_x float8, cover_position_y float8,
  expires_at timestamptz, download_enabled boolean, has_password boolean
) language sql security definer stable
set search_path = public as $$
  select g.id, g.name, g.slug, g.status, g.cover_photo_id,
         g.cover_position_x, g.cover_position_y, g.expires_at, g.download_enabled,
         (g.password_hash is not null) as has_password
  from galleries g
  where g.status = 'live'
    and (
      (p_token is not null and g.access_token = p_token) or
      (p_token is null and p_slug is not null and g.slug = p_slug) or
      (p_token is null and p_slug is null)
    )
  order by g.created_at desc
  limit 1;
$$;

-- 2. Fotos públicas paginadas (só da galeria daquele token)
create or replace function public.get_public_photos(p_token text, p_offset int default 0, p_limit int default 500)
returns table (
  id uuid, filename text, thumb_url text, full_url text,
  "position" int, width int, height int, group_name text
) language sql security definer stable
set search_path = public as $$
  select p.id, p.filename, p.thumb_url, p.full_url, p.position, p.width, p.height, p.group_name
  from photos p
  join galleries g on g.id = p.gallery_id
  where g.access_token = p_token and g.status = 'live'
  order by p.position asc
  offset greatest(coalesce(p_offset,0),0)
  limit least(coalesce(p_limit,500), 500);
$$;

-- 2b. Contagem pública de fotos
create or replace function public.get_public_photo_count(p_token text)
returns integer language sql security definer stable
set search_path = public as $$
  select count(*)::int
  from photos p join galleries g on g.id = p.gallery_id
  where g.access_token = p_token and g.status = 'live';
$$;

-- 3. Verificação de senha no servidor (o hash nunca sai do banco)
--    Recebe o hash SHA-256 calculado no cliente e compara.
create or replace function public.verify_gallery_password(p_token text, p_hash text)
returns boolean language sql security definer stable
set search_path = public as $$
  select exists(
    select 1 from galleries
    where access_token = p_token and password_hash = p_hash
  );
$$;

-- 4. Registro de eventos (view/like/save) de forma controlada
create or replace function public.log_photo_event(p_token text, p_photo_id uuid, p_type text, p_visitor text)
returns void language plpgsql security definer
set search_path = public as $$
declare gid uuid;
begin
  if p_type not in ('view','like','save') then return; end if;
  select id into gid from galleries where access_token = p_token and status = 'live';
  if gid is null then return; end if;
  insert into photo_events(gallery_id, photo_id, event_type, visitor_id)
  values (gid, p_photo_id, p_type, p_visitor);
end; $$;

-- 5. Permissões: anon só executa as funções, não toca nas tabelas
grant execute on function public.get_public_gallery(text,text)            to anon;
grant execute on function public.get_public_photos(text,int,int)          to anon;
grant execute on function public.get_public_photo_count(text)             to anon;
grant execute on function public.verify_gallery_password(text,text)       to anon;
grant execute on function public.log_photo_event(text,uuid,text,text)     to anon;

-- 6. Fecha o acesso direto do anon (remove o vazamento de token/hash/URLs)
drop policy if exists "anon_select_galleries" on galleries;
drop policy if exists "anon_select_photos"    on photos;
drop policy if exists "anon_insert_events"    on photo_events;
drop policy if exists "anon_select_events"    on photo_events;
-- REVOGA os privilégios de tabela do anon (só dropar policy não basta — o anon
-- tem GRANT direto). As RPCs são security definer, então continuam funcionando.
revoke all on public.galleries    from anon;
revoke all on public.photos       from anon;
revoke all on public.photo_events from anon;
-- O role authenticated (admin logado) mantém acesso total.

-- 7. Índice para a busca ordenada de fotos por galeria
create index if not exists idx_photos_gallery_position on photos (gallery_id, position);

-- ============================================================
-- VERIFICAÇÃO (opcional): depois de rodar, isto deve retornar VAZIO,
-- provando que a chave anon não lê mais os tokens:
--   set role anon;
--   select access_token from galleries limit 1;   -- deve dar "permission denied"
--   reset role;
-- ============================================================
