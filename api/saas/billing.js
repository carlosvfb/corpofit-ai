import { db } from "./db.js";
import { PLANS } from "./plans.js";
import { getEntitlements, isPixAutomaticEnabled } from "./access.js";
import { asaasConfigured } from "./asaas/config.js";
/** Métodos de pagamento oferecidos (controlados pelo backend; indisponíveis não são exibidos). */
export async function availablePaymentMethods() {
    if (!asaasConfigured())
        return [];
    const methods = [
        { id: "CREDIT_CARD", label: "Cartão de crédito", description: "Cobrança automática mensal no cartão." },
    ];
    if (await isPixAutomaticEnabled()) {
        methods.push({
            id: "PIX_AUTOMATIC",
            label: "Pix Automático",
            description: "Autorize uma vez no app do seu banco e as próximas cobranças mensais serão debitadas conforme a autorização e as regras do banco.",
        });
    }
    methods.push({
        id: "PIX",
        label: "Pix (pagamento mensal)",
        description: "Você recebe uma nova cobrança Pix a cada mês e precisa efetuar o pagamento de cada uma. Não é débito automático.",
    });
    return methods;
}
export async function getBillingOverview(user) {
    const ent = await getEntitlements(user);
    const sub = await db.subscription.findFirst({
        where: { userId: user.id, tenantId: null },
        orderBy: { createdAt: "desc" },
        select: {
            id: true,
            status: true,
            paymentMethod: true,
            currentPeriodEnd: true,
            graceUntil: true,
            cancelRequestedAt: true,
            canceledAt: true,
            checkoutData: true,
        },
    });
    const payments = await db.payment.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 24,
        select: { id: true, status: true, method: true, valueCents: true, dueDate: true, paidAt: true, invoiceUrl: true },
    });
    const nextCharge = await db.payment.findFirst({
        where: { userId: user.id, status: "PENDING" },
        orderBy: { dueDate: "asc" },
        select: { id: true, dueDate: true, valueCents: true, method: true },
    });
    return {
        plan: { code: ent.planCode, name: ent.plan.name, isPremium: ent.isPremium, source: ent.source },
        premiumPriceCents: PLANS.PREMIUM.priceCents,
        subscription: sub,
        payments,
        nextCharge,
        methods: await availablePaymentMethods(),
    };
}
