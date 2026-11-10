/* Recepção da academia: matrícula (cadastro completo do aluno), planos, mensalidades e foto de acesso.
   - A recepção cadastra o aluno com o e-mail dele. Ao entrar com esse e-mail (e confirmá-lo), ele já cai ATIVO na academia
     (convite pendente com autoAccept). Nada é enviado ao aluno além de um e-mail dizendo como entrar.
   - A mensalidade é REGISTRADA pela academia (dinheiro, Pix, maquininha...). O sistema nunca recebe nem guarda número de cartão.
   - Foto de acesso (biometria facial) só com consentimento específico, registrado com quem o recebeu; menor de idade exige responsável.
   - Quem vê o quê: a ficha completa (CPF, endereço, saúde, pagamentos) é da recepção, do gerente, do administrador e do dono;
     o professor vê a ficha de treino (sem CPF, endereço e pagamentos). */
import crypto from 'node:crypto';
import path from 'node:path';
import { db } from '../db.js';
import { SaasError } from '../errors.js';
import { DATA_ROOT, storage } from '../../store/fs.js';
import { createAvatarStore } from '../../avatar.js';
import { withContext } from './context.js';
import { can } from './rbac.js';
import { notify } from './notify.js';
import { assertCapacity } from './billing.js';
import { claimInvites } from './verify.js';
import { requirePermission } from './service.js';
import { sendMail } from '../mailer.js';

const TZ = process.env.APP_TZ || 'America/Sao_Paulo';
const METHODS = ['DINHEIRO', 'PIX', 'CARTAO_MAQUININHA', 'TRANSFERENCIA', 'OUTRO'];
const STATUSES = ['ENROLLED', 'ACTIVE', 'SUSPENDED', 'CANCELLED'];
const NOT_FOUND = () => new SaasError(404, 'Não encontrado.', 'not-found');
const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max) : '');
const digits = (v, max) => String(v ?? '').replace(/\D/g, '').slice(0, max);
const isoDay = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: TZ });
const asDate = iso => new Date(iso + 'T00:00:00Z');
const faceStore = tenantId => createAvatarStore(path.join(DATA_ROOT, 'gym-faces', String(tenantId).replace(/[^a-f0-9-]/gi, '')));
const prep = (tenantId, studentId) => faceStore(tenantId).prepare(studentId);

