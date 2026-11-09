/* Avisos dentro do app. Quem age grava o aviso da outra pessoa na mesma transação do que fez (`notify`);
   cada pessoa só lê e marca como lidos os próprios (RLS). `dedupeKey` evita avisar duas vezes o mesmo evento. */
import { randomUUID } from 'node:crypto';
import { withContext } from './context.js';

const clip = (v, n) => String(v ?? '').slice(0, n);

export async function notify(tx, userId, { kind, title, body = '', link = '', dedupeKey } = {}) {
  if (!userId) return;
  await tx.notification.createMany({
    data: [{ userId: String(userId), kind: clip(kind, 40), title: clip(title, 120), body: clip(body, 300), link: clip(link, 120), dedupeKey: clip(dedupeKey || randomUUID(), 160) }],
    skipDuplicates: true
  });
}

export async function listNotifications(user, limit = 50) {
  const take = Math.max(1, Math.min(100, Number(limit) || 50));
  return withContext({ userId: user.id }, async tx => {
    const [items, unread] = await Promise.all([
      tx.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take }),
      tx.notification.count({ where: { userId: user.id, readAt: null } })
    ]);
    return { unread, items: items.map(n => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, link: n.link, read: !!n.readAt, at: n.createdAt })) };
  });
}

/** `ids` = lista de IDs, ou 'all'. */
export async function markRead(user, ids) {
  return withContext({ userId: user.id }, async tx => {
    const where = ids === 'all' ? { userId: user.id, readAt: null } : { userId: user.id, readAt: null, id: { in: Array.isArray(ids) ? ids.map(String).slice(0, 200) : [] } };
    const r = await tx.notification.updateMany({ where, data: { readAt: new Date() } });
    return { marked: r.count };
  });
}
