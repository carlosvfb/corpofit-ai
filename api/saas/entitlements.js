import { PLANS } from "./plans.js";
const DAY = 86_400_000;
/** A assinatura concede Premium agora? Regras centralizadas, usadas só no backend. */
export function subscriptionGrantsPremium(sub, now, graceDays) {
    switch (sub.status) {
        case "ACTIVE": {
            // Tolerância para entrega atrasada de webhook após o fim do período pago.
            if (!sub.currentPeriodEnd)
                return false;
            return now.getTime() <= sub.currentPeriodEnd.getTime() + graceDays * DAY;
        }
        case "PAST_DUE":
            return Boolean(sub.graceUntil && sub.graceUntil > now);
        case "CANCELED":
            // Respeita o período já pago.
            return Boolean(sub.currentPeriodEnd && sub.currentPeriodEnd > now);
        default:
            // PENDING, EXPIRED, SUSPENDED: sem benefícios.
            return false;
    }
}
export function computeEntitlements(user, subscriptions, now, graceDays) {
    const manual = user.manualPremium && (!user.manualPremiumUntil || user.manualPremiumUntil > now);
    if (manual)
        return { plan: PLANS.PREMIUM, planCode: "PREMIUM", isPremium: true, source: "manual" };
    if (subscriptions.some((s) => subscriptionGrantsPremium(s, now, graceDays))) {
        return { plan: PLANS.PREMIUM, planCode: "PREMIUM", isPremium: true, source: "subscription" };
    }
    return { plan: PLANS.FREE, planCode: "FREE", isPremium: false, source: "free" };
}
