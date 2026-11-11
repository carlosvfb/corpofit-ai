import { beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { db, dbTest, makeUser, resetDb } from './saas-helpers.mjs';
import * as org from '../saas/org/service.js';
import * as tr from '../saas/org/trainers.js';
import * as sc from '../saas/org/schedule.js';
import * as ops from '../saas/org/gym-ops.js';
import { reviewState, runReviewNotices } from '../saas/org/review-notices.js';
process.env.GYM_PLANS = JSON.stringify({ GYM_FREE: { limits: { maxStudents: 50, maxProfessionals: 50, aiMonthlyMessages: 100000 } } });

const asUser = u => ({ id: u.id, name: u.name, email: u.email });
const status = (p, st) => assert.rejects(p, e => e.status === st, `esperava ${st}`);
const bundle = () => ({ opengym_plan: 1, name: 'Treino A', unit: 'kg', routines: [{ name: 'Treino A', ex: [{ id: '1000', sets: 3, reps: 10 }] }] });
const DAY = 86_400_000;

describe('prazo da ficha: define, avisa antes e quando vence, aparece para o personal e para a academia', () => {
  beforeEach(async () => { if (db) await resetDb(); });

  async function pair() {
    const [t, s] = await Promise.all([makeUser(), makeUser()]);
    await tr.saveProfile(asUser(t), { displayName: 'Prof. Ana' });
    const link = await tr.inviteStudent(asUser(t), { email: s.email });
    await tr.respondLink(asUser(s), link.id, true);
    return { t, s, link };
  }

  dbTest('o estado do prazo: sem prazo, em dia, perto e vencido', () => {
    const now = new Date('2026-11-11T12:00:00Z');
    assert.equal(reviewState(null, now), null);
    assert.equal(reviewState(new Date(now.getTime() + 10 * DAY), now), 'ok');
    assert.equal(reviewState(new Date(now.getTime() + 2 * DAY), now), 'soon');
    assert.equal(reviewState(new Date(now.getTime() - 1), now), 'expired');
  });

  dbTest('o personal define o prazo em semanas ao enviar; valor inválido é recusado; editar renova', async () => {
    const { t, link } = await pair();
    await status(tr.assign(asUser(t), link.id, { title: 'Treino A', bundle: bundle(), reviewWeeks: 0.5 }), 400);
    await status(tr.assign(asUser(t), link.id, { title: 'Treino A', bundle: bundle(), reviewWeeks: 52 }), 400);
    const none = await tr.assign(asUser(t), link.id, { title: 'Sem prazo', bundle: bundle() });
    assert.equal(none.reviewAt, null);
    const a = await tr.assign(asUser(t), link.id, { title: 'Treino A', bundle: bundle(), reviewWeeks: 6 });
    const weeks = (new Date(a.reviewAt).getTime() - Date.now()) / (7 * DAY);
    assert.ok(weeks > 5.99 && weeks < 6.01);
    const b = await tr.updateAssignment(asUser(t), a.id, { reviewWeeks: 8 });
    assert.ok((new Date(b.reviewAt).getTime() - Date.now()) / (7 * DAY) > 7.99);
    assert.equal((await tr.updateAssignment(asUser(t), a.id, { reviewWeeks: null })).reviewAt, null);
    const sug = await tr.assign(asUser(t), link.id, { title: 'Sugestão', bundle: bundle(), kind: 'SUGGESTION', reviewWeeks: 4 }).catch(e => e);
    assert.ok(sug.status === 403 || sug.reviewAt === null); // sugestão nunca tem prazo
  });

  dbTest('aviso três dias antes e quando vence, para os dois, uma vez por versão; vínculo encerrado não avisa', async () => {
    const { t, s, link } = await pair();
    const a = await tr.assign(asUser(t), link.id, { title: 'Treino A', bundle: bundle(), reviewWeeks: 2 });
    const now = Date.now();
    assert.equal((await runReviewNotices(new Date(now))).notified, 0); // faltam 14 dias
    const soon = new Date(now + 12 * DAY);
    assert.equal((await runReviewNotices(soon)).notified, 2);
    assert.equal((await runReviewNotices(soon)).notified, 0);        // não repete
    assert.equal(await db.notification.count({ where: { userId: t.id, kind: 'review' } }), 1);
    assert.equal(await db.notification.count({ where: { userId: s.id, kind: 'review' } }), 1);
    const late = new Date(now + 15 * DAY);
    assert.equal((await runReviewNotices(late)).notified, 2);        // venceu: novo aviso
    assert.match((await db.notification.findFirst({ where: { userId: t.id, title: { contains: 'venceu' } } })).title, /venceu em/);
    await tr.updateAssignment(asUser(t), a.id, { title: 'Treino A v2', bundle: bundle(), reviewWeeks: 4 }); // nova versão e novo prazo
    assert.equal((await runReviewNotices(new Date(now + 16 * DAY))).notified, 0);
    await tr.endLink(asUser(s), link.id);
    assert.equal((await runReviewNotices(new Date(now + 90 * DAY))).notified, 0);
  });

  dbTest('a lista de alunos do personal e o painel da academia mostram ficha vencendo e vencida', async () => {
    const [owner, t, s] = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const g = await org.createGym(asUser(owner), { name: 'Forte' });
    for (const [u, role] of [[t, 'PERSONAL_TRAINER'], [s, 'STUDENT']]) { await org.inviteMember(asUser(owner), g.id, { userId: u.id, role }); await org.acceptInvite(asUser(u), g.id); }
    await tr.saveProfile(asUser(t), { displayName: 'Prof. Caio' });
    await ops.assignTrainer(asUser(owner), g.id, { studentId: s.id, trainerId: t.id });
    const link = (await tr.listLinks(asUser(s))).find(l => l.status === 'PENDING'); await tr.respondLink(asUser(s), link.id, true);
    const a = await tr.assign(asUser(t), link.id, { title: 'Treino A', bundle: bundle(), reviewWeeks: 2 });
    const read = async () => ({});
    let o = (await sc.trainerOverview(asUser(t), read, new Date()))[0];
    assert.equal(o.planReview.state, 'ok'); assert.ok(!o.flags.includes('plan-expired'));
    o = (await sc.trainerOverview(asUser(t), read, new Date(Date.now() + 12 * DAY)))[0];
    assert.equal(o.planReview.state, 'soon'); assert.ok(o.flags.includes('plan-expiring'));
    await db.assignment.update({ where: { id: a.id }, data: { reviewAt: new Date(Date.now() - DAY) } });
    o = (await sc.trainerOverview(asUser(t), read))[0];
    assert.ok(o.flags.includes('plan-expired'));
    const r = await ops.roster(asUser(owner), g.id);
    assert.equal(r.summary.plansExpired, 1);
    assert.equal(r.students.find(x => x.userId === s.id).planReview.state, 'expired');
  });
});
