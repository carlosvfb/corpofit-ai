/* Apoio dos testes do CorpoFit AI SaaS (api/saas). Usam um PostgreSQL de verdade (banco `corpofitai_test`,
   por padrão em localhost:5432; `npm run db:dev` sobe um embutido) e mocks do Asaas e da IA.
   Sem o banco, os testes que dependem dele são PULADOS, para que `npm test` siga verde em máquinas
   sem Postgres. A suíte do openGym original não depende disto. */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import net from 'node:net';
import { test } from 'node:test';

const API = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
// Cada arquivo de teste roda em seu próprio processo (e `node --test` roda vários ao mesmo tempo),
// então cada um usa o seu schema no mesmo banco: nada de um interfere no outro.
const BASE_DB_URL = process.env.TEST_DATABASE_URL || 'postgresql://corpofitai:corpofitai@localhost:5432/corpofitai_test';
const schemaName = 'ff_' + path.basename(process.argv[1] || 'test').replace(/\.[a-z]+$/i, '').replace(/[^a-z0-9]/gi, '_').toLowerCase().slice(0, 40);
export const TEST_DB_URL = `${BASE_DB_URL.split('?')[0]}?schema=${schemaName}`;

process.env.DATABASE_URL = TEST_DB_URL;
process.env.ASAAS_API_KEY = 'test_key_not_real';
process.env.ASAAS_ENV = 'sandbox';
process.env.ASAAS_WEBHOOK_TOKEN = 'test-webhook-token-test-webhook-token';
process.env.APP_URL = 'http://localhost:8080';
delete process.env.AI_API_KEY;

function portOpen() {
  const u = new URL(TEST_DB_URL.replace(/^postgresql/, 'http'));
  return new Promise(resolve => {
    const s = net.connect({ host: u.hostname, port: Number(u.port || 5432) });
    s.once('connect', () => { s.destroy(); resolve(true); });
    s.once('error', () => resolve(false));
    s.setTimeout(1500, () => { s.destroy(); resolve(false); });
  });
}

export const dbUp = await portOpen();
if (dbUp) execSync('npx prisma migrate deploy', { cwd: API, stdio: 'pipe', env: { ...process.env, DATABASE_URL: TEST_DB_URL } });

/** `test` quando há banco; `test.skip` quando não há. */
export const dbTest = dbUp ? test : (name, fn) => test.skip(name, fn);

const { db } = dbUp ? await import('../saas/db.js') : { db: null };
export { db };

export async function resetDb() {
  await db.$executeRawUnsafe(
    'TRUNCATE "TrainerNote","TrainingSession","Notification","PendingInvite","EmailVerification","CommunityReport","CommunityFavorite","CommunityItem","AccessLog","ConsentRecord","SharingPermission","AssignmentComment","Assignment","TrainerStudent","TrainerProfile","ActivityLog","Membership","TenantSettings","Tenant","AdminAuditLog","ErrorLog","AppSetting","PaymentEvent","Payment","Subscription","BillingCustomer","Plan","UsageRecord","User" RESTART IDENTITY CASCADE'
  );
  await db.plan.createMany({
    data: [
      { code: 'FREE', name: 'Gratuito', priceCents: 0, aiMessagesPerMonth: 20, features: {} },
      { code: 'PREMIUM', name: 'Premium', priceCents: 2990, aiMessagesPerMonth: 300, features: {} }
    ]
  });
}

let n = 0;
export async function makeUser(over = {}) {
  n++;
  return db.user.create({ data: { id: `u${n}-${Date.now()}`, name: `Usuário ${n}`, email: `u${n}-${Date.now()}@teste.com`, ...over } });
}

export async function makeSubscription(userId, data = {}) {
  return db.subscription.create({
    data: { userId, planCode: 'PREMIUM', paymentMethod: 'CREDIT_CARD', status: 'PENDING', idempotencyKey: `k-${Math.random()}`, ...data }
  });
}

export function asaasPayment(over = {}) {
  return { id: 'pay_1', customer: 'cus_1', subscription: 'sub_1', status: 'PENDING', value: 29.9, dueDate: '2026-11-08', billingType: 'CREDIT_CARD', ...over };
}

/** Um mock mínimo no lugar de vi.fn: registra chamadas e permite trocar a implementação. */
export function mock(impl = async () => undefined) {
  const queue = [];
  const f = async (...args) => {
    f.calls.push(args);
    if (queue.length) return queue.shift()(...args);
    return f.impl(...args);
  };
  f.calls = [];
  f.impl = impl;
  f.onceRejects = err => { queue.push(async () => { throw err; }); return f; };
  f.onceResolves = v => { queue.push(async () => v); return f; };
  return f;
}
