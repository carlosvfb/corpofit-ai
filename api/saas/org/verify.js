/* Verificação de e-mail por um código de 6 dígitos (15 minutos, 5 tentativas, guardado só como hash) e a
   reivindicação de convites feitos a esse e-mail antes de a pessoa ter conta. Um convite pendente SÓ vira
   convite de verdade depois de o e-mail ser confirmado: sem isso, qualquer um poderia se cadastrar com o
   e-mail de outra pessoa e entrar na academia dela. */
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { db } from '../db.js';
import { SaasError } from '../errors.js';
import { ensureUser } from '../access.js';
import { withContext } from './context.js';
import { assertCapacity } from './billing.js';
import { notify } from './notify.js';

const TTL_MS = 15 * 60_000;
const RESEND_MS = 60_000;
const MAX_ATTEMPTS = 5;
const lower = e => String(e || '').trim().toLowerCase();
const hash = (uid, code) => createHash('sha256').update(`${uid}:${code}`).digest('hex');
const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export async function isVerified(user) {
  const email = lower(user.email);
  if (!email) return false;
  const row = await db.user.findUnique({ where: { id: user.id }, select: { emailVerifiedFor: true } });
  return !!row && row.emailVerifiedFor === email;
}

export async function status(user) {
  return { email: lower(user.email) || null, verified: await isVerified(user), required: process.env.REQUIRE_VERIFIED_EMAIL === '1' };
}

/** Quando REQUIRE_VERIFIED_EMAIL=1, ações de alto impacto exigem e-mail confirmado. */
export async function requireVerified(user) {
  if (process.env.REQUIRE_VERIFIED_EMAIL !== '1') return;
  if (!(await isVerified(user))) throw new SaasError(403, 'Confirme seu e-mail para continuar.', 'email-not-verified');
}

export async function sendCode(user, mailer) {
  const email = lower(user.email);
  if (!email) throw new SaasError(400, 'Sua conta não tem e-mail. Adicione um nas configurações.', 'email-required');
  if (await isVerified(user)) return { sent: false, alreadyVerified: true };
  await ensureUser(user);
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await withContext({ userId: user.id }, async tx => {
    const cur = await tx.emailVerification.findUnique({ where: { userId: user.id } });
    if (cur && Date.now() - cur.sentAt.getTime() < RESEND_MS) throw new SaasError(429, 'Aguarde um minuto para pedir outro código.', 'too-soon');
    const data = { email, codeHash: hash(user.id, code), expiresAt: new Date(Date.now() + TTL_MS), attempts: 0, sentAt: new Date() };
    await tx.emailVerification.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data });
  });
  const r = await mailer(email, 'Seu código de confirmação', `Seu código para confirmar o e-mail: ${code}\n\nEle vale por 15 minutos. Se você não pediu, ignore esta mensagem.`);
  if (!r?.sent && process.env.NODE_ENV === 'production') {
    await withContext({ userId: user.id }, tx => tx.emailVerification.deleteMany({ where: { userId: user.id } }));
    throw new SaasError(503, 'O envio de e-mail ainda não está configurado neste servidor.', 'mail-not-configured');
  }
  return { sent: !!r?.sent };
}

export async function verify(user, code) {
  const c = String(code || '').trim();
  if (!/^\d{6}$/.test(c)) throw new SaasError(400, 'O código tem 6 números.', 'code-invalid');
  const email = lower(user.email);
  const ok = await withContext({ userId: user.id }, async tx => {
    const rec = await tx.emailVerification.findUnique({ where: { userId: user.id } });
    if (!rec || rec.expiresAt.getTime() < Date.now() || rec.email !== email) throw new SaasError(400, 'O código está errado ou expirou. Peça um novo.', 'code-invalid');
    if (rec.attempts >= MAX_ATTEMPTS) throw new SaasError(429, 'Muitas tentativas. Peça um novo código.', 'locked');
    if (!same(rec.codeHash, hash(user.id, c))) {
      await tx.emailVerification.update({ where: { userId: user.id }, data: { attempts: { increment: 1 } } });
      return false;
    }
    await tx.emailVerification.delete({ where: { userId: user.id } });
    return true;
  });
  if (!ok) throw new SaasError(400, 'O código está errado ou expirou. Peça um novo.', 'code-invalid');
  await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date(), emailVerifiedFor: email } });
  return { verified: true, invitesClaimed: await claimInvites(user) };
}

