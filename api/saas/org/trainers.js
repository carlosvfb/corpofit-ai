/* Personal trainers: perfil profissional, vínculo com alunos, treinos enviados, comentários e histórico.
   Nesta fase o personal só ENVIA treinos que ele mesmo montou; não lê nenhum dado do aluno (isso depende
   do consentimento por categoria, fase 5). Um vínculo só vale depois que o lado que NÃO o iniciou aceita.
   Quem não é parte do vínculo recebe 404 em tudo (e o RLS do banco esconde as linhas). */
import { db } from '../db.js';
import { SaasError } from '../errors.js';
import { ensureUser } from '../access.js';
import { withContext } from './context.js';
import { rankOf } from './rbac.js';
import { levelFor } from './privacy.js';
import { notify } from './notify.js';

const NOT_FOUND = () => new SaasError(404, 'Não encontrado.', 'not-found');
const FORBIDDEN = () => new SaasError(403, 'Você não tem permissão para isso.', 'forbidden');
const MAX_BUNDLE = 40_000; // caracteres do JSON do treino
const MAX_HISTORY = 20;

const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max) : '');
const userByEmail = email => db.user.findFirst({ where: { email: { equals: String(email || '').trim().toLowerCase(), mode: 'insensitive' }, deletedAt: null } });

/* -------------------------------- perfil -------------------------------- */

export async function getProfile(user, userId = user.id) {
  const p = await withContext({ userId: user.id }, tx => tx.trainerProfile.findUnique({ where: { userId } }));
  return p ? { userId: p.userId, displayName: p.displayName, bio: p.bio, specialties: p.specialties } : null;
}

export async function saveProfile(user, input) {
  const displayName = clean(input?.displayName, 80);
  if (displayName.length < 2) throw new SaasError(400, 'Informe seu nome profissional.', 'invalid-name');
  const specialties = Array.isArray(input?.specialties) ? input.specialties.map(s => clean(s, 40)).filter(Boolean).slice(0, 10) : [];
  const bio = clean(input?.bio, 600);
  await ensureUser(user);
  const p = await withContext({ userId: user.id }, tx => tx.trainerProfile.upsert({
    where: { userId: user.id }, create: { userId: user.id, displayName, bio, specialties }, update: { displayName, bio, specialties }
  }));
  return { userId: p.userId, displayName: p.displayName, bio: p.bio, specialties: p.specialties };
}

/* -------------------------------- vínculos ------------------------------- */

/** Com academia, os dois precisam ser membros ATIVOS dela: o personal (ou nível acima) e o aluno. */
async function checkGym(tx, tenantId, trainerId, studentId) {
  const [t, s] = await Promise.all([
    tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId: trainerId } } }),
    tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId: studentId } } })
  ]);
  if (!t || t.status !== 'ACTIVE' || rankOf(t.role) < rankOf('PERSONAL_TRAINER')) throw FORBIDDEN();
  if (!s || s.status !== 'ACTIVE' || s.role !== 'STUDENT') throw new SaasError(409, 'A outra pessoa precisa ser aluna desta academia.', 'not-in-gym');
}

async function createLink(actor, { trainerId, studentId, initiatedBy, tenantId }) {
  if (trainerId === studentId) throw new SaasError(400, 'Você não pode ser seu próprio personal.', 'self');
  if (tenantId && !/^[0-9a-f-]{36}$/i.test(tenantId)) throw NOT_FOUND();
  return withContext({ userId: actor.id, tenantId: tenantId || '' }, async tx => {
    if (tenantId) await checkGym(tx, tenantId, trainerId, studentId);
    const existing = await tx.trainerStudent.findUnique({ where: { trainerId_studentId: { trainerId, studentId } } });
    if (existing && existing.status !== 'ENDED') throw new SaasError(409, 'Já existe um vínculo ou convite entre vocês.', 'exists');
    const data = { status: 'PENDING', initiatedBy, tenantId: tenantId || null, endedAt: null };
    const link = existing
      ? await tx.trainerStudent.update({ where: { id: existing.id }, data })
      : await tx.trainerStudent.create({ data: { trainerId, studentId, ...data } });
    await notify(tx, initiatedBy === 'TRAINER' ? studentId : trainerId, { kind: 'trainer-link', title: initiatedBy === 'TRAINER' ? `${actor.name || 'Um personal'} convidou você para ser aluno(a)` : `${actor.name || 'Um aluno'} pediu para ser atendido(a) por você`, body: 'Responda no app.', link: initiatedBy === 'TRAINER' ? '/meu-personal' : '/personal', dedupeKey: `trainer-link:${link.id}:${link.updatedAt.getTime()}` });
    if (tenantId) await tx.activityLog.create({ data: { tenantId, actorUserId: actor.id, action: 'trainer-link.requested', targetType: 'user', targetId: initiatedBy === 'TRAINER' ? studentId : trainerId, after: { initiatedBy } } });
    return link;
  });
}

