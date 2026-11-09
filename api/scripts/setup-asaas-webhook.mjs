// Cria o webhook no Asaas via API (alternativa à configuração no painel).
// Uso: ASAAS_API_KEY=… ASAAS_WEBHOOK_URL=https://seu-dominio/api/webhooks/asaas ASAAS_WEBHOOK_TOKEN=… \
//        [ASAAS_ENV=sandbox|production] node scripts/setup-asaas-webhook.mjs
// (ou, com um .env carregado no shell, só `node scripts/setup-asaas-webhook.mjs`).
import { AsaasClient } from '../saas/asaas/client.js';
import { resolveAsaasBaseUrl } from '../saas/asaas/config.js';

const apiKey = process.env.ASAAS_API_KEY;
const url = process.env.ASAAS_WEBHOOK_URL;
const token = process.env.ASAAS_WEBHOOK_TOKEN;
if (!apiKey || !url || !token) {
  console.error('Defina ASAAS_API_KEY, ASAAS_WEBHOOK_URL e ASAAS_WEBHOOK_TOKEN.');
  process.exit(1);
}
if (token.length < 32 || token.length > 255) {
  console.error('ASAAS_WEBHOOK_TOKEN deve ter entre 32 e 255 caracteres.');
  process.exit(1);
}
const env = process.env.ASAAS_ENV === 'production' ? 'production' : 'sandbox';
const client = new AsaasClient({ apiKey, baseUrl: resolveAsaasBaseUrl({ ASAAS_ENV: env, ASAAS_API_BASE_URL: process.env.ASAAS_API_BASE_URL }) });

try {
  const res = await client.createWebhook({
    name: 'CorpoFit AI',
    url,
    email: process.env.SUPPORT_EMAIL || 'suporte@exemplo.com.br',
    enabled: true,
    interrupted: false,
    apiVersion: 3,
    authToken: token,
    sendType: 'SEQUENTIALLY',
    events: [
      'PAYMENT_CREATED', 'PAYMENT_UPDATED', 'PAYMENT_CONFIRMED', 'PAYMENT_RECEIVED', 'PAYMENT_OVERDUE',
      'PAYMENT_REFUNDED', 'PAYMENT_DELETED', 'PAYMENT_RESTORED', 'PAYMENT_CREDIT_CARD_CAPTURE_REFUSED',
      'PAYMENT_REPROVED_BY_RISK_ANALYSIS', 'PAYMENT_CHARGEBACK_REQUESTED',
      'SUBSCRIPTION_CREATED', 'SUBSCRIPTION_UPDATED', 'SUBSCRIPTION_INACTIVATED', 'SUBSCRIPTION_DELETED',
      'CHECKOUT_CREATED', 'CHECKOUT_PAID', 'CHECKOUT_CANCELED', 'CHECKOUT_EXPIRED',
      'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CREATED', 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED',
      'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_CANCELLED', 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_EXPIRED',
      'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_REFUSED'
    ]
  });
  console.log('Webhook criado:', res.id);
} catch (e) {
  // Só a mensagem: a chave nunca é impressa.
  console.error('Não foi possível criar o webhook:', e instanceof Error ? e.message : e);
  process.exit(1);
}
