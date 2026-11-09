/* Variáveis de ambiente do CorpoFit AI, lidas sob demanda (testes podem trocá-las entre casos).
   Strings vazias contam como não definidas. Nada aqui é enviado ao navegador. */

const get = k => {
  const v = process.env[k];
  return v === undefined || v === '' ? undefined : v;
};
const num = (k, d, min = -Infinity, max = Infinity) => {
  const v = Number(get(k));
  return Number.isFinite(v) && v >= min && v <= max ? v : d;
};

export function env() {
  const asaasEnv = get('ASAAS_ENV') === 'production' ? 'production' : 'sandbox';
  const origin = get('ORIGIN') || get('APP_URL') || 'http://localhost:8080';
  return {
    APP_URL: (get('APP_URL') || origin).replace(/\/+$/, ''),
    DATABASE_URL: get('DATABASE_URL'),
    SOURCE_CODE_URL: get('SOURCE_CODE_URL'),
    SUPPORT_EMAIL: get('SUPPORT_EMAIL') || 'suporte@exemplo.com.br',
    AI_PROVIDER: (get('AI_PROVIDER') || 'anthropic').trim().toLowerCase(),
    AI_API_KEY: get('AI_API_KEY')?.trim() || undefined,
    AI_API_BASE_URL: get('AI_API_BASE_URL'),
    AI_MODEL: (get('AI_MODEL') || 'claude-sonnet-5-5').trim(),
    AI_MAX_OUTPUT_TOKENS: num('AI_MAX_OUTPUT_TOKENS', 1500, 256, 65536),
    // Sem valor, o provedor usa o padrão do modelo (alguns modelos recusam `temperature`).
    AI_TEMPERATURE: get('AI_TEMPERATURE') === undefined ? undefined : num('AI_TEMPERATURE', undefined, 0, 1),
    ASAAS_API_KEY: get('ASAAS_API_KEY'),
    ASAAS_ENV: asaasEnv,
    ASAAS_API_BASE_URL: get('ASAAS_API_BASE_URL'),
    ASAAS_WEBHOOK_TOKEN: get('ASAAS_WEBHOOK_TOKEN'),
    ASAAS_WEBHOOK_URL: get('ASAAS_WEBHOOK_URL'),
    ASAAS_SUCCESS_URL: get('ASAAS_SUCCESS_URL'),
    ASAAS_CANCEL_URL: get('ASAAS_CANCEL_URL'),
    ASAAS_EXPIRED_URL: get('ASAAS_EXPIRED_URL'),
    RESEND_API_KEY: get('RESEND_API_KEY'),
    MAIL_FROM: get('MAIL_FROM')
  };
}

/** O modo SaaS liga com SAAS_MODE=1 e exige DATABASE_URL. Desligado, nada muda no openGym. */
export function saasEnabled() {
  return /^(1|true|yes|on)$/i.test(process.env.SAAS_MODE || '');
}
