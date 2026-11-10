/* Foto de perfil: um arquivo por pessoa em DATA_DIR/avatars/<uid>. O app reduz a imagem no aparelho (256 px); aqui só se
   confere o tipo pelos primeiros bytes (JPEG, PNG ou WebP) e o tamanho. Nenhuma decodificação, nenhuma dependência.
   Quem pede só alcança a própria foto: o nome do arquivo vem da sessão, nunca da requisição. */
import path from 'node:path';
import fs from './store/fs.js';

export const MAX_AVATAR = 200 * 1024;

export function sniff(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

export function createAvatarStore(dataDir) {
  const dir = path.join(dataDir, 'avatars');
  const file = uid => path.join(dir, String(uid).replace(/[^A-Za-z0-9_-]/g, '_'));
  return {
    save(uid, buf) {
      const mime = sniff(buf);
      if (!mime) throw Object.assign(new Error('unsupported image'), { code: 'avatar-type' });
      if (buf.length > MAX_AVATAR) throw Object.assign(new Error('image too large'), { code: 'avatar-size' });
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.writeFileSync(file(uid), buf, { mode: 0o600 });
      return { mime, size: buf.length, version: Date.now().toString(36) };
    },
    read(uid) {
      try { const buf = fs.readFileSync(file(uid)); const mime = sniff(buf); return mime ? { buf, mime } : null; } catch { return null; }
    },
    remove(uid) { try { fs.unlinkSync(file(uid)); } catch { /* já não existia */ } }
  };
}
