# 🔐 TASK #25: Executar RUNBOOK de Segurança

## Status: ⏳ Em Execução

Instruções para aplicar patches de segurança no Supabase.

---

## 📋 O que você precisa fazer

### PASSO 1: Executar Migration #2 (Fechar vazamento de tokens)

**Acesse:** Supabase → SQL Editor

**Cole o script abaixo e clique em "Executar":**

```sql
-- ============================================================
-- LRP Gallery — Migração 2: Segurança (RPCs + fecho do vazamento)
-- Rode no SQL Editor do Supabase, de uma vez.
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

-- 6. Fecha o acesso direto do anon
drop policy if exists "anon_select_galleries" on galleries;
drop policy if exists "anon_select_photos"    on photos;
drop policy if exists "anon_insert_events"    on photo_events;
drop policy if exists "anon_select_events"    on photo_events;

revoke all on public.galleries    from anon;
revoke all on public.photos       from anon;
revoke all on public.photo_events from anon;

-- 7. Índice para a busca ordenada de fotos por galeria
create index if not exists idx_photos_gallery_position on photos (gallery_id, position);
```

**Resultado esperado:** "Success. No rows returned."

---

### PASSO 2: Verificar que o vazamento foi fechado

Cole no SQL Editor e execute:

```sql
set role anon; 
select access_token from galleries limit 1; 
reset role;
```

**Resultado esperado:** `permission denied`

Se retornar tokens, a segurança não ativou corretamente.

---

### PASSO 3: Executar Migration #3 (URLs assinadas)

Cole no SQL Editor:

```sql
-- ============================================================
-- LRP Gallery — Migração 3: URLs assinadas (privacidade dos originais)
-- ============================================================

create extension if not exists pgcrypto;

-- Tabela privada de segredos
create table if not exists public.app_secrets (
  key   text primary key,
  value text not null
);
revoke all on public.app_secrets from anon, authenticated;

-- Função para assinar URLs do R2
create or replace function public._sign_r2_url(p_url text)
returns text language plpgsql stable security definer
set search_path = public, extensions as $$
declare
  secret text; base text; win int := 21600; -- janela de 6h
  okey text; exp bigint; sig text;
begin
  if p_url is null then return p_url; end if;
  select value into secret from app_secrets where app_secrets.key = 'r2_signing_secret';
  select value into base   from app_secrets where app_secrets.key = 'r2_signed_base';
  if secret is null or base is null then return p_url; end if;

  okey := regexp_replace(p_url, '^https?://[^/]+/', '');
  okey := split_part(okey, '?', 1);

  if okey not like 'galleries/%' then return p_url; end if;

  exp := (floor(extract(epoch from now()) / win)::bigint + 2) * win;
  sig := encode(hmac(okey || ':' || exp::text, secret, 'sha256'), 'hex');
  return base || '/' || okey || '?exp=' || exp::text || '&sig=' || sig;
end; $$;

-- Permissão
revoke execute on function public._sign_r2_url(text) from public, anon, authenticated;

-- Recria get_public_photos assinando URLs
create or replace function public.get_public_photos(p_token text, p_offset int default 0, p_limit int default 500)
returns table (
  id uuid, filename text, thumb_url text, full_url text,
  "position" int, width int, height int, group_name text
) language sql security definer stable
set search_path = public as $$
  select p.id, p.filename,
         public._sign_r2_url(p.thumb_url) as thumb_url,
         public._sign_r2_url(p.full_url)  as full_url,
         p.position, p.width, p.height, p.group_name
  from photos p
  join galleries g on g.id = p.gallery_id
  where g.access_token = p_token and g.status = 'live'
  order by p.position asc
  offset greatest(coalesce(p_offset,0),0)
  limit least(coalesce(p_limit,500), 500);
$$;
```

**Resultado esperado:** "Success. No rows returned."

---

### PASSO 4 (FUTURO): Ativar assinatura com o worker

Quando o worker signed estiver pronto (passo 4 do RUNBOOK), execute:

```sql
insert into public.app_secrets(key, value) values
  ('r2_signing_secret', 'COLE_O_SEU_SIGNING_SECRET'),
  ('r2_signed_base',    'https://lrp-gallery-signed.SEU-SUBDOMINIO.workers.dev')
on conflict (key) do update set value = excluded.value;
```

---

## ✅ Checklist

- [ ] Passo 1: Migration #2 executada com sucesso
- [ ] Passo 2: Verificação retornou "permission denied"
- [ ] Passo 3: Migration #3 executada com sucesso
- [ ] Gallery carrega normalmente em www.souleandroribeiro.com.br/gallery

---

## 🎯 O que foi corrigido

✅ **Antes:** Qualquer um podia ler tokens e URLs das galerias diretamente  
✅ **Depois:** Apenas RPCs autorizadas permitem acesso (tokens nunca são expostos)

---

**Próximo passo:** Task #17 - Deploy Privacy Policy Page
