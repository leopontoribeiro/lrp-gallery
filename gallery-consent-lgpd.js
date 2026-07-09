// ========== GERENCIAMENTO DE CONSENTIMENTO LGPD ==========
// Módulo para integrar consent modal no gallery.html

const CONSENT_STORAGE_KEY = 'lgpd_consent_biometric';
const CONSENT_VERSION = '1.0';
const CONSENT_EXPIRY_DAYS = 365;

class ConsentManager {
    constructor() {
        this.consentData = null;
        this.loadConsent();
    }

    acceptConsent() {
        const consentRecord = {
            version: CONSENT_VERSION,
            accepted: true,
            timestamp: new Date().toISOString(),
            expiryDate: new Date(Date.now() + CONSENT_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString(),
            userIP: 'masked-' + Math.random().toString(36).substr(2, 9),
            userAgent: navigator.userAgent,
            checkboxes: {
                understand: document.getElementById('lgpd-understand')?.checked || false,
                rights: document.getElementById('lgpd-rights')?.checked || false,
                consent: document.getElementById('lgpd-consent')?.checked || false
            }
        };

        localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(consentRecord));
        this.consentData = consentRecord;

        // Salvar no Supabase também (se disponível)
        if (typeof sb !== 'undefined') {
            this.saveToSupabase(consentRecord);
        }

        return consentRecord;
    }

    rejectConsent() {
        const rejectRecord = {
            version: CONSENT_VERSION,
            accepted: false,
            timestamp: new Date().toISOString(),
            userIP: 'masked-' + Math.random().toString(36).substr(2, 9),
            userAgent: navigator.userAgent,
            reason: 'user_rejected'
        };

        localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(rejectRecord));
        this.consentData = rejectRecord;
        return rejectRecord;
    }

    loadConsent() {
        const stored = localStorage.getItem(CONSENT_STORAGE_KEY);
        if (stored) {
            this.consentData = JSON.parse(stored);
            return this.consentData;
        }
        return null;
    }

    isConsentValid() {
        if (!this.consentData) return false;
        if (!this.consentData.accepted) return false;

        const expiryDate = new Date(this.consentData.expiryDate);
        return expiryDate > new Date();
    }

    revokeConsent() {
        const revokeRecord = {
            version: CONSENT_VERSION,
            accepted: false,
            timestamp: new Date().toISOString(),
            revokedAt: new Date().toISOString(),
            reason: 'user_revoked',
            previousConsent: this.consentData
        };

        localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(revokeRecord));
        this.consentData = revokeRecord;
        return revokeRecord;
    }

    checkCompliance() {
        const checks = {
            hasConsentRecord: this.consentData !== null,
            isAccepted: this.consentData?.accepted === true,
            hasValidExpiry: this.consentData?.expiryDate !== undefined,
            isNotExpired: this.isConsentValid(),
            hasTimestamp: this.consentData?.timestamp !== undefined,
            hasUserIP: this.consentData?.userIP !== undefined,
            hasUserAgent: this.consentData?.userAgent !== undefined,
            hasCheckboxAudit: this.consentData?.checkboxes !== undefined
        };

        return {
            isCompliant: Object.values(checks).every(v => v === true) || (checks.hasConsentRecord && !checks.isAccepted),
            checks: checks,
            consentData: this.consentData
        };
    }

    async saveToSupabase(consentRecord) {
        try {
            const { error } = await sb.from('consent_records').insert([{
                consent_data: consentRecord,
                version: consentRecord.version,
                accepted: consentRecord.accepted,
                timestamp: consentRecord.timestamp
            }]);

            if (error) console.warn('Erro ao salvar consentimento no Supabase:', error);
        } catch (e) {
            console.warn('Supabase não disponível para consentimento:', e.message);
        }
    }

    clearAll() {
        localStorage.removeItem(CONSENT_STORAGE_KEY);
        this.consentData = null;
    }
}

// Instância global
const consentManager = new ConsentManager();

// ========== FUNÇÕES DO MODAL ==========
function showConsentModalIfNeeded() {
    if (!consentManager.isConsentValid()) {
        const modal = document.getElementById('lgpd-consent-modal');
        if (modal) {
            modal.style.display = 'flex';
            document.body.style.overflow = 'hidden';
        }
    }
}

function closeConsentModal() {
    const modal = document.getElementById('lgpd-consent-modal');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
}

function updateConsentAcceptButton() {
    const allChecked =
        document.getElementById('lgpd-understand')?.checked &&
        document.getElementById('lgpd-rights')?.checked &&
        document.getElementById('lgpd-consent')?.checked;

    const btn = document.getElementById('lgpd-acceptBtn');
    if (btn) {
        btn.disabled = !allChecked;
    }

    const requiredText = document.getElementById('lgpd-requiredText');
    if (requiredText) {
        requiredText.style.display = allChecked ? 'none' : 'block';
    }
}

function acceptConsentAndContinue() {
    const record = consentManager.acceptConsent();
    console.log('✅ Consentimento aceito:', record);
    closeConsentModal();

    // Disparar evento customizado para galeria saber que pode prosseguir
    window.dispatchEvent(new CustomEvent('consentAccepted', { detail: record }));
}

function rejectConsentModal() {
    const record = consentManager.rejectConsent();
    console.log('❌ Consentimento recusado:', record);
    closeConsentModal();

    // Mostrar mensagem que facial search não está disponível
    const msg = 'Reconhecimento facial requer consentimento. Você pode habilitar a qualquer momento no menu.';
    if (typeof toast === 'function') {
        toast(msg);
    } else {
        alert(msg);
    }
}

// Exportar para uso global
window.ConsentManager = ConsentManager;
window.consentManager = consentManager;
window.showConsentModalIfNeeded = showConsentModalIfNeeded;
window.closeConsentModal = closeConsentModal;
window.updateConsentAcceptButton = updateConsentAcceptButton;
window.acceptConsentAndContinue = acceptConsentAndContinue;
window.rejectConsentModal = rejectConsentModal;
