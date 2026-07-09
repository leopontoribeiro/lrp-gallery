# 🎬 FEATURE: Grupos de Galerias

**Status**: Design/Planejamento  
**Prioridade**: Alta  
**Scope**: Nova funcionalidade admin + DB + Compartilhamento

---

## 📋 **REQUISITO DO USUÁRIO**

### Cenário Real: Leandro Rosadas - 6 Dias de Eventos

```
Leandro Rosadas - Eventos de Entrega JUL/26 [CAPA]
├── Evento - Dia 1 - 01/07 [Galeria]
├── Evento - Dia 2 - 02/07 [Galeria]
├── Evento - Dia 3 - 03/07 [Galeria]
├── Evento - Dia 4 - 04/07 [Galeria]
├── Evento - Dia 5 - 05/07 [Galeria]
└── Evento - Dia 6 - 06/07 [Galeria]
```

### Dois Tipos de Link

1. **Link do Grupo** (para Leandro Rosadas)
   - Acesso: Todas as 6 galerias
   - View: Pasta com 6 galerias + capa do grupo

2. **Link da Galeria Individual** (para participante de 1 dia)
   - Acesso: Apenas galeria do seu dia
   - View: Fotos do evento específico

---

## 🗄️ **ARQUITETURA DE DATABASE**

### Tabela: `gallery_groups`
```sql
CREATE TABLE public.gallery_groups (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  cover_image_url text,           -- Capa do grupo (upload de foto)
  cover_image_hash text,          -- SHA-256 para deduplicação
  total_photos integer DEFAULT 0, -- Count das fotos em todas as galerias filhas
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now(),
  deleted_at timestamp,
  deleted_by uuid REFERENCES auth.users(id)
);

CREATE INDEX idx_gallery_groups_client ON gallery_groups(client_id);
CREATE INDEX idx_gallery_groups_owner ON gallery_groups(owner_id);
CREATE INDEX idx_gallery_groups_deleted ON gallery_groups(deleted_at) WHERE deleted_at IS NULL;
```

### Relação: `galleries` → `gallery_groups`
```sql
ALTER TABLE public.galleries 
ADD COLUMN IF NOT EXISTS gallery_group_id uuid REFERENCES gallery_groups(id) ON DELETE CASCADE;

CREATE INDEX idx_galleries_group ON galleries(gallery_group_id);
```

---

## 🔐 **RLS POLICIES**

### Gallery Groups
```sql
-- Owner pode ler seus grupos
CREATE POLICY "Users can read own gallery groups" ON gallery_groups
FOR SELECT USING (owner_id = auth.uid());

-- Owner pode criar grupos
CREATE POLICY "Users can create gallery groups" ON gallery_groups
FOR INSERT WITH CHECK (owner_id = auth.uid());

-- Owner pode editar/deletar seus grupos
CREATE POLICY "Users can update own gallery groups" ON gallery_groups
FOR UPDATE USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Users can delete own gallery groups" ON gallery_groups
FOR DELETE USING (owner_id = auth.uid());
```

### Galleries (atualizar para grupo)
```sql
-- Quando galeria está em grupo, herda permissões do grupo
CREATE POLICY "Access gallery via group or direct" ON galleries
FOR SELECT USING (
  gallery_group_id IS NULL  -- Galeria standalone
  OR 
  (gallery_group_id IS NOT NULL AND
    EXISTS (
      SELECT 1 FROM gallery_groups gg
      WHERE gg.id = galleries.gallery_group_id
      AND gg.owner_id = auth.uid()
    ))
);
```

---

## 🎨 **UI/UX - PAINEL ADMIN**

### Tela Inicial (Após Login)
```
┌─────────────────────────────────────────────────────┐
│ ADMIN - LRP GALLERY                          [Logout]│
├─────────────────────────────────────────────────────┤
│                                                     │
│  [+ NOVA GALERIA]      [+ GRUPO DE GALERIAS]        │
│                                                     │
├─────────────────────────────────────────────────────┤
│ GALERIAS RECENTES                                   │
│                                                     │
│ Leandro Rosadas - Eventos JUL/26 [GRUPO]           │
│   [⋮ Ações ▼]                                      │
│   ├─ Dia 1 - 01/07 (24 fotos)                      │
│   │  [⋮ Ações ▼]                                   │
│   ├─ Dia 2 - 02/07 (18 fotos)                      │
│   │  [⋮ Ações ▼]                                   │
│   └─ [+] Adicionar galeria ao grupo                │
│                                                     │
│ Evento Individual - 08/07 (45 fotos)               │
│   [⋮ Ações ▼]                                      │
│                                                     │
└─────────────────────────────────────────────────────┘
```

