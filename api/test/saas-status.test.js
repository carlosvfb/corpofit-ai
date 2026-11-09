import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import './saas-helpers.mjs';
import { applyPaymentToSubscription, mapAsaasPaymentStatus, paymentStatusFromEvent } from '../saas/asaas/status.js';
import { computeEntitlements, subscriptionGrantsPremium } from '../saas/entitlements.js';
import { isValidCpfCnpj } from '../saas/asaas/checkout.js';
import { resolveAsaasBaseUrl } from '../saas/asaas/config.js';
import { PLANS } from '../saas/plans.js';

const now = new Date('2026-11-08T12:00:00Z');
const day = 86_400_000;

describe('mapeamento de status do Asaas', () => {
  test('converte status de cobrança', () => {
    assert.equal(mapAsaasPaymentStatus('CONFIRMED'), 'CONFIRMED');
    assert.equal(mapAsaasPaymentStatus('RECEIVED'), 'RECEIVED');
    assert.equal(mapAsaasPaymentStatus('OVERDUE'), 'OVERDUE');
    assert.equal(mapAsaasPaymentStatus('REFUNDED'), 'REFUNDED');
    assert.equal(mapAsaasPaymentStatus('CHARGEBACK_REQUESTED'), 'REFUNDED');
    assert.equal(mapAsaasPaymentStatus('PENDING'), 'PENDING');
    assert.equal(mapAsaasPaymentStatus('AWAITING_RISK_ANALYSIS'), 'PENDING');
  });
  test('converte eventos', () => {
    assert.equal(paymentStatusFromEvent('PAYMENT_CREATED'), 'PENDING');
    assert.equal(paymentStatusFromEvent('PAYMENT_CREDIT_CARD_CAPTURE_REFUSED'), 'REFUSED');
    assert.equal(paymentStatusFromEvent('PAYMENT_DELETED'), 'CANCELED');
    assert.equal(paymentStatusFromEvent('PAYMENT_BANK_SLIP_VIEWED'), null);
  });
});

describe('transições da assinatura', () => {
  const pending = { status: 'PENDING', currentPeriodEnd: null, graceUntil: null };
  test('cobrança criada/pendente NÃO ativa a assinatura', () => {
    assert.equal(applyPaymentToSubscription(pending, { status: 'PENDING', dueDate: now }, now, 3).status, 'PENDING');
  });
  test('cobrança confirmada ativa e define o fim do período', () => {
    const r = applyPaymentToSubscription(pending, { status: 'CONFIRMED', dueDate: now }, now, 3);
    assert.equal(r.status, 'ACTIVE');
    assert.ok(r.currentPeriodEnd.getTime() > now.getTime() + 27 * day);
  });
  test('vencimento de assinatura ativa abre tolerância; pendente inicial vencida segue pendente', () => {
    const active = { status: 'ACTIVE', currentPeriodEnd: new Date(now.getTime() + day), graceUntil: null };
    const r = applyPaymentToSubscription(active, { status: 'OVERDUE', dueDate: now }, now, 3);
    assert.equal(r.status, 'PAST_DUE');
    assert.equal(r.graceUntil.getTime(), now.getTime() + 3 * day);
    assert.equal(applyPaymentToSubscription(pending, { status: 'OVERDUE', dueDate: now }, now, 3).status, 'PENDING');
  });
  test('pagamento posterior regulariza PAST_DUE', () => {
    const pd = { status: 'PAST_DUE', currentPeriodEnd: now, graceUntil: new Date(now.getTime() + day) };
    const r = applyPaymentToSubscription(pd, { status: 'RECEIVED', dueDate: now }, now, 3);
    assert.equal(r.status, 'ACTIVE');
    assert.equal(r.graceUntil, null);
  });
  test('estorno suspende e assinatura cancelada não reativa', () => {
    const active = { status: 'ACTIVE', currentPeriodEnd: new Date(now.getTime() + 20 * day), graceUntil: null };
    assert.equal(applyPaymentToSubscription(active, { status: 'REFUNDED', dueDate: now }, now, 3).status, 'SUSPENDED');
    const canceled = { status: 'CANCELED', currentPeriodEnd: now, graceUntil: null };
    assert.equal(applyPaymentToSubscription(canceled, { status: 'RECEIVED', dueDate: now }, now, 3), canceled);
  });
});

