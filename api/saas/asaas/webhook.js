import { applyPaymentToSubscription, isAccessCriticalEvent, isPaidStatus, mapAsaasPaymentStatus, paymentStatusFromEvent, subscriptionStatusFromEvent, } from "./status.js";
const isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v, max = 1000) => typeof v === "string" && v.length <= max;
/** Validação mínima do envelope do evento (sem dependências externas). Campos extras são aceitos. */
const envelope = {
    safeParse(v) {
        if (!isObj(v) || !str(v.id, 200) || !v.id || !str(v.event, 100) || !v.event)
            return { success: false };
        return { success: true, data: v };
    },
};
const paymentObj = {
    safeParse(v) {
        if (!isObj(v) || !str(v.id))
            return { success: false };
        const optStr = (k) => v[k] == null || typeof v[k] === "string";
        if (!["customer", "subscription", "status", "dueDate", "invoiceUrl", "paymentDate", "confirmedDate"].every(optStr))
            return { success: false };
        if (v.value != null && typeof v.value !== "number")
            return { success: false };
        return { success: true, data: v };
    },
};
export class WebhookValidationError extends Error {
}
/** Autenticação do webhook: compara em tempo constante o header `asaas-access-token`. */
export function verifyWebhookToken(received, expected) {
    if (!expected || !received)
        return false;
    const a = Buffer.from(received);
    const b = Buffer.from(expected);
    if (a.length !== b.length)
        return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++)
        diff |= a[i] ^ b[i];
    return diff === 0;
}
export class AsaasWebhookService {
    repo;
    client;
    now;
    constructor(repo, client, now = () => new Date()) {
        this.repo = repo;
        this.client = client;
        this.now = now;
    }
    /** Processa um evento de forma idempotente. Lança erro se o processamento falhar (Asaas reentrega). */
    async handle(rawPayload) {
        const parsed = envelope.safeParse(rawPayload);
        if (!parsed.success)
            throw new WebhookValidationError("Estrutura de evento inválida.");
        const payload = parsed.data;
        const refs = this.extractRefs(payload);
        const { created, event } = await this.repo.insertEventIfNew({
            externalEventId: payload.id,
            type: payload.event,
            ...refs,
        });
        if (!created && (event.status === "PROCESSED" || event.status === "IGNORED")) {
            return { outcome: "duplicate" };
        }
        try {
            const result = await this.dispatch(payload);
            await this.repo.updateEvent(payload.id, { status: result.outcome === "ignored" ? "IGNORED" : "PROCESSED" });
            return result;
        }
        catch (err) {
            await this.repo.updateEvent(payload.id, {
                status: "FAILED",
                error: err instanceof Error ? err.message : "erro desconhecido",
            });
            throw err;
        }
    }
    extractRefs(p) {
        const payment = p.payment;
        const sub = p.subscription;
        const auth = p.authorization;
        return {
            asaasPaymentId: payment?.id ?? null,
            asaasSubscriptionId: sub?.id ?? payment?.subscription ?? null,
            asaasAuthorizationId: auth?.id ?? null,
        };
    }
    async dispatch(p) {
        const ev = p.event;
        if (ev.startsWith("PAYMENT_"))
            return this.onPayment(p, ev);
        if (ev.startsWith("SUBSCRIPTION_"))
            return this.onSubscription(p, ev);
        if (ev.startsWith("CHECKOUT_"))
            return this.onCheckout(p, ev);
        if (ev.startsWith("PIX_AUTOMATIC_RECURRING_AUTHORIZATION_"))
            return this.onAuthorization(p, ev);
        // Instruções de pagamento e elegibilidade: registradas, sem efeito sobre o acesso.
        return { outcome: "ignored", reason: "evento sem tratamento" };
    }
    // ---------- Cobranças ----------
    async onPayment(p, ev) {
        const parsed = paymentObj.safeParse(p.payment);
        if (!parsed.success)
            throw new WebhookValidationError("Evento de cobrança sem objeto payment.");
        let payment = parsed.data;
        let status = paymentStatusFromEvent(ev, payment.status);
        if (!status)
            return { outcome: "ignored", reason: "evento de cobrança sem efeito" };
        // Eventos que mudam acesso: confirma o estado atual na API (protege contra eventos fora de ordem e forjados).
        let remote = null;
        if (isAccessCriticalEvent(ev)) {
            remote = await this.client.getPayment(payment.id);
            status = mapAsaasPaymentStatus(remote.status);
            payment = {
                ...payment,
                value: remote.value,
                dueDate: remote.dueDate,
                subscription: remote.subscription ?? payment.subscription,
                customer: remote.customer ?? payment.customer,
                invoiceUrl: remote.invoiceUrl ?? payment.invoiceUrl,
                paymentDate: remote.paymentDate ?? payment.paymentDate,
            };
        }
        const sub = await this.resolveSubscription(payment.subscription ?? null, payment.customer ?? null);
        if (!sub)
            return { outcome: "ignored", reason: "cobrança sem assinatura conhecida" };
        if (!payment.dueDate || payment.value === undefined) {
            remote = remote ?? (await this.client.getPayment(payment.id));
            payment = { ...payment, dueDate: remote.dueDate, value: remote.value };
        }
        const now = this.now();
        const dueDate = new Date(`${payment.dueDate}T12:00:00Z`);
        await this.repo.upsertPayment({
            subscriptionId: sub.id,
            userId: sub.userId,
            asaasPaymentId: payment.id,
            status,
            method: sub.paymentMethod,
            valueCents: Math.round((payment.value ?? 0) * 100),
            dueDate,
            paidAt: isPaidStatus(status) ? (payment.paymentDate ? new Date(`${payment.paymentDate}T12:00:00Z`) : now) : null,
            invoiceUrl: payment.invoiceUrl ?? null,
        });
        const graceDays = await this.repo.getGraceDays();
        const next = applyPaymentToSubscription({ status: sub.status, currentPeriodEnd: sub.currentPeriodEnd, graceUntil: sub.graceUntil }, { status, dueDate }, now, graceDays);
        if (next.status !== sub.status || +(next.currentPeriodEnd ?? 0) !== +(sub.currentPeriodEnd ?? 0) || +(next.graceUntil ?? 0) !== +(sub.graceUntil ?? 0)) {
            await this.repo.updateSubscription(sub.id, next);
        }
        return { outcome: "processed" };
    }
    /** Vincula a cobrança à assinatura interna (por ID remoto; senão, pelo cliente com assinatura pendente). */
    async resolveSubscription(remoteSubId, customerId) {
        if (remoteSubId) {
            const known = await this.repo.findSubscriptionByAsaasId(remoteSubId);
            if (known)
                return known;
            // Assinatura criada pelo checkout hospedado: tenta casar por checkoutSession.
            try {
                const remote = await this.client.getSubscription(remoteSubId);
                if (remote.checkoutSession) {
                    const byCheckout = await this.repo.findSubscriptionByCheckoutId(remote.checkoutSession);
                    if (byCheckout) {
                        await this.repo.updateSubscription(byCheckout.id, { asaasSubscriptionId: remoteSubId });
                        return { ...byCheckout, asaasSubscriptionId: remoteSubId };
                    }
                }
                if (remote.externalReference) {
                    const byRef = await this.repo.findSubscriptionById(remote.externalReference);
                    if (byRef && !byRef.asaasSubscriptionId) {
                        await this.repo.updateSubscription(byRef.id, { asaasSubscriptionId: remoteSubId });
                        return { ...byRef, asaasSubscriptionId: remoteSubId };
                    }
                }
                customerId = customerId ?? remote.customer;
            }
            catch {
                /* segue para o fallback por cliente */
            }
        }
        if (customerId) {
            const pending = await this.repo.findUnlinkedPendingForCustomer(customerId);
            if (pending) {
                if (remoteSubId) {
                    await this.repo.updateSubscription(pending.id, { asaasSubscriptionId: remoteSubId });
                    return { ...pending, asaasSubscriptionId: remoteSubId };
                }
                return pending;
            }
        }
        return null;
    }
    // ---------- Assinaturas ----------
    async onSubscription(p, ev) {
        const sub = p.subscription;
        if (!sub?.id)
            throw new WebhookValidationError("Evento de assinatura sem objeto subscription.");
        let row = await this.repo.findSubscriptionByAsaasId(sub.id);
        if (!row && sub.externalReference) {
            const byRef = await this.repo.findSubscriptionById(sub.externalReference);
            if (byRef && !byRef.asaasSubscriptionId) {
                await this.repo.updateSubscription(byRef.id, { asaasSubscriptionId: sub.id });
                row = { ...byRef, asaasSubscriptionId: sub.id };
            }
        }
        if (!row && sub.customer)
            row = await this.resolveSubscription(sub.id, sub.customer);
        if (!row)
            return { outcome: "ignored", reason: "assinatura desconhecida" };
        const next = subscriptionStatusFromEvent(ev);
        if (next && row.status !== "CANCELED" && row.status !== "EXPIRED") {
            await this.repo.updateSubscription(row.id, { status: next });
        }
        return { outcome: "processed" };
    }
    // ---------- Checkout ----------
    async onCheckout(p, ev) {
        const checkout = p.checkout;
        if (!checkout?.id)
            throw new WebhookValidationError("Evento de checkout sem objeto checkout.");
        const row = await this.repo.findSubscriptionByCheckoutId(checkout.id);
        if (!row)
            return { outcome: "ignored", reason: "checkout desconhecido" };
        // CHECKOUT_PAID NÃO libera Premium: o acesso depende da cobrança confirmada (PAYMENT_*).
        if ((ev === "CHECKOUT_CANCELED" || ev === "CHECKOUT_EXPIRED") && row.status === "PENDING") {
            await this.repo.updateSubscription(row.id, { status: ev === "CHECKOUT_EXPIRED" ? "EXPIRED" : "CANCELED" });
        }
        return { outcome: "processed" };
    }
    // ---------- Pix Automático ----------
    async onAuthorization(p, ev) {
        const auth = p.authorization;
        if (!auth?.id)
            throw new WebhookValidationError("Evento de autorização sem objeto authorization.");
        const row = await this.repo.findSubscriptionByAuthorizationId(auth.id);
        if (!row)
            return { outcome: "ignored", reason: "autorização desconhecida" };
        if (auth.subscriptionId && !row.asaasSubscriptionId) {
            await this.repo.updateSubscription(row.id, { asaasSubscriptionId: auth.subscriptionId });
        }
        // ACTIVATED apenas registra que a recorrência está autorizada; o Premium depende do pagamento confirmado.
        if (ev.endsWith("_REFUSED") || ev.endsWith("_EXPIRED")) {
            if (row.status === "PENDING")
                await this.repo.updateSubscription(row.id, { status: "EXPIRED" });
        }
        else if (ev.endsWith("_CANCELLED")) {
            if (row.status !== "EXPIRED" && row.status !== "CANCELED") {
                await this.repo.updateSubscription(row.id, { status: "CANCELED" });
            }
        }
        return { outcome: "processed" };
    }
}
