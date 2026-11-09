import { db } from "./db.js";
import { DEFAULT_GRACE_DAYS } from "./plans.js";
import { computeEntitlements } from "./entitlements.js";
export async function getSetting(key) {
    const row = await db.appSetting.findUnique({ where: { key } });
    return row?.value ?? null;
}
export async function setSetting(key, value) {
    await db.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}
export async function getGraceDays() {
    const raw = await getSetting("graceDays");
    if (raw === null || raw.trim() === "")
        return DEFAULT_GRACE_DAYS;
    const v = Number(raw);
    return Number.isInteger(v) && v >= 0 && v <= 30 ? v : DEFAULT_GRACE_DAYS;
}
export async function isPixAutomaticEnabled() {
    return (await getSetting("pixAutomaticEnabled")) === "true";
}
/** Espelha o perfil do openGym no Postgres (mesmo id). Idempotente. */
export async function ensureUser(user, { isAdmin = false } = {}) {
    return db.user.upsert({
        where: { id: user.id },
        create: { id: user.id, name: user.name || "Perfil", email: user.email || null, isAdmin },
        update: { name: user.name || "Perfil", email: user.email || null, isAdmin },
    });
}
/** Fonte única do plano/benefícios do usuário. Toda checagem de acesso passa por aqui. */
export async function getEntitlements(userOrId) {
    const id = typeof userOrId === "string" ? userOrId : userOrId.id;
    const [row, subs, graceDays] = await Promise.all([
        db.user.findUnique({ where: { id }, select: { manualPremium: true, manualPremiumUntil: true } }),
        db.subscription.findMany({
            where: { userId: id, tenantId: null },
            select: { status: true, currentPeriodEnd: true, graceUntil: true },
        }),
        getGraceDays(),
    ]);
    return computeEntitlements(row ?? { manualPremium: false, manualPremiumUntil: null }, subs, new Date(), graceDays);
}
