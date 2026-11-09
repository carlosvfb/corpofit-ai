import { beforeEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { db, dbTest, makeUser, resetDb, TEST_DB_URL, dbUp } from './saas-helpers.mjs';
import * as org from '../saas/org/service.js';
import * as tr from '../saas/org/trainers.js';
import * as pv from '../saas/org/privacy.js';
import * as cm from '../saas/org/community.js';
import { exportMyData, eraseUserData } from '../saas/org/lgpd.js';

process.env.GYM_PLANS = JSON.stringify({ GYM_FREE: { limits: { maxStudents: 50, maxProfessionals: 50, aiMonthlyMessages: 100000 } } });

const asUser = u => ({ id: u.id, name: u.name, email: u.email });
const bundle = (n = 'Push') => ({ opengym_plan: 1, name: n, unit: 'kg', routines: [{ name: n, ex: [{ id: '1000', sets: 3, reps: 10 }] }] });

const schema = new URL(TEST_DB_URL.replace(/^postgresql/, 'http')).searchParams.get('schema');
const PROBE = `rls_${schema}`.slice(0, 60);
before(async () => {
  if (!dbUp) return;
  try {
    await db.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${PROBE}') THEN CREATE ROLE ${PROBE} NOLOGIN; END IF; END $$`);
    await db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${schema}" TO ${PROBE}`);
    await db.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schema}" TO ${PROBE}`);
    process.env.RLS_ROLE = PROBE; // o apagamento tem de funcionar com o RLS valendo
  } catch { /* só a camada da API */ }
});

