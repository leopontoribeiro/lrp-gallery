-- ============================================================
-- LRP Gallery — Migração 31: dump do banco para o backup automático
--
-- As FOTOS já são replicadas pro bucket BACKUP pelo Worker, mas os DADOS
-- (galerias, tokens de acesso, grupos, vídeos, vendas, seleções) não tinham
-- cópia nenhuma. Se algo for apagado por engano ou o Supabase falhar, hoje
-- não haveria de onde restaurar — os arquivos existiriam no R2 sem ninguém
-- saber a qual álbum pertencem.
--
-- Esta função é chamada 1x/dia pelo Worker (cron 04:00), protegida pelo mesmo
-- worker_secret das outras rotinas. Não é exposta ao cliente nem ao admin.
--
-- face_indexes fica de fora de propósito: é o maior volume do banco (128
-- números por rosto) e é 100% regenerável pelo botão "Escanear rostos".
-- ============================================================
set search_path = public;

create or replace function public.backup_dump(p_secret text, p_table text, p_offset int default 0, p_limit int default 1000)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ws text; res jsonb; lim int;
begin
  ws := public._get_secret('worker_secret');
  if ws is null or p_secret is null or p_secret <> ws then
    return jsonb_build_object('error','forbidden');
  end if;

  lim := least(greatest(coalesce(p_limit,1000), 1), 2000);

  -- Lista fechada: a função é security definer, então nada de tabela dinâmica.
  if p_table = 'galleries' then
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into res
      from (select * from galleries order by created_at offset p_offset limit lim) t;
  elsif p_table = 'gallery_groups' then
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into res
      from (select * from gallery_groups order by created_at offset p_offset limit lim) t;
  elsif p_table = 'photos' then
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into res
      from (select id, gallery_id, filename, storage_path, thumb_url, full_url,
                   position, width, height, size_bytes, group_name, created_at
              from photos order by created_at offset p_offset limit lim) t;
  elsif p_table = 'gallery_videos' then
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into res
      from (select * from gallery_videos order by created_at offset p_offset limit lim) t;
  elsif p_table = 'orders' then
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into res
      from (select * from orders order by created_at offset p_offset limit lim) t;
  elsif p_table = 'selections' then
    select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into res
      from (select * from selections order by created_at offset p_offset limit lim) t;
  else
    return jsonb_build_object('error','bad_table');
  end if;

  return jsonb_build_object('rows', res, 'count', jsonb_array_length(res));
end; $$;

-- Só o Worker (que tem o worker_secret) usa. Ninguém mais pode executar.
revoke execute on function public.backup_dump(text,text,int,int) from public, anon, authenticated;
grant  execute on function public.backup_dump(text,text,int,int) to anon;

-- Reverter: drop function public.backup_dump(text,text,int,int);
