# Instalação

Requisitos: Node.js 22+, npm 10+, PostgreSQL 14+ (Docker, instalado, ou o embutido para desenvolvimento). Docker é opcional.

## 1. Dependências

```bash
npm ci                                   # raiz: js-yaml, usado pelos scripts de verificação
(cd api && npm ci --omit=optional)       # API (instala o Prisma e gera o cliente)
(cd frontend && npm ci)                  # app
```

`--omit=optional` evita o SDK opcional do Claude Agent, que a CorpoFit AI não usa (ela chama a API HTTPS do provedor).

## 2. Variáveis de ambiente

```bash
cp .env.example .env
```

Para o modo SaaS preencha a seção "CorpoFit AI" ([ENVIRONMENT.md](ENVIRONMENT.md)). O mínimo para subir: `DATABASE_URL`, `ORIGIN`/`RP_ID`, `SAAS_MODE=1`, `PASSWORD_LOGIN=1`. Sem `AI_API_KEY` a IA fica desligada; sem `ASAAS_API_KEY` os pagamentos ficam desligados (o app diz isso claramente).

## 3. PostgreSQL

- **Docker:** `docker compose -f docker-compose.corpofitai.yml up -d db` (veja [DOCKER.md](DOCKER.md)).
- **Instalado:** crie banco e usuário e ajuste `DATABASE_URL`.
- **Sem Docker nem Postgres (só desenvolvimento):** `cd api && npm run db:dev` (porta 5432, usuário/senha `corpofitai`, bancos `corpofitai` e `corpofitai_test`; dados em `api/.devdb/`).

## 4. Migrações

```bash
cd api
DATABASE_URL=postgresql://corpofitai:corpofitai@localhost:5432/corpofitai?schema=public npx prisma migrate deploy
```

(Em produção o `docker-entrypoint.sh` da API roda isso sozinho quando `SAAS_MODE=1`.) A API também cria/atualiza as linhas de `Plan` ao iniciar, a partir de `api/saas/plans.js`.

## 5. Executar

**Como na Vercel** (recomendado para testar o produto de verdade): `cd api && APP_SECRET=... DATABASE_URL=... ORIGIN=http://localhost:5173 RP_ID=localhost PORT=3000 npm run dev:serverless` (a mesma função, com o estado no PostgreSQL).

Ou como servidor tradicional (arquivos em disco):

API (porta 3000) e app (porta 5173, com proxy de `/api`):

```bash
cd api && SAAS_MODE=1 PASSWORD_LOGIN=1 DATA_DIR=./.data ORIGIN=http://localhost:5173 RP_ID=localhost \
  DATABASE_URL=postgresql://corpofitai:corpofitai@localhost:5432/corpofitai node server.js
cd frontend && API_ORIGIN=http://localhost:5173 npm run dev
```

(`API_ORIGIN` precisa ser igual ao `ORIGIN` da API: é a proteção CSRF do openGym.) Abra http://localhost:5173 .

## 6. Primeiro administrador

O admin é uma flag no perfil do openGym (`db.json`). Duas formas:

1. **Instalação nova:** suba com `FIRST_USER_ADMIN=1`, crie a **sua** conta primeiro e depois remova a variável. O primeiro perfil criado vira admin e dono.
2. **Instalação existente:** crie a conta, veja o seu ID em Configurações → Conta → "ID da conta" e liste-o em `ADMIN_UIDS=seu-id` (reinicie a API).

O painel fica em Configurações → Painel admin (usuários, convites, Coach) e em **Financeiro e IA** (assinaturas, cobranças, webhooks, Premium manual, consumo da IA).

## 7. Qualidade

```bash
cd api && npm test
cd frontend && npm test && node scripts/check-locales.mjs && node scripts/check-source-strings.mjs --strict && npm run build
```

Alguns testes originais do openGym falham no **Windows** por razões do sistema (permissões `chmod`, processo auxiliar, finais de linha): são os mesmos antes e depois das mudanças do CorpoFit AI (ver IMPLEMENTATION_STATUS.md). Os testes do SaaS (`api/test/saas-*.test.js`) usam um banco `corpofitai_test` em `localhost:5432` (ou `TEST_DATABASE_URL`); sem o banco são **pulados**.

## Atualizar

```bash
git pull
(cd api && npm ci --omit=optional && npx prisma migrate deploy)
(cd frontend && npm ci && npm run build)    # ou reconstruir as imagens Docker
```

Antes de cada `migrate deploy` em produção, faça backup ([DATABASE.md](DATABASE.md)).

## O que depende de credenciais externas

`AI_API_KEY` (IA), `ASAAS_API_KEY` + `ASAAS_WEBHOOK_TOKEN` (pagamentos), `RESEND_API_KEY` + `MAIL_FROM` (e-mail de recuperação de senha; sem isso o código só aparece no log do servidor), `SOURCE_CODE_URL` (link público do código).
