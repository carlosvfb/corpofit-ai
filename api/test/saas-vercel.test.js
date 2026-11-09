/* O modo Vercel: nenhuma instância guarda nada que a outra não veja. Duas "instâncias" (processos com o
   handler da função) sobre o MESMO PostgreSQL: cadastro numa, login e dados na outra; pedidos
   simultâneos sem perder gravações; limites de tentativa compartilhados; cron; e o sistema de arquivos
   virtual com controle otimista de revisão. */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort } from './helpers.mjs';
import { TEST_DB_URL, db, dbUp, resetDb } from './saas-helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = dbUp ? test : test.skip;
const SECRET = 'vercel-test-secret-vercel-test-secret-123456';
const CRON = 'cron-secret-for-the-test';
const children = [];

async function startInstance() {
  const child = spawn(process.execPath, ['scripts/serverless-dev.mjs'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, PORT: '0', STORAGE: 'postgres', APP_SECRET: SECRET, DATA_DIR: '/data', DATABASE_URL: TEST_DB_URL,
      SAAS_MODE: '1', PASSWORD_LOGIN: '1', ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', MEDIA_UPLOADS: '0',
      CRON_SECRET: CRON, ASAAS_API_KEY: '', AI_API_KEY: ''
    }
  });
  children.push(child);
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  if (process.env.DEBUG_INSTANCES) { child.stdout.pipe(process.stderr); child.stderr.pipe(process.stderr); }
  const port = await boundPort(child, () => log);
  return { base: `http://127.0.0.1:${port}`, log: () => log };
}

let A, B;
before(async () => {
  if (!dbUp) return;
  await resetDb();
  await db.$executeRawUnsafe('TRUNCATE "KvFile"');
  A = await startInstance();
  B = await startInstance();
});
after(async () => {
  for (const c of children) c.kill('SIGKILL');
  if (db) await db.$disconnect();
});

const call = (inst, method, url, { body, cookie, headers } = {}) =>
  fetch(inst.base + url, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  }).then(async r => ({ status: r.status, json: await r.json().catch(() => ({})), cookie: (r.headers.get('set-cookie') || '').split(';')[0] }));

const PW = 'Senha-forte-12345';
const signup = (inst, name) => call(inst, 'POST', '/api/register/password', { body: { name, email: `${name.toLowerCase()}@exemplo.com`, password: PW, acceptTerms: true } });

run('um cadastro feito numa instância vale na outra, e os dados sincronizam entre as duas', async () => {
  const reg = await signup(A, 'Ana');
  assert.equal(reg.status, 200);
  // Outra instância: o login por e-mail e o /api/me enxergam a conta (db.json veio do PostgreSQL).
  const login = await call(B, 'POST', '/api/login/password', { body: { name: 'ana@exemplo.com', password: PW } });
  assert.equal(login.status, 200);
  const me = await call(B, 'GET', '/api/me', { cookie: login.cookie });
  assert.equal(me.json.user.name, 'Ana');
  // O cookie emitido por A também vale em B (o segredo vem de APP_SECRET, não de um arquivo local).
  assert.equal((await call(B, 'GET', '/api/me', { cookie: reg.cookie })).status, 200);

  // O documento do perfil: grava em A, lê em B.
  const first = await call(A, 'GET', '/api/data', { cookie: reg.cookie });
  assert.equal(first.status, 200);
  const put = await call(A, 'PUT', '/api/data', { cookie: reg.cookie, body: { state: { unit: 'kg', workouts: [{ id: 'w1', d: '2026-11-01', name: 'Treino A', ex: [] }], routines: [], _wid: 'w-1' }, baseRev: first.json.rev ?? 0 } });
  assert.equal(put.status, 200, JSON.stringify(put.json));
  const read = await call(B, 'GET', '/api/data', { cookie: reg.cookie });
  assert.equal(read.status, 200);
  assert.equal(read.json.state.workouts[0].id, 'w1');
});

