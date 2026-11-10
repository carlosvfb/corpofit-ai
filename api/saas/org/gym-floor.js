/* Piso da academia: aparelhos numerados e controle de acesso (catraca).
   - Aparelhos: o gerente ou o administrador cadastra (número, nome, grupo muscular, exercícios do catálogo que ele executa, local,
     situação). Todo membro da academia lê a lista. Só texto: nenhuma mídia do catálogo é copiada.
   - Catraca: cada leitor/catraca tem um token próprio (guardado só como hash, mostrado uma vez) e consulta POST /api/access/check
     com o código do QR do aluno ou, num terminal facial que reconhece a pessoa por conta própria, o número da matrícula.
     Quem decide é o servidor (matrícula + mensalidade); o terminal só abre ou não a catraca. Todo acesso, liberado ou negado, é registrado. */
import crypto from 'node:crypto';
import { db } from '../db.js';
import { SaasError } from '../errors.js';
import { withContext } from './context.js';
import { requirePermission } from './service.js';
import { evaluateAccess, readFaceForDevice } from './gym-desk.js';

const NOT_FOUND = () => new SaasError(404, 'Não encontrado.', 'not-found');
const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().slice(0, max) : '');
const list = (v, n, len) => (Array.isArray(v) ? [...new Set(v.map(x => clean(String(x), len)).filter(Boolean))].slice(0, n) : []);
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const EQ_STATUS = ['ACTIVE', 'MAINTENANCE', 'RETIRED'];
const isoDay = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: process.env.APP_TZ || 'America/Sao_Paulo' });

/* --------------------------------- aparelhos --------------------------------- */

const eqView = e => ({ id: e.id, number: e.number, name: e.name, category: e.category, muscles: e.muscles, exerciseIds: e.exerciseIds, location: e.location, status: e.status, notes: e.notes });

export async function listEquipment(user, tenantId) {
  return withContext({ userId: user.id, tenantId }, async tx => {
    const m = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId: user.id } } });
    if (!m || m.status !== 'ACTIVE') throw NOT_FOUND();
    return (await tx.gymEquipment.findMany({ where: { tenantId }, orderBy: { number: 'asc' } })).map(eqView);
  });
}

export async function saveEquipment(user, tenantId, input) {
  const number = Number(input?.number), name = clean(input?.name, 60);
  if (!Number.isInteger(number) || number < 1 || number > 9999) throw new SaasError(400, 'O número do aparelho deve ficar entre 1 e 9999.', 'invalid-number');
  if (name.length < 2) throw new SaasError(400, 'Dê um nome ao aparelho.', 'invalid-name');
  const status = input?.status === undefined ? 'ACTIVE' : input.status;
  if (!EQ_STATUS.includes(status)) throw new SaasError(400, 'Situação inválida.', 'invalid-status');
  const data = { number, name, category: clean(input?.category, 30), muscles: list(input?.muscles, 8, 30), exerciseIds: list(input?.exerciseIds, 20, 30), location: clean(input?.location, 60), status, notes: clean(input?.notes, 200) };
  return withContext({ userId: user.id, tenantId }, async tx => {
    await requirePermission(tx, tenantId, user.id, 'equipment:manage');
    const dup = await tx.gymEquipment.findUnique({ where: { tenantId_number: { tenantId, number } } });
    if (input?.id) {
      const cur = await tx.gymEquipment.findUnique({ where: { id: String(input.id) } });
      if (!cur || cur.tenantId !== tenantId) throw NOT_FOUND();
      if (dup && dup.id !== cur.id) throw new SaasError(409, 'Já existe um aparelho com esse número.', 'number-taken');
      return eqView(await tx.gymEquipment.update({ where: { id: cur.id }, data }));
    }
    if (dup) throw new SaasError(409, 'Já existe um aparelho com esse número.', 'number-taken');
    return eqView(await tx.gymEquipment.create({ data: { tenantId, ...data } }));
  });
}