describe('política de acesso Premium', () => {
  const u = { manualPremium: false, manualPremiumUntil: null };
  test('gratuito por padrão', () => {
    assert.equal(computeEntitlements(u, [], now, 3).isPremium, false);
  });
  test('PENDING/EXPIRED/SUSPENDED não concedem', () => {
    for (const status of ['PENDING', 'EXPIRED', 'SUSPENDED']) {
      assert.equal(subscriptionGrantsPremium({ status, currentPeriodEnd: new Date(now.getTime() + day), graceUntil: null }, now, 3), false);
    }
  });
  test('ACTIVE respeita período + tolerância', () => {
    const end = new Date(now.getTime() - 2 * day);
    assert.equal(subscriptionGrantsPremium({ status: 'ACTIVE', currentPeriodEnd: end, graceUntil: null }, now, 3), true);
    assert.equal(subscriptionGrantsPremium({ status: 'ACTIVE', currentPeriodEnd: end, graceUntil: null }, now, 1), false);
  });
  test('PAST_DUE vale só dentro da tolerância; CANCELED vale até o fim do período pago', () => {
    assert.equal(subscriptionGrantsPremium({ status: 'PAST_DUE', currentPeriodEnd: null, graceUntil: new Date(now.getTime() + day) }, now, 3), true);
    assert.equal(subscriptionGrantsPremium({ status: 'PAST_DUE', currentPeriodEnd: null, graceUntil: new Date(now.getTime() - day) }, now, 3), false);
    assert.equal(subscriptionGrantsPremium({ status: 'CANCELED', currentPeriodEnd: new Date(now.getTime() + 5 * day), graceUntil: null }, now, 3), true);
    assert.equal(subscriptionGrantsPremium({ status: 'CANCELED', currentPeriodEnd: new Date(now.getTime() - day), graceUntil: null }, now, 3), false);
  });
  test('concessão manual temporária expira', () => {
    assert.equal(computeEntitlements({ manualPremium: true, manualPremiumUntil: new Date(now.getTime() + day) }, [], now, 3).isPremium, true);
    assert.equal(computeEntitlements({ manualPremium: true, manualPremiumUntil: new Date(now.getTime() - day) }, [], now, 3).isPremium, false);
  });
  test('o preço e os limites vêm só do backend', () => {
    assert.equal(PLANS.PREMIUM.priceCents, 2990);
    assert.ok(PLANS.PREMIUM.limits.aiMessagesPerMonth > PLANS.FREE.limits.aiMessagesPerMonth);
    assert.equal(PLANS.FREE.features.periodComparison, false);
  });
});

describe('utilitários', () => {
  test('valida CPF/CNPJ', () => {
    assert.equal(isValidCpfCnpj('529.982.247-25'), true);
    assert.equal(isValidCpfCnpj('111.111.111-11'), false);
    assert.equal(isValidCpfCnpj('123.456.789-00'), false);
    assert.equal(isValidCpfCnpj('11.222.333/0001-81'), true);
    assert.equal(isValidCpfCnpj('11.222.333/0001-82'), false);
  });
  test('escolhe a URL base conforme o ambiente', () => {
    assert.equal(resolveAsaasBaseUrl({ ASAAS_ENV: 'sandbox' }), 'https://api-sandbox.asaas.com/v3');
    assert.equal(resolveAsaasBaseUrl({ ASAAS_ENV: 'production' }), 'https://api.asaas.com/v3');
    assert.equal(resolveAsaasBaseUrl({ ASAAS_ENV: 'sandbox', ASAAS_API_BASE_URL: 'https://x.test/v3/' }), 'https://x.test/v3');
  });
});
