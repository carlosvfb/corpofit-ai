/* Ponta a ponta com o servidor REAL em SAAS_MODE=1, PostgreSQL de verdade e um Asaas falso (HTTP local):
   cadastro com e-mail e termos, planos públicos, checkout Pix, webhook autenticado liberando o
   Premium somente após a cobrança confirmada, limite da IA e proteção das rotas admin. */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';
import { TEST_DB_URL, db, dbUp, resetDb } from './saas-helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = dbUp ? test : test.skip;

let asaas, asaasPort, server, base, dataDir, child;
const asaasState = { paymentStatus: 'PENDING', requests: [] };

function startFakeAsaas() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        asaasState.requests.push({ method: req.method, url: req.url, token: req.headers.access_token, body: body ? JSON.parse(body) : null });
        const send = (obj, code = 200) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
        const u = req.url.split('?')[0];
        if (req.method === 'GET' && u === '/v3/customers') return send({ data: [] });
        if (req.method === 'POST' && u === '/v3/customers') return send({ id: 'cus_e2e' });
        if (req.method === 'POST' && u === '/v3/subscriptions') return send({ id: 'sub_e2e', customer: 'cus_e2e', status: 'ACTIVE' });
        if (u === '/v3/subscriptions/sub_e2e/payments') {
          return send({ data: [{ id: 'pay_e2e', customer: 'cus_e2e', subscription: 'sub_e2e', status: asaasState.paymentStatus, value: 29.9, dueDate: new Date().toISOString().slice(0, 10) }] });
        }
        if (u === '/v3/payments/pay_e2e/pixQrCode') return send({ payload: '00020126pixe2e', encodedImage: 'QkFTRTY0', expirationDate: '2099-01-01 12:00:00' });
        if (u === '/v3/payments/pay_e2e') {
          return send({ id: 'pay_e2e', customer: 'cus_e2e', subscription: 'sub_e2e', status: asaasState.paymentStatus, value: 29.9, dueDate: new Date().toISOString().slice(0, 10) });
        }
        if (req.method === 'DELETE' && u === '/v3/subscriptions/sub_e2e') return send({ deleted: true, id: 'sub_e2e' });
        send({ errors: [{ code: 'not_found', description: 'rota desconhecida no teste' }] }, 404);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

before(async () => {
  if (!dbUp) return;
  await resetDb();
  asaas = await startFakeAsaas();
  asaasPort = asaas.address().port;
  const secret = crypto.randomBytes(32).toString('hex');
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'saas-e2e-'));
  fs.writeFileSync(path.join(dataDir, 'secret'), secret, { mode: 0o600 });
  child = spawn(process.execPath, ['server.js'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, PORT: '0', DATA_DIR: dataDir, ORIGIN: 'http://localhost:8080', RP_ID: 'localhost',
      PASSWORD_LOGIN: '1', MEDIA_UPLOADS: '0', SAAS_MODE: '1', DATABASE_URL: TEST_DB_URL,
      ASAAS_API_KEY: 'e2e_key', ASAAS_API_BASE_URL: `http://127.0.0.1:${asaasPort}/v3`,
      ASAAS_WEBHOOK_TOKEN: 'e2e-webhook-token-e2e-webhook-token', SOURCE_CODE_URL: 'https://example.com/fonte', AI_API_KEY: ''
    }
  });
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  server = await boundPort(child, () => log);
  base = `http://127.0.0.1:${server}`;
});

after(async () => {
  child?.kill('SIGKILL');
  asaas?.close();
  if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true });
  if (db) await db.$disconnect();
});

const call = (method, url, { body, cookie, headers } = {}) =>
  fetch(base + url, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  }).then(async r => ({ status: r.status, json: await r.json().catch(() => ({})), cookie: (r.headers.get('set-cookie') || '').split(';')[0] }));

const webhook = (event, token = 'e2e-webhook-token-e2e-webhook-token') =>
  call('POST', '/api/webhooks/asaas', { body: event, headers: token ? { 'asaas-access-token': token } : {} });

