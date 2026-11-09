import { db } from "../db.js";
import { AsaasApiError } from "./client.js";
import { BillingError } from "./checkout.js";
/**
 * Cancelamento: só marca CANCELED após o Asaas confirmar a remoção.
 * O Premium continua até o fim do período já pago (ver entitlements).
 */
export async function cancelSubscription(client, userId, now = new Date()) {
    const sub = await db.subscription.findFirst({
        where: { userId, status: { in: ["PENDING", "ACTIVE", "PAST_DUE"] } },
        orderBy: { createdAt: "desc" },
    });
    if (!sub)
        throw new BillingError(404, "Você não possui assinatura para cancelar.");
    await db.subscription.update({ where: { id: sub.id }, data: { cancelRequestedAt: now } });
    try {
        if (sub.asaasAuthorizationId) {
            try {
                await client.cancelPixAutomaticAuthorization(sub.asaasAuthorizationId);
            }
            catch (err) {
                if (!(err instanceof AsaasApiError && err.status === 404))
                    throw err;
            }
        }
        if (sub.asaasSubscriptionId) {
            const res = await client.deleteSubscription(sub.asaasSubscriptionId);
            if (!res.deleted)
                throw new BillingError(502, "O Asaas não confirmou o cancelamento. Tente novamente.");
        }
    }
    catch (err) {
        if (err instanceof AsaasApiError && err.status === 404) {
            // Já removida no Asaas: considera cancelada.
        }
        else if (err instanceof BillingError) {
            throw err;
        }
        else {
            throw new BillingError(503, "Não foi possível confirmar o cancelamento com o provedor. Tente novamente.");
        }
    }
    return db.subscription.update({
        where: { id: sub.id },
        data: { status: "CANCELED", canceledAt: now },
    });
}
