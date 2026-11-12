/* Aviso diário: só quando a frequência manda evoluir ou recomeçar, uma vez por episódio. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

tempData();
const { evolutionNotice, evolutionOnce } = await import('../coach/evolution.js');

const TODAY = '2026-11-11'; // quarta
const day = n => new Date(Date.parse(TODAY + 'T00:00:00Z') - n * 86_400_000).toISOString().slice(0, 10);
const week = k => [0, 2, 4].map(i => day(2 + k * 7 - i));
const S = (workouts, coach = {}) => ({ lang: 'pt-BR', routines: [{ id: 'r1', name: 'A', ex: [{ id: '0001', sets: 3, reps: 10 }] }], week: { 1: ['r1'], 3: ['r1'], 5: ['r1'] }, workouts: workouts.map(d => ({ d })), coach: { consent: { agreedAt: '2026-01-01' }, profile: { daysPerWeek: 3 }, ...coach } });

test('treinou bem: avisa para evoluir; sumiu: avisa para recomeçar; faltou ou sem consentimento: não avisa', () => {
  const up = evolutionNotice(S([...week(1), ...week(2), day(1)]), TODAY);
  assert.equal(up.verdict, 'advance'); assert.match(up.title, /evoluir/); assert.match(up.key, /^evo-advance:/);
  const down = evolutionNotice(S([...week(5), ...week(6), day(30)]), TODAY);
  assert.equal(down.verdict, 'reset'); assert.match(down.title, /recomeçar/);
  assert.equal(evolutionNotice(S([...week(1), day(1)]), TODAY), null);                 // manter nunca avisa
  assert.equal(evolutionNotice(S([...week(1), ...week(2), day(1)], { consent: null }), TODAY), null);
  assert.equal(evolutionNotice({ ...S([...week(1), ...week(2), day(1)]), routines: [] }, TODAY), null);
  assert.match(evolutionNotice({ ...S([...week(1), ...week(2), day(1)]), lang: 'en' }, TODAY).title, /level up/);
});

test('a chave muda quando o episódio muda: evoluiu, ou voltou e sumiu de novo', () => {
  const a = evolutionNotice(S([...week(1), ...week(2), day(1)]), TODAY).key;
  const b = evolutionNotice(S([...week(1), ...week(2), day(1)], { phase: { level: 2, lastAdvanceOn: day(30) } }), TODAY).key;
  assert.notEqual(a, b);
  assert.notEqual(evolutionNotice(S([day(30)]), TODAY).key, evolutionNotice(S([day(40)]), TODAY).key);
});

test('o cron avisa uma vez, empurra só quando o aviso é novo e um perfil com erro não derruba os outros', async () => {
  const seen = new Set(), pushes = [];
  const states = { a: S([...week(1), ...week(2), day(1)]), b: S([day(30)]), c: S([...week(1), day(1)]) };
  const deps = {
    users: () => [{ id: 'a' }, { id: 'boom' }, { id: 'b' }, { id: 'c' }], today: TODAY,
    readState: id => { if (id === 'boom') throw new Error('arquivo corrompido'); return states[id]; },
    notify: (u, n) => { const k = u.id + n.dedupeKey; if (seen.has(k)) return false; seen.add(k); return true; },
    push: (uid, p) => pushes.push([uid, p.tag])
  };
  assert.deepEqual(await evolutionOnce(deps), { sent: 2 });
  assert.deepEqual(pushes, [['a', 'evolution'], ['b', 'evolution']]);
  assert.deepEqual(await evolutionOnce(deps), { sent: 0 });   // no dia seguinte, nada de novo
  assert.equal(pushes.length, 2);
  assert.deepEqual(await evolutionOnce({ ...deps, notify: undefined }), { sent: 0 }); // sem SaaS não há como deduplicar: não empurra
});
