/* Gestão da academia: alunos, equipe, agenda e treinos. Quem gerencia (dono, administrador, gerente) enxerga os vínculos
   personal-aluno da academia (TrainerStudent.tenantId) e o que acontece neles: quem atende quem, os treinos marcados e os
   treinos enviados. NÃO enxerga os dados de treino do aluno (isso continua dependendo da permissão dele) nem as anotações
   privadas do personal. Vincular um aluno a um personal da academia é uma PROPOSTA: o aluno precisa aceitar, como em qualquer vínculo. */
import { db } from '../db.js';
import { SaasError } from '../errors.js';
import { withContext } from './context.js';
import { notify } from './notify.js';
import { requirePermission } from './service.js';

const DAY = 86_400_000;
const TRAINER_ROLES = ['PERSONAL_TRAINER', 'INSTRUCTOR', 'GYM_MANAGER', 'GYM_ADMIN', 'GYM_OWNER'];
const isOpen = s => s === 'PLANNED' || s === 'CONFIRMED';
const nameMap = async ids => new Map((await db.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true, email: true } })).map(u => [u.id, u]));

/** Tudo da operação: alunos com o seu personal, equipe com a carga de cada um e os números do mês. */
export async function roster(user, tenantId, now = new Date()) {
  const raw = await withContext({ userId: user.id, tenantId }, async tx => {
    await requirePermission(tx, tenantId, user.id, 'members:read');
    const members = await tx.membership.findMany({ where: { tenantId, status: 'ACTIVE' } });
    const links = await tx.trainerStudent.findMany({ where: { tenantId, status: { in: ['ACTIVE', 'PENDING'] } } });
    const since = new Date(now.getTime() - 30 * DAY);
    const sessions = links.length ? await tx.trainingSession.findMany({ where: { linkId: { in: links.map(l => l.id) }, startsAt: { gte: since } }, orderBy: { startsAt: 'asc' } }) : [];
    const sent = links.length ? await tx.assignment.groupBy({ by: ['linkId'], where: { linkId: { in: links.map(l => l.id) }, createdAt: { gte: since } }, _count: { _all: true } }) : [];
    return { members, links, sessions, sent };
  });
  const names = await nameMap([...raw.members.map(m => m.userId), ...raw.links.flatMap(l => [l.trainerId, l.studentId])]);
  const who = id => ({ name: names.get(id)?.name ?? null, email: names.get(id)?.email ?? null });
  const sentBy = new Map(raw.sent.map(s => [s.linkId, s._count._all]));
  const week = new Date(now.getTime() + 7 * DAY);

  const students = raw.members.filter(m => m.role === 'STUDENT').map(m => {
    const link = raw.links.find(l => l.studentId === m.userId);
    const mine = link ? raw.sessions.filter(s => s.linkId === link.id) : [];
    const next = mine.find(s => isOpen(s.status) && s.startsAt >= now);
    return {
      userId: m.userId, ...who(m.userId), since: m.createdAt,
      trainer: link ? { userId: link.trainerId, name: who(link.trainerId).name, linkId: link.id, status: link.status } : null,
      nextSession: next ? { title: next.title, startsAt: next.startsAt, status: next.status } : null,
      doneLast30: mine.filter(s => s.status === 'DONE').length, missedLast30: mine.filter(s => s.status === 'MISSED').length
    };
  }).sort((a, b) => (a.trainer ? 1 : 0) - (b.trainer ? 1 : 0) || (a.name || '').localeCompare(b.name || ''));

  const team = raw.members.filter(m => TRAINER_ROLES.includes(m.role) && raw.links.some(l => l.trainerId === m.userId) || m.role === 'PERSONAL_TRAINER').map(m => {
    const ls = raw.links.filter(l => l.trainerId === m.userId);
    const ids = new Set(ls.map(l => l.id));
    const ss = raw.sessions.filter(s => ids.has(s.linkId));
    return {
      userId: m.userId, ...who(m.userId), role: m.role, since: m.createdAt,
      students: ls.filter(l => l.status === 'ACTIVE').length, pending: ls.filter(l => l.status === 'PENDING').length,
      sessionsNext7Days: ss.filter(s => isOpen(s.status) && s.startsAt >= now && s.startsAt <= week).length,
      doneLast30: ss.filter(s => s.status === 'DONE').length, missedLast30: ss.filter(s => s.status === 'MISSED').length,
      workoutsSentLast30: ls.reduce((n, l) => n + (sentBy.get(l.id) || 0), 0)
    };
  }).sort((a, b) => b.students - a.students || (a.name || '').localeCompare(b.name || ''));

  const active = raw.links.filter(l => l.status === 'ACTIVE');
  return {
    summary: {
      students: students.length, withoutTrainer: students.filter(s => !s.trainer).length, withTrainer: students.filter(s => s.trainer?.status === 'ACTIVE').length,
      waitingStudent: raw.links.filter(l => l.status === 'PENDING').length, trainers: team.length, activeLinks: active.length,
      sessionsNext7Days: raw.sessions.filter(s => isOpen(s.status) && s.startsAt >= now && s.startsAt <= week).length,
      doneLast30: raw.sessions.filter(s => s.status === 'DONE').length, missedLast30: raw.sessions.filter(s => s.status === 'MISSED').length
    },
    students, team
  };
}

