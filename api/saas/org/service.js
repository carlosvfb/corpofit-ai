/* Academias: criação, vínculos (Membership), convites, configurações, painel e registro de atividade.
   Segurança em duas camadas: aqui (papel do ator no vínculo, `can`/`canManage`) e no PostgreSQL (RLS por
   `app.tenant_id`). Uma academia que o usuário não integra responde 404, nunca 403, para não revelar
   que ela existe. */
import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { SaasError } from '../errors.js';
import { ensureUser } from '../access.js';
import { withContext } from './context.js';
import { can, canAssign, canManage, isRole, rankOf } from './rbac.js';

const NOT_FOUND = () => new SaasError(404, 'Academia não encontrada.', 'not-found');
const FORBIDDEN = () => new SaasError(403, 'Você não tem permissão para isso.', 'forbidden');

const slugify = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;
const HEX = /^#[0-9a-f]{6}$/i;

async function log(tx, tenantId, actorUserId, action, extra = {}) {
  await tx.activityLog.create({ data: { tenantId, actorUserId, action, targetType: extra.targetType ?? null, targetId: extra.targetId ?? null, before: extra.before ?? undefined, after: extra.after ?? undefined } });
}

/** O vínculo ATIVO do usuário nesta academia; sem ele, a academia "não existe" para ele. */
async function requireMember(tx, tenantId, userId) {
  const m = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId } } });
  if (!m || m.status !== 'ACTIVE') throw NOT_FOUND();
  return m;
}
async function requirePermission(tx, tenantId, userId, permission) {
  const m = await requireMember(tx, tenantId, userId);
  if (!can(m, permission)) throw FORBIDDEN();
  return m;
}

const publicMember = (m, u) => ({ userId: m.userId, name: u?.name ?? null, email: u?.email ?? null, role: m.role, status: m.status, since: m.createdAt });

/* ------------------------------- academia ------------------------------- */

export async function createGym(user, input) {
  const name = String(input?.name || '').trim();
  if (name.length < 2 || name.length > 80) throw new SaasError(400, 'Informe o nome da academia (2 a 80 caracteres).', 'invalid-name');
  const slug = slugify(input?.slug || name);
  if (!SLUG.test(slug)) throw new SaasError(400, 'O endereço da academia deve ter de 3 a 40 letras minúsculas, números ou hífens.', 'invalid-slug');
  await ensureUser(user);
  const id = randomUUID();
  try {
    return await withContext({ userId: user.id, tenantId: id }, async tx => {
      const tenant = await tx.tenant.create({ data: { id, name, slug } });
      await tx.tenantSettings.create({ data: { tenantId: id, brand: { displayName: name } } });
      await tx.membership.create({ data: { tenantId: id, userId: user.id, role: 'GYM_OWNER', status: 'ACTIVE' } });
      await log(tx, id, user.id, 'tenant.created', { targetType: 'tenant', targetId: id, after: { name, slug } });
      return { id: tenant.id, name: tenant.name, slug: tenant.slug, role: 'GYM_OWNER' };
    });
  } catch (e) {
    if (e?.code === 'P2002') throw new SaasError(409, 'Esse endereço de academia já está em uso.', 'slug-taken');
    throw e;
  }
}

/** Os contextos do usuário: o espaço pessoal e cada academia em que tem vínculo (ou convite pendente). */
export async function myContexts(user) {
  await ensureUser(user);
  const rows = await withContext({ userId: user.id }, tx => tx.membership.findMany({
    where: { userId: user.id, status: { in: ['ACTIVE', 'INVITED'] } },
    include: { tenant: true },
    orderBy: { createdAt: 'asc' }
  }));
  return {
    personal: { id: 'personal', name: user.name || 'Espaço pessoal' },
    gyms: rows.map(r => ({ id: r.tenantId, name: r.tenant.name, slug: r.tenant.slug, role: r.role, status: r.status }))
  };
}

/* -------------------------------- vínculos ------------------------------- */

export async function listMembers(user, tenantId) {
  const rows = await withContext({ userId: user.id, tenantId }, async tx => {
    await requirePermission(tx, tenantId, user.id, 'members:read');
    return tx.membership.findMany({ where: { tenantId, status: { not: 'REMOVED' } }, orderBy: { createdAt: 'asc' } });
  });
  const users = await db.user.findMany({ where: { id: { in: rows.map(r => r.userId) } }, select: { id: true, name: true, email: true } });
  const by = new Map(users.map(u => [u.id, u]));
  return rows.map(r => publicMember(r, by.get(r.userId)));
}

