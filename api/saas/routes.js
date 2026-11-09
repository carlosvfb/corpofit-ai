/* HTTP do CorpoFit AI SaaS: planos, assinatura, checkout, webhook do Asaas e painel financeiro.
   Recebe os mesmos helpers que o Coach (closures sobre o db.json e o segredo da sessão) em vez de
   importar server.js, para não haver ciclo e para os testes usarem falsos. */
import { createWindow } from '../rate-limit.js';
import { scoped, limiterCodec } from '../store/ephemeral.js';
import { env } from './env.js';
import { brand } from './brand.js';
import { publicPlans } from './plans.js';
import { ensureUser, getEntitlements } from './access.js';
import { db } from './db.js';
import { SaasError, logError } from './errors.js';
import { getBillingOverview, availablePaymentMethods } from './billing.js';
import { AsaasClient } from './asaas/client.js';
import { asaasConfigured } from './asaas/config.js';
import { AsaasCheckoutService, BillingError } from './asaas/checkout.js';
import { cancelSubscription } from './asaas/cancel.js';
import { AsaasWebhookService, WebhookValidationError, verifyWebhookToken } from './asaas/webhook.js';
import { PrismaBillingRepository } from './asaas/repository.js';
import * as admin from './admin.js';
import * as org from './org/service.js';
import * as trainers from './org/trainers.js';
import * as privacy from './org/privacy.js';
import * as orgAi from './org/ai.js';
import * as community from './org/community.js';
import * as orgBilling from './org/billing.js';

const METHODS = new Set(['CREDIT_CARD', 'PIX_AUTOMATIC', 'PIX']);

