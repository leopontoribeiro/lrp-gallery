-- ============================================================
-- LRP Gallery — Migração 39: ordem cronológica real (EXIF)
--
-- POR QUÊ: a ordem das fotos vinha de "position", que é só a ordem em que
-- os arquivos foram selecionados no upload (Finder, drag-and-drop) — não
-- tem nenhuma relação garantida com o horário real da foto. Em galerias
-- com mais de uma câmera isso embaralha a ordem (cada câmera numera do
-- seu jeito). A correção de verdade é usar a data de captura da própria
-- foto (EXIF DateTimeOriginal), que é gravada pela câmera.
--
-- Esta migração só cria a coluna e muda a ordenação pra usá-la quando
-- existir (nulls last — cai pra position quando a foto não tem EXIF).
-- O preenchimento em si é feito por:
--   - upload novo: admin-galleries.js / admin-bulk.js já leem o EXIF
--     antes de subir e gravam taken_at direto no insert.
--   - fotos já existentes: rode backfill-taken-at.mjs (mesmo padrão do
--     backfill-dimensions.mjs) pra preencher taken_at nas galerias atuais.
-- ============================================================
set search_path = public;

alter table photos add column if not exists taken_at timestamptz;

create index if not exists idx_photos_gallery_taken
  on photos (gallery_id, taken_at, position);

-- Recria get_public_photos (mesma assinatura da migração 37) só trocando
-- o ORDER BY — mantém a assinatura de URL (_sign_r2_url) e os grants como
-- estavam, pra não repetir o quebra-quebra da migração 37.
drop function if exists public.get_public_photos(text, int, int, text);

create function public.get_public_photos(
  p_token text, p_offset int default 0, p_limit int default 500, p_pw text default null)
returns table (id uuid, filename text, thumb_url text, full_url text,
               "position" int, width int, height int, group_name text)
language sql security definer stable set search_path = public as $$
  select p.id, p.filename,
         public._sign_r2_url(p.thumb_url, coalesce(g.watermark, false)) as thumb_url,
         case when g.full_url_delivery_disabled then null
              else public._sign_r2_url(p.full_url, coalesce(g.watermark, false)) end as full_url,
         p.position, p.width, p.height, p.group_name
  from photos p
  join galleries g on g.id = p.gallery_id
  where g.id = public._gallery_ok(p_token, p_pw)
  order by p.taken_at asc nulls last, p.position asc
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(coalesce(p_limit, 500), 500);
$$;
grant execute on function public.get_public_photos(text, int, int, text) to anon, authenticated;

-- Conferência (depois de rodar o backfill):
-- select count(*) filter (where taken_at is null) as sem_data,
--        count(*) filter (where taken_at is not null) as com_data
-- from photos;
-- ============================================================