### Menu de Ações (Dropdown [⋮])

**Para Grupo de Galerias:**
```
┌─────────────────────────────────┐
│ [QR] Gerar QR Code do Grupo    │
│ [📤] Compartilhamento:          │
│      ☑ Ativo  ☐ Desativar      │
│ [📸] Mudar Capa                 │
│ [⬇] Baixar Tudo (ZIP)          │
│ [⭐] Baixar Favoritas (ZIP)     │
│ [🗑] Apagar Grupo               │
└─────────────────────────────────┘
```

**Para Galeria Individual:**
```
┌─────────────────────────────────┐
│ [QR] Gerar QR Code              │
│ [📤] Compartilhamento:          │
│      ☑ Ativo  ☐ Desativar      │
│ [📸] Mudar Capa                 │
│ [⬇] Baixar Tudo (ZIP)          │
│ [⭐] Baixar Favoritas (ZIP)     │
│ [🗑] Apagar Galeria             │
└─────────────────────────────────┘
```

---

## 📝 **FLUXO 1: CRIAR NOVA GALERIA** (Mantém atual)

```
[+ NOVA GALERIA]
  ↓
Formulário:
  - Cliente: [Dropdown]
  - Evento: [Input]
  - Data: [Date picker]
  - Grupo: [Opcional - Dropdown de grupos existentes]
  ↓
Criar compartilhamento automático
  ↓
Gerar QR Code
  ↓
Link pronto
```

---

## 📦 **FLUXO 2: CRIAR GRUPO DE GALERIAS** (Novo)

```
[+ GRUPO DE GALERIAS]
  ↓
Step 1: Informações do Grupo
  - Cliente: [Dropdown]
  - Nome do Grupo: [Input] (ex: "Leandro Rosadas - Eventos JUL/26")
  - Descrição: [Textarea - Opcional]
  ↓
Step 2: Upload Capa
  - [Drop zone ou input file]
  - Preview
  - SHA-256 hash (deduplicação)
  ↓
Step 3: Adicionar Galerias
  - Opção A: Criar novas galerias dentro do grupo
    [+ Adicionar evento ao grupo]
      └─ Nome evento, Data, Upload fotos → Cria galeria filha
  - Opção B: Mover galerias existentes para grupo
    [Selecionar galerias] → Mover para este grupo
  ↓
Step 4: Gerar Link do Grupo
  - Link público para todas as galerias do grupo
  - QR Code do grupo
  ↓
Criar compartilhamento
  ↓
Pronto
```

---

## 🔗 **TIPOS DE LINK DE COMPARTILHAMENTO**

### Link do Grupo
```
https://seu-dominio/gallery/group/{GROUP_UUID}
  ↓
Exibe:
  - Capa do grupo (imagem grande)
  - Nome do grupo
  - 6 galerias abaixo (em cards)
  - QR code individual por galeria
  - Botão "Ver fotos" por galeria
```

### Link da Galeria Individual (dentro do grupo)
```
https://seu-dominio/gallery/share/{GALLERY_UUID}
  ↓
Exibe:
  - Fotos do evento específico
  - Breadcrumb: "Voltar ao Grupo" (se tiver grupo_id)
  - Apenas as fotos deste dia
```

---

## 🔌 **API ENDPOINTS**

### Compartilhamento (Sharing Toggle)

```
PATCH /admin-api/gallery/{galleryId}/sharing
PATCH /admin-api/group/{groupId}/sharing

Body: { enabled: boolean }

Response:
{
  "id": "uuid",
  "sharing_enabled": true,
  "share_token": "uuid-abc123",
  "share_url": "https://seu-dominio/gallery/share/uuid-abc123"
}

Lógica:
- Se enable=true: Criar share_link se não existir
- Se enable=false: Marcar share_link como inactive
- Atualizar updated_at
```

### Mudar Capa

```
POST /admin-api/gallery/{galleryId}/cover
POST /admin-api/group/{groupId}/cover

FormData:
- cover_image: File (multipart/form-data)

Workflow:
1. Validar arquivo (5MB max, MIME type)
2. Calcular SHA-256
3. Verificar deduplicação (se existe mesmo hash)
4. Upload para R2/S3
5. Delete cover anterior
6. Update DB com cover_image_url + cover_image_hash
7. Retornar nova URL

Response:
{
  "cover_url": "https://r2.seu-dominio/covers/uuid.jpg",
  "cover_hash": "sha256hash"
}
```

### Baixar Fotos (ZIP)

