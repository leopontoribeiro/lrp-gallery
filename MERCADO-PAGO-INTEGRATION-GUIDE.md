# 🛒 Guia de Integração Mercado Pago - LRP Gallery

## Status: Pronto para Implementação ✅

---

## PARTE 1: PRÉ-REQUISITOS

### 1.1 Conta Mercado Pago
```
□ Criar conta em: https://www.mercadopago.com.br
□ Verificar email
□ Completar dados da empresa/pessoa física
□ Ativar conta de vendedor
□ Ir para: Configurações > Credenciais
```

### 1.2 Obter Credenciais

**Dentro do Painel do Mercado Pago:**

1. Clique em **Configurações** (⚙️ canto superior direito)
2. Acesse **Credenciais de integração**
3. Você verá 2 opções:
   - **Modo Teste** (para desenvolvimento)
   - **Modo Produção** (para vender de verdade)

4. Copie estas credenciais (salve em local seguro):
```
📌 MODO TESTE (Desenvolvimento)
├─ Public Key: APP_USR_XXXXXXXXXXX-XXXXX
└─ Access Token: APP_USR_XXXXXXXXXXX-XXXXX

📌 MODO PRODUÇÃO (Vendas Reais)
├─ Public Key: APP_USR_XXXXXXXXXXX-XXXXX
└─ Access Token: APP_USR_XXXXXXXXXXX-XXXXX
```

### 1.3 Dependências
```bash
# Node.js/React
npm install mercadopago

# Python (se backend em Python)
pip install mercado-pago --break-system-packages

# PHP (se backend em PHP)
composer require mercadopago/dx-php
```

---

## PARTE 2: CONFIGURAÇÃO BACKEND

### 2.1 Variáveis de Ambiente
```bash
# .env file
MERCADO_PAGO_PUBLIC_KEY=APP_USR_XXXXXXXXXXX-XXXXX
MERCADO_PAGO_ACCESS_TOKEN=APP_USR_XXXXXXXXXXX-XXXXX
MERCADO_PAGO_MODE=test  # Alterar para 'production' quando pronto
```

### 2.2 Inicializar SDK (Node.js)
```javascript
// config/mercadopago.js
const mercadopago = require('mercadopago');

mercadopago.configure({
  access_token: process.env.MERCADO_PAGO_ACCESS_TOKEN,
  integrator_id: 'dev_XXXXX' // Seu integrador ID
});

module.exports = mercadopago;
```

### 2.3 API de Criar Preferência (Pagamento)
```javascript
// routes/checkout.js
const express = require('express');
const mercadopago = require('../config/mercadopago');
const router = express.Router();

/**
 * POST /api/checkout/create-preference
 * Cria uma preferência de pagamento no Mercado Pago
 */
router.post('/create-preference', async (req, res) => {
  try {
    const { items, payer, externalReference } = req.body;

    // Validar dados obrigatórios
    if (!items || !payer || !payer.email) {
      return res.status(400).json({
        error: 'Dados obrigatórios faltando: items, payer.email'
      });
    }

    // Construir preferência
    const preference = {
      items: items.map(item => ({
        title: item.title,
        description: item.description,
        quantity: item.quantity || 1,
        currency_id: 'BRL',
        unit_price: item.unit_price
      })),
      payer: {
        name: payer.name || 'Cliente',
        email: payer.email,
        phone: payer.phone || { area_code: '11', number: '99999999' },
        identification: payer.identification || { type: 'CPF', number: '00000000000' },
        address: payer.address || { zip_code: '00000000', street_name: '', street_number: 0 }
      },
      back_urls: {
        success: `${process.env.FRONTEND_URL}/checkout/success`,
        failure: `${process.env.FRONTEND_URL}/checkout/failure`,
        pending: `${process.env.FRONTEND_URL}/checkout/pending`
      },
      auto_return: 'approved',
      external_reference: externalReference || `order-${Date.now()}`,
      notification_url: `${process.env.BACKEND_URL}/api/webhooks/mercadopago`,
      statement_descriptor: 'LRP GALLERY',
      expires: false
    };

    // Criar preferência no Mercado Pago
    const response = await mercadopago.preferences.create(preference);

    res.json({
      id: response.body.id,
      init_point: response.body.init_point,
      sandbox_init_point: response.body.sandbox_init_point
    });
  } catch (error) {
    console.error('Erro ao criar preferência:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
```

