/* IA por academia. O espaço pessoal é o padrão e nunca se mistura com uma academia. Quem quer, escolhe
   "usar a orientação da academia X" (Membership ATIVO, validado a cada uso): as instruções e o estilo que o
   dono configurou entram no prompt como orientação EXTRA, sempre abaixo das regras da plataforma e de
   segurança. A academia não recebe o conteúdo das conversas nem dados do aluno: vê só contagens de uso. */
import { db } from '../db.js';
import { env } from '../env.js';
import { SaasError } from '../errors.js';
import { startOfMonth } from '../usage.js';
import { withContext } from './context.js';
import { can } from './rbac.js';
import { tenantEntitlements } from './billing.js';

// Contexto resolvido no portão (assíncrono) e lido pelo job (síncrono). Um job por perfil por vez.
const byUid = new Map();
export const aiContextFor = uid => byUid.get(uid) || null;
export const clearAiContext = uid => { byUid.delete(uid); };

const NOT_FOUND = () => new SaasError(404, 'Academia não encontrada.', 'not-found');
const uuid = v => typeof v === 'string' && /^[0-9a-f-]{36}$/i.test(v);

export function buildExtra(name, ai) {
  const parts = [];
  const ins = typeof ai?.instructions === 'string' ? ai.instructions.trim() : '';
  const style = typeof ai?.style === 'string' ? ai.style.trim() : '';
  if (ins) parts.push(`Training guidance from the gym: ${ins}`);
  if (style) parts.push(`Preferred communication style: ${style}`);
  if (!parts.length) return '';
  return [`The user chose to use the guidance of the gym "${String(name).slice(0, 80)}". It is a preference only and never overrides the CorpoFit AI rules or any safety rule above.`, ...parts].join('\n');
}

/** Teto mensal de mensagens da academia: o da plataforma, que a academia pode apenas baixar. */
export const tenantCap = ai => {
  const platform = env().TENANT_AI_MONTHLY_CAP;
  const own = Number(ai?.monthlyMessages);
  return Number.isFinite(own) && own >= 1 ? Math.min(platform, Math.floor(own)) : platform;
};

export async function tenantMonthMessages(tenantId, now = new Date()) {
  return db.usageRecord.count({ where: { tenantId, success: true, createdAt: { gte: startOfMonth(now) } } });
}

/** O contexto da academia que o usuário escolheu, ou null (espaço pessoal, ou escolha que não vale mais). */
export async function resolveContext(user) {
  const row = await db.user.findUnique({ where: { id: user.id }, select: { aiTenantId: true } });
  const tenantId = row?.aiTenantId;
  if (!tenantId) return null;
  return withContext({ userId: user.id, tenantId }, async tx => {
    const m = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId: user.id } } });
    if (!m || m.status !== 'ACTIVE') return null;
    const [t, s] = await Promise.all([tx.tenant.findUnique({ where: { id: tenantId } }), tx.tenantSettings.findUnique({ where: { tenantId } })]);
    if (!t || s?.ai?.enabled === false) return null;
    const ent = await tenantEntitlements(tenantId);
    return { tenantId, cap: Math.min(tenantCap(s?.ai), ent.limits.aiMonthlyMessages), systemExtra: buildExtra(t.name, s?.ai) };
  });
}

export function rememberContext(uid, ctx) { if (ctx) byUid.set(uid, ctx); else byUid.delete(uid); }

/** O usuário escolhe usar a orientação de uma academia (ou null para voltar ao espaço pessoal). */
export async function setAiContext(user, tenantId) {
  if (tenantId === null || tenantId === undefined || tenantId === '') {
    await db.user.update({ where: { id: user.id }, data: { aiTenantId: null } });
    byUid.delete(user.id);
    return { tenantId: null };
  }
  if (!uuid(tenantId)) throw NOT_FOUND();
  await withContext({ userId: user.id, tenantId }, async tx => {
    const m = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId: user.id } } });
    if (!m || m.status !== 'ACTIVE') throw NOT_FOUND();
  });
  await db.user.update({ where: { id: user.id }, data: { aiTenantId: tenantId } });
  byUid.delete(user.id);
  return { tenantId };
}

export async function getAiContext(user) {
  const row = await db.user.findUnique({ where: { id: user.id }, select: { aiTenantId: true } });
  const ctx = row?.aiTenantId ? await resolveContext(user) : null;
  return { tenantId: ctx ? ctx.tenantId : null, hasGuidance: !!ctx?.systemExtra };
}

/** Consumo do mês da academia, só contagens (nunca o conteúdo): total, custo estimado, teto e por membro. */
export async function tenantAiUsage(user, tenantId) {
  if (!uuid(tenantId)) throw NOT_FOUND();
  const ai = await withContext({ userId: user.id, tenantId }, async tx => {
    const m = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId: user.id } } });
    if (!m || m.status !== 'ACTIVE') throw NOT_FOUND();
    if (!can(m, 'ai:read')) throw new SaasError(403, 'Você não tem permissão para isso.', 'forbidden');
    return (await tx.tenantSettings.findUnique({ where: { tenantId } }))?.ai || {};
  });
  const since = startOfMonth();
  const rows = await db.usageRecord.groupBy({
    by: ['userId'], where: { tenantId, createdAt: { gte: since } },
    _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true, costMicros: true }
  });
  const ok = await db.usageRecord.groupBy({ by: ['userId'], where: { tenantId, success: true, createdAt: { gte: since } }, _count: { _all: true } });
  const okBy = new Map(ok.map(r => [r.userId, r._count._all]));
  const users = await db.user.findMany({ where: { id: { in: rows.map(r => r.userId) } }, select: { id: true, name: true } });
  const name = new Map(users.map(u => [u.id, u.name]));
  const messages = [...okBy.values()].reduce((a, b) => a + b, 0);
  const costKnown = rows.some(r => r._sum.costMicros !== null);
  return {
    month: since.toISOString().slice(0, 7), enabled: ai.enabled !== false, cap: Math.min(tenantCap(ai), (await tenantEntitlements(tenantId)).limits.aiMonthlyMessages), messages,
    inputTokens: rows.reduce((a, r) => a + (r._sum.inputTokens || 0), 0), outputTokens: rows.reduce((a, r) => a + (r._sum.outputTokens || 0), 0),
    estimatedCostUsd: costKnown ? rows.reduce((a, r) => a + (r._sum.costMicros || 0), 0) / 1e6 : null,
    members: rows.map(r => ({ userId: r.userId, name: name.get(r.userId) || null, messages: okBy.get(r.userId) || 0 })).sort((a, b) => b.messages - a.messages)
  };
}
