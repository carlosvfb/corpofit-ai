/* A CorpoFit AI: limites por plano no servidor, registro de tokens, regras de segurança no prompt,
   configuração do Coach a partir das variáveis AI_* e o leitor de tokens dos provedores. */
import { beforeEach, describe } from 'node:test';
import test from 'node:test';
import assert from 'node:assert/strict';
import { db, dbTest, makeSubscription, makeUser, resetDb } from './saas-helpers.mjs';
import { tempData } from './helpers.mjs';

tempData();
const { usageOf } = await import('../coach/core/adapters/http.js');
const anthropic = (await import('../coach/core/adapters/anthropic.js')).default;
const cfgStore = await import('../coach/config.js');
const { createAiGate, bootstrapCoach, COACH_RULES, JOB_ROUTES } = await import('../saas/ai.js');
const { SaasError } = await import('../saas/errors.js');
const { PLANS } = await import('../saas/plans.js');
const { saasRoutes } = await import('../saas/routes.js');

describe('leitura de tokens dos provedores', () => {
  test('cada formato de resposta vira { input, output }', () => {
    assert.deepEqual(usageOf({ usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50 } }), { input: 150, output: 20 });
    assert.deepEqual(usageOf({ usage: { prompt_tokens: 7, completion_tokens: 3 } }), { input: 7, output: 3 });
    assert.deepEqual(usageOf({ usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 4 } }), { input: 9, output: 4 });
    assert.equal(usageOf({}), null);
    assert.equal(usageOf({ usage: { input_tokens: 'x' } }), null);
  });

  test('o adaptador Anthropic devolve o uso e envia as regras da plataforma no prompt de sistema', async () => {
    let sent;
    const fetchImpl = async (url, init) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({ content: [{ type: 'text', text: '{"ok":true}' }], usage: { input_tokens: 321, output_tokens: 45 } }), { status: 200 });
    };
    const r = await anthropic.invoke({
      cfg: { systemExtra: COACH_RULES, temperature: 0.3, providerOptions: { anthropic: { baseUrl: 'http://127.0.0.1:1' } } },
      prompt: 'oi', system: 'regras do coach', model: 'claude-haiku-5-5',
      env: { ANTHROPIC_API_KEY: 'k' }, fetch: fetchImpl, maxTokens: 500
    });
    assert.equal(r.code, 0);
    assert.deepEqual(r.usage, { input: 321, output: 45 });
    assert.equal(sent.model, 'claude-haiku-5-5');
    assert.equal(sent.temperature, 0.3);
    const system = JSON.stringify(sent.system);
    assert.match(system, /Brazilian Portuguese/);
    assert.match(system, /not a doctor, physiotherapist or nutritionist/);
    assert.match(system, /regras do coach/);
  });

  test('sem temperature configurada, nenhuma é enviada', async () => {
    let sent;
    const fetchImpl = async (url, init) => { sent = JSON.parse(init.body); return new Response(JSON.stringify({ content: [{ type: 'text', text: 'x' }] }), { status: 200 }); };
    await anthropic.invoke({ cfg: {}, prompt: 'oi', system: 's', model: 'm', env: { ANTHROPIC_API_KEY: 'k' }, fetch: fetchImpl });
    assert.equal('temperature' in sent, false);
  });
});

describe('configuração do Coach pelas variáveis AI_*', () => {
  test('sem AI_API_KEY a IA fica desligada; com ela, liga com o modelo e a chave criptografada', () => {
    cfgStore.reset();
    delete process.env.AI_API_KEY;
    assert.equal(bootstrapCoach({ cfgStore }).configured, false);
    assert.equal(cfgStore.isEnabled(), false);

    process.env.AI_API_KEY = 'sk-test-123';
    process.env.AI_PROVIDER = 'anthropic';
    process.env.AI_MODEL = 'claude-haiku-5-5';
    process.env.AI_MAX_OUTPUT_TOKENS = '1200';
    const r = bootstrapCoach({ cfgStore });
    assert.deepEqual({ configured: r.configured, provider: r.provider, model: r.model }, { configured: true, provider: 'anthropic', model: 'claude-haiku-5-5' });
    assert.equal(cfgStore.isEnabled(), true);
    assert.equal(cfgStore.isConnected(), true);
    assert.equal(cfgStore.modelFor(), 'claude-haiku-5-5');
    assert.equal(cfgStore.load().maxOutputTokens, 1200);
    assert.equal(cfgStore.load().caps.perProfileDaily, 0);
    // A chave não fica em texto puro no arquivo de configuração.
    const raw = JSON.stringify(cfgStore.load());
    assert.ok(!raw.includes('sk-test-123'));
    delete process.env.AI_API_KEY;
    delete process.env.AI_MAX_OUTPUT_TOKENS;
  });

  test('um provedor desconhecido não liga a IA', () => {
    process.env.AI_API_KEY = 'x';
    process.env.AI_PROVIDER = 'inventado';
    assert.equal(bootstrapCoach({ cfgStore }).configured, false);
    delete process.env.AI_API_KEY;
    delete process.env.AI_PROVIDER;
  });
});

