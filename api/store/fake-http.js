/* Requisição e resposta "de mentira" para rodar o servidor do openGym dentro de uma função da Vercel.
 *
 * O servidor foi escrito para `http.createServer`: lê o corpo do `req` (fluxo) e escreve no `res`. Aqui:
 *   - o corpo já foi lido por inteiro (uma tentativa pode precisar ser refeita, ver store/fs.js), então
 *     cada tentativa recebe uma cópia legível do início;
 *   - a resposta fica em memória e só é enviada depois que os dados da requisição foram gravados no
 *     PostgreSQL. Assim o cliente nunca recebe "salvo" por algo que não foi salvo. */
import { Readable } from 'node:stream';

export function makeRequest(real, body) {
  const r = Readable.from(body.length ? [body] : []);
  r.headers = real.headers;
  r.url = real.url;
  r.method = real.method;
  r.socket = real.socket || { remoteAddress: '' };
  r.complete = true;              // o corpo já chegou: nenhum prazo de leitura a vigiar
  r.httpVersion = real.httpVersion;
  return r;
}

export class BufferedResponse {
  constructor() {
    this.statusCode = 200;
    this.headers = {};
    this.chunks = [];
    this.headersSent = false;
    this.writableEnded = false;
  }
  setHeader(k, v) { this.headers[String(k).toLowerCase()] = v; return this; }
  getHeader(k) { return this.headers[String(k).toLowerCase()]; }
  removeHeader(k) { delete this.headers[String(k).toLowerCase()]; }
  writeHead(code, a, b) {
    this.statusCode = code;
    const hdrs = typeof a === 'object' && a ? a : b;
    if (hdrs) for (const [k, v] of Object.entries(hdrs)) this.setHeader(k, v);
    this.headersSent = true;
    return this;
  }
  write(chunk) { this.headersSent = true; if (chunk != null) this.chunks.push(Buffer.from(chunk)); return true; }
  end(chunk) { if (chunk != null) this.write(chunk); this.headersSent = true; this.writableEnded = true; return this; }
  on() { return this; }
  once() { return this; }
  off() { return this; }
  emit() { return false; }
  destroy() {}
  flushHeaders() {}
  /** Copia o que foi montado para a resposta de verdade. */
  sendTo(res) {
    res.statusCode = this.statusCode;
    for (const [k, v] of Object.entries(this.headers)) res.setHeader(k, v);
    res.end(Buffer.concat(this.chunks));
  }
}
