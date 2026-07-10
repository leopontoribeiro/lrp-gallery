// ============================================================
// ADMIN GALLERY ACTIONS - 6 Funcionalidades para Galeria/Grupo
// ============================================================

class AdminGalleryActions {
  constructor(supabaseClient, adminPanel) {
    this.supabase = supabaseClient;
    this.admin = adminPanel;
  }

  // ============================================================
  // 1. GERAR QR CODE
  // ============================================================
  async generateQRCode(galleryId, groupId = null) {
    try {
      const type = groupId ? 'group' : 'gallery';
      const id = groupId || galleryId;
      const url = groupId
        ? `/gallery/group/${id}`
        : `/gallery/share/${galleryId}`;

      // Usar QR.js (https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.js)
      const modal = document.createElement('div');
      modal.className = 'modal-qrcode';
      modal.innerHTML = `
        <div class="modal-content">
          <h2>QR Code - ${type === 'group' ? 'Grupo' : 'Galeria'}</h2>
          <div id="qrcode-container"></div>
          <p>URL: ${url}</p>
          <div class="modal-actions">
            <button onclick="adminActions.downloadQRCode('${id}', '${type}')">Baixar PNG</button>
            <button onclick="adminActions.copyToClipboard('${url}')">Copiar Link</button>
            <button onclick="this.closest('.modal-qrcode').remove()">Fechar</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      // Gerar QR code
      setTimeout(() => {
        new QRCode(document.getElementById('qrcode-container'), {
          text: window.location.origin + url,
          width: 300,
          height: 300
        });
      }, 100);

    } catch (error) {
      this.admin.showError('Erro ao gerar QR code: ' + error.message);
    }
  }

  downloadQRCode(id, type) {
    const canvas = document.querySelector('#qrcode-container canvas');
    if (!canvas) return;

    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `qrcode-${type}-${id}.png`;
    link.click();
  }

  copyToClipboard(text) {
    navigator.clipboard.writeText(window.location.origin + text).then(() => {
      alert('Link copiado para área de transferência');
    });
  }

  // ============================================================
  // 2. TOGGLE COMPARTILHAMENTO
  // ============================================================
  async toggleSharing(galleryId, groupId = null) {
    try {
      const type = groupId ? 'group' : 'gallery';
      const id = groupId || galleryId;

      // Obter status atual
      const { data, error } = await this.supabase
        .from(`${type}s`)
        .select('sharing_enabled, share_token')
        .eq('id', id)
        .single();

      if (error) throw error;

      const currentStatus = data.sharing_enabled;
      const newStatus = !currentStatus;

      // Atualizar no banco
      const { error: updateError } = await this.supabase
        .from(`${type}s`)
        .update({
          sharing_enabled: newStatus,
          updated_at: new Date()
        })
        .eq('id', id);

      if (updateError) throw updateError;

      // Atualizar UI
      const statusText = newStatus ? 'Ativo' : 'Desativo';
      this.admin.showSuccess(`Compartilhamento agora: ${statusText}`);

      // Recarregar lista
      this.admin.loadGalleries();

    } catch (error) {
      this.admin.showError('Erro ao alterar compartilhamento: ' + error.message);
    }
  }

  // ============================================================
  // 3. MUDAR CAPA
  // ============================================================
  async changeCover(galleryId, groupId = null) {
    try {
      const type = groupId ? 'group' : 'gallery';
      const id = groupId || galleryId;

      const modal = document.createElement('div');
      modal.className = 'modal-cover';
      modal.innerHTML = `
        <div class="modal-content">
          <h2>Mudar Capa</h2>
          <div class="cover-upload-area" ondrop="adminActions.handleCoverDrop(event, '${id}', '${type}')"
               ondragover="event.preventDefault()"
               ondragleave="event.preventDefault()">
            <p>Arraste uma imagem aqui ou clique para selecionar</p>
            <input type="file" id="cover-input" accept="image/*" onchange="adminActions.uploadCover(this, '${id}', '${type}')" style="display:none;">
            <button onclick="document.getElementById('cover-input').click()">Selecionar Imagem</button>
          </div>
          <div id="cover-preview"></div>
          <div class="modal-actions">
            <button onclick="this.closest('.modal-cover').remove()">Cancelar</button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

    } catch (error) {
      this.admin.showError('Erro ao abrir upload de capa: ' + error.message);
    }
  }

  async handleCoverDrop(event, id, type) {
    event.preventDefault();
    const file = event.dataTransfer.files[0];
    if (file) await this.uploadCover({ files: [file] }, id, type);
  }

  async uploadCover(inputElement, id, type) {
    try {
      const file = inputElement.files[0];
      if (!file) return;

      // Validar
      if (file.size > 5 * 1024 * 1024) {
        throw new Error('Arquivo deve ter no máximo 5MB');
      }
      if (!['image/jpeg', 'image/png'].includes(file.type)) {
        throw new Error('Apenas JPEG e PNG são permitidos');
      }

      // Preview
      const preview = document.getElementById('cover-preview');
      const reader = new FileReader();
      reader.onload = (e) => {
        preview.innerHTML = `<img src="${e.target.result}" style="max-width:300px;"/>`;
      };
      reader.readAsDataURL(file);

      // Upload para Supabase Storage
      const filePath = `covers/${type}/${id}/${Date.now()}-${file.name}`;
      const { error: uploadError, data } = await this.supabase
        .storage
        .from('gallery-covers')
        .upload(filePath, file, { upsert: true });

      if (uploadError) throw uploadError;

      // Obter URL pública
      const { data: publicUrl } = this.supabase
        .storage
        .from('gallery-covers')
        .getPublicUrl(filePath);

      // Atualizar no banco
      const { error: updateError } = await this.supabase
        .from(`${type}s`)
        .update({
          cover_image_url: publicUrl.publicUrl,
          updated_at: new Date()
        })
        .eq('id', id);

      if (updateError) throw updateError;

      this.admin.showSuccess('Capa atualizada com sucesso');
      document.querySelector('.modal-cover')?.remove();
      this.admin.loadGalleries();

    } catch (error) {
      this.admin.showError('Erro ao atualizar capa: ' + error.message);
    }
  }

