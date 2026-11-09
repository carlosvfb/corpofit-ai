/* Biblioteca comunitária: rotinas, dicas e artigos que um usuário publica para todos (PUBLIC) ou só para a
   própria academia (GYM). O que entra é higienizado no servidor: sem pesos, mídia, links nem dados pessoais
   óbvios (e-mail, telefone, CPF), e o autor confirma que pode compartilhar. Visibilidade, autoria e moderação
   são conferidas aqui e no banco (RLS). Nada de mídia licenciada circula: o conteúdo é texto e estrutura de treino. */
import { db } from '../db.js';
import { SaasError } from '../errors.js';
import { ensureUser } from '../access.js';
import { withContext } from './context.js';
import { can, rankOf } from './rbac.js';

const NOT_FOUND = () => new SaasError(404, 'Conteúdo não encontrado.', 'not-found');
const FORBIDDEN = () => new SaasError(403, 'Você não tem permissão para isso.', 'forbidden');
const KINDS = ['ROUTINE', 'PLAN', 'TIP', 'ARTICLE'];
const PUBLISHABLE = ['ROUTINE', 'TIP', 'ARTICLE']; // PLAN existe no modelo; a publicação de planos completos fica para depois
const REASONS = ['INAPPROPRIATE', 'COPYRIGHT', 'PERSONAL_DATA', 'SPAM', 'OTHER'];
const MAX_BUNDLE = 40_000;
const PER_DAY = 10;
const AUTO_HIDE_AT = 3; // denúncias abertas de pessoas diferentes escondem o item até um moderador decidir
const uuidish = v => typeof v === 'string' && /^[0-9a-z-]{10,40}$/i.test(v);

const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\r\n/g, '\n').trim().slice(0, max) : '');

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]{2,}/;
const CPF = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/;
const PHONE = /(?:\+?\d[\s().-]*){10,}/;
/** Dados pessoais óbvios num texto: e-mail, CPF ou telefone. Não é à prova de tudo; é a primeira barreira. */
export const hasPersonalData = t => typeof t === 'string' && (EMAIL.test(t) || CPF.test(t) || PHONE.test(t));

// Chaves que nunca ficam num treino publicado: mídia e links (direitos), pesos (dado do autor) e quem enviou.
const STRIP = new Set(['media', 'photo', 'photos', 'image', 'images', 'img', 'video', 'videos', 'url', 'link', 'links', 'hash', 'picture', 'pic', 'weight', 'pyramidWeight', 'from', 'email', 'phone']);
function sanitizeDeep(v, depth = 0) {
  if (depth > 8) return undefined;
  if (Array.isArray(v)) return v.slice(0, 200).map(x => sanitizeDeep(x, depth + 1));
  if (v && typeof v === 'object') {
    const out = {};
    for (const [k, x] of Object.entries(v)) { if (!STRIP.has(k) && !k.startsWith('_')) out[k] = sanitizeDeep(x, depth + 1); }
    return out;
  }
  return v;
}
function collectStrings(v, acc = []) {
  if (typeof v === 'string') acc.push(v);
  else if (Array.isArray(v)) v.forEach(x => collectStrings(x, acc));
  else if (v && typeof v === 'object') Object.values(v).forEach(x => collectStrings(x, acc));
  return acc;
}

/** A rotina higienizada, ou lança. Exatamente uma rotina, de 1 a 40 exercícios, sem dados pessoais. */
export function cleanRoutineBundle(b) {
  if (!b || typeof b !== 'object' || Array.isArray(b) || !Array.isArray(b.routines) || b.routines.length !== 1) throw new SaasError(400, 'O treino precisa ter exatamente uma rotina.', 'invalid-bundle');
  const r = b.routines[0];
  if (!r || typeof r !== 'object' || !Array.isArray(r.ex) || r.ex.length < 1 || r.ex.length > 40) throw new SaasError(400, 'A rotina precisa ter de 1 a 40 exercícios.', 'invalid-bundle');
  const out = sanitizeDeep(b);
  const json = JSON.stringify(out);
  if (json.length > MAX_BUNDLE) throw new SaasError(413, 'Esse treino é grande demais para a biblioteca.', 'bundle-too-big');
  if (collectStrings(out).some(hasPersonalData)) throw new SaasError(400, 'O treino contém algo que parece dado pessoal (e-mail, telefone ou CPF). Remova antes de publicar.', 'personal-data');
  return out;
}