describe('limites da IA por plano', () => {
  beforeEach(async () => { if (db) await resetDb(); });
  const gate = createAiGate();

  dbTest('mensagem longa demais é recusada (400) e o limite do Premium é maior', async () => {
    const free = await makeUser();
    const long = 'x'.repeat(PLANS.FREE.limits.aiMessageMaxChars + 1);
    await assert.rejects(gate.check(free, { note: long }), e => e instanceof SaasError && e.status === 400 && e.code === 'message-too-long');
    const prem = await makeUser({ manualPremium: true });
    await gate.check(prem, { note: long });
  });

  dbTest('o limite mensal do plano gratuito barra (402) e conta só o que foi respondido', async () => {
    const u = await makeUser();
    await db.usageRecord.createMany({ data: Array.from({ length: PLANS.FREE.limits.aiMessagesPerMonth - 1 }, () => ({ userId: u.id })) });
    await db.usageRecord.createMany({ data: Array.from({ length: 5 }, () => ({ userId: u.id, success: false })) });
    await gate.check(u, {});                                   // 19 de 20 + 5 falhas: ainda cabe uma
    await db.usageRecord.create({ data: { userId: u.id } });   // agora 20
    await assert.rejects(gate.check(u, {}), e => e.status === 402 && e.code === 'ai-quota-exceeded');
    // Premium tem folga para o mesmo consumo.
    await db.user.update({ where: { id: u.id }, data: { manualPremium: true } });
    await gate.check(u, {});
  });

  dbTest('assinatura ativa libera o limite do Premium; vencida sem tolerância, não', async () => {
    const u = await makeUser();
    await db.usageRecord.createMany({ data: Array.from({ length: PLANS.FREE.limits.aiMessagesPerMonth }, () => ({ userId: u.id })) });
    await assert.rejects(gate.check(u, {}), e => e.status === 402);
    await makeSubscription(u.id, { status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 5 * 86_400_000) });
    await gate.check(u, {});
  });

  dbTest('o limite por minuto vale (429)', async () => {
    const u = await makeUser();
    for (let i = 0; i < PLANS.FREE.limits.aiMessagesPerMinute; i++) await gate.check(u, {});
    await assert.rejects(gate.check(u, {}), e => e.status === 429 && e.code === 'rate-limited');
  });

  dbTest('o fim de cada pedido registra tokens; esquecido ou sem consentimento não conta', async () => {
    const u = await makeUser();
    await gate.onJobFinished({ uid: u.id, kind: 'ask', outcome: 'ready', usage: { input: 120, output: 30 }, model: 'claude-haiku-5-5' });
    await gate.onJobFinished({ uid: u.id, kind: 'review', outcome: 'failed', errorClass: 'unusable', usage: { input: 80, output: 10 }, model: 'm' });
    await gate.onJobFinished({ uid: u.id, kind: 'ask', outcome: 'failed', errorClass: 'provider', usage: null });
    await gate.onJobFinished({ uid: u.id, kind: 'ask', outcome: 'failed', errorClass: 'forgotten', usage: null });
    await gate.onJobFinished({ uid: u.id, kind: 'ask', outcome: 'failed', errorClass: 'consent', usage: null });
    const rows = await db.usageRecord.findMany({ orderBy: { createdAt: 'asc' } });
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map(r => [r.success, r.inputTokens, r.outputTokens]), [[true, 120, 30], [true, 80, 10], [false, 0, 0]]);
    const s = await gate.summary(u);
    assert.deepEqual({ used: s.used, limit: s.limit, plan: s.plan }, { used: 2, limit: 20, plan: 'FREE' });
  });
});

describe('as rotas de IA que geram custo passam pelo limite', () => {
  test('exatamente as rotas de pedido ao provedor são vigiadas', () => {
    assert.deepEqual([...JOB_ROUTES].sort(), ['POST /api/coach/adapt', 'POST /api/coach/ask', 'POST /api/coach/debrief', 'POST /api/coach/plan', 'POST /api/coach/review']);
    const routes = saasRoutes({ json() {}, readBody() {}, readSession() {}, requireAdmin() {}, findUser() {}, aiGate: {} });
    for (const k of ['POST /api/billing/checkout', 'POST /api/billing/cancel', 'POST /api/webhooks/asaas', 'GET /api/saas/ai', 'POST /api/admin/saas/premium']) assert.equal(typeof routes[k], 'function', k);
  });
});
