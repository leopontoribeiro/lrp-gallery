// ========== ADMIN: Clients + Events Management v2 ==========
// Com: QR Codes + UUID Tokens + Upload Validation + Security + Monitoring

class ClientsEventsAdmin {
  constructor() {
    this.currentTab = 'clients';
    this.clients = [];
    this.events = [];
    this.selectedClientId = null;
    this.currentUser = null;
  }

  async init() {
    // Verificar autenticação
    const { data: { user }, error } = await supabase.auth.getUser();
    if (!user || error) {
      window.location.href = '/admin-login.html';
      return;
    }
    this.currentUser = user;

    // Carregar dados
    await this.loadClients();
    this.renderUI();
  }

  async loadClients() {
    try {
      const { data, error } = await supabase
        .from('clients')
        .select('*')
        .eq('owner_id', this.currentUser.id)
        .order('name');

      if (error) throw error;
      this.clients = data || [];
    } catch (err) {
      this.logError('Erro ao carregar clientes', err);
      alert('Erro ao carregar clientes');
    }
  }

  async loadEvents(clientId) {
    try {
      const { data, error } = await supabase
        .from('events')
        .select('*, share_links(token, qr_code_url, view_count)')
        .eq('client_id', clientId)
        .order('event_date', { ascending: false });

      if (error) throw error;
      this.events = data || [];
    } catch (err) {
      this.logError('Erro ao carregar eventos', err);
    }
  }

  renderUI() {
    const container = document.getElementById('clients-events-admin');
    if (!container) return;

    container.innerHTML = `
      <div style="display: grid; grid-template-columns: 250px 1fr; gap: 20px; min-height: 600px;">
        <!-- SIDEBAR -->
        <div style="background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 20px; height: fit-content;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <div style="font-family: var(--mono); font-size: 0.55rem; letter-spacing: 0.2em; text-transform: uppercase; color: var(--muted);">Clientes</div>
            <button onclick="clientsEventsAdmin.logout()" style="padding: 4px 8px; background: transparent; border: 1px solid var(--border); color: var(--text); font-size: 0.65rem; border-radius: 3px; cursor: pointer;">Logout</button>
          </div>

          <button onclick="clientsEventsAdmin.showNewClientForm()" style="width: 100%; padding: 10px; background: var(--accent); color: var(--bg); border: none; border-radius: 4px; cursor: pointer; font-weight: 600; margin-bottom: 16px;">
            + Novo Cliente
          </button>

          <div style="display: flex; flex-direction: column; gap: 6px;">
            ${this.clients.map(client => `
              <div
                onclick="clientsEventsAdmin.selectClient('${client.id}')"
                style="padding: 10px 12px; background: ${this.selectedClientId === client.id ? 'var(--accent2)' : 'transparent'}; border: 1px solid ${this.selectedClientId === client.id ? 'var(--accent)' : 'var(--border)'}; border-radius: 4px; cursor: pointer; color: ${this.selectedClientId === client.id ? 'var(--bg)' : 'var(--text)'}; font-size: 0.85rem;"
              >
                ${client.name}
              </div>
            `).join('')}
          </div>
        </div>

        <!-- MAIN AREA -->
        <div>
          ${this.selectedClientId ? this.renderEventsPanel() : '<div style="color: var(--muted); text-align: center; padding: 40px;">Selecione um cliente</div>'}
        </div>
      </div>

      <!-- MODALS -->
      ${this.renderModals()}
    `;
  }