```
POST /admin-api/gallery/{galleryId}/download
POST /admin-api/group/{groupId}/download

Query: ?favorites=false (default) | ?favorites=true

Workflow:
1. Verificar ownership (RLS)
2. Se grupo: Listar todas galerias filhas
3. Se galeria: Usar apenas esta
4. Se favorites=true: Filtrar WHERE is_favorite = true
5. Gerar lista de URLs de fotos
6. Criar ZIP em memória
7. Upload do ZIP para storage temporário
8. Retornar URL de download (expira em 24h)

Response:
{
  "download_url": "https://seu-dominio/temp/downloads/uuid-zip-abc123.zip",
  "expires_at": "2026-07-09T19:00:00Z",
  "file_size_mb": 145.3,
  "total_photos": 87,
  "included": "all" | "favorites"
}
```

### Apagar Galeria/Grupo

```
DELETE /admin-api/gallery/{galleryId}
DELETE /admin-api/group/{groupId}

Workflow (Soft Delete):
1. Verificar ownership
2. UPDATE deleted_at = now()
3. UPDATE deleted_by = auth.uid()
4. Marcar share_links como inactive
5. NÃO deletar fotos (apenas marcar galeria como deleted)
6. Retornar sucesso

Se quiser hard delete (permanente):
Query: ?permanent=true
- Deletar shares
- Deletar fotos do storage
- Deletar da BD
- Não reverter!
```

---

## 💾 **MIGRATIONS SUPABASE**

```sql
-- FASE 1: Criar tabela gallery_groups
CREATE TABLE public.gallery_groups (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id uuid REFERENCES public.clients(id) ON DELETE CASCADE NOT NULL,
  owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  description text,
  cover_image_url text,
  cover_image_hash text UNIQUE,
  total_photos integer DEFAULT 0,
  created_at timestamp DEFAULT now(),
  updated_at timestamp DEFAULT now(),
  deleted_at timestamp,
  deleted_by uuid REFERENCES auth.users(id)
);

CREATE INDEX idx_gallery_groups_client ON public.gallery_groups(client_id);
CREATE INDEX idx_gallery_groups_owner ON public.gallery_groups(owner_id);
CREATE INDEX idx_gallery_groups_deleted ON public.gallery_groups(deleted_at);

-- FASE 2: Adicionar gallery_group_id à tabela galleries
ALTER TABLE public.galleries 
ADD COLUMN IF NOT EXISTS gallery_group_id uuid REFERENCES public.gallery_groups(id) ON DELETE SET NULL;

CREATE INDEX idx_galleries_group ON public.galleries(gallery_group_id);

-- FASE 3: RLS Policies
ALTER TABLE public.gallery_groups ENABLE ROW LEVEL SECURITY;

-- Leitura
CREATE POLICY "Users can read own gallery groups" ON public.gallery_groups
FOR SELECT USING (owner_id = auth.uid());

-- Criar
CREATE POLICY "Users can create gallery groups" ON public.gallery_groups
FOR INSERT WITH CHECK (owner_id = auth.uid());

-- Atualizar
CREATE POLICY "Users can update own gallery groups" ON public.gallery_groups
FOR UPDATE USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

-- Deletar
CREATE POLICY "Users can delete own gallery groups" ON public.gallery_groups
FOR DELETE USING (owner_id = auth.uid());

-- FASE 4: Trigger para calcular total_photos automaticamente
CREATE OR REPLACE FUNCTION public.update_group_photo_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.gallery_groups
  SET total_photos = (
    SELECT COALESCE(SUM(photos_count), 0)
    FROM public.galleries
    WHERE gallery_group_id = COALESCE(NEW.gallery_group_id, OLD.gallery_group_id)
  )
  WHERE id = COALESCE(NEW.gallery_group_id, OLD.gallery_group_id);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS galleries_update_group_count ON public.galleries;
CREATE TRIGGER galleries_update_group_count
AFTER INSERT OR UPDATE OR DELETE ON public.galleries
FOR EACH ROW
EXECUTE FUNCTION public.update_group_photo_count();
```

---

## 🖥️ **FRONTEND CHANGES**

