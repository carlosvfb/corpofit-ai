/* Agenda e acompanhamento do personal: treinos marcados com dia e horário exatos, anotações privadas e a visão
   geral dos alunos (quem treinou, quem sumiu, o que vem aí). Só as duas partes de um vínculo ATIVO enxergam a
   agenda; as anotações são só do personal. O que vem do treino do aluno (frequência) só é lido com a permissão
   dele, e cada leitura entra no registro de acessos. */
import { db } from '../db.js';
import { SaasError } from '../errors.js';
import { withContext } from './context.js';
import { notify } from './notify.js';
import { levelFor } from './privacy.js';
import { project } from './projection.js';

const NOT_FOUND = () => new SaasError(404, 'Não encontrado.', 'not-found');
const FORBIDDEN = () => new SaasError(403, 'Você não tem permissão para isso.', 'forbidden');
const TZ = process.env.APP_TZ || 'America/Sao_Paulo';
const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max) : '');
const when = d => new Date(d).toLocaleString('pt-BR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const OPEN = ['PLANNED', 'CONFIRMED'];

async function loadLink(tx, user, id) {
  const l = await tx.trainerStudent.findUnique({ where: { id: String(id) } });
  if (!l || (l.trainerId !== user.id && l.studentId !== user.id)) throw NOT_FOUND();
  return l;
}
async function loadSession(tx, user, id) {
  const s = await tx.trainingSession.findUnique({ where: { id: String(id) } });
  if (!s || (s.trainerId !== user.id && s.studentId !== user.id)) throw NOT_FOUND();
  return s;
}
const view = (s, names) => ({
  id: s.id, linkId: s.linkId, trainerId: s.trainerId, studentId: s.studentId, assignmentId: s.assignmentId, title: s.title, startsAt: s.startsAt,
  endsAt: new Date(s.startsAt.getTime() + s.durationMin * 60_000), durationMin: s.durationMin, place: s.place, note: s.note, status: s.status,
  cancelledBy: s.cancelledBy, reason: s.reason, seriesId: s.seriesId, student: names?.get(s.studentId) ?? null, trainer: names?.get(s.trainerId) ?? null
});
const nameMap = async rows => {
  const users = await db.user.findMany({ where: { id: { in: [...new Set(rows.flatMap(r => [r.trainerId, r.studentId]))] } }, select: { id: true, name: true } });
  return new Map(users.map(u => [u.id, u.name]));
};

/** O horário colide com outra sessão em aberto do personal? (compara intervalos) */
async function conflicts(tx, trainerId, start, durationMin, ignoreId) {
  const end = new Date(start.getTime() + durationMin * 60_000);
  const near = await tx.trainingSession.findMany({ where: { trainerId, status: { in: OPEN }, startsAt: { gte: new Date(start.getTime() - 8 * 3_600_000), lt: end }, ...(ignoreId ? { id: { not: ignoreId } } : {}) } });
  return near.find(o => o.startsAt.getTime() + o.durationMin * 60_000 > start.getTime()) || null;
}

function parseWhen(v) {
  const d = new Date(v);
  if (!v || Number.isNaN(d.getTime())) throw new SaasError(400, 'Informe o dia e o horário.', 'invalid-date');
  if (d.getTime() < Date.now() - 3_600_000) throw new SaasError(400, 'Esse horário já passou.', 'in-the-past');
  if (d.getTime() > Date.now() + 400 * 86_400_000) throw new SaasError(400, 'Escolha uma data até um ano à frente.', 'too-far');
  return d;
}
const dur = v => { const n = Number(v ?? 60); if (!Number.isInteger(n) || n < 15 || n > 240) throw new SaasError(400, 'A duração deve ficar entre 15 e 240 minutos.', 'invalid-duration'); return n; };

/* --------------------------------- agenda --------------------------------- */

/** O personal marca um treino e, se quiser, repete toda semana por N semanas. Colisão de horário = 409. */
export async function createSessions(user, linkId, input) {
  const title = clean(input?.title, 80);
  if (title.length < 2) throw new SaasError(400, 'Dê um nome ao treino marcado.', 'invalid-title');
  const first = parseWhen(input?.startsAt);
  const durationMin = dur(input?.durationMin);
  const repeat = Math.max(0, Math.min(12, Number(input?.repeatWeeks) || 0));
  const place = clean(input?.place, 120), note = clean(input?.note, 500);
  return withContext({ userId: user.id }, async tx => {
    const l = await loadLink(tx, user, linkId);
    if (l.trainerId !== user.id) throw FORBIDDEN();
    if (l.status !== 'ACTIVE') throw new SaasError(409, 'O vínculo não está ativo.', 'link-not-active');
    let assignmentId = null;
    if (input?.assignmentId) {
      const a = await tx.assignment.findUnique({ where: { id: String(input.assignmentId) } });
      if (!a || a.linkId !== l.id) throw NOT_FOUND();
      assignmentId = a.id;
    }
    const seriesId = repeat > 0 ? `${l.id}:${Date.now()}` : null;
    const dates = Array.from({ length: repeat + 1 }, (_, i) => new Date(first.getTime() + i * 7 * 86_400_000));
    for (const d of dates) {
      const c = await conflicts(tx, user.id, d, durationMin);
      if (c) throw new SaasError(409, `Você já tem “${c.title}” em ${when(c.startsAt)}. Escolha outro horário.`, 'conflict');
    }
    const rows = [];
    for (const d of dates) rows.push(await tx.trainingSession.create({ data: { linkId: l.id, trainerId: l.trainerId, studentId: l.studentId, assignmentId, title, startsAt: d, durationMin, place, note, seriesId } }));
    await notify(tx, l.studentId, { kind: 'session', title: `${user.name || 'Seu personal'} marcou: ${title}`, body: rows.length > 1 ? `${when(first)} e mais ${rows.length - 1} semana(s). Confirme na sua agenda.` : `${when(first)}. Confirme na sua agenda.`, link: '/meu-personal', dedupeKey: `session:${rows[0].id}` });
    return rows.map(r => view(r, null));
  });
}

export async function listSessions(user, { from, to, linkId } = {}) {
  const f = from ? new Date(from) : new Date(Date.now() - 7 * 86_400_000);
  const t = to ? new Date(to) : new Date(Date.now() + 60 * 86_400_000);
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) throw new SaasError(400, 'Período inválido.', 'invalid-date');
  const rows = await withContext({ userId: user.id }, tx => tx.trainingSession.findMany({
    where: { OR: [{ trainerId: user.id }, { studentId: user.id }], startsAt: { gte: f, lte: t }, ...(linkId ? { linkId: String(linkId) } : {}) }, orderBy: { startsAt: 'asc' }, take: 400
  }));
  const names = await nameMap(rows);
  return rows.map(r => view(r, names));
}

