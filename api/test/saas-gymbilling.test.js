import { beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { asaasPayment, db, dbTest, makeSubscription, makeUser, mock, resetDb } from './saas-helpers.mjs';
import * as org from '../saas/org/service.js';
import * as ob from '../saas/org/billing.js';
import { AsaasWebhookService } from '../saas/asaas/webhook.js';
import { PrismaBillingRepository } from '../saas/asaas/repository.js';
import { getEntitlements } from '../saas/access.js';
import { gymPlans, publicGymPlans } from '../saas/org/gym-plans.js';

const asUser = u => ({ id: u.id, name: u.name, email: u.email });
const status = (p, st, code) => assert.rejects(p, e => e.status === st && (!code || e.code === code), `esperava ${st}${code ? ' ' + code : ''}`);
const NOW = new Date('2026-11-08T12:00:00Z');
const ID = '00000000-0000-0000-0000-000000000000';

function fakeClient() {
  return {
    listCustomers: mock(async () => ({ data: [] })),
    createCustomer: mock(async () => ({ id: 'cus_1' })),
    createCheckout: mock(async () => ({ id: 'chk_1', link: 'https://sandbox.asaas.com/checkoutSession/show?id=chk_1' })),
    deleteSubscription: mock(async () => ({ deleted: true, id: 'sub_1' })),
    getPayment: mock(async () => asaasPayment({ status: 'RECEIVED', value: 199 })),
    getSubscription: mock(async () => ({ id: 'sub_1', customer: 'cus_1', status: 'ACTIVE' }))
  };
}
const CPF = '529.982.247-25';

describe('planos de academia (sem banco)', () => {
  dbTest('preço só existe se configurado; limites e preço podem ser ajustados por GYM_PLANS; entradas ruins são ignoradas', () => {
    delete process.env.GYM_PLANS;
    assert.equal(gymPlans().GYM_START.priceCents, null);
    assert.equal(publicGymPlans().find(p => p.code === 'GYM_START').purchasable, false);
    assert.equal(publicGymPlans().find(p => p.code === 'GYM_FREE').purchasable, false);
    process.env.GYM_PLANS = JSON.stringify({ GYM_START: { priceCents: 19900, limits: { maxStudents: 123, maxProfessionals: -4, aiMonthlyMessages: 'x' } }, GYM_PRO: { priceCents: -1 } });
    assert.equal(gymPlans().GYM_START.priceCents, 19900);
    assert.equal(gymPlans().GYM_START.limits.maxStudents, 123);
    assert.equal(gymPlans().GYM_START.limits.maxProfessionals, 5);   // inválido: mantém o padrão
    assert.equal(gymPlans().GYM_PRO.priceCents, null);
    process.env.GYM_PLANS = '{quebrado';
    assert.equal(gymPlans().GYM_FREE.limits.maxStudents, 10);
    delete process.env.GYM_PLANS;
  });
});

describe('plano, limites e cobrança da academia', () => {
  beforeEach(async () => { if (db) await resetDb(); delete process.env.GYM_PLANS; });

  async function gym() {
    const [owner, admin, manager, student] = await Promise.all([makeUser(), makeUser(), makeUser(), makeUser()]);
    const g = await org.createGym(asUser(owner), { name: 'Academia Alfa' });
    for (const [u, role] of [[admin, 'GYM_ADMIN'], [manager, 'GYM_MANAGER'], [student, 'STUDENT']]) { await org.inviteMember(asUser(owner), g.id, { userId: u.id, role }); await org.acceptInvite(asUser(u), g.id); }
    return { g, owner, admin, manager, student };
  }
  const invite = async (by, g, role) => { const u = await makeUser(); return { u, m: await org.inviteMember(asUser(by), g.id, { userId: u.id, role }) }; };

  dbTest('sem assinatura a academia está no plano grátis: limite de alunos e de profissionais, sem apagar ninguém', async () => {
    const { g, owner } = await gym();            // 1 aluno e 1 profissional (o gerente) já dentro
    await status(invite(owner, g, 'PERSONAL_TRAINER'), 402, 'plan-limit'); // grátis: 1 profissional
    for (let i = 0; i < 9; i++) await invite(owner, g, 'STUDENT');            // 10 alunos no total
    await status(invite(owner, g, 'STUDENT'), 402, 'plan-limit');
    await invite(owner, g, 'GYM_ADMIN');                                        // administradores e donos não contam
    assert.equal((await ob.tenantEntitlements(g.id)).planCode, 'GYM_FREE');
    assert.equal((await org.listMembers(asUser(owner), g.id)).length, 4 + 9 + 1);
  });

  dbTest('mudar o papel de alguém para um tipo limitado também ocupa uma vaga', async () => {
    const { g, owner, admin, student } = await gym();
    await status(org.updateMemberRole(asUser(owner), g.id, student.id, 'PERSONAL_TRAINER'), 402, 'plan-limit'); // já há 1 profissional
    await org.updateMemberRole(asUser(owner), g.id, admin.id, 'GYM_ADMIN'); // sem mudança de papel: não conta
  });

  dbTest('assinatura vigente amplia os limites; pessoal e academia não se misturam', async () => {
    const { g, owner } = await gym();
    await makeSubscription(owner.id, { status: 'ACTIVE', tenantId: g.id, tenantPlan: 'GYM_START', currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000) });
    const ent = await ob.tenantEntitlements(g.id);
    assert.equal(ent.planCode, 'GYM_START');
    assert.equal(ent.paid, true);
    assert.equal(ent.limits.maxProfessionals, 5);
    await invite(owner, g, 'PERSONAL_TRAINER');
    assert.equal((await getEntitlements(owner)).isPremium, false); // pagar a academia não dá Premium pessoal
    // e o Premium pessoal de outro usuário não muda a academia
    const other = await makeUser();
    await makeSubscription(other.id, { status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 20 * 86_400_000) });
    const g2 = await org.createGym(asUser(other), { name: 'Outra' });
    assert.equal((await ob.tenantEntitlements(g2.id)).planCode, 'GYM_FREE');
  });

  dbTest('inadimplência: na tolerância mantém o plano; vencida a tolerância volta ao grátis e ninguém é apagado', async () => {
    const { g, owner } = await gym();
    const sub = await makeSubscription(owner.id, { status: 'PAST_DUE', tenantId: g.id, tenantPlan: 'GYM_START', graceUntil: new Date(Date.now() + 86_400_000) });
    assert.equal((await ob.tenantEntitlements(g.id)).planCode, 'GYM_START');
    await db.subscription.update({ where: { id: sub.id }, data: { graceUntil: new Date(Date.now() - 1000) } });
    assert.equal((await ob.tenantEntitlements(g.id)).planCode, 'GYM_FREE');
    assert.equal((await org.listMembers(asUser(owner), g.id)).length, 4);
    await status(invite(owner, g, 'PERSONAL_TRAINER'), 402, 'plan-limit');
  });

  dbTest('o webhook ativa a assinatura da academia e só então os limites sobem', async () => {
    const { g, owner } = await gym();
    await makeSubscription(owner.id, { tenantId: g.id, tenantPlan: 'GYM_START', asaasSubscriptionId: 'sub_1' });
    assert.equal((await ob.tenantEntitlements(g.id)).planCode, 'GYM_FREE'); // pendente: nada muda
    const client = fakeClient();
    const svc = new AsaasWebhookService(new PrismaBillingRepository(), client, () => NOW);
    const r = await svc.handle({ id: 'evt_g1', event: 'PAYMENT_RECEIVED', dateCreated: '2026-11-08 12:00:00', payment: asaasPayment({ status: 'RECEIVED', value: 199 }) });
    assert.equal(r.outcome, 'processed');
    const again = await svc.handle({ id: 'evt_g1', event: 'PAYMENT_RECEIVED', dateCreated: '2026-11-08 12:00:00', payment: asaasPayment({ status: 'RECEIVED', value: 199 }) });
    assert.equal(again.outcome, 'duplicate');
    // `NOW` do webhook é fixo no passado; a assinatura nasce ativa com o período calculado a partir dele
    const sub = await db.subscription.findFirstOrThrow({ where: { tenantId: g.id } });
    assert.equal(sub.status, 'ACTIVE');
    assert.equal((await getEntitlements(owner)).isPremium, false);
  });

  dbTest('contratar: só o dono; preço e limites vêm do servidor; sem preço configurado não há contratação', async () => {
    const { g, owner, admin, manager, student } = await gym();
    const client = fakeClient();
    const input = { planCode: 'GYM_START', method: 'CREDIT_CARD', cpfCnpj: CPF };
    process.env.ASAAS_API_KEY = 'k';
    await status(ob.startCheckout(asUser(owner), g.id, input, client), 503, 'price-not-set');
    process.env.GYM_PLANS = JSON.stringify({ GYM_START: { priceCents: 19900 } });
    await status(ob.startCheckout(asUser(admin), g.id, input, client), 403);
    await status(ob.startCheckout(asUser(manager), g.id, input, client), 403);
    await status(ob.startCheckout(asUser(student), g.id, input, client), 403);
    await status(ob.startCheckout(asUser(await makeUser()), g.id, input, client), 404);
    await status(ob.startCheckout(asUser(owner), g.id, { ...input, planCode: 'GYM_FREE' }, client), 400, 'invalid-plan');
    await status(ob.startCheckout(asUser(owner), g.id, { ...input, planCode: 'PREMIUM' }, client), 400, 'invalid-plan');
    const r = await ob.startCheckout(asUser(owner), g.id, { ...input, priceCents: 1 }, client);
    assert.equal(r.kind, 'redirect');
    const body = client.createCheckout.calls[0][0];
    assert.equal(body.items[0].value, 199);               // o preço não vem do cliente
    assert.equal(body.items[0].name, 'CorpoFit AI Academia Start');
    const sub = await db.subscription.findFirstOrThrow({ where: { tenantId: g.id } });
    assert.equal(sub.tenantPlan, 'GYM_START');
    assert.equal(sub.planCode, 'PREMIUM');
    assert.equal(sub.status, 'PENDING');                  // criar o checkout não libera nada
    assert.equal((await ob.tenantEntitlements(g.id)).planCode, 'GYM_FREE');
    // o checkout pessoal do dono segue independente
    assert.equal(await db.subscription.count({ where: { userId: owner.id, tenantId: null } }), 0);
    delete process.env.GYM_PLANS;
  });

  dbTest('painel do plano: dono, admin e gerente veem; aluno e de fora não; só o dono contrata e cancela', async () => {
    const { g, owner, admin, manager, student } = await gym();
    const o = await ob.overview(asUser(owner), g.id);
    assert.equal(o.plan.code, 'GYM_FREE');
    assert.deepEqual(o.usage, { students: 1, professionals: 1 });
    assert.equal(o.canManage, true);
    assert.equal(o.limits.maxStudents, 10);
    assert.equal((await ob.overview(asUser(admin), g.id)).canManage, false); // o admin vê, só o dono contrata
    assert.equal((await ob.overview(asUser(manager), g.id)).canManage, false);
    await status(ob.overview(asUser(student), g.id), 403);
    await status(ob.overview(asUser(await makeUser()), g.id), 404);
    await status(ob.overview(asUser(owner), 'nao-uuid'), 404);
    await status(ob.overview(asUser(owner), ID), 404);
  });

  dbTest('cancelar: só o dono; cancela a assinatura da academia e não a pessoal; o plano vale até o fim do período', async () => {
    const { g, owner, admin } = await gym();
    const end = new Date(Date.now() + 10 * 86_400_000);
    await makeSubscription(owner.id, { status: 'ACTIVE', tenantId: g.id, tenantPlan: 'GYM_START', asaasSubscriptionId: 'sub_g', currentPeriodEnd: end });
    const personal = await makeSubscription(owner.id, { status: 'ACTIVE', asaasSubscriptionId: 'sub_p', currentPeriodEnd: end });
    const client = fakeClient();
    await status(ob.cancel(asUser(admin), g.id, client), 403);
    await ob.cancel(asUser(owner), g.id, client);
    assert.deepEqual(client.deleteSubscription.calls[0], ['sub_g']);
    assert.equal((await db.subscription.findUniqueOrThrow({ where: { id: personal.id } })).status, 'ACTIVE'); // a pessoal não foi tocada
    assert.equal((await db.subscription.findFirstOrThrow({ where: { tenantId: g.id } })).status, 'CANCELED');
    assert.equal((await ob.tenantEntitlements(g.id)).planCode, 'GYM_START'); // período já pago
  });

  dbTest('o teto de IA da academia também respeita o plano', async () => {
    const { g, owner, student } = await gym();
    const { resolveContext, setAiContext } = await import('../saas/org/ai.js');
    await org.updateSettings(asUser(owner), g.id, { ai: { enabled: true, instructions: 'x'.repeat(30) } });
    await setAiContext(asUser(student), g.id);
    assert.equal((await resolveContext(asUser(student))).cap, 100); // GYM_FREE: 100 mensagens por mês
    await makeSubscription(owner.id, { status: 'ACTIVE', tenantId: g.id, tenantPlan: 'GYM_START', currentPeriodEnd: new Date(Date.now() + 10 * 86_400_000) });
    assert.equal((await resolveContext(asUser(student))).cap, 1500);
  });
});