/** Convida um usuário que já tem conta (por e-mail ou id). O vínculo só vale depois do aceite dele. */
export async function inviteMember(user, tenantId, input) {
  const role = input?.role;
  if (!isRole(role)) throw new SaasError(400, 'Papel inválido.', 'invalid-role');
  const email = String(input?.email || '').trim().toLowerCase();
  const target = input?.userId
    ? await db.user.findUnique({ where: { id: String(input.userId) } })
    : email ? await db.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, deletedAt: null } }) : null;
  return withContext({ userId: user.id, tenantId }, async tx => {
    const actor = await requirePermission(tx, tenantId, user.id, 'members:invite');
    if (!canAssign(actor, role)) throw FORBIDDEN();
    if (!target || target.deletedAt) throw new SaasError(404, 'Não há uma conta com esse e-mail. Peça para a pessoa se cadastrar primeiro.', 'user-not-found');
    const existing = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId: target.id } } });
    if (existing && existing.status !== 'REMOVED') throw new SaasError(409, 'Essa pessoa já faz parte da academia ou já foi convidada.', 'already-member');
    const m = existing
      ? await tx.membership.update({ where: { id: existing.id }, data: { role, status: 'INVITED', invitedById: user.id } })
      : await tx.membership.create({ data: { tenantId, userId: target.id, role, status: 'INVITED', invitedById: user.id } });
    await log(tx, tenantId, user.id, 'member.invited', { targetType: 'user', targetId: target.id, before: existing ? { role: existing.role, status: existing.status } : undefined, after: { role, status: 'INVITED' } });
    return publicMember(m, target);
  });
}

/** O convidado aceita o próprio convite. Só mexe no vínculo dele mesmo. */
export async function acceptInvite(user, tenantId) {
  return withContext({ userId: user.id, tenantId }, async tx => {
    const m = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId: user.id } } });
    if (!m || m.status !== 'INVITED') throw new SaasError(404, 'Convite não encontrado.', 'not-found');
    const updated = await tx.membership.update({ where: { id: m.id }, data: { status: 'ACTIVE' } });
    await log(tx, tenantId, user.id, 'member.joined', { targetType: 'user', targetId: user.id, before: { status: 'INVITED' }, after: { status: 'ACTIVE', role: m.role } });
    return { tenantId, role: updated.role, status: updated.status };
  });
}

export async function updateMemberRole(user, tenantId, targetUserId, role) {
  if (!isRole(role)) throw new SaasError(400, 'Papel inválido.', 'invalid-role');
  return withContext({ userId: user.id, tenantId }, async tx => {
    const actor = await requirePermission(tx, tenantId, user.id, 'members:update');
    const target = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId: String(targetUserId) } } });
    if (!target || target.status === 'REMOVED') throw new SaasError(404, 'Vínculo não encontrado.', 'not-found');
    if (!canManage(actor, target) || !canAssign(actor, role)) throw FORBIDDEN();
    const updated = await tx.membership.update({ where: { id: target.id }, data: { role } });
    await log(tx, tenantId, user.id, 'member.role-changed', { targetType: 'user', targetId: target.userId, before: { role: target.role }, after: { role } });
    return publicMember(updated, null);
  });
}

export async function removeMember(user, tenantId, targetUserId) {
  return withContext({ userId: user.id, tenantId }, async tx => {
    const actor = await requirePermission(tx, tenantId, user.id, 'members:remove');
    const target = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId: String(targetUserId) } } });
    if (!target || target.status === 'REMOVED') throw new SaasError(404, 'Vínculo não encontrado.', 'not-found');
    if (!canManage(actor, target)) throw FORBIDDEN();
    await tx.membership.update({ where: { id: target.id }, data: { status: 'REMOVED' } });
    await log(tx, tenantId, user.id, 'member.removed', { targetType: 'user', targetId: target.userId, before: { role: target.role, status: target.status }, after: { status: 'REMOVED' } });
    return { removed: true };
  });
}

/** Sair da academia. O último dono não pode sair: passe a posse antes. */
export async function leaveGym(user, tenantId) {
  return withContext({ userId: user.id, tenantId }, async tx => {
    const m = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId: user.id } } });
    if (!m || m.status === 'REMOVED') throw NOT_FOUND();
    if (m.role === 'GYM_OWNER' && m.status === 'ACTIVE') {
      const owners = await tx.membership.count({ where: { tenantId, role: 'GYM_OWNER', status: 'ACTIVE' } });
      if (owners <= 1) throw new SaasError(409, 'Você é o único dono. Passe a posse a outra pessoa antes de sair.', 'last-owner');
    }
    await tx.membership.update({ where: { id: m.id }, data: { status: 'REMOVED' } });
    await log(tx, tenantId, user.id, 'member.left', { targetType: 'user', targetId: user.id, before: { role: m.role, status: m.status }, after: { status: 'REMOVED' } });
    return { left: true };
  });
}

/* ----------------------------- configurações ----------------------------- */

const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);