/** Remarcar ou ajustar (só o personal). Mudar dia, horário ou duração volta a pedir a confirmação do aluno. */
export async function updateSession(user, id, patch) {
  return withContext({ userId: user.id }, async tx => {
    const s = await loadSession(tx, user, id);
    if (s.trainerId !== user.id) throw FORBIDDEN();
    if (!OPEN.includes(s.status)) throw new SaasError(409, 'Esse treino marcado já foi encerrado.', 'closed');
    const data = {};
    let moved = false;
    if (patch?.title !== undefined) { const t = clean(patch.title, 80); if (t.length < 2) throw new SaasError(400, 'Dê um nome ao treino marcado.', 'invalid-title'); data.title = t; }
    if (patch?.place !== undefined) data.place = clean(patch.place, 120);
    if (patch?.note !== undefined) data.note = clean(patch.note, 500);
    if (patch?.durationMin !== undefined) { data.durationMin = dur(patch.durationMin); moved = true; }
    if (patch?.startsAt !== undefined) { data.startsAt = parseWhen(patch.startsAt); moved = true; }
    if (patch?.assignmentId !== undefined) {
      if (patch.assignmentId === null) data.assignmentId = null;
      else { const a = await tx.assignment.findUnique({ where: { id: String(patch.assignmentId) } }); if (!a || a.linkId !== s.linkId) throw NOT_FOUND(); data.assignmentId = a.id; }
    }
    if (!Object.keys(data).length) return view(s, null);
    if (moved) {
      const c = await conflicts(tx, user.id, data.startsAt || s.startsAt, data.durationMin || s.durationMin, s.id);
      if (c) throw new SaasError(409, `Você já tem “${c.title}” em ${when(c.startsAt)}. Escolha outro horário.`, 'conflict');
      data.status = 'PLANNED';
    }
    const u = await tx.trainingSession.update({ where: { id: s.id }, data });
    if (moved) await notify(tx, s.studentId, { kind: 'session', title: `${user.name || 'Seu personal'} remarcou: ${u.title}`, body: `Novo horário: ${when(u.startsAt)}. Confirme na sua agenda.`, link: '/meu-personal', dedupeKey: `session-move:${u.id}:${u.updatedAt.getTime()}` });
    return view(u, null);
  });
}

