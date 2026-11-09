# Docker (opcional)

> O CorpoFit AI é publicado **somente na Vercel** ([DEPLOY.md](DEPLOY.md)). Este documento é para quem quiser rodar localmente em contêineres ou hospedar por conta própria. Neste modo a API usa arquivos em `/data` (volume), como o openGym original.

`docker-compose.corpofitai.yml` sobe **PostgreSQL + api + web** (e, opcionalmente, **Caddy** com HTTPS). O `docker-compose.yml` original do openGym continua intacto.

```bash
cp .env.example .env     # preencha a seção CorpoFit AI: POSTGRES_PASSWORD, ORIGIN/RP_ID, AI_*, ASAAS_*, SOURCE_CODE_URL…
docker compose -f docker-compose.corpofitai.yml up -d --build
```

Abra `http://localhost:8080`. Ao iniciar, a API aplica as migrações do PostgreSQL (`api/docker-entrypoint.sh`, só com `SAAS_MODE=1`) e cria os planos.

## Serviços

| Serviço | O que é | Observações |
|---|---|---|
| `db` | PostgreSQL 16 | volume `corpofitai_pgdata`, *healthcheck* `pg_isready`, **sem porta publicada** (só a rede interna) |
| `api` | Node (openGym + `api/saas`) | volume `corpofitai_data` em `/data` (contas, treinos, segredo das sessões); `depends_on: db (healthy)`; *healthcheck* em `/api/health` |
| `web` | nginx + app | build com `NO_MEDIA=1` (sem mídias de exercício); proxy de `/api` na mesma origem |
| `caddy` | HTTPS automático | só com `--profile https`; exige `DOMAIN`, DNS e portas 80/443 |

## Comandos úteis

```bash
docker compose -f docker-compose.corpofitai.yml logs -f api
docker compose -f docker-compose.corpofitai.yml exec db psql -U corpofitai corpofitai
docker compose -f docker-compose.corpofitai.yml down            # mantém os dados
docker compose -f docker-compose.corpofitai.yml down -v         # APAGA os dados (banco e DATA_DIR)
docker compose -f docker-compose.corpofitai.yml --profile https up -d   # com HTTPS (Caddy)
```

Primeiro admin e backup: veja INSTALL.md (§6) e DATABASE.md.

## Observações

- O build da API instala o Prisma e gera o cliente (precisa de rede para baixar os motores). O `Dockerfile` da API ganhou `openssl`, `COPY saas`, `COPY prisma` e o *entrypoint*; o alvo `coach` (SDK do Claude Agent) continua opcional e **não** é necessário para a CorpoFit AI.
- Senhas do Postgres com caracteres especiais exigem *escape* na `DATABASE_URL`; prefira `openssl rand -hex 24`.
- **Estas imagens não foram construídas neste ambiente** (o Docker Desktop estava parado). Valide com `docker compose -f docker-compose.corpofitai.yml build` antes de publicar; ver IMPLEMENTATION_STATUS.md.