run('o fluxo do SaaS: cadastro, planos, checkout Pix, webhook e Premium só após confirmação', async () => {
  // Público: a configuração anuncia o modo SaaS e os planos têm preço definido pelo servidor.
  const cfg = await call('GET', '/api/config');
  assert.equal(cfg.json.saas.enabled, true);
  const plans = await call('GET', '/api/saas/plans');
  assert.equal(plans.status, 200);
  assert.equal(plans.json.plans.find(p => p.code === 'PREMIUM').priceCents, 2990);
  assert.equal(plans.json.sourceCodeUrl, 'https://example.com/fonte');

  // Cadastro: e-mail e aceite dos termos são obrigatórios.
  const pw = 'Senha-forte-123';
  assert.equal((await call('POST', '/api/register/password', { body: { name: 'Ana', password: pw, acceptTerms: true } })).json.code, 'email-required');
  assert.equal((await call('POST', '/api/register/password', { body: { name: 'Ana', email: 'ana@exemplo.com', password: pw } })).json.code, 'terms-required');
  const reg = await call('POST', '/api/register/password', { body: { name: 'Ana', email: 'ana@exemplo.com', password: pw, acceptTerms: true } });
  assert.equal(reg.status, 200);
  const cookie = reg.cookie;
  assert.ok(cookie);

  // Sem sessão não há assinatura nem admin.
  assert.equal((await call('GET', '/api/billing/status')).status, 401);
  assert.equal((await call('GET', '/api/admin/saas/overview', { cookie })).status, 403);

  // Começa no plano gratuito.
  const before = await call('GET', '/api/billing/status', { cookie });
  assert.equal(before.json.plan.code, 'FREE');
  assert.ok(before.json.methods.some(m => m.id === 'PIX'));
  assert.ok(!before.json.methods.some(m => m.id === 'PIX_AUTOMATIC'), 'Pix Automático não aparece desligado');

  // Checkout: método inválido e CPF inválido são recusados; o preço enviado pelo cliente é ignorado.
  assert.equal((await call('POST', '/api/billing/checkout', { cookie, body: { method: 'BOLETO', cpfCnpj: '52998224725' } })).status, 400);
  assert.equal((await call('POST', '/api/billing/checkout', { cookie, body: { method: 'PIX', cpfCnpj: '111.111.111-11' } })).status, 400);
  const co = await call('POST', '/api/billing/checkout', { cookie, body: { method: 'PIX', cpfCnpj: '529.982.247-25', value: 1, priceCents: 1 } });
  assert.equal(co.status, 201);
  assert.equal(co.json.kind, 'pix');
  assert.equal(co.json.payload, '00020126pixe2e');
  const created = asaasState.requests.find(r => r.method === 'POST' && r.url === '/v3/subscriptions');
  assert.equal(created.body.value, 29.9, 'o preço vem do servidor');
  assert.equal(created.token, 'e2e_key');

  // QR Code exibido NÃO libera o Premium.
  assert.equal((await call('GET', '/api/billing/status', { cookie })).json.plan.code, 'FREE');

  // Webhook: sem token e com token errado → 401.
  const evt = { id: 'evt_e2e_1', event: 'PAYMENT_RECEIVED', payment: { id: 'pay_e2e', subscription: 'sub_e2e', customer: 'cus_e2e', status: 'RECEIVED', value: 29.9 } };
  assert.equal((await webhook(evt, null)).status, 401);
  assert.equal((await webhook(evt, 'errado')).status, 401);

  // Evento "RECEIVED" mas a API do Asaas ainda diz PENDING (fora de ordem): continua gratuito.
  assert.equal((await webhook(evt)).status, 200);
  assert.equal((await call('GET', '/api/billing/status', { cookie })).json.plan.code, 'FREE');

  // Pagamento realmente confirmado: Premium liberado. O mesmo evento duplicado não duplica nada.
  asaasState.paymentStatus = 'RECEIVED';
  const evt2 = { ...evt, id: 'evt_e2e_2' };
  assert.equal((await webhook(evt2)).json.outcome, 'processed');
  assert.equal((await webhook(evt2)).json.outcome, 'duplicate');
  const after = await call('GET', '/api/billing/status', { cookie });
  assert.equal(after.json.plan.code, 'PREMIUM');
  assert.equal(after.json.payments.length, 1);
  assert.equal(await db.paymentEvent.count({ where: { externalEventId: 'evt_e2e_2' } }), 1);

  // Cancelamento: Premium segue até o fim do período pago.
  const cancel = await call('POST', '/api/billing/cancel', { cookie, body: {} });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.json.status, 'CANCELED');
  const end = await call('GET', '/api/billing/status', { cookie });
  assert.equal(end.json.plan.code, 'PREMIUM');
  assert.equal(end.json.subscription.status, 'CANCELED');

  // Isolamento: outro usuário não vê cobranças desta conta nem gera Pix da cobrança dela.
  const other = await call('POST', '/api/register/password', { body: { name: 'Bia', email: 'bia@exemplo.com', password: pw, acceptTerms: true } });
  const ob = await call('GET', '/api/billing/status', { cookie: other.cookie });
  assert.equal(ob.json.plan.code, 'FREE');
  assert.equal(ob.json.payments.length, 0);
  const paymentId = (await db.payment.findFirstOrThrow()).id;
  assert.equal((await call('POST', '/api/billing/pix', { cookie: other.cookie, body: { paymentId } })).status, 404);
});

run('IA: o limite de mensagem e o limite mensal do plano valem no servidor, antes de qualquer custo', async () => {
  const pw = 'Senha-forte-123';
  const reg = await call('POST', '/api/register/password', { body: { name: 'Caio', email: 'caio@exemplo.com', password: pw, acceptTerms: true } });
  const cookie = reg.cookie;
  const me = await call('GET', '/api/me', { cookie });
  const uid = me.json.user.id;

  const long = await call('POST', '/api/coach/ask', { cookie, body: { note: 'x'.repeat(801) } });
  assert.equal(long.status, 400);
  assert.equal(long.json.code, 'message-too-long');

  await db.user.upsert({ where: { id: uid }, create: { id: uid, name: 'Caio' }, update: {} });
  await db.usageRecord.createMany({ data: Array.from({ length: 20 }, () => ({ userId: uid })) });
  const over = await call('POST', '/api/coach/ask', { cookie, body: { note: 'oi' } });
  assert.equal(over.status, 402);
  assert.equal(over.json.code, 'ai-quota-exceeded');

  const usage = await call('GET', '/api/saas/ai', { cookie });
  assert.deepEqual({ used: usage.json.used, limit: usage.json.limit, plan: usage.json.plan }, { used: 20, limit: 20, plan: 'FREE' });
});

run('recuperação de senha por e-mail responde igual para endereço existente e inexistente', async () => {
  const a = await call('POST', '/api/login/password-forgot', { body: { email: 'ana@exemplo.com' } });
  const b = await call('POST', '/api/login/password-forgot', { body: { email: 'ninguem@exemplo.com' } });
  assert.equal(a.status, 200);
  assert.deepEqual(a.json, b.json);
  // A senha atual continua valendo (pedir o código não bloqueia a conta de ninguém).
  const login = await call('POST', '/api/login/password', { body: { name: 'ana@exemplo.com', password: 'Senha-forte-123' } });
  assert.equal(login.status, 200);
});
