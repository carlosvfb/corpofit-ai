/* A CorpoFit AI no modo Vercel: o pedido nasce numa instância, o provedor responde depois (trabalho em
   segundo plano), o resultado é gravado no PostgreSQL e QUALQUER instância o enxerga; o consumo de
   tokens vai para a cota do plano. O provedor é um servidor HTTP falso (formato da API da Anthropic). */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { boundPort, sampleState } from './helpers.mjs';
import { TEST_DB_URL, db, dbUp, resetDb } from './saas-helpers.mjs';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = dbUp ? test : test.skip;
const SECRET = 'vercel-ai-secret-vercel-ai-secret-1234567890';
const children = [];
const seen = [];
let provider;

function startProvider() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        if (req.url.startsWith('/v1/messages')) {
          seen.push({ headers: req.headers, body: JSON.parse(body) });
          res.writeHead(200, { 'content-type': 'application/json' });
          return res.end(JSON.stringify({
            content: [{ type: 'text', text: JSON.stringify({ coach_contract: 1, answer: 'Resposta de teste da CorpoFit AI.' }) }],
            usage: { input_tokens: 111, output_tokens: 22 }, stop_reason: 'end_turn'
          }));
        }
        res.writeHead(404); res.end();
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

async function startInstance(env) {
  const child = spawn(process.execPath, ['scripts/serverless-dev.mjs'], {
    cwd: API, stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env, PORT: '0', STORAGE: 'postgres', APP_SECRET: SECRET, DATA_DIR: '/data', DATABASE_URL: TEST_DB_URL,
      SAAS_MODE: '1', PASSWORD_LOGIN: '1', ORIGIN: 'http://localhost:8080', RP_ID: 'localhost', MEDIA_UPLOADS: '0', ...env
    }
  });
  children.push(child);
  let log = '';
  child.stdout.on('data', d => { log += d; });
  child.stderr.on('data', d => { log += d; });
  if (process.env.DEBUG_INSTANCES) { child.stdout.pipe(process.stderr); child.stderr.pipe(process.stderr); }
  return { base: `http://127.0.0.1:${await boundPort(child, () => log)}`, log: () => log };
}

let A, B;
before(async () => {
  if (!dbUp) return;
  await resetDb();
  await db.$executeRawUnsafe('TRUNCATE "KvFile"');
  provider = await startProvider();
  const env = { AI_API_KEY: 'sk-ai-test-key', AI_API_BASE_URL: `http://127.0.0.1:${provider.address().port}`, AI_MODEL: 'claude-haiku-5-5' };
  A = await startInstance(env);
  B = await startInstance(env);
});
after(async () => {
  for (const c of children) c.kill('SIGKILL');
  provider?.close();
  if (db) await db.$disconnect();
});

const call = (inst, method, url, { body, cookie } = {}) =>
  fetch(inst.base + url, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined })
    .then(async r => ({ status: r.status, json: await r.json().catch(() => ({})), cookie: (r.headers.get('set-cookie') || '').split(';')[0] }));

run('uma pergunta feita numa instância é respondida em segundo plano e vista pela outra, com tokens contados', async () => {
  const reg = await call(A, 'POST', '/api/register/password', { body: { name: 'Lia', email: 'lia@exemplo.com', password: 'Senha-forte-12345', acceptTerms: true } });
  assert.equal(reg.status, 200);
  const cookie = reg.cookie;
  const cur = await call(A, 'GET', '/api/data', { cookie });
  const put = await call(A, 'PUT', '/api/data', { cookie, body: { state: sampleState(), baseRev: cur.json.rev ?? 0 } });
  assert.equal(put.status, 200, JSON.stringify(put.json));

  // A IA está ligada pelas variáveis AI_* (e o modelo é o configurado).
  const cfg = await call(B, 'GET', '/api/config', { cookie });
  assert.equal(cfg.json.coach?.enabled, true);

  const ask = await call(A, 'POST', '/api/coach/ask', { cookie, body: { text: 'Como foi a minha semana?' } });
  assert.equal(ask.status, 202, JSON.stringify(ask.json));

  // Enquanto roda, a outra instância já sabe que há um pedido em andamento (e recusa um segundo).
  // Depois, o resultado aparece para quem perguntar, em qualquer instância.
  let status;
  for (let i = 0; i < 60; i++) {
    status = await call(B, 'GET', '/api/coach/status', { cookie });
    if (status.json.pending?.answer) break;
    await new Promise(r => setTimeout(r, 250));
  }
  assert.equal(status.json.pending?.answer, 'Resposta de teste da CorpoFit AI.', JSON.stringify(status.json));

  // O provedor recebeu o modelo certo, a chave só no servidor e as regras de segurança no prompt.
  assert.equal(seen.length, 1);
  assert.equal(seen[0].body.model, 'claude-haiku-5-5');
  assert.equal(seen[0].headers['x-api-key'], 'sk-ai-test-key');
  assert.match(JSON.stringify(seen[0].body.system), /not a doctor, physiotherapist or nutritionist/);

  // Tokens registrados e contados na cota do plano, vistos pela outra instância.
  const usage = await call(B, 'GET', '/api/saas/ai', { cookie });
  assert.equal(usage.json.used, 1);
  const row = await db.usageRecord.findFirstOrThrow();
  assert.deepEqual([row.inputTokens, row.outputTokens, row.success, row.model], [111, 22, true, 'claude-haiku-5-5']);

  // A chave não está em texto puro no banco.
  const dump = JSON.stringify(await db.$queryRawUnsafe('SELECT content FROM "KvFile"'));
  assert.ok(!dump.includes('sk-ai-test-key'));
});
