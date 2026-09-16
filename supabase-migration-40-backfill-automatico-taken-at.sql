-- ============================================================
-- LRP Gallery — Migração 40: backfill automático de taken_at
--
-- POR QUÊ: taken_at (migração 39) só era preenchido em upload novo, ou por
-- um script manual (backfill-taken-at.mjs) que alguém tinha que lembrar de
-- rodar toda vez que uma galeria antiga ou uma falha de extração deixava
-- fotos sem data — até lá, a galeria ordenava por "position" (ordem de
-- upload), que pode vir de trás pra frente. Isso vira rotina do sistema: o
-- Worker (r2-signed-worker) passa a rodar um cron a cada 10min que lê a
-- foto direto do R2, acha o EXIF sozinho e grava aqui — sem depender de
-- ninguém lembrar de rodar nada.
--
-- Estas 2 funções são as únicas coisas que o Worker chama, com o mesmo
-- padrão de segurança das migrações 12/35 (WORKER_SECRET guardado no Vault,
-- comparado dentro da função — nunca exposto fora do Postgres).
-- ============================================================
set search_path = public;

-- Marca quais fotos já foram CONFERIDAS pro EXIF (achou data ou confirmou
-- que não tem) — sem isso, uma foto sem EXIF (print, recomprimida) seria
-- relida a cada 10 minutos pra sempre, sem nunca sair da fila.
alter table photos add column if not exists taken_at_checked boolean not null default false;

create index if not exists idx_photos_taken_at_pending
  on photos (id) where taken_at is null and taken_at_checked = false;

-- 1. Devolve um lote de fotos ainda não conferidas (id + chave do R2), pro
--    Worker ler direto do bucket — nenhum byte da foto passa pelo Supabase.
create or replace function public.get_photos_missing_taken_at(p_secret text, p_limit int default 200)
returns table (id uuid, r2_key text)
language plpgsql security definer stable
set search_path = public as $$
begin
  if p_secret is null or p_secret <> public._get_secret('worker_secret') then
    return; -- lista vazia, sem erro — não dá pra saber se o secret existe
  end if;

  return query
    select p.id, split_part(regexp_replace(p.full_url, '^https?://[^/]+/', ''), '?', 1) as r2_key
    from photos p
    where p.taken_at is null
      and p.taken_at_checked = false
      and p.full_url like '%galleries/%'
    order by p.id asc
    limit least(coalesce(p_limit, 200), 500);
end $$;
revoke all on function public.get_photos_missing_taken_at(text, int) from public;
grant execute on function public.get_photos_missing_taken_at(text, int) to anon, authenticated;

-- 2. Grava o resultado em lote. Cada item pode trazer um taken_at real (achou
--    EXIF) ou vir com taken_at nulo (leu certinho, só que a foto não tem EXIF
--    — mesmo assim marca "checked" pra não entrar de novo na fila). Um item
--    que deu erro de rede/leitura o Worker simplesmente OMITE do lote — fica
--    checked=false e volta a aparecer no próximo cron.
create or replace function public.set_taken_at_batch(p_secret text, p_updates jsonb)
returns int
language plpgsql security definer
set search_path = public as $$
declare n int;
begin
  if p_secret is null or p_secret <> public._get_secret('worker_secret') then
    return 0;
  end if;

  with u as (
    select (elem->>'id')::uuid as id,
           nullif(elem->>'taken_at', '')::timestamptz as taken_at
    from jsonb_array_elements(coalesce(p_updates, '[]'::jsonb)) as elem
  )
  update photos p
     set taken_at = coalesce(u.taken_at, p.taken_at),
         taken_at_checked = true
  from u
  where p.id = u.id;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.set_taken_at_batch(text, jsonb) from public;
grant execute on function public.set_taken_at_batch(text, jsonb) to anon, authenticated;

-- Conferência (rode de novo depois de um tempo — o cron roda a cada 10min):
-- select count(*) filter (where taken_at is not null) as com_data,
--        count(*) filter (where taken_at is null and taken_at_checked) as sem_exif_confirmado,
--        count(*) filter (where taken_at is null and not taken_at_checked) as fila_pendente
-- from photos;
-- ============================================================
