// ========== TASK #23: Sistema de Resposta a Direitos LGPD ==========
// Portal para gerenciar requisições de direitos dos usuários

class LGPDRightsPortal {
  constructor() {
    this.container = document.getElementById('lgpd-rights');
    this.requests = [];
    this.typeColors = {
      'acesso': '#47ffb2',
      'exclusao': '#ff4f4f',
      'revogacao': '#e8ff47',
      'portabilidade': '#87ceeb',
      'correcao': '#ffa500'
    };
  }

  async loadRequests() {
    try {
      const { data } = await supabase
        .from('rights_exercise_requests')
        .select('*')
        .order('created_at', { ascending: false });

      this.requests = data || [];
      this.render();
    } catch (err) {
      console.error('Erro carregando requisições de direitos:', err);
    }
  }

  async updateStatus(id, status) {
    try {
      await supabase
        .from('rights_exercise_requests')
        .update({
          status,
          updated_at: new Date().toISOString()
        })
        .eq('id', id);

      this.loadRequests();
    } catch (err) {
      console.error('Erro atualizando status:', err);
    }
  }

  async respondToRequest(id, responseData) {
    try {
      const deadline = new Date();
      deadline.setDate(deadline.getDate() + 15); // 15 dias úteis

      await supabase
        .from('rights_exercise_requests')
        .update({
          response_data: responseData,
          status: 'respondido',
          completed_at: new Date().toISOString(),
          deadline_at: deadline.toISOString()
        })
        .eq('id', id);

      this.loadRequests();
    } catch (err) {
      console.error('Erro respondendo requisição:', err);
    }
  }

  render() {
    if (!this.container) return;

    const statusBadgeColor = (status) => {
      const colors = {
        'pending': '#ff4f4f',
        'processing': '#e8ff47',
        'respondido': '#47ffb2'
      };
      return colors[status] || '#999';
    };

    const html = `
      <div style="margin-bottom: 16px;">
        <div style="font-family: var(--mono); font-size: 0.6rem; letter-spacing: 0.25em; text-transform: uppercase; color: var(--muted); margin-bottom: 16px;">Requisições Pendentes</div>
        <div style="display: grid; gap: 12px;">
          ${this.requests.length === 0
            ? '<div style="padding: 20px; color: var(--muted); text-align: center;">Nenhuma requisição pendente</div>'
            : this.requests.map(req => `
              <div style="background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 16px;">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
                  <div>
                    <div style="font-weight: 600; color: var(--text);">${req.request_type.toUpperCase()}</div>
                    <div style="font-size: 0.75rem; color: var(--muted); margin-top: 4px;">User: ${req.user_id.substring(0, 8)}...</div>
                  </div>
                  <div style="padding: 4px 12px; border-radius: 4px; background: ${statusBadgeColor(req.status)}; color: var(--bg); font-size: 0.7rem; font-weight: 600;">
                    ${req.status}
                  </div>
                </div>
                <div style="font-size: 0.8rem; color: var(--muted); margin-bottom: 12px;">
                  Criada: ${new Date(req.created_at).toLocaleDateString('pt-BR')}
                </div>
                <div style="display: flex; gap: 8px;">
                  <button onclick="lgpdRightsPortal.updateStatus('${req.id}', 'processing')" style="padding: 6px 12px; background: var(--accent); color: var(--bg); border: none; border-radius: 4px; cursor: pointer; font-size: 0.7rem; font-weight: 600;">
                    Processar
                  </button>
                  <button onclick="lgpdRightsPortal.respondToRequest('${req.id}', {})" style="padding: 6px 12px; background: var(--green); color: var(--bg); border: none; border-radius: 4px; cursor: pointer; font-size: 0.7rem; font-weight: 600;">
                    Responder
                  </button>
                  <button onclick="lgpdRightsPortal.updateStatus('${req.id}', 'respondido')" style="padding: 6px 12px; background: transparent; border: 1px solid var(--border); color: var(--text); border-radius: 4px; cursor: pointer; font-size: 0.7rem; font-weight: 600;">
                    Concluir
                  </button>
                </div>
              </div>
            `).join('')}
        </div>
      </div>
    `;

    this.container.innerHTML = html;
  }

  init() {
    this.loadRequests();
    setInterval(() => this.loadRequests(), 120000); // Atualizar a cada 2 minutos
  }
}

const lgpdRightsPortal = new LGPDRightsPortal();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => lgpdRightsPortal.init());
} else {
  lgpdRightsPortal.init();
}

window.lgpdRightsPortal = lgpdRightsPortal;
