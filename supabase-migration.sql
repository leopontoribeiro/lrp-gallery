-- ============================================================
-- LRP Gallery — Migration
-- Execute no SQL Editor do Supabase (em ordem)
-- ============================================================

-- 1. Colunas extras na tabela galleries
-- ------------------------------------------------------------
ALTER TABLE galleries
  ADD COLUMN IF NOT EXISTS expires_at        timestamptz,
  ADD COLUMN IF NOT EXISTS download_enabled  boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS access_password   text,
  ADD COLUMN IF NOT EXISTS cover_position_x  float8  DEFAULT 50,
  ADD COLUMN IF NOT EXISTS cover_position_y  float8  DEFAULT 50;

-- 1b. Dimensões (layout justificado) e grupo nomeado por foto
-- ------------------------------------------------------------
ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS width      int,
  ADD COLUMN IF NOT EXISTS height     int,
  ADD COLUMN IF NOT EXISTS group_name text;

-- 2. Tabela de eventos de fotos (views, likes, saves)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS photo_events (
  id          bigserial PRIMARY KEY,
  gallery_id  uuid    NOT NULL REFERENCES galleries(id)  ON DELETE CASCADE,
  photo_id    bigint           REFERENCES photos(id)     ON DELETE SET NULL,
  event_type  text    NOT NULL CHECK (event_type IN ('view','like','save')),
  visitor_id  text,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_photo_events_gallery ON photo_events (gallery_id);
CREATE INDEX IF NOT EXISTS idx_photo_events_photo   ON photo_events (photo_id);
CREATE INDEX IF NOT EXISTS idx_photo_events_type    ON photo_events (event_type);
CREATE INDEX IF NOT EXISTS idx_photo_events_date    ON photo_events (created_at);

-- 3. Row Level Security
-- (Se RLS ainda não estiver habilitado nessas tabelas, habilite:)
-- ALTER TABLE galleries     ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE photos        ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE photo_events  ENABLE ROW LEVEL SECURITY;

-- Política: anon pode ler galleries (UUID já é unguessable)
-- CREATE POLICY "anon_select_galleries" ON galleries
--   FOR SELECT TO anon USING (true);

-- Política: anon pode ler fotos
-- CREATE POLICY "anon_select_photos" ON photos
--   FOR SELECT TO anon USING (true);

-- Política: anon pode inserir eventos (tracking)
-- CREATE POLICY "anon_insert_events" ON photo_events
--   FOR INSERT TO anon WITH CHECK (true);

-- Política: anon pode ler eventos (para analytics no admin)
-- CREATE POLICY "anon_select_events" ON photo_events
--   FOR SELECT TO anon USING (true);

-- NOTA SOBRE SEGURANÇA:
-- O UUID v4 do Supabase tem 122 bits de entropia (~5×10^36 combinações).
-- Força bruta não é prática. O link longo *é* a senha.
-- Para galerias sensíveis, use access_password como camada extra.
-- ============================================================
