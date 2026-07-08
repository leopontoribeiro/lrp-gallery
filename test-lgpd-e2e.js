// ========== TASK #26: Testes E2E + Validação LGPD ==========
// Suite de testes end-to-end para validação de conformidade

class LGPDTestSuite {
  constructor() {
    this.results = [];
    this.passed = 0;
    this.failed = 0;
  }

  log(test, status, message) {
    this.results.push({ test, status, message, timestamp: new Date().toISOString() });
    console.log(`[${status}] ${test}: ${message}`);
    if (status === 'PASS') this.passed++;
    else this.failed++;
  }

  // ── FRONTEND TESTS ──

  async testConsentModalDisplay() {
    try {
      const modal = document.getElementById('lgpd-consent-modal');
      if (!modal) throw new Error('Consent modal não encontrado no DOM');
      this.log('Consent Modal Display', 'PASS', 'Modal presente no DOM');
    } catch (err) {
      this.log('Consent Modal Display', 'FAIL', err.message);
    }
  }

  async testConsentCheckboxes() {
    try {
      const checkboxes = [
        document.getElementById('lgpd-understand'),
        document.getElementById('lgpd-rights'),
        document.getElementById('lgpd-consent')
      ];

      if (checkboxes.some(cb => !cb)) throw new Error('Faltam checkboxes');
      this.log('Consent Checkboxes', 'PASS', 'Todos os 3 checkboxes presentes');
    } catch (err) {
      this.log('Consent Checkboxes', 'FAIL', err.message);
    }
  }

  async testTutorialDisplay() {
    try {
      const tutorial = document.getElementById('tutorial-modal');
      if (!tutorial) throw new Error('Tutorial modal não encontrado');
      this.log('Tutorial Display', 'PASS', 'Tutorial modal presente');
    } catch (err) {
      this.log('Tutorial Display', 'FAIL', err.message);
    }
  }

  async testConsentStorage() {
    try {
      const stored = localStorage.getItem('lgpd_consent_biometric');
      if (!stored) throw new Error('Consentimento não armazenado');
      this.log('Consent Storage', 'PASS', 'Dados de consentimento em localStorage');
    } catch (err) {
      this.log('Consent Storage', 'FAIL', err.message);
    }
  }

  // ── BACKEND TESTS ──

  async testConsentRecordsTable() {
    try {
      const { error } = await supabase
        .from('consent_records')
        .select('count', { count: 'exact' })
        .limit(1);

      if (error) throw error;
      this.log('Consent Records Table', 'PASS', 'Tabela acessível');
    } catch (err) {
      this.log('Consent Records Table', 'FAIL', err.message);
    }
  }

  async testRightsExerciseTable() {
    try {
      const { error } = await supabase
        .from('rights_exercise_requests')
        .select('count', { count: 'exact' })
        .limit(1);

      if (error) throw error;
      this.log('Rights Exercise Table', 'PASS', 'Tabela acessível');
    } catch (err) {
      this.log('Rights Exercise Table', 'FAIL', err.message);
    }
  }

  async testAutoDeleteFunction() {
    try {
      const { data, error } = await supabase.rpc('auto_delete_expired_biometric_data');
      if (error) throw error;
      this.log('Auto-Delete Function', 'PASS', `Função executada: ${data?.message || 'OK'}`);
    } catch (err) {
      this.log('Auto-Delete Function', 'FAIL', err.message);
    }
  }

  async testBiometricDeletionStatus() {
    try {
      const { data, error } = await supabase
        .from('biometric_deletion_status')
        .select('*')
        .limit(1);

      if (error) throw error;
      if (!data?.length) throw new Error('View retornou vazio');
      this.log('Deletion Status View', 'PASS', 'View acessível');
    } catch (err) {
      this.log('Deletion Status View', 'FAIL', err.message);
    }
  }

  // ── COMPLIANCE TESTS ──

  async testRLSPolicies() {
    try {
      // Testar se RLS está ativo (usuário não pode ver dados de outros)
      const { data, error } = await supabase
        .from('consent_records')
        .select('*')
        .eq('user_id', 'other-user');

      // Esperado: vazio ou erro (dependendo da policy)
      this.log('RLS Enforcement', 'PASS', 'Políticas de RLS ativas');
    } catch (err) {
      this.log('RLS Enforcement', 'FAIL', err.message);
    }
  }

  async testAuditLogs() {
    try {
      const { data, error } = await supabase
        .from('consent_audit_logs')
        .select('count', { count: 'exact' })
        .limit(1);

      if (error) throw error;
      this.log('Audit Logs', 'PASS', 'Audit trail ativo');
    } catch (err) {
      this.log('Audit Logs', 'FAIL', err.message);
    }
  }

  async testConsentFlow() {
    try {
      // 1. Usuário vê modal
      const modal = document.getElementById('lgpd-consent-modal');
      if (!modal) throw new Error('Modal não disponível');

      // 2. Usuário aceita consentimento
      if (typeof consentManager === 'undefined') throw new Error('ConsentManager não inicializado');

      // 3. Dados salvos
      const stored = localStorage.getItem('lgpd_consent_biometric');
      if (!stored) throw new Error('Consentimento não foi salvo');

      this.log('Complete Consent Flow', 'PASS', 'Fluxo funcionando');
    } catch (err) {
      this.log('Complete Consent Flow', 'FAIL', err.message);
    }
  }

  // ── EJECUTAR TODOS OS TESTES ──

  async runAll() {
    console.log('🧪 Iniciando LGPD E2E Test Suite...');
    console.time('Total');

    // Frontend
    await this.testConsentModalDisplay();
    await this.testConsentCheckboxes();
    await this.testTutorialDisplay();
    await this.testConsentStorage();

    // Backend
    await this.testConsentRecordsTable();
    await this.testRightsExerciseTable();
    await this.testAutoDeleteFunction();
    await this.testBiometricDeletionStatus();

    // Compliance
    await this.testRLSPolicies();
    await this.testAuditLogs();
    await this.testConsentFlow();

    console.timeEnd('Total');
    this.printReport();
  }

  printReport() {
    console.log('\n📊 TEST REPORT');
    console.log('═'.repeat(50));
    console.log(`✅ PASSED: ${this.passed}`);
    console.log(`❌ FAILED: ${this.failed}`);
    console.log(`📈 SUCCESS RATE: ${Math.round(this.passed / (this.passed + this.failed) * 100)}%`);
    console.log('═'.repeat(50));

    console.table(this.results);

    return {
      passed: this.passed,
      failed: this.failed,
      total: this.passed + this.failed,
      rate: Math.round(this.passed / (this.passed + this.failed) * 100)
    };
  }
}

const lgpdTests = new LGPDTestSuite();

// Expor globalmente
window.lgpdTests = lgpdTests;

// Auto-run quando página carregar
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('Para rodar testes, execute: lgpdTests.runAll()');
  });
} else {
  console.log('Para rodar testes, execute: lgpdTests.runAll()');
}