/** Propõe o personal de um aluno (trainerId = null encerra o vínculo atual da academia). O aluno aceita para valer. */
export async function assignTrainer(user, tenantId, { studentId, trainerId }) {
  if (!studentId) throw new SaasError(400, 'Escolha o aluno.', 'invalid-student');
  return withContext({ userId: user.id, tenantId }, async tx => {
    await requirePermission(tx, tenantId, user.id, 'members:invite');
    const sm = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId: String(studentId) } } });
    if (!sm || sm.status !== 'ACTIVE' || sm.role !== 'STUDENT') throw new SaasError(404, 'Aluno não encontrado nesta academia.', 'student-not-found');
    let trainerMember = null;
    if (trainerId) {
      trainerMember = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId: String(trainerId) } } });
      if (!trainerMember || trainerMember.status !== 'ACTIVE' || !TRAINER_ROLES.includes(trainerMember.role)) throw new SaasError(404, 'Personal não encontrado nesta academia.', 'trainer-not-found');
      if (!(await tx.trainerProfile.findUnique({ where: { userId: String(trainerId) } }))) throw new SaasError(409, 'Esse personal ainda não criou o perfil profissional.', 'no-profile');
    }
    const open = await tx.trainerStudent.findMany({ where: { tenantId, studentId: sm.userId, status: { in: ['ACTIVE', 'PENDING'] } } });
    if (trainerId && open.some(l => l.trainerId === String(trainerId))) throw new SaasError(409, 'Esse aluno já está com esse personal (ou aguardando aceitar).', 'already-linked');
    const t = new Date();
    for (const l of open) {
      await tx.trainerStudent.update({ where: { id: l.id }, data: { status: 'ENDED', endedAt: t } });
      await tx.assignment.updateMany({ where: { linkId: l.id, status: 'ASSIGNED' }, data: { status: 'ARCHIVED' } });
      await tx.trainingSession.updateMany({ where: { linkId: l.id, status: { in: ['PLANNED', 'CONFIRMED'] }, startsAt: { gte: t } }, data: { status: 'CANCELLED', cancelledBy: 'TRAINER', reason: 'A academia trocou o personal' } });
      await notify(tx, l.trainerId, { kind: 'link', title: 'A academia encerrou um vínculo seu com um aluno', body: 'A agenda futura entre vocês foi cancelada.', link: '/personal', dedupeKey: `gymend:${l.id}` });
    }
    let created = null;
    if (trainerId) {
      // Já houve vínculo entre os dois (encerrado)? Reaproveita a linha, que é única por par. Senão createMany (sem RETURNING:
      // o ator é da gestão, não parte do vínculo).
      const prior = await tx.trainerStudent.findUnique({ where: { trainerId_studentId: { trainerId: String(trainerId), studentId: sm.userId } } });
      if (prior) await tx.trainerStudent.update({ where: { id: prior.id }, data: { status: 'PENDING', initiatedBy: 'TRAINER', tenantId, endedAt: null } });
      else await tx.trainerStudent.createMany({ data: [{ trainerId: String(trainerId), studentId: sm.userId, tenantId, initiatedBy: 'TRAINER', status: 'PENDING' }] });
      created = await tx.trainerStudent.findFirst({ where: { tenantId, trainerId: String(trainerId), studentId: sm.userId, status: 'PENDING' } });
      await notify(tx, sm.userId, { kind: 'link', title: 'Sua academia indicou um personal para você', body: 'Aceite em Ajustes > Meu personal e escolha o que ele pode ver.', link: '/meu-personal', dedupeKey: `gymlink:${created?.id}` });
      await notify(tx, String(trainerId), { kind: 'link', title: 'Novo aluno indicado pela academia', body: 'Ele ainda precisa aceitar o vínculo.', link: '/personal', dedupeKey: `gymlink-t:${created?.id}` });
    }
    await tx.activityLog.createMany({ data: [{ tenantId, actorUserId: user.id, action: trainerId ? 'student.trainer-assigned' : 'student.trainer-removed', targetType: 'user', targetId: sm.userId, before: { trainers: open.map(l => l.trainerId) }, after: { trainerId: trainerId ? String(trainerId) : null } }] });
    return { studentId: sm.userId, trainerId: trainerId ? String(trainerId) : null, status: created ? 'PENDING' : 'NONE', ended: open.length };
  });
}