export function cpfOk(v) {
  const c = digits(v, 14);
  if (c.length !== 11 || /^(\d)\1{10}$/.test(c)) return false;
  const dv = n => { let s = 0; for (let i = 0; i < n; i++) s += Number(c[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
  return dv(9) === Number(c[9]) && dv(10) === Number(c[10]);
}
const ageOn = (birth, day) => { const b = new Date(birth), n = new Date(day + 'T00:00:00Z'); let a = n.getUTCFullYear() - b.getUTCFullYear(); if (n.getUTCMonth() < b.getUTCMonth() || (n.getUTCMonth() === b.getUTCMonth() && n.getUTCDate() < b.getUTCDate())) a--; return a; };

/** Pode entrar hoje? Pura, para a catraca, o painel e o app do aluno darem a mesma resposta. */
export function evaluateAccess(student, charges, today = isoDay()) {
  if (!student) return { allowed: false, reason: 'NAO_ENCONTRADO', label: 'Aluno não encontrado' };
  if (student.status === 'CANCELLED') return { allowed: false, reason: 'CANCELADO', label: 'Matrícula cancelada' };
  if (student.status === 'SUSPENDED') return { allowed: false, reason: 'SUSPENSO', label: 'Acesso suspenso' };
  const late = charges.filter(c => c.status === 'PENDING').find(c => {
    const limit = new Date(c.dueDate); limit.setUTCDate(limit.getUTCDate() + (student.graceDays || 0));
    return limit.toISOString().slice(0, 10) < today;
  });
  if (student.status === 'ENROLLED') return late ? { allowed: false, reason: 'AGUARDANDO_PAGAMENTO', label: 'Aguardando o primeiro pagamento' } : { allowed: true, reason: 'OK', label: 'Liberado (matrícula recente)' };
  if (late) return { allowed: false, reason: 'MENSALIDADE_ATRASADA', label: 'Mensalidade em atraso' };
  return { allowed: true, reason: 'OK', label: 'Liberado' };
}

const chargeView = (c, today) => ({ id: c.id, studentId: c.studentId, reference: c.reference, description: c.description, amountCents: c.amountCents, dueDate: c.dueDate.toISOString().slice(0, 10), status: c.status, overdue: c.status === 'PENDING' && c.dueDate.toISOString().slice(0, 10) < today, paidAt: c.paidAt, method: c.method, note: c.note });
const studentView = (s, { pii, charges = [], plan = null, today }) => ({
  id: s.id, number: s.number, fullName: s.fullName, email: s.email, status: s.status, userId: s.userId, hasAccount: !!s.userId,
  plan: plan ? { id: plan.id, name: plan.name, priceCents: plan.priceCents } : null, billingDay: s.billingDay, graceDays: s.graceDays,
  birthDate: s.birthDate ? s.birthDate.toISOString().slice(0, 10) : null, healthNotes: s.healthNotes, emergencyName: pii ? s.emergencyName : undefined, emergencyPhone: pii ? s.emergencyPhone : undefined,
  trainingConsentAt: s.trainingConsentAt, faceConsentAt: s.faceConsentAt, hasFacePhoto: s.hasFacePhoto, termsAcceptedAt: s.termsAcceptedAt, createdAt: s.createdAt,
  ...(pii ? { phone: s.phone, document: s.document, address: s.address, guardianName: s.guardianName, guardianDocument: s.guardianDocument, notes: s.notes, accessCode: s.accessCode, access: evaluateAccess(s, charges, today), charges: charges.map(c => chargeView(c, today)) } : {})
});

/* ---------------------------------- planos ---------------------------------- */

export async function listPlans(user, tenantId) {
  return withContext({ userId: user.id, tenantId }, async tx => {
    const m = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId: user.id } } });
    if (!m || m.status !== 'ACTIVE') throw NOT_FOUND();
    return (await tx.gymPlan.findMany({ where: { tenantId }, orderBy: [{ active: 'desc' }, { priceCents: 'asc' }] })).map(p => ({ id: p.id, name: p.name, description: p.description, priceCents: p.priceCents, active: p.active }));
  });
}

export async function savePlan(user, tenantId, input) {
  const name = clean(input?.name, 60);
  const price = Number(input?.priceCents);
  if (name.length < 2) throw new SaasError(400, 'Dê um nome ao plano.', 'invalid-name');
  if (!Number.isInteger(price) || price < 0 || price > 10_000_000) throw new SaasError(400, 'Valor inválido.', 'invalid-price');
  return withContext({ userId: user.id, tenantId }, async tx => {
    await requirePermission(tx, tenantId, user.id, 'plans:manage');
    const data = { name, description: clean(input?.description, 200), priceCents: price, active: input?.active !== false };
    if (input?.id) {
      const cur = await tx.gymPlan.findUnique({ where: { id: String(input.id) } });
      if (!cur || cur.tenantId !== tenantId) throw NOT_FOUND();
      const p = await tx.gymPlan.update({ where: { id: cur.id }, data });
      return { id: p.id, ...data };
    }
    const p = await tx.gymPlan.create({ data: { tenantId, ...data } });
    return { id: p.id, ...data };
  });
}

/* --------------------------------- matrícula --------------------------------- */

