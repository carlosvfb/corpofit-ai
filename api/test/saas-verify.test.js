import { beforeEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { db, dbTest, makeUser, resetDb, TEST_DB_URL, dbUp, mock } from './saas-helpers.mjs';
import * as org from '../saas/org/service.js';
import * as tr from '../saas/org/trainers.js';
import * as pv from '../saas/org/privacy.js';
import * as nt from '../saas/org/notify.js';
import * as vf from '../saas/org/verify.js';
import { eraseUserData } from '../saas/org/lgpd.js';
import { listGyms } from '../saas/org/admin-orgs.js';

process.env.GYM_PLANS = JSON.stringify({ GYM_FREE: { limits: { maxStudents: 3, maxProfessionals: 3, aiMonthlyMessages: 100 } } });

const asUser = u => ({ id: u.id, name: u.name, email: u.email });
const status = (p, st, code) => assert.rejects(p, e => e.status === st && (!code || e.code === code), `esperava ${st}${code ? ' ' + code : ''}`);
const bundle = () => ({ opengym_plan: 1, name: 'A', unit: 'kg', routines: [{ name: 'A', ex: [{ id: '1000', sets: 3, reps: 10 }] }] });

const schema = new URL(TEST_DB_URL.replace(/^postgresql/, 'http')).searchParams.get('schema');
const PROBE = `rls_${schema}`.slice(0, 60);
let rlsReady = false;
before(async () => {
  if (!dbUp) return;
  try {
    await db.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${PROBE}') THEN CREATE ROLE ${PROBE} NOLOGIN; END IF; END $$`);
    await db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${schema}" TO ${PROBE}`);
    await db.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schema}" TO ${PROBE}`);
    process.env.RLS_ROLE = PROBE; rlsReady = true;
  } catch { /* só a camada da API */ }
});

// Um carteiro de mentira que guarda o último código enviado.
const mailer = () => { const m = mock(async () => ({ sent: true })); return m; };
const codeFrom = m => m.calls.at(-1)[2].match(/\b(\d{6})\b/)[1];

