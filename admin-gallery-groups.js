// ============================================================
// ADMIN: Gallery Groups Management
// Criar, editar, deletar e organizar grupos de galerias
// ============================================================

class GalleryGroupsAdmin {
  constructor(supabase) {
    this.supabase = supabase;
    this.groups = [];
    this.galleries = [];
    this.currentUser = null;
    this.selectedGroupId = null;
  }

  async init() {
    const { data: { user }, error } = await this.supabase.auth.getUser();
    if (!user || error) {
      console.error('Usuário não autenticado');
      return;
    }
    this.currentUser = user;
    await this.loadGroups();
    await this.loadGalleries();
  }

  async loadGroups() {
    try {
      const { data, error } = await this.supabase
        .from('gallery_groups')
        .select('*')
        .eq('owner_id', this.currentUser.id)
        .eq('deleted_at', null)
        .order('created_at', { ascending: false });

      if (error) throw error;
      this.groups = data || [];
      console.log('✅ Grupos carregados:', this.groups.length);
    } catch (err) {
      console.error('❌ Erro ao carregar grupos:', err);
      this.showError('Erro ao carregar grupos de galerias');
    }
  }

  async loadGalleries() {
    try {
      const { data, error } = await this.supabase
        .from('galleries')
        .select('*')
        .eq('owner_id', this.currentUser.id)
        .eq('deleted_at', null)
        .order('name');

      if (error) throw error;
      this.galleries = data || [];
      console.log('✅ Galerias carregadas:', this.galleries.length);
    } catch (err) {
      console.error('❌ Erro ao carregar galerias:', err);
    }
  }

  async createGroup(groupData) {
    try {
      const { data, error } = await this.supabase
        .from('gallery_groups')
        .insert({
          name: groupData.name,
          description: groupData.description || null,
          owner_id: this.currentUser.id,
          sharing_enabled: true,
          cover_image_url: null
        })
        .select()
        .single();

      if (error) throw error;

      // Log da ação
      await this.supabase.from('admin_action_logs').insert({
        admin_id: this.currentUser.id,
        action_type: 'create_group',
        target_type: 'group',
        target_id: data.id,
        details: { name: groupData.name }
      });

      this.showSuccess(`Grupo "${groupData.name}" criado com sucesso!`);
      await this.loadGroups();
      return data;
    } catch (err) {
      console.error('❌ Erro ao criar grupo:', err);
      this.showError('Erro ao criar grupo de galerias');
      return null;
    }
  }

  async updateGroup(groupId, updateData) {
    try {
      const { data, error } = await this.supabase
        .from('gallery_groups')
        .update(updateData)
        .eq('id', groupId)
        .eq('owner_id', this.currentUser.id)
        .select()
        .single();

      if (error) throw error;

      await this.supabase.from('admin_action_logs').insert({
        admin_id: this.currentUser.id,
        action_type: 'update_group',
        target_type: 'group',
        target_id: groupId,
        details: updateData
      });

      this.showSuccess('Grupo atualizado com sucesso!');
      await this.loadGroups();
      return data;
    } catch (err) {
      console.error('❌ Erro ao atualizar grupo:', err);
      this.showError('Erro ao atualizar grupo');
      return null;
    }
  }

  async deleteGroup(groupId) {
    if (!confirm('Tem certeza que deseja deletar este grupo? (Soft delete - reversível)')) {
      return false;
    }

    try {
      const { error } = await this.supabase
        .from('gallery_groups')
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by: this.currentUser.id
        })
        .eq('id', groupId)
        .eq('owner_id', this.currentUser.id);

      if (error) throw error;

      await this.supabase.from('admin_action_logs').insert({
        admin_id: this.currentUser.id,
        action_type: 'delete_group',
        target_type: 'group',
        target_id: groupId
      });

