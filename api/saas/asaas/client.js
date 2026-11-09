import { env } from "../env.js";
import { resolveAsaasBaseUrl } from "./config.js";
export class AsaasApiError extends Error {
    status;
    errors;
    constructor(status, errors) {
        super(errors.map((e) => e.description || e.code).filter(Boolean).join("; ") || `Asaas HTTP ${status}`);
        this.status = status;
        this.errors = errors;
        this.name = "AsaasApiError";
    }
}
export class AsaasTimeoutError extends Error {
    constructor() {
        super("Tempo esgotado ao comunicar com o Asaas.");
        this.name = "AsaasTimeoutError";
    }
}
export class AsaasNetworkError extends Error {
    constructor() {
        super("Falha de comunicação com o Asaas.");
        this.name = "AsaasNetworkError";
    }
}
/**
 * Cliente HTTP do Asaas. Não registra nem inclui a chave de API em erros ou logs.
 * Referência: https://docs.asaas.com/ (autenticação por header `access_token`).
 */
export class AsaasClient {
    opts;
    fetchImpl;
    constructor(opts) {
        this.opts = opts;
        this.fetchImpl = opts.fetchImpl ?? fetch;
    }
    static fromEnv() {
        const e = env();
        if (!e.ASAAS_API_KEY)
            throw new Error("ASAAS_API_KEY não configurada.");
        return new AsaasClient({ apiKey: e.ASAAS_API_KEY, baseUrl: resolveAsaasBaseUrl(e) });
    }
    async request(method, path, init = {}) {
        const url = new URL(this.opts.baseUrl + path);
        for (const [k, v] of Object.entries(init.query ?? {})) {
            if (v !== undefined)
                url.searchParams.set(k, String(v));
        }
        const ctrl = new AbortController();
        // Criação de assinaturas pode demorar: a documentação recomenda >= 60s.
        const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 30_000);
        try {
            const res = await this.fetchImpl(url, {
                method,
                headers: {
                    "Content-Type": "application/json",
                    access_token: this.opts.apiKey,
                    "User-Agent": this.opts.userAgent ?? "CorpoFit AI/0.1",
                },
                // GET/DELETE sem corpo (a API retorna 403 se houver corpo em GET).
                body: init.body !== undefined && method !== "GET" ? JSON.stringify(init.body) : undefined,
                signal: ctrl.signal,
            });
            const text = await res.text();
            let parsed = undefined;
            if (text) {
                try {
                    parsed = JSON.parse(text);
                }
                catch {
                    parsed = undefined;
                }
            }
            if (!res.ok) {
                const errors = parsed?.errors ?? [];
                throw new AsaasApiError(res.status, errors);
            }
            return parsed;
        }
        catch (err) {
            if (err instanceof AsaasApiError)
                throw err;
            if (err instanceof Error && err.name === "AbortError")
                throw new AsaasTimeoutError();
            throw new AsaasNetworkError();
        }
        finally {
            clearTimeout(timer);
        }
    }
    // ---- Clientes ----
    createCustomer(body) {
        return this.request("POST", "/customers", { body });
    }
    listCustomers(query) {
        return this.request("GET", "/customers", { query });
    }
    // ---- Assinaturas ----
    createSubscription(body) {
        return this.request("POST", "/subscriptions", { body, timeoutMs: 60_000 });
    }
    getSubscription(id) {
        return this.request("GET", `/subscriptions/${encodeURIComponent(id)}`);
    }
    listSubscriptions(query) {
        return this.request("GET", "/subscriptions", { query });
    }
    listSubscriptionPayments(id) {
        return this.request("GET", `/subscriptions/${encodeURIComponent(id)}/payments`);
    }
    deleteSubscription(id) {
        return this.request("DELETE", `/subscriptions/${encodeURIComponent(id)}`);
    }
    // ---- Cobranças ----
    getPayment(id) {
        return this.request("GET", `/payments/${encodeURIComponent(id)}`);
    }
    getPixQrCode(paymentId) {
        return this.request("GET", `/payments/${encodeURIComponent(paymentId)}/pixQrCode`);
    }
    // ---- Checkout hospedado ----
    createCheckout(body) {
        return this.request("POST", "/checkouts", { body, timeoutMs: 60_000 });
    }
    // ---- Pix Automático ----
    createPixAutomaticAuthorization(body) {
        return this.request("POST", "/pix/automatic/authorizations", { body, timeoutMs: 60_000 });
    }
    getPixAutomaticAuthorization(id) {
        return this.request("GET", `/pix/automatic/authorizations/${encodeURIComponent(id)}`);
    }
    cancelPixAutomaticAuthorization(id) {
        return this.request("DELETE", `/pix/automatic/authorizations/${encodeURIComponent(id)}`);
    }
    // ---- Webhooks ----
    createWebhook(body) {
        return this.request("POST", "/webhooks", { body });
    }
}
/** Evita expor o tipo de erro do provedor ao usuário. */
export function isTransientAsaasError(err) {
    return (err instanceof AsaasTimeoutError ||
        err instanceof AsaasNetworkError ||
        (err instanceof AsaasApiError && err.status >= 500));
}