describe('e-mail confirmado, convites pendentes e avisos', () => {
  beforeEach(async () => { if (db) await resetDb(); delete process.env.REQUIRE_VERIFIED_EMAIL; });

  dbTest('o código confirma o e-mail; errado, vencido e excesso de tentativas são recusados', async () => {
    const u = await makeUser(); const m = mailer();
    assert.equal((await vf.status(asUser(u))).verified, false);
    await vf.sendCode(asUser(u), m);
    await status(vf.sendCode(asUser(u), m), 429, 'too-soon');
    for (let i = 0; i < 5; i++) await status(vf.verify(asUser(u), '000000'), 400, 'code-invalid');
    await status(vf.verify(asUser(u), codeFrom(m)), 429, 'locked'); // 5 erros travam este código
    await db.emailVerification.update({ where: { userId: u.id }, data: { sentAt: new Date(Date.now() - 120_000) } });
    await vf.sendCode(asUser(u), m);
    await status(vf.verify(asUser(u), 'abc'), 400, 'code-invalid');
    await db.emailVerification.update({ where: { userId: u.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await status(vf.verify(asUser(u), codeFrom(m)), 400, 'code-invalid'); // vencido
    await db.emailVerification.update({ where: { userId: u.id }, data: { sentAt: new Date(Date.now() - 120_000) } });
    await vf.sendCode(asUser(u), m);
    assert.deepEqual(await vf.verify(asUser(u), codeFrom(m)), { verified: true, invitesClaimed: 0 });
    assert.equal((await vf.status(asUser(u))).verified, true);
    assert.equal((await db.emailVerification.count()), 0);   // o código é de uso único
  });

  dbTest('trocar de e-mail invalida a confirmação; o código nunca fica em claro no banco', async () => {
    const u = await makeUser(); const m = mailer();
    await vf.sendCode(asUser(u), m);
    const code = codeFrom(m);
    assert.notEqual((await db.emailVerification.findUnique({ where: { userId: u.id } })).codeHash, code);
    await vf.verify(asUser(u), code);
    assert.equal(await vf.isVerified({ ...asUser(u), email: 'outro@x.com' }), false);
    await status(vf.sendCode({ id: u.id, name: u.name, email: '' }, m), 400, 'email-required');
  });

  dbTest('REQUIRE_VERIFIED_EMAIL=1 exige e-mail confirmado para criar academia', async () => {
    const u = await makeUser(); const m = mailer();
    process.env.REQUIRE_VERIFIED_EMAIL = '1';
    await status(org.createGym(asUser(u), { name: 'Academia X' }), 403, 'email-not-verified');
    await vf.sendCode(asUser(u), m); await vf.verify(asUser(u), codeFrom(m));
    await org.createGym(asUser(u), { name: 'Academia X' });
  });

  dbTest('convite a quem ainda não tem conta: pendente, conta na vaga, e só vira convite com o e-mail CONFIRMADO', async () => {
    const owner = await makeUser();
    const gym = await org.createGym(asUser(owner), { name: 'Academia Alfa' });
    const r = await org.inviteMember(asUser(owner), gym.id, { email: 'Nova.Pessoa@X.com', role: 'STUDENT' });
    assert.equal(r.status, 'PENDING_SIGNUP');
    assert.equal(r.email, 'nova.pessoa@x.com');
    const list = await org.listMembers(asUser(owner), gym.id);
    assert.equal(list.find(x => x.status === 'PENDING_SIGNUP').email, 'nova.pessoa@x.com');
    // a pessoa se cadastra com esse e-mail, mas SEM confirmar: nada é concedido
    const guest = await makeUser({ email: 'nova.pessoa@x.com' });
    assert.deepEqual((await org.myContexts(asUser(guest))).gyms, []);
    // um atacante com outro e-mail não alcança o convite
    const attacker = await makeUser(); const m = mailer();
    await vf.sendCode(asUser(attacker), m); await vf.verify(asUser(attacker), codeFrom(m));
    assert.deepEqual((await org.myContexts(asUser(attacker))).gyms, []);
    // confirmando o e-mail: o convite aparece e o aceite continua sendo dela
    const m2 = mailer();
    await vf.sendCode(asUser(guest), m2);
    assert.deepEqual(await vf.verify(asUser(guest), codeFrom(m2)), { verified: true, invitesClaimed: 1 });
    const ctx = await org.myContexts(asUser(guest));
    assert.equal(ctx.gyms[0].status, 'INVITED');
    assert.equal(ctx.gyms[0].role, 'STUDENT');
    assert.equal((await org.listMembers(asUser(owner), gym.id)).filter(x => x.status === 'PENDING_SIGNUP').length, 0);
    await org.acceptInvite(asUser(guest), gym.id);
    const feed = await nt.listNotifications(asUser(guest));
    assert.ok(feed.items.some(n => n.kind === 'gym-invite'));
  });

  dbTest('convites pendentes ocupam vaga do plano, vencem em 30 dias e o dono pode cancelar', async () => {
    const owner = await makeUser();
    const gym = await org.createGym(asUser(owner), { name: 'Academia Alfa' });
    for (const e of ['a@x.com', 'b@x.com', 'c@x.com']) await org.inviteMember(asUser(owner), gym.id, { email: e, role: 'STUDENT' });
    await status(org.inviteMember(asUser(owner), gym.id, { email: 'd@x.com', role: 'STUDENT' }), 402, 'plan-limit'); // 3 alunos no plano de teste
    const pend = (await org.listMembers(asUser(owner), gym.id)).find(x => x.email === 'a@x.com');
    await org.cancelPendingInvite(asUser(owner), gym.id, pend.pendingId);
    await org.inviteMember(asUser(owner), gym.id, { email: 'd@x.com', role: 'STUDENT' });
    await db.pendingInvite.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await org.listMembers(asUser(owner), gym.id)).filter(x => x.status === 'PENDING_SIGNUP').length, 0); // vencidos somem
    const outsider = await makeUser();
    await status(org.cancelPendingInvite(asUser(outsider), gym.id, pend.pendingId), 404);
  });

  dbTest('avisos: chegam para a pessoa certa, não se repetem, só o dono lê e marca como lidos', async () => {
    const t = await makeUser(); const s = await makeUser(); const x = await makeUser();
    await tr.saveProfile(asUser(t), { displayName: 'Prof. Ana' });
    const link = await tr.inviteStudent(asUser(t), { email: s.email });
    let feed = await nt.listNotifications(asUser(s));
    assert.equal(feed.unread, 1);
    assert.equal(feed.items[0].kind, 'trainer-link');
    await tr.respondLink(asUser(s), link.id, true);
    assert.equal((await nt.listNotifications(asUser(t))).items[0].kind, 'trainer-link'); // o personal soube do aceite
    await pv.setPermission(asUser(s), t.id, 'WORKOUTS', 'SEE');
    const a = await tr.assign(asUser(t), link.id, { title: 'Treino A', bundle: bundle() });
    await tr.addComment(asUser(s), a.id, 'Dúvida');
    await tr.addComment(asUser(t), a.id, 'Resposta');
    const kinds = (await nt.listNotifications(asUser(s))).items.map(n => n.kind).sort();
    assert.deepEqual(kinds, ['assignment', 'comment', 'trainer-link']);
    assert.deepEqual((await nt.listNotifications(asUser(t))).items.map(n => n.kind).sort(), ['comment', 'sharing', 'trainer-link']);
    assert.equal((await nt.listNotifications(asUser(x))).unread, 0);
    await nt.markRead(asUser(x), 'all');                            // não mexe nos dos outros
    assert.equal((await nt.listNotifications(asUser(s))).unread, 3);
    assert.equal((await nt.markRead(asUser(s), [feed.items[0].id])).marked, 1);
    assert.equal((await nt.markRead(asUser(s), 'all')).marked, 2);
    assert.equal((await nt.listNotifications(asUser(s))).unread, 0);
    // o mesmo evento não avisa duas vezes
    await nt.markRead(asUser(s), 'all');
    await db.notification.deleteMany({}); // zera e confirma a deduplicação pela chave
    const { withContext } = await import('../saas/org/context.js');
    for (let i = 0; i < 2; i++) await withContext({ userId: t.id }, tx => nt.notify(tx, s.id, { kind: 'x', title: 't', dedupeKey: 'mesma' }));
    assert.equal(await db.notification.count(), 1);
  });

  dbTest('RLS: ninguém lê os avisos de outro, nem o código de e-mail; apagar a conta leva os avisos', async () => {
    if (!rlsReady) return;
    const a = await makeUser(); const b = await makeUser(); const m = mailer();
    await vf.sendCode(asUser(a), m);
    const { withContext } = await import('../saas/org/context.js');
    await withContext({ userId: b.id }, tx => nt.notify(tx, a.id, { kind: 'x', title: 'oi' }));
    assert.equal(await withContext({ userId: a.id }, tx => tx.notification.count()), 1);
    assert.equal(await withContext({ userId: b.id }, tx => tx.notification.count()), 0);
    assert.equal(await withContext({ userId: b.id }, tx => tx.emailVerification.count()), 0);
    assert.equal((await withContext({ userId: b.id }, tx => tx.notification.updateMany({ where: { userId: a.id }, data: { readAt: new Date() } }))).count, 0);
    await eraseUserData(a.id);
    assert.equal(await db.notification.count(), 0);
    assert.equal(await db.emailVerification.count(), 0);
  });

  dbTest('painel da plataforma: lista academias só com plano e contagens, e um usuário comum não vê as dos outros', async () => {
    const [o1, o2, admin] = await Promise.all([makeUser(), makeUser(), makeUser()]);
    const g1 = await org.createGym(asUser(o1), { name: 'Academia Um' });
    await org.createGym(asUser(o2), { name: 'Academia Dois' });
    await org.inviteMember(asUser(o1), g1.id, { email: 'sem.conta@x.com', role: 'STUDENT' });
    const rows = await listGyms(asUser(admin));
    assert.deepEqual(rows.map(r => r.name).sort(), ['Academia Dois', 'Academia Um']);
    const one = rows.find(r => r.name === 'Academia Um');
    assert.equal(one.members, 1);
    assert.equal(one.plan, 'Academia Grátis');
    assert.ok(!JSON.stringify(rows).includes('sem.conta@x.com'));   // nada de e-mails nem conteúdo
    assert.equal((await org.myContexts(asUser(o1))).gyms.length, 1); // quem não é admin continua vendo só a sua
  });
});
