/* Executa o trabalho de uma requisição dentro de uma transação que carrega o contexto de segurança para o
   PostgreSQL (Row Level Security): `app.user_id` e `app.tenant_id`. Toda consulta de academia deve usar
   o `tx` recebido, nunca o cliente global. */
import { prisma } from '../db.js';

// Papel sem superusuário e sem BYPASSRLS, usado quando se quer o RLS valendo mesmo conectado como dono
// (desenvolvimento e testes). Em produção o próprio papel da aplicação (não superusuário) já é restringido.
const ROLE = /^[a-z_][a-z0-9_]{0,62}$/;

export async function withContext({ userId, tenantId = '' }, fn) {
  return prisma().$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.user_id', ${String(userId || '')}, true), set_config('app.tenant_id', ${String(tenantId || '')}, true)`;
    const role = process.env.RLS_ROLE;
    if (role) {
      if (!ROLE.test(role)) throw new Error('RLS_ROLE inválido');
      await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
    }
    return fn(tx);
  }, { timeout: 15_000 });
}