const names = async ids => {
  const users = await db.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, name: true } });
  return new Map(users.map(u => [u.id, u.name]));
};
const card = (i, me, who, favs) => ({
  id: i.id, kind: i.kind, title: i.title, description: i.description, excerpt: i.body ? i.body.slice(0, 200) : '',
  visibility: i.visibility, tenantId: i.tenantId, status: i.status, imports: i.imports, createdAt: i.createdAt,
  author: who.get(i.authorId) || 'Usuário', mine: i.authorId === me, favorited: favs.has(i.id)
});

/* -------------------------------- publicar -------------------------------- */

export async function publish(user, input) {
  const kind = input?.kind;
  if (!PUBLISHABLE.includes(kind)) throw new SaasError(400, 'Tipo de conteúdo inválido.', 'invalid-kind');
  if (input?.rightsConfirmed !== true) throw new SaasError(400, 'Confirme que o conteúdo é seu e que você pode compartilhá-lo.', 'rights-required');
  const title = clean(input?.title, 80);
  if (title.length < 3) throw new SaasError(400, 'Dê um título de pelo menos 3 letras.', 'invalid-title');
  const description = clean(input?.description, 500);
  const body = kind === 'ROUTINE' ? '' : clean(input?.body, kind === 'TIP' ? 1000 : 8000);
  if (kind !== 'ROUTINE' && body.length < 20) throw new SaasError(400, 'Escreva pelo menos 20 caracteres.', 'invalid-body');
  if ([title, description, body].some(hasPersonalData)) throw new SaasError(400, 'O texto contém algo que parece dado pessoal (e-mail, telefone ou CPF). Remova antes de publicar.', 'personal-data');
  const bundle = kind === 'ROUTINE' ? cleanRoutineBundle(input?.bundle) : null;
  const visibility = input?.visibility === 'GYM' ? 'GYM' : 'PUBLIC';
  const tenantId = visibility === 'GYM' ? String(input?.tenantId || '') : '';
  if (visibility === 'GYM' && !uuidish(tenantId)) throw NOT_FOUND();
  await ensureUser(user);
  return withContext({ userId: user.id, tenantId }, async tx => {
    if (visibility === 'GYM') {
      const m = await tx.membership.findUnique({ where: { tenantId_userId: { tenantId, userId: user.id } } });
      if (!m || m.status !== 'ACTIVE') throw NOT_FOUND();
      if (rankOf(m.role) < rankOf('PERSONAL_TRAINER')) throw FORBIDDEN();
    }
    const since = new Date(Date.now() - 86_400_000);
    if ((await tx.communityItem.count({ where: { authorId: user.id, createdAt: { gte: since } } })) >= PER_DAY) throw new SaasError(429, 'Você publicou muito hoje. Tente de novo amanhã.', 'rate-limited');
    const i = await tx.communityItem.create({ data: { authorId: user.id, tenantId: visibility === 'GYM' ? tenantId : null, kind, visibility, title, description, body, bundle: bundle ?? undefined, rightsConfirmed: true } });
    return card(i, user.id, new Map([[user.id, user.name]]), new Set());
  });
}

export async function removeOwn(user, id) {
  return withContext({ userId: user.id }, async tx => {
    const i = await tx.communityItem.findUnique({ where: { id: String(id) } });
    if (!i || i.authorId !== user.id) throw NOT_FOUND();
    await tx.communityItem.update({ where: { id: i.id }, data: { status: 'REMOVED' } });
    return { removed: true };
  });
}

/* -------------------------------- explorar -------------------------------- */

