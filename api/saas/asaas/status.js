/**
 * PaymentStatusService: único ponto de conversão entre estados do Asaas e estados internos.
 * Assinatura e cobrança são conceitos diferentes e têm mapeamentos separados.
 */
/** Status de cobrança retornado pela API do Asaas → status interno. */
export function mapAsaasPaymentStatus(status) {
    switch (status) {
        case "CONFIRMED":
            return "CONFIRMED";
        case "RECEIVED":
        case "RECEIVED_IN_CASH":
            return "RECEIVED";
        case "OVERDUE":
            return "OVERDUE";
        case "REFUNDED":
        case "REFUND_REQUESTED":
        case "REFUND_IN_PROGRESS":
        case "CHARGEBACK_REQUESTED":
        case "CHARGEBACK_DISPUTE":
        case "AWAITING_CHARGEBACK_REVERSAL":
            return "REFUNDED";
        case "PENDING":
        case "AWAITING_RISK_ANALYSIS":
        case "AUTHORIZED":
        default:
            return "PENDING";
    }
}
/** Evento PAYMENT_* → status interno (quando o evento por si só define o estado). */
export function paymentStatusFromEvent(event, payloadStatus) {
    switch (event) {
        case "PAYMENT_CREATED":
        case "PAYMENT_RESTORED":
            return "PENDING";
        case "PAYMENT_CONFIRMED":
            return "CONFIRMED";
        case "PAYMENT_RECEIVED":
            return "RECEIVED";
        case "PAYMENT_OVERDUE":
            return "OVERDUE";
        case "PAYMENT_REFUNDED":
        case "PAYMENT_PARTIALLY_REFUNDED":
        case "PAYMENT_CHARGEBACK_REQUESTED":
            return "REFUNDED";
        case "PAYMENT_DELETED":
            return "CANCELED";
        case "PAYMENT_CREDIT_CARD_CAPTURE_REFUSED":
        case "PAYMENT_REPROVED_BY_RISK_ANALYSIS":
            return "REFUSED";
        case "PAYMENT_UPDATED":
            return payloadStatus ? mapAsaasPaymentStatus(payloadStatus) : null;
        default:
            return null;
    }
}
/** Eventos que alteram acesso e por isso exigem confirmação do estado atual na API. */
export function isAccessCriticalEvent(event) {
    return [
        "PAYMENT_CONFIRMED",
        "PAYMENT_RECEIVED",
        "PAYMENT_REFUNDED",
        "PAYMENT_CHARGEBACK_REQUESTED",
    ].includes(event);
}
export function isPaidStatus(s) {
    return s === "CONFIRMED" || s === "RECEIVED";
}
export function addMonths(date, months) {
    const d = new Date(date.getTime());
    const day = d.getUTCDate();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() + months);
    const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
    d.setUTCDate(Math.min(day, lastDay));
    return d;
}
/**
 * Regras de transição da assinatura a partir do resultado de UMA cobrança.
 * - Só uma cobrança CONFIRMED/RECEIVED ativa a assinatura (nunca a simples criação).
 * - Vencimento inicia tolerância; reembolso/chargeback suspende o acesso.
 */
export function applyPaymentToSubscription(sub, payment, now, graceDays) {
    if (sub.status === "CANCELED" || sub.status === "EXPIRED") {
        // Encerrada: cobranças tardias não reativam a assinatura.
        return sub;
    }
    switch (payment.status) {
        case "CONFIRMED":
        case "RECEIVED": {
            const base = payment.dueDate > now ? payment.dueDate : now;
            const candidate = addMonths(base, 1);
            const end = sub.currentPeriodEnd && sub.currentPeriodEnd > candidate ? sub.currentPeriodEnd : candidate;
            return { status: "ACTIVE", currentPeriodEnd: end, graceUntil: null };
        }
        case "OVERDUE":
            if (sub.status === "ACTIVE" || sub.status === "PAST_DUE") {
                const grace = sub.graceUntil ?? new Date(now.getTime() + graceDays * 86_400_000);
                return { ...sub, status: "PAST_DUE", graceUntil: grace };
            }
            return sub;
        case "REFUSED":
            if (sub.status === "ACTIVE") {
                return { ...sub, status: "PAST_DUE", graceUntil: new Date(now.getTime() + graceDays * 86_400_000) };
            }
            return sub;
        case "REFUNDED":
            return { status: "SUSPENDED", currentPeriodEnd: now, graceUntil: null };
        case "PENDING":
        case "CANCELED":
        default:
            return sub;
    }
}
/** Evento SUBSCRIPTION_* → novo status (ou null se não altera). */
export function subscriptionStatusFromEvent(event) {
    switch (event) {
        case "SUBSCRIPTION_INACTIVATED":
        case "SUBSCRIPTION_DELETED":
            return "CANCELED";
        default:
            return null;
    }
}
