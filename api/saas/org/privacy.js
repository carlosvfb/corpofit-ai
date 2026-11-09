/* Privacidade e compartilhamento. O aluno decide, por personal e por categoria, o que o personal vê (SEE)
   ou sugere (SUGGEST). A permissão é conferida a CADA leitura, então revogar vale na hora; cada leitura vai
   para o registro de acessos do aluno e cada mudança de consentimento para um histórico imutável.
   O personal nunca recebe o estado inteiro do aluno: só a projeção da categoria (projection.js). */
import { SaasError } from '../errors.js';
import { withContext } from './context.js';
import { AVAILABLE, CATEGORIES, project } from './projection.js';
import { notify } from './notify.js';

const NOT_FOUND = () => new SaasError(404, 'Não encontrado.', 'not-found');
const FORBIDDEN = () => new SaasError(403, 'Você não tem permissão para ver isso.', 'forbidden');
const LEVELS = ['OFF', 'SEE', 'SUGGEST'];            // CHANGE_DIRECTLY ainda não pode ser concedido
const RANK = { OFF: 0, SEE: 1, SUGGEST: 2, CHANGE_DIRECTLY: 3 };

export const categories = () => Object.entries(CATEGORIES).map(([id, c]) => ({ id, label: c.label, hint: c.hint, available: c.available, suggest: !!c.suggest }));

async function activeLink(tx, studentId, trainerId) {
  const l = await tx.trainerStudent.findUnique({ where: { trainerId_studentId: { trainerId, studentId } } });
  return l && l.status === 'ACTIVE' ? l : null;
}

/** O nível que o aluno concedeu a este personal nesta categoria (OFF se não há vínculo ativo ou concessão). */
export async function levelFor(tx, studentId, trainerId, category) {
  if (!(await activeLink(tx, studentId, trainerId))) return 'OFF';
  const p = await tx.sharingPermission.findUnique({ where: { studentId_trainerId_category: { studentId, trainerId, category } } });
  return p?.level || 'OFF';
}

/** O aluno concede, altera ou revoga um nível. Só com vínculo ativo; só categorias e níveis implementados. */
export async function setPermission(user, trainerId, category, level) {
  if (!AVAILABLE.includes(category)) throw new SaasError(400, 'Essa categoria ainda não pode ser compartilhada.', 'category-unavailable');
  if (!LEVELS.includes(level)) throw new SaasError(400, 'Nível inválido.', 'invalid-level');
  if (level === 'SUGGEST' && !CATEGORIES[category].suggest) throw new SaasError(400, 'Só as rotinas aceitam sugestões.', 'suggest-unsupported');
  return withContext({ userId: user.id }, async tx => {
    if (!(await activeLink(tx, user.id, String(trainerId)))) throw NOT_FOUND();
    const cur = await tx.sharingPermission.findUnique({ where: { studentId_trainerId_category: { studentId: user.id, trainerId: String(trainerId), category } } });
    const previous = cur?.level || 'OFF';
    if (previous === level) return { category, level, changed: false };
    await tx.sharingPermission.upsert({
      where: { studentId_trainerId_category: { studentId: user.id, trainerId: String(trainerId), category } },
      create: { studentId: user.id, trainerId: String(trainerId), category, level }, update: { level }
    });
    await tx.consentRecord.create({ data: { studentId: user.id, trainerId: String(trainerId), category, previousLevel: previous, level, action: level === 'OFF' ? 'REVOKE' : previous === 'OFF' ? 'GRANT' : 'CHANGE', actorUserId: user.id } });
    await notify(tx, String(trainerId), { kind: 'sharing', title: `${user.name || 'Um aluno'} ${level === 'OFF' ? 'parou de compartilhar' : 'alterou o que compartilha'}: ${CATEGORIES[category].label}`, link: '/personal', dedupeKey: `sharing:${user.id}:${category}:${Date.now()}` });
    return { category, level, changed: true };
  });
}

/** Revoga tudo de uma vez para um personal. */
export async function revokeAll(user, trainerId) {
  return withContext({ userId: user.id }, async tx => {
    const rows = await tx.sharingPermission.findMany({ where: { studentId: user.id, trainerId: String(trainerId), level: { not: 'OFF' } } });
    for (const r of rows) {
      await tx.sharingPermission.update({ where: { id: r.id }, data: { level: 'OFF' } });
      await tx.consentRecord.create({ data: { studentId: user.id, trainerId: r.trainerId, category: r.category, previousLevel: r.level, level: 'OFF', action: 'REVOKE', actorUserId: user.id } });
    }
    return { revoked: rows.length };
  });
}