export async function deleteEquipment(user, tenantId, id) {
  return withContext({ userId: user.id, tenantId }, async tx => {
    await requirePermission(tx, tenantId, user.id, 'equipment:manage');
    const r = await tx.gymEquipment.deleteMany({ where: { id: String(id), tenantId } });
    if (!r.count) throw NOT_FOUND();
    return { deleted: true };
  });
}

/* ------------------------------ catracas e leitores ------------------------------ */

export async function listDevices(user, tenantId) {
  return withContext({ userId: user.id, tenantId }, async tx => {
    await requirePermission(tx, tenantId, user.id, 'devices:manage');
    return (await tx.gymDevice.findMany({ where: { tenantId }, orderBy: { createdAt: 'asc' } })).map(d => ({ id: d.id, name: d.name, active: d.active, lastSeenAt: d.lastSeenAt, createdAt: d.createdAt }));
  });
}

/** Cria um leitor. O token aparece SÓ aqui; depois só o hash existe. */
export async function createDevice(user, tenantId, name) {
  const n = clean(name, 60);
  if (n.length < 2) throw new SaasError(400, 'Dê um nome ao leitor (ex.: Catraca da entrada).', 'invalid-name');
  const token = 'gd_' + crypto.randomBytes(24).toString('base64url');
  return withContext({ userId: user.id, tenantId }, async tx => {
    await requirePermission(tx, tenantId, user.id, 'devices:manage');
    await tx.gymDevice.createMany({ data: [{ tenantId, name: n, tokenHash: sha(token) }] });
    const d = await tx.gymDevice.findUnique({ where: { tokenHash: sha(token) } });
    await tx.activityLog.createMany({ data: [{ tenantId, actorUserId: user.id, action: 'device.created', targetType: 'device', targetId: d.id }] });
    return { id: d.id, name: d.name, token };
  });
}

export async function updateDevice(user, tenantId, id, { active, rotate }) {
  return withContext({ userId: user.id, tenantId }, async tx => {
    await requirePermission(tx, tenantId, user.id, 'devices:manage');
    const d = await tx.gymDevice.findUnique({ where: { id: String(id) } });
    if (!d || d.tenantId !== tenantId) throw NOT_FOUND();
    const data = {};
    let token = null;
    if (typeof active === 'boolean') data.active = active;
    if (rotate) { token = 'gd_' + crypto.randomBytes(24).toString('base64url'); data.tokenHash = sha(token); }
    if (Object.keys(data).length) await tx.gymDevice.update({ where: { id: d.id }, data });
    await tx.activityLog.createMany({ data: [{ tenantId, actorUserId: user.id, action: rotate ? 'device.token-rotated' : 'device.updated', targetType: 'device', targetId: d.id }] });
    return { id: d.id, active: data.active ?? d.active, ...(token ? { token } : {}) };
  });
}

export async function deleteDevice(user, tenantId, id) {
  return withContext({ userId: user.id, tenantId }, async tx => {
    await requirePermission(tx, tenantId, user.id, 'devices:manage');
    const r = await tx.gymDevice.deleteMany({ where: { id: String(id), tenantId } });
    if (!r.count) throw NOT_FOUND();
    return { deleted: true };
  });
}

async function authDevice(token) {
  const t = String(token || '').replace(/^Bearer\s+/i, '').trim();
  if (!/^gd_[A-Za-z0-9_-]{20,80}$/.test(t)) throw new SaasError(401, 'Leitor não autorizado.', 'device-unauthorized');
  const d = await db.gymDevice.findUnique({ where: { tokenHash: sha(t) } });
  if (!d || !d.active) throw new SaasError(401, 'Leitor não autorizado.', 'device-unauthorized');
  return d;
}