function validateEnrollment(input, today) {
  const fullName = clean(input?.fullName, 80);
  const email = clean(input?.email, 120).toLowerCase();
  if (fullName.length < 3) throw new SaasError(400, 'Informe o nome completo.', 'invalid-name');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw new SaasError(400, 'Informe um e-mail válido: o aluno entra com ele.', 'invalid-email');
  const document = digits(input?.document, 14);
  if (document && !cpfOk(document)) throw new SaasError(400, 'CPF inválido.', 'invalid-document');
  let birthDate = null;
  if (input?.birthDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(input.birthDate)) || Number.isNaN(asDate(input.birthDate).getTime()) || input.birthDate > today || input.birthDate < '1900-01-01') throw new SaasError(400, 'Data de nascimento inválida.', 'invalid-birth');
    birthDate = asDate(input.birthDate);
  }
  const guardianName = clean(input?.guardianName, 80), guardianDocument = digits(input?.guardianDocument, 14);
  if (birthDate && ageOn(birthDate, today) < 18) {
    if (guardianName.length < 3 || !cpfOk(guardianDocument)) throw new SaasError(400, 'Aluno menor de idade: informe o nome e o CPF válido do responsável.', 'guardian-required');
  }
  const billingDay = input?.billingDay === undefined ? 10 : Number(input.billingDay);
  const graceDays = input?.graceDays === undefined ? 3 : Number(input.graceDays);
  if (!Number.isInteger(billingDay) || billingDay < 1 || billingDay > 28) throw new SaasError(400, 'O dia de vencimento deve ficar entre 1 e 28.', 'invalid-billing-day');
  if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 30) throw new SaasError(400, 'A tolerância deve ficar entre 0 e 30 dias.', 'invalid-grace');
  return { fullName, email, document, birthDate, guardianName, guardianDocument, billingDay, graceDays, phone: digits(input?.phone, 15), address: clean(input?.address, 200), emergencyName: clean(input?.emergencyName, 80), emergencyPhone: digits(input?.emergencyPhone, 15), healthNotes: clean(input?.healthNotes, 1000), notes: clean(input?.notes, 500) };
}

export async function enroll(user, tenantId, input) {
  const now = new Date(), today = isoDay(now);
  const v = validateEnrollment(input, today);
  if (input?.termsAccepted !== true) throw new SaasError(400, 'Registre que o aluno leu e aceitou o termo de matrícula e a política de privacidade.', 'terms-required');
  const out = await withContext({ userId: user.id, tenantId }, async tx => {
    await requirePermission(tx, tenantId, user.id, 'students:enroll');
    let plan = null;
    if (input?.planId) {
      plan = await tx.gymPlan.findUnique({ where: { id: String(input.planId) } });
      if (!plan || plan.tenantId !== tenantId || !plan.active) throw new SaasError(404, 'Plano não encontrado.', 'plan-not-found');
    }
    if (await tx.gymStudent.findUnique({ where: { tenantId_email: { tenantId, email: v.email } } })) throw new SaasError(409, 'Já existe um aluno cadastrado com esse e-mail nesta academia.', 'email-taken');
    await assertCapacity(tx, tenantId, 'STUDENT');
    const last = await tx.gymStudent.aggregate({ where: { tenantId }, _max: { number: true } });
    const number = (last._max.number || 0) + 1;
    const accessCode = 'ac_' + crypto.randomBytes(16).toString('base64url');
    const s = await tx.gymStudent.create({ data: { tenantId, number, accessCode, ...v, planId: plan?.id || null, termsAcceptedAt: now, trainingConsentAt: input?.trainingConsent === true ? now : null, createdById: user.id } });
    if (plan) await tx.gymCharge.create({ data: { tenantId, studentId: s.id, planId: plan.id, reference: today.slice(0, 7), description: `Mensalidade ${plan.name} (matrícula)`, amountCents: plan.priceCents, dueDate: asDate(today) } });
    const exp = new Date(now.getTime() + 60 * 86_400_000);
    await tx.pendingInvite.upsert({ where: { email_tenantId: { email: v.email, tenantId } }, create: { email: v.email, tenantId, role: 'STUDENT', invitedById: user.id, autoAccept: true, expiresAt: exp }, update: { role: 'STUDENT', invitedById: user.id, autoAccept: true, expiresAt: exp } });
    await tx.activityLog.createMany({ data: [{ tenantId, actorUserId: user.id, action: 'student.enrolled', targetType: 'student', targetId: s.id, after: { number, planId: plan?.id || null } }] });
    const t = await tx.tenant.findUnique({ where: { id: tenantId } });
    return { student: s, plan, gym: t?.name || 'sua academia' };
  });
  // Quem já tem conta com o e-mail confirmado é vinculado agora; os demais, quando entrarem e confirmarem o e-mail.
  const existing = await db.user.findFirst({ where: { email: { equals: v.email, mode: 'insensitive' }, deletedAt: null } });
  if (existing) await claimInvites({ id: existing.id, email: existing.email, name: existing.name }).catch(() => {});
  sendMail(v.email, `Sua matrícula na ${out.gym}`, `Olá, ${v.fullName.split(' ')[0]}!\n\nSua matrícula na ${out.gym} foi feita (nº ${out.student.number}).\n\nPara acompanhar seus treinos, entre no CorpoFit AI com este e-mail (${v.email}): pode ser com a conta do Google ou criando uma conta. Confirme o e-mail em Ajustes > Notificações e e-mail e você já aparece vinculado à academia.`).catch(() => {});
  return studentView(out.student, { pii: true, charges: [], plan: out.plan, today });
}

