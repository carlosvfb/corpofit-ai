/* Frequência do aluno -> o que a IA pode fazer com o treino.
   Só a frequência decide se o treino pode ficar mais difícil. A IA escolhe QUAIS exercícios; este arquivo decide SE.
   Funções puras (sem relógio, arquivo ou rede): o servidor e o celular rodam o mesmo código, e o validador usa o
   veredito calculado no servidor a partir do histórico, nunca algo que o modelo diga.

   Regras (todas ajustáveis em RULES):
   - Semana boa: o aluno treinou em pelo menos 80% dos dias que o plano pede (mínimo 1 dia).
   - EVOLUIR (advance): as últimas 2 semanas completas foram boas, a última sessão foi há no máximo 4 dias e a
     última evolução foi há pelo menos 3 semanas. Só então a IA pode propor algo mais difícil.
   - MANTER (hold): qualquer outra situação. Faltou, treinou pouco, está há 8 a 20 dias sem ir, ainda não tem
     histórico ou evoluiu há pouco. O treino fica igual até haver semanas boas de novo.
   - RECOMEÇAR (reset): 21 dias ou mais sem treinar. A IA só pode propor versões mais fáceis (volta uma fase) para
     o aluno refazer o treino; nada mais difícil. */

export const RULES = { goodShare: 0.8, goodWeeksToAdvance: 2, maxGapToAdvance: 4, holdGap: 8, resetGap: 21, weeksBetweenAdvances: 3, windowWeeks: 6 };

const DAY = 86_400_000;
const asDay = d => String(d).slice(0, 10);
const t = d => Date.parse(asDay(d) + 'T00:00:00Z');
const iso = ms => new Date(ms).toISOString().slice(0, 10);
const mondayOf = ms => { const d = new Date(ms); return ms - ((d.getUTCDay() + 6) % 7) * DAY; };

/**
 * @param {object} o
 * @param {string[]} o.workoutDays        dias (AAAA-MM-DD) em que treinou
 * @param {number}   o.targetPerWeek      dias por semana que o plano pede
 * @param {string}   o.today              AAAA-MM-DD
 * @param {string|null} [o.lastAdvanceOn] dia da última evolução aplicada
 * @returns {{ verdict:'advance'|'hold'|'reset', reason:string, reasons:string[], goodWeeks:number, gapDays:number|null,
 *   lastWorkoutDay:string|null, targetPerWeek:number, weeksSinceAdvance:number|null, perWeek:{weekStart:string,days:number,good:boolean}[] }}
 */
export function attendance({ workoutDays = [], targetPerWeek = 3, today, lastAdvanceOn = null, rules = RULES } = {}) {
  const r = { ...RULES, ...rules };
  const now = t(today);
  const target = Math.max(1, Math.min(7, Math.round(Number(targetPerWeek)) || 3));
  const need = Math.max(1, Math.ceil(target * r.goodShare));
  const days = [...new Set((Array.isArray(workoutDays) ? workoutDays : []).map(asDay).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d) && t(d) <= now))].sort();
  const last = days.at(-1) || null;
  const gapDays = last ? Math.floor((now - t(last)) / DAY) : null;

  // Semanas completas (segunda a domingo) anteriores à atual, da mais antiga para a mais recente.
  const thisMonday = mondayOf(now);
  const perWeek = [];
  for (let i = r.windowWeeks; i >= 1; i--) {
    const start = thisMonday - i * 7 * DAY, end = start + 7 * DAY;
    const n = days.filter(d => t(d) >= start && t(d) < end).length;
    perWeek.push({ weekStart: iso(start), days: n, good: n >= need });
  }
  let goodWeeks = 0;
  for (let i = perWeek.length - 1; i >= 0 && perWeek[i].good; i--) goodWeeks++;
  const weeksSinceAdvance = lastAdvanceOn ? Math.floor((now - t(lastAdvanceOn)) / (7 * DAY)) : null;

  const base = { goodWeeks, gapDays, lastWorkoutDay: last, targetPerWeek: target, weeksSinceAdvance, perWeek };
  const out = (verdict, reason, reasons) => ({ verdict, reason, reasons, ...base });
  if (!last) return out('hold', 'no-history', ['Ainda não há treinos registrados: o treino fica como está até haver frequência.']);
  if (gapDays >= r.resetGap) return out('reset', 'long-absence', [`Está há ${gapDays} dias sem treinar: recomeçar numa fase mais leve.`]);
  if (gapDays >= r.holdGap) return out('hold', 'away', [`Está há ${gapDays} dias sem treinar: manter o treino até voltar com regularidade.`]);
  if (goodWeeks < r.goodWeeksToAdvance) return out('hold', 'low-attendance', [`${goodWeeks} semana(s) boa(s) seguida(s) (precisa de ${r.goodWeeksToAdvance}), com pelo menos ${need} treino(s) por semana: manter o treino.`]);
  if (gapDays > r.maxGapToAdvance) return out('hold', 'not-this-week', [`A última sessão foi há ${gapDays} dias: espere voltar a treinar esta semana para evoluir.`]);
  if (weeksSinceAdvance !== null && weeksSinceAdvance < r.weeksBetweenAdvances) return out('hold', 'too-soon', [`O treino evoluiu há ${weeksSinceAdvance} semana(s): espere ${r.weeksBetweenAdvances} para a próxima evolução.`]);
  return out('advance', 'consistent', [`${goodWeeks} semanas seguidas com pelo menos ${need} treino(s) por semana: pronto para evoluir.`]);
}

/** A mudança deixa o treino mais difícil, mais fácil ou igual? `declared` é o que o modelo disse (só vale para troca de exercício). */
export function directionOf(change, declared) {
  const { type, before, after } = change || {};
  const num = v => (Number.isFinite(Number(v)) ? Number(v) : null);
  const cmp = () => { const b = num(before), a = num(after); return a === null || b === null ? 'same' : a > b ? 'harder' : a < b ? 'easier' : 'same'; };
  switch (type) {
    case 'sets': case 'reps': case 'repsMin': case 'repsMax': case 'sec': case 'inc': return cmp();
    case 'add-exercise': return 'harder';
    case 'remove-exercise': return 'easier';
    case 'swap-exercise': return ['harder', 'easier', 'same'].includes(declared) ? declared : 'harder'; // sem declarar, trata como o pior caso
    case 'exercise-prog': case 'routine-prog': case 'programme': return 'harder';
    case 'cardio': return 'same';
    default: return 'same';
  }
}

/** Confere as mudanças propostas contra o veredito. Devolve os erros (para a rodada de correção) ou []. */
export function gateErrors(att, changes, MAX_HARDER = 3) {
  if (!att || !changes?.length) return [];
  const harder = changes.filter(c => c.direction === 'harder');
  if (att.verdict === 'advance') return harder.length > MAX_HARDER ? [`só ${MAX_HARDER} mudanças que deixam o treino mais difícil por revisão: o treino evolui aos poucos`] : [];
  const why = att.verdict === 'reset'
    ? `o aluno está há ${att.gapDays} dias sem treinar: ele recomeça, então proponha só versões mais fáceis ou igual (direction "easier" ou "same")`
    : `a frequência do aluno não permite evoluir agora (${att.reason}): mantenha os exercícios e as cargas, sem nada mais difícil`;
  return harder.map(c => `change "${c.id}" (${c.type}) deixa o treino mais difícil, mas ${why}`);
}