/** O aluno confirma ou recusa. */
export async function respondSession(user, id, action) {
  if (!['confirm', 'decline'].includes(action)) throw new SaasError(400, 'Ação inválida.', 'invalid-action');
  return withContext({ userId: user.id }, async tx => {
    const s = await loadSession(tx, user, id);
    if (s.studentId !== user.id) throw FORBIDDEN();
    if (!OPEN.includes(s.status)) throw new SaasError(409, 'Esse treino marcado já foi encerrado.', 'closed');
    const u = await tx.trainingSession.update({ where: { id: s.id }, data: action === 'confirm' ? { status: 'CONFIRMED' } : { status: 'CANCELLED', cancelledBy: 'STUDENT', reason: 'Recusado pelo aluno' } });
    await notify(tx, s.trainerId, { kind: 'session', title: `${user.name || 'O aluno'} ${action === 'confirm' ? 'confirmou' : 'recusou'}: ${s.title}`, body: when(s.startsAt), link: '/personal/agenda', dedupeKey: `session-answer:${s.id}:${u.updatedAt.getTime()}` });
    return view(u, null);
  });
}

/** Cancelar (qualquer um dos dois). `series`: cancela este e os próximos da mesma série. */
export async function cancelSession(user, id, { reason, series = false } = {}) {
  return withContext({ userId: user.id }, async tx => {
    const s = await loadSession(tx, user, id);
    if (!OPEN.includes(s.status)) throw new SaasError(409, 'Esse treino marcado já foi encerrado.', 'closed');
    const by = s.trainerId === user.id ? 'TRAINER' : 'STUDENT';
    const why = clean(reason, 200);
    const where = series && s.seriesId ? { linkId: s.linkId, seriesId: s.seriesId, status: { in: OPEN }, startsAt: { gte: s.startsAt } } : { id: s.id };
    const r = await tx.trainingSession.updateMany({ where, data: { status: 'CANCELLED', cancelledBy: by, reason: why } });
    await notify(tx, by === 'TRAINER' ? s.studentId : s.trainerId, { kind: 'session', title: `${user.name || 'A outra pessoa'} cancelou: ${s.title}`, body: `${when(s.startsAt)}${r.count > 1 ? ` e mais ${r.count - 1}` : ''}${why ? ' · ' + why : ''}`, link: by === 'TRAINER' ? '/meu-personal' : '/personal/agenda', dedupeKey: `session-cancel:${s.id}:${Date.now()}` });
    return { cancelled: r.count };
  });
}

/** Depois do horário, o personal registra se o treino aconteceu. */
export async function markSession(user, id, outcome) {
  if (!['DONE', 'MISSED'].includes(outcome)) throw new SaasError(400, 'Ação inválida.', 'invalid-action');
  return withContext({ userId: user.id }, async tx => {
    const s = await loadSession(tx, user, id);
    if (s.trainerId !== user.id) throw FORBIDDEN();
    if (!OPEN.includes(s.status)) throw new SaasError(409, 'Esse treino marcado já foi encerrado.', 'closed');
    if (s.startsAt.getTime() > Date.now() + 3_600_000) throw new SaasError(409, 'Só dá para registrar perto do horário ou depois dele.', 'too-early');
    return view(await tx.trainingSession.update({ where: { id: s.id }, data: { status: outcome } }), null);
  });
}

/* ------------------------------ anotações privadas ------------------------------ */

