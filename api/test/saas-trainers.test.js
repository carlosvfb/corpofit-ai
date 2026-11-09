import { beforeEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { db, dbTest, makeUser, resetDb, TEST_DB_URL, dbUp } from './saas-helpers.mjs';
import * as org from '../saas/org/service.js';
import * as tr from '../saas/org/trainers.js';
process.env.GYM_PLANS = JSON.stringify({ GYM_FREE: { limits: { maxStudents: 50, maxProfessionals: 50, aiMonthlyMessages: 100000 } } }); // estes testes não exercitam o limite do plano (ver saas-gymbilling)

const asUser = u => ({ id: u.id, name: u.name, email: u.email });
const status = (p, st) => assert.rejects(p, e => e.status === st, `esperava ${st}`);
const bundle = (name = 'Treino A', n = 2) => ({ opengym_plan: 1, name, unit: 'kg', routines: [{ name, ex: Array.from({ length: n }, (_, i) => ({ id: String(1000 + i), sets: 3, reps: 10 })) }] });

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
  } catch { /* sem permissão para criar papéis: só a camada da API */ }
});

describe('personal trainers: vínculos, treinos enviados e isolamento', () => {
  beforeEach(async () => { if (db) await resetDb(); });

  async function pair() {
    const [t, s, outsider] = await Promise.all([makeUser(), makeUser(), makeUser()]);
    await tr.saveProfile(asUser(t), { displayName: 'Prof. Ana', bio: 'Hipertrofia', specialties: ['Hipertrofia', 'Mobilidade'] });
    const link = await tr.inviteStudent(asUser(t), { email: s.email });
    await tr.respondLink(asUser(s), link.id, true);
    return { t, s, outsider, link };
  }

  dbTest('perfil: validado, visível a outros usuários logados, só o dono altera', async () => {
    const t = await makeUser(); const other = await makeUser();
    await status(tr.saveProfile(asUser(t), { displayName: 'x' }), 400);
    const p = await tr.saveProfile(asUser(t), { displayName: '  Prof. Bia  ', bio: 'b'.repeat(900), specialties: ['a', '', 'b'.repeat(90)] });
    assert.equal(p.displayName, 'Prof. Bia');
    assert.equal(p.bio.length, 600);
    assert.deepEqual(p.specialties.map(s => s.length), [1, 40]);
    assert.equal((await tr.getProfile(asUser(other), t.id)).displayName, 'Prof. Bia');
    assert.equal(await tr.getProfile(asUser(other), other.id), null);
  });

  dbTest('convite do personal: só o aluno responde; quem iniciou não aceita o próprio convite', async () => {
    const t = await makeUser(); const s = await makeUser(); const x = await makeUser();
    await status(tr.inviteStudent(asUser(t), { email: s.email }), 409); // sem perfil
    await tr.saveProfile(asUser(t), { displayName: 'Prof. Ana' });
    await status(tr.inviteStudent(asUser(t), { email: 'ninguem@nao-existe.com' }), 404);
    await status(tr.inviteStudent(asUser(t), { email: t.email }), 400);
    const link = await tr.inviteStudent(asUser(t), { email: s.email.toUpperCase() });
    assert.equal(link.status, 'PENDING');
    await status(tr.inviteStudent(asUser(t), { email: s.email }), 409);
    await status(tr.respondLink(asUser(t), link.id, true), 409); // quem convidou
    await status(tr.respondLink(asUser(x), link.id, true), 404); // terceiro
    assert.equal((await tr.respondLink(asUser(s), link.id, true)).status, 'ACTIVE');
  });

  dbTest('o aluno também pode pedir um personal; recusado, pode pedir de novo', async () => {
    const t = await makeUser(); const s = await makeUser();
    await status(tr.requestTrainer(asUser(s), { email: t.email }), 404); // t não tem perfil
    await tr.saveProfile(asUser(t), { displayName: 'Prof. Caio' });
    const link = await tr.requestTrainer(asUser(s), { email: t.email });
    assert.equal(link.initiatedBy, 'STUDENT');
    await status(tr.respondLink(asUser(s), link.id, true), 409);
    assert.equal((await tr.respondLink(asUser(t), link.id, false)).status, 'ENDED');
    const again = await tr.requestTrainer(asUser(s), { email: t.email });
    assert.equal(again.status, 'PENDING');
  });

  dbTest('só o personal envia treino, só em vínculo ativo, e a forma do treino é validada', async () => {
    const { t, s, link } = await pair();
    await status(tr.assign(asUser(s), link.id, { title: 'Meu', bundle: bundle() }), 403);
    await status(tr.assign(asUser(t), link.id, { title: 'x', bundle: bundle() }), 400);
    await status(tr.assign(asUser(t), link.id, { title: 'Treino', bundle: { routines: [] } }), 400);
    await status(tr.assign(asUser(t), link.id, { title: 'Treino', bundle: bundle('G', 41) }), 400);
    await status(tr.assign(asUser(t), link.id, { title: 'Treino', bundle: { ...bundle(), lixo: 'x'.repeat(41_000) } }), 413);
    const a = await tr.assign(asUser(t), link.id, { title: 'Treino A', note: 'Foque na técnica', bundle: bundle() });
    assert.equal(a.status, 'ASSIGNED');
    const mine = await tr.listAssignments(asUser(s));
    assert.equal(mine.length, 1);
    assert.equal(mine[0].bundle.routines[0].ex.length, 2);
    const pending = await tr.respondLink(asUser(s), (await tr.inviteStudent(asUser(t), { email: (await makeUser()).email })).id, true).catch(e => e);
    assert.equal(pending.status, 404); // o aluno novo não é o convidado
  });

  dbTest('isolamento: um terceiro não vê vínculos, treinos, histórico nem comentários', async () => {
    const { t, s, outsider, link } = await pair();
    const a = await tr.assign(asUser(t), link.id, { title: 'Treino A', bundle: bundle() });
    await tr.addComment(asUser(s), a.id, 'Posso trocar o supino?');
    assert.deepEqual(await tr.listLinks(asUser(outsider)), []);
    assert.deepEqual(await tr.listAssignments(asUser(outsider)), []);
    assert.deepEqual(await tr.listAssignments(asUser(outsider), link.id), []);
    await status(tr.listComments(asUser(outsider), a.id), 404);
    await status(tr.addComment(asUser(outsider), a.id, 'oi'), 404);
    await status(tr.assignmentHistory(asUser(outsider), a.id), 404);
    await status(tr.updateAssignment(asUser(outsider), a.id, { title: 'Invadido' }), 404);
    await status(tr.answerAssignment(asUser(outsider), a.id, 'IMPORTED'), 404);
    await status(tr.endLink(asUser(outsider), link.id), 404);
    // outro personal com outro aluno não alcança este vínculo
    const t2 = await makeUser(); const s2 = await makeUser();
    await tr.saveProfile(asUser(t2), { displayName: 'Prof. Dani' });
    const l2 = await tr.inviteStudent(asUser(t2), { email: s2.email });
    await tr.respondLink(asUser(s2), l2.id, true);
    await status(tr.assign(asUser(t2), link.id, { title: 'Invasão', bundle: bundle() }), 404);
    assert.equal((await tr.listAssignments(asUser(s2))).length, 0);
  });

  dbTest('histórico: cada edição do personal guarda a versão anterior; o aluno não edita', async () => {
    const { t, s, link } = await pair();
    const a = await tr.assign(asUser(t), link.id, { title: 'Treino A', bundle: bundle('A', 2) });
    await status(tr.updateAssignment(asUser(s), a.id, { title: 'Meu jeito' }), 403);
    await tr.answerAssignment(asUser(s), a.id, 'IMPORTED');
    const u = await tr.updateAssignment(asUser(t), a.id, { title: 'Treino A v2', bundle: bundle('A2', 3) });
    assert.equal(u.revision, 2);
    assert.equal(u.status, 'ASSIGNED'); // conteúdo novo volta a esperar o aluno
    const h = await tr.assignmentHistory(asUser(s), a.id);
    assert.equal(h.history.length, 1);
    assert.equal(h.history[0].title, 'Treino A');
    assert.equal(h.history[0].by, t.id);
    await status(tr.answerAssignment(asUser(t), a.id, 'IMPORTED'), 403);
  });

  dbTest('comentários dos dois lados, em ordem; vazio é recusado', async () => {
    const { t, s, link } = await pair();
    const a = await tr.assign(asUser(t), link.id, { title: 'Treino A', bundle: bundle() });
    await tr.addComment(asUser(s), a.id, 'Dúvida no passo 2');
    await tr.addComment(asUser(t), a.id, 'Mantenha as costas retas');
    await status(tr.addComment(asUser(s), a.id, '   '), 400);
    const list = await tr.listComments(asUser(s), a.id);
    assert.deepEqual(list.map(c => [c.mine, c.body]), [[true, 'Dúvida no passo 2'], [false, 'Mantenha as costas retas']]);
  });

  dbTest('encerrar: o personal perde o acesso na hora; o aluno guarda os treinos, arquivados', async () => {
    const { t, s, link } = await pair();
    const a = await tr.assign(asUser(t), link.id, { title: 'Treino A', bundle: bundle() });
    await tr.endLink(asUser(s), link.id);
    await status(tr.assign(asUser(t), link.id, { title: 'Treino B', bundle: bundle() }), 409);
    await status(tr.updateAssignment(asUser(t), a.id, { title: 'Tarde demais' }), 409);
    const mine = await tr.listAssignments(asUser(s));
    assert.equal(mine[0].status, 'ARCHIVED');
    assert.deepEqual(await tr.listLinks(asUser(s)), []);
  });

  dbTest('com academia: os dois precisam ser membros ativos, personal e aluno', async () => {
    const owner = await makeUser(); const t = await makeUser(); const s = await makeUser(); const nonMember = await makeUser();
    const gym = await org.createGym(asUser(owner), { name: 'Academia Delta' });
    for (const [u, role] of [[t, 'PERSONAL_TRAINER'], [s, 'STUDENT']]) { await org.inviteMember(asUser(owner), gym.id, { userId: u.id, role }); await org.acceptInvite(asUser(u), gym.id); }
    await tr.saveProfile(asUser(t), { displayName: 'Prof. Edu' });
    await tr.saveProfile(asUser(nonMember), { displayName: 'Prof. Fora' });
    await status(tr.inviteStudent(asUser(nonMember), { email: s.email, tenantId: gym.id }), 403);
    await status(tr.inviteStudent(asUser(t), { email: nonMember.email, tenantId: gym.id }), 409);
    const link = await tr.inviteStudent(asUser(t), { email: s.email, tenantId: gym.id });
    assert.equal(link.tenantId, gym.id);
    const act = await org.recentActivity(asUser(owner), gym.id);
    assert.ok(act.some(a => a.action === 'trainer-link.requested'));
  });

  dbTest('RLS no banco: sem ser parte do vínculo, nada aparece nem se grava', async () => {
    if (!rlsReady) return;
    const { t, s, outsider, link } = await pair();
    const a = await tr.assign(asUser(t), link.id, { title: 'Treino A', bundle: bundle() });
    const { withContext } = await import('../saas/org/context.js');
    for (const [who, expected] of [[t, 1], [s, 1], [outsider, 0]]) {
      assert.equal(await withContext({ userId: who.id }, tx => tx.assignment.count()), expected);
      assert.equal(await withContext({ userId: who.id }, tx => tx.trainerStudent.count()), expected);
    }
    assert.equal(await withContext({ userId: '' }, tx => tx.assignment.count()), 0);
    await assert.rejects(withContext({ userId: outsider.id }, tx => tx.assignmentComment.create({ data: { assignmentId: a.id, authorId: outsider.id, body: 'x' } })));
    await assert.rejects(withContext({ userId: s.id }, tx => tx.assignmentComment.create({ data: { assignmentId: a.id, authorId: t.id, body: 'em nome do personal' } })));
    assert.equal(await withContext({ userId: outsider.id }, tx => tx.trainerProfile.count()), 1); // o cartão profissional é público entre logados
    await assert.rejects(withContext({ userId: outsider.id }, tx => tx.trainerProfile.update({ where: { userId: t.id }, data: { displayName: 'Sequestrado' } })));
  });
});
