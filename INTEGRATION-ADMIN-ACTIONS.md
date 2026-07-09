# 🔧 INTEGRAÇÃO - Admin Gallery Actions

**Arquivos criados**:
- ✅ `admin-gallery-actions.js` - Implementação das 6 ações
- ✅ `admin-gallery-actions.css` - Estilos dos modals
- ✅ `migration-admin-gallery-actions.sql` - Migrations Supabase

---

## ✅ **CHECKLIST DE INTEGRAÇÃO**

### 1. HTML - Incluir scripts e CSS
```html
<!-- Em admin.html, antes de </head> -->
<link rel="stylesheet" href="admin-gallery-actions.css">

<!-- Antes de </body> -->
<script src="admin-gallery-actions.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
```

### 2. JavaScript - Inicializar no admin panel
```javascript
// Em admin-clients-events-v2.js, após carregar
document.addEventListener('DOMContentLoaded', () => {
  initAdminActions(supabaseClient, adminPanel);
});
```

### 3. HTML - Adicionar botão de ações
```html
<!-- Para cada galeria/grupo, adicionar: -->
<button class="actions-dropdown" onclick="event.stopPropagation(); this.parentElement.appendChild(adminActions.renderActionsMenu(galleryId, groupId))"></button>

<!-- Ou usar template -->
<div class="gallery-card">
  <img src="cover_url" />
  <h3>Nome da Galeria</h3>
  <div class="card-actions">
    ${adminActions.renderActionsMenu(galleryId, groupId)}
  </div>
</div>
```

### 4. Supabase - Executar migration
```bash
# No Supabase SQL Editor, copiar e executar:
# Conteúdo de: migration-admin-gallery-actions.sql
```

### 5. Backend API - Criar endpoints
```javascript
// Node.js/Express - criar arquivo backend-admin-api.js
// Endpoints necessários:
// POST /admin-api/download
// PATCH /admin-api/gallery/{id}/sharing
// PATCH /admin-api/group/{id}/sharing
// POST /admin-api/gallery/{id}/cover
// POST /admin-api/group/{id}/cover
// DELETE /admin-api/gallery/{id}
// DELETE /admin-api/group/{id}
```

---

## 📋 **6 AÇÕES IMPLEMENTADAS**

### 1. Gerar QR Code
- Função: `adminActions.generateQRCode(galleryId, groupId)`
- Modal com QR code em 300x300px
- Botões: Download PNG, Copiar Link, Fechar

### 2. Toggle Compartilhamento
- Função: `adminActions.toggleSharing(galleryId, groupId)`
- Alterna: ativo ↔ desativo
- Invalida share_links ao desativar

### 3. Mudar Capa
- Função: `adminActions.changeCover(galleryId, groupId)`
- Upload: drag & drop ou file picker
- Validação: 5MB max, JPEG/PNG
- Preview antes de salvar

### 4. Apagar Galeria/Grupo
- Função: `adminActions.deleteGallery(galleryId, groupId)`
- Soft delete: deleted_at + deleted_by
- Confirmação obrigatória
- Desativa share_links

### 5. Baixar Tudo (ZIP)
- Função: `adminActions.downloadAllPhotos(galleryId, groupId)`
- Retorna: ZIP com TODAS as fotos
- Info: Total photos, tamanho em MB
- Link válido por 24h

### 6. Baixar Favoritas (ZIP)
- Função: `adminActions.downloadFavorites(galleryId, groupId)`
- Retorna: ZIP com APENAS favoritas
- Se 0 favoritas: mensagem "Nenhuma"
- Link válido por 24h

---

## 🗄️ **DATABASE CHANGES**

### Colunas adicionadas:
- `galleries.sharing_enabled` - boolean
- `galleries.cover_image_url` - text
- `galleries.cover_image_hash` - text
- `galleries.deleted_at` - timestamp
- `galleries.deleted_by` - uuid
- (Mesmas em `gallery_groups`)

### Tabelas criadas:
- `download_history` - Log de downloads
- `admin_action_logs` - Log de ações admin

### Funções criadas:
- `get_gallery_photos_size()` - Tamanho total
- `get_gallery_favorites_count()` - Contador de favoritas
- `get_group_photos_count()` - Contador do grupo
- `log_admin_action()` - Log administrativo

---

## 🚀 **PRÓXIMAS ETAPAS**

### Fase 1: Integração (Agora)
- [ ] Incluir JS e CSS em admin.html
- [ ] Executar migration SQL
- [ ] Inicializar `adminActions` no JS

### Fase 2: Backend API
- [ ] Criar endpoint POST /admin-api/download
- [ ] Criar endpoint PATCH /admin-api/gallery/{id}/sharing
- [ ] Criar endpoint POST /admin-api/gallery/{id}/cover
- [ ] Criar endpoint DELETE /admin-api/gallery/{id}
- [ ] Validação de ownership (RLS)

### Fase 3: Frontend
- [ ] Renderizar dropdown de ações em cada card
- [ ] Estilizar com admin-gallery-actions.css
- [ ] Testes em todos os browsers

### Fase 4: Testes
- [ ] Testar QR code generation
- [ ] Testar toggle compartilhamento
- [ ] Testar upload de capa
- [ ] Testar soft delete
- [ ] Testar ZIP download
- [ ] Testar favoritas

---

## 📝 **NOTAS IMPORTANTES**

1. **QR Code**: Usa biblioteca QR.js (CDN)
2. **ZIP Download**: Backend precisa gerar arquivo (usar library como JSZip ou Server-side)
3. **Storage**: Capas armazenadas em Supabase Storage (`gallery-covers`)
4. **Soft Delete**: Mantém dados, apenas marca como deletado
5. **RLS**: Todas as operações respeitam ownership check
6. **Log**: Todas as ações são registradas em `admin_action_logs`

---

**Status**: Pronto para integração ✅  
**Próximo**: Executar migrations + integrar em admin.html