export function saasRoutes({ json, readBody, readSession, requireAdmin, findUser, aiGate, asaasClient, readState }) {
  const client = () => asaasClient || AsaasClient.fromEnv();
  // Em modo Vercel o estado dos limites atravessa requisições e instâncias (store/ephemeral.js).
  const checkoutWindow = scoped('saas:checkout', () => createWindow({ max: 6, windowMs: 10 * 60_000 }), limiterCodec);
  const cancelWindow = scoped('saas:cancel', () => createWindow({ max: 5, windowMs: 10 * 60_000 }), limiterCodec);
  const pixWindow = scoped('saas:pix', () => createWindow({ max: 20, windowMs: 10 * 60_000 }), limiterCodec);

  /** Converte erros conhecidos em respostas; o resto vira 500 genérico (o detalhe vai para o ErrorLog). */
  const guarded = fn => async (req, res) => {
    try {
      return await fn(req, res);
    } catch (e) {
      if (e instanceof SaasError || e instanceof BillingError) {
        return json(res, e.status, { error: e.message, ...(e.code ? { code: e.code } : {}) });
      }
      throw e;
    }
  };
  const session = (req, res) => {
    const user = readSession(req);
    if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
    return user;
  };
  const throttled = (win, res, user) => {
    const wait = win.take(user.id);
    if (wait) { json(res, 429, { error: 'Muitas tentativas. Aguarde alguns instantes.' }, { 'Retry-After': String(wait) }); return true; }
    return false;
  };
  const toPublic = u => ({ id: u.id, name: u.name, email: u.email || null });
  /** O tenant pedido: ?tenant= na query. Vazio ou fora do formato vira 404 antes de tocar o banco. */
  const tenantOf = req => {
    const id = new URL(req.url, 'http://x').searchParams.get('tenant') || '';
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new SaasError(404, 'Academia não encontrada.', 'not-found');
    return id;
  };

  return {
    /* ------------------------------ público ------------------------------ */

    // Planos e preços, para a página pública. Só o que o app pode mostrar.
    'GET /api/saas/plans': guarded(async (req, res) => {
      const e = env();
      json(res, 200, {
        brand: { name: brand.name, aiName: brand.aiName },
        plans: publicPlans(),
        payments: asaasConfigured(),
        supportEmail: e.SUPPORT_EMAIL,
        sourceCodeUrl: e.SOURCE_CODE_URL || null
      });
    }),

    /* ------------------------------ usuário ------------------------------ */

    'GET /api/billing/status': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      await ensureUser(user);
      json(res, 200, await getBillingOverview(user));
    }),

    // Só `method` e `cpfCnpj` são aceitos: plano, preço e IDs externos são decididos aqui.
    'POST /api/billing/checkout': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      if (throttled(checkoutWindow, res, user)) return;
      const body = await readBody(req);
      const method = typeof body.method === 'string' ? body.method : '';
      const cpfCnpj = typeof body.cpfCnpj === 'string' ? body.cpfCnpj.slice(0, 20) : '';
      if (!METHODS.has(method)) throw new SaasError(400, 'Escolha uma forma de pagamento.');
      if (!asaasConfigured()) throw new SaasError(503, 'Pagamentos ainda não configurados.');
      try {
        const result = await new AsaasCheckoutService(client()).start(user, { method, cpfCnpj });
        json(res, 201, result);
      } catch (e) {
        if (!(e instanceof BillingError || e instanceof SaasError)) await logError(db, 'checkout', e);
        throw e;
      }
    }),

    /* ------------------- academias (multi-tenant) -------------------
       O identificador da academia vai na query (?tenant=) ou no corpo; a rota nunca confia nele: o
       papel do usuário no vínculo é verificado em org/service.js e o PostgreSQL aplica o RLS. */
    'GET /api/orgs': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await org.myContexts(user));
    }),
    'POST /api/orgs': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 201, await org.createGym(user, await readBody(req)));
    }),
    'GET /api/orgs/settings': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await org.getSettings(user, tenantOf(req)));
    }),
    'PUT /api/orgs/settings': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await org.updateSettings(user, tenantOf(req), await readBody(req)));
    }),
    'GET /api/orgs/dashboard': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await org.dashboard(user, tenantOf(req)));
    }),
    'GET /api/orgs/activity': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await org.recentActivity(user, tenantOf(req), new URL(req.url, 'http://x').searchParams.get('limit')));
    }),
    'GET /api/orgs/members': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await org.listMembers(user, tenantOf(req)));
    }),
    'POST /api/orgs/members': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 201, await org.inviteMember(user, tenantOf(req), await readBody(req)));
    }),
    'PUT /api/orgs/members': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const b = await readBody(req);
      json(res, 200, await org.updateMemberRole(user, tenantOf(req), b.userId, b.role));
    }),
    'DELETE /api/orgs/members': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await org.removeMember(user, tenantOf(req), new URL(req.url, 'http://x').searchParams.get('user')));
    }),
    'POST /api/orgs/accept': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await org.acceptInvite(user, tenantOf(req)));
    }),
    'POST /api/orgs/leave': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await org.leaveGym(user, tenantOf(req)));
    }),

    /* ------------------- personal trainers ------------------- */
    'GET /api/trainer/profile': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const id = new URL(req.url, 'http://x').searchParams.get('user');
      json(res, 200, { profile: await trainers.getProfile(user, id || user.id) });
    }),
    'PUT /api/trainer/profile': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, { profile: await trainers.saveProfile(user, await readBody(req)) });
    }),
    'GET /api/trainer/links': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await trainers.listLinks(user));
    }),
    'POST /api/trainer/links': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const b = await readBody(req);
      const fn = b.as === 'student' ? trainers.requestTrainer : trainers.inviteStudent;
      json(res, 201, await fn(user, { email: b.email, tenantId: typeof b.tenantId === 'string' ? b.tenantId : undefined }));
    }),
    'PUT /api/trainer/links': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const b = await readBody(req);
      json(res, 200, await trainers.respondLink(user, b.id, b.accept === true));
    }),
    'DELETE /api/trainer/links': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await trainers.endLink(user, new URL(req.url, 'http://x').searchParams.get('id')));
    }),
    'GET /api/trainer/assignments': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const u = new URL(req.url, 'http://x').searchParams;
      json(res, 200, u.get('history') ? await trainers.assignmentHistory(user, u.get('history')) : await trainers.listAssignments(user, u.get('link')));
    }),
    'POST /api/trainer/assignments': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const b = await readBody(req);
      json(res, 201, await trainers.assign(user, b.linkId, b));
    }),
    'PUT /api/trainer/assignments': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const b = await readBody(req);
      json(res, 200, b.status ? await trainers.answerAssignment(user, b.id, b.status) : await trainers.updateAssignment(user, b.id, b));
    }),
    'GET /api/trainer/comments': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await trainers.listComments(user, new URL(req.url, 'http://x').searchParams.get('assignment')));
    }),
    'POST /api/trainer/comments': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const b = await readBody(req);
      json(res, 201, await trainers.addComment(user, b.assignmentId, b.body));
    }),

    /* ------------------- privacidade e compartilhamento ------------------- */
    'GET /api/privacy/categories': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, privacy.categories());
    }),
    'GET /api/privacy/permissions': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await privacy.myPermissions(user));
    }),
    'PUT /api/privacy/permissions': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const b = await readBody(req);
      json(res, 200, await privacy.setPermission(user, b.trainerId, b.category, b.level));
    }),
    'POST /api/privacy/revoke': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const b = await readBody(req);
      json(res, 200, await privacy.revokeAll(user, b.trainerId));
    }),
    'GET /api/privacy/history': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await privacy.consentHistory(user, new URL(req.url, 'http://x').searchParams.get('trainer')));
    }),
    'GET /api/privacy/access-log': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await privacy.accessLog(user));
    }),
    'GET /api/trainer/shared': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await privacy.sharedWithMe(user));
    }),
    'GET /api/trainer/student': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const u = new URL(req.url, 'http://x').searchParams;
      json(res, 200, await privacy.studentData(user, u.get('link'), u.get('category'), async id => readState(id)));
    }),

    /* ------------------- IA por academia ------------------- */
    'GET /api/orgs/ai-context': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await orgAi.getAiContext(user));
    }),
    'PUT /api/orgs/ai-context': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const b = await readBody(req);
      json(res, 200, await orgAi.setAiContext(user, b.tenantId ?? null));
    }),
    'GET /api/orgs/ai-usage': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await orgAi.tenantAiUsage(user, new URL(req.url, 'http://x').searchParams.get('tenant')));
    }),

    /* ------------------- biblioteca comunitária ------------------- */
    'GET /api/community/items': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const u = new URL(req.url, 'http://x').searchParams;
      json(res, 200, await community.list(user, { kind: u.get('kind') || undefined, q: u.get('q') || '', scope: u.get('scope') === 'gym' ? 'gym' : 'public', tenantId: u.get('tenant') || undefined, favorites: u.get('favorites') === '1', mine: u.get('mine') === '1', limit: u.get('limit'), offset: u.get('offset') }));
    }),
    'POST /api/community/items': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 201, await community.publish(user, await readBody(req)));
    }),
    'GET /api/community/item': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await community.get(user, new URL(req.url, 'http://x').searchParams.get('id')));
    }),
    'DELETE /api/community/items': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await community.removeOwn(user, new URL(req.url, 'http://x').searchParams.get('id')));
    }),
    'POST /api/community/favorite': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const b = await readBody(req);
      json(res, 200, await community.favorite(user, b.id, b.on !== false));
    }),
    'POST /api/community/import': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const b = await readBody(req);
      json(res, 200, await community.importItem(user, b.id));
    }),
    'POST /api/community/report': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const b = await readBody(req);
      json(res, 201, await community.report(user, b.id, b.reason, b.note));
    }),
    'GET /api/community/moderation': guarded(async (req, res) => {
      const u = new URL(req.url, 'http://x').searchParams;
      const platform = u.get('scope') === 'platform';
      const actor = platform ? requireAdmin(req, res) : session(req, res);
      if (!actor) return;
      json(res, 200, await community.moderationQueue(actor, { platform, tenantId: u.get('tenant') || undefined }));
    }),
    'POST /api/community/moderate': guarded(async (req, res) => {
      const b = await readBody(req);
      const platform = b.scope === 'platform';
      const actor = platform ? requireAdmin(req, res) : session(req, res);
      if (!actor) return;
      json(res, 200, await community.moderate(actor, b.id, b.action, { platform, tenantId: b.tenantId }));
    }),

    /* ------------------- plano e cobrança da academia ------------------- */
    'GET /api/orgs/plans': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const { publicGymPlans } = await import('./org/gym-plans.js');
      json(res, 200, publicGymPlans());
    }),
    'GET /api/orgs/billing': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await orgBilling.overview(user, tenantOf(req)));
    }),
    'POST /api/orgs/billing/checkout': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      if (throttled(checkoutWindow, res, user)) return;
      const b = await readBody(req);
      try {
        json(res, 201, await orgBilling.startCheckout(user, tenantOf(req), { planCode: typeof b.planCode === 'string' ? b.planCode : '', method: typeof b.method === 'string' ? b.method : '', cpfCnpj: typeof b.cpfCnpj === 'string' ? b.cpfCnpj.slice(0, 20) : '' }, client()));
      } catch (e) {
        if (!(e instanceof BillingError || e instanceof SaasError)) await logError(db, 'org-checkout', e);
        throw e;
      }
    }),
    'POST /api/orgs/billing/cancel': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      if (throttled(cancelWindow, res, user)) return;
      json(res, 200, { status: (await orgBilling.cancel(user, tenantOf(req), client())).status });
    }),

    'POST /api/billing/cancel': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      if (throttled(cancelWindow, res, user)) return;
      if (!asaasConfigured()) throw new SaasError(503, 'Pagamentos ainda não configurados.');
      try {
        const sub = await cancelSubscription(client(), user.id);
        json(res, 200, { ok: true, status: sub.status, accessUntil: sub.currentPeriodEnd });
      } catch (e) {
        if (!(e instanceof BillingError || e instanceof SaasError)) await logError(db, 'cancel', e);
        throw e;
      }
    }),

    // QR Code Pix atual de uma cobrança pendente do PRÓPRIO usuário (ciclos seguintes do Pix mensal).
    'POST /api/billing/pix': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      if (throttled(pixWindow, res, user)) return;
      const body = await readBody(req);
      const paymentId = typeof body.paymentId === 'string' ? body.paymentId.slice(0, 40) : '';
      const payment = paymentId ? await db.payment.findFirst({ where: { id: paymentId, userId: user.id } }) : null;
      if (!payment) throw new SaasError(404, 'Cobrança não encontrada.');
      if (payment.method !== 'PIX' || (payment.status !== 'PENDING' && payment.status !== 'OVERDUE')) {
        throw new SaasError(400, 'Esta cobrança não aceita pagamento por Pix.');
      }
      if (!asaasConfigured()) throw new SaasError(503, 'Pagamentos ainda não configurados.');
      const qr = await client().getPixQrCode(payment.asaasPaymentId);
      await db.payment.update({
        where: { id: payment.id },
        data: { pixPayload: qr.payload, pixExpiresAt: qr.expirationDate ? new Date(qr.expirationDate) : null }
      });
      json(res, 200, { payload: qr.payload, image: qr.encodedImage, expiresAt: qr.expirationDate ?? null, dueDate: payment.dueDate });
    }),

    // Plano e consumo de IA do mês (mostrado no chat).
    'GET /api/saas/ai': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await aiGate.summary(user));
    }),

    // Formas de pagamento disponíveis agora (o app não mostra as indisponíveis).
    'GET /api/billing/methods': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, { methods: await availablePaymentMethods(), plan: (await getEntitlements(user)).planCode });
    }),

    /* ------------------------------ webhook ------------------------------ */

    // Autenticado pelo token no header `asaas-access-token`. 200 só depois de gravar/processar;
    // erro temporário devolve 500 para o Asaas reenviar. Idempotente por ID de evento.
    'POST /api/webhooks/asaas': async (req, res) => {
      if (!verifyWebhookToken(req.headers['asaas-access-token'] || null, env().ASAAS_WEBHOOK_TOKEN)) {
        return json(res, 401, { error: 'unauthorized' });
      }
      let payload;
      try { payload = await readBody(req); } catch { return json(res, 400, { error: 'invalid_json' }); }
      try {
        const service = new AsaasWebhookService(new PrismaBillingRepository(), client());
        const result = await service.handle(payload);
        json(res, 200, { received: true, outcome: result.outcome });
      } catch (e) {
        if (e instanceof WebhookValidationError) return json(res, 400, { error: 'invalid_event' });
        await logError(db, 'webhook:asaas', e);
        json(res, 500, { error: 'processing_failed' });
      }
    },

    /* ------------------------------ admin ------------------------------ */

    'GET /api/admin/saas/overview': guarded(async (req, res) => {
      if (!requireAdmin(req, res)) return;
      json(res, 200, { overview: await admin.adminOverview(), settings: await admin.getSettings() });
    }),
    'GET /api/admin/saas/finance': guarded(async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const [subscriptions, payments, events, errors, premium, audit, aiUsage] = await Promise.all([
        admin.listSubscriptions(), admin.listPayments(), admin.listEvents(), admin.listErrors(),
        admin.listPremiumUsers(), admin.listAudit(), admin.aiUsageByUser()
      ]);
      json(res, 200, { subscriptions, payments, events, errors, premium, audit, aiUsage });
    }),
    'POST /api/admin/saas/premium': guarded(async (req, res) => {
      const actor = requireAdmin(req, res); if (!actor) return;
      const body = await readBody(req);
      const target = findUser(typeof body.userId === 'string' ? body.userId : '');
      if (!target) throw new SaasError(404, 'Usuário não encontrado.');
      const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '';
      if (reason.length < 3) throw new SaasError(400, 'Informe o motivo (obrigatório para a auditoria).');
      if (body.action === 'grant') {
        const days = body.days == null || body.days === '' ? null : Number(body.days);
        if (days !== null && (!Number.isInteger(days) || days < 1 || days > 3650)) throw new SaasError(400, 'Dias inválidos.');
        await admin.grantPremium(toPublic(actor), toPublic(target), days, reason);
      } else if (body.action === 'revoke') {
        await admin.revokePremium(toPublic(actor), toPublic(target), reason);
      } else throw new SaasError(400, 'Ação inválida.');
      json(res, 200, { ok: true });
    }),
    'POST /api/admin/saas/settings': guarded(async (req, res) => {
      const actor = requireAdmin(req, res); if (!actor) return;
      const body = await readBody(req);
      const patch = {};
      if (body.graceDays !== undefined) patch.graceDays = Number(body.graceDays);
      if (body.pixAutomaticEnabled !== undefined) patch.pixAutomaticEnabled = body.pixAutomaticEnabled === true;
      await admin.updateSettings(toPublic(actor), patch);
      json(res, 200, { ok: true, settings: await admin.getSettings() });
    }),
    'POST /api/admin/saas/reconcile': guarded(async (req, res) => {
      const actor = requireAdmin(req, res); if (!actor) return;
      const body = await readBody(req);
      if (typeof body.subscriptionId !== 'string') throw new SaasError(400, 'Assinatura inválida.');
      if (!asaasConfigured()) throw new SaasError(503, 'Pagamentos ainda não configurados.');
      json(res, 200, await admin.reconcileSubscription(toPublic(actor), body.subscriptionId, { client: client() }));
    })
  };
}