      this.showSuccess('Grupo deletado com sucesso!');
      await this.loadGroups();
      return true;
    } catch (err) {
      console.error('❌ Erro ao deletar grupo:', err);
      this.showError('Erro ao deletar grupo');
      return false;
    }
  }

  async addGalleryToGroup(groupId, galleryId) {
    try {
      const { error } = await this.supabase
        .from('galleries')
        .update({ gallery_group_id: groupId })
        .eq('id', galleryId)
        .eq('owner_id', this.currentUser.id);

      if (error) throw error;

      await this.supabase.from('admin_action_logs').insert({
        admin_id: this.currentUser.id,
        action_type: 'add_gallery_to_group',
        target_type: 'group',
        target_id: groupId,
        details: { gallery_id: galleryId }
      });

      this.showSuccess('Galeria adicionada ao grupo!');
      await this.loadGalleries();
      return true;
    } catch (err) {
      console.error('❌ Erro ao adicionar galeria ao grupo:', err);
      this.showError('Erro ao adicionar galeria');
      return false;
    }
  }

  async removeGalleryFromGroup(galleryId) {
    try {
      const { error } = await this.supabase
        .from('galleries')
        .update({ gallery_group_id: null })
        .eq('id', galleryId)
        .eq('owner_id', this.currentUser.id);

      if (error) throw error;

      this.showSuccess('Galeria removida do grupo!');
      await this.loadGalleries();
      return true;
    } catch (err) {
      console.error('❌ Erro ao remover galeria:', err);
      this.showError('Erro ao remover galeria');
      return false;
    }
  }

  renderUI() {
    return `
      <div style="display: grid; grid-template-columns: 280px 1fr; gap: 20px; min-height: 600px;">
        <!-- SIDEBAR: Lista de Grupos -->
        <div style="background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 20px; height: fit-content;">
          <div style="font-family: var(--mono); font-size: 0.55rem; letter-spacing: 0.2em; text-transform: uppercase; color: var(--muted); margin-bottom: 16px;">Grupos de Galerias</div>

          <button onclick="galleryGroupsAdmin.showCreateGroupModal()" style="width: 100%; padding: 12px; background: var(--accent); color: var(--bg); border: none; border-radius: 4px; cursor: pointer; font-weight: 600; margin-bottom: 16px; font-size: 0.9rem;">
            + Novo Grupo
          </button>

          <div style="display: flex; flex-direction: column; gap: 8px;">
            ${this.groups.map(group => `
              <div
                onclick="galleryGroupsAdmin.selectGroup('${group.id}')"
                style="padding: 12px; background: ${this.selectedGroupId === group.id ? 'var(--accent2)' : 'transparent'}; border: 1px solid ${this.selectedGroupId === group.id ? 'var(--accent)' : 'var(--border)'}; border-radius: 4px; cursor: pointer; transition: all 0.2s;"
              >
                <div style="color: var(--text); font-weight: 600; font-size: 0.9rem;">${group.name}</div>
                <div style="color: var(--muted); font-size: 0.75rem; margin-top: 4px;">
                  ${this.getGalleriesInGroup(group.id).length} galerias
                </div>
              </div>
            `).join('')}
            ${this.groups.length === 0 ? '<div style="color: var(--muted); font-size: 0.85rem; text-align: center; padding: 20px;">Nenhum grupo criado</div>' : ''}
          </div>
        </div>

        <!-- MAIN AREA: Detalhes do Grupo -->
        <div>
          ${this.selectedGroupId ? this.renderGroupDetails() : '<div style="color: var(--muted); text-align: center; padding: 40px;">Selecione um grupo ou crie um novo</div>'}
        </div>

        <!-- MODALS -->
        ${this.renderModals()}
      </div>
    `;
  }

  renderGroupDetails() {
    const group = this.groups.find(g => g.id === this.selectedGroupId);
    if (!group) return '';

    const groupGalleries = this.getGalleriesInGroup(group.id);
    const availableGalleries = this.galleries.filter(g => !g.gallery_group_id);

    return `
      <div style="background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 24px;">
        <!-- HEADER -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
          <div>
            <div style="font-family: var(--display); font-size: 1.4rem; font-weight: 900; color: var(--text);">${group.name}</div>
            <div style="color: var(--muted); font-size: 0.85rem; margin-top: 6px;">${group.description || 'Sem descrição'}</div>
          </div>
          <div style="display: flex; gap: 8px;">
            <button onclick="galleryGroupsAdmin.showEditGroupModal('${group.id}')" style="padding: 8px 16px; background: var(--border); color: var(--text); border: none; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">
              Editar
            </button>
            <button onclick="galleryGroupsAdmin.deleteGroup('${group.id}')" style="padding: 8px 16px; background: var(--red); color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">
              Deletar
            </button>
          </div>
        </div>

        <!-- GALERIAS NO GRUPO -->
        <div style="margin-bottom: 32px;">
          <div style="font-family: var(--mono); font-size: 0.55rem; letter-spacing: 0.2em; text-transform: uppercase; color: var(--muted); margin-bottom: 12px;">Galerias no Grupo (${groupGalleries.length})</div>
          <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px;">
            ${groupGalleries.map(gallery => `
              <div style="background: var(--panel2); border: 1px solid var(--border); border-radius: 6px; padding: 12px; position: relative;">
                <div style="color: var(--text); font-size: 0.9rem; font-weight: 600; margin-bottom: 8px;">${gallery.name}</div>
                <button onclick="galleryGroupsAdmin.removeGalleryFromGroup('${gallery.id}')" style="width: 100%; padding: 6px; background: var(--red); color: white; border: none; border-radius: 3px; cursor: pointer; font-size: 0.75rem;">
                  Remover
                </button>
              </div>
            `).join('')}
            ${groupGalleries.length === 0 ? '<div style="color: var(--muted); grid-column: 1/-1; text-align: center; padding: 20px;">Nenhuma galeria neste grupo</div>' : ''}
          </div>
        </div>

        <!-- ADICIONAR GALERIAS -->
        ${availableGalleries.length > 0 ? `
          <div>
            <div style="font-family: var(--mono); font-size: 0.55rem; letter-spacing: 0.2em; text-transform: uppercase; color: var(--muted); margin-bottom: 12px;">Galerias Disponíveis</div>
            <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px;">
              ${availableGalleries.map(gallery => `
                <div style="background: var(--panel2); border: 1px solid var(--border); border-radius: 6px; padding: 12px; position: relative;">
                  <div style="color: var(--text); font-size: 0.9rem; font-weight: 600; margin-bottom: 8px;">${gallery.name}</div>
                  <button onclick="galleryGroupsAdmin.addGalleryToGroup('${group.id}', '${gallery.id}')" style="width: 100%; padding: 6px; background: var(--green); color: var(--bg); border: none; border-radius: 3px; cursor: pointer; font-size: 0.75rem;">
                    Adicionar
                  </button>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  renderModals() {
    return `
      <!-- MODAL: Criar Grupo -->
      <div id="create-group-modal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 1000; display: flex; align-items: center; justify-content: center;">
        <div style="background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 24px; width: 90%; max-width: 400px;">
          <div style="font-family: var(--display); font-size: 1.2rem; font-weight: 900; margin-bottom: 20px;">Novo Grupo de Galerias</div>

          <input id="group-name-input" type="text" placeholder="Nome do grupo" style="width: 100%; padding: 10px; background: var(--panel2); border: 1px solid var(--border); border-radius: 4px; color: var(--text); margin-bottom: 12px; font-family: var(--body);" />

          <textarea id="group-desc-input" placeholder="Descrição (opcional)" style="width: 100%; padding: 10px; background: var(--panel2); border: 1px solid var(--border); border-radius: 4px; color: var(--text); margin-bottom: 20px; font-family: var(--body); resize: vertical; height: 80px;"></textarea>

          <div style="display: flex; gap: 12px;">
            <button onclick="galleryGroupsAdmin.hideModals()" style="flex: 1; padding: 10px; background: var(--border); color: var(--text); border: none; border-radius: 4px; cursor: pointer;">
              Cancelar
            </button>
            <button onclick="galleryGroupsAdmin.submitCreateGroup()" style="flex: 1; padding: 10px; background: var(--accent); color: var(--bg); border: none; border-radius: 4px; cursor: pointer; font-weight: 600;">
              Criar Grupo
            </button>
          </div>
        </div>
      </div>

      <!-- MODAL: Editar Grupo -->
      <div id="edit-group-modal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 1000; display: flex; align-items: center; justify-content: center;">
        <div style="background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 24px; width: 90%; max-width: 400px;">
          <div style="font-family: var(--display); font-size: 1.2rem; font-weight: 900; margin-bottom: 20px;">Editar Grupo</div>

          <input id="edit-group-name-input" type="text" style="width: 100%; padding: 10px; background: var(--panel2); border: 1px solid var(--border); border-radius: 4px; color: var(--text); margin-bottom: 12px; font-family: var(--body);" />

          <textarea id="edit-group-desc-input" style="width: 100%; padding: 10px; background: var(--panel2); border: 1px solid var(--border); border-radius: 4px; color: var(--text); margin-bottom: 20px; font-family: var(--body); resize: vertical; height: 80px;"></textarea>

          <div style="display: flex; gap: 12px;">
            <button onclick="galleryGroupsAdmin.hideModals()" style="flex: 1; padding: 10px; background: var(--border); color: var(--text); border: none; border-radius: 4px; cursor: pointer;">
              Cancelar
            </button>
            <button onclick="galleryGroupsAdmin.submitEditGroup()" style="flex: 1; padding: 10px; background: var(--accent); color: var(--bg); border: none; border-radius: 4px; cursor: pointer; font-weight: 600;">
              Salvar
            </button>
          </div>
        </div>
      </div>
    `;
  }

  showCreateGroupModal() {
    document.getElementById('create-group-modal').style.display = 'flex';
  }

  showEditGroupModal(groupId) {
    const group = this.groups.find(g => g.id === groupId);
    if (!group) return;

    document.getElementById('edit-group-name-input').value = group.name;
    document.getElementById('edit-group-desc-input').value = group.description || '';
    document.getElementById('edit-group-modal').dataset.groupId = groupId;
    document.getElementById('edit-group-modal').style.display = 'flex';
  }

  hideModals() {
    document.getElementById('create-group-modal').style.display = 'none';
    document.getElementById('edit-group-modal').style.display = 'none';
  }

  async submitCreateGroup() {
    const name = document.getElementById('group-name-input').value.trim();
    const description = document.getElementById('group-desc-input').value.trim();

    if (!name) {
      this.showError('Digite um nome para o grupo');
      return;
    }

    const result = await this.createGroup({ name, description });
    if (result) {
      this.hideModals();
      document.getElementById('group-name-input').value = '';
      document.getElementById('group-desc-input').value = '';
    }
  }

  async submitEditGroup() {
    const groupId = document.getElementById('edit-group-modal').dataset.groupId;
    const name = document.getElementById('edit-group-name-input').value.trim();
    const description = document.getElementById('edit-group-desc-input').value.trim();

    if (!name) {
      this.showError('Digite um nome para o grupo');
      return;
    }

    await this.updateGroup(groupId, { name, description });
    this.hideModals();
    this.selectedGroupId = null;
  }

  selectGroup(groupId) {
    this.selectedGroupId = groupId;
  }

  getGalleriesInGroup(groupId) {
    return this.galleries.filter(g => g.gallery_group_id === groupId);
  }

  showSuccess(message) {
    const alert = document.createElement('div');
    alert.style.cssText = 'position: fixed; top: 20px; right: 20px; background: var(--green); color: var(--bg); padding: 12px 20px; border-radius: 4px; z-index: 2000; font-size: 0.9rem;';
    alert.textContent = '✅ ' + message;
    document.body.appendChild(alert);
    setTimeout(() => alert.remove(), 3000);
  }

  showError(message) {
    const alert = document.createElement('div');
    alert.style.cssText = 'position: fixed; top: 20px; right: 20px; background: var(--red); color: white; padding: 12px 20px; border-radius: 4px; z-index: 2000; font-size: 0.9rem;';
    alert.textContent = '❌ ' + message;
    document.body.appendChild(alert);
    setTimeout(() => alert.remove(), 3000);
  }
}

// Inicializar quando o supabase estiver disponível
let galleryGroupsAdmin = null;
document.addEventListener('DOMContentLoaded', () => {
  if (typeof supabase !== 'undefined') {
    galleryGroupsAdmin = new GalleryGroupsAdmin(supabase);
    galleryGroupsAdmin.init();
  }
});