/* ---------------------------------- consulta ---------------------------------- */

async function loadStudent(tx, tenantId, id) {
  const s = await tx.gymStudent.findUnique({ where: { id: String(id) } });
  if (!s || s.tenantId !== tenantId) throw NOT_FOUND();
  return s;
}

export async function listStudents(user, tenantId, { q, status } = {}) {
  const today = isoDay();
  return withContext({ userId: user.id, tenantId }, async tx => {
    const m = await requirePermission(tx, tenantId, user.id, 'students:read');
    const pii = can(m, 'students:update');
    const text = clean(q, 60).toLowerCase();
    const rows = await tx.gymStudent.findMany({ where: { tenantId, ...(STATUSES.includes(status) ? { status } : {}) }, orderBy: { number: 'desc' }, take: 500, include: { plan: true, charges: { where: { status: 'PENDING' } } } });
    return rows.filter(s => !text || s.fullName.toLowerCase().includes(text) || s.email.includes(text) || String(s.number) === text || (pii && digits(s.document) === digits(text) && digits(text).length > 4))
      .map(s => ({ ...studentView(s, { pii: false, plan: s.plan, today }), access: pii ? evaluateAccess(s, s.charges, today) : undefined, overdueCharges: pii ? s.charges.filter(c => c.dueDate.toISOString().slice(0, 10) < today).length : undefined }));
  });
}

export async function getStudent(user, tenantId, id) {
  const today = isoDay();
  return withContext({ userId: user.id, tenantId }, async tx => {
    const m = await requirePermission(tx, tenantId, user.id, 'students:read');
    const pii = can(m, 'students:update');
    const s = await loadStudent(tx, tenantId, id);
    const charges = pii && can(m, 'charges:manage') ? await tx.gymCharge.findMany({ where: { studentId: s.id }, orderBy: { dueDate: 'desc' }, take: 36 }) : [];
    const plan = s.planId ? await tx.gymPlan.findUnique({ where: { id: s.planId } }) : null;
    return studentView(s, { pii, charges, plan, today });
  });
}

export async function updateStudent(user, tenantId, id, patch) {
  const today = isoDay();
  return withContext({ userId: user.id, tenantId }, async tx => {
    await requirePermission(tx, tenantId, user.id, 'students:update');
    const s = await loadStudent(tx, tenantId, id);
    const merged = { fullName: s.fullName, email: s.email, document: s.document, birthDate: s.birthDate ? s.birthDate.toISOString().slice(0, 10) : '', guardianName: s.guardianName, guardianDocument: s.guardianDocument, billingDay: s.billingDay, graceDays: s.graceDays, phone: s.phone, address: s.address, emergencyName: s.emergencyName, emergencyPhone: s.emergencyPhone, healthNotes: s.healthNotes, notes: s.notes, ...patch, email: s.email };
    const v = validateEnrollment(merged, today);
    const data = { ...v };
    delete data.email; // o e-mail é o vínculo com a conta do aluno: não muda por aqui
    if (patch?.planId !== undefined) {
      if (patch.planId === null || patch.planId === '') data.planId = null;
      else { const p = await tx.gymPlan.findUnique({ where: { id: String(patch.planId) } }); if (!p || p.tenantId !== tenantId || !p.active) throw new SaasError(404, 'Plano não encontrado.', 'plan-not-found'); data.planId = p.id; }
    }
    const u = await tx.gymStudent.update({ where: { id: s.id }, data });
    await tx.activityLog.createMany({ data: [{ tenantId, actorUserId: user.id, action: 'student.updated', targetType: 'student', targetId: s.id }] });
    return studentView(u, { pii: true, charges: [], plan: null, today });
  });
}