### 2.4 Webhook para Receber Pagamentos
```javascript
// routes/webhooks.js
const express = require('express');
const mercadopago = require('../config/mercadopago');
const router = express.Router();

/**
 * POST /api/webhooks/mercadopago
 * Recebe notificações de pagamento do Mercado Pago
 */
router.post('/mercadopago', async (req, res) => {
  try {
    const { type, data } = req.query;
    
    // Validar webhook (opcional mas recomendado)
    if (!type || !data.id) {
      return res.status(400).json({ error: 'Dados inválidos' });
    }

    // Buscar informação completa da transação
    const payment = await mercadopago.payment.findById(data.id);
    
    console.log('Notificação recebida:', {
      id: payment.body.id,
      status: payment.body.status,
      status_detail: payment.body.status_detail,
      external_reference: payment.body.external_reference,
      payer_email: payment.body.payer.email
    });

    // Processar pagamento conforme status
    switch (payment.body.status) {
      case 'approved':
        // ✅ Pagamento aprovado
        await processarPagamentoAprovado(payment.body);
        break;
      
      case 'pending':
        // ⏳ Pagamento pendente (análise)
        await processarPagamentoPendente(payment.body);
        break;
      
      case 'rejected':
        // ❌ Pagamento rejeitado
        await processarPagamentoRejeitado(payment.body);
        break;
      
      case 'cancelled':
        // ⛔ Pagamento cancelado
        await processarPagamentoCancelado(payment.body);
        break;
      
      case 'refunded':
        // 🔄 Reembolso processado
        await processarReembolso(payment.body);
        break;
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Erro ao processar webhook:', error);
    res.status(500).json({ error: error.message });
  }
});

// Funções de processamento
async function processarPagamentoAprovado(payment) {
  // Atualizar banco de dados
  const order = await Order.findByExternalReference(payment.external_reference);
  
  if (order) {
    order.status = 'PAID';
    order.payment_id = payment.id;
    order.payment_method = payment.payment_method_id;
    order.paid_at = new Date();
    await order.save();

    // Enviar email de confirmação
    await sendConfirmationEmail(order);

    // Disponibilizar fotos para download
    await unlockPhotosForDownload(order.gallery_id, order.visitor_id);
  }
}

async function processarPagamentoPendente(payment) {
  const order = await Order.findByExternalReference(payment.external_reference);
  if (order) {
    order.status = 'PENDING';
    order.payment_id = payment.id;
    await order.save();
  }
}

async function processarPagamentoRejeitado(payment) {
  const order = await Order.findByExternalReference(payment.external_reference);
  if (order) {
    order.status = 'FAILED';
    order.payment_id = payment.id;
    order.failure_reason = payment.status_detail;
    await order.save();
    
    // Notificar cliente
    await sendFailureEmail(order);
  }
}

async function processarPagamentoCancelado(payment) {
  const order = await Order.findByExternalReference(payment.external_reference);
  if (order) {
    order.status = 'CANCELLED';
    await order.save();
  }
}

async function processarReembolso(payment) {
  const order = await Order.findByExternalReference(payment.external_reference);
  if (order) {
    order.status = 'REFUNDED';
    order.refunded_at = new Date();
    await order.save();
    
    // Revogar acesso às fotos
    await revokePhotoAccess(order.gallery_id, order.visitor_id);
  }
}

module.exports = router;
```

### 2.5 Banco de Dados - Tabela de Pedidos
```sql
-- Criar tabela para rastrear pedidos/pagamentos
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  gallery_id UUID NOT NULL REFERENCES galleries(id),
  visitor_id VARCHAR(255) NOT NULL,
  visitor_email VARCHAR(255) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'PENDING', -- PENDING, PAID, FAILED, CANCELLED, REFUNDED
  payment_id VARCHAR(255),
  payment_method VARCHAR(50),
  amount DECIMAL(10, 2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'BRL',
  external_reference VARCHAR(255) UNIQUE,
  photo_ids UUID[] NOT NULL,
  unlock_code VARCHAR(50),
  created_at TIMESTAMP DEFAULT NOW(),
  paid_at TIMESTAMP,
  refunded_at TIMESTAMP,
  failure_reason TEXT,
  notes TEXT
);

-- Índices para performance
CREATE INDEX idx_orders_gallery_id ON orders(gallery_id);
CREATE INDEX idx_orders_visitor_email ON orders(visitor_email);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_payment_id ON orders(payment_id);
```