/** Aceita só os campos conhecidos, com limites; o resto é descartado. */
export function cleanSettings(input) {
  const out = {};
  const b = input?.brand;
  if (b && typeof b === 'object') {
    const brand = {};
    const dn = str(b.displayName, 80); if (dn) brand.displayName = dn;
    const desc = str(b.description, 500); if (desc !== undefined) brand.description = desc;
    if (typeof b.primaryColor === 'string' && HEX.test(b.primaryColor.trim())) brand.primaryColor = b.primaryColor.trim().toLowerCase();
    if (typeof b.logoUrl === 'string' && /^https:\/\/[^\s]{3,480}$/i.test(b.logoUrl.trim())) brand.logoUrl = b.logoUrl.trim();
    const c = b.contact;
    if (c && typeof c === 'object') {
      const contact = {};
      const em = str(c.email, 120); if (em && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) contact.email = em;
      const ph = str(c.phone, 30); if (ph) contact.phone = ph;
      brand.contact = contact;
    }
    out.brand = brand;
  }
  const a = input?.ai;
  if (a && typeof a === 'object') {
    const ai = {};
    if (typeof a.enabled === 'boolean') ai.enabled = a.enabled;
    const ins = str(a.instructions, 2000); if (ins !== undefined) ai.instructions = ins;
    const sty = str(a.style, 200); if (sty !== undefined) ai.style = sty;
    const mm = Number(a.monthlyMessages); if (Number.isFinite(mm) && mm >= 1 && mm <= 10_000_000) ai.monthlyMessages = Math.floor(mm);
    out.ai = ai;
  }
  const f = input?.features;
  if (f && typeof f === 'object') {
    out.features = Object.fromEntries(Object.entries(f).filter(([k, v]) => /^[a-z][a-zA-Z0-9]{0,30}$/.test(k) && typeof v === 'boolean'));
  }
  return out;
}

export async function getSettings(user, tenantId) {
  return withContext({ userId: user.id, tenantId }, async tx => {
    await requirePermission(tx, tenantId, user.id, 'settings:read');
    const [tenant, s] = await Promise.all([tx.tenant.findUnique({ where: { id: tenantId } }), tx.tenantSettings.findUnique({ where: { tenantId } })]);
    if (!tenant) throw NOT_FOUND();
    return { id: tenant.id, name: tenant.name, slug: tenant.slug, brand: s?.brand ?? {}, ai: s?.ai ?? {}, features: s?.features ?? {} };
  });
}

export async function updateSettings(user, tenantId, input) {
  const patch = cleanSettings(input);
  return withContext({ userId: user.id, tenantId }, async tx => {
    await requirePermission(tx, tenantId, user.id, 'settings:write');
    const cur = await tx.tenantSettings.findUnique({ where: { tenantId } });
    const next = {
      brand: patch.brand ? { ...(cur?.brand ?? {}), ...patch.brand } : (cur?.brand ?? {}),
      ai: patch.ai ? { ...(cur?.ai ?? {}), ...patch.ai } : (cur?.ai ?? {}),
      features: patch.features ? { ...(cur?.features ?? {}), ...patch.features } : (cur?.features ?? {})
    };
    await tx.tenantSettings.upsert({ where: { tenantId }, create: { tenantId, ...next }, update: next });
    if (patch.brand?.displayName) await tx.tenant.update({ where: { id: tenantId }, data: { name: patch.brand.displayName } });
    await log(tx, tenantId, user.id, 'settings.updated', { targetType: 'tenant', targetId: tenantId, before: cur ? { brand: cur.brand, ai: cur.ai, features: cur.features } : undefined, after: next });
    return next;
  });
}

/* ---------------------------- painel e atividade --------------------------- */

/** Só contagens reais do que existe nesta fase. Frequência e evolução entram quando houver dados. */
export async function dashboard(user, tenantId) {
  return withContext({ userId: user.id, tenantId }, async tx => {
    await requirePermission(tx, tenantId, user.id, 'dashboard:read');
    const rows = await tx.membership.findMany({ where: { tenantId, status: { not: 'REMOVED' } }, select: { role: true, status: true, createdAt: true } });
    const since = Date.now() - 30 * 86_400_000;
    const active = rows.filter(r => r.status === 'ACTIVE');
    const byRole = Object.fromEntries(['GYM_OWNER', 'GYM_ADMIN', 'GYM_MANAGER', 'PERSONAL_TRAINER', 'STUDENT'].map(r => [r, active.filter(x => x.role === r).length]));
    return {
      members: { active: active.length, invited: rows.length - active.length, byRole },
      students: { active: byRole.STUDENT, joinedLast30Days: active.filter(r => r.role === 'STUDENT' && r.createdAt.getTime() >= since).length },
      professionals: { active: byRole.PERSONAL_TRAINER + byRole.GYM_MANAGER }
    };
  });
}

export async function recentActivity(user, tenantId, limit = 50) {
  const n = Math.max(1, Math.min(200, Number(limit) || 50));
  return withContext({ userId: user.id, tenantId }, async tx => {
    await requirePermission(tx, tenantId, user.id, 'activity:read');
    const rows = await tx.activityLog.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take: n });
    return rows.map(r => ({ id: r.id, at: r.createdAt, actor: r.actorUserId, action: r.action, targetType: r.targetType, targetId: r.targetId, before: r.before, after: r.after }));
  });
}

export { rankOf };
