/* Entrar com o Google (OAuth 2.0, fluxo de código). Só funciona com GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET definidos.
   O segredo nunca sai do servidor. O `state` é um valor aleatório guardado num cookie de curta duração e conferido na volta
   (protege contra login forjado). O e-mail só vale se o Google disser que ele foi verificado. A foto do Google é baixada
   pelo servidor e guardada como a foto de perfil (avatar.js), sem hotlink e sem depender de domínio de terceiros na tela. */
import crypto from 'node:crypto';

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

export const googleEnabled = (env = process.env) => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
export const newState = () => crypto.randomBytes(18).toString('base64url');
export const redirectUri = origin => String(origin).replace(/\/+$/, '') + '/api/auth/google/callback';

export function authUrl({ clientId, origin, state }) {
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri(origin), response_type: 'code', scope: 'openid email profile', state, prompt: 'select_account', access_type: 'online' });
  return AUTH_URL + '?' + q.toString();
}

const sameState = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length > 10 && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
export const stateOk = (fromQuery, fromCookie) => sameState(fromQuery, fromCookie);

/** Troca o código por dados da pessoa. `fetcher` existe para os testes. Lança Error com .code em qualquer falha. */
export async function profileFromCode({ code, clientId, clientSecret, origin, fetcher = fetch }) {
  const fail = (c, m) => Object.assign(new Error(m || c), { code: c });
  if (!code || typeof code !== 'string' || code.length > 2000) throw fail('bad-code');
  const t = await fetcher(TOKEN_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri(origin), grant_type: 'authorization_code' }).toString(),
    signal: AbortSignal.timeout(10_000)
  });
  if (!t.ok) throw fail('token-failed', 'google token ' + t.status);
  const tok = await t.json();
  if (!tok?.access_token) throw fail('token-failed');
  const u = await fetcher(USERINFO_URL, { headers: { Authorization: 'Bearer ' + tok.access_token }, signal: AbortSignal.timeout(10_000) });
  if (!u.ok) throw fail('userinfo-failed', 'google userinfo ' + u.status);
  const info = await u.json();
  if (!info?.sub || typeof info.sub !== 'string') throw fail('no-subject');
  if (!info.email || info.email_verified !== true) throw fail('email-unverified');
  return { sub: info.sub, email: String(info.email).toLowerCase(), name: String(info.name || info.given_name || info.email.split('@')[0]).trim().slice(0, 40), picture: typeof info.picture === 'string' ? info.picture : null };
}

/** Baixa a foto do Google (só dos domínios do Google, no máximo 300 KB). Devolve Buffer ou null (a foto é opcional). */
export async function downloadPicture(url, fetcher = fetch) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !/(^|\.)googleusercontent\.com$/.test(u.hostname)) return null;
    const big = url.replace(/=s\d+(-c)?$/, '=s256-c');
    const r = await fetcher(big, { signal: AbortSignal.timeout(8_000) });
    if (!r.ok) return null;
    const buf = Buffer.from(await r.arrayBuffer());
    return buf.length > 0 && buf.length <= 300 * 1024 ? buf : null;
  } catch { return null; }
}
