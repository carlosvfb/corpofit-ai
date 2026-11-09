import { beforeEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { db, dbTest, makeUser, resetDb, TEST_DB_URL, dbUp } from './saas-helpers.mjs';
import * as tr from '../saas/org/trainers.js';
import * as pv from '../saas/org/privacy.js';
import { project, AVAILABLE } from '../saas/org/projection.js';

const asUser = u => ({ id: u.id, name: u.name, email: u.email });
const status = (p, st) => assert.rejects(p, e => e.status === st, `esperava ${st}`);
const bundle = (name = 'Treino A') => ({ opengym_plan: 1, name, unit: 'kg', routines: [{ name, ex: [{ id: '1000', sets: 3, reps: 10 }] }] });

// Estado do aluno, no formato do app (inclui dados que NUNCA podem sair em nenhuma categoria).
const STATE = {
  email: 'segredo@aluno.com', coach: { consent: { agreedAt: 1 }, token: 'tok-secreto' }, passwordHash: 'hash',
  routines: [{ id: 'r1', name: 'Push Day', _ts: 99, ex: [{ id: '0025', sets: 3, reps: 8 }] }],
  workouts: [
    { id: 'w1', d: '2026-11-02', name: 'Push Day', start: 1000, end: 4600000, note: 'Ombro incomodou', entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true }, { w: 60, r: 7, done: true }, { w: 40, r: 10, done: false }] }] },
    { id: 'w2', d: '2026-11-04', name: 'Pull Day', start: 2000, end: 3000, entries: [{ id: '0027', sets: [{ w: 50, r: 10, done: true }] }] }
  ],
  bodyweight: [{ d: '2026-11-01', w: 82.5, _ts: 5 }], measurements: [{ d: '2026-11-01', waist: 90 }], dayNotes: { '2026-11-03': { tag: 'rest', text: 'Descanso', _ts: 1 } }
};

const schema = new URL(TEST_DB_URL.replace(/^postgresql/, 'http')).searchParams.get('schema');
const PROBE = `rls_${schema}`.slice(0, 60);
let rlsReady = false;
before(async () => {
  if (!dbUp) return;
  try {
    await db.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${PROBE}') THEN CREATE ROLE ${PROBE} NOLOGIN; END IF; END $$`);
    await db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${schema}" TO ${PROBE}`);
    await db.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schema}" TO ${PROBE}`);
    process.env.RLS_ROLE = PROBE;
    rlsReady = true;
  } catch { /* sem permissão para criar papéis */ }
});

describe('projeções (sem banco)', () => {
  dbTest('cada categoria devolve só o que é dela, sem credenciais nem campos internos', () => {
    for (const c of AVAILABLE) {
      const json = JSON.stringify(project(c, STATE));
      for (const secret of ['segredo@aluno.com', 'tok-secreto', 'hash', '_ts']) assert.ok(!json.includes(secret), `${c} vazou ${secret}`);
    }
    assert.equal(project('WORKOUTS', STATE)[0].sets, 2);
    assert.deepEqual(project('EXERCISE_HISTORY', STATE)[0].entries[0].sets, [{ weight: 60, reps: 8 }, { weight: 60, reps: 7 }]);
    assert.equal(project('BODY_WEIGHT', STATE)[0].w, 82.5);
    assert.equal(project('NOTES', STATE).workouts[0].note, 'Ombro incomodou');
    assert.equal(project('ACTIVITY', STATE).lastWorkoutDay, '2026-11-04');
    assert.ok(!JSON.stringify(project('WORKOUTS', STATE)).includes('Ombro'));   // as notas só na categoria NOTES
    assert.ok(!JSON.stringify(project('ACTIVITY', STATE)).includes('Push Day')); // atividade não traz detalhes
    assert.throws(() => project('PHOTOS', STATE));
    assert.throws(() => project('WELLBEING', STATE));
  });
});

