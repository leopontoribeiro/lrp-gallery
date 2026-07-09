-- ============================================================
-- MIGRATION: Clients + Events + Share Links System
-- Estrutura para compartilhamento de galerias por cliente
-- ============================================================

-- 1. Tabela de Clientes (Leandro Rosadas, etc)
create table if not exists public.clients (
  id uuid primary key default uuid_generate_v4(),
  name text not null unique,
  slug text not null unique,
  description text,
  logo_url text,
  contact_email text,
  created_at timestamp default now(),
  updated_at timestamp default now()
);

-- 2. Tabela de Eventos (IMPULSO, BLACKBELT, etc)
create table if not exists public.events (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid not null references clients(id) on delete cascade,
  name text not null,
  event_date date not null,
  cover_image_url text,
  description text,
  status text default 'active', -- active, archived
  created_at timestamp default now(),
  updated_at timestamp default now()
);

-- 3. Tabela de Link de Compartilhamento
create table if not exists public.share_links (
  id uuid primary key default uuid_generate_v4(),
  event_id uuid not null references events(id) on delete cascade,
  token text not null unique,
  access_type text default 'public', -- public, restricted
  allowed_emails text[], -- emails permitidas (se restricted)
  expires_at timestamp,
  max_views integer,
  view_count integer default 0,
  created_at timestamp default now(),
  updated_at timestamp default now()
);

-- 4. Índices para performance
create index if not exists idx_clients_slug on clients(slug);
create index if not exists idx_events_client_id on events(client_id);
create index if not exists idx_events_date on events(event_date);
create index if not exists idx_share_links_token on share_links(token);
create index if not exists idx_share_links_event_id on share_links(event_id);

-- 5. RLS para clients (público para leitura)
alter table public.clients enable row level security;
create policy "Clients are public readable"
  on public.clients for select using (true);

-- 6. RLS para events (público para leitura via client)
alter table public.events enable row level security;
create policy "Events are public readable"
  on public.events for select using (true);

-- 7. RLS para share_links (controle de acesso por token)
alter table public.share_links enable row level security;
create policy "Share links are readable if token matches or admin"
  on public.share_links for select using (true);

-- 8. Função para gerar token único
create or replace function public.generate_share_token()
returns text as $$
begin
  return 'share_' || replace(cast(gen_random_uuid() as text), '-', '')::text;
end;
$$ language plpgsql;

-- 9. View para dashboard do cliente (eventos com share links)
create or replace view public.client_events_with_links as
select
  c.id as client_id,
  c.name as client_name,
  c.slug as client_slug,
  e.id as event_id,
  e.name as event_name,
  e.event_date,
  e.cover_image_url,
  e.description,
  sl.token as share_token,
  sl.access_type,
  sl.expires_at,
  (sl.expires_at > now()) as is_active
from clients c
left join events e on c.id = e.client_id
left join share_links sl on e.id = sl.event_id
where e.status = 'active'
order by c.name, e.event_date desc;

-- 10. Verificação
select 'clients' as table_name, count(*) as count from clients
union all
select 'events', count(*) from events
union all
select 'share_links', count(*) from share_links;
