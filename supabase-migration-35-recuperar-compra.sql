-- ============================================================
-- LRP Gallery — Migração 35: recuperar compra por e-mail
--
-- PROBLEMA: o código de desbloqueio vivia SÓ no localStorage do navegador.
--   Cliente limpa o histórico, troca de celular, compra na aba anônima ou
--   abre o link no computador → perde o acesso ao que pagou. Isso não é bug
--   raro: é o comportamento normal de quem compra pelo celular e depois quer
--   baixar no computador. Cada caso vira mensagem para você resolver na mão.
--
-- SOLUÇÃO: o e-mail do pagador já é gravado em orders.email na aprovação.
--   Esta função devolve os códigos aprovados daquele e-mail naquela galeria.
--   Ela NÃO é exposta ao navegador — só o Worker chama, com o WORKER_SECRET,
--   e o Worker manda o código por e-mail. Assim ninguém descobre códigos
--   chutando e-mails.
-- ============================================================
set search_path = public;

create or replace function public.get_unlock_codes_for_email(
  p_secret text, p_token text, p_email text)
returns jsonb language plpgsql security definer
set search_path = public as $$
declare gid uuid; codes text[]; qtd int;
begin
  -- Só o Worker. Sem isso, qualquer um enumeraria compras por e-mail.
  if p_secret is null or p_secret <> public._get_secret('worker_secret') then
    return jsonb_build_object('error', 'forbidden');
  end if;

  select id into gid from galleries
  where access_token = p_token and status = 'live' and deleted_at is null;
  if gid is null then return jsonb_build_object('error', 'not_found'); end if;

  select array_agg(distinct o.unlock_code), count(*)
    into codes, qtd
  from orders o
  where o.gallery_id = gid
    and o.status = 'approved'
    and o.unlock_code is not null
    and lower(trim(o.email)) = lower(trim(p_email));

  return jsonb_build_object(
    'codes', coalesce(to_jsonb(codes), '[]'::jsonb),
    'qtd',   coalesce(qtd, 0),
    'gallery_name', (select name from galleries where id = gid));
end $$;

revoke execute on function public.get_unlock_codes_for_email(text, text, text) from anon, authenticated;

-- Busca por e-mail fica indexada (a tabela cresce por evento).
create index if not exists idx_orders_email_status
  on public.orders (gallery_id, lower(email), status);