  renderEventsPanel() {
    return `
      <div style="background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 20px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <div style="font-family: var(--mono); font-size: 0.55rem; letter-spacing: 0.2em; text-transform: uppercase; color: var(--muted);">Eventos</div>
          <button onclick="clientsEventsAdmin.showNewEventForm()" style="padding: 8px 12px; background: var(--accent); color: var(--bg); border: none; border-radius: 4px; cursor: pointer; font-size: 0.75rem; font-weight: 600;">+ Novo Evento</button>
        </div>

        <div style="display: flex; flex-direction: column; gap: 12px;">
          ${this.events.length === 0
            ? '<div style="color: var(--muted); text-align: center; padding: 40px;">Nenhum evento</div>'
            : this.events.map(event => {
              const link = event.share_links?.[0];
              const token = link?.token;
              const qrCode = link?.qr_code_url;
              const daysRemaining = Math.max(0, event.delete_after_days - Math.floor((new Date() - new Date(event.created_at)) / (1000 * 60 * 60 * 24)));

              return `
                <div style="background: var(--panel2); border: 1px solid var(--border); border-radius: 6px; padding: 16px;">
                  <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
                    <div>
                      <div style="font-weight: 600; color: var(--text);">${event.name}</div>
                      <div style="font-size: 0.8rem; color: var(--muted); margin-top: 4px;">${new Date(event.event_date).toLocaleDateString('pt-BR')}</div>
                    </div>
                    ${event.auto_delete_enabled ? `
                      <div style="background: rgba(232,255,71,0.1); border: 1px solid var(--accent); color: var(--accent); padding: 4px 8px; border-radius: 3px; font-size: 0.7rem; font-weight: 600;">
                        Deleta em ${daysRemaining}d
                      </div>
                    ` : ''}
                  </div>

                  <!-- Share Link -->
                  <div style="background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 10px; margin-bottom: 12px; font-family: var(--mono); font-size: 0.75rem; word-break: break-all; color: var(--muted);">
                    ${token ? `/gallery/share/${token}` : 'Sem link gerado'}
                  </div>

                  <!-- QR Code Display -->
                  ${qrCode ? `
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 12px;">
                      <img src="${qrCode}" alt="QR Code" style="width: 80px; height: 80px; border: 1px solid var(--border); border-radius: 4px;">
                      <div style="flex: 1;">
                        <div style="font-size: 0.75rem; color: var(--muted); margin-bottom: 6px;">Views: ${link.view_count || 0}</div>
                        <button onclick="clientsEventsAdmin.downloadQRCode('${qrCode}', '${event.name}')" style="padding: 6px 10px; background: transparent; border: 1px solid var(--border); color: var(--text); border-radius: 3px; cursor: pointer; font-size: 0.7rem;">⬇ QR Code</button>
                      </div>
                    </div>
                  ` : ''}

                  <!-- Buttons -->
                  <div style="display: flex; gap: 8px;">
                    ${token ? `
                      <button onclick="navigator.clipboard.writeText('${token}'); clientsEventsAdmin.showNotification('Link copiado!', 'success')" style="flex: 1; padding: 8px; background: transparent; border: 1px solid var(--border); color: var(--text); border-radius: 4px; cursor: pointer; font-size: 0.75rem;">📋 Copiar</button>
                    ` : `
                      <button onclick="clientsEventsAdmin.generateLink('${event.id}')" style="flex: 1; padding: 8px; background: var(--accent); color: var(--bg); border: none; border-radius: 4px; cursor: pointer; font-size: 0.75rem; font-weight: 600;">Gerar Link</button>
                    `}
                    <button onclick="clientsEventsAdmin.deleteEvent('${event.id}')" style="flex: 1; padding: 8px; background: transparent; border: 1px solid #ff4f4f; color: #ff4f4f; border-radius: 4px; cursor: pointer; font-size: 0.75rem;">🗑 Delete</button>
                  </div>
                </div>
              `;
            }).join('')}
        </div>
      </div>
    `;
  }

  renderModals() {
    return `
      <!-- NEW CLIENT MODAL -->
      <div id="new-client-modal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 500; display: flex; align-items: center; justify-content: center;">
        <div style="background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 30px; max-width: 400px; width: 90%;">
          <div style="font-size: 1.2rem; font-weight: 600; margin-bottom: 20px;">Novo Cliente</div>
          <input type="text" id="client-name" placeholder="Nome do cliente" style="width: 100%; padding: 10px; margin-bottom: 12px; background: var(--panel2); border: 1px solid var(--border); border-radius: 4px; color: var(--text);">
          <input type="email" id="client-email" placeholder="Email" style="width: 100%; padding: 10px; margin-bottom: 12px; background: var(--panel2); border: 1px solid var(--border); border-radius: 4px; color: var(--text);">
          <div style="display: flex; gap: 10px;">
            <button onclick="clientsEventsAdmin.createClient()" style="flex: 1; padding: 10px; background: var(--accent); color: var(--bg); border: none; border-radius: 4px; cursor: pointer; font-weight: 600;">Criar</button>
            <button onclick="document.getElementById('new-client-modal').style.display = 'none'" style="flex: 1; padding: 10px; background: transparent; border: 1px solid var(--border); color: var(--text); border-radius: 4px; cursor: pointer;">Cancelar</button>
          </div>
        </div>
      </div>

      <!-- NEW EVENT MODAL -->
      <div id="new-event-modal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 500; display: flex; align-items: center; justify-content: center;">
        <div style="background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 30px; max-width: 400px; width: 90%; max-height: 90vh; overflow-y: auto;">
          <div style="font-size: 1.2rem; font-weight: 600; margin-bottom: 20px;">Novo Evento</div>
          <input type="text" id="event-name" placeholder="Nome do evento" style="width: 100%; padding: 10px; margin-bottom: 12px; background: var(--panel2); border: 1px solid var(--border); border-radius: 4px; color: var(--text);">
          <input type="date" id="event-date" style="width: 100%; padding: 10px; margin-bottom: 12px; background: var(--panel2); border: 1px solid var(--border); border-radius: 4px; color: var(--text);">
          <input type="text" id="event-desc" placeholder="Descrição (opcional)" style="width: 100%; padding: 10px; margin-bottom: 12px; background: var(--panel2); border: 1px solid var(--border); border-radius: 4px; color: var(--text);">

          <!-- Cover Image Upload -->
          <label style="display: block; margin-bottom: 12px; cursor: pointer; color: var(--muted); font-size: 0.85rem;">
            <input type="file" id="event-cover" accept="image/*" style="display: none;">
            📸 Upload Cover Image
          </label>
          <div id="cover-preview" style="margin-bottom: 12px;"></div>

          <label style="display: flex; align-items: center; gap: 8px; margin-bottom: 16px; cursor: pointer; font-size: 0.9rem;">
            <input type="checkbox" id="event-auto-delete" style="width: 18px; height: 18px; cursor: pointer;">
            Deletar automaticamente após 180 dias?
          </label>
          <div style="display: flex; gap: 10px;">
            <button onclick="clientsEventsAdmin.createEvent()" style="flex: 1; padding: 10px; background: var(--accent); color: var(--bg); border: none; border-radius: 4px; cursor: pointer; font-weight: 600;">Criar</button>
            <button onclick="document.getElementById('new-event-modal').style.display = 'none'" style="flex: 1; padding: 10px; background: transparent; border: 1px solid var(--border); color: var(--text); border-radius: 4px; cursor: pointer;">Cancelar</button>
          </div>
        </div>
      </div>

      <!-- Notification Toast -->
      <div id="notification" style="position: fixed; top: 20px; right: 20px; padding: 16px 20px; border-radius: 8px; font-size: 0.9rem; z-index: 9999; display: none;"></div>
    `;
  }