export async function addNote(user, linkId, body) {
  const text = clean(body, 2000);
  if (!text) throw new SaasError(400, 'Escreva a anotação.', 'empty');
  return withContext({ userId: user.id }, async tx => {
    const l = await loadLink(tx, user, linkId);
    if (l.trainerId !== user.id) throw FORBIDDEN();
    const n = await tx.trainerNote.create({ data: { linkId: l.id, trainerId: user.id, body: text } });
    return { id: n.id, body: n.body, at: n.createdAt };
  });
}
export async function listNotes(user, linkId) {
  return withContext({ userId: user.id }, async tx => {
    const l = await loadLink(tx, user, linkId);
    if (l.trainerId !== user.id) throw FORBIDDEN();
    return (await tx.trainerNote.findMany({ where: { linkId: l.id }, orderBy: { createdAt: 'desc' }, take: 200 })).map(n => ({ id: n.id, body: n.body, at: n.createdAt }));
  });
}
export async function deleteNote(user, id) {
  return withContext({ userId: user.id }, async tx => {
    const r = await tx.trainerNote.deleteMany({ where: { id: String(id), trainerId: user.id } });
    if (!r.count) throw NOT_FOUND();
    return { deleted: true };
  });
}

/* ------------------------------ visão geral dos alunos ------------------------------ */

const daysBetween = (isoDay, now) => Math.floor((now.getTime() - new Date(isoDay + 'T12:00:00Z').getTime()) / 86_400_000);

/** Para cada aluno ativo: último treino e frequência (só com permissão), próximo treino marcado e pendências. */
export async function trainerOverview(user, readState, now = new Date()) {
  const base = await withContext({ userId: user.id }, async tx => {
    const links = await tx.trainerStudent.findMany({ where: { trainerId: user.id, status: 'ACTIVE' } });
    const sessions = await tx.trainingSession.findMany({ where: { trainerId: user.id, startsAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } }, orderBy: { startsAt: 'asc' } });
    const assigned = await tx.assignment.findMany({ where: { trainerId: user.id, status: 'ASSIGNED' }, select: { linkId: true } });
    const cats = {};
    for (const l of links) for (const c of ['ACTIVITY', 'WORKOUTS']) cats[l.id + c] = await levelFor(tx, l.studentId, user.id, c);
    return { links, sessions, assigned, cats };
  });
  const names = await nameMap(base.links);
  const out = [];
  for (const l of base.links) {
    const cat = base.cats[l.id + 'ACTIVITY'] !== 'OFF' ? 'ACTIVITY' : base.cats[l.id + 'WORKOUTS'] !== 'OFF' ? 'WORKOUTS' : null;
    let activity = null;
    if (cat) {
      await withContext({ userId: user.id }, tx => tx.accessLog.createMany({ data: [{ studentId: l.studentId, actorId: user.id, category: cat }] }));
      const S = await readState(l.studentId);
      if (cat === 'ACTIVITY') activity = project('ACTIVITY', S);
      else { const days = project('WORKOUTS', S).map(w => w.day).filter(Boolean).sort(); activity = { lastWorkoutDay: days.at(-1) || null, totalWorkouts: days.length, perWeek: [] }; }
    }
    const mine = base.sessions.filter(s => s.linkId === l.id);
    const next = mine.find(s => OPEN.includes(s.status) && s.startsAt >= now) || null;
    const since = activity?.lastWorkoutDay ? daysBetween(activity.lastWorkoutDay, now) : null;
    const missed = mine.filter(s => s.status === 'MISSED' && s.startsAt >= new Date(now.getTime() - 30 * 86_400_000)).length;
    const toMark = mine.filter(s => OPEN.includes(s.status) && s.startsAt.getTime() < now.getTime() - 3_600_000).length;
    const waiting = mine.filter(s => s.status === 'PLANNED' && s.startsAt >= now).length;
    const flags = [];
    if (cat && (since === null || since >= 7)) flags.push(since === null ? 'no-workouts' : 'inactive');
    if (missed >= 2) flags.push('missed');
    if (toMark > 0) flags.push('to-mark');
    out.push({
      linkId: l.id, studentId: l.studentId, name: names.get(l.studentId) || null, shares: cat, lastWorkoutDay: activity?.lastWorkoutDay ?? null, daysSinceLastWorkout: since,
      workoutsLast4Weeks: activity?.perWeek?.length ? activity.perWeek.slice(-4).reduce((n, w) => n + w.workouts, 0) : null,
      nextSession: next && { id: next.id, title: next.title, startsAt: next.startsAt, status: next.status }, awaitingConfirmation: waiting, sessionsToMark: toMark, missedLast30Days: missed,
      pendingAssignments: base.assigned.filter(a => a.linkId === l.id).length, flags
    });
  }
  return out.sort((a, b) => b.flags.length - a.flags.length || (a.name || '').localeCompare(b.name || ''));
}
