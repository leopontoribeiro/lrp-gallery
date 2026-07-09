// ========== ADMIN: Clients + Events Management ==========
// Gerenciar clientes, eventos e links de compartilhamento

class ClientsEventsAdmin {
  constructor() {
    this.currentTab = 'clients';
    this.clients = [];
    this.events = [];
    this.selectedClientId = null;
  }

  async init() {
    await this.loadClients();
    this.renderUI();
  }

  async loadClients() {
    const { data } = await supabase.from('clients').select('*').order('name');
    this.clients = data || [];
  }

  async loadEvents(clientId) {
    const { data } = await supabase
      .from('events')
      .select('*, share_links(token)')
      .eq('client_id', clientId)
      .order('event_date', { ascending: false });
    this.events = data || [];
  }

  renderUI() {
    const container = document.getElementById('clients-events-admin');
    if (!container) return;

    container.innerHTML = `
      <div style="display: grid; grid-template-columns: 250px 1fr; gap: 20px; min-height: 600px;">
        <!-- SIDEBAR -->
        <div style="background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 20px; height: fit-content;">
          <div style="font-family: var(--mono); font-size: 0.55rem; letter-spacing: 0.2em; text-transform: uppercase; color: var(--muted); margin-bottom: 16px;">Clientes</div>

          <button onclick="clientsEventsAdmin.showNewClientForm()" style="width: 100%; padding: 10px; background: var(--accent); color: var(--bg); border: none; border-radius: 4px; cursor: pointer; font-weight: 600; margin-bottom: 16px;">
            + Novo Cliente
          </button>

          <div style="display: flex; flex-direction: column; gap: 6px;">
            ${this.clients.map(client => `
              <div
                onclick="clientsEventsAdmin.selectClient('${client.id}')"
                style="padding: 10px 12px; background: ${this.selectedClientId === client.id ? 'var(--accent2)' : 'transparent'}; border: 1px solid ${this.selectedClientId === client.id ? 'var(--accent)' : 'var(--border)'}; border-radius: 4px; cursor: pointer; color: ${this.selectedClientId === client.id ? 'var(--accent)' : 'var(--text)'}; font-size: 0.85rem;"
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

      <div id="new-event-modal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.8); z-index: 500; display: flex; align-items: center; justify-content: center;">
        <div style="background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 30px; max-width: 400px; width: 90%;">
          <div style="font-size: 1.2rem; font-weight: 600; margin-bottom: 20px;">Novo Evento</div>
          <input type="text" id="event-name" placeholder="Nome do evento (ex: IMPULSO)" style="width: 100%; padding: 10px; margin-bottom: 12px; background: var(--panel2); border: 1px solid var(--border); border-radius: 4px; color: var(--text);">
          <input type="date" id="event-date" style="width: 100%; padding: 10px; margin-bottom: 12px; background: var(--panel2); border: 1px solid var(--border); border-radius: 4px; color: var(--text);">
          <input type="text" id="event-desc" placeholder="Descrição (opcional)" style="width: 100%; padding: 10px; margin-bottom: 12px; background: var(--panel2); border: 1px solid var(--border); border-radius: 4px; color: var(--text);">
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
              const token = event.share_links?.[0]?.token;
              const shareLink = token ? `/gallery/share/${token}` : 'Sem link';
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

                  <div style="background: var(--bg); border: 1px solid var(--border); border-radius: 4px; padding: 10px; margin-bottom: 12px; font-family: var(--mono); font-size: 0.75rem; word-break: break-all; color: var(--muted);">
                    ${shareLink}
                  </div>

                  <div style="display: flex; gap: 8px;">
                    ${token ? `
                      <button onclick="navigator.clipboard.writeText('${shareLink}'); alert('Link copiado!')" style="flex: 1; padding: 8px; background: transparent; border: 1px solid var(--border); color: var(--text); border-radius: 4px; cursor: pointer; font-size: 0.75rem;">Copiar</button>
                    ` : `
                      <button onclick="clientsEventsAdmin.generateLink('${event.id}')" style="flex: 1; padding: 8px; background: var(--accent); color: var(--bg); border: none; border-radius: 4px; cursor: pointer; font-size: 0.75rem; font-weight: 600;">Gerar Link</button>
                    `}
                    <button onclick="clientsEventsAdmin.deleteEvent('${event.id}')" style="flex: 1; padding: 8px; background: transparent; border: 1px solid #ff4f4f; color: #ff4f4f; border-radius: 4px; cursor: pointer; font-size: 0.75rem;">Deletar</button>
                  </div>
                </div>
              `;
            }).join('')}
        </div>
      </div>
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
  }

  async createClient() {
    const name = document.getElementById('client-name').value;
    const email = document.getElementById('client-email').value;

    if (!name) return alert('Nome obrigatório');

    const slug = name.toLowerCase().replace(/\s+/g, '-');

    const { error } = await supabase.from('clients').insert([{
      name,
      slug,
      contact_email: email
    }]);

    if (error) return alert(`Erro: ${error.message}`);

    document.getElementById('new-client-modal').style.display = 'none';
    document.getElementById('client-name').value = '';
    document.getElementById('client-email').value = '';
    await this.loadClients();
    this.renderUI();
  }

  async createEvent() {
    const name = document.getElementById('event-name').value;
    const date = document.getElementById('event-date').value;
    const desc = document.getElementById('event-desc').value;
    const autoDelete = document.getElementById('event-auto-delete').checked;

    if (!name || !date) return alert('Nome e data obrigatórios');

    const { error } = await supabase.from('events').insert([{
      client_id: this.selectedClientId,
      name,
      event_date: date,
      description: desc || null,
      auto_delete_enabled: autoDelete,
      delete_after_days: 180
    }]);

    if (error) return alert(`Erro: ${error.message}`);

    document.getElementById('new-event-modal').style.display = 'none';
    document.getElementById('event-name').value = '';
    document.getElementById('event-date').value = '';
    document.getElementById('event-desc').value = '';
    document.getElementById('event-auto-delete').checked = false;
    await this.loadEvents(this.selectedClientId);
    this.renderUI();
  }

  async generateLink(eventId) {
    const token = 'share_' + Math.random().toString(36).substring(2, 15);

    const { error } = await supabase.from('share_links').insert([{
      event_id: eventId,
      token,
      access_type: 'public'
    }]);

    if (error) return alert(`Erro: ${error.message}`);

    await this.loadEvents(this.selectedClientId);
    this.renderUI();
  }

  async deleteEvent(eventId) {
    if (!confirm('Tem certeza? Isto deletará o evento e todas suas galerias.')) return;

    const { error } = await supabase.rpc('delete_event_and_galleries', {
      event_id: eventId
    });

    if (error) return alert(`Erro: ${error.message}`);

    await this.loadEvents(this.selectedClientId);
    this.renderUI();
  }
}

const clientsEventsAdmin = new ClientsEventsAdmin();

// Init when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => clientsEventsAdmin.init());
} else {
  clientsEventsAdmin.init();
}

window.clientsEventsAdmin = clientsEventsAdmin;
