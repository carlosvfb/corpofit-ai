import { db } from './db.js';
import { env } from './env.js';

export function startOfMonth(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function startOfNextMonth(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

/** Mensagens de IA bem-sucedidas deste mês (é o que conta para o limite do plano). */
export async function aiUsageThisMonth(userId, now = new Date()) {
  return db.usageRecord.count({ where: { userId, success: true, createdAt: { gte: startOfMonth(now) } } });
}

/** Custo estimado em micro-dólares: tokens × preço por milhão de tokens (AI_PRICES). Sem preço do modelo, null. */
export function estimateCostMicros(model, usage) {
  let prices;
  try { prices = env().AI_PRICES ? JSON.parse(env().AI_PRICES) : null; } catch { prices = null; }
  const p = prices && model ? prices[model] : null;
  const pin = Number(p?.in), pout = Number(p?.out);
  if (!Number.isFinite(pin) || !Number.isFinite(pout) || pin < 0 || pout < 0) return null;
  return Math.round(pin * (usage?.input || 0) + pout * (usage?.output || 0));
}

export async function recordUsage({ userId, kind, usage, success, model, tenantId = null, provider = null }) {
  await db.usageRecord.create({
    data: {
      userId,
      kind: String(kind || 'coach').slice(0, 40),
      inputTokens: usage?.input || 0,
      outputTokens: usage?.output || 0,
      success: !!success,
      model: model ? String(model).slice(0, 80) : null,
      tenantId: tenantId || null,
      provider: provider ? String(provider).slice(0, 40) : null,
      costMicros: estimateCostMicros(model, usage)
    }
  });
}
