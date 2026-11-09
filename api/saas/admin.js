/* Administração do SaaS: concessão/revogação de Premium (sempre auditada), configurações, reconciliação
   com o Asaas e as listagens do painel financeiro. Nada aqui altera uma cobrança "na mão". */
import { db } from './db.js';
import { SaasError } from './errors.js';
import { ensureUser, getEntitlements, getGraceDays, isPixAutomaticEnabled, setSetting } from './access.js';
import { startOfMonth } from './usage.js';
import { AsaasClient } from './asaas/client.js';
import { AsaasWebhookService } from './asaas/webhook.js';
import { PrismaBillingRepository } from './asaas/repository.js';
import { mapAsaasPaymentStatus } from './asaas/status.js';

async function audit(actorId, action, targetType, targetId, details) {
  await db.adminAuditLog.create({ data: { actorId, action, targetType, targetId, details } });
}

/** `actor` e `target` são perfis do openGym ({ id, name, email }); o espelho no Postgres é criado aqui. */
export async function grantPremium(actor, target, days, reason) {
  await ensureUser(actor, { isAdmin: true });
  await ensureUser(target);
  const until = days ? new Date(Date.now() + days * 86_400_000) : null;
  await db.user.update({ where: { id: target.id }, data: { manualPremium: true, manualPremiumUntil: until } });
  await audit(actor.id, 'GRANT_PREMIUM', 'User', target.id, { days, reason });
}

export async function revokePremium(actor, target, reason) {
  await ensureUser(actor, { isAdmin: true });
  await ensureUser(target);
  await db.user.update({ where: { id: target.id }, data: { manualPremium: false, manualPremiumUntil: null } });
  await audit(actor.id, 'REVOKE_PREMIUM', 'User', target.id, { reason });
}

export async function updateSettings(actor, patch) {
  await ensureUser(actor, { isAdmin: true });
  if (patch.graceDays !== undefined) {
    if (!Number.isInteger(patch.graceDays) || patch.graceDays < 0 || patch.graceDays > 30) {
      throw new SaasError(400, 'A tolerância deve ser de 0 a 30 dias.');
    }
    await setSetting('graceDays', String(patch.graceDays));
    await audit(actor.id, 'UPDATE_SETTING', 'AppSetting', 'graceDays', { value: patch.graceDays });
  }
  if (patch.pixAutomaticEnabled !== undefined) {
    await setSetting('pixAutomaticEnabled', String(!!patch.pixAutomaticEnabled));
    await audit(actor.id, 'UPDATE_SETTING', 'AppSetting', 'pixAutomaticEnabled', { value: !!patch.pixAutomaticEnabled });
  }
}

export async function getSettings() {
  return { graceDays: await getGraceDays(), pixAutomaticEnabled: await isPixAutomaticEnabled() };
}

/**
 * Reconcilia uma assinatura com o Asaas (consulta as cobranças atuais e reaplica as regras).
 * Usa o mesmo caminho do webhook, com o estado real do provedor.
 */
export async function reconcileSubscription(actor, subscriptionId, { client } = {}) {
  const sub = await db.subscription.findUnique({ where: { id: subscriptionId } });
  if (!sub?.asaasSubscriptionId) throw new SaasError(400, 'Assinatura sem vínculo com o Asaas.');
  const asaas = client || AsaasClient.fromEnv();
  const list = await asaas.listSubscriptionPayments(sub.asaasSubscriptionId);
  const service = new AsaasWebhookService(new PrismaBillingRepository(), asaas);
  let applied = 0;
  for (const p of list.data) {
    const status = mapAsaasPaymentStatus(p.status);
    const event = status === 'RECEIVED' ? 'PAYMENT_RECEIVED'
      : status === 'CONFIRMED' ? 'PAYMENT_CONFIRMED'
      : status === 'OVERDUE' ? 'PAYMENT_OVERDUE'
      : status === 'REFUNDED' ? 'PAYMENT_REFUNDED' : 'PAYMENT_UPDATED';
    await service.handle({ id: `reconcile:${p.id}:${p.status}`, event, payment: p });
    applied++;
  }
  await ensureUser(actor, { isAdmin: true });
  await audit(actor.id, 'RECONCILE_SUBSCRIPTION', 'Subscription', subscriptionId, { payments: applied });
  return { applied };
}

