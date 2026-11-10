import { beforeEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { db, dbTest, makeUser, resetDb, TEST_DB_URL, dbUp } from './saas-helpers.mjs';
import * as org from '../saas/org/service.js';
import * as desk from '../saas/org/gym-desk.js';
import * as floor from '../saas/org/gym-floor.js';
import * as ops from '../saas/org/gym-ops.js';
import * as tr from '../saas/org/trainers.js';
import { markVerifiedByProvider } from '../saas/org/verify.js';
process.env.GYM_PLANS = JSON.stringify({ GYM_FREE: { limits: { maxStudents: 50, maxProfessionals: 50, aiMonthlyMessages: 100000 } } });

const asUser = u => ({ id: u.id, name: u.name, email: u.email });
const status = (p, st) => assert.rejects(p, e => e.status === st, `esperava ${st}`);
const CPF = '52998224725', CPF2 = '11144477735';
const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 7)]);
const form = (o = {}) => ({ fullName: 'Bia Souza Lima', email: 'bia@aluno.com', document: CPF, birthDate: '1995-04-10', phone: '(11) 98888-7777', termsAccepted: true, trainingConsent: true, ...o });
const past = n => { const d = new Date(Date.now() - n * 86_400_000); return d.toISOString().slice(0, 10); };

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

