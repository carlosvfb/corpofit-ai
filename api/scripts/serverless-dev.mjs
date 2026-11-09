// Emula localmente uma "instância" da função da Vercel: o mesmo handler (vercel-entry.js), com o
// armazenamento no PostgreSQL, atrás de um servidor HTTP comum. Útil para desenvolver sem a Vercel e
// usado pelos testes (duas instâncias sobre o mesmo banco provam que nada fica só na memória).
//
//   STORAGE=postgres SAAS_MODE=1 APP_SECRET=... DATABASE_URL=... PORT=3000 node scripts/serverless-dev.mjs
import http from 'node:http';

process.env.STORAGE = 'postgres';
const { default: handler } = await import('../vercel-entry.js');
const server = http.createServer((req, res) => { handler(req, res).catch(e => { console.error(e); if (!res.headersSent) { res.statusCode = 500; res.end(); } }); });
server.listen(+(process.env.PORT || 3000), () => console.log(`gym-api on :${server.address().port} (serverless emulation)`));
