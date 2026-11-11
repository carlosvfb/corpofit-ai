/* Prazo da ficha: o personal define até quando o treino enviado vale. Três dias antes e quando vence, o personal e o aluno
   recebem um aviso no app (uma vez por versão do treino). Roda no cron diário. Quem estiver com o vínculo encerrado ou a
   ficha arquivada/recusada não recebe nada. Escreve direto (sem contexto de usuário): é uma tarefa do sistema. */
import { db } from '../db.js';

const DAY = 86_400_000;
export const SOON_DAYS = 3;

/** Estado do prazo de uma ficha: 'expired', 'soon' ou 'ok' (sem prazo = null). Puro, para o painel e o aviso concordarem. */
export function reviewState(reviewAt, now = new Date()) {
  if (!reviewAt) return null;
  const ms = new Date(reviewAt).getTime() - now.getTime();
  return ms <= 0 ? 'expired' : ms <= SOON_DAYS * DAY ? 'soon' : 'ok';
}

const fmt = d => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: process.env.APP_TZ || 'America/Sao_Paulo' });

export async function runReviewNotices(now = new Date()) {
  const rows = await db.assignment.findMany({
    where: { kind: 'ASSIGNMENT', status: { in: ['ASSIGNED', 'IMPORTED'] }, reviewAt: { not: null, lte: new Date(now.getTime() + SOON_DAYS * DAY) }, link: { status: 'ACTIVE' } },
    take: 2000
  });
  if (!rows.length) return { notified: 0 };
  const people = await db.user.findMany({ where: { id: { in: [...new Set(rows.flatMap(r => [r.trainerId, r.studentId]))] } }, select: { id: true, name: true } });
  const name = id => people.find(p => p.id === id)?.name || 'o aluno';
  const data = [];
  for (const a of rows) {
    const st = reviewState(a.reviewAt, now);
    if (st !== 'soon' && st !== 'expired') continue;
    const when = fmt(a.reviewAt);
    const key = `review-${st}:${a.id}:${a.revision}`;
    if (st === 'soon') {
      data.push({ userId: a.trainerId, kind: 'review', title: `A ficha de ${name(a.studentId)} vence em ${when}`, body: `“${a.title}”: monte a próxima para não deixar o aluno sem treino novo.`, link: '/personal', dedupeKey: key + ':t' });
      data.push({ userId: a.studentId, kind: 'review', title: `Seu treino “${a.title}” vai ser revisado em ${when}`, body: 'Continue treinando: seu personal prepara o próximo.', link: '/meu-personal', dedupeKey: key + ':s' });
    } else {
      data.push({ userId: a.trainerId, kind: 'review', title: `A ficha de ${name(a.studentId)} venceu em ${when}`, body: `“${a.title}”: hora de revisar e enviar o próximo treino.`, link: '/personal', dedupeKey: key + ':t' });
      data.push({ userId: a.studentId, kind: 'review', title: `Seu treino “${a.title}” venceu`, body: 'Avise seu personal ou aguarde a nova ficha.', link: '/meu-personal', dedupeKey: key + ':s' });
    }
  }
  const r = await db.notification.createMany({ data: data.map(d => ({ ...d, title: d.title.slice(0, 120), body: d.body.slice(0, 300) })), skipDuplicates: true });
  return { notified: r.count };
}
