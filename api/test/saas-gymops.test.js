import { beforeEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { db, dbTest, makeUser, resetDb, TEST_DB_URL, dbUp } from './saas-helpers.mjs';
import * as org from '../saas/org/service.js';
import * as tr from '../saas/org/trainers.js';
import * as sc from '../saas/org/schedule.js';
import * as ops from '../saas/org/gym-ops.js';
process.env.GYM_PLANS = JSON.stringify({ GYM_FREE: { limits: { maxStudents: 50, maxProfessionals: 50, aiMonthlyMessages: 100000 } } });

const asUser = u => ({ id: u.id, name: u.name, email: u.email });
const status = (p, st) => assert.rejects(p, e => e.status === st, `esperava ${st}`);
const bundle = () => ({ opengym_plan: 1, name: 'Treino A', unit: 'kg', routines: [{ name: 'Treino A', ex: [{ id: '1000', sets: 3, reps: 10 }] }] });
const inDays = d => { const x = new Date(Date.now() + d * 86_400_000); x.setUTCHours(12, 0, 0, 0); return x.toISOString(); };

// Os testes de isolamento só valem sob um papel que obedece ao RLS (o dono do banco o ignora).
const schema = new URL(TEST_DB_URL.replace(/^postgresql/, 'http')).searchParams.get('schema');
const PROBE = `rls_${schema}`.slice(0, 60);
before(async () => {
  if (!dbUp) return;
  try {
    await db.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${PROBE}') THEN CREATE ROLE ${PROBE} NOLOGIN; END IF; END $$`);
    await db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${schema}" TO ${PROBE}`);
    await db.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schema}" TO ${PROBE}`);
    process.env.RLS_ROLE = PROBE;
  } catch { /* sem permissão para criar papéis: só a camada da API */ }
});