/** Agenda da academia no período (todos os personais ou um só). */
export async function gymSchedule(user, tenantId, { from, to, trainerId } = {}) {
  const f = from ? new Date(from) : new Date(Date.now() - 7 * DAY);
  const t = to ? new Date(to) : new Date(Date.now() + 60 * DAY);
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) throw new SaasError(400, 'Período inválido.', 'invalid-date');
  const rows = await withContext({ userId: user.id, tenantId }, async tx => {
    await requirePermission(tx, tenantId, user.id, 'members:read');
    const links = await tx.trainerStudent.findMany({ where: { tenantId }, select: { id: true } });
    if (!links.length) return [];
    return tx.trainingSession.findMany({ where: { linkId: { in: links.map(l => l.id) }, startsAt: { gte: f, lte: t }, ...(trainerId ? { trainerId: String(trainerId) } : {}) }, orderBy: { startsAt: 'asc' }, take: 1000 });
  });
  const names = await nameMap(rows.flatMap(r => [r.trainerId, r.studentId]));
  return rows.map(r => ({ id: r.id, title: r.title, startsAt: r.startsAt, endsAt: new Date(r.startsAt.getTime() + r.durationMin * 60_000), durationMin: r.durationMin, place: r.place, status: r.status, trainerId: r.trainerId, trainer: names.get(r.trainerId)?.name ?? null, student: names.get(r.studentId)?.name ?? null }));
}

/** Treinos enviados pelos personais da academia aos alunos (título, quem, para quem, situação). Sem o conteúdo dos exercícios. */
export async function gymWorkouts(user, tenantId, limit = 100) {
  const take = Math.max(1, Math.min(300, Number(limit) || 100));
  const rows = await withContext({ userId: user.id, tenantId }, async tx => {
    await requirePermission(tx, tenantId, user.id, 'members:read');
    const links = await tx.trainerStudent.findMany({ where: { tenantId }, select: { id: true } });
    if (!links.length) return [];
    return tx.assignment.findMany({ where: { linkId: { in: links.map(l => l.id) } }, orderBy: { createdAt: 'desc' }, take, select: { id: true, title: true, kind: true, status: true, revision: true, trainerId: true, studentId: true, createdAt: true, updatedAt: true } });
  });
  const names = await nameMap(rows.flatMap(r => [r.trainerId, r.studentId]));
  return rows.map(r => ({ ...r, trainer: names.get(r.trainerId)?.name ?? null, student: names.get(r.studentId)?.name ?? null }));
}
