/* LGPD sobre os dados de academias, personal e biblioteca: exportar (acesso e portabilidade) e apagar
   (eliminação) tudo o que pertence a um usuário. O apagamento roda só na exclusão da conta e usa o
   `app.eraser` do banco (cada política alcança apenas linhas do próprio usuário).
   Mantido de propósito: o registro de atividade das academias (autoria pseudonimizada, o nome some com a
   anonimização do espelho do usuário), as cobranças (obrigação fiscal) e os vínculos como REMOVED. */
import { db } from '../db.js';
import { withContext } from './context.js';

const iso = d => (d instanceof Date ? d.toISOString() : d ?? null);

/** Tudo o que a plataforma guarda sobre o usuário nestas áreas, em formato legível por máquina. */
export async function exportMyData(user) {
  const uid = user.id;
  const mine = await withContext({ userId: uid }, async tx => ({
    memberships: await tx.membership.findMany({ where: { userId: uid } }),
    gyms: await tx.tenant.findMany({ select: { id: true, name: true, slug: true } }), // só as que o RLS deixa ver (vínculo não removido)
    trainerProfile: await tx.trainerProfile.findUnique({ where: { userId: uid } }),
    links: await tx.trainerStudent.findMany({ where: { OR: [{ trainerId: uid }, { studentId: uid }] } }),
    assignments: await tx.assignment.findMany({ where: { OR: [{ trainerId: uid }, { studentId: uid }] }, orderBy: { createdAt: 'asc' } }),
    comments: await tx.assignmentComment.findMany({ where: { authorId: uid }, orderBy: { createdAt: 'asc' } }),
    sharingGiven: await tx.sharingPermission.findMany({ where: { studentId: uid } }),
    sharingReceived: await tx.sharingPermission.findMany({ where: { trainerId: uid, level: { not: 'OFF' } } }),
    consent: await tx.consentRecord.findMany({ where: { studentId: uid }, orderBy: { createdAt: 'asc' } }),
    accessToMyData: await tx.accessLog.findMany({ where: { studentId: uid }, orderBy: { createdAt: 'asc' } }),
    communityItems: await tx.communityItem.findMany({ where: { authorId: uid } }),
    favorites: await tx.communityFavorite.findMany({ where: { userId: uid } }),
    reports: await tx.communityReport.findMany({ where: { reporterId: uid } })
  }));
  const row = await db.user.findUnique({ where: { id: uid }, select: { aiTenantId: true } });
  return {
    exportedAt: new Date().toISOString(),
    note: 'Dados de academias, personal trainer, privacidade e biblioteca. Treinos, medidas e histórico ficam no export principal do app.',
    gymAiContext: row?.aiTenantId || null,
    memberships: mine.memberships.map(m => ({ gym: mine.gyms.find(g => g.id === m.tenantId)?.name ?? null, slug: mine.gyms.find(g => g.id === m.tenantId)?.slug ?? null, role: m.role, status: m.status, since: iso(m.createdAt) })),
    trainerProfile: mine.trainerProfile && { displayName: mine.trainerProfile.displayName, bio: mine.trainerProfile.bio, specialties: mine.trainerProfile.specialties },
    trainerLinks: mine.links.map(l => ({ id: l.id, as: l.trainerId === uid ? 'TRAINER' : 'STUDENT', status: l.status, initiatedBy: l.initiatedBy, since: iso(l.createdAt), endedAt: iso(l.endedAt) })),
    workoutsExchanged: mine.assignments.map(a => ({ id: a.id, direction: a.trainerId === uid ? 'SENT' : 'RECEIVED', kind: a.kind, title: a.title, note: a.note, status: a.status, revision: a.revision, createdAt: iso(a.createdAt), bundle: a.bundle })),
    commentsWritten: mine.comments.map(c => ({ assignmentId: c.assignmentId, body: c.body, at: iso(c.createdAt) })),
    sharingGivenToTrainers: mine.sharingGiven.map(p => ({ trainerId: p.trainerId, category: p.category, level: p.level })),
    sharingReceivedFromStudents: mine.sharingReceived.map(p => ({ studentId: p.studentId, category: p.category, level: p.level })),
    consentHistory: mine.consent.map(c => ({ trainerId: c.trainerId, category: c.category, from: c.previousLevel, to: c.level, action: c.action, at: iso(c.createdAt) })),
    whoReadMyData: mine.accessToMyData.map(a => ({ by: a.actorId, category: a.category, at: iso(a.createdAt) })),
    communityPublished: mine.communityItems.map(i => ({ id: i.id, kind: i.kind, title: i.title, description: i.description, body: i.body, visibility: i.visibility, status: i.status, imports: i.imports, createdAt: iso(i.createdAt), bundle: i.bundle })),
    communityFavorites: mine.favorites.map(f => ({ itemId: f.itemId, at: iso(f.createdAt) })),
    communityReportsMade: mine.reports.map(r => ({ itemId: r.itemId, reason: r.reason, note: r.note, status: r.status, at: iso(r.createdAt) }))
  };
}

/** Elimina os dados do usuário nestas áreas. Devolve contagens (sem conteúdo). Idempotente. */
export async function eraseUserData(uid) {
  const out = {};
  // Sai de todas as academias; se era o único dono ativo, a academia fica marcada para revisão (os dados dela ficam).
  const memberships = await withContext({ userId: uid }, tx => tx.membership.findMany({ where: { userId: uid, status: { not: 'REMOVED' } } }));
  out.memberships = memberships.length;
  out.orphanedGyms = 0;
  for (const m of memberships) {
    await withContext({ userId: uid, tenantId: m.tenantId }, async tx => {
      await tx.membership.update({ where: { id: m.id }, data: { status: 'REMOVED' } });
      await tx.activityLog.createMany({ data: [{ tenantId: m.tenantId, actorUserId: uid, action: 'member.account-deleted', targetType: 'user', targetId: uid, before: { role: m.role, status: m.status }, after: { status: 'REMOVED' } }] });
      if (m.role === 'GYM_OWNER') {
        const owners = await tx.membership.count({ where: { tenantId: m.tenantId, role: 'GYM_OWNER', status: 'ACTIVE' } });
        if (owners === 0) { await tx.tenant.update({ where: { id: m.tenantId }, data: { status: 'NO_OWNER' } }); out.orphanedGyms++; }
      }
    });
  }
  const r = await withContext({ userId: uid, eraser: uid }, async tx => ({
    profile: (await tx.trainerProfile.deleteMany({ where: { userId: uid } })).count,
    links: (await tx.trainerStudent.deleteMany({ where: { OR: [{ trainerId: uid }, { studentId: uid }] } })).count, // leva junto treinos enviados e comentários
    permissions: (await tx.sharingPermission.deleteMany({ where: { OR: [{ studentId: uid }, { trainerId: uid }] } })).count,
    consent: (await tx.consentRecord.deleteMany({ where: { studentId: uid } })).count,
    access: (await tx.accessLog.deleteMany({ where: { OR: [{ studentId: uid }, { actorId: uid }] } })).count,
    communityItems: (await tx.communityItem.deleteMany({ where: { authorId: uid } })).count,
    favorites: (await tx.communityFavorite.deleteMany({ where: { userId: uid } })).count,
    reports: (await tx.communityReport.deleteMany({ where: { reporterId: uid } })).count
  }));
  await db.user.updateMany({ where: { id: uid }, data: { aiTenantId: null } });
  return { ...out, ...r };
}
