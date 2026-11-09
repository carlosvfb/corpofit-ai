/* O `fs` que o resto da API usa para tudo que fica em DATA_DIR.
 *
 * Normalmente é o `node:fs` de sempre (nada muda para quem hospeda o openGym em casa). Com
 * STORAGE=postgres (modo Vercel) é um sistema de arquivos virtual (./vfs.js) que guarda cada arquivo
 * numa linha do PostgreSQL, e há UM por requisição: o contexto da requisição (AsyncLocalStorage) diz
 * qual. Requisições simultâneas na mesma instância nunca enxergam o cache uma da outra.
 *
 * Os módulos fazem `import fs from './store/fs.js'` no lugar de `import fs from 'node:fs'`. */
import realFs from 'node:fs';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createVfs } from './vfs.js';

export const STORAGE_POSTGRES = process.env.STORAGE === 'postgres';
export const DATA_ROOT = process.env.DATA_DIR || '/data';

/** O contexto da requisição em curso: { vfs, instances, eph, pending }. */
export const als = new AsyncLocalStorage();
export const context = () => als.getStore() || null;

if (STORAGE_POSTGRES && (!process.env.APP_SECRET || process.env.APP_SECRET.length < 32)) {
  throw new Error('STORAGE=postgres exige APP_SECRET (>= 32 caracteres): ele assina as sessões e cifra a chave da IA.');
}

const newVfs = () => createVfs({
  dataDir: DATA_ROOT,
  secret: process.env.APP_SECRET,
  // @prisma/client só é carregado aqui, no modo Vercel: o openGym sem SaaS não depende dele.
  query: async (sql, params) => (await import('../saas/db.js')).prisma().$queryRawUnsafe(sql, ...params)
});

// Fora de qualquer requisição (importação dos módulos): um vfs vazio, só com o segredo.
const boot = STORAGE_POSTGRES ? newVfs() : null;
const current = () => (als.getStore()?.vfs) || boot;

async function flushVfs(v) {
  const { prisma } = await import('../saas/db.js');
  return v.flush(work => prisma().$transaction(async tx => work(async (sql, params) => Number(await tx.$executeRawUnsafe(sql, ...params)))));
}

/** Controle do armazenamento virtual; `null` no modo normal (disco). */
export const storage = STORAGE_POSTGRES && {
  /**
   * Roda `fn` com os dados do `scope` carregados num vfs próprio e grava o que mudou ao final, com
   * controle otimista. Se outra instância gravou no meio (ConflictError), refaz tudo do zero.
   * `fn` recebe o contexto e deve ser repetível: nada fora do banco pode acontecer nele.
   */
  async run(scope, fn, { attempts = 8 } = {}) {
    for (let i = 0; ; i++) {
      const v = newVfs();
      const ctx = { vfs: v, instances: new Map(), eph: null, pending: [], finish: [] };
      try {
        const out = await als.run(ctx, async () => {
          await v.hydrate(scope);
          const r = await fn(ctx);
          await Promise.allSettled(ctx.pending);
          for (const f of ctx.finish) f();
          return r;
        });
        await flushVfs(v);
        return out;
      } catch (e) {
        if (e && e.name === 'ConflictError' && i < attempts - 1) {
          // Quem perdeu a corrida espera um pouco, com variação, para não colidir de novo com o mesmo vizinho.
          await new Promise(r => setTimeout(r, 15 + Math.random() * 70 * (i + 1)));
          continue;
        }
        throw e;
      }
    }
  }
};

// Métodos que o vfs não implementa seguem para o fs de verdade (caminhos temporários, etc.).
const fs = STORAGE_POSTGRES
  ? new Proxy(realFs, { get: (t, prop) => { const v = current(); return prop in v.api ? v.api[prop] : t[prop]; } })
  : realFs;
export default fs;
