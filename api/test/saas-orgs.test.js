import { beforeEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { db, dbTest, makeUser, resetDb, TEST_DB_URL, dbUp } from './saas-helpers.mjs';
import * as org from '../saas/org/service.js';
import { can, canAssign, canManage } from '../saas/org/rbac.js';

const asUser = u => ({ id: u.id, name: u.name, email: u.email });
const status = async (p, st) => assert.rejects(p, e => e.status === st, `esperava ${st}`);

// Papel sem superusuário: faz o RLS valer mesmo conectado como dono (ver org/context.js).
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
  } catch { /* sem permissão para criar papéis: roda só a camada da API */ }
});

describe('RBAC (sem banco)', () => {
  const m = (role, st = 'ACTIVE') => ({ role, status: st });
  dbTest('papéis só valem com vínculo ativo, e só abaixo do próprio nível', () => {
    assert.equal(can(m('GYM_OWNER'), 'tenant:delete'), true);
    assert.equal(can(m('GYM_ADMIN'), 'tenant:delete'), false);
    assert.equal(can(m('GYM_OWNER', 'INVITED'), 'settings:read'), false);
    assert.equal(can(m('STUDENT'), 'members:read'), false);
    assert.equal(canAssign(m('GYM_ADMIN'), 'GYM_ADMIN'), false);
    assert.equal(canAssign(m('GYM_ADMIN'), 'GYM_MANAGER'), true);
    assert.equal(canAssign(m('GYM_OWNER'), 'GYM_OWNER'), true);
    assert.equal(canManage(m('GYM_MANAGER'), m('PERSONAL_TRAINER')), true);
    assert.equal(canManage(m('GYM_ADMIN'), m('GYM_OWNER')), false);
  });
});