---

## PARTE 3: CONFIGURAÇÃO FRONTEND (React)

### 3.1 Componente de Checkout
```jsx
// components/CheckoutButton.jsx
import React, { useState } from 'react';

export function CheckoutButton({ photos, galleryId, visitorEmail }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleCheckout = async () => {
    setLoading(true);
    setError(null);

    try {
      // Preparar dados do pedido
      const items = [{
        title: `${photos.length} Fotos - LRP Gallery`,
        description: `Acesso às fotos do seu evento`,
        quantity: 1,
        unit_price: 49.90 // Preço em reais
      }];

      const payer = {
        name: 'Cliente',
        email: visitorEmail,
        phone: { area_code: '11', number: '99999999' },
        identification: { type: 'CPF', number: '00000000000' }
      };

      // Chamar API backend
      const response = await fetch('/api/checkout/create-preference', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items,
          payer,
          externalReference: `${galleryId}-${Date.now()}`
        })
      });

      if (!response.ok) {
        throw new Error('Erro ao criar preferência');
      }

      const preference = await response.json();

      // Redirecionar para Mercado Pago (modo teste ou produção)
      const checkoutUrl = process.env.REACT_APP_MERCADO_PAGO_MODE === 'production'
        ? preference.init_point
        : preference.sandbox_init_point;

      window.location.href = checkoutUrl;
    } catch (err) {
      setError(err.message);
      console.error('Erro:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleCheckout}
      disabled={loading}
      className="checkout-button"
    >
      {loading ? 'Redirecionando...' : '💳 Comprar Fotos'}
    </button>
  );
}
```

### 3.2 Página de Retorno (Success)
```jsx
// pages/CheckoutSuccess.jsx
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';

export function CheckoutSuccess() {
  const [searchParams] = useSearchParams();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const preferenceId = searchParams.get('preference_id');
    const paymentId = searchParams.get('payment_id');
    const status = searchParams.get('status');

    // Buscar dados do pedido no backend
    const fetchOrder = async () => {
      try {
        const response = await fetch(`/api/orders/${paymentId}`);
        const data = await response.json();
        setOrder(data);
      } catch (error) {
        console.error('Erro ao buscar pedido:', error);
      } finally {
        setLoading(false);
      }
    };

    if (paymentId) fetchOrder();
  }, [searchParams]);

  if (loading) return <div>Carregando...</div>;

  return (
    <div className="checkout-success">
      <h1>✅ Pagamento Aprovado!</h1>
      
      {order && (
        <>
          <p>Obrigado pela compra!</p>
          <p>ID do Pedido: {order.id}</p>
          <p>Valor: R$ {order.amount.toFixed(2)}</p>
          <p>Status: {order.status}</p>

          <h3>Próximos Passos:</h3>
          <ol>
            <li>Você receberá um email com link para acessar as fotos</li>
            <li>Ou use o código: <strong>{order.unlock_code}</strong></li>
            <li>As fotos ficarão disponíveis por 30 dias</li>
          </ol>

          <button onClick={() => window.location.href = '/gallery'}>
            Voltar à Galeria
          </button>
        </>
      )}
    </div>
  );
}
```

### 3.3 Página de Falha
```jsx
// pages/CheckoutFailure.jsx
import React from 'react';

export function CheckoutFailure() {
  return (
    <div className="checkout-failure">
      <h1>❌ Pagamento Não Aprovado</h1>
      <p>Desculpe, algo deu errado com seu pagamento.</p>
      
      <h3>O que fazer:</h3>
      <ul>
        <li>Verifique os dados de seu cartão</li>
        <li>Tente um método de pagamento diferente</li>
        <li>Contate suporte se o problema persistir</li>
      </ul>

      <button onClick={() => window.history.back()}>
        ← Voltar
      </button>
    </div>
  );
}
```

---

## PARTE 4: TESTES

### 4.1 Modo Teste - Cartões de Teste
```
CARTÃO DE CRÉDITO APROVADO (Teste)
├─ Número: 4235 6477 3272 0526
├─ Vencimento: 11/25
├─ CVV: 123
└─ Titular: APRO

CARTÃO RECUSADO (Teste)
├─ Número: 4235 6477 3272 0526
├─ Vencimento: 11/25
├─ CVV: 123
└─ Titular: OTHE (simula outros erros)

CARTÃO PENDENTE (Teste)
├─ Número: 4235 6477 3272 0526
├─ Vencimento: 11/25
├─ CVV: 123
└─ Titular: AUSE (simula análise)
```