/** Para a tela do aluno: o que concedeu a cada personal vinculado (ativo ou pendente). */
export async function myPermissions(user) {
  return withContext({ userId: user.id }, async tx => {
    const [links, perms] = await Promise.all([
      tx.trainerStudent.findMany({ where: { studentId: user.id, status: 'ACTIVE' } }),
      tx.sharingPermission.findMany({ where: { studentId: user.id } })
    ]);
    return links.map(l => ({
      linkId: l.id, trainerId: l.trainerId,
      grants: Object.fromEntries(AVAILABLE.map(c => [c, perms.find(p => p.trainerId === l.trainerId && p.category === c)?.level || 'OFF']))
    }));
  });
}

export async function consentHistory(user, trainerId) {
  const rows = await withContext({ userId: user.id }, tx => tx.consentRecord.findMany({ where: { studentId: user.id, ...(trainerId ? { trainerId: String(trainerId) } : {}) }, orderBy: { createdAt: 'desc' }, take: 200 }));
  return rows.map(r => ({ id: r.id, trainerId: r.trainerId, category: r.category, from: r.previousLevel, to: r.level, action: r.action, at: r.createdAt }));
}

export async function accessLog(user) {
  const rows = await withContext({ userId: user.id }, tx => tx.accessLog.findMany({ where: { studentId: user.id }, orderBy: { createdAt: 'desc' }, take: 200 }));
  return rows.map(r => ({ id: r.id, actorId: r.actorId, category: r.category, at: r.createdAt }));
}

/** Para a tela do personal: o que cada aluno compartilha com ele. Só vínculos ativos. */
export async function sharedWithMe(user) {
  return withContext({ userId: user.id }, async tx => {
    const [links, perms] = await Promise.all([
      tx.trainerStudent.findMany({ where: { trainerId: user.id, status: 'ACTIVE' } }),
      tx.sharingPermission.findMany({ where: { trainerId: user.id, level: { not: 'OFF' } } })
    ]);
    return links.map(l => ({ linkId: l.id, studentId: l.studentId, grants: Object.fromEntries(perms.filter(p => p.studentId === l.studentId && AVAILABLE.includes(p.category)).map(p => [p.category, p.level])) }));
  });
}

/** A leitura: vínculo ativo do próprio personal + nível ≥ SEE na categoria, conferidos agora. */
export async function studentData(user, linkId, category, readState) {
  if (!AVAILABLE.includes(category)) throw new SaasError(400, 'Categoria indisponível.', 'category-unavailable');
  const studentId = await withContext({ userId: user.id }, async tx => {
    const l = await tx.trainerStudent.findUnique({ where: { id: String(linkId) } });
    if (!l || l.trainerId !== user.id) throw NOT_FOUND();
    if (l.status !== 'ACTIVE') throw FORBIDDEN();
    const level = await levelFor(tx, l.studentId, user.id, category);
    if (RANK[level] < RANK.SEE) throw FORBIDDEN();
    // createMany: sem RETURNING, porque o personal pode inserir o registro mas não lê-lo (RLS).
    await tx.accessLog.createMany({ data: [{ studentId: l.studentId, actorId: user.id, category }] });
    return l.studentId;
  });
  const S = await readState(studentId);
  return { category, asOf: new Date().toISOString(), data: project(category, S) };
}

/** Atalhos de compartilhamento para o aluno escolher de uma vez (ele ainda pode ajustar categoria por categoria).
    "training": o que o personal precisa para acompanhar o treino. "full": também corpo e observações. "none": nada. */
export const PRESETS = {
  none: {},
  training: { WORKOUTS: 'SEE', EXERCISE_HISTORY: 'SEE', ROUTINES: 'SUGGEST', ACTIVITY: 'SEE' },
  full: { WORKOUTS: 'SEE', EXERCISE_HISTORY: 'SEE', ROUTINES: 'SUGGEST', ACTIVITY: 'SEE', BODY_WEIGHT: 'SEE', MEASUREMENTS: 'SEE', NOTES: 'SEE' }
};
export async function applyPreset(user, trainerId, preset) {
  const p = PRESETS[preset];
  if (!p) throw new SaasError(400, 'Atalho inválido.', 'invalid-preset');
  let changed = 0;
  for (const c of AVAILABLE) { const r = await setPermission(user, trainerId, c, p[c] || 'OFF'); if (r.changed) changed++; }
  return { preset, changed };
}