/** O personal convida um aluno que já tem conta. */
export async function inviteStudent(user, { email, tenantId }) {
  if (!(await getProfile(user))) throw new SaasError(409, 'Crie seu perfil profissional antes de convidar alunos.', 'no-profile');
  const target = await userByEmail(email);
  if (!target) throw new SaasError(404, 'Não há uma conta com esse e-mail. Peça para a pessoa se cadastrar primeiro.', 'user-not-found');
  return summarize(await createLink(user, { trainerId: user.id, studentId: target.id, initiatedBy: 'TRAINER', tenantId }), user);
}

/** O aluno pede para ser atendido por um personal que tem perfil. */
export async function requestTrainer(user, { email, tenantId }) {
  const target = await userByEmail(email);
  const profile = target ? await getProfile(user, target.id) : null;
  if (!target || !profile) throw new SaasError(404, 'Não encontramos um personal com esse e-mail.', 'trainer-not-found');
  await ensureUser(user);
  return summarize(await createLink(user, { trainerId: target.id, studentId: user.id, initiatedBy: 'STUDENT', tenantId }), user);
}

const summarize = (l, me) => ({ id: l.id, status: l.status, initiatedBy: l.initiatedBy, tenantId: l.tenantId, side: l.trainerId === me.id ? 'TRAINER' : 'STUDENT', trainerId: l.trainerId, studentId: l.studentId, createdAt: l.createdAt });

async function loadLink(tx, user, id) {
  const l = await tx.trainerStudent.findUnique({ where: { id: String(id) } });
  if (!l || (l.trainerId !== user.id && l.studentId !== user.id)) throw NOT_FOUND();
  return l;
}

/** Aceitar ou recusar: só o lado que não iniciou o vínculo. */
export async function respondLink(user, id, accept) {
  return withContext({ userId: user.id }, async tx => {
    const l = await loadLink(tx, user, id);
    const mySide = l.trainerId === user.id ? 'TRAINER' : 'STUDENT';
    if (l.status !== 'PENDING' || l.initiatedBy === mySide) throw new SaasError(409, 'Esse convite não está esperando a sua resposta.', 'not-pending');
    const u = await tx.trainerStudent.update({ where: { id: l.id }, data: accept ? { status: 'ACTIVE' } : { status: 'ENDED', endedAt: new Date() } });
    await notify(tx, l.initiatedBy === 'TRAINER' ? l.trainerId : l.studentId, { kind: 'trainer-link', title: `${user.name || 'A outra pessoa'} ${accept ? 'aceitou' : 'recusou'} o vínculo`, link: l.initiatedBy === 'TRAINER' ? '/personal' : '/meu-personal', dedupeKey: `trainer-link-answer:${l.id}:${u.updatedAt.getTime()}` });
    return summarize(u, user);
  });
}

/** Qualquer um dos dois encerra. Os treinos já enviados ficam, arquivados, para o aluno. */
export async function endLink(user, id) {
  return withContext({ userId: user.id }, async tx => {
    const l = await loadLink(tx, user, id);
    if (l.status === 'ENDED') return summarize(l, user);
    const u = await tx.trainerStudent.update({ where: { id: l.id }, data: { status: 'ENDED', endedAt: new Date() } });
    await tx.assignment.updateMany({ where: { linkId: l.id, status: 'ASSIGNED' }, data: { status: 'ARCHIVED' } });
    await tx.trainingSession.updateMany({ where: { linkId: l.id, status: { in: ['PLANNED', 'CONFIRMED'] }, startsAt: { gte: new Date() } }, data: { status: 'CANCELLED', cancelledBy: l.trainerId === user.id ? 'TRAINER' : 'STUDENT', reason: 'Vínculo encerrado' } });
    return summarize(u, user);
  });
}

export async function listLinks(user) {
  const rows = await withContext({ userId: user.id }, tx => tx.trainerStudent.findMany({ where: { status: { not: 'ENDED' }, OR: [{ trainerId: user.id }, { studentId: user.id }] }, orderBy: { createdAt: 'desc' } }));
  const ids = [...new Set(rows.flatMap(r => [r.trainerId, r.studentId]))];
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
  const by = new Map(users.map(u => [u.id, u]));
  const profiles = await withContext({ userId: user.id }, tx => tx.trainerProfile.findMany({ where: { userId: { in: ids } } }));
  const pname = new Map(profiles.map(p => [p.userId, p.displayName]));
  return rows.map(r => {
    const other = by.get(r.trainerId === user.id ? r.studentId : r.trainerId);
    return { ...summarize(r, user), other: { id: other?.id, name: pname.get(other?.id) || other?.name || null, email: other?.email || null } };
  });
}

