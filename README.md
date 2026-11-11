# CorpoFit AI

Plataforma fitness SaaS em português, construída **sobre o openGym** (rastreador de treino de código aberto, AGPL-3.0). O CorpoFit AI mantém o que o openGym já faz muito bem (planos de treino, registro guiado de sessões, progressão de carga, histórico e evolução, o Coach de IA, painel admin) e acrescenta o que falta para vender: contas por e-mail, planos Gratuito/Premium, cobrança recorrente pelo **Asaas** (cartão, Pix Automático e Pix mensal), limites e consumo da IA por plano, painel financeiro e site público.

O nome, as cores e o e-mail de suporte ficam centralizados e são fáceis de trocar (`frontend/src/saas/brand.js`, `api/saas/brand.js`, `BRAND_NAME`, `SUPPORT_EMAIL`).

> Primeira leitura: [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) (o que está pronto, o que foi verificado e o que depende de credenciais) e [LICENSES_AND_ATTRIBUTIONS.md](LICENSES_AND_ATTRIBUTIONS.md) (obrigações da AGPL e conteúdo de terceiros).

## Arquitetura (a do openGym, preservada) e como ela roda na Vercel

```
frontend/   React 19 + Vite (PWA).  src/saas/ = site público, assinatura, checkout, admin financeiro
api/        Node puro (node:http), sem framework.  api/saas/ = planos, Asaas, webhooks, IA com limites
              api/store/ = o "disco" do openGym sobre o PostgreSQL (modo Vercel)
              api/vercel-entry.js = a função da Vercel
vercel.json dois serviços (web + api), cron, cabeçalhos
catalogue/  catálogo de exercícios em texto (as mídias NÃO sobem para a Vercel; ver licenças)
```

**Tudo na Vercel, sem VPS:** o app é estático, a API é uma função e **todo** o estado (contas, treinos, cobranças, configurações) fica no **PostgreSQL**. O servidor do openGym lê e grava arquivos de forma síncrona; em vez de reescrevê-lo, a pasta `api/store/` fornece um sistema de arquivos virtual cujas "linhas" são do PostgreSQL, carregado por requisição e gravado ao final com controle otimista de revisão. Os timers viraram um endpoint de cron. Detalhes e limites em [DEPLOY.md](DEPLOY.md).

Em modo SaaS (`SAAS_MODE=1`, padrão na Vercel) o servidor ganha planos, Asaas e IA com limites. **Sem as variáveis, a API é o openGym de sempre** (arquivos em disco, para quem quiser hospedar em casa) e os testes originais continuam valendo.

| Camada | Onde vive na Vercel |
|---|---|
| Contas, senhas, sessões, passkeys, convites | PostgreSQL (`KvFile`: o antigo `db.json`) |
| Treinos, histórico, medidas, progressão, Coach | PostgreSQL (`KvFile`: o antigo `state-<uid>.json` e arquivos do Coach) |
| Assinaturas, cobranças, eventos do webhook, uso de IA, auditoria admin | PostgreSQL (tabelas Prisma) |
| IA | o Coach do openGym, com a chave da plataforma e os limites do plano |

## Início rápido (desenvolvimento)

```bash
npm ci && (cd api && npm ci --omit=optional) && (cd frontend && npm ci)
cp .env.example .env                      # veja a seção Vercel/CorpoFit AI
(cd api && npm run db:dev)                # PostgreSQL embutido (outro terminal)
cd api && DATABASE_URL=postgresql://corpofitai:corpofitai@localhost:5433/corpofitai npx prisma migrate deploy
# a API exatamente como roda na Vercel, atrás de um servidor local:
cd api && APP_SECRET=$(openssl rand -base64 48) DATABASE_URL=postgresql://corpofitai:corpofitai@localhost:5433/corpofitai   ORIGIN=http://localhost:5173 RP_ID=localhost PORT=3000 npm run dev:serverless
# em outro terminal:
cd frontend && API_ORIGIN=http://localhost:5173 npm run dev      # http://localhost:5173
```

Passo a passo em [INSTALL.md](INSTALL.md); publicação em [DEPLOY.md](DEPLOY.md).

## Documentação

| Arquivo | Conteúdo |
|---|---|
| [INSTALL.md](INSTALL.md) | Instalação, execução local, primeiro administrador, atualização |
| [ENVIRONMENT.md](ENVIRONMENT.md) | Todas as variáveis de ambiente |
| [DATABASE.md](DATABASE.md) | Modelo de dados, migrações, o que fica no PostgreSQL e o que fica em arquivos, backup |
| [AI_SETUP.md](AI_SETUP.md) | A CorpoFit AI (Coach), limites por plano, consumo, segurança das respostas |
| [PAYMENTS_SETUP.md](PAYMENTS_SETUP.md) | Asaas: sandbox, produção, webhooks, testes, homologação |
| [DOCKER.md](DOCKER.md) | Docker (opcional: desenvolvimento local ou hospedagem própria) |
| [DEPLOY.md](DEPLOY.md) | **Implantação somente na Vercel** (passo a passo, plano, limites) |
| [SECURITY.md](SECURITY.md) | Decisões e práticas de segurança |
| [LICENSES_AND_ATTRIBUTIONS.md](LICENSES_AND_ATTRIBUTIONS.md) | AGPL-3.0, mídias, créditos de terceiros |
| [ROADMAP.md](ROADMAP.md) | Próximos passos |
| [docs/](docs/README.md) | A documentação do openGym (arquitetura, API, Coach, integrações…) |
| [docs/upstream/](docs/upstream) | README, ROADMAP e SECURITY originais do openGym |

## Testes

```bash
cd api && npm test                 # openGym + SaaS (testes SaaS precisam de PostgreSQL; sem ele são pulados)
cd frontend && npm test            # vitest (openGym)
cd frontend && node scripts/check-locales.mjs && node scripts/check-source-strings.mjs --strict
```

## Licença

AGPL-3.0-or-later, como o openGym. A página `/#/licenca` do app mostra o link do código-fonte correspondente (`SOURCE_CODE_URL`). As mídias de exercício do openGym **não** são AGPL, **não** são usadas aqui e não vão na imagem; veja [LICENSES_AND_ATTRIBUTIONS.md](LICENSES_AND_ATTRIBUTIONS.md) e [NOTICE.md](NOTICE.md).
