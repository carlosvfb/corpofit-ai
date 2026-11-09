import { beforeEach, describe } from 'node:test';
import test from 'node:test';
import assert from 'node:assert/strict';
import { asaasPayment, db, dbTest, makeSubscription, makeUser, mock, resetDb } from './saas-helpers.mjs';
import { AsaasWebhookService, WebhookValidationError, verifyWebhookToken } from '../saas/asaas/webhook.js';
import { PrismaBillingRepository } from '../saas/asaas/repository.js';
import { getEntitlements } from '../saas/access.js';

const NOW = new Date('2026-11-08T12:00:00Z');

function setup(remotePayment = asaasPayment({ status: 'RECEIVED' })) {
  const client = {
    getPayment: mock(async () => remotePayment),
    getSubscription: mock(async () => ({ id: 'sub_1', customer: 'cus_1', status: 'ACTIVE', checkoutSession: 'chk_1' }))
  };
  return { client, service: new AsaasWebhookService(new PrismaBillingRepository(), client, () => NOW) };
}
const payEvent = (id, event, payment = asaasPayment()) => ({ id, event, dateCreated: '2026-11-08 12:00:00', payment });

describe('webhook do Asaas', () => {
  beforeEach(async () => { if (db) await resetDb(); });

  test('valida o token em tempo constante', () => {
    assert.equal(verifyWebhookToken('abc', 'abc'), true);
    assert.equal(verifyWebhookToken('abd', 'abc'), false);
    assert.equal(verifyWebhookToken(null, 'abc'), false);
    assert.equal(verifyWebhookToken('abc', undefined), false);
  });

  dbTest('rejeita estrutura inválida', async () => {
    await assert.rejects(setup().service.handle({ foo: 1 }), WebhookValidationError);
  });

  dbTest('pagamento confirmado libera Premium (após verificar na API)', async () => {
    const user = await makeUser();
    await makeSubscription(user.id, { asaasSubscriptionId: 'sub_1' });
    const { service, client } = setup(asaasPayment({ status: 'RECEIVED' }));
    assert.equal((await getEntitlements(user)).isPremium, false);

    const r = await service.handle(payEvent('evt_1', 'PAYMENT_RECEIVED'));
    assert.equal(r.outcome, 'processed');
    assert.deepEqual(client.getPayment.calls[0], ['pay_1']);
    assert.equal((await db.subscription.findFirstOrThrow({ where: { userId: user.id } })).status, 'ACTIVE');
    const pay = await db.payment.findUniqueOrThrow({ where: { asaasPaymentId: 'pay_1' } });
    assert.equal(pay.status, 'RECEIVED');
    assert.equal(pay.isInitial, true);
    assert.equal(pay.valueCents, 2990);
    assert.equal((await getEntitlements(user)).isPremium, true);
  });

  dbTest('evento duplicado não é reprocessado', async () => {
    const user = await makeUser();
    await makeSubscription(user.id, { asaasSubscriptionId: 'sub_1' });
    const { service, client } = setup();
    await service.handle(payEvent('evt_dup', 'PAYMENT_RECEIVED'));
    const again = await service.handle(payEvent('evt_dup', 'PAYMENT_RECEIVED'));
    assert.equal(again.outcome, 'duplicate');
    assert.equal(client.getPayment.calls.length, 1);
    assert.equal(await db.payment.count(), 1);
    assert.equal(await db.paymentEvent.count({ where: { externalEventId: 'evt_dup' } }), 1);
  });

  dbTest('evento fora de ordem: a API diz PENDING, então NÃO libera Premium', async () => {
    const user = await makeUser();
    await makeSubscription(user.id, { asaasSubscriptionId: 'sub_1' });
    const { service } = setup(asaasPayment({ status: 'PENDING' }));
    await service.handle(payEvent('evt_ooo', 'PAYMENT_CONFIRMED'));
    assert.equal((await db.subscription.findFirstOrThrow({ where: { userId: user.id } })).status, 'PENDING');
    assert.equal((await getEntitlements(user)).isPremium, false);
  });

  dbTest('cobrança criada e CHECKOUT_PAID não liberam Premium', async () => {
    const user = await makeUser();
    await makeSubscription(user.id, { asaasSubscriptionId: 'sub_1', asaasCheckoutId: 'chk_1' });
    const { service } = setup();
    await service.handle(payEvent('evt_c', 'PAYMENT_CREATED'));
    await service.handle({ id: 'evt_chk', event: 'CHECKOUT_PAID', checkout: { id: 'chk_1', status: 'PAID' } });
    assert.equal((await db.subscription.findFirstOrThrow({ where: { userId: user.id } })).status, 'PENDING');
    assert.equal((await getEntitlements(user)).isPremium, false);
  });

  dbTest('vincula assinatura criada por checkout hospedado (checkoutSession) e ativa após pagamento', async () => {
    const user = await makeUser();
    await makeSubscription(user.id, { asaasCheckoutId: 'chk_1' });
    const { service } = setup(asaasPayment({ status: 'CONFIRMED', subscription: 'sub_1' }));
    await service.handle(payEvent('evt_link', 'PAYMENT_CONFIRMED'));
    const sub = await db.subscription.findFirstOrThrow({ where: { userId: user.id } });
    assert.equal(sub.asaasSubscriptionId, 'sub_1');
    assert.equal(sub.status, 'ACTIVE');
  });

  dbTest('vencimento de assinatura ativa coloca em PAST_DUE com tolerância', async () => {
    const user = await makeUser();
    await makeSubscription(user.id, { asaasSubscriptionId: 'sub_1', status: 'ACTIVE', currentPeriodEnd: new Date(NOW.getTime() + 86_400_000) });
    const { service } = setup();
    await service.handle(payEvent('evt_od', 'PAYMENT_OVERDUE', asaasPayment({ id: 'pay_2', status: 'OVERDUE' })));
    const sub = await db.subscription.findFirstOrThrow({ where: { userId: user.id } });
    assert.equal(sub.status, 'PAST_DUE');
    assert.notEqual(sub.graceUntil, null);
    assert.equal((await getEntitlements(user)).isPremium, true);
  });

  dbTest('estorno suspende o Premium', async () => {
    const user = await makeUser();
    await makeSubscription(user.id, { asaasSubscriptionId: 'sub_1', status: 'ACTIVE', currentPeriodEnd: new Date(NOW.getTime() + 20 * 86_400_000) });
    const { service } = setup(asaasPayment({ status: 'REFUNDED' }));
    await service.handle(payEvent('evt_rf', 'PAYMENT_REFUNDED'));
    assert.equal((await db.subscription.findFirstOrThrow({ where: { userId: user.id } })).status, 'SUSPENDED');
    assert.equal((await getEntitlements(user)).isPremium, false);
  });

  dbTest('cobrança de assinatura desconhecida é ignorada', async () => {
    const { service } = setup();
    const r = await service.handle(payEvent('evt_x', 'PAYMENT_CREATED', asaasPayment({ subscription: 'sub_nope', customer: 'cus_nope' })));
    assert.equal(r.outcome, 'ignored');
    assert.equal(await db.payment.count(), 0);
  });

  dbTest('falha de processamento marca o evento como FAILED e permite reentrega', async () => {
    const user = await makeUser();
    await makeSubscription(user.id, { asaasSubscriptionId: 'sub_1' });
    const { service, client } = setup();
    client.getPayment.onceRejects(new Error('timeout'));
    await assert.rejects(service.handle(payEvent('evt_retry', 'PAYMENT_RECEIVED')));
    assert.equal((await db.paymentEvent.findUniqueOrThrow({ where: { externalEventId: 'evt_retry' } })).status, 'FAILED');
    const r = await service.handle(payEvent('evt_retry', 'PAYMENT_RECEIVED'));
    assert.equal(r.outcome, 'processed');
    assert.equal((await db.paymentEvent.findUniqueOrThrow({ where: { externalEventId: 'evt_retry' } })).status, 'PROCESSED');
  });

  dbTest('assinatura deletada cancela mantendo o período pago', async () => {
    const user = await makeUser();
    const end = new Date(NOW.getTime() + 10 * 86_400_000);
    await makeSubscription(user.id, { asaasSubscriptionId: 'sub_1', status: 'ACTIVE', currentPeriodEnd: end });
    await setup().service.handle({ id: 'evt_sd', event: 'SUBSCRIPTION_DELETED', subscription: { id: 'sub_1' } });
    const sub = await db.subscription.findFirstOrThrow({ where: { userId: user.id } });
    assert.equal(sub.status, 'CANCELED');
    assert.equal(sub.currentPeriodEnd.getTime(), end.getTime());
  });

  dbTest('Pix Automático: ATIVAÇÃO não libera; recusa expira a pendência; pagamento libera', async () => {
    const user = await makeUser();
    await makeSubscription(user.id, { paymentMethod: 'PIX_AUTOMATIC', asaasAuthorizationId: 'auth_1', asaasSubscriptionId: 'sub_1' });
    const { service } = setup(asaasPayment({ status: 'RECEIVED', billingType: 'PIX' }));
    await service.handle({ id: 'evt_a1', event: 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_ACTIVATED', authorization: { id: 'auth_1', status: 'ACTIVE' } });
    assert.equal((await db.subscription.findFirstOrThrow({ where: { userId: user.id } })).status, 'PENDING');
    await service.handle(payEvent('evt_a2', 'PAYMENT_RECEIVED'));
    assert.equal((await db.subscription.findFirstOrThrow({ where: { userId: user.id } })).status, 'ACTIVE');

    const u2 = await makeUser();
    await makeSubscription(u2.id, { paymentMethod: 'PIX_AUTOMATIC', asaasAuthorizationId: 'auth_2' });
    await service.handle({ id: 'evt_a3', event: 'PIX_AUTOMATIC_RECURRING_AUTHORIZATION_REFUSED', authorization: { id: 'auth_2', status: 'REFUSED' } });
    assert.equal((await db.subscription.findFirstOrThrow({ where: { userId: u2.id } })).status, 'EXPIRED');
  });
});
