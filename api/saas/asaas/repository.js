import { db } from "../db.js";
import { getGraceDays } from "../access.js";
const subSelect = {
    id: true,
    userId: true,
    status: true,
    paymentMethod: true,
    asaasSubscriptionId: true,
    asaasAuthorizationId: true,
    asaasCheckoutId: true,
    currentPeriodEnd: true,
    graceUntil: true,
};
export class PrismaBillingRepository {
    async insertEventIfNew(e) {
        try {
            const event = await db.paymentEvent.create({
                data: {
                    externalEventId: e.externalEventId,
                    type: e.type,
                    asaasPaymentId: e.asaasPaymentId ?? null,
                    asaasSubscriptionId: e.asaasSubscriptionId ?? null,
                    asaasAuthorizationId: e.asaasAuthorizationId ?? null,
                },
                select: { externalEventId: true, status: true },
            });
            return { created: true, event };
        }
        catch (err) {
            if (err.code === "P2002") {
                const event = await db.paymentEvent.findUniqueOrThrow({
                    where: { externalEventId: e.externalEventId },
                    select: { externalEventId: true, status: true },
                });
                return { created: false, event };
            }
            throw err;
        }
    }
    async updateEvent(externalEventId, patch) {
        await db.paymentEvent.update({
            where: { externalEventId },
            data: {
                status: patch.status,
                error: patch.error ? patch.error.slice(0, 500) : null,
                processedAt: patch.status === "RECEIVED" ? null : new Date(),
            },
        });
    }
    findSubscriptionByAsaasId(id) {
        return db.subscription.findUnique({ where: { asaasSubscriptionId: id }, select: subSelect });
    }
    findSubscriptionByAuthorizationId(id) {
        return db.subscription.findUnique({ where: { asaasAuthorizationId: id }, select: subSelect });
    }
    findSubscriptionByCheckoutId(id) {
        return db.subscription.findFirst({ where: { asaasCheckoutId: id }, select: subSelect });
    }
    findSubscriptionById(id) {
        return db.subscription.findUnique({ where: { id }, select: subSelect });
    }
    async findUnlinkedPendingForCustomer(asaasCustomerId) {
        const bc = await db.billingCustomer.findUnique({ where: { asaasCustomerId } });
        if (!bc)
            return null;
        return db.subscription.findFirst({
            where: { userId: bc.userId, status: "PENDING", asaasSubscriptionId: null },
            orderBy: { createdAt: "desc" },
            select: subSelect,
        });
    }
    async updateSubscription(id, patch) {
        await db.subscription.update({ where: { id }, data: patch });
    }
    async upsertPayment(p) {
        const existing = await db.payment.findUnique({ where: { asaasPaymentId: p.asaasPaymentId } });
        if (existing) {
            return db.payment.update({
                where: { id: existing.id },
                data: {
                    status: p.status,
                    valueCents: p.valueCents,
                    dueDate: p.dueDate,
                    paidAt: p.paidAt ?? existing.paidAt,
                    refundedAt: p.status === "REFUNDED" ? (existing.refundedAt ?? new Date()) : existing.refundedAt,
                    invoiceUrl: p.invoiceUrl ?? existing.invoiceUrl,
                },
                select: { id: true, asaasPaymentId: true, status: true },
            });
        }
        const count = await db.payment.count({ where: { subscriptionId: p.subscriptionId } });
        return db.payment.create({
            data: {
                subscriptionId: p.subscriptionId,
                userId: p.userId,
                asaasPaymentId: p.asaasPaymentId,
                status: p.status,
                method: p.method,
                valueCents: p.valueCents,
                dueDate: p.dueDate,
                paidAt: p.paidAt ?? null,
                invoiceUrl: p.invoiceUrl ?? null,
                isInitial: count === 0,
            },
            select: { id: true, asaasPaymentId: true, status: true },
        });
    }
    getGraceDays() {
        return getGraceDays();
    }
}
