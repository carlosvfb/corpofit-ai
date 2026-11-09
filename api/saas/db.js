/* PostgreSQL via Prisma, carregado sob demanda: sem DATABASE_URL a API segue sendo o openGym de
   sempre e este módulo nem chega a ser importado. */
import { PrismaClient } from '@prisma/client';

let client = null;

/** O cliente Prisma único do processo. */
export function prisma() {
  if (!client) client = new PrismaClient();
  return client;
}

/** `db.user.findMany(...)` etc.: um proxy que cria o cliente na primeira chamada. */
export const db = new Proxy({}, {
  get(_t, prop) {
    return prisma()[prop];
  }
});

export async function disconnect() {
  if (client) { await client.$disconnect(); client = null; }
}