### Admin Panel (`admin-clients-events-v2.js`)
```javascript
// Novo estado
state = {
  mode: 'gallery' | 'group',      // Modo atual
  galleries: [],
  groups: [],
  selectedGroup: null,
}

// Novo método - Criar Grupo
async createGroup(groupData) {
  // POST /admin-api/groups
  // groupData: { client_id, name, description, cover_image }
  // Retorna: { id, name, cover_url, share_token }
}

// Novo método - Adicionar galeria ao grupo
async addGalleryToGroup(groupId, galleryData) {
  // POST /admin-api/groups/{groupId}/galleries
  // Cria galeria dentro do grupo
}

// Novo método - Renderizar card
async renderGroupCard(group) {
  // Renderiza card do grupo com:
  // - Capa do grupo
  // - Nome
  // - N galerias dentro
  // - Menu de ações [⋮]
}

// ============= AÇÕES DO MENU [⋮] =============

// 1. Gerar QR Code
async generateQRCode(galeryId, groupId = null) {
  const url = groupId 
    ? `/gallery/group/${groupId}` 
    : `/gallery/share/${galleryId}`;
  // Usar QRServer API ou library QR.js
  // Exibir em modal + opção de download
}

// 2. Habilitar/Desabilitar Compartilhamento
async toggleSharing(galleryId, groupId = null) {
  const target = groupId ? 'group' : 'gallery';
  // PATCH /admin-api/${target}/${id}/sharing
  // { enabled: boolean }
  // Se desabilitar: invalidar share_tokens existentes
  // Se habilitar: gerar novo share_token
}

// 3. Mudar Capa
async changeCover(galleryId, groupId = null, newImageFile) {
  const target = groupId ? 'group' : 'gallery';
  const formData = new FormData();
  formData.append('cover_image', newImageFile);
  // POST /admin-api/${target}/${id}/cover
  // Upload → Delete old → Update URL
  // SHA-256 hash para deduplicação
}

// 4. Apagar Galeria/Grupo
async deleteGallery(galleryId, groupId = null) {
  const target = groupId ? 'group' : 'gallery';
  // DELETE /admin-api/${target}/${id}
  // Soft delete: set deleted_at + deleted_by
  // Confirmação: "Apagar definitivamente?"
}

// 5. Baixar Tudo (ZIP)
async downloadAllPhotos(galleryId, groupId = null) {
  const target = groupId ? 'group' : 'gallery';
  // POST /admin-api/${target}/${id}/download
  // Retorna link do arquivo ZIP pronto
  // Backend: Gera ZIP com todas as fotos
}

// 6. Baixar Favoritas (ZIP)
async downloadFavorites(galleryId, groupId = null) {
  const target = groupId ? 'group' : 'gallery';
  // POST /admin-api/${target}/${id}/download-favorites
  // WHERE is_favorite = true
  // Retorna ZIP com só as favoritas
}
```

### UI Component: Dropdown de Ações
```javascript
class GalleryActions {
  constructor(galleryId, groupId = null) {
    this.galleryId = galleryId;
    this.groupId = groupId;
  }
  
  renderMenu() {
    return `
      <div class="actions-menu">
        <button onclick="admin.generateQRCode('${this.galleryId}', '${this.groupId}')">
          [QR] Gerar QR Code
        </button>
        <button onclick="admin.toggleSharing('${this.galleryId}', '${this.groupId}')">
          [📤] Compartilhamento: ${this.isSharing ? '✓ Ativo' : '✗ Desativo'}
        </button>
        <button onclick="admin.changeCover('${this.galleryId}', '${this.groupId}')">
          [📸] Mudar Capa
        </button>
        <button onclick="admin.downloadAllPhotos('${this.galleryId}', '${this.groupId}')">
          [⬇] Baixar Tudo (ZIP)
        </button>
        <button onclick="admin.downloadFavorites('${this.galleryId}', '${this.groupId}')">
          [⭐] Baixar Favoritas (ZIP)
        </button>
        <button class="danger" onclick="admin.deleteGallery('${this.galleryId}', '${this.groupId}')">
          [🗑] Apagar
        </button>
      </div>
    `;
  }
}
```

### Gallery View (`gallery.html`)
```javascript
// Detectar se é grupo ou galeria individual
if (urlParams.group) {
  // Renderizar como grupo
  // Exibir todas as galerias filhas
  // Mostrar capa do grupo
} else {
  // Renderizar como galeria individual (atual)
  // Se tem gallery_group_id, mostrar link "Voltar ao grupo"
}
```

---

## 📊 **MATRIZ DE ACESSO**

| Usuário | Link Grupo | Link Galeria (grupo) | Link Galeria (solo) |
|---------|-----------|----------------------|---------------------|
| Leandro (Owner) | ✅ Vê tudo | ✅ Vê galeria | ✅ Vê galeria |
| Participante Dia 1 | ❌ Sem acesso | ✅ Vê seu dia | N/A |
| Admin | ✅ Edita tudo | ✅ Edita | ✅ Edita |

---

## 📱 **SHARE LINKS** (Nova estrutura)