run('perfis diferentes não enxergam os dados um do outro', async () => {
  const bia = await signup(B, 'Bia');
  const data = await call(A, 'GET', '/api/data', { cookie: bia.cookie });
  assert.equal(data.status, 200);
  assert.ok(!JSON.stringify(data.json).includes('Treino A'));
});

run('cadastros simultâneos em instâncias diferentes não perdem ninguém (controle otimista + nova tentativa)', async () => {
  const names = ['Caio', 'Dani', 'Edu', 'Fabi', 'Gabi', 'Hugo'];
  const results = await Promise.all(names.map((n, i) => signup(i % 2 ? A : B, n)));
  assert.deepEqual(results.map(r => r.status), names.map(() => 200));
  // Todos existem, vistos de qualquer instância.
  for (const n of names) {
    const r = await call(A, 'POST', '/api/login/password', { body: { name: `${n.toLowerCase()}@exemplo.com`, password: PW } });
    assert.equal(r.status, 200, n);
  }
});

run('o limite de tentativas de senha é compartilhado entre as instâncias', async () => {
  let locked = 0;
  for (let i = 0; i < 12; i++) {
    const inst = i % 2 ? A : B;
    const r = await call(inst, 'POST', '/api/login/password', { body: { name: 'ana@exemplo.com', password: 'errada-errada-' + i } });
    if (r.status === 429) locked++;
    else assert.equal(r.status, 401);
  }
  // 5 tentativas grátis na conta; da 6ª em diante o par de instâncias já pausa a conta.
  assert.ok(locked >= 5, `esperava a conta pausada em ambas as instâncias, pausas: ${locked}`);
  const correct = await call(A, 'POST', '/api/login/password', { body: { name: 'ana@exemplo.com', password: PW } });
  assert.equal(correct.status, 429, 'mesmo a senha certa espera a pausa');
});

run('SaaS: planos e assinatura funcionam sem estado local', async () => {
  const plans = await call(A, 'GET', '/api/saas/plans');
  assert.equal(plans.status, 200);
  const u = await signup(B, 'Iara');
  const status = await call(A, 'GET', '/api/billing/status', { cookie: u.cookie });
  assert.equal(status.json.plan.code, 'FREE');
  assert.equal((await call(A, 'POST', '/api/webhooks/asaas', { body: { id: 'x', event: 'PAYMENT_CREATED' } })).status, 401);
});

run('cron: fechado sem o segredo, aberto com ele', async () => {
  assert.equal((await call(A, 'GET', '/api/cron/tick')).status, 401);
  assert.equal((await call(A, 'GET', '/api/cron/tick', { headers: { authorization: 'Bearer errado' } })).status, 401);
  const ok = await call(B, 'GET', '/api/cron/tick', { headers: { authorization: 'Bearer ' + CRON } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.ok, true);
});

run('admin: o primeiro cadastro de uma instalação nova NÃO vira admin sem a flag; rotas admin recusam', async () => {
  const u = await signup(A, 'Jorge');
  assert.equal((await call(B, 'GET', '/api/admin/users', { cookie: u.cookie })).status, 403);
  assert.equal((await call(B, 'GET', '/api/admin/saas/overview', { cookie: u.cookie })).status, 403);
});

run('o PostgreSQL guarda os arquivos do openGym como linhas (e nenhum segredo)', async () => {
  const rows = await db.$queryRawUnsafe('SELECT path FROM "KvFile" ORDER BY path');
  const paths = rows.map(r => r.path);
  assert.ok(paths.includes('db.json'));
  assert.ok(paths.some(p => p.startsWith('state-')));
  assert.ok(!paths.includes('secret'), 'o segredo vem de APP_SECRET e nunca é gravado');
  const dump = JSON.stringify(await db.$queryRawUnsafe('SELECT content FROM "KvFile"'));
  assert.ok(!dump.includes(SECRET));
});
