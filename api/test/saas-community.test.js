import { beforeEach, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { db, dbTest, makeUser, resetDb, TEST_DB_URL, dbUp } from './saas-helpers.mjs';
import * as org from '../saas/org/service.js';
import * as cm from '../saas/org/community.js';

const asUser = u => ({ id: u.id, name: u.name, email: u.email });
const status = (p, st, code) => assert.rejects(p, e => e.status === st && (!code || e.code === code), `esperava ${st}${code ? ' ' + code : ''}`);
const routine = (extra = {}) => ({ opengym_plan: 1, name: 'Push Day', unit: 'kg', routines: [{ name: 'Push Day', ex: [{ id: '0025', sets: 3, reps: 8, weight: 80, pyramidWeight: 90, media: ['h1'], note: 'Controle a descida' }], ...extra }], from: 'Fulano', customEx: [{ id: 'c1', n: 'Meu supino', url: 'https://x.test/v.mp4', photos: ['p1'] }] });
const input = (over = {}) => ({ kind: 'ROUTINE', title: 'Push Day de 45 minutos', description: 'Peito, ombro e tríceps', bundle: routine(), visibility: 'PUBLIC', rightsConfirmed: true, ...over });

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
  } catch { /* só a camada da API */ }
});

describe('higienização (sem banco)', () => {
  dbTest('a rotina publicada perde pesos, mídia, links e remetente, e dados pessoais são recusados', () => {
    const c = cm.cleanRoutineBundle(routine());
    const json = JSON.stringify(c);
    for (const k of ['weight', 'pyramidWeight', 'media', 'photos', '"url"', '"from"', 'Fulano', 'x.test']) assert.ok(!json.includes(k), 'sobrou ' + k);
    assert.equal(c.routines[0].ex[0].note, 'Controle a descida');
    assert.equal(c.routines[0].ex[0].sets, 3);
    assert.throws(() => cm.cleanRoutineBundle(routine({ ex: [{ id: '1', note: 'me chame em joao@x.com' }] })), e => e.code === 'personal-data');
    assert.throws(() => cm.cleanRoutineBundle({ routines: [] }), e => e.code === 'invalid-bundle');
    assert.ok(cm.hasPersonalData('ligue 11 91234-5678') && cm.hasPersonalData('cpf 123.456.789-09') && !cm.hasPersonalData('3 séries de 10, 90 s de descanso'));
  });
});