describe('gestão da academia: alunos, equipe, agenda e treinos', () => {
  beforeEach(async () => { if (db) await resetDb(); });

  async function gym() {
    const [owner, manager, t1, t2, s1, s2, outsider] = await Promise.all(Array.from({ length: 7 }, () => makeUser()));
    const g = await org.createGym(asUser(owner), { name: 'Academia Forte' });
    for (const [u, role] of [[manager, 'GYM_MANAGER'], [t1, 'PERSONAL_TRAINER'], [t2, 'PERSONAL_TRAINER'], [s1, 'STUDENT'], [s2, 'STUDENT']]) {
      await org.inviteMember(asUser(owner), g.id, { userId: u.id, role }); await org.acceptInvite(asUser(u), g.id);
    }
    await tr.saveProfile(asUser(t1), { displayName: 'Prof. Ana' });
    await tr.saveProfile(asUser(t2), { displayName: 'Prof. Caio' });
    return { owner, manager, t1, t2, s1, s2, outsider, g };
  }

  dbTest('painel: alunos sem personal primeiro, equipe com a carga de cada um e os números gerais', async () => {
    const c = await gym();
    let r = await ops.roster(asUser(c.owner), c.g.id);
    assert.equal(r.summary.students, 2); assert.equal(r.summary.withoutTrainer, 2); assert.equal(r.summary.trainers, 2);
    assert.ok(r.students.every(s => s.trainer === null));
    await ops.assignTrainer(asUser(c.manager), c.g.id, { studentId: c.s1.id, trainerId: c.t1.id });
    r = await ops.roster(asUser(c.manager), c.g.id);
    assert.equal(r.summary.waitingStudent, 1); assert.equal(r.summary.withoutTrainer, 1);
    assert.equal(r.students.find(s => s.userId === c.s1.id).trainer.status, 'PENDING');
    assert.equal(r.students[0].userId, c.s2.id); // quem está sem personal vem primeiro
    assert.equal(r.team.find(t => t.userId === c.t1.id).pending, 1);
  });

  dbTest('vincular é uma proposta: o aluno aceita; trocar de personal encerra o vínculo e a agenda do anterior', async () => {
    const c = await gym();
    await ops.assignTrainer(asUser(c.owner), c.g.id, { studentId: c.s1.id, trainerId: c.t1.id });
    const [pending] = (await tr.listLinks(asUser(c.s1))).filter(l => l.status === 'PENDING');
    assert.equal(pending.tenantId, c.g.id); assert.equal(pending.initiatedBy, 'TRAINER');
    await status(tr.respondLink(asUser(c.t1), pending.id, true), 409); // quem propôs não aceita
    await tr.respondLink(asUser(c.s1), pending.id, true);
    await sc.createSessions(asUser(c.t1), pending.id, { title: 'Treino', startsAt: inDays(2) });
    assert.equal((await ops.roster(asUser(c.owner), c.g.id)).students.find(s => s.userId === c.s1.id).trainer.status, 'ACTIVE');
    assert.equal((await db.notification.count({ where: { userId: c.s1.id, kind: 'link' } })) >= 1, true);
    const swap = await ops.assignTrainer(asUser(c.owner), c.g.id, { studentId: c.s1.id, trainerId: c.t2.id });
    assert.equal(swap.ended, 1);
    assert.equal((await db.trainerStudent.findUnique({ where: { id: pending.id } })).status, 'ENDED');
    assert.equal((await db.trainingSession.findFirst({ where: { linkId: pending.id } })).status, 'CANCELLED');
    const off = await ops.assignTrainer(asUser(c.owner), c.g.id, { studentId: c.s1.id, trainerId: null });
    assert.equal(off.status, 'NONE');
    assert.equal((await ops.roster(asUser(c.owner), c.g.id)).summary.withoutTrainer, 2);
    assert.ok((await db.activityLog.count({ where: { tenantId: c.g.id, action: { startsWith: 'student.trainer' } } })) >= 3);
  });

  dbTest('validações e permissões: só gestão vincula; aluno e personal não veem o painel', async () => {
    const c = await gym();
    await status(ops.assignTrainer(asUser(c.t1), c.g.id, { studentId: c.s1.id, trainerId: c.t1.id }), 403);
    await status(ops.roster(asUser(c.s1), c.g.id), 403);
    await status(ops.roster(asUser(c.t1), c.g.id), 403);
    await status(ops.roster(asUser(c.outsider), c.g.id), 404);
    await status(ops.assignTrainer(asUser(c.owner), c.g.id, { studentId: c.outsider.id, trainerId: c.t1.id }), 404); // não é aluno da academia
    await status(ops.assignTrainer(asUser(c.owner), c.g.id, { studentId: c.s1.id, trainerId: c.s2.id }), 404);        // aluno não é personal
    await status(ops.assignTrainer(asUser(c.owner), c.g.id, { studentId: c.s1.id, trainerId: c.outsider.id }), 404);
    await status(ops.assignTrainer(asUser(c.owner), c.g.id, {}), 400);
    await ops.assignTrainer(asUser(c.owner), c.g.id, { studentId: c.s1.id, trainerId: c.t1.id });
    await status(ops.assignTrainer(asUser(c.owner), c.g.id, { studentId: c.s1.id, trainerId: c.t1.id }), 409);
    const noProfile = await makeUser();
    await org.inviteMember(asUser(c.owner), c.g.id, { userId: noProfile.id, role: 'PERSONAL_TRAINER' }); await org.acceptInvite(asUser(noProfile), c.g.id);
    await status(ops.assignTrainer(asUser(c.owner), c.g.id, { studentId: c.s2.id, trainerId: noProfile.id }), 409);
  });

  dbTest('agenda e treinos da academia: só vínculos da academia; outra academia não vê', async () => {
    const c = await gym();
    await ops.assignTrainer(asUser(c.owner), c.g.id, { studentId: c.s1.id, trainerId: c.t1.id });
    const l = (await tr.listLinks(asUser(c.s1))).find(x => x.status === 'PENDING'); await tr.respondLink(asUser(c.s1), l.id, true);
    await sc.createSessions(asUser(c.t1), l.id, { title: 'Treino de pernas', startsAt: inDays(3) });
    await tr.assign(asUser(c.t1), l.id, { title: 'Treino A', note: '', bundle: bundle() });
    // vínculo independente (sem academia): a gestão não vê
    const lone = await tr.inviteStudent(asUser(c.t1), { email: c.s2.email }); await tr.respondLink(asUser(c.s2), lone.id, true);
    await sc.createSessions(asUser(c.t1), lone.id, { title: 'Particular', startsAt: inDays(4) });
    const sched = await ops.gymSchedule(asUser(c.manager), c.g.id, {});
    assert.deepEqual(sched.map(s => s.title), ['Treino de pernas']);
    assert.equal(sched[0].trainer, c.t1.name); assert.equal(sched[0].student, c.s1.name);
    assert.equal((await ops.gymSchedule(asUser(c.owner), c.g.id, { trainerId: c.t2.id })).length, 0);
    const w = await ops.gymWorkouts(asUser(c.owner), c.g.id);
    assert.equal(w.length, 1); assert.equal(w[0].title, 'Treino A'); assert.equal(w[0].bundle, undefined);
    const other = await org.createGym(asUser(c.outsider), { name: 'Outra Academia' });
    assert.deepEqual(await ops.gymSchedule(asUser(c.outsider), other.id, {}), []);
    assert.deepEqual(await ops.gymWorkouts(asUser(c.outsider), other.id), []);
    await status(ops.gymSchedule(asUser(c.outsider), c.g.id, {}), 404);
    await status(ops.gymSchedule(asUser(c.owner), c.g.id, { from: 'lixo' }), 400);
  });

  dbTest('a gestão não alcança o que é privado: anotações do personal e vínculos de outras academias', async () => {
    const c = await gym();
    await ops.assignTrainer(asUser(c.owner), c.g.id, { studentId: c.s1.id, trainerId: c.t1.id });
    const l = (await tr.listLinks(asUser(c.s1))).find(x => x.status === 'PENDING'); await tr.respondLink(asUser(c.s1), l.id, true);
    await sc.addNote(asUser(c.t1), l.id, 'privada');
    await status(sc.listNotes(asUser(c.owner), l.id), 404);
    const other = await org.createGym(asUser(c.outsider), { name: 'Outra' });
    const r = await ops.roster(asUser(c.outsider), other.id);
    assert.equal(r.summary.activeLinks, 0); assert.equal(r.team.length, 0);
  });
});
