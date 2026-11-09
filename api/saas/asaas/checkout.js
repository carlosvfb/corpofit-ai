import { db } from "../db.js";
import { env } from "../env.js";
import { PLANS } from "../plans.js";
import { ensureUser, isPixAutomaticEnabled } from "../access.js";
import { AsaasApiError, isTransientAsaasError, } from "./client.js";
import { addMonths } from "./status.js";
export class BillingError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
/** Validação de CPF/CNPJ (dígitos verificadores). */
export function isValidCpfCnpj(raw) {
    const d = raw.replace(/\D/g, "");
    if (/^(\d)\1+$/.test(d))
        return false;
    if (d.length === 11) {
        const calc = (len) => {
            let sum = 0;
            for (let i = 0; i < len; i++)
                sum += Number(d[i]) * (len + 1 - i);
            const r = (sum * 10) % 11;
            return r === 10 ? 0 : r;
        };
        return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
    }
    if (d.length === 14) {
        const calc = (len) => {
            const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
            let sum = 0;
            for (let i = 0; i < len; i++)
                sum += Number(d[i]) * w[i];
            const r = sum % 11;
            return r < 2 ? 0 : 11 - r;
        };
        return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
    }
    return false;
}
function ymd(d) {
    return d.toISOString().slice(0, 10);
}
/** Pixel PNG 1x1 transparente: o Asaas exige `imageBase64` nos itens do checkout. */
const PLACEHOLDER_IMAGE = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
export class AsaasCheckoutService {
    client;
    now;
    constructor(client, now = () => new Date()) {
        this.client = client;
        this.now = now;
    }
    /** Cria ou recupera o cliente Asaas do usuário (sem duplicar). */
    async ensureCustomer(user, cpfCnpj) {
        const existing = await db.billingCustomer.findUnique({ where: { userId: user.id } });
        if (existing)
            return existing.asaasCustomerId;
        let asaasId;
        try {
            // Em retentativa após timeout, o cliente pode já existir remotamente.
            const found = await this.client.listCustomers({ externalReference: user.id, limit: 1 });
            asaasId = found.data[0]?.id;
        }
        catch (err) {
            if (!isTransientAsaasError(err))
                throw err;
        }
        if (!asaasId) {
            const created = await this.client.createCustomer({
                name: user.name,
                email: user.email,
                cpfCnpj: cpfCnpj.replace(/\D/g, ""),
                externalReference: user.id,
                notificationDisabled: false,
            });
            asaasId = created.id;
        }
        try {
            await db.billingCustomer.create({
                data: { userId: user.id, asaasCustomerId: asaasId, documentLast4: cpfCnpj.replace(/\D/g, "").slice(-4) },
            });
        }
        catch (err) {
            if (err.code !== "P2002")
                throw err;
            const again = await db.billingCustomer.findUniqueOrThrow({ where: { userId: user.id } });
            return again.asaasCustomerId;
        }
        return asaasId;
    }
    async start(user, input) {
        await ensureUser(user);
        if (!isValidCpfCnpj(input.cpfCnpj))
            throw new BillingError(400, "CPF ou CNPJ inválido.");
        if (input.method === "PIX_AUTOMATIC" && !(await isPixAutomaticEnabled())) {
            throw new BillingError(400, "Pix Automático não está disponível no momento.");
        }
        // Já possui assinatura ativa/em andamento? Evita duplicidade.
        const open = await db.subscription.findMany({
            where: { userId: user.id, status: { in: ["PENDING", "ACTIVE", "PAST_DUE"] } },
            orderBy: { createdAt: "desc" },
        });
        const live = open.find((s) => s.status === "ACTIVE" || s.status === "PAST_DUE");
        if (live)
            throw new BillingError(409, "Você já possui uma assinatura Premium ativa.");
        // Reaproveita pendência do mesmo método (ainda com dados de pagamento) ou abandona as demais.
        const pendingSame = open.find((s) => s.status === "PENDING" && s.paymentMethod === input.method);
        for (const p of open.filter((s) => s.status === "PENDING" && s !== pendingSame)) {
            await this.abandon(p);
        }
        const plan = PLANS.PREMIUM; // preço sempre vem do servidor
        const customerId = await this.ensureCustomer(user, input.cpfCnpj);
        let sub;
        if (pendingSame) {
            const reusable = this.reuse(pendingSame);
            if (reusable)
                return reusable;
            sub = pendingSame;
        }
        else {
            sub = await db.subscription.create({
                data: {
                    userId: user.id,
                    planCode: "PREMIUM",
                    paymentMethod: input.method,
                    status: "PENDING",
                    idempotencyKey: `${user.id}:${input.method}:${this.now().getTime()}`,
                },
            });
        }
        try {
            switch (input.method) {
                case "CREDIT_CARD":
                    return await this.startCard(sub, customerId, plan.priceCents);
                case "PIX":
                    return await this.startPix(sub, customerId, plan.priceCents);
                case "PIX_AUTOMATIC":
                    return await this.startPixAutomatic(sub, customerId, plan.priceCents);
            }
        }
        catch (err) {
            throw this.translate(err);
        }
    }
    reuse(sub) {
        const data = sub.checkoutData;
        if (!data)
            return null;
        if (data.expiresAt && new Date(data.expiresAt) < this.now())
            return null;
        if (sub.paymentMethod === "CREDIT_CARD" && data.url) {
            return { kind: "redirect", subscriptionId: sub.id, url: data.url };
        }
        if (sub.paymentMethod === "PIX" && data.payload) {
            return { kind: "pix", subscriptionId: sub.id, payload: data.payload, image: data.image ?? null, expiresAt: data.expiresAt ?? null, dueDate: data.dueDate ?? ymd(this.now()) };
        }
        if (sub.paymentMethod === "PIX_AUTOMATIC" && data.payload) {
            return { kind: "pix_automatic", subscriptionId: sub.id, payload: data.payload, image: data.image ?? null, expiresAt: data.expiresAt ?? null };
        }
        return null;
    }
    // Cartão: checkout hospedado (dados do cartão nunca passam pelo nosso servidor).
    // Nem `customer` (cadastro sem telefone/endereço) nem `customerData` (exige nome, telefone e
    // endereço completos) seguem daqui: o Asaas recusa os dois. Sem eles, a página segura do
    // Asaas pede ao comprador os dados que o cartão exige.
    async startCard(sub, customerId, priceCents) {
        const e = env();
        const due = this.now();
        const checkout = await this.client.createCheckout({
            billingTypes: ["CREDIT_CARD"],
            chargeTypes: ["RECURRENT"],
            minutesToExpire: 60,
            externalReference: sub.id,
            callback: {
                successUrl: e.ASAAS_SUCCESS_URL ?? `${e.APP_URL}/#/checkout/sucesso`,
                cancelUrl: e.ASAAS_CANCEL_URL ?? `${e.APP_URL}/#/checkout/cancelado`,
                expiredUrl: e.ASAAS_EXPIRED_URL ?? `${e.APP_URL}/#/checkout/expirado`,
            },
            items: [
                {
                    name: "CorpoFit AI Premium",
                    description: "Assinatura mensal CorpoFit AI Premium",
                    quantity: 1,
                    value: priceCents / 100,
                    imageBase64: PLACEHOLDER_IMAGE,
                },
            ],
            subscription: {
                cycle: "MONTHLY",
                nextDueDate: `${ymd(due)} 12:00:00`,
                endDate: `${ymd(addMonths(due, 120))} 12:00:00`,
            },
        });
        if (!checkout.link)
            throw new BillingError(502, "O Asaas não retornou o link de pagamento.");
        await db.subscription.update({
            where: { id: sub.id },
            data: { asaasCheckoutId: checkout.id, checkoutData: { url: checkout.link } },
        });
        return { kind: "redirect", subscriptionId: sub.id, url: checkout.link };
    }
    // Pix convencional: assinatura Asaas que gera uma cobrança Pix por ciclo.
    async startPix(sub, customerId, priceCents) {
        const dueDate = ymd(this.now());
        let remoteId = sub.asaasSubscriptionId;
        if (!remoteId) {
            remoteId = await this.createOrAdoptPixSubscription(sub, customerId, priceCents, dueDate);
            await db.subscription.update({ where: { id: sub.id }, data: { asaasSubscriptionId: remoteId } });
        }
        const list = await this.client.listSubscriptionPayments(remoteId);
        const first = list.data[0];
        if (!first)
            throw new BillingError(502, "A cobrança Pix ainda está sendo gerada. Tente novamente em instantes.");
        const qr = await this.client.getPixQrCode(first.id);
        const data = { payload: qr.payload, image: qr.encodedImage, expiresAt: qr.expirationDate ?? null, dueDate: first.dueDate };
        await db.payment.upsert({
            where: { asaasPaymentId: first.id },
            create: {
                subscriptionId: sub.id,
                userId: sub.userId,
                asaasPaymentId: first.id,
                status: "PENDING",
                method: "PIX",
                valueCents: priceCents,
                dueDate: new Date(`${first.dueDate}T12:00:00Z`),
                pixPayload: qr.payload,
                pixExpiresAt: qr.expirationDate ? new Date(qr.expirationDate) : null,
                isInitial: true,
                invoiceUrl: first.invoiceUrl ?? null,
            },
            update: { pixPayload: qr.payload, pixExpiresAt: qr.expirationDate ? new Date(qr.expirationDate) : null },
        });
        await db.subscription.update({ where: { id: sub.id }, data: { checkoutData: data } });
        return { kind: "pix", subscriptionId: sub.id, payload: qr.payload, image: qr.encodedImage, expiresAt: qr.expirationDate ?? null, dueDate: first.dueDate };
    }
    /** Cria a assinatura; em timeout/falha de rede, verifica se ela já foi criada antes de tentar de novo. */
    async createOrAdoptPixSubscription(sub, customerId, priceCents, dueDate) {
        try {
            const created = await this.client.createSubscription({
                customer: customerId,
                billingType: "PIX",
                value: priceCents / 100,
                nextDueDate: dueDate,
                cycle: "MONTHLY",
                description: "CorpoFit AI Premium (mensal)",
                externalReference: sub.id,
            });
            return created.id;
        }
        catch (err) {
            if (isTransientAsaasError(err)) {
                const found = await this.client.listSubscriptions({ externalReference: sub.id, limit: 1 });
                const existing = found.data[0];
                if (existing)
                    return existing.id;
            }
            throw err;
        }
    }
    // Pix Automático: autorização + primeira cobrança no mesmo QR Code.
    async startPixAutomatic(sub, customerId, priceCents) {
        const start = this.now();
        let auth;
        try {
            auth = await this.client.createPixAutomaticAuthorization({
                frequency: "MONTHLY",
                contractId: sub.id.slice(0, 35),
                startDate: ymd(start),
                customerId,
                description: "CorpoFit AI Premium",
                value: priceCents / 100,
                paymentCreationMode: "SUBSCRIPTION",
                immediateQrCode: {
                    expirationSeconds: 3600,
                    originalValue: priceCents / 100,
                    description: "CorpoFit AI Premium",
                },
            });
        }
        catch (err) {
            if (err instanceof AsaasApiError && (err.status === 403 || err.status === 400)) {
                throw new BillingError(422, "Pix Automático indisponível para esta conta no momento. Escolha Pix ou cartão.");
            }
            throw err;
        }
        if (!auth.payload)
            throw new BillingError(502, "O Asaas não retornou o QR Code de autorização.");
        const expiresAt = auth.immediateQrCode?.expirationDate ?? null;
        await db.subscription.update({
            where: { id: sub.id },
            data: {
                asaasAuthorizationId: auth.id,
                asaasSubscriptionId: auth.subscriptionId ?? undefined,
                checkoutData: { payload: auth.payload, image: auth.encodedImage ?? null, expiresAt },
            },
        });
        return { kind: "pix_automatic", subscriptionId: sub.id, payload: auth.payload, image: auth.encodedImage ?? null, expiresAt };
    }
    /** Abandona uma pendência (outro método escolhido) cancelando recursos remotos. */
    async abandon(sub) {
        try {
            if (sub.asaasAuthorizationId)
                await this.client.cancelPixAutomaticAuthorization(sub.asaasAuthorizationId);
            if (sub.asaasSubscriptionId)
                await this.client.deleteSubscription(sub.asaasSubscriptionId);
        }
        catch (err) {
            if (!(err instanceof AsaasApiError && err.status === 404))
                throw this.translate(err);
        }
        await db.subscription.update({ where: { id: sub.id }, data: { status: "CANCELED", canceledAt: this.now() } });
    }
    translate(err) {
        if (err instanceof BillingError)
            return err;
        if (err instanceof AsaasApiError) {
            if (err.status === 401)
                return new BillingError(502, "Integração de pagamentos não autorizada. Contate o suporte.");
            if (err.status === 400)
                return new BillingError(400, `Pagamento recusado pelo provedor: ${err.message}`);
            return new BillingError(502, "O provedor de pagamentos retornou um erro. Tente novamente.");
        }
        if (isTransientAsaasError(err)) {
            return new BillingError(503, "O provedor de pagamentos não respondeu. Verifique seu histórico antes de tentar novamente.");
        }
        return err instanceof Error ? err : new Error("Erro desconhecido");
    }
}
