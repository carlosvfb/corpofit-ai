// PostgreSQL embutido para desenvolvimento e testes, quando não há Docker nem Postgres instalado.
// Uso: npm run db:dev   (mantenha o terminal aberto; porta 5432; usuário/senha: corpofitai)
// Cria os bancos "corpofitai" (desenvolvimento) e "corpofitai_test" (testes). Dados em api/.devdb/.
import EmbeddedPostgres from 'embedded-postgres';
import fs from 'node:fs';

const dir = process.env.DEV_DB_DIR || '.devdb';
const first = !fs.existsSync(dir);
const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: 'corpofitai',
  password: 'corpofitai',
  port: Number(process.env.DEV_DB_PORT || 5432),
  persistent: true,
  // UTF8 sempre: no Windows o padrão do initdb seria WIN1252 e recusaria emojis dos treinos.
  initdbFlags: ['--encoding=UTF8', '--locale=C']
});
if (first) await pg.initialise();
await pg.start();
if (first) {
  await pg.createDatabase('corpofitai');
  await pg.createDatabase('corpofitai_test');
}
console.log('PostgreSQL embutido pronto: postgresql://corpofitai:corpofitai@localhost:5432/corpofitai');
const stop = async () => { await pg.stop(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