describe('LGPD: exportar e apagar os dados de academias, personal e biblioteca', () => {
  beforeEach(async () => { if (db) await resetDb(); });

  async function world() {
    const [owner, trainer, student, other, otherTrainer] = await Promise.all([makeUser(), makeUser(), makeUser(), makeUser(), makeUser()]);
    const gym = await org.createGym(asUser(owner), { name: 'Academia Alfa' });
    for (const [u, role] of [[trainer, 'PERSONAL_TRAINER'], [student, 'STUDENT']]) { await org.inviteMember(asUser(owner), gym.id, { userId: u.id, role }); await org.acceptInvite(asUser(u), gym.id); }
    await tr.saveProfile(asUser(trainer), { displayName: 'Prof. Ana', bio: 'Bio' });
    await tr.saveProfile(asUser(otherTrainer), { displayName: 'Prof. Outro' });
    const link = await tr.inviteStudent(asUser(trainer), { email: student.email });
    await tr.respondLink(asUser(student), link.id, true);
    const otherLink = await tr.inviteStudent(asUser(otherTrainer), { email: other.email });
    await tr.respondLink(asUser(other), otherLink.id, true);
    await pv.setPermission(asUser(student), trainer.id, 'WORKOUTS', 'SEE');
    await pv.setPermission(asUser(other), otherTrainer.id, 'WORKOUTS', 'SEE');
    const a = await tr.assign(asUser(trainer), link.id, { title: 'Treino A', bundle: bundle() });
    await tr.addComment(asUser(student), a.id, 'Dúvida');
    await pv.studentData(asUser(trainer), link.id, 'WORKOUTS', async () => ({ workouts: [] }));
    const item = await cm.publish(asUser(student), { kind: 'TIP', title: 'Minha dica', body: 'Aqueça antes de começar o treino.', visibility: 'PUBLIC', rightsConfirmed: true });
    const keep = await cm.publish(asUser(other), { kind: 'TIP', title: 'Dica de outra pessoa', body: 'Durma bem para recuperar melhor.', visibility: 'PUBLIC', rightsConfirmed: true });
    await cm.favorite(asUser(student), keep.id, true);
    await cm.favorite(asUser(other), item.id, true);
    await cm.report(asUser(student), keep.id, 'SPAM', 'nota minha');
    return { owner, trainer, student, other, otherTrainer, gym, link, otherLink, item, keep };
  }

  dbTest('exportar traz tudo do usuário e nada de terceiros', async () => {
    const w = await world();
    const e = await exportMyData(asUser(w.student));
    assert.equal(e.memberships.length, 1);
    assert.equal(e.memberships[0].gym, 'Academia Alfa');
    assert.equal(e.trainerLinks.length, 1);
    assert.equal(e.workoutsExchanged[0].direction, 'RECEIVED');
    assert.equal(e.commentsWritten[0].body, 'Dúvida');
    assert.deepEqual(e.sharingGivenToTrainers.map(p => p.category), ['WORKOUTS']);
    assert.equal(e.consentHistory.length, 1);
    assert.equal(e.whoReadMyData.length, 1);
    assert.equal(e.communityPublished[0].title, 'Minha dica');
    assert.equal(e.communityFavorites.length, 1);
    assert.equal(e.communityReportsMade[0].note, 'nota minha');
    const json = JSON.stringify(e);
    for (const foreign of ['Prof. Outro', 'Dica de outra pessoa', w.other.email, w.otherTrainer.id]) assert.ok(!json.includes(foreign), 'vazou ' + foreign);
    const t = await exportMyData(asUser(w.trainer));
    assert.equal(t.trainerProfile.displayName, 'Prof. Ana');
    assert.equal(t.workoutsExchanged[0].direction, 'SENT');
    assert.equal(t.sharingReceivedFromStudents.length, 1);
  });

  dbTest('apagar remove os dados do aluno e preserva os de todos os outros', async () => {
    const w = await world();
    const r = await eraseUserData(w.student.id);
    assert.equal(r.memberships, 1);
    assert.ok(r.links >= 1 && r.permissions >= 1 && r.consent >= 1 && r.access >= 1 && r.communityItems === 1 && r.favorites === 1 && r.reports === 1);
    const e = await exportMyData(asUser(w.student));
    assert.equal(e.trainerLinks.length, 0);
    assert.equal(e.workoutsExchanged.length, 0);
    assert.equal(e.commentsWritten.length, 0);
    assert.equal(e.sharingGivenToTrainers.length, 0);
    assert.equal(e.consentHistory.length, 0);
    assert.equal(e.whoReadMyData.length, 0);
    assert.equal(e.communityPublished.length, 0);
    assert.equal(e.communityFavorites.length, 0);
    assert.equal(e.communityReportsMade.length, 0);
    assert.equal(e.memberships[0].status, 'REMOVED');
    // o personal ficou sem o vínculo e sem a concessão; os outros alunos e conteúdos não foram tocados
    assert.deepEqual(await tr.listLinks(asUser(w.trainer)), []);
    assert.equal((await pv.sharedWithMe(asUser(w.trainer))).length, 0);
    assert.equal((await tr.listLinks(asUser(w.other))).length, 1);
    assert.equal((await pv.myPermissions(asUser(w.other)))[0].grants.WORKOUTS, 'SEE');
    assert.deepEqual((await cm.list(asUser(w.other))).map(i => i.title), ['Dica de outra pessoa']);
    assert.equal(await db.communityReport.count(), 0);                       // a denúncia do apagado foi junto
    assert.equal((await cm.get(asUser(w.other), w.keep.id)).title, 'Dica de outra pessoa');
    // idempotente
    const again = await eraseUserData(w.student.id);
    assert.equal(again.memberships, 0);
    assert.equal(again.links, 0);
  });

  dbTest('apagar o personal remove perfil, vínculos e os treinos que ele enviou', async () => {
    const w = await world();
    await eraseUserData(w.trainer.id);
    assert.equal(await tr.getProfile(asUser(w.student), w.trainer.id), null);
    assert.deepEqual(await tr.listLinks(asUser(w.student)), []);
    assert.deepEqual(await tr.listAssignments(asUser(w.student)), []);
    assert.equal((await pv.accessLog(asUser(w.student))).length, 0);   // as leituras que ele fez saem do registro
    assert.equal((await tr.getProfile(asUser(w.other), w.otherTrainer.id)).displayName, 'Prof. Outro');
  });

  dbTest('o único dono que apaga a conta deixa a academia marcada para revisão, com os dados dela intactos', async () => {
    const w = await world();
    const r = await eraseUserData(w.owner.id);
    assert.equal(r.orphanedGyms, 1);
    assert.equal((await db.tenant.findUnique({ where: { id: w.gym.id } })).status, 'NO_OWNER');
    assert.equal(await db.membership.count({ where: { tenantId: w.gym.id, status: 'ACTIVE' } }), 2);   // trainer e aluno continuam
    assert.ok(await db.activityLog.findFirst({ where: { tenantId: w.gym.id, action: 'member.account-deleted' } })); // o registro da saída existe
  });
});