export async function adminOverview() {
  const now = new Date();
  const [users, premiumSubs, pending, overdue, aiMonth, aiFailures, errors24h, failedEvents] = await Promise.all([
    db.user.count({ where: { deletedAt: null } }),
    db.subscription.count({ where: { status: { in: ['ACTIVE', 'PAST_DUE'] } } }),
    db.payment.count({ where: { status: 'PENDING' } }),
    db.payment.count({ where: { status: 'OVERDUE' } }),
    db.usageRecord.aggregate({
      where: { createdAt: { gte: startOfMonth(now) }, success: true },
      _sum: { inputTokens: true, outputTokens: true },
      _count: { _all: true }
    }),
    db.usageRecord.count({ where: { createdAt: { gte: startOfMonth(now) }, success: false } }),
    db.errorLog.count({ where: { createdAt: { gte: new Date(now.getTime() - 86_400_000) } } }),
    db.paymentEvent.count({ where: { status: 'FAILED' } })
  ]);
  return {
    users, premiumSubs, pending, overdue, errors24h, failedEvents, aiFailures,
    ai: { messages: aiMonth._count._all, inputTokens: aiMonth._sum.inputTokens ?? 0, outputTokens: aiMonth._sum.outputTokens ?? 0 }
  };
}

export const listSubscriptions = () => db.subscription.findMany({
  orderBy: { createdAt: 'desc' }, take: 100,
  select: {
    id: true, userId: true, status: true, paymentMethod: true, currentPeriodEnd: true, graceUntil: true,
    cancelRequestedAt: true, canceledAt: true, asaasSubscriptionId: true, asaasAuthorizationId: true,
    asaasCheckoutId: true, createdAt: true, user: { select: { name: true, email: true } }
  }
});

export const listPayments = () => db.payment.findMany({
  orderBy: { createdAt: 'desc' }, take: 100,
  select: {
    id: true, userId: true, status: true, method: true, valueCents: true, dueDate: true, paidAt: true,
    asaasPaymentId: true, isInitial: true, user: { select: { name: true, email: true } }
  }
});

export const listEvents = () => db.paymentEvent.findMany({ orderBy: { receivedAt: 'desc' }, take: 100 });
export const listErrors = () => db.errorLog.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
export const listAudit = () => db.adminAuditLog.findMany({
  orderBy: { createdAt: 'desc' }, take: 50, include: { actor: { select: { name: true } } }
});

/** Usuários Premium (por assinatura ou concessão manual), com o motivo do acesso. */
export async function listPremiumUsers() {
  const users = await db.user.findMany({ where: { deletedAt: null }, orderBy: { createdAt: 'desc' }, take: 300 });
  const rows = [];
  for (const u of users) {
    const ent = await getEntitlements(u.id);
    if (ent.isPremium || u.manualPremium) {
      rows.push({
        id: u.id, name: u.name, email: u.email, plan: ent.planCode, source: ent.source,
        manualPremium: u.manualPremium, manualPremiumUntil: u.manualPremiumUntil
      });
    }
  }
  return rows;
}

export async function aiUsageByUser() {
  const since = startOfMonth();
  const groups = await db.usageRecord.groupBy({
    by: ['userId'], where: { createdAt: { gte: since }, success: true },
    _sum: { inputTokens: true, outputTokens: true }, _count: { _all: true },
    orderBy: { _count: { userId: 'desc' } }, take: 50
  });
  const users = await db.user.findMany({ where: { id: { in: groups.map(g => g.userId) } }, select: { id: true, name: true, email: true } });
  const byId = new Map(users.map(u => [u.id, u]));
  return groups.map(g => ({
    userId: g.userId, name: byId.get(g.userId)?.name ?? '—', email: byId.get(g.userId)?.email ?? null,
    messages: g._count._all, inputTokens: g._sum.inputTokens ?? 0, outputTokens: g._sum.outputTokens ?? 0
  }));
}
