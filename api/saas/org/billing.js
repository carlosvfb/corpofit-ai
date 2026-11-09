/* Assinatura e limites de uma academia. A cobrança reaproveita todo o fluxo do Asaas das assinaturas
   pessoais (checkout, webhooks idempotentes, inadimplência, cancelamento): uma assinatura de academia é
   uma `Subscription` com `tenantId`, paga por quem é DONO. Os direitos (limites) vêm só do servidor, de
   uma assinatura vigente (ou da tolerância), e nunca do que o app disser. Sem assinatura vigente a academia
   volta ao plano grátis: quem já estava dentro continua (nada é apagado), mas ninguém novo entra além do limite. */
import { db } from '../db.js';
import { SaasError } from '../errors.js';
import { getGraceDays } from '../access.js';
import { subscriptionGrantsPremium } from '../entitlements.js';
import { AsaasCheckoutService, BillingError } from '../asaas/checkout.js';
import { cancelSubscription } from '../asaas/cancel.js';
import { asaasConfigured } from '../asaas/config.js';
import { availablePaymentMethods } from '../billing.js';
import { withContext } from './context.js';
import { can } from './rbac.js';
import { DEFAULT_GYM_PLAN, gymPlan, gymPlans, publicGymPlans } from './gym-plans.js';

const NOT_FOUND = () => new SaasError(404, 'Academia não encontrada.', 'not-found');
const uuid = v => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);
const STUDENT_ROLES = ['STUDENT'];
const PRO_ROLES = ['PERSONAL_TRAINER', 'GYM_MANAGER'];
const COUNTED = ['ACTIVE', 'INVITED'];

/** O plano em vigor da academia e seus limites. */
export async function tenantEntitlements(tenantId, now = new Date()) {
  const [subs, graceDays] = await Promise.all([db.subscription.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } }), getGraceDays()]);
  const live = subs.find(s => subscriptionGrantsPremium(s, now, graceDays) && gymPlan(s.tenantPlan));
  const plan = live ? gymPlan(live.tenantPlan) : gymPlans()[DEFAULT_GYM_PLAN];
  return { plan, planCode: plan.code, paid: !!live, subscription: live ? { status: live.status, currentPeriodEnd: live.currentPeriodEnd, graceUntil: live.graceUntil, cancelRequestedAt: live.cancelRequestedAt } : null, limits: plan.limits };
}

async function usageIn(tx, tenantId, ignorePending = '') {
  const [rows, pending] = await Promise.all([
    tx.membership.findMany({ where: { tenantId, status: { in: COUNTED } }, select: { role: true } }),
    tx.pendingInvite.findMany({ where: { tenantId, expiresAt: { gt: new Date() }, ...(ignorePending ? { id: { not: ignorePending } } : {}) }, select: { role: true } })
  ]);
  const all = [...rows, ...pending];
  return { students: all.filter(r => STUDENT_ROLES.includes(r.role)).length, professionals: all.filter(r => PRO_ROLES.includes(r.role)).length };
}

/** Lança 402 se acrescentar uma pessoa com este papel passaria do limite do plano. Outros papéis não contam. */
export async function assertCapacity(tx, tenantId, role, { ignorePending = '' } = {}) {
  const kind = STUDENT_ROLES.includes(role) ? 'students' : PRO_ROLES.includes(role) ? 'professionals' : null;
  if (!kind) return;
  const [ent, used] = await Promise.all([tenantEntitlements(tenantId), usageIn(tx, tenantId, ignorePending)]);
  const max = kind === 'students' ? ent.limits.maxStudents : ent.limits.maxProfessionals;
  if (used[kind] >= max) {
    throw new SaasError(402, `O plano ${ent.plan.name} permite até ${max} ${kind === 'students' ? 'alunos' : 'profissionais'}. Faça upgrade do plano para adicionar mais.`, 'plan-limit');
  }
}

export async function overview(user, tenantId) {
  if (!uuid(tenantId)) throw NOT_FOUND();
  const used = await withContext({ userId: user.id, tenantId }, async tx => {
    const m = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId: user.id } } });
    if (!m || m.status !== 'ACTIVE') throw NOT_FOUND();
    if (!can(m, 'billing:read')) throw new SaasError(403, 'Você não tem permissão para isso.', 'forbidden');
    return { ...(await usageIn(tx, tenantId)), canManage: can(m, 'billing:manage') };
  });
  const ent = await tenantEntitlements(tenantId);
  const pending = await db.subscription.findFirst({ where: { tenantId, status: 'PENDING' }, orderBy: { createdAt: 'desc' }, select: { tenantPlan: true, paymentMethod: true } });
  return {
    plan: { code: ent.plan.code, name: ent.plan.name, priceCents: ent.plan.priceCents }, paid: ent.paid, subscription: ent.subscription, limits: ent.limits,
    usage: { students: used.students, professionals: used.professionals }, canManage: used.canManage, pending,
    plans: publicGymPlans(), methods: await availablePaymentMethods()
  };
}

async function ownerContext(user, tenantId) {
  if (!uuid(tenantId)) throw NOT_FOUND();
  await withContext({ userId: user.id, tenantId }, async tx => {
    const m = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId: user.id } } });
    if (!m || m.status !== 'ACTIVE') throw NOT_FOUND();
    if (!can(m, 'billing:manage')) throw new SaasError(403, 'Só o dono da academia contrata ou cancela o plano.', 'forbidden');
  });
}

/** O dono contrata um plano pago. Preço e limites vêm daqui; o cliente só escolhe plano e forma de pagamento. */
export async function startCheckout(user, tenantId, { planCode, method, cpfCnpj }, client) {
  await ownerContext(user, tenantId);
  const plan = gymPlan(planCode);
  if (!plan || !plan.paid) throw new SaasError(400, 'Escolha um plano pago.', 'invalid-plan');
  if (plan.priceCents === null) throw new SaasError(503, 'Este plano ainda não está disponível para contratação.', 'price-not-set');
  if (!asaasConfigured()) throw new SaasError(503, 'Pagamentos ainda não configurados.');
  const current = await tenantEntitlements(tenantId);
  if (current.paid && current.planCode === plan.code) throw new SaasError(409, 'Esta academia já está neste plano.', 'same-plan');
  return new AsaasCheckoutService(typeof client === 'function' ? client() : client).start(user, { method, cpfCnpj, tenantId, plan });
}

export async function cancel(user, tenantId, client) {
  await ownerContext(user, tenantId);
  return cancelSubscription(typeof client === 'function' ? client() : client, user.id, new Date(), tenantId);
}

export { BillingError };