  selectClient(clientId) {
    this.selectedClientId = clientId;
    this.loadEvents(clientId).then(() => this.renderUI());
  }

  showNewClientForm() {
    document.getElementById('new-client-modal').style.display = 'flex';
  }

  showNewEventForm() {
    document.getElementById('new-event-modal').style.display = 'flex';
    document.getElementById('event-cover').addEventListener('change', (e) => this.previewCover(e));
  }

  previewCover(e) {
    const file = e.target.files[0];
    const preview = document.getElementById('cover-preview');

    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        preview.innerHTML = `
          <img src="${event.target.result}" style="max-width: 100%; height: 150px; object-fit: cover; border-radius: 4px; border: 1px solid var(--border);">
        `;
      };
      reader.readAsDataURL(file);
    }
  }

  async createClient() {
    const name = document.getElementById('client-name').value;
    const email = document.getElementById('client-email').value;

    if (!name) {
      this.showNotification('Nome obrigatório', 'error');
      return;
    }

    const slug = name.toLowerCase().replace(/\s+/g, '-');

    try {
      const { error } = await supabase.from('clients').insert([{
        name,
        slug,
        contact_email: email,
        owner_id: this.currentUser.id
      }]);

      if (error) throw error;

      document.getElementById('new-client-modal').style.display = 'none';
      document.getElementById('client-name').value = '';
      document.getElementById('client-email').value = '';

      this.showNotification('Cliente criado!', 'success');
      await this.loadClients();
      this.renderUI();

      // Log
      await this.logAction('client_created', { name, slug });

    } catch (err) {
      this.logError('Erro ao criar cliente', err);
      this.showNotification('Erro ao criar cliente', 'error');
    }
  }

  async createEvent() {
    const name = document.getElementById('event-name').value;
    const date = document.getElementById('event-date').value;
    const desc = document.getElementById('event-desc').value;
    const autoDelete = document.getElementById('event-auto-delete').checked;
    const coverFile = document.getElementById('event-cover').files[0];

    if (!name || !date) {
      this.showNotification('Nome e data obrigatórios', 'error');
      return;
    }

    let coverUrl = null;

    // Fazer upload de cover se fornecido
    if (coverFile) {
      try {
        const validation = this.validateImageFile(coverFile);
        if (!validation.valid) {
          this.showNotification(validation.errors[0], 'error');
          return;
        }

        coverUrl = await this.uploadCoverImage(coverFile);
      } catch (err) {
        this.logError('Erro ao fazer upload de imagem', err);
        this.showNotification('Erro ao fazer upload de imagem', 'error');
        return;
      }
    }

    try {
      const { error } = await supabase.from('events').insert([{
        client_id: this.selectedClientId,
        name,
        event_date: date,
        description: desc || null,
        cover_image_url: coverUrl,
        auto_delete_enabled: autoDelete,
        delete_after_days: 180,
        updated_by: this.currentUser.id
      }]);

      if (error) throw error;

      document.getElementById('new-event-modal').style.display = 'none';
      document.getElementById('event-name').value = '';
      document.getElementById('event-date').value = '';
      document.getElementById('event-desc').value = '';
      document.getElementById('event-auto-delete').checked = false;
      document.getElementById('cover-preview').innerHTML = '';

      this.showNotification('Evento criado!', 'success');
      await this.loadEvents(this.selectedClientId);
      this.renderUI();

      await this.logAction('event_created', { name, date });

    } catch (err) {
      this.logError('Erro ao criar evento', err);
      this.showNotification('Erro ao criar evento', 'error');
    }
  }

  validateImageFile(file) {
    const errors = [];
    const MAX_SIZE = 5 * 1024 * 1024;

    if (file.size > MAX_SIZE) {
      errors.push(`Arquivo muito grande (máximo ${MAX_SIZE / 1024 / 1024}MB)`);
    }

    const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
    if (!ALLOWED_TYPES.includes(file.type)) {
      errors.push('Apenas JPG, PNG e WebP são aceitos');
    }

    return { valid: errors.length === 0, errors };
  }

  async uploadCoverImage(file) {
    const hash = await this.calculateFileHash(file);
    const filename = `cover_${this.selectedClientId}_${hash}.jpg`;

    const { error: uploadError } = await supabase.storage
      .from('event_covers')
      .upload(filename, file, { upsert: true });

    if (uploadError) throw uploadError;

    const { data } = supabase.storage
      .from('event_covers')
      .getPublicUrl(filename);

    return data.publicUrl;
  }

  async calculateFileHash(file) {
    const arrayBuffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('').substring(0, 16);
  }

  async generateLink(eventId) {
    try {
      // Usar UUID v4 ao invés de Math.random()
      const token = 'share_' + crypto.randomUUID();

      const { error } = await supabase.from('share_links').insert([{
        event_id: eventId,
        token,
        access_type: 'public'
      }]);

      if (error) throw error;

      this.showNotification('Link gerado com QR Code!', 'success');
      await this.loadEvents(this.selectedClientId);
      this.renderUI();

      await this.logAction('link_generated', { eventId, token });

    } catch (err) {
      this.logError('Erro ao gerar link', err);
      this.showNotification('Erro ao gerar link', 'error');
    }
  }

  async deleteEvent(eventId) {
    if (!confirm('Deletar este evento? Não é reversível.')) return;

    try {
      const { error } = await supabase.rpc('delete_event_and_galleries', {
        event_id: eventId
      });

      if (error) throw error;

      this.showNotification('Evento deletado', 'success');
      await this.loadEvents(this.selectedClientId);
      this.renderUI();

      await this.logAction('event_deleted', { eventId });

    } catch (err) {
      this.logError('Erro ao deletar evento', err);
      this.showNotification('Erro ao deletar evento', 'error');
    }
  }

  async downloadQRCode(qrUrl, eventName) {
    try {
      const response = await fetch(qrUrl);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `qr_${eventName}.png`;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      this.logError('Erro ao baixar QR Code', err);
      this.showNotification('Erro ao baixar QR Code', 'error');
    }
  }

  async logAction(action, details) {
    try {
      await supabase.from('audit_log').insert([{
        table_name: 'events',
        record_id: details.eventId || null,
        action,
        new_data: details,
        user_id: this.currentUser.id
      }]);
    } catch (err) {
      console.error('Audit log error:', err);
    }
  }

  async logError(message, error) {
    console.error(message, error);
    try {
      await supabase.rpc('log_error', {
        p_level: 'error',
        p_message: message,
        p_error_code: error.code || 'UNKNOWN',
        p_context: { stack: error.stack }
      });
    } catch (err) {
      console.error('Error logging failed:', err);
    }
  }

  showNotification(message, type = 'info') {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.style.display = 'block';

    const colors = {
      success: { bg: '#10b981', text: '#fff' },
      error: { bg: '#ef4444', text: '#fff' },
      info: { bg: '#3b82f6', text: '#fff' }
    };

    const color = colors[type] || colors.info;
    notification.style.backgroundColor = color.bg;
    notification.style.color = color.text;

    setTimeout(() => {
      notification.style.display = 'none';
    }, 3000);
  }

  async logout() {
    if (confirm('Desconectar?')) {
      await supabase.auth.signOut();
      window.location.href = '/admin-login.html';
    }
  }
}

const clientsEventsAdmin = new ClientsEventsAdmin();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    clientsEventsAdmin.init();
    if (typeof initAdminActions === 'function') {
      initAdminActions(supabase, clientsEventsAdmin);
    }
  });
} else {
  clientsEventsAdmin.init();
  if (typeof initAdminActions === 'function') {
    initAdminActions(supabase, clientsEventsAdmin);
  }
}

window.clientsEventsAdmin = clientsEventsAdmin;
