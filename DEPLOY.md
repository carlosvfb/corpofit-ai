# Implantação: somente na Vercel

O CorpoFit AI roda **inteiro na Vercel**: o app (estático) e a API (funções) no mesmo projeto, mais um PostgreSQL do Marketplace. Não há VPS, nem disco, nem processo para manter.

## Como isso funciona (e por que nada se perde)

O openGym foi feito para um servidor que guarda tudo em arquivos e roda timers. Uma função da Vercel não tem disco persistente nem vive entre requisições, então a API ganhou um **modo Vercel** (`STORAGE=postgres`, ligado por padrão em `api/vercel-entry.js`) sem reescrever o servidor:

| No servidor tradicional | Na Vercel |
|---|---|
| Arquivos em `DATA_DIR` (`db.json`, `state-<uid>.json`, `coach.json`…) | **Linhas do PostgreSQL** (tabela `KvFile`), carregadas por requisição e gravadas ao final, com controle otimista de revisão (se outra instância gravou no meio, a requisição é refeita sozinha) |
| Segredo da sessão em arquivo | `APP_SECRET` (variável de ambiente; nunca vai ao banco) |
| Limites de login, desafios de passkey, pareamentos em memória | Guardados no PostgreSQL (`ephemeral.json`), compartilhados entre instâncias |
| Timers (lembretes, nudges, revisões agendadas do Coach, compactação do log) | **Vercel Cron** chamando `GET /api/cron/tick` |
| Pedido da IA rodando em segundo plano | Continua depois da resposta com `waitUntil`; o resultado é gravado no banco e qualquer instância o enxerga |
| Cronômetro de descanso (push ao fim do descanso) | `waitUntil` dentro da invocação que agendou, com cancelamento persistido |
| Log de auditoria num arquivo | Uma linha por evento (sem disputa entre requisições) |
| Admin socket local (`recover`) | Não existe; a recuperação é pelo e-mail da conta |

O que **continua igual**: contas, treinos, histórico, progressão, o Coach de IA, planos, Asaas e webhooks, painel admin, PWA, notificações push.

## Plano da Vercel

O CorpoFit AI funciona no plano **Hobby** (gratuito): o cron nativo roda uma vez por dia (`vercel.json`) e o agendamento frequente (lembretes, revisões do Coach) vem de um workflow do GitHub, `.github/workflows/cron-tick.yml`, que chama `/api/cron/tick` a cada 5 minutos. Basta cadastrar os segredos do repositório `APP_URL` e `CRON_SECRET` (Settings → Secrets and variables → Actions). Funções ficam em 300 s.

**Atenção aos termos da Vercel:** o Hobby é para uso **pessoal e não comercial**. Cobrar assinaturas é uso comercial e, pelos termos da Vercel, exige o Pro (ou outro plano comercial). Isso não é uma limitação técnica do código, e a decisão é sua.

## Passo a passo

1. **Banco:** no painel da Vercel → Storage → Marketplace → **Neon (Postgres)** → crie e conecte ao projeto. Isso define `DATABASE_URL` (use a URL **com pooler**). Se o seu banco tem pooler, defina também **`MIGRATE_DATABASE_URL`** com a URL **direta** (sem pooler), usada só nas migrações.
2. **Projeto:** importe o repositório na Vercel. O `vercel.json` da raiz define dois serviços: `web` (Vite, pasta `frontend/`) e `api` (pasta `api/`, entrada `vercel-entry.js`), as rotas (`/api/*` → api, o resto → web), o cron e os cabeçalhos de segurança. Deixe o *framework preset* em "Other"/automático.
3. **Variáveis de ambiente** (Production e, se usar, Preview), sem chaves no código:
   - `APP_SECRET`: ≥ 32 caracteres aleatórios (`openssl rand -base64 48`). **Não troque depois**: assina as sessões e cifra a chave da IA.
   - `CRON_SECRET`: texto aleatório; a Vercel o envia ao cron como `Authorization: Bearer …`.
   - `AI_API_KEY`, `AI_MODEL` (padrão `claude-haiku-5-5`), `AI_PROVIDER`…; `ASAAS_API_KEY`, `ASAAS_ENV`, `ASAAS_WEBHOOK_TOKEN`; `RESEND_API_KEY`, `MAIL_FROM`; `SOURCE_CODE_URL`, `SUPPORT_EMAIL`. Lista completa em [ENVIRONMENT.md](ENVIRONMENT.md).
   - `ORIGIN`, `RP_ID`, `APP_URL`: opcionais. Se faltarem, vêm do domínio da Vercel (`VERCEL_PROJECT_PRODUCTION_URL`). Com **domínio próprio**, defina-as com ele (`ORIGIN=https://app.seudominio.com.br`, `RP_ID=app.seudominio.com.br`).