/** O leitor pergunta se pode abrir. `code` = QR do aluno; `number` = matrícula (terminal facial que já reconheceu a pessoa). */
export async function deviceCheck(token, input) {
  const dev = await authDevice(token);
  const code = clean(input?.code, 80), number = Number(input?.number);
  if (!code && !(Number.isInteger(number) && number > 0)) throw new SaasError(400, 'Envie o código do QR ou o número da matrícula.', 'invalid-credential');
  const method = code ? 'QR' : 'FACE';
  const direction = input?.direction === 'OUT' ? 'OUT' : 'IN';
  return withContext({ userId: 'device:' + dev.id, tenantId: dev.tenantId }, async tx => {
    const s = code ? await tx.gymStudent.findUnique({ where: { accessCode: code } }) : await tx.gymStudent.findUnique({ where: { tenantId_number: { tenantId: dev.tenantId, number } } });
    const student = s && s.tenantId === dev.tenantId ? s : null;
    const charges = student ? await tx.gymCharge.findMany({ where: { studentId: student.id, status: 'PENDING' } }) : [];
    // Saída nunca é bloqueada: quem já entrou precisa poder sair, mesmo com a mensalidade em atraso.
    const ev = direction === 'OUT' && student ? { allowed: true, reason: 'SAIDA', label: 'Saída liberada' } : evaluateAccess(student, charges, isoDay());
    await tx.gymAccessEvent.createMany({ data: [{ tenantId: dev.tenantId, studentId: student?.id || null, deviceId: dev.id, method, direction, allowed: ev.allowed, reason: ev.reason }] });
    await tx.gymDevice.update({ where: { id: dev.id }, data: { lastSeenAt: new Date() } });
    return { allowed: ev.allowed, reason: ev.reason, message: ev.label, ...(student ? { name: student.fullName, number: student.number } : {}) };
  });
}

/** Lista para o terminal facial sincronizar: quem existe e se pode entrar hoje. Sem CPF, e-mail ou telefone. */
export async function devicePeople(token) {
  const dev = await authDevice(token);
  const today = isoDay();
  return withContext({ userId: 'device:' + dev.id, tenantId: dev.tenantId }, async tx => {
    const rows = await tx.gymStudent.findMany({ where: { tenantId: dev.tenantId, status: { not: 'CANCELLED' } }, include: { charges: { where: { status: 'PENDING' } } }, orderBy: { number: 'asc' }, take: 5000 });
    await tx.gymDevice.update({ where: { id: dev.id }, data: { lastSeenAt: new Date() } });
    return rows.map(s => ({ number: s.number, name: s.fullName, allowed: evaluateAccess(s, s.charges, today).allowed, hasFace: s.hasFacePhoto && !!s.faceConsentAt }));
  });
}

export async function deviceFace(token, number) {
  const dev = await authDevice(token);
  return readFaceForDevice(dev.tenantId, 'device:' + dev.id, Number(number));
}

/* ---------------------------------- registros ---------------------------------- */

export async function accessEvents(user, tenantId, { limit = 100 } = {}) {
  const take = Math.max(1, Math.min(300, Number(limit) || 100));
  return withContext({ userId: user.id, tenantId }, async tx => {
    await requirePermission(tx, tenantId, user.id, 'access:read');
    const rows = await tx.gymAccessEvent.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' }, take });
    const ids = [...new Set(rows.map(r => r.studentId).filter(Boolean))];
    const st = ids.length ? await tx.gymStudent.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, number: true } }) : [];
    const dv = await tx.gymDevice.findMany({ where: { tenantId }, select: { id: true, name: true } });
    return rows.map(r => ({ id: r.id, at: r.createdAt, allowed: r.allowed, reason: r.reason, method: r.method, direction: r.direction, student: st.find(s => s.id === r.studentId) ? { id: r.studentId, name: st.find(s => s.id === r.studentId).fullName, number: st.find(s => s.id === r.studentId).number } : null, device: dv.find(d => d.id === r.deviceId)?.name || null }));
  });
}
