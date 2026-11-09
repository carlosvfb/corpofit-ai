/* Os padrões do modo Vercel. Importado ANTES de tudo em vercel-entry.js (a ordem dos imports vale),
 * para que as variáveis já estejam certas quando server.js e store/fs.js forem avaliados. Qualquer
 * uma pode ser sobrescrita nas variáveis de ambiente do projeto. */
const set = (k, v) => { if (process.env[k] === undefined || process.env[k] === '') process.env[k] = v; };

set('STORAGE', 'postgres');          // arquivos do openGym no PostgreSQL (store/)
set('SAAS_MODE', '1');               // planos, Asaas, IA com limites
set('PASSWORD_LOGIN', '1');          // cadastro/login por e-mail e senha
set('MEDIA_UPLOADS', '0');           // fotos/vídeos exigiriam Vercel Blob (limite de 4,5 MB por requisição)
set('TRUST_PROXY', '1');             // a Vercel define X-Forwarded-For
set('DATA_DIR', '/data');            // raiz do sistema de arquivos virtual (nada é gravado em disco)
set('DEFAULT_LANG', 'pt-BR');

// O endereço público vem da própria Vercel quando não foi informado: ORIGIN (usado nos cookies e na
// proteção CSRF), RP_ID (passkeys) e APP_URL (retornos do checkout).
const host = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
if (host) {
  set('ORIGIN', 'https://' + host);
  set('RP_ID', host);
}
set('APP_URL', process.env.ORIGIN || '');