/* ------------------------------- treinos enviados ------------------------------ */

/** O arquivo de plano do app com UMA rotina. O servidor só limita o tamanho e a forma; o app do aluno
 *  o valida de verdade ao importar. */
export function cleanBundle(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b) || !Array.isArray(b.routines) || b.routines.length !== 1) throw new SaasError(400, 'O treino precisa ter exatamente uma rotina.', 'invalid-bundle');
  const json = JSON.stringify(b);
  if (json.length > MAX_BUNDLE) throw new SaasError(413, 'Esse treino é grande demais para ser enviado.', 'bundle-too-big');
  const r = b.routines[0];
  if (!r || typeof r !== 'object' || !Array.isArray(r.ex) || r.ex.length < 1 || r.ex.length > 40) throw new SaasError(400, 'A rotina precisa ter de 1 a 40 exercícios.', 'invalid-bundle');
  return JSON.parse(json);
}

const asg = (a, withBundle = true) => ({
  id: a.id, linkId: a.linkId, trainerId: a.trainerId, studentId: a.studentId, title: a.title, note: a.note, status: a.status, revision: a.revision,
  kind: a.kind, target: a.target, createdAt: a.createdAt, updatedAt: a.updatedAt, reviewAt: a.reviewAt ?? null, ...(withBundle ? { bundle: a.bundle } : {})
});

/** Semanas até a revisão da ficha (1 a 26), ou null para sem prazo. Lança se vier algo que não seja isso. */
export function reviewDate(weeks, from = new Date()) {
  if (weeks === undefined || weeks === null || weeks === '' || weeks === 0) return null;
  const n = Number(weeks);
  if (!Number.isInteger(n) || n < 1 || n > 26) throw new SaasError(400, 'O prazo da ficha deve ficar entre 1 e 26 semanas.', 'invalid-review');
  return new Date(from.getTime() + n * 7 * 86_400_000);
}

export async function assign(user, linkId, input) {
  const title = clean(input?.title, 80);
  if (title.length < 2) throw new SaasError(400, 'Dê um nome ao treino.', 'invalid-title');
  const bundle = cleanBundle(input?.bundle);
  const note = clean(input?.note, 1000);
  const kind = input?.kind === 'SUGGESTION' ? 'SUGGESTION' : 'ASSIGNMENT';
  const target = kind === 'SUGGESTION' ? clean(input?.target, 80) : '';
  const reviewAt = kind === 'SUGGESTION' ? null : reviewDate(input?.reviewWeeks);
  return withContext({ userId: user.id }, async tx => {
    const l = await loadLink(tx, user, linkId);
    if (l.trainerId !== user.id) throw FORBIDDEN();
    if (l.status !== 'ACTIVE') throw new SaasError(409, 'O vínculo não está ativo.', 'link-not-active');
    // Sugerir mudanças numa rotina do aluno exige a permissão dele (ROUTINES = SUGGEST), conferida agora.
    if (kind === 'SUGGESTION' && (await levelFor(tx, l.studentId, user.id, 'ROUTINES')) !== 'SUGGEST') throw new SaasError(403, 'O aluno não permitiu sugestões nas rotinas dele.', 'suggest-not-allowed');
    const a = await tx.assignment.create({ data: { linkId: l.id, trainerId: l.trainerId, studentId: l.studentId, title, note, bundle, kind, target, reviewAt } });
    await notify(tx, l.studentId, { kind: kind === 'SUGGESTION' ? 'suggestion' : 'assignment', title: kind === 'SUGGESTION' ? `${user.name || 'Seu personal'} sugeriu uma mudança na rotina${target ? ' “' + target + '”' : ''}` : `${user.name || 'Seu personal'} enviou um treino: ${title}`, body: 'Veja em Ajustes > Meu personal.', link: '/meu-personal', dedupeKey: `assignment:${a.id}` });
    return asg(a);
  });
}