/** Entrou pelo Google: o Google já verificou o e-mail, então vale como confirmado e as matrículas/convites desse e-mail
 *  são vinculados na hora. Só chamar com um e-mail que o PROVEDOR confirmou (nunca com o que a pessoa digitou). */
export async function markVerifiedByProvider(user) {
  const email = lower(user.email);
  if (!email) return { claimed: 0 };
  await ensureUser(user);
  await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date(), emailVerifiedFor: email } });
  return { claimed: await claimInvites(user) };
}

/** Transforma os convites feitos ao e-mail (já confirmado) em convites de verdade. Devolve quantos. */
export async function claimInvites(user) {
  if (!(await isVerified(user))) return 0;
  const email = lower(user.email);
  const pending = await withContext({ userId: user.id, claimEmail: email }, tx => tx.pendingInvite.findMany({ where: { email, expiresAt: { gt: new Date() } } }));
  let claimed = 0;
  for (const inv of pending) {
    try {
      await withContext({ userId: user.id, tenantId: inv.tenantId, claimEmail: email }, async tx => {
        const existing = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId: inv.tenantId, userId: user.id } } });
        if (!existing || existing.status === 'REMOVED') {
          await assertCapacity(tx, inv.tenantId, inv.role, { ignorePending: inv.id });
          const t = await tx.tenant.findUnique({ where: { id: inv.tenantId } });
          const status = inv.autoAccept ? 'ACTIVE' : 'INVITED';
          if (existing) await tx.membership.update({ where: { id: existing.id }, data: { role: inv.role, status, invitedById: inv.invitedById } });
          else await tx.membership.create({ data: { tenantId: inv.tenantId, userId: user.id, role: inv.role, status, invitedById: inv.invitedById } });
          await tx.activityLog.createMany({ data: [{ tenantId: inv.tenantId, actorUserId: inv.invitedById, action: inv.autoAccept ? 'student.account-linked' : 'member.invited', targetType: 'user', targetId: user.id, after: { role: inv.role, status, viaPendingInvite: true } }] });
          if (inv.autoAccept) {
            // Matrícula feita na recepção: liga a conta ao cadastro da academia (o aluno não precisa aceitar de novo).
            await tx.gymStudent.updateMany({ where: { tenantId: inv.tenantId, email, userId: null }, data: { userId: user.id } });
            await notify(tx, user.id, { kind: 'gym', title: `Você agora faz parte da academia ${t?.name || ''}`.trim(), body: 'Veja seu plano, mensalidades e aparelhos em Ajustes > Minha academia.', link: '/minha-academia', dedupeKey: `gym-linked:${inv.tenantId}:${inv.id}` });
          } else {
            await notify(tx, user.id, { kind: 'gym-invite', title: `Convite da academia ${t?.name || ''}`.trim(), body: 'Aceite em Ajustes > Academias.', link: '/academias', dedupeKey: `gym-invite:${inv.tenantId}:${inv.id}` });
          }
          claimed++;
        }
        if (inv.autoAccept) await tx.gymStudent.updateMany({ where: { tenantId: inv.tenantId, email, userId: null }, data: { userId: user.id } });
        await tx.pendingInvite.deleteMany({ where: { id: inv.id } });
      });
    } catch { /* sem vaga no plano ou outro problema: o convite fica pendente e a academia vê o motivo ao tentar de novo */ }
  }
  return claimed;
}
