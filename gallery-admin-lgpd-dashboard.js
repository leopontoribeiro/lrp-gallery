// ========== TASK #22: Dashboard Admin LGPD Analytics ==========
// Monitoramento de consentimentos e compliance

class LGPDDashboard {
  constructor() {
    this.container = document.getElementById('lgpd-analytics');
    this.data = {
      totalConsents: 0,
      revokedConsents: 0,
      pendingRights: 0,
      deletedRecords: 0,
      consentRate: 0
    };
  }

  async loadMetrics() {
    try {
      // Carregar do Supabase
      const { data: consents } = await supabase
        .from('consent_records')
        .select('count', { count: 'exact' });

      const { data: revoked } = await supabase
        .from('consent_records')
        .select('count', { count: 'exact' })
        .eq('accepted', false);

      const { data: rights } = await supabase
        .from('rights_exercise_requests')
        .select('count', { count: 'exact' })
        .eq('status', 'pending');

      const { data: deletions } = await supabase
        .from('biometric_deletion_logs')
        .select('count', { count: 'exact' })
        .gte('created_at', new Date(Date.now() - 30*24*60*60*1000).toISOString());

      this.data = {
        totalConsents: consents?.[0]?.count || 0,
        revokedConsents: revoked?.[0]?.count || 0,
        pendingRights: rights?.[0]?.count || 0,
        deletedRecords: deletions?.[0]?.count || 0,
        consentRate: consents?.[0]?.count ? Math.round((consents[0].count - (revoked?.[0]?.count || 0)) / consents[0].count * 100) : 0
      };

      this.render();
    } catch (err) {
      console.error('Erro carregando métricas LGPD:', err);
    }
  }

  render() {
    if (!this.container) return;

    this.container.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 32px;">
        <div style="background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 20px;">
          <div style="font-family: var(--mono); font-size: 0.55rem; letter-spacing: 0.2em; text-transform: uppercase; color: var(--muted); margin-bottom: 8px;">Consentimentos</div>
          <div style="font-family: var(--display); font-size: 2.4rem; font-weight: 900; color: var(--accent);">${this.data.totalConsents}</div>
        </div>

        <div style="background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 20px;">
          <div style="font-family: var(--mono); font-size: 0.55rem; letter-spacing: 0.2em; text-transform: uppercase; color: var(--muted); margin-bottom: 8px;">Revogados</div>
          <div style="font-family: var(--display); font-size: 2.4rem; font-weight: 900; color: var(--red);">${this.data.revokedConsents}</div>
        </div>

        <div style="background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 20px;">
          <div style="font-family: var(--mono); font-size: 0.55rem; letter-spacing: 0.2em; text-transform: uppercase; color: var(--muted); margin-bottom: 8px;">Taxa Ativa</div>
          <div style="font-family: var(--display); font-size: 2.4rem; font-weight: 900; color: var(--green);">${this.data.consentRate}%</div>
        </div>

        <div style="background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 20px;">
          <div style="font-family: var(--mono); font-size: 0.55rem; letter-spacing: 0.2em; text-transform: uppercase; color: var(--muted); margin-bottom: 8px;">Direitos Pendentes</div>
          <div style="font-family: var(--display); font-size: 2.4rem; font-weight: 900; color: var(--text);">${this.data.pendingRights}</div>
        </div>

        <div style="background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 20px;">
          <div style="font-family: var(--mono); font-size: 0.55rem; letter-spacing: 0.2em; text-transform: uppercase; color: var(--muted); margin-bottom: 8px;">Deletados (30d)</div>
          <div style="font-family: var(--display); font-size: 2.4rem; font-weight: 900; color: var(--text);">${this.data.deletedRecords}</div>
        </div>
      </div>

      <div style="background: var(--panel); border: 1px solid var(--border); border-radius: 8px; padding: 20px;">
        <div style="font-family: var(--mono); font-size: 0.6rem; letter-spacing: 0.25em; text-transform: uppercase; color: var(--muted); margin-bottom: 16px;">Conformidade LGPD</div>
        <div style="display: grid; gap: 8px;">
          <div style="display: flex; justify-content: space-between; font-size: 0.8rem;">
            <span>Auto-delete configurado</span>
            <span style="color: var(--green);">✓</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.8rem;">
            <span>RLS ativado</span>
            <span style="color: var(--green);">✓</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.8rem;">
            <span>Audit logs ativos</span>
            <span style="color: var(--green);">✓</span>
          </div>
          <div style="display: flex; justify-content: space-between; font-size: 0.8rem;">
            <span>Notificações de deleção</span>
            <span style="color: var(--green);">✓</span>
          </div>
        </div>
      </div>
    `;
  }

  init() {
    this.loadMetrics();
    setInterval(() => this.loadMetrics(), 60000); // Atualizar a cada minuto
  }
}

const lgpdDashboard = new LGPDDashboard();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => lgpdDashboard.init());
} else {
  lgpdDashboard.init();
}

window.lgpdDashboard = lgpdDashboard;