export async function list(user, { kind, q, scope = 'public', tenantId, favorites, mine, limit = 30, offset = 0 } = {}) {
  const take = Math.max(1, Math.min(50, Number(limit) || 30));
  const skip = Math.max(0, Math.min(10_000, Number(offset) || 0));
  const text = clean(q, 60);
  const gym = scope === 'gym';
  if (gym && !uuidish(String(tenantId || ''))) throw NOT_FOUND();
  const rows = await withContext({ userId: user.id, tenantId: gym ? String(tenantId) : '' }, async tx => {
    const where = {
      status: mine ? { in: ['PUBLISHED', 'HIDDEN'] } : 'PUBLISHED',
      ...(mine ? { authorId: user.id } : gym ? { visibility: 'GYM', tenantId: String(tenantId) } : { visibility: 'PUBLIC' }),
      ...(kind && KINDS.includes(kind) ? { kind } : {}),
      ...(text ? { OR: [{ title: { contains: text, mode: 'insensitive' } }, { description: { contains: text, mode: 'insensitive' } }] } : {})
    };
    if (favorites) where.favorites = { some: { userId: user.id } };
    const items = await tx.communityItem.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip });
    const favs = await tx.communityFavorite.findMany({ where: { userId: user.id, itemId: { in: items.map(i => i.id) } } });
    return { items, favs: new Set(favs.map(f => f.itemId)) };
  });
  const who = await names(rows.items.map(i => i.authorId));
  return rows.items.map(i => card(i, user.id, who, rows.favs));
}

export async function get(user, id, tenantId = '') {
  const r = await withContext({ userId: user.id, tenantId: uuidish(String(tenantId)) ? String(tenantId) : '' }, async tx => {
    const i = await tx.communityItem.findUnique({ where: { id: String(id) } });
    if (!i || i.status === 'REMOVED' || (i.status === 'HIDDEN' && i.authorId !== user.id)) throw NOT_FOUND();
    const fav = await tx.communityFavorite.findUnique({ where: { userId_itemId: { userId: user.id, itemId: i.id } } });
    return { i, fav: !!fav };
  });
  const who = await names([r.i.authorId]);
  return { ...card(r.i, user.id, who, new Set(r.fav ? [r.i.id] : [])), body: r.i.body, bundle: r.i.bundle };
}

export async function favorite(user, id, on) {
  return withContext({ userId: user.id }, async tx => {
    const i = await tx.communityItem.findUnique({ where: { id: String(id) } });
    if (!i || i.status !== 'PUBLISHED') throw NOT_FOUND();
    if (on) await tx.communityFavorite.upsert({ where: { userId_itemId: { userId: user.id, itemId: i.id } }, create: { userId: user.id, itemId: i.id }, update: {} });
    else await tx.communityFavorite.deleteMany({ where: { userId: user.id, itemId: i.id } });
    return { id: i.id, favorited: !!on };
  });
}

/** Importar: devolve o treino higienizado para o app do usuário aplicar. Só rotinas (e planos) publicados e visíveis a ele. */
export async function importItem(user, id, tenantId = '') {
  const ctxTenant = uuidish(String(tenantId)) ? String(tenantId) : '';
  const found = await withContext({ userId: user.id, tenantId: ctxTenant }, async tx => {
    const i = await tx.communityItem.findUnique({ where: { id: String(id) } });
    if (!i || i.status !== 'PUBLISHED' || !i.bundle || !['ROUTINE', 'PLAN'].includes(i.kind)) throw NOT_FOUND();
    return i;
  });
  // A contagem passa por uma permissão de um item só (app.counter), concedida aqui depois de a leitura acima já ter provado a visibilidade.
  await withContext({ userId: user.id, counter: found.id }, tx => tx.communityItem.update({ where: { id: found.id }, data: { imports: { increment: 1 } } }));
  const who = await names([found.authorId]);
  return { id: found.id, kind: found.kind, title: found.title, author: who.get(found.authorId) || 'Usuário', bundle: found.bundle };
}

/* ---------------------------- denúncias e moderação ---------------------------- */

