/* Ponto de entrada do CorpoFit AI SaaS dentro da API do openGym.
 *
 * Só é carregado com SAAS_MODE=1 (server.js importa este módulo sob demanda). Sem a variável, a API
 * é o openGym de sempre, sem Postgres e sem nada disto. O que ele acrescenta:
 *   - planos, assinatura e cobrança recorrente via Asaas (cartão, Pix Automático, Pix mensal);
 *   - webhook idempotente do Asaas e painel financeiro;
 *   - a CorpoFit AI = o Coach do openGym, com chave da plataforma e limites por plano.
 * Contas, senhas e o histórico de treino continuam sendo do openGym (db.json e state-<uid>.json). */
import { env } from './env.js';
import { db } from './db.js';
import { saasRoutes } from './routes.js';
import { bootstrapCoach, createAiGate, JOB_ROUTES } from './ai.js';
import { aiContextFor } from './org/ai.js';
import { eraseUserData } from './org/lgpd.js';
import { SaasError, logError } from './errors.js';
import { AsaasClient } from './asaas/client.js';
import { asaasConfigured } from './asaas/config.js';
import { cancelSubscription } from './asaas/cancel.js';
import { PLANS } from './plans.js';
import { sendMail } from './mailer.js';
import { markVerifiedByProvider } from './org/verify.js';
import { runReviewNotices } from './org/review-notices.js';

export async function createSaas({ json, readBody, readSession, requireAdmin, findUser, cfgStore, jobs, asaasClient, readState }) {
  if (!env().DATABASE_URL) throw new Error('SAAS_MODE=1 exige DATABASE_URL (PostgreSQL).');
  // Falha cedo e com uma frase clara se o banco não responde, em vez de 500 na primeira compra.
  await db.$queryRaw`SELECT 1`;

  // As linhas de Plan são espelho de plans.js (fonte da verdade); a assinatura aponta para elas.
  for (const p of Object.values(PLANS)) {
    const data = { name: p.name, priceCents: p.priceCents, cycle: p.cycle, aiMessagesPerMonth: p.limits.aiMessagesPerMonth, features: p.features };
    await db.plan.upsert({ where: { code: p.code }, create: { code: p.code, ...data }, update: data });
  }

  const aiGate = createAiGate();
  const ensureAi = () => bootstrapCoach({ cfgStore });
  const ai = ensureAi();
  if (!ai.configured) console.warn(`[saas] CorpoFit AI desligada: ${ai.reason}`);
  else console.log(`[saas] CorpoFit AI: ${ai.provider} · ${ai.model}`);
  jobs.setContextHook?.(uid => aiContextFor(uid));
  jobs.setUsageHook(ev => aiGate.onJobFinished(ev).catch(err => logError(db, 'ai-usage', err)));

  // O corpo é lido uma vez e reaproveitado: o gate precisa do tamanho da mensagem antes de o Coach lê-la.
  const cachedBody = req => req.__saasBody || (req.__saasBody = readBody(req));

  const routes = saasRoutes({ json, readBody: cachedBody, readSession, requireAdmin, findUser, aiGate, asaasClient, readState });

  /** Envolve as rotas que geram custo de IA com a checagem do plano. As demais passam intactas. */
  function wrapCoach(coachRoutes) {
    const out = { ...coachRoutes };
    for (const key of JOB_ROUTES) {
      const original = coachRoutes[key];
      if (!original) continue;
      out[key] = async (req, res) => {
        const user = readSession(req);
        if (user) {
          try {
            let body = {};
            try { body = await cachedBody(req); } catch { /* o handler original responde ao corpo inválido */ }
            await aiGate.check(user, body);
          } catch (e) {
            if (e instanceof SaasError) return json(res, e.status, { error: e.message, code: e.code });
            throw e;
          }
        }
        return original(req, res);
      };
    }
    return out;
  }

  /**
   * Conta encerrada ou apagada: cancela a assinatura no Asaas (melhor esforço) e anonimiza o espelho.
   * Cobranças e assinaturas permanecem, sem dados pessoais (obrigação fiscal/legal).
   */
  async function onUserDeleted(uid) {
    try {
      const mirror = await db.user.findUnique({ where: { id: uid } });
      if (!mirror) return;
      if (asaasConfigured() || asaasClient) {
        await cancelSubscription(asaasClient || AsaasClient.fromEnv(), uid).catch(() => undefined);
      }
      // Assinaturas de academias que esta pessoa pagava: cancela no Asaas (a academia volta ao plano grátis ao fim do período).
      if (asaasConfigured() || asaasClient) {
        const tenantSubs = await db.subscription.findMany({ where: { userId: uid, tenantId: { not: null }, status: { in: ['PENDING', 'ACTIVE', 'PAST_DUE'] } }, select: { tenantId: true }, distinct: ['tenantId'] });
        for (const t of tenantSubs) await cancelSubscription(asaasClient || AsaasClient.fromEnv(), uid, new Date(), t.tenantId).catch(() => undefined);
      }
      // Academias, personal, privacidade e biblioteca: elimina os dados dela (LGPD). Falha não impede o resto.
      try { await eraseUserData(uid); } catch (err) { await logError(db, 'user-erase', err); }
      await db.user.update({
        where: { id: uid },
        data: { name: 'Usuário removido', email: null, deletedAt: new Date(), manualPremium: false, manualPremiumUntil: null }
      });
      await db.usageRecord.deleteMany({ where: { userId: uid } });
    } catch (err) {
      await logError(db, 'user-deleted', err);
    }
  }

  /** Entrada pelo Google (e-mail verificado pelo provedor): marca como confirmado e vincula matrículas e convites. */
  const onGoogleSignIn = user => markVerifiedByProvider(user).catch(err => logError(db, 'google-verify', err));

  /** Aviso no app para um usuário (deduplicado pela chave). Devolve true se criou um aviso novo. */
  const notifyUser = async (user, n) => {
    try {
      await ensureUser({ id: user.id, name: user.name, email: user.email });
      const r = await db.notification.createMany({ data: [{ userId: user.id, kind: String(n.kind).slice(0, 40), title: String(n.title).slice(0, 120), body: String(n.body || '').slice(0, 300), link: String(n.link || '').slice(0, 120), dedupeKey: String(n.dedupeKey).slice(0, 160) }], skipDuplicates: true });
      return r.count > 0;
    } catch (err) { await logError(db, 'notify-user', err); return false; }
  };

  /** Tarefas diárias do SaaS (chamadas pelo cron): avisos de ficha a vencer e vencida. Falha não derruba o cron. */
  const dailyJobs = () => runReviewNotices().catch(err => logError(db, 'review-notices', err));

  return { routes, wrapCoach, cachedBody, onUserDeleted, aiGate, ai, ensureAi, sendMail, onGoogleSignIn, dailyJobs, notifyUser };
}
