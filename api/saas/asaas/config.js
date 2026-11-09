import { env } from "../env.js";
export const ASAAS_BASE_URLS = {
    sandbox: "https://api-sandbox.asaas.com/v3",
    production: "https://api.asaas.com/v3",
};
/** URL base conforme ambiente; ASAAS_API_BASE_URL sobrescreve quando definida. */
export function resolveAsaasBaseUrl(e) {
    const custom = e.ASAAS_API_BASE_URL?.trim();
    return (custom || ASAAS_BASE_URLS[e.ASAAS_ENV]).replace(/\/+$/, "");
}
export function asaasConfigured() {
    return Boolean(env().ASAAS_API_KEY);
}