export async function report(user, id, reason, note) {
  if (!REASONS.includes(reason)) throw new SaasError(400, 'Escolha o motivo da denúncia.', 'invalid-reason');
  const item = await withContext({ userId: user.id }, async tx => {
    const i = await tx.communityItem.findUnique({ where: { id: String(id) } });
    if (!i || i.status !== 'PUBLISHED') throw NOT_FOUND();
    if (i.authorId === user.id) throw new SaasError(400, 'Você não pode denunciar o seu próprio conteúdo.', 'own-item');
    try {
      await tx.communityReport.createMany({ data: [{ itemId: i.id, reporterId: user.id, reason, note: clean(note, 500) }] });
    } catch (e) { throw e; }
    return i;
  }).catch(e => { if (e?.code === 'P2002') throw new SaasError(409, 'Você já denunciou este conteúdo.', 'already-reported'); throw e; });
  // Várias pessoas diferentes: o item fica oculto até um moderador decidir (passo do servidor, não do denunciante).
  const open = await withContext({ userId: 'system', moderator: 'platform' }, tx => tx.communityReport.count({ where: { itemId: item.id, status: 'OPEN' } }));
  if (open >= AUTO_HIDE_AT) await withContext({ userId: 'system', moderator: 'platform' }, tx => tx.communityItem.update({ where: { id: item.id }, data: { status: 'HIDDEN' } }));
  return { reported: true };
}

/** Quem modera: o admin da plataforma (tudo) ou dono/admin da academia (só o conteúdo dela). */
async function moderatorFor(user, { platform, tenantId }) {
  if (platform) return { moderator: 'platform', tenantId: '' };
  if (!uuidish(String(tenantId || ''))) throw NOT_FOUND();
  const m = await withContext({ userId: user.id, tenantId: String(tenantId) }, tx => tx.membership.findUnique({ where: { tenantId_userId: { tenantId: String(tenantId), userId: user.id } } }));
  if (!m || m.status !== 'ACTIVE') throw NOT_FOUND();
  if (!can(m, 'community:moderate')) throw FORBIDDEN();
  return { moderator: 'tenant:' + tenantId, tenantId: String(tenantId) };
}

export async function moderationQueue(user, { platform = false, tenantId } = {}) {
  const ctx = await moderatorFor(user, { platform, tenantId });
  const rows = await withContext({ userId: user.id, ...ctx }, async tx => {
    const reports = await tx.communityReport.findMany({ where: { status: 'OPEN', ...(platform ? {} : { item: { tenantId: ctx.tenantId } }) }, orderBy: { createdAt: 'desc' }, take: 200 });
    const items = await tx.communityItem.findMany({ where: { id: { in: [...new Set(reports.map(r => r.itemId))] } } });
    return { reports, items };
  });
  const who = await names(rows.items.map(i => i.authorId));
  return rows.items.map(i => {
    const rs = rows.reports.filter(r => r.itemId === i.id);
    return { ...card(i, user.id, who, new Set()), reports: rs.map(r => ({ id: r.id, reason: r.reason, note: r.note, at: r.createdAt })) };
  });
}

/** hide: oculta e fecha as denúncias; restore: volta a publicar; dismiss: mantém publicado e arquiva as denúncias. */
export async function moderate(user, id, action, { platform = false, tenantId } = {}) {
  if (!['hide', 'restore', 'dismiss'].includes(action)) throw new SaasError(400, 'Ação inválida.', 'invalid-action');
  const ctx = await moderatorFor(user, { platform, tenantId });
  return withContext({ userId: user.id, ...ctx }, async tx => {
    const i = await tx.communityItem.findUnique({ where: { id: String(id) } });
    if (!i || i.status === 'REMOVED' || (!platform && i.tenantId !== ctx.tenantId)) throw NOT_FOUND();
    const status = action === 'hide' ? 'HIDDEN' : 'PUBLISHED';
    if (i.status !== status) await tx.communityItem.update({ where: { id: i.id }, data: { status } });
    await tx.communityReport.updateMany({ where: { itemId: i.id, status: 'OPEN' }, data: { status: 'RESOLVED', decision: action, resolvedBy: user.id } });
    if (i.tenantId && ctx.tenantId === i.tenantId) await tx.activityLog.createMany({ data: [{ tenantId: i.tenantId, actorUserId: user.id, action: 'community.' + action, targetType: 'community-item', targetId: i.id, before: { status: i.status }, after: { status } }] });
    return { id: i.id, status };
  });
}
