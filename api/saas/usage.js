import { db } from './db.js';

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

export async function recordUsage({ userId, kind, usage, success, model }) {
  await db.usageRecord.create({
    data: {
      userId,
      kind: String(kind || 'coach').slice(0, 40),
      inputTokens: usage?.input || 0,
      outputTokens: usage?.output || 0,
      success: !!success,
      model: model ? String(model).slice(0, 80) : null
    }
  });
}
