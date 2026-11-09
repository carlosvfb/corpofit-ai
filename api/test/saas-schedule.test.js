import { beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { db, dbTest, makeUser, resetDb } from './saas-helpers.mjs';
import * as tr from '../saas/org/trainers.js';
import * as pv from '../saas/org/privacy.js';
import * as sc from '../saas/org/schedule.js';
import { exportMyData } from '../saas/org/lgpd.js';

const asUser = u => ({ id: u.id, name: u.name, email: u.email });
const status = (p, st) => assert.rejects(p, e => e.status === st, `esperava ${st}`);
const inDays = (d, h = 9) => { const x = new Date(Date.now() + d * 86_400_000); x.setUTCHours(h, 0, 0, 0); return x.toISOString(); };

describe('agenda do personal: dia e horário exatos, confirmação e anotações privadas', () => {
  beforeEach(async () => { if (db) await resetDb(); });

  async function pair() {
    const [t, s, other] = await Promise.all([makeUser(), makeUser(), makeUser()]);
    await tr.saveProfile(asUser(t), { displayName: 'Prof. Ana' });
    const link = await tr.inviteStudent(asUser(t), { email: s.email });
    await tr.respondLink(asUser(s), link.id, true);
    return { t, s, other, link };
  }

  dbTest('marca com horário exato, repete por semanas e avisa o aluno', async () => {
    const { t, s, link } = await pair();
    const rows = await sc.createSessions(asUser(t), link.id, { title: 'Treino de pernas', startsAt: inDays(2), durationMin: 45, place: 'Sala 2', repeatWeeks: 3 });
    assert.equal(rows.length, 4);
    assert.equal(new Set(rows.map(r => r.seriesId)).size, 1);
    assert.equal(rows[1].startsAt.getTime() - rows[0].startsAt.getTime(), 7 * 86_400_000);
    assert.equal(rows[0].status, 'PLANNED');
    const mine = await sc.listSessions(asUser(s), {});
    assert.equal(mine.length, 4);
    assert.equal(mine[0].trainer, t.name);
    const n = await db.notification.findMany({ where: { userId: s.id, kind: 'session' } });
    assert.equal(n.length, 1);
  });

  dbTest('valida: título, passado, duração, vínculo ativo e só o personal marca', async () => {
    const { t, s, link } = await pair();
    await status(sc.createSessions(asUser(t), link.id, { title: 'x', startsAt: inDays(1) }), 400);
    await status(sc.createSessions(asUser(t), link.id, { title: 'Treino', startsAt: inDays(-3) }), 400);
    await status(sc.createSessions(asUser(t), link.id, { title: 'Treino', startsAt: inDays(1), durationMin: 5 }), 400);
    await status(sc.createSessions(asUser(t), link.id, { title: 'Treino', startsAt: 'não é data' }), 400);
    await status(sc.createSessions(asUser(s), link.id, { title: 'Treino', startsAt: inDays(1) }), 403);
    await status(sc.createSessions(asUser(t), 'inexistente', { title: 'Treino', startsAt: inDays(1) }), 404);
  });

  dbTest('colisão: o personal não marca dois alunos no mesmo horário, mas horários vizinhos passam', async () => {
    const { t, link } = await pair();
    const s2 = await makeUser();
    const l2 = await tr.inviteStudent(asUser(t), { email: s2.email }); await tr.respondLink(asUser(s2), l2.id, true);
    await sc.createSessions(asUser(t), link.id, { title: 'Treino A', startsAt: inDays(2, 9), durationMin: 60 });
    await status(sc.createSessions(asUser(t), l2.id, { title: 'Treino B', startsAt: inDays(2, 9) }), 409);
    const overlap = new Date(new Date(inDays(2, 9)).getTime() + 30 * 60_000).toISOString();
    await status(sc.createSessions(asUser(t), l2.id, { title: 'Treino B', startsAt: overlap }), 409);
    await sc.createSessions(asUser(t), l2.id, { title: 'Treino B', startsAt: inDays(2, 10) }); // começa quando o outro termina
  });

  dbTest('aluno confirma ou recusa; remarcar volta a pedir confirmação; cancelar avisa a outra parte', async () => {
    const { t, s, link } = await pair();
    const [a] = await sc.createSessions(asUser(t), link.id, { title: 'Treino', startsAt: inDays(3) });
    assert.equal((await sc.respondSession(asUser(s), a.id, 'confirm')).status, 'CONFIRMED');
    await status(sc.respondSession(asUser(t), a.id, 'confirm'), 403);
    await status(sc.respondSession(asUser(s), a.id, 'talvez'), 400);
    const moved = await sc.updateSession(asUser(t), a.id, { startsAt: inDays(3, 11) });
    assert.equal(moved.status, 'PLANNED');
    await status(sc.updateSession(asUser(s), a.id, { title: 'Meu treino' }), 403);
    assert.equal((await sc.respondSession(asUser(s), a.id, 'decline')).status, 'CANCELLED');
    await status(sc.respondSession(asUser(s), a.id, 'confirm'), 409); // já encerrado
    const [b] = await sc.createSessions(asUser(t), link.id, { title: 'Outro', startsAt: inDays(4) });
    await sc.cancelSession(asUser(s), b.id, { reason: 'viagem' });
    const row = await db.trainingSession.findUnique({ where: { id: b.id } });
    assert.equal(row.cancelledBy, 'STUDENT');
    assert.equal(row.reason, 'viagem');
    assert.ok((await db.notification.count({ where: { userId: t.id, kind: 'session' } })) >= 2);
  });

  dbTest('cancelar a série leva este e os próximos; registrar presença só perto do horário', async () => {
    const { t, link } = await pair();
    const rows = await sc.createSessions(asUser(t), link.id, { title: 'Série', startsAt: inDays(2), repeatWeeks: 2 });
    assert.equal((await sc.cancelSession(asUser(t), rows[1].id, { series: true })).cancelled, 2);
    const left = await sc.listSessions(asUser(t), {});
    assert.deepEqual(left.map(r => r.status), ['PLANNED', 'CANCELLED', 'CANCELLED']);
    await status(sc.markSession(asUser(t), rows[0].id, 'DONE'), 409); // ainda longe
    await db.trainingSession.update({ where: { id: rows[0].id }, data: { startsAt: new Date(Date.now() - 2 * 3_600_000) } });
    assert.equal((await sc.markSession(asUser(t), rows[0].id, 'DONE')).status, 'DONE');
    await status(sc.markSession(asUser(t), rows[0].id, 'MISSED'), 409);
  });

  dbTest('isolamento: um terceiro não vê nem mexe na agenda; um aluno não vê a agenda de outro', async () => {
    const { t, s, other, link } = await pair();
    const [a] = await sc.createSessions(asUser(t), link.id, { title: 'Treino', startsAt: inDays(2) });
    assert.deepEqual(await sc.listSessions(asUser(other), {}), []);
    await status(sc.updateSession(asUser(other), a.id, { title: 'x' }), 404);
    await status(sc.cancelSession(asUser(other), a.id, {}), 404);
    await status(sc.respondSession(asUser(other), a.id, 'confirm'), 404);
    await status(sc.listSessions(asUser(s), { from: 'lixo' }), 400);
    assert.equal((await sc.listSessions(asUser(s), { linkId: link.id })).length, 1);
  });

  dbTest('anotações são só do personal: o aluno não lê nem escreve', async () => {
    const { t, s, link } = await pair();
    await status(sc.addNote(asUser(t), link.id, '   '), 400);
    const n = await sc.addNote(asUser(t), link.id, 'Evitar agachamento profundo: joelho direito.');
    assert.equal((await sc.listNotes(asUser(t), link.id)).length, 1);
    await status(sc.listNotes(asUser(s), link.id), 403);
    await status(sc.addNote(asUser(s), link.id, 'oi'), 403);
    await status(sc.deleteNote(asUser(s), n.id), 404);
    assert.deepEqual(await sc.deleteNote(asUser(t), n.id), { deleted: true });
  });

  dbTest('atalho de compartilhamento: "acompanhar treino" libera só o necessário e é registrado', async () => {
    const { t, s } = await pair();
    await status(pv.applyPreset(asUser(s), t.id, 'tudo'), 400);
    const r = await pv.applyPreset(asUser(s), t.id, 'training');
    assert.equal(r.changed, 4);
    const grants = (await pv.myPermissions(asUser(s)))[0].grants;
    assert.equal(grants.WORKOUTS, 'SEE'); assert.equal(grants.ROUTINES, 'SUGGEST');
    assert.equal(grants.BODY_WEIGHT, 'OFF'); assert.equal(grants.NOTES, 'OFF');
    assert.equal((await pv.applyPreset(asUser(s), t.id, 'training')).changed, 0);
    assert.equal((await pv.applyPreset(asUser(s), t.id, 'none')).changed, 4);
    assert.equal((await pv.consentHistory(asUser(s), t.id)).length, 8);
  });

  dbTest('visão geral: sem permissão não mostra frequência; com permissão mostra o último treino e marca quem sumiu', async () => {
    const { t, s, link } = await pair();
    const state = { workouts: [{ d: new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10), entries: [] }] };
    const read = async () => state;
    await sc.createSessions(asUser(t), link.id, { title: 'Treino', startsAt: inDays(1) });
    let o = (await sc.trainerOverview(asUser(t), read))[0];
    assert.equal(o.shares, null); assert.equal(o.lastWorkoutDay, null); assert.deepEqual(o.flags, []);
    assert.equal(o.nextSession.title, 'Treino'); assert.equal(o.awaitingConfirmation, 1);
    await pv.applyPreset(asUser(s), t.id, 'training');
    o = (await sc.trainerOverview(asUser(t), read))[0];
    assert.equal(o.shares, 'ACTIVITY'); assert.ok(o.daysSinceLastWorkout >= 9); assert.deepEqual(o.flags, ['inactive']);
    assert.equal((await db.accessLog.count({ where: { studentId: s.id, actorId: t.id } })), 1);
    await pv.revokeAll(asUser(s), t.id);
    o = (await sc.trainerOverview(asUser(t), read))[0];
    assert.equal(o.lastWorkoutDay, null); // revogou: some na hora
  });

  dbTest('LGPD: o export traz a agenda e as anotações de quem é dono; apagar a conta leva tudo junto', async () => {
    const { t, s, link } = await pair();
    await sc.createSessions(asUser(t), link.id, { title: 'Treino', startsAt: inDays(2) });
    await sc.addNote(asUser(t), link.id, 'privada');
    assert.equal((await exportMyData(asUser(t))).trainingSessions.length, 1);
    assert.equal((await exportMyData(asUser(t))).myPrivateNotesAboutStudents.length, 1);
    const sx = await exportMyData(asUser(s));
    assert.equal(sx.trainingSessions.length, 1);
    assert.deepEqual(sx.myPrivateNotesAboutStudents, []);
    await tr.endLink(asUser(s), link.id);
    assert.equal((await sc.listSessions(asUser(t), {}))[0].status, 'CANCELLED'); // encerrar o vínculo cancela a agenda futura
  });
});