describe('biblioteca comunitária', () => {
  beforeEach(async () => { if (db) await resetDb(); });

  async function world() {
    const [author, reader, owner, trainer, student, outsider, admin] = await Promise.all([makeUser(), makeUser(), makeUser(), makeUser(), makeUser(), makeUser(), makeUser()]);
    const gym = await org.createGym(asUser(owner), { name: 'Academia Alfa' });
    for (const [u, role] of [[trainer, 'PERSONAL_TRAINER'], [student, 'STUDENT']]) { await org.inviteMember(asUser(owner), gym.id, { userId: u.id, role }); await org.acceptInvite(asUser(u), gym.id); }
    return { author, reader, owner, trainer, student, outsider, admin, gym };
  }

  dbTest('publicar exige a declaração de direitos, texto válido e sem dados pessoais', async () => {
    const { author } = await world();
    await status(cm.publish(asUser(author), input({ rightsConfirmed: false })), 400, 'rights-required');
    await status(cm.publish(asUser(author), input({ title: 'ab' })), 400, 'invalid-title');
    await status(cm.publish(asUser(author), input({ kind: 'PLAN' })), 400, 'invalid-kind');
    await status(cm.publish(asUser(author), input({ description: 'fale comigo: ana@x.com' })), 400, 'personal-data');
    await status(cm.publish(asUser(author), { kind: 'TIP', title: 'Aquecer', body: 'curto', visibility: 'PUBLIC', rightsConfirmed: true }), 400, 'invalid-body');
    const tip = await cm.publish(asUser(author), { kind: 'TIP', title: 'Aqueça sempre', body: 'Faça 2 séries leves antes da primeira série de trabalho.', visibility: 'PUBLIC', rightsConfirmed: true });
    assert.equal(tip.kind, 'TIP');
    const r = await cm.publish(asUser(author), input());
    const full = await cm.get(asUser(author), r.id);
    assert.ok(!JSON.stringify(full.bundle).includes('weight'));
    assert.equal(full.author, author.name);
  });

  dbTest('limite diário de publicações', async () => {
    const { author } = await world();
    for (let i = 0; i < 10; i++) await cm.publish(asUser(author), input({ title: 'Treino ' + i }));
    await status(cm.publish(asUser(author), input({ title: 'Treino 11' })), 429, 'rate-limited');
  });

  dbTest('visibilidade: público para todos; da academia só para membros ativos; publicar na academia exige personal ou acima', async () => {
    const { author, reader, trainer, student, outsider, gym } = await world();
    await status(cm.publish(asUser(student), input({ visibility: 'GYM', tenantId: gym.id })), 403);
    await status(cm.publish(asUser(outsider), input({ visibility: 'GYM', tenantId: gym.id })), 404);
    const pub = await cm.publish(asUser(author), input({ title: 'Público' }));
    const inGym = await cm.publish(asUser(trainer), input({ title: 'Só da academia', visibility: 'GYM', tenantId: gym.id }));
    const titles = async (u, opts) => (await cm.list(asUser(u), opts)).map(i => i.title);
    assert.deepEqual(await titles(reader), ['Público']);                                   // o público não traz o da academia
    assert.deepEqual(await titles(student, { scope: 'gym', tenantId: gym.id }), ['Só da academia']);
    assert.deepEqual(await titles(outsider, { scope: 'gym', tenantId: gym.id }), []);        // quem não é membro não vê, mesmo com o ID
    await status(cm.get(asUser(outsider), inGym.id), 404);
    await status(cm.importItem(asUser(outsider), inGym.id), 404);
    assert.equal((await cm.get(asUser(student), inGym.id)).title, 'Só da academia');
    await cm.get(asUser(reader), pub.id);
    // removido da academia: perde a visão do conteúdo dela
    await org.leaveGym(asUser(student), gym.id);
    await status(cm.get(asUser(student), inGym.id), 404);
  });

  dbTest('favoritar, buscar e filtrar; importar devolve o treino higienizado e conta a importação', async () => {
    const { author, reader } = await world();
    const a = await cm.publish(asUser(author), input({ title: 'Peito e tríceps' }));
    await cm.publish(asUser(author), { kind: 'ARTICLE', title: 'Como progredir', body: 'Aumente a carga aos poucos quando completar todas as repetições.', visibility: 'PUBLIC', rightsConfirmed: true });
    assert.deepEqual((await cm.list(asUser(reader), { q: 'tríceps' })).map(i => i.title), ['Peito e tríceps']);
    assert.deepEqual((await cm.list(asUser(reader), { kind: 'ARTICLE' })).map(i => i.title), ['Como progredir']);
    await cm.favorite(asUser(reader), a.id, true);
    assert.deepEqual((await cm.list(asUser(reader), { favorites: true })).map(i => [i.title, i.favorited]), [['Peito e tríceps', true]]);
    await cm.favorite(asUser(reader), a.id, false);
    assert.deepEqual(await cm.list(asUser(reader), { favorites: true }), []);
    const got = await cm.importItem(asUser(reader), a.id);
    assert.equal(got.author, author.name);
    assert.ok(!JSON.stringify(got.bundle).includes('weight'));
    await cm.importItem(asUser(reader), a.id);
    assert.equal((await cm.get(asUser(author), a.id)).imports, 2);
    const tip = await cm.list(asUser(reader), { kind: 'ARTICLE' });
    await status(cm.importItem(asUser(reader), tip[0].id), 404); // só rotinas se importam
  });

  dbTest('autoria: só o autor remove; removido some para todos', async () => {
    const { author, reader } = await world();
    const a = await cm.publish(asUser(author), input());
    await status(cm.removeOwn(asUser(reader), a.id), 404);
    await cm.removeOwn(asUser(author), a.id);
    await status(cm.get(asUser(reader), a.id), 404);
    assert.deepEqual(await cm.list(asUser(reader)), []);
  });

  dbTest('denúncia: uma por pessoa, não no próprio conteúdo, e três pessoas escondem até um moderador decidir', async () => {
    const { author, reader, outsider, student, admin } = await world();
    const a = await cm.publish(asUser(author), input());
    await status(cm.report(asUser(author), a.id, 'SPAM'), 400, 'own-item');
    await status(cm.report(asUser(reader), a.id, 'NADA'), 400, 'invalid-reason');
    await cm.report(asUser(reader), a.id, 'COPYRIGHT', 'Parece copiado');
    await status(cm.report(asUser(reader), a.id, 'SPAM'), 409, 'already-reported');
    assert.equal((await cm.list(asUser(outsider))).length, 1);
    await cm.report(asUser(outsider), a.id, 'SPAM');
    await cm.report(asUser(student), a.id, 'INAPPROPRIATE');
    assert.deepEqual(await cm.list(asUser(outsider)), []);          // oculto
    await status(cm.get(asUser(outsider), a.id), 404);
    assert.equal((await cm.get(asUser(author), a.id)).status, 'HIDDEN'); // o autor ainda vê
    const q = await cm.moderationQueue(asUser(admin), { platform: true });
    assert.equal(q.length, 1);
    assert.equal(q[0].reports.length, 3);
    await cm.moderate(asUser(admin), a.id, 'restore', { platform: true });
    assert.equal((await cm.list(asUser(outsider))).length, 1);
    assert.deepEqual(await cm.moderationQueue(asUser(admin), { platform: true }), []);
  });

  dbTest('moderação: o dono da academia modera só o conteúdo dela; os demais não moderam', async () => {
    const { author, trainer, student, owner, outsider, gym } = await world();
    const mine = await cm.publish(asUser(trainer), input({ title: 'Da academia', visibility: 'GYM', tenantId: gym.id }));
    const pub = await cm.publish(asUser(author), input({ title: 'Público' }));
    await cm.report(asUser(student), mine.id, 'INAPPROPRIATE');
    await cm.report(asUser(student), pub.id, 'SPAM');
    const q = await cm.moderationQueue(asUser(owner), { tenantId: gym.id });
    assert.deepEqual(q.map(i => i.title), ['Da academia']);          // o público não aparece para a academia
    await status(cm.moderate(asUser(owner), pub.id, 'hide', { tenantId: gym.id }), 404);
    await status(cm.moderationQueue(asUser(student), { tenantId: gym.id }), 403);
    await status(cm.moderationQueue(asUser(trainer), { tenantId: gym.id }), 403);
    await status(cm.moderationQueue(asUser(outsider), { tenantId: gym.id }), 404);
    await cm.moderate(asUser(owner), mine.id, 'hide', { tenantId: gym.id });
    await status(cm.get(asUser(student), mine.id), 404);
    const act = await org.recentActivity(asUser(owner), gym.id);
    assert.ok(act.some(a => a.action === 'community.hide'));
    await cm.moderate(asUser(owner), mine.id, 'dismiss', { tenantId: gym.id });
    assert.equal((await cm.get(asUser(student), mine.id)).status, 'PUBLISHED');
  });

  dbTest('RLS no banco: sem contexto nada aparece; contador e moderador só nos casos previstos', async () => {
    if (!rlsReady) return;
    const { author, reader, trainer, gym } = await world();
    const a = await cm.publish(asUser(author), input({ title: 'Público' }));
    const g = await cm.publish(asUser(trainer), input({ title: 'Da academia', visibility: 'GYM', tenantId: gym.id }));
    const { withContext } = await import('../saas/org/context.js');
    assert.equal(await withContext({ userId: '' }, tx => tx.communityItem.count()), 0);
    assert.equal(await withContext({ userId: reader.id }, tx => tx.communityItem.count()), 1);                 // só o público
    assert.equal(await withContext({ userId: trainer.id }, tx => tx.communityItem.count()), 2);
    await assert.rejects(withContext({ userId: reader.id }, tx => tx.communityItem.update({ where: { id: a.id }, data: { title: 'Sequestrado' } })));
    assert.equal((await withContext({ userId: reader.id }, tx => tx.communityItem.updateMany({ where: { id: a.id }, data: { title: 'Sequestrado' } }))).count, 0);
    assert.equal((await withContext({ userId: reader.id, counter: g.id }, tx => tx.communityItem.updateMany({ where: { id: a.id }, data: { imports: 99 } }))).count, 0); // o contador vale para UM item
    assert.equal((await withContext({ userId: reader.id, moderator: 'tenant:' + gym.id }, tx => tx.communityItem.updateMany({ where: { id: a.id }, data: { status: 'HIDDEN' } }))).count, 0); // moderador de academia não alcança o público
    assert.equal((await db.communityItem.findUnique({ where: { id: a.id } })).title, 'Público');
    assert.equal(await withContext({ userId: reader.id }, tx => tx.communityReport.count()), 0);
  });
});
