/* Ponto de entrada da API como função da Vercel (STORAGE=postgres, SAAS_MODE=1).
 *
 * É o mesmo servidor do openGym (server.js); aqui cada requisição:
 *   1. carrega do PostgreSQL só o que ela vai tocar (db.json, o perfil dela…), num "disco" virtual próprio;
 *   2. roda o mesmo roteador de sempre contra uma resposta em memória;
 *   3. grava o que mudou, com controle otimista de revisão (refaz do zero se outra instância gravou
 *      no meio) e só então envia a resposta.
 * Trabalho que continua depois da resposta (pedidos da IA, cronômetro de descanso) roda sob waitUntil. */
import './store/mode-vercel.js';   // primeiro: define os padrões do modo Vercel antes dos demais módulos
import { storage } from './store/fs.js';
import { BufferedResponse, makeRequest } from './store/fake-http.js';
import { onRequest, scopeFor, perRequestSetup, setWaitUntil } from './server.js';

if (!storage) throw new Error('vercel-entry.js exige STORAGE=postgres.');

let ready = null;
function init() {
  ready ||= (async () => {
    try { setWaitUntil((await import('@vercel/functions')).waitUntil); }
    catch { /* fora da Vercel (testes, emulação local): o processo segue vivo de qualquer forma */ }
  })();
  return ready;
}

const MAX_BODY = 5 * 1024 * 1024;

async function readAll(req) {
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) return null;
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  await init();
  const body = await readAll(req);
  if (body === null) {
    res.statusCode = 413;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'body too large' }));
  }
  let out;
  try {
    out = await storage.run(scopeFor(req), async () => {
      perRequestSetup();
      const response = new BufferedResponse();
      await onRequest(makeRequest(req, body), response);
      return response;
    });
  } catch (e) {
    console.error('request failed', req.method, String(req.url).split('?')[0], e);
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Retry-After', '2');
    return res.end(JSON.stringify({ error: 'service temporarily unavailable, try again' , code: 'storage' }));
  }
  out.sendTo(res);
}
