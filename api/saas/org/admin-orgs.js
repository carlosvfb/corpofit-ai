/* Painel da plataforma: as academias, só com contagens e plano (nada do conteúdo delas). Só para o admin. */
import { db } from '../db.js';
import { withContext } from './context.js';
import { tenantEntitlements } from './billing.js';

export async function listGyms(admin) {
  // moderador 'platform': o servidor já verificou que quem chama é o admin da plataforma
  const rows = await withContext({ userId: admin.id, moderator: 'platform' }, async tx => {
    const tenants = await tx.tenant.findMany({ orderBy: { createdAt: 'desc' }, take: 200 });
    const members = await tx.membership.groupBy({ by: ['tenantId', 'status'], _count: { _all: true } }).catch(() => []);
    return { tenants, members };
  });
  const out = [];
  for (const t of rows.tenants) {
    const ent = await tenantEntitlements(t.id);
    const c = rows.members.filter(m => m.tenantId === t.id);
    out.push({ id: t.id, name: t.name, slug: t.slug, status: t.status, createdAt: t.createdAt, plan: ent.plan.name, paid: ent.paid,
      members: c.filter(m => m.status === 'ACTIVE').reduce((n, m) => n + m._count._all, 0), invited: c.filter(m => m.status === 'INVITED').reduce((n, m) => n + m._count._all, 0) });
  }
  return out;
}
