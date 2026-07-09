-- ============================================================
-- MIGRATION: Gallery Groups Support
-- Suporte para organizar galerias em grupos
-- ============================================================

-- FASE 1: Criar tabela gallery_groups
CREATE TABLE IF NOT EXISTS public.gallery_groups (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  description text,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  sharing_enabled boolean DEFAULT true,
  cover_image_url text,
  cover_image_hash text,
  deleted_at timestamp,
  deleted_by uuid REFERENCES auth.users(id),
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now()
);

-- FASE 2: Adicionar coluna gallery_group_id em galleries
ALTER TABLE public.galleries
ADD COLUMN IF NOT EXISTS gallery_group_id uuid REFERENCES public.gallery_groups(id) ON DELETE SET NULL;

-- FASE 3: Criar índices para performance
CREATE INDEX IF NOT EXISTS idx_gallery_groups_owner ON public.gallery_groups(owner_id);
CREATE INDEX IF NOT EXISTS idx_gallery_groups_deleted ON public.gallery_groups(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_gallery_groups_sharing ON public.gallery_groups(sharing_enabled);
CREATE INDEX IF NOT EXISTS idx_galleries_group ON public.galleries(gallery_group_id);

-- FASE 4: RLS Policies para gallery_groups
ALTER TABLE public.gallery_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own gallery groups" ON public.gallery_groups;
CREATE POLICY "Users can read own gallery groups" ON public.gallery_groups
FOR SELECT USING (
  owner_id = auth.uid() AND deleted_at IS NULL
);

DROP POLICY IF EXISTS "Users can create gallery groups" ON public.gallery_groups;
CREATE POLICY "Users can create gallery groups" ON public.gallery_groups
FOR INSERT WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Users can update own gallery groups" ON public.gallery_groups;
CREATE POLICY "Users can update own gallery groups" ON public.gallery_groups
FOR UPDATE USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own gallery groups" ON public.gallery_groups;
CREATE POLICY "Users can delete own gallery groups" ON public.gallery_groups
FOR DELETE USING (owner_id = auth.uid());

-- FASE 5: Trigger para atualizar updated_at em gallery_groups
CREATE OR REPLACE FUNCTION public.update_gallery_group_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS gallery_groups_update_timestamp ON public.gallery_groups;
CREATE TRIGGER gallery_groups_update_timestamp
BEFORE UPDATE ON public.gallery_groups
FOR EACH ROW
EXECUTE FUNCTION public.update_gallery_group_timestamp();

-- FASE 6: Function para contar galerias por grupo
CREATE OR REPLACE FUNCTION public.count_galleries_in_group(group_id uuid)
RETURNS integer AS $$
BEGIN
  RETURN COALESCE((
    SELECT COUNT(*)
    FROM public.galleries
    WHERE gallery_group_id = $1 AND deleted_at IS NULL
  ), 0);
END;
$$ LANGUAGE plpgsql;

-- FASE 7: Function para calcular tamanho total do grupo
CREATE OR REPLACE FUNCTION public.get_group_total_size(group_id uuid)
RETURNS bigint AS $$
DECLARE
  total_size bigint;
BEGIN
  SELECT COALESCE(SUM(CAST(g.file_size AS bigint)), 0)
  INTO total_size
  FROM public.galleries gal
  JOIN public.photos g ON g.gallery_id = gal.id
  WHERE gal.gallery_group_id = $1 AND gal.deleted_at IS NULL AND g.deleted_at IS NULL;

  RETURN total_size;
END;
$$ LANGUAGE plpgsql;

-- FASE 8: Log de ações em grupos
-- Usa a mesma tabela admin_action_logs existente
-- Apenas adiciona logs para ações de grupo:
-- - create_group
-- - update_group
-- - delete_group
-- - add_gallery_to_group
-- - remove_gallery_from_group

-- ============================================================
-- RESUMO DAS MUDANÇAS
-- ============================================================
SELECT '✅ Gallery Groups table criada' as status
UNION ALL
SELECT '✅ gallery_group_id column adicionada a galleries'
UNION ALL
SELECT '✅ Índices criados para performance'
UNION ALL
SELECT '✅ RLS Policies configuradas'
UNION ALL
SELECT '✅ Trigger para updated_at criado'
UNION ALL
SELECT '✅ Functions para contagem e tamanho criadas'
UNION ALL
SELECT '✅ Suporte completo a Groups implementado';