describe('privacidade e compartilhamento', () => {
  beforeEach(async () => { if (db) await resetDb(); });
  const readState = async () => STATE;

  async function pair() {
    const [t, s, outsider] = await Promise.all([makeUser(), makeUser(), makeUser()]);
    await tr.saveProfile(asUser(t), { displayName: 'Prof. Ana' });
    const link = await tr.inviteStudent(asUser(t), { email: s.email });
    await tr.respondLink(asUser(s), link.id, true);
    return { t, s, outsider, link };
  }

  dbTest('por padrão nada é compartilhado: o personal recebe 403 em toda categoria', async () => {
    const { t, link } = await pair();
    for (const c of AVAILABLE) await status(pv.studentData(asUser(t), link.id, c, readState), 403);
    assert.deepEqual(await pv.sharedWithMe(asUser(t)), [{ linkId: link.id, studentId: link.studentId, grants: {} }]);
  });

  dbTest('conceder SEE libera só aquela categoria e registra o acesso para o aluno', async () => {
    const { t, s, link } = await pair();
    await pv.setPermission(asUser(s), t.id, 'BODY_WEIGHT', 'SEE');
    const r = await pv.studentData(asUser(t), link.id, 'BODY_WEIGHT', readState);
    assert.equal(r.data[0].w, 82.5);
    await status(pv.studentData(asUser(t), link.id, 'MEASUREMENTS', readState), 403);
    await status(pv.studentData(asUser(t), link.id, 'WORKOUTS', readState), 403);
    const log = await pv.accessLog(asUser(s));
    assert.deepEqual(log.map(l => [l.actorId, l.category]), [[t.id, 'BODY_WEIGHT']]);
    assert.deepEqual((await pv.sharedWithMe(asUser(t)))[0].grants, { BODY_WEIGHT: 'SEE' });
  });

  dbTest('revogar vale na hora (próxima leitura = 403) e o histórico guarda concessão e revogação', async () => {
    const { t, s, link } = await pair();
    await pv.setPermission(asUser(s), t.id, 'WORKOUTS', 'SEE');
    await pv.studentData(asUser(t), link.id, 'WORKOUTS', readState);
    await pv.setPermission(asUser(s), t.id, 'WORKOUTS', 'OFF');
    await status(pv.studentData(asUser(t), link.id, 'WORKOUTS', readState), 403);
    const h = await pv.consentHistory(asUser(s), t.id);
    assert.deepEqual(h.map(x => [x.action, x.from, x.to]).reverse(), [['GRANT', 'OFF', 'SEE'], ['REVOKE', 'SEE', 'OFF']]);
    assert.equal((await pv.setPermission(asUser(s), t.id, 'WORKOUTS', 'OFF')).changed, false);
    assert.equal((await pv.consentHistory(asUser(s), t.id)).length, 2);
  });

  dbTest('revogar tudo e encerrar o vínculo cortam o acesso; a concessão não sobrevive a um novo vínculo', async () => {
    const { t, s, link } = await pair();
    for (const c of ['WORKOUTS', 'NOTES', 'ROUTINES']) await pv.setPermission(asUser(s), t.id, c, 'SEE');
    assert.equal((await pv.revokeAll(asUser(s), t.id)).revoked, 3);
    for (const c of ['WORKOUTS', 'NOTES']) await status(pv.studentData(asUser(t), link.id, c, readState), 403);
    await pv.setPermission(asUser(s), t.id, 'WORKOUTS', 'SEE');
    await tr.endLink(asUser(s), link.id);
    await status(pv.studentData(asUser(t), link.id, 'WORKOUTS', readState), 403);
    await status(pv.setPermission(asUser(s), t.id, 'WORKOUTS', 'SEE'), 404); // sem vínculo ativo não se concede
    // reconectar: a concessão antiga não reabre o acesso por conta própria? (ela ficou, mas o aluno vê e controla)
    const again = await tr.requestTrainer(asUser(s), { email: t.email });
    await tr.respondLink(asUser(t), again.id, true);
    assert.equal((await pv.myPermissions(asUser(s)))[0].grants.WORKOUTS, 'SEE');
  });

  dbTest('proteção contra acesso indireto: terceiros, outro personal e o próprio aluno em outra rota', async () => {
    const { t, s, outsider, link } = await pair();
    await pv.setPermission(asUser(s), t.id, 'WORKOUTS', 'SEE');
    await status(pv.studentData(asUser(outsider), link.id, 'WORKOUTS', readState), 404);
    const t2 = await makeUser();
    await tr.saveProfile(asUser(t2), { displayName: 'Prof. Dani' });
    await status(pv.studentData(asUser(t2), link.id, 'WORKOUTS', readState), 404);
    await status(pv.studentData(asUser(s), link.id, 'WORKOUTS', readState), 404); // o aluno não é o personal deste vínculo
    await status(pv.setPermission(asUser(outsider), t.id, 'WORKOUTS', 'SEE'), 404); // quem não é aluno não concede por outro
    await status(pv.setPermission(asUser(t), s.id, 'WORKOUTS', 'SEE'), 404); // o personal não se autoconcede
    assert.deepEqual(await pv.accessLog(asUser(outsider)), []);
    assert.deepEqual(await pv.myPermissions(asUser(outsider)), []);
  });

  dbTest('só categorias e níveis implementados podem ser concedidos', async () => {
    const { t, s } = await pair();
    await status(pv.setPermission(asUser(s), t.id, 'PHOTOS', 'SEE'), 400);
    await status(pv.setPermission(asUser(s), t.id, 'WELLBEING', 'SEE'), 400);
    await status(pv.setPermission(asUser(s), t.id, 'BODY_WEIGHT', 'CHANGE_DIRECTLY'), 400);
    await status(pv.setPermission(asUser(s), t.id, 'BODY_WEIGHT', 'SUGGEST'), 400);
    await status(pv.setPermission(asUser(s), t.id, 'ROUTINES', 'ALL'), 400);
    await pv.setPermission(asUser(s), t.id, 'ROUTINES', 'SUGGEST');
  });

  dbTest('sugerir mudanças numa rotina exige ROUTINES = SUGGEST, conferido no envio', async () => {
    const { t, s, link } = await pair();
    const input = { title: 'Ajuste no Push', kind: 'SUGGESTION', target: 'Push Day', bundle: bundle('Push Day v2') };
    await status(tr.assign(asUser(t), link.id, input), 403);
    await pv.setPermission(asUser(s), t.id, 'ROUTINES', 'SEE');
    await status(tr.assign(asUser(t), link.id, input), 403);
    await pv.setPermission(asUser(s), t.id, 'ROUTINES', 'SUGGEST');
    const a = await tr.assign(asUser(t), link.id, input);
    assert.equal(a.kind, 'SUGGESTION');
    assert.equal(a.target, 'Push Day');
    // o aluno decide: nada muda sem a aprovação dele
    assert.equal((await tr.listAssignments(asUser(s)))[0].status, 'ASSIGNED');
    await pv.setPermission(asUser(s), t.id, 'ROUTINES', 'OFF');
    await status(tr.assign(asUser(t), link.id, { ...input, title: 'Outra' }), 403);
    // um treino comum continua livre
    await tr.assign(asUser(t), link.id, { title: 'Treino novo', bundle: bundle() });
  });

  dbTest('RLS no banco: o personal não lê concessões de outros alunos nem o histórico; o histórico é imutável', async () => {
    if (!rlsReady) return;
    const { t, s, outsider, link } = await pair();
    await pv.setPermission(asUser(s), t.id, 'WORKOUTS', 'SEE');
    await pv.studentData(asUser(t), link.id, 'WORKOUTS', readState);
    const { withContext } = await import('../saas/org/context.js');
    assert.equal(await withContext({ userId: t.id }, tx => tx.sharingPermission.count()), 1);   // o que foi concedido a ele
    assert.equal(await withContext({ userId: s.id }, tx => tx.sharingPermission.count()), 1);
    assert.equal(await withContext({ userId: outsider.id }, tx => tx.sharingPermission.count()), 0);
    assert.equal(await withContext({ userId: t.id }, tx => tx.consentRecord.count()), 0);        // histórico é do aluno
    assert.equal(await withContext({ userId: outsider.id }, tx => tx.accessLog.count()), 0);
    await assert.rejects(withContext({ userId: t.id }, tx => tx.sharingPermission.update({ where: { studentId_trainerId_category: { studentId: s.id, trainerId: t.id, category: 'WORKOUTS' } }, data: { level: 'SUGGEST' } })));
    await assert.rejects(withContext({ userId: t.id }, tx => tx.sharingPermission.create({ data: { studentId: s.id, trainerId: t.id, category: 'NOTES', level: 'SEE' } })));
    assert.equal((await withContext({ userId: s.id }, tx => tx.consentRecord.deleteMany({}))).count, 0); // sem política de DELETE
    assert.equal(await withContext({ userId: s.id }, tx => tx.consentRecord.count()), 1);
  });
});
