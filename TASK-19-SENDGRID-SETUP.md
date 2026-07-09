# 📧 TASK #19: Setup SendGrid Email Notifications

## Status: ⏳ Em Execução

Sistema de envio de emails para notificações de consentimento LGPD.

---

## 🔧 PASSO 1: Criar Conta SendGrid

1. Acesse: **https://sendgrid.com**
2. Clique em **"Sign Up"**
3. Preencha os dados:
   - Nome: `LRP Gallery`
   - Email: `seu-email@souleandroribeiro.com.br`
   - Empresa: `LRP Gallery`
4. Verifique o email
5. Complete o onboarding

---

## 🔑 PASSO 2: Obter API Key

1. No painel SendGrid, acesse: **Settings → API Keys**
2. Clique em **"Create API Key"**
3. Preencha:
   - Name: `Gallery Email Service`
   - API Key Permissions: `Full Access` (ou selecione apenas `Mail Send`)
4. Clique em **"Create & View"**
5. **COPIE E SALVE** a chave em local seguro

Formato: `SG.XXXX_XXXX_XXXX`

---

## 📌 PASSO 3: Configurar Email Remetente

1. Acesse: **Settings → Sender Authentication**
2. Clique em **"Authenticate Your Domain"** (ou "Verify a Single Sender")
3. Use:
   - From Email: `noreply@lrpgallery.com.br`
   - From Name: `LRP Gallery - Privacidade`
   - Reply To: `privacidade@souleandroribeiro.com.br`

### Opção A: Domain Authentication (Recomendado)
- Seguir instruções para adicionar registros DNS
- Leva ~24 horas para validar
- Melhor para domínios próprios

### Opção B: Single Sender Verification
- Mais rápido (imediato)
- Funciona com qualquer email

---

## 💾 PASSO 4: Configurar no Gallery

### No localStorage (para testes):
```javascript
localStorage.setItem('sendgrid_api_key', 'SG.sua_chave_aqui');
localStorage.setItem('user_email', 'email@visitante.com');
```

### No Supabase (para produção):
```sql
-- Adicionar à tabela app_secrets
insert into public.app_secrets(key, value) values
  ('sendgrid_api_key', 'SG.sua_chave_aqui'),
  ('sendgrid_from_email', 'noreply@lrpgallery.com.br')
on conflict (key) do update set value = excluded.value;
```

---

## 📨 PASSO 5: Integrar no Gallery

1. Adicionar import no `gallery.html`:
```html
<script src="gallery-email-sendgrid.js"></script>
```

2. Já está integrado em:
   - ✅ `acceptConsentAndContinue()` - envia confirmação
   - ✅ `rejectConsentModal()` - pode adicionar notificação
   - ✅ `revokeConsent()` - envia notificação de revogação

---

## 🧪 TESTES

### Test 1: Enviar Email de Consentimento
```javascript
emailService.sendConsentConfirmation('seu-email@example.com', {
  timestamp: new Date().toISOString(),
  expiryDate: new Date(Date.now() + 365*24*60*60*1000).toISOString(),
  accepted: true
});
```

### Test 2: Verificar API Key
```javascript
console.log('API Key configurada:', emailService.apiKey ? '✅' : '❌');
console.log('Length:', emailService.apiKey.length);
```

### Test 3: Ver Emails Enviados
1. No painel SendGrid: **Mail → Inbox**
2. Filtrar por destinatário
3. Clicar em email para ver detalhes

---

## ✅ Checklist

- [ ] Conta SendGrid criada
- [ ] API Key gerada
- [ ] Email remetente verificado
- [ ] API Key salva no app_secrets do Supabase
- [ ] gallery-email-sendgrid.js carregado no HTML
- [ ] Teste de envio bem-sucedido
- [ ] Email de consentimento recebido
- [ ] Link de privacidade funciona no email

---

## 🐛 Troubleshooting

### "Email não foi enviado"
- ✓ Verificar se API key está configurada
- ✓ Verificar se email remetente foi verificado
- ✓ Verificar quota SendGrid (free: 100 emails/dia)
- ✓ Ver logs no console do navegador

### "CORS error"
- SendGrid API rejeita requests direto do navegador
- **Solução**: Criar Edge Function no Supabase como proxy

### "Email foi para spam"
- Autenticar domínio (domain authentication)
- Adicionar SPF/DKIM/DMARC records
- Usar email dedicado (não pessoal)

---

## 📱 Templates de Email

Arquivo: `gallery-email-sendgrid.js`

Métodos disponíveis:
- `sendConsentConfirmation()` - Confirmação de consentimento
- `sendConsentRevocation()` - Revogação de consentimento
- `sendRightsExerciseRequest()` - Notificação de direitos exercidos
- `sendEmail()` - Genérico

---

## 🚀 Próximos Passos

1. Configurar como proxy no Supabase (se receber CORS error)
2. Adicionar templates adicionais:
   - Email de exclusão de dados
   - Email de portabilidade
   - Email de resposta a direitos
3. Setup de webhooks para rastrear delivery

---

**Status:** Pronto para implementação  
**Arquivo:** `/Users/eusouleandroribeiro/lrp-gallery/gallery-email-sendgrid.js`  
**Próximo:** Task #20 (Auto-delete dados biométricos)
