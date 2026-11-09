/* O "sistema de arquivos" virtual do modo Vercel: leitura e escrita síncronas como no fs, gravação no
   PostgreSQL só ao final, e controle otimista de revisão entre quem gravou primeiro e quem gravou depois. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { db, dbUp } from './saas-helpers.mjs';
import { ConflictError, createVfs } from '../store/vfs.js';

const run = dbUp ? test : test.skip;
const query = (sql, params) => db.$queryRawUnsafe(sql, ...params);
const flushOf = v => v.flush(work => db.$transaction(async tx => work(async (sql, params) => Number(await tx.$executeRawUnsafe(sql, ...params)))));
const fresh = () => createVfs({ dataDir: '/data', secret: 'segredo-que-nunca-vai-ao-banco-1234567890', query });

run('grava ao final, lê de volta em outra "instância" e não persiste o segredo', async () => {
  await db.$executeRawUnsafe('TRUNCATE "KvFile"');
  const a = fresh();
  assert.equal(a.api.readFileSync('/data/secret', 'utf8'), 'segredo-que-nunca-vai-ao-banco-1234567890');
  a.api.writeFileSync('/data/db.json', '{"users":[]}');
  a.api.writeFileSync('/data/state-u1.json', '{"_rev":1}');
  a.api.mkdirSync('/data/coach', { recursive: true });
  a.api.writeFileSync('/data/coach/u1.json', '{"x":1}');
  assert.equal(a.hasDirty(), true);
  assert.equal(await flushOf(a), 3);
  assert.equal(a.hasDirty(), false);

  const b = fresh();
  await b.hydrate({ exact: ['db.json'], like: ['%u1%'] });
  assert.equal(b.api.readFileSync('/data/db.json', 'utf8'), '{"users":[]}');
  assert.equal(b.api.readFileSync('/data/state-u1.json', 'utf8'), '{"_rev":1}');
  assert.deepEqual(b.api.readdirSync('/data/coach'), ['u1.json']);
  assert.equal(b.api.statSync('/data/coach').isDirectory(), true);
  assert.equal(b.api.existsSync('/data/nada.json'), false);
  assert.throws(() => b.api.readFileSync('/data/nada.json'), e => e.code === 'ENOENT');
  const rows = await query('SELECT path FROM "KvFile"', []);
  assert.ok(!rows.some(r => r.path === 'secret'));
});

run('controle otimista: quem grava depois de outro sobre a mesma revisão recebe ConflictError', async () => {
  await db.$executeRawUnsafe('TRUNCATE "KvFile"');
  const seed = fresh();
  seed.api.writeFileSync('/data/db.json', '{"v":0}');
  await flushOf(seed);

  const a = fresh(), b = fresh();
  await a.hydrate({ exact: ['db.json'] });
  await b.hydrate({ exact: ['db.json'] });
  a.api.writeFileSync('/data/db.json', '{"v":"a"}');
  b.api.writeFileSync('/data/db.json', '{"v":"b"}');
  await flushOf(a);
  await assert.rejects(flushOf(b), ConflictError);
  // Nada do que b tentou ficou gravado, e refazendo com dados novos passa.
  const c = fresh();
  await c.hydrate({ exact: ['db.json'] });
  assert.equal(c.api.readFileSync('/data/db.json', 'utf8'), '{"v":"a"}');
  c.api.writeFileSync('/data/db.json', '{"v":"c"}');
  await flushOf(c);
});

run('a transação é tudo ou nada: um conflito desfaz as outras gravações do mesmo pedido', async () => {
  await db.$executeRawUnsafe('TRUNCATE "KvFile"');
  const seed = fresh();
  seed.api.writeFileSync('/data/db.json', '1');
  await flushOf(seed);
  const a = fresh(), b = fresh();
  await a.hydrate({ exact: ['db.json'] });
  await b.hydrate({ exact: ['db.json'] });
  a.api.writeFileSync('/data/db.json', '2');
  await flushOf(a);
  b.api.writeFileSync('/data/novo.json', 'x');   // criado primeiro…
  b.api.writeFileSync('/data/db.json', '3');     // …e este conflita
  await assert.rejects(flushOf(b), ConflictError);
  const rows = await query('SELECT path FROM "KvFile" ORDER BY path', []);
  assert.deepEqual(rows.map(r => r.path), ['db.json']);
});

run('criar o mesmo arquivo ao mesmo tempo: só um vence', async () => {
  await db.$executeRawUnsafe('TRUNCATE "KvFile"');
  const a = fresh(), b = fresh();
  a.api.writeFileSync('/data/vapid.json', '{"a":1}');
  b.api.writeFileSync('/data/vapid.json', '{"b":1}');
  await flushOf(a);
  await assert.rejects(flushOf(b), ConflictError);
});

run('remover, renomear, copiar e apagar pastas se comportam como no fs', async () => {
  await db.$executeRawUnsafe('TRUNCATE "KvFile"');
  const a = fresh();
  a.api.writeFileSync('/data/x.json', 'x');
  a.api.renameSync('/data/x.json', '/data/y.json');
  assert.equal(a.api.existsSync('/data/x.json'), false);
  assert.equal(a.api.readFileSync('/data/y.json', 'utf8'), 'x');
  a.api.copyFileSync('/data/y.json', '/data/z.json');
  a.api.appendFileSync('/data/z.json', 'z');
  assert.equal(a.api.readFileSync('/data/z.json', 'utf8'), 'xz');
  a.api.writeFileSync('/data/dir/a.json', '1');
  a.api.writeFileSync('/data/dir/b.json', '2');
  await flushOf(a);
  const b = fresh();
  await b.hydrate({ all: true });
  assert.deepEqual(b.api.readdirSync('/data').sort(), ['dir', 'secret', 'y.json', 'z.json']);
  b.api.rmSync('/data/dir', { recursive: true, force: true });
  b.api.unlinkSync('/data/y.json');
  assert.throws(() => b.api.unlinkSync('/data/y.json'), e => e.code === 'ENOENT');
  await flushOf(b);
  const rows = await query('SELECT path FROM "KvFile" ORDER BY path', []);
  assert.deepEqual(rows.map(r => r.path), ['z.json']);
});