export async function setStudentStatus(user, tenantId, id, status, reason = '') {
  if (!['ACTIVE', 'SUSPENDED', 'CANCELLED'].includes(status)) throw new SaasError(400, 'Situação inválida.', 'invalid-status');
  return withContext({ userId: user.id, tenantId }, async tx => {
    await requirePermission(tx, tenantId, user.id, 'students:update');
    const s = await loadStudent(tx, tenantId, id);
    await tx.gymStudent.update({ where: { id: s.id }, data: { status } });
    await tx.activityLog.createMany({ data: [{ tenantId, actorUserId: user.id, action: 'student.status', targetType: 'student', targetId: s.id, before: { status: s.status }, after: { status, reason: clean(reason, 200) } }] });
    if (s.userId) await notify(tx, s.userId, { kind: 'gym', title: status === 'ACTIVE' ? 'Seu acesso à academia foi liberado' : status === 'SUSPENDED' ? 'Seu acesso à academia foi suspenso' : 'Sua matrícula foi cancelada', body: clean(reason, 120), link: '/minha-academia', dedupeKey: `gymstatus:${s.id}:${Date.now()}` });
    return { id: s.id, status };
  });
}

/* ------------------------------- mensalidades ------------------------------- */

export async function listCharges(user, tenantId, { status, month, q } = {}) {
  const today = isoDay();
  return withContext({ userId: user.id, tenantId }, async tx => {
    await requirePermission(tx, tenantId, user.id, 'charges:manage');
    const where = { tenantId, ...(['PENDING', 'PAID', 'CANCELLED'].includes(status) ? { status } : {}), ...(/^\d{4}-\d{2}$/.test(month || '') ? { reference: month } : {}) };
    const rows = await tx.gymCharge.findMany({ where, orderBy: { dueDate: 'asc' }, take: 1000, include: { student: { select: { id: true, number: true, fullName: true, email: true, status: true } } } });
    const text = clean(q, 60).toLowerCase();
    return rows.filter(c => !text || c.student.fullName.toLowerCase().includes(text) || String(c.student.number) === text)
      .map(c => ({ ...chargeView(c, today), student: { id: c.student.id, number: c.student.number, name: c.student.fullName, status: c.student.status } }));
  });
}

/** Gera as mensalidades do mês (AAAA-MM) dos alunos ATIVOS com plano. Quem já tem a do mês não ganha outra. */
export async function generateCharges(user, tenantId, month) {
  const ref = /^\d{4}-\d{2}$/.test(month || '') ? month : isoDay().slice(0, 7);
  return withContext({ userId: user.id, tenantId }, async tx => {
    await requirePermission(tx, tenantId, user.id, 'charges:manage');
    const students = await tx.gymStudent.findMany({ where: { tenantId, status: 'ACTIVE', planId: { not: null } }, include: { plan: true } });
    const data = students.filter(s => s.plan?.active).map(s => ({ tenantId, studentId: s.id, planId: s.planId, reference: ref, description: `Mensalidade ${s.plan.name} (${ref.slice(5)}/${ref.slice(0, 4)})`, amountCents: s.plan.priceCents, dueDate: asDate(`${ref}-${String(s.billingDay).padStart(2, '0')}`) }));
    const r = data.length ? await tx.gymCharge.createMany({ data, skipDuplicates: true }) : { count: 0 };
    await tx.activityLog.createMany({ data: [{ tenantId, actorUserId: user.id, action: 'charges.generated', targetType: 'month', targetId: ref, after: { created: r.count } }] });
    return { month: ref, created: r.count, skipped: data.length - r.count };
  });
}

