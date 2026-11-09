/* Estado "de memória" do servidor que, na Vercel, precisa sobreviver entre requisições e instâncias:
 * desafios WebAuthn, códigos de pareamento, limites de tentativas de login, o `db` em si.
 *
 * `scoped(nome, criar, codec)` devolve:
 *   - no modo normal (disco): simplesmente `criar()`, um objeto de processo, como sempre foi;
 *   - em STORAGE=postgres: um Proxy para a instância DA REQUISIÇÃO, criada na primeira vez que a
 *     requisição a toca, preenchida com o que está em `ephemeral.json` e, se mudou, gravada de volta no
 *     fim da requisição (junto com o resto, com controle otimista de revisão).
 * Assim duas requisições simultâneas na mesma instância não pisam uma na outra, e uma instância nova
 * continua de onde a anterior parou. */
import path from 'node:path';
import fs, { STORAGE_POSTGRES, DATA_ROOT, context } from './fs.js';

export const EPHEMERAL_FILE = path.join(DATA_ROOT, 'ephemeral.json');

const registry = new Map();   // nome -> { criar, dump, load }
const fallback = new Map();   // nome -> instância fora de requisição

const readStore = ctx => {
  if (ctx.eph) return ctx.eph;
  let data = {};
  try { data = JSON.parse(fs.readFileSync(EPHEMERAL_FILE, 'utf8')) || {}; } catch { /* ainda não existe */ }
  ctx.eph = { data, before: JSON.stringify(data), touched: new Set() };
  ctx.finish.push(() => save(ctx));
  return ctx.eph;
};

function save(ctx) {
  const st = ctx.eph;
  if (!st) return;
  const out = { ...st.data };
  for (const name of st.touched) {
    const reg = registry.get(name);
    const inst = ctx.instances.get(name);
    if (reg && inst) out[name] = reg.dump(inst);
  }
  const text = JSON.stringify(out);
  if (text !== st.before) fs.writeFileSync(EPHEMERAL_FILE, text);
}

function instanceFor(name) {
  const reg = registry.get(name);
  const ctx = context();
  if (!ctx) {
    if (!fallback.has(name)) fallback.set(name, reg.criar());
    return fallback.get(name);
  }
  let inst = ctx.instances.get(name);
  if (!inst) {
    inst = reg.criar();
    const st = readStore(ctx);
    if (st.data[name] !== undefined) reg.load(inst, st.data[name]);
    ctx.instances.set(name, inst);
  }
  readStore(ctx).touched.add(name);
  return inst;
}

export function scoped(name, criar, codec) {
  if (!STORAGE_POSTGRES) return criar();
  registry.set(name, { criar, ...codec });
  return new Proxy({}, {
    get(_t, prop) {
      const inst = instanceFor(name);
      const v = Reflect.get(inst, prop, inst);
      return typeof v === 'function' ? v.bind(inst) : v;
    },
    set(_t, prop, value) { const inst = instanceFor(name); inst[prop] = value; return true; },
    has(_t, prop) { return prop in instanceFor(name); },
    deleteProperty(_t, prop) { return delete instanceFor(name)[prop]; },
    ownKeys() { return Reflect.ownKeys(instanceFor(name)); },
    getOwnPropertyDescriptor(_t, prop) { const d = Reflect.getOwnPropertyDescriptor(instanceFor(name), prop); if (d) d.configurable = true; return d; }
  });
}

/** Mapa de pares chave/valor simples (desafios, pareamentos…). */
export const mapCodec = {
  dump: m => [...m.entries()],
  load: (m, d) => { for (const [k, v] of d || []) m.set(k, v); }
};

/** Limitadores de rate-limit.js (createWindow / createBackoff). */
export const limiterCodec = {
  dump: l => { l.sweep?.(); return l.dump(); },
  load: (l, d) => l.load(d || [])
};

/** Objeto simples (ex.: lembretes do cronômetro de descanso). */
export const objectCodec = {
  dump: o => ({ ...o }),
  load: (o, d) => Object.assign(o, d || {})
};

/**
 * Como `scoped`, mas SEM persistir em ephemeral.json: um objeto por requisição, criado por `criar()`
 * (ex.: o `db`, lido de db.json pelo vfs da requisição). No modo normal é só `criar()`.
 */
export function perRequest(name, criar) {
  if (!STORAGE_POSTGRES) return criar();
  const get = () => {
    const ctx = context();
    if (!ctx) { if (!fallback.has(name)) fallback.set(name, criar()); return fallback.get(name); }
    const key = 'req:' + name;
    if (!ctx.instances.has(key)) ctx.instances.set(key, criar());
    return ctx.instances.get(key);
  };
  return new Proxy({}, {
    get(_t, prop) { const o = get(); const v = Reflect.get(o, prop, o); return typeof v === 'function' ? v.bind(o) : v; },
    set(_t, prop, value) { get()[prop] = value; return true; },
    has(_t, prop) { return prop in get(); },
    deleteProperty(_t, prop) { return delete get()[prop]; },
    ownKeys() { return Reflect.ownKeys(get()); },
    getOwnPropertyDescriptor(_t, prop) { const d = Reflect.getOwnPropertyDescriptor(get(), prop); if (d) d.configurable = true; return d; }
  });
}

/** O objeto de verdade por trás de um `perRequest` (para JSON.stringify, etc.). */
export function raw(proxyOrObject, name) {
  if (!STORAGE_POSTGRES) return proxyOrObject;
  const ctx = context();
  if (!ctx) return fallback.get(name);
  return ctx.instances.get('req:' + name);
}
