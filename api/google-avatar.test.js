import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { authUrl, downloadPicture, googleEnabled, profileFromCode, redirectUri, stateOk } from './google-auth.js';
import { MAX_AVATAR, createAvatarStore, sniff } from './avatar.js';
import { renderHtml, sendMail } from './saas/mailer.js';

const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]);
const resp = (ok, body, status = ok ? 200 : 400) => ({ ok, status, json: async () => body, arrayBuffer: async () => body });

test('google: só ativa com id e segredo; a URL leva o state, o retorno exato e o escopo mínimo', () => {
  assert.equal(googleEnabled({}), false);
  assert.equal(googleEnabled({ GOOGLE_CLIENT_ID: 'a' }), false);
  assert.equal(googleEnabled({ GOOGLE_CLIENT_ID: 'a', GOOGLE_CLIENT_SECRET: 'b' }), true);
  const u = new URL(authUrl({ clientId: 'cid', origin: 'https://app.exemplo.com.br/', state: 'abc' }));
  assert.equal(u.hostname, 'accounts.google.com');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://app.exemplo.com.br/api/auth/google/callback');
  assert.equal(redirectUri('https://x.com//'), 'https://x.com/api/auth/google/callback');
  assert.equal(u.searchParams.get('scope'), 'openid email profile');
  assert.equal(u.searchParams.get('state'), 'abc');
});

test('google: o state da volta precisa ser igual ao do cookie', () => {
  assert.equal(stateOk('abcdefghijklmnop', 'abcdefghijklmnop'), true);
  assert.equal(stateOk('abcdefghijklmnop', 'abcdefghijklmnoq'), false);
  assert.equal(stateOk('abcdefghijklmnop', ''), false);
  assert.equal(stateOk(undefined, 'abcdefghijklmnop'), false);
});

test('google: troca o código por perfil; recusa e-mail não verificado e falhas', async () => {
  const ok = async url => String(url).includes('token') ? resp(true, { access_token: 't' }) : resp(true, { sub: '123', email: 'Ana@Gmail.com', email_verified: true, name: 'Ana Silva', picture: 'https://lh3.googleusercontent.com/a/x=s96-c' });
  const base = { code: 'c', clientId: 'a', clientSecret: 'b', origin: 'https://x.com' };
  assert.deepEqual(await profileFromCode({ ...base, fetcher: ok }), { sub: '123', email: 'ana@gmail.com', name: 'Ana Silva', picture: 'https://lh3.googleusercontent.com/a/x=s96-c' });
  const unverified = async url => String(url).includes('token') ? resp(true, { access_token: 't' }) : resp(true, { sub: '1', email: 'a@b.com', email_verified: false });
  await assert.rejects(profileFromCode({ ...base, fetcher: unverified }), e => e.code === 'email-unverified');
  await assert.rejects(profileFromCode({ ...base, fetcher: async () => resp(false, {}, 400) }), e => e.code === 'token-failed');
  await assert.rejects(profileFromCode({ ...base, code: '', fetcher: ok }), e => e.code === 'bad-code');
});

test('google: a foto só vem de domínio do Google e tem limite de tamanho', async () => {
  let called = 0;
  const f = async () => { called++; return resp(true, jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.length)); };
  assert.equal(await downloadPicture('https://evil.example.com/a.jpg', f), null);
  assert.equal(await downloadPicture('http://lh3.googleusercontent.com/a', f), null);
  assert.equal(called, 0);
  assert.ok(Buffer.isBuffer(await downloadPicture('https://lh3.googleusercontent.com/a/x=s96-c', f)));
  assert.equal(await downloadPicture('https://lh3.googleusercontent.com/a', async () => resp(true, new ArrayBuffer(400 * 1024))), null);
});

test('foto de perfil: só JPEG, PNG e WebP; grava, lê e apaga só a própria', () => {
  assert.equal(sniff(jpeg), 'image/jpeg');
  assert.equal(sniff(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)])), 'image/png');
  assert.equal(sniff(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])), 'image/webp');
  assert.equal(sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avatar-'));
  try {
    const s = createAvatarStore(dir);
    assert.throws(() => s.save('u1', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), e => e.code === 'avatar-type');
    assert.throws(() => s.save('u1', Buffer.concat([jpeg, Buffer.alloc(MAX_AVATAR)])), e => e.code === 'avatar-size');
    assert.ok(s.save('u1', jpeg).version);
    assert.equal(s.read('u1').mime, 'image/jpeg');
    assert.equal(s.read('u2'), null);
    s.save('../../etc/passwd', jpeg); // o nome do arquivo é sempre limpo
    assert.ok(fs.readdirSync(path.join(dir, 'avatars')).every(n => !n.includes('/') && !n.includes('.')));
    s.remove('u1');
    assert.equal(s.read('u1'), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('e-mail: escapa o HTML, vira link e a marca aparece', () => {
  const h = renderHtml('Código', 'Seu código é <b>123456</b>\n\nAbra https://exemplo.com/x agora.');
  assert.ok(h.includes('&lt;b&gt;123456&lt;/b&gt;'));
  assert.ok(h.includes('<a href="https://exemplo.com/x"'));
});

test('e-mail via Resend: envia com chave e remetente; mostra o motivo quando o Resend recusa', async () => {
  const old = { k: process.env.RESEND_API_KEY, f: process.env.MAIL_FROM };
  try {
    delete process.env.RESEND_API_KEY; delete process.env.MAIL_FROM;
    assert.deepEqual(await sendMail('a@b.com', 'Oi', 'texto', async () => { throw new Error('não deveria chamar'); }), { sent: false, error: 'not-configured' });
    process.env.RESEND_API_KEY = 're_test'; process.env.MAIL_FROM = 'CorpoFit <no-reply@exemplo.com.br>';
    let seen;
    assert.deepEqual(await sendMail('a@b.com', 'Código', 'olá', async (url, init) => { seen = { url, init }; return resp(true, {}); }), { sent: true });
    assert.equal(seen.url, 'https://api.resend.com/emails');
    assert.equal(seen.init.headers.Authorization, 'Bearer re_test');
    const body = JSON.parse(seen.init.body);
    assert.equal(body.to, 'a@b.com'); assert.ok(body.html.includes('olá')); assert.equal(body.from, 'CorpoFit <no-reply@exemplo.com.br>');
    const r = await sendMail('a@b.com', 'x', 'y', async () => resp(false, { message: 'The domain is not verified' }, 403));
    assert.equal(r.sent, false); assert.equal(r.error, 'resend-403'); assert.match(r.detail, /not verified/);
    assert.equal((await sendMail('a@b.com', 'x', 'y', async () => { throw new Error('down'); })).error, 'network');
  } finally {
    old.k === undefined ? delete process.env.RESEND_API_KEY : (process.env.RESEND_API_KEY = old.k);
    old.f === undefined ? delete process.env.MAIL_FROM : (process.env.MAIL_FROM = old.f);
  }
});
