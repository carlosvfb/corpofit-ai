/* Frequência -> o que a IA pode fazer: o motor (attendance.js) e o portão no validador. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

tempData();
const { attendance, directionOf, gateErrors, RULES } = await import('../coach/core/attendance.js');
const { validateReview } = await import('../coach/core/validate.js');
const { build } = await import('../coach/core/payload.js');

const TODAY = '2026-11-11'; // quarta-feira
const day = n => new Date(Date.parse(TODAY + 'T00:00:00Z') - n * 86_400_000).toISOString().slice(0, 10);
// treinos nos dias `k` semanas atrás: segunda, quarta e sexta da semana completa k
const mondayOfThisWeek = 2; // TODAY é quarta: a segunda é 2 dias atrás
const week = (k, n = 3) => [0, 2, 4].slice(0, n).map(i => day(mondayOfThisWeek + k * 7 - i));

test('semanas boas seguidas, sessão recente e sem evolução recente: pode evoluir', () => {
  const a = attendance({ workoutDays: [...week(1), ...week(2), day(1)], targetPerWeek: 3, today: TODAY });
  assert.equal(a.verdict, 'advance'); assert.equal(a.goodWeeks, 2); assert.equal(a.reason, 'consistent');
});

test('uma semana boa só, ou faltou muito: mantém', () => {
  assert.equal(attendance({ workoutDays: [...week(1), day(1)], targetPerWeek: 3, today: TODAY }).verdict, 'hold');
  const few = attendance({ workoutDays: [...week(1, 1), ...week(2, 1), day(1)], targetPerWeek: 3, today: TODAY });
  assert.equal(few.verdict, 'hold'); assert.equal(few.reason, 'low-attendance');
  // 80% de 3 dias é 3 (arredondado para cima): 2 não basta. 4 de 5 dias basta
  assert.equal(attendance({ workoutDays: [...week(1, 2)], targetPerWeek: 3, today: TODAY }).perWeek.at(-1).good, false);
  assert.equal(attendance({ workoutDays: [day(9), day(8), day(7), day(6)], targetPerWeek: 5, today: TODAY }).perWeek.at(-1).good, true);
});

test('sem histórico: mantém; sumiu uma semana: mantém; sumiu três semanas: recomeça', () => {
  const none = attendance({ workoutDays: [], targetPerWeek: 3, today: TODAY });
  assert.equal(none.verdict, 'hold'); assert.equal(none.reason, 'no-history');
  const away = attendance({ workoutDays: [...week(3), ...week(4), day(9)], targetPerWeek: 3, today: TODAY });
  assert.equal(away.verdict, 'hold'); assert.equal(away.reason, 'away'); assert.equal(away.gapDays, 9);
  const gone = attendance({ workoutDays: [...week(5), ...week(6), day(30)], targetPerWeek: 3, today: TODAY });
  assert.equal(gone.verdict, 'reset'); assert.equal(gone.gapDays, 30);
  assert.equal(attendance({ workoutDays: [day(RULES.resetGap)], targetPerWeek: 3, today: TODAY }).verdict, 'reset');
  assert.equal(attendance({ workoutDays: [day(RULES.resetGap - 1)], targetPerWeek: 3, today: TODAY }).verdict, 'hold');
});

test('evoluiu há pouco: espera; depois do intervalo: evolui de novo; não treinou esta semana: espera', () => {
  const days = [...week(1), ...week(2), day(1)];
  const soon = attendance({ workoutDays: days, targetPerWeek: 3, today: TODAY, lastAdvanceOn: day(10) });
  assert.equal(soon.verdict, 'hold'); assert.equal(soon.reason, 'too-soon');
  assert.equal(attendance({ workoutDays: days, targetPerWeek: 3, today: TODAY, lastAdvanceOn: day(28) }).verdict, 'advance');
  const idle = attendance({ workoutDays: [...week(1), ...week(2), day(5)], targetPerWeek: 3, today: TODAY });
  assert.equal(idle.verdict, 'hold'); assert.equal(idle.reason, 'not-this-week');
});

test('entradas estranhas não quebram: datas inválidas, futuras e repetidas são ignoradas', () => {
  const a = attendance({ workoutDays: ['lixo', null, '2027-01-01', day(1), day(1), 5], targetPerWeek: 99, today: TODAY });
  assert.equal(a.lastWorkoutDay, day(1)); assert.equal(a.targetPerWeek, 7);
});

test('direção da mudança: números pelos valores, troca pelo que o modelo declarou (sem declarar = pior caso)', () => {
  assert.equal(directionOf({ type: 'sets', before: 3, after: 4 }), 'harder');
  assert.equal(directionOf({ type: 'reps', before: 10, after: 8 }), 'easier');
  assert.equal(directionOf({ type: 'inc', before: 2.5, after: 2.5 }), 'same');
  assert.equal(directionOf({ type: 'add-exercise' }), 'harder');
  assert.equal(directionOf({ type: 'remove-exercise' }), 'easier');
  assert.equal(directionOf({ type: 'swap-exercise' }, 'easier'), 'easier');
  assert.equal(directionOf({ type: 'swap-exercise' }, 'sei lá'), 'harder');
  assert.equal(directionOf({ type: 'rename-routine' }), 'same');
});

const PLAN = { routines: [{ id: 'r1', name: 'Full body A', ex: [{ id: '0001', sets: 3, reps: 10 }, { id: '0007', sets: 3, sec: 45 }] }] };
const harder = { id: 'a', type: 'sets', target: { routineId: 'r1', exId: '0001' }, after: 4, why: 'x' };
const easier = { id: 'b', type: 'sets', target: { routineId: 'r1', exId: '0001' }, after: 2, why: 'x' };
const review = (changes, attendance) => validateReview({ coach_contract: 1, summary: 's', changes }, PLAN, { attendance });
const att = verdict => ({ verdict, reason: verdict === 'hold' ? 'low-attendance' : 'x', gapDays: 30 });

test('o validador barra mudança mais difícil quando a frequência manda manter ou recomeçar', () => {
  assert.equal(review([harder], att('hold')).ok, false);
  assert.match(review([harder], att('hold')).errors.join(' '), /não permite evoluir|frequência/);
  assert.equal(review([harder], att('reset')).ok, false);
  assert.equal(review([easier], att('reset')).ok, true);       // recomeçar: pode facilitar
  assert.equal(review([easier], att('hold')).ok, true);        // manter: pode reduzir
  assert.equal(review([harder], att('advance')).ok, true);     // evoluir: pode
  assert.equal(review([harder], null).ok, true);               // sem veredito (versão antiga): como antes
});

test('troca de exercício: declarada mais fácil passa no recomeço; sem declarar conta como mais difícil', () => {
  const swap = d => ({ id: 's', type: 'swap-exercise', target: { routineId: 'r1', exId: '0001' }, after: { id: '0009' }, ...(d ? { direction: d } : {}), why: 'x' });
  assert.equal(review([swap('easier')], att('reset')).ok, true);
  assert.equal(review([swap()], att('reset')).ok, false);
  assert.equal(review([swap('same')], att('hold')).ok, true);
  assert.equal(review([swap('harder')], att('hold')).ok, false);
});

test('evoluir é aos poucos: no máximo três mudanças mais difíceis por revisão', () => {
  const adds = ['0009', '0043', '0044', '0045'].map((id, i) => ({ id: 'n' + i, type: 'add-exercise', target: { routineId: 'r1' }, after: { id, sets: 3, reps: 10 }, why: 'x' }));
  const r = review(adds, att('advance'));
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /aos poucos/);
  assert.deepEqual(gateErrors(att('advance'), []), []);
});

test('a proposta aceita carrega o veredito, e o payload do review traz a frequência calculada no servidor', () => {
  const r = review([easier], att('hold'));
  assert.deepEqual(r.proposal.attendance, { verdict: 'hold', reason: 'low-attendance' });
  assert.equal(r.proposal.changes[0].direction, 'easier');
  const S = { unit: 'kg', week: { 1: ['r1'], 3: ['r1'], 5: ['r1'] }, routines: [{ id: 'r1', name: 'A', ex: [{ id: '0001', sets: 3, reps: 10 }] }], workouts: [], coach: { profile: { goal: 'muscle', daysPerWeek: 3 } } };
  const p = build(S, { handle: 'h'.repeat(16), kind: 'review', now: Date.parse(TODAY + 'T12:00:00Z') });
  assert.equal(p.attendance.verdict, 'hold'); assert.equal(p.attendance.reason, 'no-history'); assert.equal(p.attendance.targetPerWeek, 3);
});
