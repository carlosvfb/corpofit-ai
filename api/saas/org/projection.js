/* O que um personal enxerga de cada categoria, a partir do documento de estado do aluno (o mesmo do app:
   `workouts[]` com `d`, `start`, `end` e `entries[].sets[]`; `bodyweight[]`; `measurements[]`; `routines[]`;
   `dayNotes`). Funções puras: recebem o estado e devolvem só o que a categoria permite. Nada de e-mail,
   credenciais, dados do Coach ou de outras categorias sai daqui. Campos desconhecidos são descartados. */

export const CATEGORIES = {
  WORKOUTS: { label: 'Treinos realizados', hint: 'Datas, duração e resumo de cada treino.', available: true },
  ROUTINES: { label: 'Rotinas', hint: 'Suas rotinas e planos. Com “sugerir”, o personal pode propor mudanças que você aprova.', available: true, suggest: true },
  EXERCISE_HISTORY: { label: 'Histórico de exercícios', hint: 'Séries, repetições e cargas de cada exercício.', available: true },
  BODY_WEIGHT: { label: 'Peso corporal', hint: 'Suas pesagens.', available: true },
  MEASUREMENTS: { label: 'Medidas corporais', hint: 'Suas medidas registradas.', available: true },
  NOTES: { label: 'Observações', hint: 'Anotações dos treinos e dos dias de descanso.', available: true },
  ACTIVITY: { label: 'Indicadores de atividade', hint: 'Frequência por semana e último treino, sem detalhes.', available: true },
  PHOTOS: { label: 'Fotos de evolução', hint: 'Ainda não pode ser compartilhada.', available: false },
  WELLBEING: { label: 'Bem-estar', hint: 'Ainda não pode ser compartilhado.', available: false }
};
export const AVAILABLE = Object.keys(CATEGORIES).filter(k => CATEGORIES[k].available);

const arr = v => (Array.isArray(v) ? v : []);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const num = v => (Number.isFinite(Number(v)) ? Number(v) : 0);
const str = (v, n = 200) => (typeof v === 'string' ? v.slice(0, n) : '');
const doneSet = s => s && typeof s === 'object' && (s.done === true || s.sides?.L?.done === true || s.sides?.R?.done === true);
const dayOf = w => (DAY.test(String(w?.d || '')) ? w.d : (Number.isFinite(Number(w?.start)) ? new Date(Number(w.start)).toISOString().slice(0, 10) : null));
const clip = (o, drop = k => k.startsWith('_')) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).filter(([k]) => !drop(k))) : o);
const workouts = S => arr(S?.workouts).filter(w => w && typeof w === 'object');

function isoWeek(day) {
  const d = new Date(day + 'T12:00:00Z');
  const dow = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dow); // segunda-feira
  return d.toISOString().slice(0, 10);
}

const PROJECTIONS = {
  WORKOUTS: S => workouts(S).slice(-120).map(w => ({
    day: dayOf(w), name: str(w.name || w.routineName, 80), start: num(w.start) || null, end: num(w.end) || null,
    exercises: arr(w.entries).length, sets: arr(w.entries).reduce((n, e) => n + arr(e?.sets).filter(doneSet).length, 0)
  })),
  EXERCISE_HISTORY: S => workouts(S).slice(-60).map(w => ({
    day: dayOf(w),
    entries: arr(w.entries).map(e => ({ exerciseId: str(e?.id, 30), sets: arr(e?.sets).filter(doneSet).map(s => ({ weight: num(s.w), reps: num(s.r), ...(s.type ? { type: str(s.type, 20) } : {}) })) })).filter(e => e.sets.length)
  })),
  ROUTINES: S => arr(S?.routines).slice(0, 60).map(r => clip(r)),
  BODY_WEIGHT: S => arr(S?.bodyweight).slice(-365).map(b => clip(b)),
  MEASUREMENTS: S => arr(S?.measurements).slice(-120).map(m => clip(m)),
  NOTES: S => ({
    workouts: workouts(S).filter(w => w.note || w.notes).slice(-60).map(w => ({ day: dayOf(w), note: str(w.note || w.notes, 1000) })),
    days: Object.entries(S?.dayNotes && typeof S.dayNotes === 'object' ? S.dayNotes : {}).filter(([d, n]) => DAY.test(d) && n && typeof n === 'object').slice(-120).map(([d, n]) => ({ day: d, tag: str(n.tag, 30), text: str(n.text, 500) }))
  }),
  ACTIVITY: S => {
    const days = workouts(S).map(dayOf).filter(Boolean).sort();
    const perWeek = {};
    for (const d of days) { const w = isoWeek(d); perWeek[w] = (perWeek[w] || 0) + 1; }
    const weeks = Object.keys(perWeek).sort().slice(-12);
    return { lastWorkoutDay: days.at(-1) || null, totalWorkouts: days.length, perWeek: weeks.map(w => ({ weekStart: w, workouts: perWeek[w] })) };
  }
};

/** A categoria projetada, ou lança se não for uma categoria disponível. */
export function project(category, S) {
  const fn = PROJECTIONS[category];
  if (!fn || !CATEGORIES[category]?.available) throw new Error('categoria indisponível');
  return fn(S && typeof S === 'object' ? S : {});
}