### Tabela: `gallery_group_shares` (nova)
```sql
CREATE TABLE public.gallery_group_shares (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  gallery_group_id uuid REFERENCES public.gallery_groups(id) ON DELETE CASCADE,
  token uuid DEFAULT uuid_generate_v4() UNIQUE,
  access_type text DEFAULT 'view',  -- view, download
  expires_at timestamp,
  created_at timestamp DEFAULT now(),
  views integer DEFAULT 0
);
```

---

## 🎯 **IMPLEMENTAÇÃO - FASES**

### Fase 1: Backend (BD + RLS + APIs)
- [ ] Criar tabela gallery_groups
- [ ] Adicionar gallery_group_id a galleries
- [ ] Implementar RLS policies
- [ ] Trigger para total_photos
- [ ] **API Endpoints:**
  - [ ] POST /admin-api/groups (criar grupo)
  - [ ] PATCH /admin-api/gallery/{id}/sharing (toggle compartilhamento)
  - [ ] PATCH /admin-api/group/{id}/sharing
  - [ ] POST /admin-api/gallery/{id}/cover (mudar capa)
  - [ ] POST /admin-api/group/{id}/cover
  - [ ] DELETE /admin-api/gallery/{id} (soft delete)
  - [ ] DELETE /admin-api/group/{id}
  - [ ] POST /admin-api/gallery/{id}/download (baixar ZIP)
  - [ ] POST /admin-api/group/{id}/download
  - [ ] POST /admin-api/gallery/{id}/download-favorites
  - [ ] POST /admin-api/group/{id}/download-favorites

### Fase 2: Admin UI - Criar Grupo
- [ ] Adicionar botão "+ GRUPO DE GALERIAS"
- [ ] Formulário de criação de grupo (multi-step)
- [ ] Upload de capa
- [ ] Adicionar galerias ao grupo
- [ ] Renderizar cards de grupos

### Fase 3: Admin UI - Menu de Ações
- [ ] Dropdown [⋮] para cada galeria
- [ ] Dropdown [⋮] para cada grupo
- [ ] **Ações implementadas:**
  - [ ] [QR] Gerar QR Code
  - [ ] [📤] Toggle Compartilhamento
  - [ ] [📸] Mudar Capa (upload novo)
  - [ ] [🗑] Apagar (soft delete)
  - [ ] [⬇] Baixar Tudo (ZIP - todas as fotos)
  - [ ] [⭐] Baixar Favoritas (ZIP - só favoritas)

### Fase 4: Gallery View
- [ ] Renderizar grupo com galerias filhas
- [ ] Breadcrumb "Voltar ao grupo"
- [ ] RLS para acesso (só ver galerias permitidas)

### Fase 5: Share Links & QR
- [ ] Link do grupo (dynamic: /gallery/group/{uuid})
- [ ] QR Code do grupo
- [ ] QR Code individual por galeria dentro do grupo
- [ ] QR Code in-memory generator (não persistir)

### Fase 6: Funcionalidades Avançadas
- [ ] ZIP generation (em background job se > 500MB)
- [ ] Upload de múltiplas galerias por grupo
- [ ] Reorder galerias dentro do grupo
- [ ] Copy/Move galeria entre grupos
- [ ] Bulk download (múltiplos grupos)

### Fase 7: Testes
- [ ] Testar acesso (owner vs participant)
- [ ] Testar RLS policies
- [ ] Testar upload de capa (deduplicação)
- [ ] Testar links de compartilhamento
- [ ] Testar ZIP generation
- [ ] Testar soft delete
- [ ] Testar toggle sharing

---

## 🔗 **EXEMPLOS DE URLS**

```
Grupo:
https://seu-dominio/gallery/group/a1b2c3d4-e5f6-7890-abcd-ef1234567890

Galeria 1 (dentro do grupo):
https://seu-dominio/gallery/share/x9y8z7w6-v5u4-t3s2-r1q0-ponmlkjihgf

Galeria Solo:
https://seu-dominio/gallery/share/m1n2o3p4-q5r6-s7t8-u9v0-wxyzabcdefgh
```

---

## 📝 **NOTAS**

- Manter compatibilidade com galerias standalone (sem grupo)
- SHA-256 para deduplicação de capas (evitar uploads duplicados)
- Total de fotos do grupo = SUM de fotos das galerias filhas
- RLS garante que só owner pode deletar grupo
- Participants veem apenas galerias que têm acesso

---

**Status**: ✅ Design completo - Pronto para desenvolvimento  
**Próximo passo**: Implementar Fase 1 (Backend)

