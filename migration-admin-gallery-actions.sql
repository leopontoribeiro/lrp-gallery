-- ============================================================
-- MIGRATION: Admin Gallery Actions (Versão Simples)
-- Adiciona suporte para 6 ações: QR, Toggle, Cover, Delete, Download
-- Apenas para tabela GALLERIES (sem gallery_groups)
-- ============================================================

-- FASE 1: Adicionar colunas à tabela galleries
ALTER TABLE public.galleries
ADD COLUMN IF NOT EXISTS sharing_enabled boolean DEFAULT true,
ADD COLUMN IF NOT EXISTS cover_image_url text,
ADD COLUMN IF NOT EXISTS cover_image_hash text,
ADD COLUMN IF NOT EXISTS deleted_at timestamp,
ADD COLUMN IF NOT EXISTS deleted_by uuid REFERENCES auth.users(id);

-- FASE 2: Criar índices para performance
CREATE INDEX IF NOT EXISTS idx_galleries_deleted ON public.galleries(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_galleries_sharing ON public.galleries(sharing_enabled);

-- FASE 3: Criar tabela download_history (rastreamento de downloads)
CREATE TABLE IF NOT EXISTS public.download_history (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  gallery_id uuid REFERENCES public.galleries(id) ON DELETE SET NULL,
  user_id uuid REFERENCES auth.users(id),
  download_type text NOT NULL, -- 'all' ou 'favorites'
  file_size_bytes bigint,
  total_photos integer,
  downloaded_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_download_history_gallery ON public.download_history(gallery_id);
CREATE INDEX IF NOT EXISTS idx_download_history_user ON public.download_history(user_id);

-- FASE 4: Função para calcular tamanho de arquivo zip (helper)
CREATE OR REPLACE FUNCTION public.get_gallery_photos_size(gallery_id uuid)
RETURNS bigint AS $$
DECLARE
  total_size bigint;
BEGIN
  SELECT COALESCE(SUM(CAST(file_size AS bigint)), 0)
  INTO total_size
  FROM public.photos
  WHERE gallery_id = $1 AND deleted_at IS NULL;

  RETURN total_size;
END;
$$ LANGUAGE plpgsql;

-- FASE 5: Função para contar fotos favoritas
CREATE OR REPLACE FUNCTION public.get_gallery_favorites_count(gallery_id uuid)
RETURNS integer AS $$
DECLARE
  count integer;
BEGIN
  SELECT COUNT(*)
  INTO count
  FROM public.photos
  WHERE gallery_id = $1
  AND is_favorite = true
  AND deleted_at IS NULL;

  RETURN count;
END;
$$ LANGUAGE plpgsql;

-- FASE 6: Trigger para atualizar updated_at em galleries
CREATE OR REPLACE FUNCTION public.update_gallery_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS galleries_update_timestamp ON public.galleries;
CREATE TRIGGER galleries_update_timestamp
BEFORE UPDATE ON public.galleries
FOR EACH ROW
EXECUTE FUNCTION public.update_gallery_timestamp();

-- FASE 7: Log de ações administrativas
CREATE TABLE IF NOT EXISTS public.admin_action_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_id uuid REFERENCES auth.users(id),
  action_type text NOT NULL, -- 'generate_qr', 'toggle_share', 'change_cover', 'delete', 'download'
  target_type text NOT NULL, -- 'gallery'
  target_id uuid NOT NULL,
  details jsonb,
  created_at timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_action_logs_admin ON public.admin_action_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_action_logs_target ON public.admin_action_logs(target_type, target_id);

-- FASE 8: Função para registrar ações administrativas
CREATE OR REPLACE FUNCTION public.log_admin_action(
  p_action_type text,
  p_target_type text,
  p_target_id uuid,
  p_details jsonb DEFAULT NULL
)
RETURNS uuid AS $$
DECLARE
  log_id uuid;
BEGIN
  INSERT INTO public.admin_action_logs(admin_id, action_type, target_type, target_id, details)
  VALUES (auth.uid(), p_action_type, p_target_type, p_target_id, p_details)
  RETURNING id INTO log_id;

  RETURN log_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- RESUMO DAS MUDANÇAS
-- ============================================================
SELECT '✅ Sharing flags adicionadas' as status
UNION ALL
SELECT '✅ Cover image columns adicionadas'
UNION ALL
SELECT '✅ Soft delete columns adicionadas'
UNION ALL
SELECT '✅ Download history table criada'
UNION ALL
SELECT '✅ Admin action logs criada'
UNION ALL
SELECT '✅ Helper functions criadas'
UNION ALL
SELECT '✅ Triggers criados'
UNION ALL
SELECT '✅ Admin Gallery Actions prontas para implementação';
