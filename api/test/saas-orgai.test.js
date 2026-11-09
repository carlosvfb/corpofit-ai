import { beforeEach, describe } from 'node:test';
import assert from 'node:assert/strict';
import { db, dbTest, makeUser, resetDb } from './saas-helpers.mjs';
import * as org from '../saas/org/service.js';
import * as oai from '../saas/org/ai.js';
import { createAiGate } from '../saas/ai.js';
import { estimateCostMicros } from '../saas/usage.js';
process.env.GYM_PLANS = JSON.stringify({ GYM_FREE: { limits: { maxStudents: 50, maxProfessionals: 50, aiMonthlyMessages: 100000 } } }); // estes testes não exercitam o limite do plano (ver saas-gymbilling)

const asUser = u => ({ id: u.id, name: u.name, email: u.email });
const status = (p, st, code) => assert.rejects(p, e => e.status === st && (!code || e.code === code), `esperava ${st}`);

describe('IA por academia (sem banco)', () => {
  dbTest('o texto extra da academia é só uma preferência e vem marcado como tal', () => {
    const x = oai.buildExtra('Academia Alfa', { instructions: 'Priorize máquinas.', style: 'Direto' });
    assert.match(x, /Academia Alfa/);
    assert.match(x, /never overrides the CorpoFit AI rules/);
    assert.match(x, /Priorize máquinas\./);
    assert.equal(oai.buildExtra('X', {}), '');
  });

  dbTest('o teto mensal da academia pode baixar o da plataforma, nunca subir', () => {
    process.env.TENANT_AI_MONTHLY_CAP = '500';
    assert.equal(oai.tenantCap({}), 500);
    assert.equal(oai.tenantCap({ monthlyMessages: 100 }), 100);
    assert.equal(oai.tenantCap({ monthlyMessages: 99999 }), 500);
    assert.equal(oai.tenantCap({ monthlyMessages: 'x' }), 500);
    delete process.env.TENANT_AI_MONTHLY_CAP;
  });

  dbTest('custo estimado: só com preço configurado para o modelo; nunca inventado', () => {
    delete process.env.AI_PRICES;
    assert.equal(estimateCostMicros('m1', { input: 1000, output: 1000 }), null);
    process.env.AI_PRICES = JSON.stringify({ m1: { in: 1, out: 5 }, ruim: { in: 'x', out: 1 } });
    assert.equal(estimateCostMicros('m1', { input: 1_000_000, output: 200_000 }), 2_000_000); // US$ 1 + US$ 1
    assert.equal(estimateCostMicros('outro', { input: 10, output: 10 }), null);
    assert.equal(estimateCostMicros('ruim', { input: 10, output: 10 }), null);
    process.env.AI_PRICES = '{não é json';
    assert.equal(estimateCostMicros('m1', { input: 10, output: 10 }), null);
    delete process.env.AI_PRICES;
  });
});

