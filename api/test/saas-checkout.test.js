import { beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { db, dbTest, makeSubscription, makeUser, mock, resetDb } from './saas-helpers.mjs';
import { setSetting } from '../saas/access.js';
import { AsaasCheckoutService, BillingError } from '../saas/asaas/checkout.js';
import { cancelSubscription } from '../saas/asaas/cancel.js';
import { AsaasApiError, AsaasTimeoutError } from '../saas/asaas/client.js';

const CPF = '529.982.247-25';
const NOW = new Date('2026-11-08T12:00:00Z');

function fakeClient(over = {}) {
  return {
    listCustomers: mock(async () => ({ data: [] })),
    createCustomer: mock(async () => ({ id: 'cus_1' })),
    createCheckout: mock(async () => ({ id: 'chk_1', link: 'https://sandbox.asaas.com/checkoutSession/show?id=chk_1' })),
    createSubscription: mock(async () => ({ id: 'sub_1', customer: 'cus_1', status: 'ACTIVE' })),
    listSubscriptions: mock(async () => ({ data: [] })),
    listSubscriptionPayments: mock(async () => ({
      data: [{ id: 'pay_1', customer: 'cus_1', subscription: 'sub_1', status: 'PENDING', value: 29.9, dueDate: '2026-11-08' }]
    })),
    getPixQrCode: mock(async () => ({ payload: '000201...pix', encodedImage: 'BASE64', expirationDate: '2026-11-09 12:00:00' })),
    deleteSubscription: mock(async () => ({ deleted: true, id: 'sub_1' })),
    createPixAutomaticAuthorization: mock(async () => ({ id: 'auth_1', status: 'CREATED', payload: 'pixauto-payload', encodedImage: 'IMG', subscriptionId: 'sub_9' })),
    cancelPixAutomaticAuthorization: mock(async () => ({ id: 'auth_1', status: 'CANCELLED' })),
    ...over
  };
}

describe('checkout Asaas', () => {
  beforeEach(async () => { if (db) await resetDb(); });

  dbTest('rejeita CPF inválido antes de chamar o Asaas', async () => {
    const user = await makeUser();
    const c = fakeClient();
    await assert.rejects(new AsaasCheckoutService(c, () => NOW).start(user, { method: 'PIX', cpfCnpj: '111.111.111-11' }), BillingError);
    assert.equal(c.createCustomer.calls.length, 0);
  });

  dbTest('cartão: cria o cliente uma vez, o preço vem do servidor e retorna o link do checkout', async () => {
    const user = await makeUser();
    const c = fakeClient();
    const svc = new AsaasCheckoutService(c, () => NOW);
    const r = await svc.start(user, { method: 'CREDIT_CARD', cpfCnpj: CPF });
    assert.equal(r.kind, 'redirect');
    const body = c.createCheckout.calls[0][0];
    assert.equal(body.items[0].value, 29.9);
    assert.deepEqual(body.chargeTypes, ['RECURRENT']);
    assert.equal(body.customer, 'cus_1');
    assert.match(body.callback.successUrl, /#\/checkout\/sucesso$/);

    const again = await svc.start(user, { method: 'CREDIT_CARD', cpfCnpj: CPF });
    assert.equal(again.kind, 'redirect');
    assert.equal(c.createCheckout.calls.length, 1);
    assert.equal(c.createCustomer.calls.length, 1);
    assert.equal(await db.subscription.count({ where: { userId: user.id } }), 1);
    assert.equal(await db.billingCustomer.count(), 1);
    assert.equal((await db.subscription.findFirstOrThrow()).status, 'PENDING'); // criar o checkout não libera Premium
  });

  dbTest('reutiliza cliente já existente no Asaas (externalReference)', async () => {
    const user = await makeUser();
    const c = fakeClient({ listCustomers: mock(async () => ({ data: [{ id: 'cus_existing' }] })) });
    await new AsaasCheckoutService(c, () => NOW).start(user, { method: 'CREDIT_CARD', cpfCnpj: CPF });
    assert.equal(c.createCustomer.calls.length, 0);
    assert.equal((await db.billingCustomer.findUniqueOrThrow({ where: { userId: user.id } })).asaasCustomerId, 'cus_existing');
  });

  dbTest('Pix convencional: cria assinatura PIX, registra a cobrança e devolve o QR Code', async () => {
    const user = await makeUser();
    const c = fakeClient();
    const r = await new AsaasCheckoutService(c, () => NOW).start(user, { method: 'PIX', cpfCnpj: CPF });
    assert.equal(r.kind, 'pix');
    assert.equal(r.payload, '000201...pix');
    const body = c.createSubscription.calls[0][0];
    assert.equal(body.billingType, 'PIX');
    assert.equal(body.value, 29.9);
    const pay = await db.payment.findUniqueOrThrow({ where: { asaasPaymentId: 'pay_1' } });
    assert.equal(pay.status, 'PENDING');
    assert.equal(pay.pixPayload, '000201...pix');
    assert.equal((await db.subscription.findFirstOrThrow()).status, 'PENDING');
  });

  dbTest('timeout ao criar a assinatura Pix: adota a existente em vez de duplicar', async () => {
    const user = await makeUser();
    const c = fakeClient({
      createSubscription: mock(async () => { throw new AsaasTimeoutError(); }),
      listSubscriptions: mock(async () => ({ data: [{ id: 'sub_created_before', customer: 'cus_1', status: 'ACTIVE' }] })),
      listSubscriptionPayments: mock(async () => ({
        data: [{ id: 'pay_7', customer: 'cus_1', subscription: 'sub_created_before', status: 'PENDING', value: 29.9, dueDate: '2026-11-08' }]
      }))
    });
    await new AsaasCheckoutService(c, () => NOW).start(user, { method: 'PIX', cpfCnpj: CPF });
    assert.equal(c.createSubscription.calls.length, 1);
    assert.equal((await db.subscription.findFirstOrThrow()).asaasSubscriptionId, 'sub_created_before');
  });

  dbTest('timeout sem assinatura remota: erro 503 e nenhuma assinatura Asaas vinculada', async () => {
    const user = await makeUser();
    const c = fakeClient({ createSubscription: mock(async () => { throw new AsaasTimeoutError(); }) });
    const err = await new AsaasCheckoutService(c, () => NOW).start(user, { method: 'PIX', cpfCnpj: CPF }).catch(e => e);
    assert.ok(err instanceof BillingError);
    assert.equal(err.status, 503);
    assert.equal((await db.subscription.findFirstOrThrow()).asaasSubscriptionId, null);
  });

  dbTest('Pix Automático só está disponível quando habilitado pelo admin', async () => {
    const user = await makeUser();
    const c = fakeClient();
    const svc = new AsaasCheckoutService(c, () => NOW);
    await assert.rejects(svc.start(user, { method: 'PIX_AUTOMATIC', cpfCnpj: CPF }), BillingError);
    await setSetting('pixAutomaticEnabled', 'true');
    const r = await svc.start(user, { method: 'PIX_AUTOMATIC', cpfCnpj: CPF });
    assert.equal(r.kind, 'pix_automatic');
    const body = c.createPixAutomaticAuthorization.calls[0][0];
    assert.equal(body.paymentCreationMode, 'SUBSCRIPTION');
    assert.equal(body.immediateQrCode.originalValue, 29.9);
    const sub = await db.subscription.findFirstOrThrow();
    assert.equal(sub.asaasAuthorizationId, 'auth_1');
    assert.equal(sub.status, 'PENDING');
  });

  dbTest('Pix Automático inelegível retorna mensagem amigável', async () => {
    await setSetting('pixAutomaticEnabled', 'true');
    const user = await makeUser();
    const c = fakeClient({ createPixAutomaticAuthorization: mock(async () => { throw new AsaasApiError(403, [{ code: 'not_allowed', description: 'Recurso não habilitado' }]); }) });
    const err = await new AsaasCheckoutService(c, () => NOW).start(user, { method: 'PIX_AUTOMATIC', cpfCnpj: CPF }).catch(e => e);
    assert.ok(err instanceof BillingError);
    assert.match(err.message, /Pix Automático indisponível/);
  });

  dbTest('assinatura já ativa: bloqueia nova contratação (409)', async () => {
    const user = await makeUser();
    await makeSubscription(user.id, { status: 'ACTIVE', currentPeriodEnd: new Date(NOW.getTime() + 86_400_000) });
    const err = await new AsaasCheckoutService(fakeClient(), () => NOW).start(user, { method: 'PIX', cpfCnpj: CPF }).catch(e => e);
    assert.ok(err instanceof BillingError);
    assert.equal(err.status, 409);
  });

  dbTest('trocar de método abandona a pendência anterior', async () => {
    const user = await makeUser();
    const c = fakeClient();
    const svc = new AsaasCheckoutService(c, () => NOW);
    await svc.start(user, { method: 'PIX', cpfCnpj: CPF });
    await svc.start(user, { method: 'CREDIT_CARD', cpfCnpj: CPF });
    assert.deepEqual(c.deleteSubscription.calls[0], ['sub_1']);
    const subs = await db.subscription.findMany({ orderBy: { createdAt: 'asc' } });
    assert.deepEqual(subs.map(s => s.status), ['CANCELED', 'PENDING']);
  });
});

describe('cancelamento', () => {
  beforeEach(async () => { if (db) await resetDb(); });

  dbTest('só marca CANCELED após o Asaas confirmar e mantém o período pago', async () => {
    const user = await makeUser();
    const end = new Date(Date.now() + 10 * 86_400_000);
    await makeSubscription(user.id, { status: 'ACTIVE', asaasSubscriptionId: 'sub_1', currentPeriodEnd: end });
    const client = { deleteSubscription: mock(async () => ({ deleted: true, id: 'sub_1' })), cancelPixAutomaticAuthorization: mock() };
    const sub = await cancelSubscription(client, user.id);
    assert.deepEqual(client.deleteSubscription.calls[0], ['sub_1']);
    assert.equal(sub.status, 'CANCELED');
    assert.equal(sub.currentPeriodEnd.getTime(), end.getTime());
  });

  dbTest('falha de comunicação: a assinatura NÃO é considerada cancelada', async () => {
    const user = await makeUser();
    await makeSubscription(user.id, { status: 'ACTIVE', asaasSubscriptionId: 'sub_1', currentPeriodEnd: new Date(Date.now() + 86_400_000) });
    const client = { deleteSubscription: mock(async () => { throw new AsaasTimeoutError(); }), cancelPixAutomaticAuthorization: mock() };
    await assert.rejects(cancelSubscription(client, user.id), BillingError);
    const sub = await db.subscription.findFirstOrThrow();
    assert.equal(sub.status, 'ACTIVE');
    assert.notEqual(sub.cancelRequestedAt, null);
  });

  dbTest('cancela a autorização do Pix Automático e a assinatura vinculada', async () => {
    const user = await makeUser();
    await makeSubscription(user.id, { status: 'ACTIVE', paymentMethod: 'PIX_AUTOMATIC', asaasAuthorizationId: 'auth_1', asaasSubscriptionId: 'sub_9', currentPeriodEnd: new Date(Date.now() + 86_400_000) });
    const client = { deleteSubscription: mock(async () => ({ deleted: true, id: 'sub_9' })), cancelPixAutomaticAuthorization: mock(async () => ({ id: 'auth_1', status: 'CANCELLED' })) };
    await cancelSubscription(client, user.id);
    assert.deepEqual(client.cancelPixAutomaticAuthorization.calls[0], ['auth_1']);
    assert.deepEqual(client.deleteSubscription.calls[0], ['sub_9']);
  });
});