  // ============================================================
  // 4. APAGAR GALERIA/GRUPO
  // ============================================================
  async deleteGallery(galleryId, groupId = null) {
    try {
      const type = groupId ? 'grupo' : 'galeria';
      const id = groupId || galleryId;
      const table = groupId ? 'gallery_groups' : 'galleries';

      const confirmed = confirm(`Tem certeza que deseja apagar esta ${type}?\n\nEsta ação não pode ser revertida.`);
      if (!confirmed) return;

      // Soft delete
      const { error } = await this.supabase
        .from(table)
        .update({
          deleted_at: new Date(),
          deleted_by: (await this.supabase.auth.getUser()).data.user.id
        })
        .eq('id', id);

      if (error) throw error;

      // Desativar compartilhamentos
      await this.supabase
        .from('share_links')
        .update({ active: false })
        .eq(groupId ? 'gallery_group_id' : 'gallery_id', id);

      this.admin.showSuccess(`${type} deletada com sucesso`);
      this.admin.loadGalleries();

    } catch (error) {
      this.admin.showError('Erro ao deletar: ' + error.message);
    }
  }

  // ============================================================
  // 5. BAIXAR TODAS AS FOTOS (ZIP)
  // ============================================================
  async downloadAllPhotos(galleryId, groupId = null) {
    try {
      const type = groupId ? 'group' : 'gallery';
      const id = groupId || galleryId;

      this.admin.showLoading('Preparando download...');

      const response = await fetch('/admin-api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          id,
          favorites: false
        })
      });

      if (!response.ok) throw new Error('Erro ao gerar arquivo');

      const { download_url, file_size_mb, total_photos } = await response.json();

      this.admin.showSuccess(`ZIP pronto: ${total_photos} fotos (${file_size_mb}MB)`);

      const link = document.createElement('a');
      link.href = download_url;
      link.download = `${type}-${id}-fotos.zip`;
      link.click();

    } catch (error) {
      this.admin.showError('Erro ao baixar fotos: ' + error.message);
    }
  }

  // ============================================================
  // 6. BAIXAR APENAS FAVORITAS (ZIP)
  // ============================================================
  async downloadFavorites(galleryId, groupId = null) {
    try {
      const type = groupId ? 'group' : 'gallery';
      const id = groupId || galleryId;

      this.admin.showLoading('Preparando download...');

      const response = await fetch('/admin-api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          id,
          favorites: true
        })
      });

      if (!response.ok) throw new Error('Erro ao gerar arquivo');

      const { download_url, file_size_mb, total_photos } = await response.json();

      if (total_photos === 0) {
        this.admin.showInfo('Nenhuma foto marcada como favorita');
        return;
      }

      this.admin.showSuccess(`ZIP favoritas: ${total_photos} fotos (${file_size_mb}MB)`);

      const link = document.createElement('a');
      link.href = download_url;
      link.download = `${type}-${id}-favoritas.zip`;
      link.click();

    } catch (error) {
      this.admin.showError('Erro ao baixar favoritas: ' + error.message);
    }
  }

  // ============================================================
  // HELPER: Renderizar Menu de Ações
  // ============================================================
  renderActionsMenu(galleryId, groupId = null) {
    const type = groupId ? 'group' : 'gallery';
    return `
      <div class="actions-menu">
        <button class="action-btn" onclick="adminActions.generateQRCode('${galleryId}', '${groupId ? groupId : null}')">
          Gerar QR Code
        </button>
        <button class="action-btn" onclick="adminActions.toggleSharing('${galleryId}', '${groupId ? groupId : null}')">
          Toggle Compartilhamento
        </button>
        <button class="action-btn" onclick="adminActions.changeCover('${galleryId}', '${groupId ? groupId : null}')">
          Mudar Capa
        </button>
        <button class="action-btn" onclick="adminActions.downloadAllPhotos('${galleryId}', '${groupId ? groupId : null}')">
          Baixar Tudo (ZIP)
        </button>
        <button class="action-btn" onclick="adminActions.downloadFavorites('${galleryId}', '${groupId ? groupId : null}')">
          Baixar Favoritas (ZIP)
        </button>
        <button class="action-btn delete" onclick="adminActions.deleteGallery('${galleryId}', '${groupId ? groupId : null}')">
          Apagar
        </button>
      </div>
    `;
  }
}

// ============================================================
// INICIALIZAÇÃO GLOBAL
// ============================================================
let adminActions = null;

function initAdminActions(supabaseClient, context) {
  if (!adminActions) {
    // Criar um mock admin panel com métodos de notificação
    const adminPanel = {
      showSuccess: (msg) => { console.log('✅ ' + msg); alert('✅ ' + msg); },
      showError: (msg) => { console.error('❌ ' + msg); alert('❌ ' + msg); },
      showInfo: (msg) => { console.log('ℹ️ ' + msg); alert('ℹ️ ' + msg); },
      userId: context?.userId || null
    };

    adminActions = new AdminGalleryActions(supabaseClient, adminPanel);
    console.log('✅ Admin Gallery Actions inicializado');
  }
  return adminActions;
}

// Auto-inicializar se document está pronto
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof getSupabase === 'function') {
      try { initAdminActions(getSupabase(), {}); } catch(e) { console.warn('Auto-init Admin Actions falhou:', e); }
    }
  });
}