describe('IA por academia: contexto, limites e consumo', () => {
  beforeEach(async () => { if (db) await resetDb(); });

  async function gymWith() {
    const [owner, admin, manager, student, outsider] = await Promise.all([makeUser(), makeUser(), makeUser(), makeUser(), makeUser()]);
    const gym = await org.createGym(asUser(owner), { name: 'Academia Alfa' });
    for (const [u, role] of [[admin, 'GYM_ADMIN'], [manager, 'GYM_MANAGER'], [student, 'STUDENT']]) {
      await org.inviteMember(asUser(owner), gym.id, { userId: u.id, role });
      await org.acceptInvite(asUser(u), gym.id);
    }
    await org.updateSettings(asUser(owner), gym.id, { ai: { enabled: true, instructions: 'Treinos de até 50 minutos.', style: 'Motivador' } });
    return { gym, owner, admin, manager, student, outsider };
  }

  dbTest('só um membro ativo escolhe o contexto da academia; voltar ao pessoal limpa tudo', async () => {
    const { gym, student, outsider } = await gymWith();
    await status(oai.setAiContext(asUser(outsider), gym.id), 404);
    await status(oai.setAiContext(asUser(student), 'nao-e-uuid'), 404);
    assert.deepEqual(await oai.getAiContext(asUser(student)), { tenantId: null, hasGuidance: false });
    await oai.setAiContext(asUser(student), gym.id);
    assert.deepEqual(await oai.getAiContext(asUser(student)), { tenantId: gym.id, hasGuidance: true });
    await oai.setAiContext(asUser(student), null);
    assert.equal((await oai.getAiContext(asUser(student))).tenantId, null);
  });

  dbTest('o portão aplica a orientação só a quem escolheu e nunca mistura contextos', async () => {
    const { gym, student, outsider } = await gymWith();
    const gate = createAiGate();
    await oai.setAiContext(asUser(student), gym.id);
    await gate.check(asUser(student), {});
    await gate.check(asUser(outsider), {});
    const ctx = oai.aiContextFor(student.id);
    assert.equal(ctx.tenantId, gym.id);
    assert.match(ctx.systemExtra, /Treinos de até 50 minutos\./);
    assert.equal(oai.aiContextFor(outsider.id), null); // o espaço pessoal de outro usuário não recebe nada
    // sair da academia: a escolha deixa de valer na hora
    await org.leaveGym(asUser(student), gym.id);
    await gate.check(asUser(student), {});
    assert.equal(oai.aiContextFor(student.id), null);
  });

  dbTest('IA desligada pela academia: o usuário continua com a IA pessoal, sem a orientação', async () => {
    const { gym, owner, student } = await gymWith();
    await oai.setAiContext(asUser(student), gym.id);
    await org.updateSettings(asUser(owner), gym.id, { ai: { enabled: false } });
    await createAiGate().check(asUser(student), {});
    assert.equal(oai.aiContextFor(student.id), null);
  });

  dbTest('teto mensal da academia: ao atingir, o portão responde 402 e o espaço pessoal segue livre', async () => {
    const { gym, owner, student } = await gymWith();
    await org.updateSettings(asUser(owner), gym.id, { ai: { monthlyMessages: 2 } });
    const gate = createAiGate();
    await oai.setAiContext(asUser(student), gym.id);
    for (let i = 0; i < 2; i++) await gate.onJobFinished({ uid: student.id, kind: 'ask', outcome: 'ready', usage: { input: 10, output: 5 }, model: 'm', tenantId: gym.id, provider: 'anthropic' });
    await status(gate.check(asUser(student), {}), 402, 'tenant-ai-quota');
    await oai.setAiContext(asUser(student), null);
    await gate.check(asUser(student), {}); // o limite pessoal do plano é outro e ainda não foi atingido
  });

  dbTest('consumo da academia: só contagens, por membro, com custo estimado se houver preço', async () => {
    const { gym, owner, admin, manager, student, outsider } = await gymWith();
    process.env.AI_PRICES = JSON.stringify({ m: { in: 1, out: 5 } });
    const gate = createAiGate();
    await gate.onJobFinished({ uid: student.id, kind: 'ask', outcome: 'ready', usage: { input: 1_000_000, output: 200_000 }, model: 'm', tenantId: gym.id, provider: 'anthropic' });
    await gate.onJobFinished({ uid: student.id, kind: 'ask', outcome: 'ready', usage: { input: 0, output: 0 }, model: 'm', tenantId: gym.id, provider: 'anthropic' });
    await gate.onJobFinished({ uid: owner.id, kind: 'ask', outcome: 'ready', usage: { input: 10, output: 10 }, model: 'm', tenantId: null, provider: 'anthropic' }); // pessoal: não conta para a academia
    const u = await oai.tenantAiUsage(asUser(admin), gym.id);
    assert.equal(u.messages, 2);
    assert.equal(u.estimatedCostUsd, 2);
    assert.equal(u.inputTokens, 1_000_000);
    assert.deepEqual(u.members.map(m => [m.userId, m.messages]), [[student.id, 2]]);
    assert.ok(!JSON.stringify(u).includes('Treino'));
    await status(oai.tenantAiUsage(asUser(manager), gym.id), 403);
    await status(oai.tenantAiUsage(asUser(student), gym.id), 403);
    await status(oai.tenantAiUsage(asUser(outsider), gym.id), 404);
    delete process.env.AI_PRICES;
    const none = await oai.tenantAiUsage(asUser(owner), gym.id);
    assert.equal(none.estimatedCostUsd, 2); // o que já foi gravado continua; novos usos sem preço ficam sem custo
    await gate.onJobFinished({ uid: student.id, kind: 'ask', outcome: 'ready', usage: { input: 5, output: 5 }, model: 'm', tenantId: gym.id, provider: 'anthropic' });
    assert.equal((await db.usageRecord.findFirst({ orderBy: { createdAt: 'desc' } })).costMicros, null);
  });
});