describe('recepção da academia: matrícula, mensalidade, face, aparelhos e catraca', () => {
  beforeEach(async () => { if (db) await resetDb(); });

  async function gym() {
    const [owner, manager, recep, teacher, member, outsider] = await Promise.all(Array.from({ length: 6 }, () => makeUser()));
    const g = await org.createGym(asUser(owner), { name: 'Academia Forte' });
    for (const [u, role] of [[manager, 'GYM_MANAGER'], [recep, 'RECEPTIONIST'], [teacher, 'INSTRUCTOR'], [member, 'STUDENT']]) {
      await org.inviteMember(asUser(owner), g.id, { userId: u.id, role }); await org.acceptInvite(asUser(u), g.id);
    }
    const plan = await desk.savePlan(asUser(manager), g.id, { name: 'Mensal', priceCents: 12900 });
    return { owner, manager, recep, teacher, member, outsider, g, plan };
  }

  dbTest('planos: gerente cria; recepção não; qualquer membro lê; valores validados', async () => {
    const c = await gym();
    await status(desk.savePlan(asUser(c.recep), c.g.id, { name: 'Trimestral', priceCents: 30000 }), 403);
    await status(desk.savePlan(asUser(c.manager), c.g.id, { name: 'x', priceCents: 100 }), 400);
    await status(desk.savePlan(asUser(c.manager), c.g.id, { name: 'Anual', priceCents: -5 }), 400);
    const upd = await desk.savePlan(asUser(c.manager), c.g.id, { id: c.plan.id, name: 'Mensal', priceCents: 13900 });
    assert.equal(upd.priceCents, 13900);
    assert.equal((await desk.listPlans(asUser(c.member), c.g.id))[0].priceCents, 13900);
    await status(desk.listPlans(asUser(c.outsider), c.g.id), 404);
  });

  dbTest('matrícula: valida CPF, menor de idade, termo e e-mail repetido; só recepção e gestão matriculam', async () => {
    const c = await gym();
    const r = asUser(c.recep);
    await status(desk.enroll(r, c.g.id, form({ document: '12345678900' })), 400);
    await status(desk.enroll(r, c.g.id, form({ email: 'sem-arroba' })), 400);
    await status(desk.enroll(r, c.g.id, form({ termsAccepted: false })), 400);
    await status(desk.enroll(r, c.g.id, form({ birthDate: past(365 * 12) })), 400); // menor sem responsável
    await status(desk.enroll(r, c.g.id, form({ billingDay: 31 })), 400);
    await status(desk.enroll(asUser(c.teacher), c.g.id, form()), 403);
    await status(desk.enroll(asUser(c.member), c.g.id, form()), 403);
    const ok = await desk.enroll(r, c.g.id, form({ birthDate: past(365 * 12), guardianName: 'Carla Lima', guardianDocument: CPF2, planId: c.plan.id }));
    assert.equal(ok.number, 1); assert.equal(ok.status, 'ENROLLED'); assert.ok(ok.accessCode.startsWith('ac_'));
    await status(desk.enroll(r, c.g.id, form({ planId: c.plan.id })), 409);
    assert.equal((await desk.enroll(r, c.g.id, form({ email: 'caio@aluno.com', document: '' }))).number, 2);
  });

  dbTest('quem entra pelo Google (ou confirma o e-mail) já cai ativo e vinculado à ficha da academia', async () => {
    const c = await gym();
    const student = await makeUser({ email: 'aluna@gmail.com' });
    const s = await desk.enroll(asUser(c.recep), c.g.id, form({ email: 'Aluna@Gmail.com', planId: c.plan.id }));
    assert.equal(s.hasAccount, false);
    assert.equal((await db.pendingInvite.findFirst({ where: { tenantId: c.g.id } })).autoAccept, true);
    assert.equal(await db.membership.count({ where: { tenantId: c.g.id, userId: student.id } }), 0); // sem e-mail confirmado, nada é concedido
    const r = await markVerifiedByProvider(asUser(student));
    assert.equal(r.claimed, 1);
    assert.equal((await db.membership.findFirst({ where: { tenantId: c.g.id, userId: student.id } })).status, 'ACTIVE');
    assert.equal((await db.gymStudent.findFirst({ where: { tenantId: c.g.id, email: 'aluna@gmail.com' } })).userId, student.id);
    const mine = await desk.myGym(asUser(student));
    assert.equal(mine.length, 1); assert.equal(mine[0].gym, 'Academia Forte'); assert.equal(mine[0].charges.length, 1);
    assert.deepEqual(await desk.myGym(asUser(c.outsider)), []);
  });

  dbTest('mensalidade: o primeiro pagamento ativa; pagar duas vezes é recusado; atraso bloqueia depois da tolerância', async () => {
    const c = await gym();
    const r = asUser(c.recep);
    const s = await desk.enroll(r, c.g.id, form({ planId: c.plan.id }));
    let ch = (await desk.listCharges(r, c.g.id, { status: 'PENDING' }))[0];
    assert.equal(ch.amountCents, 12900); assert.equal(ch.student.number, 1);
    await status(desk.recordPayment(r, c.g.id, ch.id, { method: 'BITCOIN' }), 400);
    const paid = await desk.recordPayment(r, c.g.id, ch.id, { method: 'CARTAO_MAQUININHA', note: 'Visa final 1234' });
    assert.equal(paid.status, 'PAID'); assert.equal(paid.studentActivated, true);
    await status(desk.recordPayment(r, c.g.id, ch.id, { method: 'PIX' }), 409);
    assert.equal((await desk.getStudent(r, c.g.id, s.id)).status, 'ACTIVE');
    // mês seguinte: gera uma vez só
    const month = new Date(Date.now() + 40 * 86_400_000).toISOString().slice(0, 7);
    assert.equal((await desk.generateCharges(r, c.g.id, month)).created, 1);
    assert.equal((await desk.generateCharges(r, c.g.id, month)).created, 0);
    const next = (await desk.listCharges(r, c.g.id, { month }))[0];
    assert.equal((await desk.getStudent(r, c.g.id, s.id)).access.allowed, true);
    await db.gymCharge.update({ where: { id: next.id }, data: { dueDate: new Date(past(10) + 'T00:00:00Z') } });
    const late = await desk.getStudent(r, c.g.id, s.id);
    assert.equal(late.access.allowed, false); assert.equal(late.access.reason, 'MENSALIDADE_ATRASADA');
    assert.equal(desk.evaluateAccess({ status: 'ACTIVE', graceDays: 3 }, [{ status: 'PENDING', dueDate: new Date(past(2) + 'T00:00:00Z') }]).allowed, true); // dentro da tolerância
    await desk.recordPayment(r, c.g.id, next.id, { method: 'PIX' });
    assert.equal((await desk.getStudent(r, c.g.id, s.id)).access.allowed, true);
    await desk.setStudentStatus(r, c.g.id, s.id, 'SUSPENDED', 'inadimplência');
    assert.equal((await desk.getStudent(r, c.g.id, s.id)).access.reason, 'SUSPENSO');
  });

  dbTest('quem vê o quê: professor vê a ficha sem CPF, endereço e pagamentos; recepção vê tudo; outra academia nada', async () => {
    const c = await gym();
    const s = await desk.enroll(asUser(c.recep), c.g.id, form({ planId: c.plan.id, address: 'Rua A, 10' }));
    const t = await desk.getStudent(asUser(c.teacher), c.g.id, s.id);
    assert.equal(t.document, undefined); assert.equal(t.address, undefined); assert.equal(t.charges, undefined); assert.equal(t.accessCode, undefined);
    assert.ok('healthNotes' in t);
    const full = await desk.getStudent(asUser(c.recep), c.g.id, s.id);
    assert.equal(full.document, CPF); assert.equal(full.charges.length, 1);
    assert.equal((await desk.listStudents(asUser(c.teacher), c.g.id))[0].document, undefined);
    await status(desk.listCharges(asUser(c.teacher), c.g.id, {}), 403);
    await status(desk.getStudent(asUser(c.member), c.g.id, s.id), 403);
    await status(desk.getStudent(asUser(c.outsider), c.g.id, s.id), 404);
    const other = await org.createGym(asUser(c.outsider), { name: 'Outra' });
    await status(desk.getStudent(asUser(c.outsider), other.id, s.id), 404);
    assert.equal((await desk.listStudents(asUser(c.outsider), other.id)).length, 0);
  });

  dbTest('foto de acesso: só com consentimento; revogar apaga a foto; imagem inválida é recusada', async () => {
    const c = await gym();
    const r = asUser(c.recep);
    const s = await desk.enroll(r, c.g.id, form());
    await status(desk.saveFacePhoto(r, c.g.id, s.id, jpeg), 409);
    await desk.setFaceConsent(r, c.g.id, s.id, true);
    await status(desk.saveFacePhoto(r, c.g.id, s.id, Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 400);
    assert.equal((await desk.saveFacePhoto(r, c.g.id, s.id, jpeg)).hasFacePhoto, true);
    assert.equal((await desk.readFacePhoto(r, c.g.id, s.id)).mime, 'image/jpeg');
    await status(desk.readFacePhoto(asUser(c.teacher), c.g.id, s.id), 403);
    await desk.setFaceConsent(r, c.g.id, s.id, false);
    await status(desk.readFacePhoto(r, c.g.id, s.id), 404);
    assert.equal((await db.gymStudent.findUnique({ where: { id: s.id } })).hasFacePhoto, false);
  });

  dbTest('aparelhos: gerente cadastra com número único; recepção e aluno só leem', async () => {
    const c = await gym();
    const m = asUser(c.manager);
    const a = await floor.saveEquipment(m, c.g.id, { number: 12, name: 'Leg press 45', category: 'Pernas', muscles: ['quadríceps', 'glúteos'], exerciseIds: ['0739'], location: 'Térreo' });
    assert.equal(a.number, 12);
    await status(floor.saveEquipment(m, c.g.id, { number: 12, name: 'Outro' }), 409);
    await status(floor.saveEquipment(m, c.g.id, { number: 0, name: 'Zero' }), 400);
    await status(floor.saveEquipment(asUser(c.recep), c.g.id, { number: 13, name: 'Supino' }), 403);
    await status(floor.saveEquipment(asUser(c.member), c.g.id, { number: 13, name: 'Supino' }), 403);
    const b = await floor.saveEquipment(m, c.g.id, { id: a.id, number: 12, name: 'Leg press 45', status: 'MAINTENANCE' });
    assert.equal(b.status, 'MAINTENANCE');
    assert.equal((await floor.listEquipment(asUser(c.member), c.g.id))[0].name, 'Leg press 45');
    await status(floor.listEquipment(asUser(c.outsider), c.g.id), 404);
    assert.deepEqual(await floor.deleteEquipment(m, c.g.id, a.id), { deleted: true });
  });

  dbTest('catraca: token do leitor, QR e matrícula, decisão pelo servidor, registro de cada passagem', async () => {
    const c = await gym();
    const r = asUser(c.recep), m = asUser(c.manager);
    await status(floor.createDevice(r, c.g.id, 'Catraca'), 403);
    const dev = await floor.createDevice(m, c.g.id, 'Catraca da entrada');
    assert.ok(dev.token.startsWith('gd_'));
    assert.equal((await db.gymDevice.findFirst({ where: { tenantId: c.g.id } })).tokenHash.includes('gd_'), false); // só o hash
    const s = await desk.enroll(r, c.g.id, form({ planId: c.plan.id }));
    const full = await desk.getStudent(r, c.g.id, s.id);
    // matriculou mas ainda não pagou: dentro da tolerância entra; depois do atraso, não
    assert.equal((await floor.deviceCheck(dev.token, { code: full.accessCode })).allowed, true);
    await db.gymCharge.updateMany({ where: { studentId: s.id }, data: { dueDate: new Date(past(10) + 'T00:00:00Z') } });
    const denied = await floor.deviceCheck(dev.token, { code: full.accessCode });
    assert.equal(denied.allowed, false); assert.equal(denied.reason, 'AGUARDANDO_PAGAMENTO');
    assert.equal((await floor.deviceCheck(dev.token, { code: full.accessCode, direction: 'OUT' })).allowed, true); // sair é sempre permitido
    const ch = (await desk.listCharges(r, c.g.id, { status: 'PENDING' }))[0];
    await desk.recordPayment(r, c.g.id, ch.id, { method: 'DINHEIRO' });
    const okFace = await floor.deviceCheck(dev.token, { number: 1 });
    assert.equal(okFace.allowed, true); assert.equal(okFace.name, 'Bia Souza Lima');
    const unknown = await floor.deviceCheck(dev.token, { code: 'ac_inexistente' });
    assert.equal(unknown.allowed, false); assert.equal(unknown.reason, 'NAO_ENCONTRADO');
    await status(floor.deviceCheck(dev.token, {}), 400);
    await status(floor.deviceCheck('gd_token-que-nao-existe-123456', { code: 'x' }), 401);
    await status(floor.deviceCheck(undefined, { code: 'x' }), 401);
    const ev = await floor.accessEvents(r, c.g.id);
    assert.equal(ev.length, 5); assert.ok(ev.some(e => !e.allowed && e.reason === 'AGUARDANDO_PAGAMENTO'));
    const people = await floor.devicePeople(dev.token);
    assert.deepEqual(Object.keys(people[0]).sort(), ['allowed', 'hasFace', 'name', 'number']); // sem CPF, e-mail ou telefone
    // desativar ou girar o token derruba o leitor
    await floor.updateDevice(m, c.g.id, dev.id, { active: false });
    await status(floor.deviceCheck(dev.token, { number: 1 }), 401);
    await floor.updateDevice(m, c.g.id, dev.id, { active: true });
    const rot = await floor.updateDevice(m, c.g.id, dev.id, { rotate: true });
    await status(floor.deviceCheck(dev.token, { number: 1 }), 401);
    assert.equal((await floor.deviceCheck(rot.token, { number: 1 })).allowed, true);
    // o código de outra academia não abre esta
    const other = await org.createGym(asUser(c.outsider), { name: 'Outra' });
    const odev = await floor.createDevice(asUser(c.outsider), other.id, 'Catraca');
    assert.equal((await floor.deviceCheck(odev.token, { code: full.accessCode })).reason, 'NAO_ENCONTRADO');
  });
  dbTest('o aluno retira o consentimento da foto sozinho; o professor da academia recebe o aluno como vínculo da academia', async () => {
    const c = await gym();
    const r = asUser(c.recep);
    const student = await makeUser({ email: 'aluna@gmail.com' });
    const s = await desk.enroll(r, c.g.id, form({ email: 'aluna@gmail.com' }));
    await markVerifiedByProvider(asUser(student));
    await desk.setFaceConsent(r, c.g.id, s.id, true); await desk.saveFacePhoto(r, c.g.id, s.id, jpeg);
    await status(desk.revokeMyFace(asUser(c.outsider), c.g.id), 404);
    assert.deepEqual(await desk.revokeMyFace(asUser(student), c.g.id), { revoked: true });
    const row = await db.gymStudent.findUnique({ where: { id: s.id } });
    assert.equal(row.hasFacePhoto, false); assert.equal(row.faceConsentAt, null);
    await status(desk.readFacePhoto(r, c.g.id, s.id), 404);
    // professor: precisa do perfil profissional; o aluno aceita o vínculo e escolhe o que compartilha
    await tr.saveProfile(asUser(c.teacher), { displayName: 'Prof. Ênio' });
    const p = await ops.assignTrainer(asUser(c.manager), c.g.id, { studentId: student.id, trainerId: c.teacher.id });
    assert.equal(p.status, 'PENDING');
    const link = (await tr.listLinks(asUser(student))).find(l => l.status === 'PENDING');
    assert.equal((await tr.respondLink(asUser(student), link.id, true)).status, 'ACTIVE');
    assert.equal((await ops.roster(asUser(c.manager), c.g.id)).team.some(t => t.userId === c.teacher.id && t.role === 'INSTRUCTOR' && t.students === 1), true);
  });
});