/** O personal altera um treino enviado. A versão anterior vai para o histórico (até 20). */
export async function updateAssignment(user, id, input) {
  return withContext({ userId: user.id }, async tx => {
    const a = await tx.assignment.findUnique({ where: { id: String(id) } });
    if (!a || (a.trainerId !== user.id && a.studentId !== user.id)) throw NOT_FOUND();
    if (a.trainerId !== user.id) throw FORBIDDEN();
    if (a.status === 'ARCHIVED') throw new SaasError(409, 'Esse treino está arquivado.', 'archived');
    const next = {};
    if (input?.title !== undefined) { const t = clean(input.title, 80); if (t.length < 2) throw new SaasError(400, 'Dê um nome ao treino.', 'invalid-title'); next.title = t; }
    if (input?.note !== undefined) next.note = clean(input.note, 1000);
    if (input?.bundle !== undefined) next.bundle = cleanBundle(input.bundle);
    if (input?.reviewWeeks !== undefined) next.reviewAt = reviewDate(input.reviewWeeks);
    if (!Object.keys(next).length) return asg(a);
    const history = [...(Array.isArray(a.history) ? a.history : []), { at: new Date().toISOString(), by: user.id, revision: a.revision, title: a.title, note: a.note, bundle: a.bundle }].slice(-MAX_HISTORY);
    const u = await tx.assignment.update({ where: { id: a.id }, data: { ...next, revision: a.revision + 1, history, status: next.bundle ? 'ASSIGNED' : a.status } });
    return asg(u);
  });
}

export async function assignmentHistory(user, id) {
  return withContext({ userId: user.id }, async tx => {
    const a = await tx.assignment.findUnique({ where: { id: String(id) } });
    if (!a || (a.trainerId !== user.id && a.studentId !== user.id)) throw NOT_FOUND();
    return { id: a.id, revision: a.revision, history: (Array.isArray(a.history) ? a.history : []).map(h => ({ at: h.at, by: h.by, revision: h.revision, title: h.title, note: h.note })) };
  });
}

/** Do ponto de vista de quem pergunta: o que enviei (personal) ou o que recebi (aluno). */
export async function listAssignments(user, linkId) {
  const rows = await withContext({ userId: user.id }, tx => tx.assignment.findMany({
    where: { OR: [{ trainerId: user.id }, { studentId: user.id }], ...(linkId ? { linkId: String(linkId) } : {}) }, orderBy: { createdAt: 'desc' }, take: 100
  }));
  return rows.map(a => asg(a));
}

/** O aluno marca o que fez com o treino: importado na sua conta ou recusado. */
export async function answerAssignment(user, id, action) {
  if (!['IMPORTED', 'DECLINED'].includes(action)) throw new SaasError(400, 'Ação inválida.', 'invalid-action');
  return withContext({ userId: user.id }, async tx => {
    const a = await tx.assignment.findUnique({ where: { id: String(id) } });
    if (!a || (a.trainerId !== user.id && a.studentId !== user.id)) throw NOT_FOUND();
    if (a.studentId !== user.id) throw FORBIDDEN();
    if (a.status === 'ARCHIVED') throw new SaasError(409, 'Esse treino está arquivado.', 'archived');
    return asg(await tx.assignment.update({ where: { id: a.id }, data: { status: action } }), false);
  });
}

/* ------------------------------- comentários ------------------------------ */

export async function addComment(user, assignmentId, body) {
  const text = clean(body, 1000);
  if (!text) throw new SaasError(400, 'Escreva o comentário.', 'empty');
  return withContext({ userId: user.id }, async tx => {
    const a = await tx.assignment.findUnique({ where: { id: String(assignmentId) } });
    if (!a || (a.trainerId !== user.id && a.studentId !== user.id)) throw NOT_FOUND();
    const c = await tx.assignmentComment.create({ data: { assignmentId: a.id, authorId: user.id, body: text } });
    await notify(tx, a.trainerId === user.id ? a.studentId : a.trainerId, { kind: 'comment', title: `${user.name || 'Alguém'} comentou em “${a.title}”`, body: text.slice(0, 120), link: a.trainerId === user.id ? '/meu-personal' : '/personal', dedupeKey: `comment:${c.id}` });
    return { id: c.id, authorId: c.authorId, body: c.body, createdAt: c.createdAt };
  });
}

export async function listComments(user, assignmentId) {
  return withContext({ userId: user.id }, async tx => {
    const a = await tx.assignment.findUnique({ where: { id: String(assignmentId) } });
    if (!a || (a.trainerId !== user.id && a.studentId !== user.id)) throw NOT_FOUND();
    const rows = await tx.assignmentComment.findMany({ where: { assignmentId: a.id }, orderBy: { createdAt: 'asc' }, take: 200 });
    return rows.map(c => ({ id: c.id, authorId: c.authorId, mine: c.authorId === user.id, body: c.body, createdAt: c.createdAt }));
  });
}
