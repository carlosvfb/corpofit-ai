/* Aviso de evolução do treino. Uma vez por dia (no cron), olha a frequência de quem usa a IA e, quando o veredito é
   EVOLUIR ou RECOMEÇAR (attendance.js), avisa: no app (notificação) e, se o aparelho aceita, por push. "Manter" nunca avisa:
   uma notificação que existe para dizer "nada mudou" é como se ensina alguém a desligar as notificações.
   Um aviso por episódio: a chave inclui a fase e o dia da última evolução (evoluir) ou do último treino (recomeçar), então o
   mesmo estado não repete e um novo (depois de evoluir, ou de voltar e sumir de novo) avisa outra vez. */
import { attendanceFor } from './core/attendance.js';

const PT = {
  advance: { title: 'Seu treino pode evoluir', body: 'Você treinou com regularidade. Peça à IA para deixar o treino um pouco mais difícil.' },
  reset: { title: 'Hora de recomeçar mais leve', body: 'Faz semanas que você não treina. A IA monta uma volta mais leve para você refazer o treino.' }
};
const EN = {
  advance: { title: 'Your training is ready to level up', body: 'You have been training consistently. Ask the Coach to make it a little harder.' },
  reset: { title: 'Time to restart lighter', body: 'It has been weeks since your last workout. The Coach can build an easier way back in.' }
};

/** O aviso que este estado merece, ou null. Puro. */
export function evolutionNotice(S, today) {
  const coach = S?.coach;
  if (!coach?.consent?.agreedAt) return null;
  if (!(S.routines || []).some(r => r && (r.ex || []).length)) return null;
  const a = attendanceFor(S, today);
  if (a.verdict !== 'advance' && a.verdict !== 'reset') return null;
  const lang = String(S.lang || 'pt').toLowerCase().startsWith('pt') ? PT : EN;
  const level = coach.phase?.level || 1;
  const episode = a.verdict === 'advance' ? `${level}:${coach.phase?.lastAdvanceOn || '-'}` : `${level}:${a.lastWorkoutDay}`;
  return { verdict: a.verdict, key: `evo-${a.verdict}:${episode}`, ...lang[a.verdict], reasons: a.reasons };
}

/**
 * @param {{ users(): {id:string,name?:string,email?:string}[], skip?(uid:string):boolean, readState(uid:string):object|null,
 *   notify?(user:object, n:object):any, push?(uid:string, payload:object):any, today?:string }} deps
 */
export async function evolutionOnce(deps) {
  const today = deps.today || new Date().toISOString().slice(0, 10);
  let sent = 0;
  for (const user of deps.users()) {
    try {
      if (deps.skip?.(user.id)) continue;
      const n = evolutionNotice(deps.readState(user.id), today);
      if (!n) continue;
      const made = await deps.notify?.(user, { kind: 'evolution', title: n.title, body: n.body, link: '/coach', dedupeKey: n.key });
      // O push só sai quando o aviso é novo (a notificação deduplica por chave e responde true se criou); sem notificação, sem push, para não repetir todo dia.
      if (made === true) deps.push?.(user.id, { title: n.title, body: n.body, tag: 'evolution' });
      if (made === true) sent++;
    } catch { /* um perfil com problema não impede os outros */ }
  }
  return { sent };
}