export async function recordPayment(user, tenantId, chargeId, { method, note, paidAt } = {}) {
  if (!METHODS.includes(method)) throw new SaasError(400, 'Escolha como o aluno pagou.', 'invalid-method');
  const today = isoDay();
  return withContext({ userId: user.id, tenantId }, async tx => {
    await requirePermission(tx, tenantId, user.id, 'charges:manage');
    const c = await tx.gymCharge.findUnique({ where: { id: String(chargeId) } });
    if (!c || c.tenantId !== tenantId) throw NOT_FOUND();
    if (c.status === 'PAID') throw new SaasError(409, 'Essa cobrança já foi paga.', 'already-paid');
    if (c.status === 'CANCELLED') throw new SaasError(409, 'Essa cobrança foi cancelada.', 'cancelled');
    const when = paidAt ? new Date(paidAt) : new Date();
    if (Number.isNaN(when.getTime()) || when.getTime() > Date.now() + 3_600_000) throw new SaasError(400, 'Data do pagamento inválida.', 'invalid-date');
    const u = await tx.gymCharge.update({ where: { id: c.id }, data: { status: 'PAID', paidAt: when, method, recordedById: user.id, note: clean(note, 200) } });
    const s = await tx.gymStudent.findUnique({ where: { id: c.studentId } });
    let activated = false;
    if (s.status === 'ENROLLED') { await tx.gymStudent.update({ where: { id: s.id }, data: { status: 'ACTIVE' } }); activated = true; }
    await tx.activityLog.createMany({ data: [{ tenantId, actorUserId: user.id, action: 'charge.paid', targetType: 'student', targetId: s.id, after: { chargeId: c.id, amountCents: c.amountCents, method } }] });
    if (s.userId) await notify(tx, s.userId, { kind: 'gym', title: 'Pagamento registrado', body: `${c.description}: recebido pela academia.`, link: '/minha-academia', dedupeKey: `gympaid:${c.id}` });
    return { ...chargeView(u, today), studentActivated: activated };
  });
}

export async function cancelCharge(user, tenantId, chargeId, reason = '') {
  return withContext({ userId: user.id, tenantId }, async tx => {
    await requirePermission(tx, tenantId, user.id, 'charges:manage');
    const c = await tx.gymCharge.findUnique({ where: { id: String(chargeId) } });
    if (!c || c.tenantId !== tenantId) throw NOT_FOUND();
    if (c.status !== 'PENDING') throw new SaasError(409, 'Só dá para cancelar cobrança pendente.', 'not-pending');
    await tx.gymCharge.update({ where: { id: c.id }, data: { status: 'CANCELLED', note: clean(reason, 200) } });
    await tx.activityLog.createMany({ data: [{ tenantId, actorUserId: user.id, action: 'charge.cancelled', targetType: 'student', targetId: c.studentId, after: { chargeId: c.id, reason: clean(reason, 120) } }] });
    return { id: c.id, status: 'CANCELLED' };
  });
}

/* ------------------------------ foto de acesso (face) ------------------------------ */

export async function setFaceConsent(user, tenantId, id, given) {
  return withContext({ userId: user.id, tenantId }, async tx => {
    await requirePermission(tx, tenantId, user.id, 'students:update');
    const s = await loadStudent(tx, tenantId, id);
    if (given) {
      if (s.birthDate && ageOn(s.birthDate, isoDay()) < 18 && !s.guardianName) throw new SaasError(400, 'Aluno menor de idade: cadastre o responsável antes do consentimento.', 'guardian-required');
      await tx.gymStudent.update({ where: { id: s.id }, data: { faceConsentAt: new Date(), faceConsentBy: user.id } });
    } else {
      await prep(tenantId, s.id);
      faceStore(tenantId).remove(s.id);
      await tx.gymStudent.update({ where: { id: s.id }, data: { faceConsentAt: null, faceConsentBy: null, hasFacePhoto: false } });
    }
    await tx.activityLog.createMany({ data: [{ tenantId, actorUserId: user.id, action: given ? 'student.face-consent' : 'student.face-revoked', targetType: 'student', targetId: s.id }] });
    return { id: s.id, faceConsent: !!given };
  });
}

