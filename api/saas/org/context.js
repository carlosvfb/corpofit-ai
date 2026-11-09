/* Executa o trabalho de uma requisição dentro de uma transação que carrega o contexto de segurança para o
   PostgreSQL (Row Level Security): `app.user_id` e `app.tenant_id`. Toda consulta de academia deve usar
   o `tx` recebido, nunca o cliente global.

   O RLS só protege se a transação rodar com um papel que NÃO seja superusuário nem BYPASSRLS. O papel padrão
   de muitos provedores (o dono do banco no Neon, por exemplo) tem BYPASSRLS. Por isso a transação troca para
   um papel restrito (`SET LOCAL ROLE`):
   - `RLS_ROLE` (variável) define qual, e vale em qualquer ambiente (testes, desenvolvimento);
   - sem ela, usa `corpofit_app`, criado pela migração `app_role`, quando existe, o papel conectado pode
     assumi-lo e o schema é o `public` (produção). Se não puder, segue sem troca e AVISA uma vez no log. */
import { prisma } from '../db.js';

const ROLE = /^[a-z_][a-z0-9_]{0,62}$/;
const DEFAULT_ROLE = 'corpofit_app';

let autoRole; // undefined = ainda não verificado; string = papel a usar; null = indisponível
async function detectAutoRole() {
  if (autoRole !== undefined) return autoRole;
  try {
    const rows = await prisma().$queryRaw`SELECT current_schema() = 'public' AS ok_schema, EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${DEFAULT_ROLE}) AS exists_role, CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${DEFAULT_ROLE}) THEN pg_has_role(current_user, ${DEFAULT_ROLE}, 'USAGE') ELSE false END AS can_use`;
    const r = rows[0] || {};
    autoRole = r.ok_schema && r.exists_role && r.can_use ? DEFAULT_ROLE : null;
  } catch { autoRole = null; }
  if (autoRole === null && !process.env.RLS_ROLE && !globalThis.__rlsWarned) {
    globalThis.__rlsWarned = true;
    console.warn('[saas] RLS: sem papel restrito disponível; a segurança por linha do banco pode não valer para este papel. Veja DATABASE.md.');
  }
  return autoRole;
}
/** Para testes: esquece a detecção. */
export const _resetAutoRole = () => { autoRole = undefined; };

export async function withContext({ userId, tenantId = '', moderator = '', counter = '', eraser = '', claimEmail = '' }, fn) {
  const role = process.env.RLS_ROLE || (await detectAutoRole());
  if (role && !ROLE.test(role)) throw new Error('RLS_ROLE inválido');
  return prisma().$transaction(async tx => {
    await tx.$executeRaw`SELECT set_config('app.user_id', ${String(userId || '')}, true), set_config('app.tenant_id', ${String(tenantId || '')}, true)`;
    // Só código do servidor, depois de verificar o papel, passa estes três (ver as migrações da biblioteca e do apagamento).
    if (moderator || counter || eraser || claimEmail) await tx.$executeRaw`SELECT set_config('app.moderator', ${String(moderator)}, true), set_config('app.counter', ${String(counter)}, true), set_config('app.eraser', ${String(eraser)}, true), set_config('app.claim_email', ${String(claimEmail)}, true)`;
    if (role) await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
    return fn(tx);
  }, { timeout: 15_000 });
}
