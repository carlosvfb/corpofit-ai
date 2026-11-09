/* Um "sistema de arquivos" virtual sobre o PostgreSQL, para o modo Vercel (STORAGE=postgres).
 *
 * O openGym guarda tudo em arquivos de DATA_DIR (db.json, state-<uid>.json, coach.json…) e os lê e
 * grava de forma SÍNCRONA em dezenas de lugares. Uma função da Vercel não tem disco persistente nem
 * processo duradouro, então este módulo faz o seguinte, sem reescrever o servidor:
 *
 *   - cada arquivo de DATA_DIR é uma linha da tabela "KvFile" (path, content, rev);
 *   - ANTES de uma requisição, `begin()` descarta o cache e `hydrate()` traz as linhas que ela vai
 *     tocar; durante a requisição o código lê e grava neste cache, de forma síncrona, como antes;
 *   - DEPOIS, `flush()` grava só o que mudou, numa transação, com controle otimista: cada gravação
 *     exige que a revisão lida ainda seja a atual. Se outra instância gravou no meio, lança
 *     ConflictError e o chamador refaz a requisição do zero com dados novos.
 *
 * Caminhos fora de DATA_DIR (ex.: os temporários do sistema) seguem para o fs de verdade. O segredo
 * das sessões ("secret") NÃO fica no banco: vem de APP_SECRET. */
import realFs from 'node:fs';
import path from 'node:path';

export class ConflictError extends Error {
  constructor(file) { super(`conflito de gravação em ${file}`); this.name = 'ConflictError'; this.file = file; }
}

const enoent = (p, op = 'open') => Object.assign(new Error(`ENOENT: no such file or directory, ${op} '${p}'`), { code: 'ENOENT', errno: -2, syscall: op, path: p });
const eisdir = p => Object.assign(new Error(`EISDIR: illegal operation on a directory, read '${p}'`), { code: 'EISDIR' });

