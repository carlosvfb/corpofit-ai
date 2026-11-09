/** Erro com status HTTP e código estável, convertido em resposta JSON pelas rotas. */
export class SaasError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    if (code) this.code = code;
  }
}

/** Registra um erro de integração sem segredos (só a mensagem, truncada). */
export async function logError(db, scope, err) {
  const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
  console.error(`[saas:${scope}]`, message);
  try { await db.errorLog.create({ data: { scope, message } }); } catch { /* o log nunca derruba a requisição */ }
}