export async function saveFacePhoto(user, tenantId, id, buf) {
  return withContext({ userId: user.id, tenantId }, async tx => {
    await requirePermission(tx, tenantId, user.id, 'students:update');
    const s = await loadStudent(tx, tenantId, id);
    if (!s.faceConsentAt) throw new SaasError(409, 'Registre antes o consentimento do aluno para a foto de acesso.', 'consent-required');
    await prep(tenantId, s.id);
    try { faceStore(tenantId).save(s.id, buf); } catch (e) { throw new SaasError(e.code === 'avatar-size' ? 413 : 400, e.code === 'avatar-size' ? 'A foto é grande demais.' : 'Envie uma foto JPEG, PNG ou WebP.', e.code || 'invalid-image'); }
    await tx.gymStudent.update({ where: { id: s.id }, data: { hasFacePhoto: true } });
    await tx.activityLog.createMany({ data: [{ tenantId, actorUserId: user.id, action: 'student.face-photo', targetType: 'student', targetId: s.id }] });
    return { id: s.id, hasFacePhoto: true };
  });
}

export async function readFacePhoto(user, tenantId, id) {
  return withContext({ userId: user.id, tenantId }, async tx => {
    await requirePermission(tx, tenantId, user.id, 'students:update');
    const s = await loadStudent(tx, tenantId, id);
    if (s.hasFacePhoto) await prep(tenantId, s.id);
    const f = s.hasFacePhoto ? faceStore(tenantId).read(s.id) : null;
    if (!f) throw NOT_FOUND();
    return f;
  });
}

/* ----------------------------- o aluno vê a própria academia ----------------------------- */

export async function myGym(user) {
  const today = isoDay();
  return withContext({ userId: user.id }, async tx => {
    const rows = await tx.gymStudent.findMany({ where: { userId: user.id }, include: { plan: true, charges: { orderBy: { dueDate: 'desc' }, take: 24 } } });
    const tenants = await tx.tenant.findMany({ where: { id: { in: rows.map(r => r.tenantId) } }, select: { id: true, name: true } });
    return rows.map(s => ({
      gymId: s.tenantId, gym: tenants.find(t => t.id === s.tenantId)?.name || '', number: s.number, status: s.status, accessCode: s.accessCode,
      plan: s.plan ? { name: s.plan.name, priceCents: s.plan.priceCents } : null, billingDay: s.billingDay,
      access: evaluateAccess(s, s.charges, today), charges: s.charges.map(c => chargeView(c, today)),
      hasFacePhoto: s.hasFacePhoto, faceConsentAt: s.faceConsentAt, trainingConsentAt: s.trainingConsentAt
    }));
  });
}

/** A foto de um aluno para o terminal facial (autenticado pelo token do leitor, só de alunos com consentimento). */
export async function readFaceForDevice(tenantId, actorId, number) {
  return withContext({ userId: actorId, tenantId }, async tx => {
    const s = Number.isInteger(number) ? await tx.gymStudent.findUnique({ where: { tenantId_number: { tenantId, number } } }) : null;
    if (s && s.hasFacePhoto) await prep(tenantId, s.id);
    const f = s && s.hasFacePhoto && s.faceConsentAt && s.status !== 'CANCELLED' ? faceStore(tenantId).read(s.id) : null;
    if (!f) throw NOT_FOUND();
    return f;
  });
}

/** O próprio aluno retira o consentimento da foto de acesso: a foto é apagada na hora. */
export async function revokeMyFace(user, tenantId) {
  return withContext({ userId: user.id, tenantId }, async tx => {
    const s = await tx.gymStudent.findFirst({ where: { tenantId, userId: user.id } });
    if (!s) throw NOT_FOUND();
    await prep(tenantId, s.id);
    faceStore(tenantId).remove(s.id);
    await tx.gymStudent.update({ where: { id: s.id }, data: { faceConsentAt: null, faceConsentBy: null, hasFacePhoto: false } });
    await tx.activityLog.createMany({ data: [{ tenantId, actorUserId: user.id, action: 'student.face-revoked-by-student', targetType: 'student', targetId: s.id }] });
    return { revoked: true };
  });
}