export function createVfs({ dataDir, secret, query }) {
  const root = path.resolve(dataDir);
  // key (relativo, com "/") -> { content: Buffer, rev, dirty, deleted, mtimeMs }
  let files = new Map();
  const synthetic = new Map();
  if (secret) synthetic.set('secret', { content: Buffer.from(secret, 'utf8'), rev: -1, dirty: false, deleted: false, mtimeMs: 0 });

  const keyOf = p => {
    if (typeof p !== 'string') return null;
    const abs = path.resolve(p);
    if (abs === root) return '';
    if (!abs.startsWith(root + path.sep)) return null;
    return abs.slice(root.length + 1).split(path.sep).join('/');
  };
  const entry = key => synthetic.get(key) || files.get(key);
  const live = key => { const e = entry(key); return e && !e.deleted ? e : null; };
  const touch = (key, content) => {
    const prev = files.get(key);
    files.set(key, { content, rev: prev ? prev.rev : 0, dirty: true, deleted: false, mtimeMs: Date.now() });
  };
  const toBuf = d => (Buffer.isBuffer(d) ? d : typeof d === 'string' ? Buffer.from(d, 'utf8') : Buffer.from(d));
  const children = dirKey => {
    const prefix = dirKey ? dirKey + '/' : '';
    const out = new Set();
    for (const key of [...files.keys(), ...synthetic.keys()]) {
      if (!key.startsWith(prefix) || key === dirKey) continue;
      if (!live(key)) continue;
      out.add(key.slice(prefix.length).split('/')[0]);
    }
    return [...out];
  };
  const isDir = key => key === '' || children(key).length > 0;

  /* ------------------------------ persistência ------------------------------ */

  /** Descarta o que está em cache e não foi alterado; o resto (alterações pendentes) fica. */
  function begin() {
    for (const [k, e] of files) if (!e.dirty) files.delete(k);
  }

  /** Traz as linhas do escopo: caminhos exatos, padrões LIKE e/ou tudo. Não sobrescreve pendências. */
  async function hydrate({ exact = [], like = [], all = false } = {}) {
    const clauses = [];
    const params = [];
    const p = v => { params.push(v); return `$${params.length}`; };
    if (all) clauses.push('TRUE');
    if (exact.length) clauses.push(`path = ANY(${p(exact)}::text[])`);
    for (const l of like) clauses.push(`path LIKE ${p(l)}`);
    if (!clauses.length) return;
    const rows = await query(`SELECT path, content, rev, "updatedAt" FROM "KvFile" WHERE ${clauses.join(' OR ')}`, params);
    for (const r of rows) {
      const cur = files.get(r.path);
      if (cur && cur.dirty) continue;
      files.set(r.path, { content: Buffer.from(r.content, 'utf8'), rev: Number(r.rev), dirty: false, deleted: false, mtimeMs: new Date(r.updatedAt).getTime() });
    }
  }

  const dirtyEntries = () => [...files.entries()].filter(([, e]) => e.dirty);
  const hasDirty = () => dirtyEntries().length > 0;

  /** Grava o que mudou, tudo ou nada. Lança ConflictError se alguma revisão deixou de ser a atual. */
  async function flush(transaction) {
    const dirty = dirtyEntries();
    if (!dirty.length) return 0;
    await transaction(async run => {
      for (const [key, e] of dirty) {
        let n;
        if (e.deleted) {
          if (e.rev === 0) continue;                               // nasceu e morreu nesta requisição
          n = await run('DELETE FROM "KvFile" WHERE path = $1 AND rev = $2', [key, e.rev]);
        } else if (e.rev === 0) {
          n = await run('INSERT INTO "KvFile"(path, content, rev, "updatedAt") VALUES ($1, $2, 1, now()) ON CONFLICT (path) DO NOTHING', [key, e.content.toString('utf8')]);
        } else {
          n = await run('UPDATE "KvFile" SET content = $1, rev = rev + 1, "updatedAt" = now() WHERE path = $2 AND rev = $3', [e.content.toString('utf8'), key, e.rev]);
        }
        if (n !== 1) throw new ConflictError(key);
      }
    });
    for (const [key, e] of dirty) {
      if (e.deleted) files.delete(key);
      else { e.rev = e.rev + 1; e.dirty = false; }
    }
    return dirty.length;
  }

  /** Esquece as alterações pendentes (depois de um conflito, antes de refazer). */
  function discard() { files = new Map(); }

  /* ------------------------------ API tipo fs ------------------------------ */

  const api = {
    isVirtual: true,
    existsSync(p) { const k = keyOf(p); return k === null ? realFs.existsSync(p) : !!live(k) || isDir(k); },
    readFileSync(p, opts) {
      const k = keyOf(p);
      if (k === null) return realFs.readFileSync(p, opts);
      const e = live(k);
      if (!e) { if (isDir(k)) throw eisdir(p); throw enoent(p); }
      const enc = typeof opts === 'string' ? opts : opts && opts.encoding;
      return enc ? e.content.toString(enc) : Buffer.from(e.content);
    },
    writeFileSync(p, data, opts) {
      const k = keyOf(p);
      if (k === null) return realFs.writeFileSync(p, data, opts);
      touch(k, toBuf(data));
    },
    appendFileSync(p, data) {
      const k = keyOf(p);
      if (k === null) return realFs.appendFileSync(p, data);
      const e = live(k);
      touch(k, Buffer.concat([e ? e.content : Buffer.alloc(0), toBuf(data)]));
    },
    unlinkSync(p) {
      const k = keyOf(p);
      if (k === null) return realFs.unlinkSync(p);
      const e = live(k);
      if (!e) throw enoent(p, 'unlink');
      if (e.rev === -1) return;                                    // o segredo sintético não se apaga
      e.deleted = true; e.dirty = true; e.mtimeMs = Date.now();
    },
    rmSync(p, opts = {}) {
      const k = keyOf(p);
      if (k === null) return realFs.rmSync(p, opts);
      const prefix = k ? k + '/' : '';
      let any = false;
      for (const key of [...files.keys()]) {
        if (key === k || (opts.recursive && key.startsWith(prefix))) {
          const e = files.get(key);
          if (e && !e.deleted) { e.deleted = true; e.dirty = true; any = true; }
        }
      }
      if (!any && !opts.force) throw enoent(p, 'rm');
    },
    renameSync(from, to) {
      const a = keyOf(from), b = keyOf(to);
      if (a === null || b === null) return realFs.renameSync(from, to);
      const e = live(a);
      if (!e) throw enoent(from, 'rename');
      touch(b, e.content);
      e.deleted = true; e.dirty = true;
    },
    copyFileSync(from, to) {
      const a = keyOf(from), b = keyOf(to);
      if (a === null || b === null) return realFs.copyFileSync(from, to);
      const e = live(a);
      if (!e) throw enoent(from, 'copyfile');
      touch(b, Buffer.from(e.content));
    },
    mkdirSync(p, opts) { if (keyOf(p) === null) return realFs.mkdirSync(p, opts); return undefined; },
    chmodSync(p, mode) { if (keyOf(p) === null) return realFs.chmodSync(p, mode); },
    chownSync(p, u, g) { if (keyOf(p) === null) return realFs.chownSync(p, u, g); },
    readdirSync(p, opts) {
      const k = keyOf(p);
      if (k === null) return realFs.readdirSync(p, opts);
      if (!isDir(k)) throw enoent(p, 'scandir');
      const names = children(k).sort();
      if (opts && opts.withFileTypes) return names.map(name => ({ name, isFile: () => !!live(k ? k + '/' + name : name), isDirectory: () => !live(k ? k + '/' + name : name) }));
      return names;
    },
    statSync(p, opts) {
      const k = keyOf(p);
      if (k === null) return realFs.statSync(p, opts);
      const e = live(k);
      if (e) return { size: e.content.length, mtimeMs: e.mtimeMs, mtime: new Date(e.mtimeMs), isFile: () => true, isDirectory: () => false, mode: 0o100600 };
      if (isDir(k)) return { size: 0, mtimeMs: 0, mtime: new Date(0), isFile: () => false, isDirectory: () => true, mode: 0o40700 };
      if (opts && opts.throwIfNoEntry === false) return undefined;
      throw enoent(p, 'stat');
    },
    statfsSync(p, opts) { return realFs.statfsSync ? realFs.statfsSync(keyOf(p) === null ? p : '.', opts) : { bavail: 1e9, bsize: 4096 }; },
    createWriteStream() { throw new Error('envio de arquivos grandes não é suportado no modo Vercel (STORAGE=postgres)'); },
    createReadStream() { throw new Error('leitura em fluxo de arquivos não é suportada no modo Vercel (STORAGE=postgres)'); }
  };

  return { api, begin, hydrate, flush, discard, hasDirty, keyOf, _files: () => files };
}