### 4.2 Checklist de Testes
```
□ Criação de preferência (POST /api/checkout/create-preference)
□ Redirecionamento para Mercado Pago
□ Pagamento aprovado - webhook recebido
□ Pagamento recusado - email de falha
□ Pagamento pendente - status correto
□ Reembolso - acesso às fotos revogado
□ Email enviado com link de acesso
□ Código de desbloqueio funciona
□ Expiração de acesso após 30 dias
□ Dados no banco de dados corretos
```

### 4.3 Executar Testes
```bash
# Teste com curl (criar preferência)
curl -X POST http://localhost:3000/api/checkout/create-preference \
  -H "Content-Type: application/json" \
  -d '{
    "items": [{"title": "Fotos", "quantity": 1, "unit_price": 49.90}],
    "payer": {"email": "test@example.com", "name": "Teste"}
  }'

# Simular webhook (teste local)
curl -X POST http://localhost:3000/api/webhooks/mercadopago \
  '?type=payment&data.id=123456789'
```

---

## PARTE 5: MIGRAR PARA PRODUÇÃO

### 5.1 Checklist de Segurança
```
□ Remover cartões de teste do código
□ Usar variáveis de ambiente para credenciais
□ Ativar HTTPS em produção
□ Configurar webhook URL de produção
□ Ativar validação de webhook (assinatura)
□ Implementar rate limiting no checkout
□ Logs de pagamento centralizados
□ Backup de dados de pedidos
□ Plano de reembolso documentado
□ Suporte ao cliente configurado
```

### 5.2 Mudar para Modo Produção
```bash
# .env
MERCADO_PAGO_MODE=production  # Alterar de 'test'
MERCADO_PAGO_ACCESS_TOKEN=APP_USR_[Sua_Chave_Produção]
FRONTEND_URL=https://www.souleandroribeiro.com.br/gallery
BACKEND_URL=https://api.souleandroribeiro.com.br
```

### 5.3 Configurar Webhook em Produção
No painel do Mercado Pago:
```
1. Ir para Configurações > Webhooks
2. Adicionar URL: https://api.souleandroribeiro.com.br/api/webhooks/mercadopago
3. Selecionar eventos: payment, plan
4. Testar webhook
5. Salvar
```

---

## PARTE 6: SEGURANÇA E CONFORMIDADE

### 6.1 PCI DSS (Proteção de Cartões)
```
✅ FAZER:
├─ Nunca armazene dados de cartão no seu servidor
├─ Use redirecionamento seguro para Mercado Pago
├─ Implemente HTTPS em toda parte
├─ Registre logs de transações
└─ Monitore fraudes

❌ NUNCA FAZER:
├─ Nunca capture CVV do usuário
├─ Nunca armazene número completo do cartão
├─ Nunca envie dados de cartão não criptografados
└─ Nunca log dados sensíveis
```

### 6.2 Validação de Webhook
```javascript
// Validar assinatura do webhook (recomendado)
function validateWebhookSignature(req) {
  const xSignature = req.headers['x-signature'];
  const xRequestId = req.headers['x-request-id'];
  const timestamp = req.headers['x-timestamp'];
  
  // Implementar validação conforme documentação Mercado Pago
  return true; // Simplificado
}
```

### 6.3 Conformidade LGPD
```
✅ Dados coletados:
├─ Email (obrigatório)
├─ Nome (obrigatório)
├─ Telefone (opcional)
└─ CPF (obrigatório para Mercado Pago)

📋 Armazenamento:
├─ Dados criptografados em repouso
├─ Acesso restrito (logs auditados)
├─ Retenção: 3 anos (conforme lei fiscal)
└─ Exclusão: Usuário pode solicitar

🔐 Segurança:
├─ TLS 1.3 em trânsito
├─ Autenticação obrigatória
├─ Rate limiting ativo
└─ Monitoramento 24/7
```

---

## PARTE 7: FATURAMENTO E RELATÓRIOS

