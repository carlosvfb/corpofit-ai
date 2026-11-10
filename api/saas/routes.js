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
import * as schedule from './org/schedule.js';
import * as gymOps from './org/gym-ops.js';
import * as desk from './org/gym-desk.js';
import * as floor from './org/gym-floor.js';
import * as orgAi from './org/ai.js';
import * as community from './org/community.js';
import * as orgBilling from './org/billing.js';
import { exportMyData } from './org/lgpd.js';
import * as notif from './org/notify.js';
import * as emailVerify from './org/verify.js';
import { sendMail } from './mailer.js';
import { listGyms } from './org/admin-orgs.js';

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

    /* ------------------- gestão da academia: alunos, equipe, agenda e treinos ------------------- */
    'GET /api/orgs/roster': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await gymOps.roster(user, tenantOf(req)));
    }),
    'POST /api/orgs/assign-trainer': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const b = await readBody(req);
      json(res, 200, await gymOps.assignTrainer(user, tenantOf(req), { studentId: b.studentId, trainerId: b.trainerId || null }));
    }),
    'GET /api/orgs/schedule': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const u = new URL(req.url, 'http://x').searchParams;
      json(res, 200, await gymOps.gymSchedule(user, tenantOf(req), { from: u.get('from') || undefined, to: u.get('to') || undefined, trainerId: u.get('trainer') || undefined }));
    }),
    'GET /api/orgs/workouts': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await gymOps.gymWorkouts(user, tenantOf(req), new URL(req.url, 'http://x').searchParams.get('limit')));
    }),

    /* ------------------- recepção: matrícula, mensalidades, aparelhos e acesso ------------------- */
    'GET /api/my-gym': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await desk.myGym(user));
    }),
    'POST /api/my-gym/face-revoke': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await desk.revokeMyFace(user, tenantOf(req)));
    }),
    'GET /api/orgs/membership-plans': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await desk.listPlans(user, tenantOf(req)));
    }),
    'POST /api/orgs/membership-plans': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await desk.savePlan(user, tenantOf(req), await readBody(req)));
    }),
    'GET /api/orgs/students': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const u = new URL(req.url, 'http://x').searchParams;
      json(res, 200, await desk.listStudents(user, tenantOf(req), { q: u.get('q') || '', status: u.get('status') || '' }));
    }),
    'POST /api/orgs/students': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 201, await desk.enroll(user, tenantOf(req), await readBody(req)));
    }),
    'GET /api/orgs/student': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await desk.getStudent(user, tenantOf(req), new URL(req.url, 'http://x').searchParams.get('id')));
    }),
    'PUT /api/orgs/student': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const b = await readBody(req);
      json(res, 200, b.status ? await desk.setStudentStatus(user, tenantOf(req), b.id, b.status, b.reason) : await desk.updateStudent(user, tenantOf(req), b.id, b));
    }),
    'GET /api/orgs/charges': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const u = new URL(req.url, 'http://x').searchParams;
      json(res, 200, await desk.listCharges(user, tenantOf(req), { status: u.get('status') || '', month: u.get('month') || '', q: u.get('q') || '' }));
    }),
    'POST /api/orgs/charges': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const b = await readBody(req);
      if (b.action === 'pay') return json(res, 200, await desk.recordPayment(user, tenantOf(req), b.id, b));
      if (b.action === 'cancel') return json(res, 200, await desk.cancelCharge(user, tenantOf(req), b.id, b.reason));
      json(res, 200, await desk.generateCharges(user, tenantOf(req), b.month));
    }),
    'POST /api/orgs/student-face': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const b = await readBody(req);
      if (typeof b.image === 'string') {
        const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(b.image);
        if (!m) throw new SaasError(400, 'Envie uma foto JPEG, PNG ou WebP.', 'invalid-image');
        return json(res, 200, await desk.saveFacePhoto(user, tenantOf(req), b.id, Buffer.from(m[1], 'base64')));
      }
      json(res, 200, await desk.setFaceConsent(user, tenantOf(req), b.id, b.consent === true));
    }),
    'GET /api/orgs/student-face': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const f = await desk.readFacePhoto(user, tenantOf(req), new URL(req.url, 'http://x').searchParams.get('id'));
      res.writeHead(200, { 'Content-Type': f.mime, 'Content-Length': f.buf.length, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(f.buf);
    }),
    'GET /api/orgs/equipment': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await floor.listEquipment(user, tenantOf(req)));
    }),
    'POST /api/orgs/equipment': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await floor.saveEquipment(user, tenantOf(req), await readBody(req)));
    }),
    'DELETE /api/orgs/equipment': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await floor.deleteEquipment(user, tenantOf(req), new URL(req.url, 'http://x').searchParams.get('id')));
    }),
    'GET /api/orgs/devices': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await floor.listDevices(user, tenantOf(req)));
    }),
    'POST /api/orgs/devices': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const b = await readBody(req);
      json(res, b.id ? 200 : 201, b.id ? await floor.updateDevice(user, tenantOf(req), b.id, b) : await floor.createDevice(user, tenantOf(req), b.name));
    }),
    'DELETE /api/orgs/devices': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await floor.deleteDevice(user, tenantOf(req), new URL(req.url, 'http://x').searchParams.get('id')));
    }),
    'GET /api/orgs/access-events': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await floor.accessEvents(user, tenantOf(req), { limit: new URL(req.url, 'http://x').searchParams.get('limit') }));
    }),
    // Leitores e catracas: autenticam pelo token do leitor (Authorization: Bearer gd_...), nunca por cookie.
    'POST /api/access/check': guarded(async (req, res) => {
      json(res, 200, await floor.deviceCheck(req.headers.authorization, await readBody(req)));
    }),
    'GET /api/access/people': guarded(async (req, res) => {
      json(res, 200, await floor.devicePeople(req.headers.authorization));
    }),
    'GET /api/access/face': guarded(async (req, res) => {
      const f = await floor.deviceFace(req.headers.authorization, new URL(req.url, 'http://x').searchParams.get('number'));
      res.writeHead(200, { 'Content-Type': f.mime, 'Content-Length': f.buf.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(f.buf);
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

    /* ------------------- agenda, anotações e visão geral do personal ------------------- */
    'GET /api/trainer/overview': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await schedule.trainerOverview(user, async id => readState(id)));
    }),
    'GET /api/trainer/sessions': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const u = new URL(req.url, 'http://x').searchParams;
      json(res, 200, await schedule.listSessions(user, { from: u.get('from') || undefined, to: u.get('to') || undefined, linkId: u.get('link') || undefined }));
    }),
    'POST /api/trainer/sessions': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const b = await readBody(req);
      json(res, 201, await schedule.createSessions(user, b.linkId, b));
    }),
    'PUT /api/trainer/sessions': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const b = await readBody(req);
      if (b.action === 'confirm' || b.action === 'decline') return json(res, 200, await schedule.respondSession(user, b.id, b.action));
      if (b.action === 'done' || b.action === 'missed') return json(res, 200, await schedule.markSession(user, b.id, b.action.toUpperCase()));
      json(res, 200, await schedule.updateSession(user, b.id, b));
    }),
    'DELETE /api/trainer/sessions': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const u = new URL(req.url, 'http://x').searchParams;
      json(res, 200, await schedule.cancelSession(user, u.get('id'), { reason: u.get('reason') || '', series: u.get('series') === '1' }));
    }),
    'GET /api/trainer/notes': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await schedule.listNotes(user, new URL(req.url, 'http://x').searchParams.get('link')));
    }),
    'POST /api/trainer/notes': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const b = await readBody(req);
      json(res, 201, await schedule.addNote(user, b.linkId, b.body));
    }),
    'DELETE /api/trainer/notes': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await schedule.deleteNote(user, new URL(req.url, 'http://x').searchParams.get('id')));
    }),

    /* ------------------- privacidade e compartilhamento ------------------- */
    'POST /api/privacy/preset': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const b = await readBody(req);
      json(res, 200, await privacy.applyPreset(user, b.trainerId, b.preset));
    }),
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
    'GET /api/privacy/export': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await exportMyData(user));
    }),
    /* ------------------- e-mail confirmado, convites pendentes e avisos ------------------- */
    'GET /api/account/verification': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await emailVerify.status(user));
    }),
    'POST /api/account/verification/send': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await emailVerify.sendCode(user, sendMail));
    }),
    'POST /api/account/verification/confirm': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const b = await readBody(req);
      json(res, 200, await emailVerify.verify(user, b.code));
    }),
    'DELETE /api/orgs/pending': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await org.cancelPendingInvite(user, tenantOf(req), new URL(req.url, 'http://x').searchParams.get('id')));
    }),
    'GET /api/notifications': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      json(res, 200, await notif.listNotifications(user));
    }),
    'POST /api/notifications/read': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      const b = await readBody(req);
      json(res, 200, await notif.markRead(user, b.ids === 'all' ? 'all' : b.ids));
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
        json(res, 201, await orgBilling.startCheckout(user, tenantOf(req), { planCode: typeof b.planCode === 'string' ? b.planCode : '', method: typeof b.method === 'string' ? b.method : '', cpfCnpj: typeof b.cpfCnpj === 'string' ? b.cpfCnpj.slice(0, 20) : '' }, client));
      } catch (e) {
        if (!(e instanceof BillingError || e instanceof SaasError)) await logError(db, 'org-checkout', e);
        throw e;
      }
    }),
    'POST /api/orgs/billing/cancel': guarded(async (req, res) => {
      const user = session(req, res); if (!user) return;
      if (throttled(cancelWindow, res, user)) return;
      json(res, 200, { status: (await orgBilling.cancel(user, tenantOf(req), client)).status });
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

    'GET /api/admin/saas/orgs': guarded(async (req, res) => {
      const actor = requireAdmin(req, res); if (!actor) return;
      json(res, 200, await listGyms(actor));
    }),
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
