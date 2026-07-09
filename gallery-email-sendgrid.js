// ========== SENDGRID EMAIL SERVICE ==========
// Envia notificações de consentimento e direitos LGPD via email

const SENDGRID_API_KEY = localStorage.getItem('sendgrid_api_key') || '';
const SENDGRID_FROM_EMAIL = 'noreply@lrpgallery.com.br';
const SENDGRID_FROM_NAME = 'LRP Gallery - Privacidade';

class EmailService {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.sendgrid.com/v3/mail/send';
    }

    /**
     * Enviar email genérico
     */
    async sendEmail(to, subject, htmlContent) {
        if (!this.apiKey) {
            console.warn('SendGrid API key não configurada. Email não enviado.');
            return { success: false, error: 'API key não configurada' };
        }

        try {
            const response = await fetch(this.baseUrl, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    personalizations: [
                        {
                            to: [{ email: to }],
                            subject: subject
                        }
                    ],
                    from: {
                        email: SENDGRID_FROM_EMAIL,
                        name: SENDGRID_FROM_NAME
                    },
                    content: [
                        {
                            type: 'text/html',
                            value: htmlContent
                        }
                    ]
                })
            });

            if (response.ok) {
                console.log('✅ Email enviado com sucesso para:', to);
                return { success: true };
            } else {
                const error = await response.json();
                console.error('❌ Erro ao enviar email:', error);
                return { success: false, error: error.errors?.[0]?.message || 'Erro desconhecido' };
            }
        } catch (error) {
            console.error('❌ Erro de conexão ao enviar email:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Email de confirmação de consentimento
     */
    async sendConsentConfirmation(email, consentData) {
        const timestamp = new Date(consentData.timestamp).toLocaleString('pt-BR');
        const expiryDate = new Date(consentData.expiryDate).toLocaleDateString('pt-BR');

        const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; background: #f9f9f9; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center; }
        .content { background: white; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: #f0f7ff; border-left: 4px solid #667eea; padding: 15px; margin: 20px 0; border-radius: 4px; }
        .footer { background: #f5f5f5; padding: 20px; text-align: center; font-size: 12px; color: #666; margin-top: 20px; }
        .btn { display: inline-block; background: #667eea; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>✅ Consentimento Confirmado</h1>
            <p>Reconhecimento Facial na LRP Gallery</p>
        </div>
        <div class="content">
            <p>Olá,</p>
            <p>Seu consentimento para uso de reconhecimento facial foi <strong>registrado com sucesso</strong>.</p>

            <div class="info-box">
                <strong>📋 Detalhes do Consentimento:</strong><br>
                • Data: ${timestamp}<br>
                • Válido até: ${expiryDate}<br>
                • Status: ✅ Aceito
            </div>

            <h3>🔐 Seus Dados Estão Protegidos</h3>
            <p>Sua selfie é criptografada com AES-256 e armazenada em servidores seguros, em conformidade total com a LGPD.</p>

            <h3>⏰ Tempo de Retenção</h3>
            <p>Seus dados biométricos serão mantidos por <strong>180 dias</strong>. Após esse período, serão automaticamente deletados.</p>

            <h3>✋ Seus Direitos LGPD</h3>
            <p>Você pode:</p>
            <ul>
                <li><strong>Acessar:</strong> Solicitar cópia de seus dados</li>
                <li><strong>Revogar:</strong> Cancelar o consentimento a qualquer hora</li>
                <li><strong>Deletar:</strong> Solicitar exclusão imediata</li>
                <li><strong>Corrigir:</strong> Atualizar informações</li>
            </ul>

            <p style="margin-top: 30px;">
                <a href="https://www.souleandroribeiro.com.br/gallery/privacidade" class="btn">Ver Política de Privacidade</a>
            </p>

            <p style="margin-top: 30px; font-size: 14px; color: #666;">
                Dúvidas? Entre em contato conosco:<br>
                📧 Email: privacidade@lrpgallery.com.br<br>
                📞 Telefone: +55 21 98326-7661<br>
                🕐 Horário: Seg-Sex, 9h-18h
            </p>
        </div>
        <div class="footer">
            <p>© 2026 LRP Gallery - Fotografia de Eventos. Todos os direitos reservados.</p>
            <p>Este é um email automático. Não responda diretamente.</p>
        </div>
    </div>
</body>
</html>
        `;

        return this.sendEmail(email, '✅ Consentimento Confirmado - LRP Gallery', html);
    }

    /**
     * Email de revogação de consentimento
     */
    async sendConsentRevocation(email, revokeData) {
        const timestamp = new Date(revokeData.revokedAt).toLocaleString('pt-BR');

        const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; background: #f9f9f9; }
        .header { background: linear-gradient(135deg, #ff6b6b 0%, #ee5a6f 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center; }
        .content { background: white; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: #ffe8e8; border-left: 4px solid #ff6b6b; padding: 15px; margin: 20px 0; border-radius: 4px; }
        .footer { background: #f5f5f5; padding: 20px; text-align: center; font-size: 12px; color: #666; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>⚠️ Consentimento Revogado</h1>
            <p>Seu consentimento foi cancelado</p>
        </div>
        <div class="content">
            <p>Olá,</p>
            <p>Seu consentimento para reconhecimento facial foi <strong>revogado com sucesso</strong> em ${timestamp}.</p>

            <div class="info-box">
                <strong>📋 O que acontece agora:</strong><br>
                • Você não poderá usar a busca por rosto<br>
                • Seus dados biométricos continuarão válidos até o fim do período de retenção<br>
                • Você pode reativar o consentimento a qualquer momento
            </div>

            <p style="margin-top: 30px; font-size: 14px; color: #666;">
                Dúvidas? Entre em contato:<br>
                📧 Email: privacidade@lrpgallery.com.br<br>
                📞 Telefone: +55 21 98326-7661
            </p>
        </div>
        <div class="footer">
            <p>© 2026 LRP Gallery</p>
        </div>
    </div>
</body>
</html>
        `;

        return this.sendEmail(email, '⚠️ Consentimento Revogado - LRP Gallery', html);
    }

    /**
     * Email de notificação de direitos LGPD
     */
    async sendRightsExerciseRequest(email, requestType, requestData) {
        const timestamp = new Date().toLocaleString('pt-BR');

        const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; background: #f9f9f9; }
        .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 10px 10px 0 0; text-align: center; }
        .content { background: white; padding: 30px; border-radius: 0 0 10px 10px; }
        .info-box { background: #f0fff4; border-left: 4px solid #26de81; padding: 15px; margin: 20px 0; border-radius: 4px; }
        .footer { background: #f5f5f5; padding: 20px; text-align: center; font-size: 12px; color: #666; margin-top: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>📋 Direito LGPD Recebido</h1>
            <p>Sua solicitação foi registrada</p>
        </div>
        <div class="content">
            <p>Olá,</p>
            <p>Recebemos sua solicitação de <strong>${requestType}</strong> em ${timestamp}.</p>

            <div class="info-box">
                <strong>✅ Próximos Passos:</strong><br>
                • Sua solicitação foi registrada em nosso sistema<br>
                • Você receberá uma resposta em até <strong>15 dias úteis</strong><br>
                • ID da solicitação: ${requestData.id || 'Pendente'}
            </div>

            <p>Se tiver dúvidas, responda este email ou entre em contato através de nossa Central de Privacidade.</p>
        </div>
        <div class="footer">
            <p>© 2026 LRP Gallery</p>
        </div>
    </div>
</body>
</html>
        `;

        return this.sendEmail(email, `📋 Solicitação de ${requestType} - LRP Gallery`, html);
    }
}

// Instância global
const emailService = new EmailService(SENDGRID_API_KEY);

// Exportar para uso global
window.EmailService = EmailService;
window.emailService = emailService;

// Listener: Enviar email de confirmação quando consentimento é aceito
window.addEventListener('consentAccepted', async (e) => {
    const email = localStorage.getItem('user_email');
    if (email && emailService.apiKey) {
        await emailService.sendConsentConfirmation(email, e.detail);
    }
});