4. **Deploy.** O build do `api` aplica as migrações (`scripts/vercel-build.sh`); se falharem, o deploy não sai e a versão anterior continua no ar.
5. **Primeiro administrador:** na primeira vez, defina `FIRST_USER_ADMIN=1`, faça um novo deploy, crie **a sua** conta, remova a variável e faça outro deploy. (Ou liste o seu ID em `ADMIN_UIDS`, visto em Configurações → Conta.)
6. **Webhook do Asaas:** `https://SEU-DOMINIO/api/webhooks/asaas` com o token de `ASAAS_WEBHOOK_TOKEN` ([PAYMENTS_SETUP.md](PAYMENTS_SETUP.md)). Em **Settings → Deployment Protection**, deixe **a produção pública** (a proteção por login da Vercel bloquearia o Asaas).
7. **Conferir:** `https://SEU-DOMINIO/api/health` → `{"ok":true,…}`; entre no app; em "Financeiro e IA" veja o ambiente.

## Operação
- **Logs:** Vercel → Logs (por função). Erros de integração (Asaas/IA) também aparecem em "Financeiro e IA".
- **Backup:** o PostgreSQL guarda **tudo** (contas, treinos, cobranças). Use o backup/PITR do provedor (Neon) e teste a restauração ([DATABASE.md](DATABASE.md)).
- **Atualizar:** `git push`; a Vercel faz o deploy e as migrações. *Rollback* instantâneo pelo painel (as migrações são só de acréscimo).
- **Previews:** crie um banco separado (branch do Neon) para o ambiente Preview; não aponte previews para o banco de produção.

## Limites do modo Vercel (o que muda de verdade)

Nada foi removido sem aviso; estes são os pontos em que a plataforma obriga a ser diferente:
- **Fotos e vídeos** (de exercício próprio e de progresso): **desligados** (`MEDIA_UPLOADS=0`). Uma função recebe no máximo 4,5 MB por requisição, e os vídeos chegam a 40 MB; religar exige enviar direto ao **Vercel Blob** (previsto no [ROADMAP.md](ROADMAP.md)). Pela especificação do produto, esta versão não usa mídia de exercícios.
- **Integrações** (webhooks assinados para Home Assistant/n8n, Health): desligadas; exigem fila persistente.
- **"Comparar com outros"** do Coach: desligado (varrer todos os perfis a cada pedido não cabe numa função).
- **Presença ao vivo** no painel admin (quem está treinando agora): por instância, portanto parcial.
- **Cronômetro de descanso longo:** o aviso é enviado por uma função que espera; descansos maiores que o tempo máximo da função (300 s no Hobby, 800 s no Pro) não geram o aviso.
- **Tamanho do documento de um perfil:** cada sincronização é uma requisição de até 4,5 MB (histórico gigantesco pode passar disso).
- **Escala:** cada requisição lê o `db.json` (todas as contas) do banco. Atende bem até alguns milhares de contas; acima disso o próximo passo é normalizar `db.json` em linhas por usuário (ROADMAP).
- **O `vercel.json` (serviços) não foi exercitado numa implantação real** aqui; veja IMPLEMENTATION_STATUS.md.

## Desenvolver sem a Vercel
`cd api && npm run db:dev` (PostgreSQL embutido) e, em outro terminal, `npm run dev:serverless` (a mesma função, atrás de um servidor HTTP local, com `STORAGE=postgres`). Os testes `api/test/saas-vercel*.test.js` sobem **duas instâncias** sobre o mesmo banco para provar que nenhuma guarda estado só na memória.