describe('academias: vínculos, permissões e isolamento', () => {
  beforeEach(async () => { if (db) await resetDb(); });

  async function gymWith() {
    const [owner, admin, manager, trainer, student] = await Promise.all([makeUser(), makeUser(), makeUser(), makeUser(), makeUser()]);
    const gym = await org.createGym(asUser(owner), { name: 'Academia Alfa' });
    for (const [u, role] of [[admin, 'GYM_ADMIN'], [manager, 'GYM_MANAGER'], [trainer, 'PERSONAL_TRAINER'], [student, 'STUDENT']]) {
      await org.inviteMember(asUser(owner), gym.id, { userId: u.id, role });
      await org.acceptInvite(asUser(u), gym.id);
    }
    return { gym, owner, admin, manager, trainer, student };
  }

  dbTest('criar academia: dono, configurações e registro de atividade; endereço repetido é recusado', async () => {
    const u = await makeUser();
    const gym = await org.createGym(asUser(u), { name: 'Força Total', slug: 'forca-total' });
    assert.equal(gym.role, 'GYM_OWNER');
    const ctx = await org.myContexts(asUser(u));
    assert.equal(ctx.gyms.length, 1);
    assert.equal(ctx.gyms[0].slug, 'forca-total');
    const act = await org.recentActivity(asUser(u), gym.id);
    assert.equal(act[0].action, 'tenant.created');
    const other = await makeUser();
    await status(org.createGym(asUser(other), { name: 'Outra', slug: 'forca-total' }), 409);
    await status(org.createGym(asUser(other), { name: 'x' }), 400);
  });

  dbTest('isolamento: quem não integra a academia recebe 404 em tudo, mesmo sabendo o ID', async () => {
    const a = await gymWith();
    const bOwner = await makeUser();
    const gymB = await org.createGym(asUser(bOwner), { name: 'Academia Beta' });
    const stranger = await makeUser();
    for (const who of [bOwner, stranger]) {
      await status(org.listMembers(asUser(who), a.gym.id), 404);
      await status(org.getSettings(asUser(who), a.gym.id), 404);
      await status(org.updateSettings(asUser(who), a.gym.id, { brand: { displayName: 'Invadida' } }), 404);
      await status(org.dashboard(asUser(who), a.gym.id), 404);
      await status(org.recentActivity(asUser(who), a.gym.id), 404);
      await status(org.inviteMember(asUser(who), a.gym.id, { userId: stranger.id, role: 'STUDENT' }), 404);
      await status(org.removeMember(asUser(who), a.gym.id, a.student.id), 404);
      await status(org.updateMemberRole(asUser(who), a.gym.id, a.student.id, 'GYM_ADMIN'), 404);
    }
    // o contexto de um não mostra a academia do outro
    assert.deepEqual((await org.myContexts(asUser(bOwner))).gyms.map(g => g.id), [gymB.id]);
    // nada mudou na academia A
    assert.equal((await org.getSettings(asUser(a.owner), a.gym.id)).name, 'Academia Alfa');
    assert.equal((await org.listMembers(asUser(a.owner), a.gym.id)).length, 5);
  });

  dbTest('IDOR: o ID de outra academia ou de um vínculo alheio não funciona dentro da minha', async () => {
    const a = await gymWith();
    const bOwner = await makeUser();
    const gymB = await org.createGym(asUser(bOwner), { name: 'Academia Beta' });
    const bStudent = await makeUser();
    await org.inviteMember(asUser(bOwner), gymB.id, { userId: bStudent.id, role: 'STUDENT' });
    await org.acceptInvite(asUser(bStudent), gymB.id);
    // o dono de A tenta mexer num aluno de B usando o tenant A: o vínculo não existe lá
    await status(org.removeMember(asUser(a.owner), a.gym.id, bStudent.id), 404);
    await status(org.updateMemberRole(asUser(a.owner), a.gym.id, bStudent.id, 'GYM_ADMIN'), 404);
    // e aceitar um convite que não é seu
    await status(org.acceptInvite(asUser(a.owner), gymB.id), 404);
    assert.equal((await org.listMembers(asUser(bOwner), gymB.id)).find(x => x.userId === bStudent.id).role, 'STUDENT');
  });

  dbTest('convite só vale depois do aceite e o convidado não ganha permissões antes', async () => {
    const owner = await makeUser(); const guest = await makeUser();
    const gym = await org.createGym(asUser(owner), { name: 'Academia Gama' });
    await org.inviteMember(asUser(owner), gym.id, { email: guest.email.toUpperCase(), role: 'PERSONAL_TRAINER' });
    assert.equal((await org.myContexts(asUser(guest))).gyms[0].status, 'INVITED');
    await status(org.getSettings(asUser(guest), gym.id), 404);
    await status(org.inviteMember(asUser(owner), gym.id, { userId: guest.id, role: 'STUDENT' }), 409);
    await org.acceptInvite(asUser(guest), gym.id);
    assert.equal((await org.getSettings(asUser(guest), gym.id)).slug, 'academia-gama');
    await status(org.inviteMember(asUser(owner), gym.id, { email: 'ninguem@nao-existe.com', role: 'STUDENT' }), 404);
  });

  dbTest('papéis: cada nível só gerencia os de baixo', async () => {
    const { gym, owner, admin, manager, trainer, student } = await gymWith();
    const extra = await makeUser();
    // aluno e personal não convidam
    await status(org.inviteMember(asUser(student), gym.id, { userId: extra.id, role: 'STUDENT' }), 403);
    await status(org.inviteMember(asUser(trainer), gym.id, { userId: extra.id, role: 'STUDENT' }), 403);
    // gerente convida aluno, mas não admin, nem altera papéis
    await org.inviteMember(asUser(manager), gym.id, { userId: extra.id, role: 'STUDENT' });
    await status(org.inviteMember(asUser(manager), gym.id, { userId: (await makeUser()).id, role: 'GYM_ADMIN' }), 403);
    await status(org.updateMemberRole(asUser(manager), gym.id, trainer.id, 'STUDENT'), 403);
    await status(org.removeMember(asUser(manager), gym.id, student.id), 403);
    // admin não mexe no dono nem promove a admin ou dono
    await status(org.removeMember(asUser(admin), gym.id, owner.id), 403);
    await status(org.updateMemberRole(asUser(admin), gym.id, owner.id, 'STUDENT'), 403);
    await status(org.updateMemberRole(asUser(admin), gym.id, trainer.id, 'GYM_OWNER'), 403);
    await status(org.updateMemberRole(asUser(admin), gym.id, trainer.id, 'GYM_ADMIN'), 403);
    await org.updateMemberRole(asUser(admin), gym.id, trainer.id, 'GYM_MANAGER');
    // só dono e admin mudam configurações
    await status(org.updateSettings(asUser(manager), gym.id, { brand: { displayName: 'X' } }), 403);
    await org.updateSettings(asUser(admin), gym.id, { brand: { displayName: 'Alfa Premium' } });
    // quem pode ver o painel
    await org.dashboard(asUser(trainer), gym.id);
    await status(org.dashboard(asUser(student), gym.id), 403);
    await status(org.recentActivity(asUser(student), gym.id), 403);
  });

  dbTest('remover revoga o acesso na hora; o último dono não sai', async () => {
    const { gym, owner, admin, student } = await gymWith();
    await org.getSettings(asUser(student), gym.id);
    await org.removeMember(asUser(admin), gym.id, student.id);
    await status(org.getSettings(asUser(student), gym.id), 404);
    await status(org.leaveGym(asUser(owner), gym.id), 409);
    await org.updateMemberRole(asUser(owner), gym.id, admin.id, 'GYM_OWNER');
    await org.leaveGym(asUser(owner), gym.id);
    await status(org.getSettings(asUser(owner), gym.id), 404);
    // reconvidar um removido é possível
    await org.inviteMember(asUser(admin), gym.id, { userId: student.id, role: 'STUDENT' });
    await org.acceptInvite(asUser(student), gym.id);
    await org.getSettings(asUser(student), gym.id);
  });

  dbTest('configurações: só campos conhecidos e válidos; o registro guarda antes e depois', async () => {
    const { gym, owner } = await gymWith();
    await org.updateSettings(asUser(owner), gym.id, {
      brand: { primaryColor: '#12ab34', logoUrl: 'http://inseguro.test/x.png', description: 'Treino sério', contact: { email: 'oi@alfa.com', phone: '11 99999-0000' }, hacker: 'x' },
      ai: { enabled: true, instructions: 'Seja direto.', apiKey: 'sk-nao-guardar' },
      features: { community: true, 'x y': true, nested: { a: 1 } }
    });
    const s = await org.getSettings(asUser(owner), gym.id);
    assert.equal(s.brand.primaryColor, '#12ab34');
    assert.equal(s.brand.logoUrl, undefined);
    assert.equal(s.brand.hacker, undefined);
    assert.equal(s.ai.apiKey, undefined);
    assert.deepEqual(s.features, { community: true });
    const act = await org.recentActivity(asUser(owner), gym.id);
    const upd = act.find(a => a.action === 'settings.updated');
    assert.equal(upd.before.brand.displayName, 'Academia Alfa');
    assert.equal(upd.after.brand.primaryColor, '#12ab34');
  });

  dbTest('painel: só contagens reais', async () => {
    const { gym, owner } = await gymWith();
    const d = await org.dashboard(asUser(owner), gym.id);
    assert.deepEqual(d.members.byRole, { GYM_OWNER: 1, GYM_ADMIN: 1, GYM_MANAGER: 1, PERSONAL_TRAINER: 1, STUDENT: 1 });
    assert.equal(d.students.active, 1);
    assert.equal(d.students.joinedLast30Days, 1);
    assert.equal(d.professionals.active, 2);
    assert.equal(d.members.invited, 0);
  });

  dbTest('RLS no banco: sem contexto nada aparece; com o contexto de A não se lê nem se grava em B', async () => {
    if (!rlsReady) return;
    const a = await gymWith();
    const bOwner = await makeUser();
    const gymB = await org.createGym(asUser(bOwner), { name: 'Academia Beta' });
    const { withContext } = await import('../saas/org/context.js');
    const none = await withContext({ userId: '' }, tx => tx.membership.count());
    assert.equal(none, 0);
    const onlyA = await withContext({ userId: a.owner.id, tenantId: a.gym.id }, tx => tx.membership.findMany());
    assert.ok(onlyA.length >= 5 && onlyA.every(r => r.tenantId === a.gym.id || r.userId === a.owner.id));
    assert.equal(await withContext({ userId: a.owner.id, tenantId: a.gym.id }, tx => tx.activityLog.count({ where: { tenantId: gymB.id } })), 0);
    assert.equal(await withContext({ userId: a.owner.id, tenantId: a.gym.id }, tx => tx.tenantSettings.count({ where: { tenantId: gymB.id } })), 0);
    await assert.rejects(withContext({ userId: a.owner.id, tenantId: a.gym.id }, tx => tx.membership.create({ data: { tenantId: gymB.id, userId: a.owner.id, role: 'STUDENT' } })));
    await assert.rejects(withContext({ userId: a.owner.id, tenantId: a.gym.id }, tx => tx.tenant.update({ where: { id: gymB.id }, data: { name: 'Sequestrada' } })));
    assert.equal((await db.tenant.findUnique({ where: { id: gymB.id } })).name, 'Academia Beta');
  });
});