### 7.1 Consultar Transações no Mercado Pago
```javascript
// Buscar todas as transações
const transactions = await mercadopago.payment.search({
  qs: {
    range: 'date_created',
    begin_date: '2024-01-01T00:00:00.000-04:00',
    end_date: '2024-12-31T23:59:59.999-04:00',
    sort: 'date_created',
    criteria: 'desc',
    limit: 500
  }
});

console.log('Total de transações:', transactions.body.paging.total);
transactions.body.results.forEach(payment => {
  console.log(`${payment.date_created} - ${payment.status} - R$ ${payment.transaction_amount}`);
});
```

### 7.2 Gerar Relatório de Vendas
```javascript
// routes/reports.js
router.get('/sales-report', async (req, res) => {
  const { start_date, end_date } = req.query;

  try {
    const orders = await Order.findAll({
      where: {
        status: 'PAID',
        paid_at: { $between: [start_date, end_date] }
      }
    });

    const total = orders.reduce((sum, order) => sum + order.amount, 0);
    const count = orders.length;

    res.json({
      period: `${start_date} to ${end_date}`,
      total_orders: count,
      total_revenue: total.toFixed(2),
      average_order: (total / count).toFixed(2),
      orders
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

---

## PARTE 8: RESOLUÇÃO DE PROBLEMAS

### 8.1 Erros Comuns

| Erro | Causa | Solução |
|------|-------|--------|
| `Invalid credentials` | Credenciais incorretas | Verificar Access Token no painel |
| `Preference not found` | ID inválido | Validar resposta da API |
| `Webhook not received` | URL incorreta | Testar URL em Webhooks settings |
| `Payment declined` | Cartão recusado | Usar cartão de teste |
| `Rate limit exceeded` | Muitas requisições | Implementar retry com backoff |

### 8.2 Debug
```javascript
// Ativar logs detalhados
mercadopago.configure({
  access_token: process.env.MERCADO_PAGO_ACCESS_TOKEN,
  integrator_id: 'dev_XXXXX',
  logging: true // Ativar logs
});

// Log de webhook
console.log('Webhook recebido:', JSON.stringify(req.body, null, 2));
```

---

## PARTE 9: SUPORTE E DOCUMENTAÇÃO

### 9.1 Links Úteis
- 📚 Documentação: https://www.mercadopago.com.br/developers/pt/docs
- 🧪 Sandbox: https://sandbox.mercadopago.com.br
- 💬 Status: https://status.mercadopago.com.br
- 📞 Suporte: https://www.mercadopago.com.br/suporte

### 9.2 Contato Mercado Pago
- Email: developers@mercadopago.com
- Chat de suporte: Dentro do painel
- Documentação: https://developers.mercadopago.com/

---

## CHECKLIST FINAL DE IMPLEMENTAÇÃO

```
CONFIGURAÇÃO INICIAL
□ Conta criada no Mercado Pago
□ Credenciais obtidas (teste e produção)
□ Dependências instaladas
□ Variáveis de ambiente configuradas

BACKEND
□ SDK inicializado
□ API de criar preferência implementada
□ Webhook configurado
□ Banco de dados atualizado
□ Emails de confirmação implementados

FRONTEND
□ Componente CheckoutButton criado
□ Página de sucesso implementada
□ Página de falha implementada
□ Redirecionamento funciona

TESTES
□ Teste com cartão aprovado
□ Teste com cartão recusado
□ Teste com cartão pendente
□ Webhook recebe notificações
□ Email enviado com sucesso

PRODUÇÃO
□ Credenciais de produção configuradas
□ HTTPS ativado
□ Webhook URL atualizada
□ Testes finais passam
□ Suporte configurado
□ LGPD compliance verificado

MONITORAMENTO
□ Logs centralizados
□ Alertas configurados
□ Backup de dados
□ Plano de disaster recovery
```

---

## PRÓXIMOS PASSOS

1. **Hoje:** Criar conta e obter credenciais
2. **Amanhã:** Implementar backend (criar preferência + webhook)
3. **Dia 3:** Implementar frontend (botão + páginas de retorno)
4. **Dia 4:** Testes completos em modo teste
5. **Dia 5:** Migrar para produção

**Tempo estimado: 5 dias**

**Custo Mercado Pago:**
- Comissão: 3,99% + R$ 0,99 por transação
- Taxa de Boleto: 1,99%
- Taxa de PIX: 2,49%

---

**Dúvidas?** Contate suporte Mercado Pago ou consulte a documentação oficial.
