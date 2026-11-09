# Variáveis de ambiente

Segredos existem somente no backend; nada aqui é enviado ao navegador. Nunca versione o `.env`. As variáveis do openGym continuam valendo (`docs/SELF_HOSTING.md`); abaixo, as que o CorpoFit AI usa ou acrescenta.

## Servidor e modo SaaS

| Variável | Obrigatória | Descrição |
|---|---|---|
| `SAAS_MODE` | **sim** (para o CorpoFit AI) | `1` liga planos, cobrança, IA com limites e financeiro. Sem ela, é o openGym puro |
| `DATABASE_URL` | com `SAAS_MODE=1` | PostgreSQL. Use senha sem caracteres especiais (ex.: `openssl rand -hex 24`) ou faça o escape na URL |
| `ORIGIN` | sim | URL pública do app (https em produção). Também é a proteção CSRF do openGym |
| `RP_ID` | sim | Hostname do app (ex.: `app.seudominio.com.br`; `localhost` em desenvolvimento) |
| `APP_URL` | recomendada | URL pública usada nos retornos do checkout (padrão: `ORIGIN`) |
| `PASSWORD_LOGIN` | **sim** (SaaS) | `1`: login por e-mail e senha (o cadastro SaaS é por e-mail + senha) |
| `DEFAULT_LANG` | recomendada | `pt-BR`: idioma inicial do app |
| `DATA_DIR` | sim | Pasta do estado do openGym (contas, treinos, segredo da sessão): **fazer backup** |
| `FIRST_USER_ADMIN`, `ADMIN_UIDS` | para o 1º admin | Veja INSTALL.md |
| `SOURCE_CODE_URL` | recomendada | Link público do código-fonte correspondente (AGPL), exibido em "Licença e código-fonte" |
| `SUPPORT_EMAIL`, `BRAND_NAME`, `BRAND_AI_NAME` | não | Marca e contato nos textos e e-mails |
| `TRUST_PROXY` | atrás de proxy | `1` quando o proxy reescreve `X-Forwarded-For` (o compose já define) |

## Vercel (modo padrão do CorpoFit AI)

Na Vercel `api/vercel-entry.js` já liga `STORAGE=postgres`, `SAAS_MODE=1`, `PASSWORD_LOGIN=1`, `MEDIA_UPLOADS=0`, `TRUST_PROXY=1`, `DEFAULT_LANG=pt-BR` e deriva `ORIGIN`/`RP_ID`/`APP_URL` do domínio do projeto. Você só define:

| Variável | Obrigatória | Descrição |
|---|---|---|
| `DATABASE_URL` | **sim** | PostgreSQL (Marketplace/Neon), URL **com pooler** |
| `MIGRATE_DATABASE_URL` | se o banco tem pooler | URL **direta**, usada só pelas migrações no build |
| `APP_SECRET` | **sim** | 32 caracteres ou mais. Assina as sessões e cifra a chave da IA. Não troque depois. Substitui o arquivo `secret` do openGym |
| `CRON_SECRET` | **sim** | A Vercel o envia ao cron (`Authorization: Bearer ...`); protege `GET /api/cron/tick` |
| `ORIGIN`, `RP_ID`, `APP_URL` | com domínio próprio | `https://app.seudominio.com.br` e `app.seudominio.com.br` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | não | Chaves das notificações push. Sem elas são geradas uma vez e guardadas no banco |
| `FIRST_USER_ADMIN`, `ADMIN_UIDS` | para o 1º admin | Veja DEPLOY.md |
| `SOURCE_CODE_URL` | recomendada | Link público do código-fonte correspondente (AGPL) |
| `SUPPORT_EMAIL`, `BRAND_NAME`, `BRAND_AI_NAME` | não | Marca e contato |

Fora da Vercel (disco): `STORAGE` ausente, `DATA_DIR` com a pasta de dados e, no modo SaaS, `SAAS_MODE=1` + `DATABASE_URL`. As demais variáveis do openGym (`docs/SELF_HOSTING.md`) continuam valendo.

## IA (somente backend)

| Variável | Padrão | Descrição |
|---|---|---|
| `AI_PROVIDER` | `anthropic` | `anthropic`, `openai`, `gemini` ou `compatible` |
| `AI_API_KEY` | (vazio = IA desligada) | Chave do provedor. Fica criptografada em `DATA_DIR/coach.json` (como o Coach do openGym) e nunca no banco de usuários |
| `AI_MODEL` | `claude-haiku-5-5` | Modelo. O nome não é espalhado pelo código |
| `AI_MAX_OUTPUT_TOKENS` | `1500` | Teto global de tokens de saída |
| `AI_TEMPERATURE` | (não enviada) | Opcional; só vai ao provedor se definida |
| `AI_API_BASE_URL` | (oficial) | Opcional: gateway, proxy ou endpoint compatível |

Limites por plano (mensagens por mês e por minuto, tamanho da mensagem) **não** são variáveis: ficam em `api/saas/plans.js`.

## Asaas

| Variável | Descrição |
|---|---|
| `ASAAS_API_KEY` | Chave de API (sandbox e produção são diferentes) |
| `ASAAS_ENV` | `sandbox` (padrão) ou `production` |
| `ASAAS_API_BASE_URL` | Opcional. Padrões: `https://api-sandbox.asaas.com/v3` e `https://api.asaas.com/v3` |
| `ASAAS_WEBHOOK_TOKEN` | 32–255 caracteres; o Asaas o envia no header `asaas-access-token` |
| `ASAAS_WEBHOOK_URL` | URL pública `https://…/api/webhooks/asaas` (usada ao criar o webhook por script) |
| `ASAAS_SUCCESS_URL`, `ASAAS_CANCEL_URL`, `ASAAS_EXPIRED_URL` | Retorno do checkout do cartão. Padrão: `APP_URL/#/checkout/sucesso`, `cancelado`, `expirado`. Só redirecionam, não confirmam pagamento |

## E-mail

| Variável | Descrição |
|---|---|
| `RESEND_API_KEY`, `MAIL_FROM` | Envio do código de recuperação de senha via Resend. Sem eles o e-mail só é registrado no log |

## Docker/Postgres

`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `WEB_PORT`, `DOMAIN` (perfil https): ver `docker-compose.corpofitai.yml`.

## Testes

`TEST_DATABASE_URL` (padrão `postgresql://corpofitai:corpofitai@localhost:5432/corpofitai_test`): cada arquivo de teste usa o seu próprio *schema* nesse banco.
