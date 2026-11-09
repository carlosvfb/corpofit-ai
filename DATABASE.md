# Banco de dados e armazenamento

Na Vercel o CorpoFit AI guarda **tudo no PostgreSQL**, em dois formatos:

| O quê | Onde no PostgreSQL |
|---|---|
| Contas, senhas (hash scrypt), sessões, passkeys, convites, limites de login | tabela `KvFile`: os arquivos `db.json`, `ephemeral.json` |
| Treinos, rotinas, histórico, medidas, progressão, propostas e registro do Coach, auditoria de acesso | tabela `KvFile`: `state-<uid>.json`, `coach/<uid>.json`, `coach.json`, `audit/<id>.json`… |
| Assinaturas, cobranças, eventos do webhook, cliente Asaas, consumo de IA, auditoria admin, configurações, erros | tabelas Prisma (`Subscription`, `Payment`, `PaymentEvent`, `UsageRecord`…) |

`KvFile` é o "disco" do openGym (`api/store/`): uma linha por arquivo (`path`, `content`, `rev`). O servidor continua lendo e gravando "arquivos" de forma síncrona; por requisição, as linhas necessárias são carregadas, e ao final só as alteradas são gravadas numa transação, **com controle otimista**: `UPDATE … WHERE rev = <revisão lida>`. Se outra instância gravou no meio, nada é gravado e a requisição é refeita do zero com dados novos (até 8 vezes, com espera aleatória). Nada é guardado em disco, e o segredo das sessões (`APP_SECRET`) **nunca** vai ao banco.

Hospedando em casa (sem `STORAGE=postgres`) o openGym segue usando arquivos em `DATA_DIR`, e só as tabelas SaaS ficam no PostgreSQL.

### Por que o estado de treino é um documento e não tabelas?
No openGym o estado de cada pessoa é **um documento** sincronizado entre aparelhos por revisão, com *merge* campo a campo (`lib/sync-merge.js` e `api/sync-stamps.js`). Treinos, exercícios, sessões e registros de séries são partes desse documento, não tabelas. Reescrever isso em tabelas relacionais seria trocar a tecnologia por preferência, e arriscaria a parte mais testada do projeto. Por isso as entidades pedidas ficam assim:

| Entidade pedida | No CorpoFit AI |
|---|---|
| User, UserProfile | `db.json` (openGym) + espelho mínimo `User` no PostgreSQL, **mesmo id**, criado sob demanda |
| Workout, WorkoutExercise, Exercise, WorkoutSession, ExerciseRecord | documento do perfil (`state-<uid>.json`) e catálogo em `catalogue/` |
| Conversation, Message | registro do Coach (arquivos do openGym) |
| Subscription, Payment, PaymentEvent, BillingCustomer, Plan, UsageRecord, AdminAuditLog | **PostgreSQL** |
| AppSetting, ErrorLog | **PostgreSQL** (configurações do admin e erros de integração) |

## Modelos PostgreSQL

`User` (espelho), `Plan` (espelho de `api/saas/plans.js`, que é a fonte da verdade), `UsageRecord` (uma linha por pedido à IA, com tokens de entrada e saída), `BillingCustomer` (ID do cliente Asaas e **só os 4 últimos dígitos** do documento), `Subscription` (IDs externos do Asaas: assinatura, autorização do Pix Automático, checkout; `currentPeriodEnd`, `graceUntil`), `Payment`, `PaymentEvent` (`externalEventId` **único**: base da idempotência), `AdminAuditLog`, `AppSetting`, `ErrorLog`. Valores em centavos. **Não há dados de cartão** (o cartão vai pelo checkout hospedado do Asaas) e nenhuma credencial de API no banco.

Integridade: chaves estrangeiras; `Subscription`/`Payment` com `onDelete: Restrict` (o histórico financeiro não é apagado junto com o usuário: ele é anonimizado); índices em `userId`, status/vencimento e eventos.

## Migrações

```bash
cd api
DATABASE_URL=… npx prisma migrate deploy      # aplica as migrações versionadas (api/prisma/migrations)
DATABASE_URL=… npx prisma migrate dev --name algo   # só em desenvolvimento, ao mudar o schema
```

Não há *seed*: a API cria/atualiza os `Plan` ao iniciar (fonte: `api/saas/plans.js`) e o catálogo de exercícios vem de `catalogue/` (gerado para o app). SQLite **não** é usado em produção.

## Backup

Como tudo está no PostgreSQL, **um** backup cobre o produto inteiro:

- **Gerenciado (recomendado):** backup contínuo/PITR do provedor (Neon: *point-in-time restore* e *branches*). Teste a restauração e defina a janela de retenção.
- **Extra, por conta própria:** `pg_dump --format=custom --file=corpofitai-$(date +%F).dump "$MIGRATE_DATABASE_URL"` (use a URL direta), guardado fora do provedor e criptografado (há dados pessoais). Restaurar: `pg_restore --clean --if-exists --dbname="$URL" arquivo.dump`.
- Antes de uma migração arriscada, crie uma *branch* do banco (Neon) ou um dump.
- `APP_SECRET` é **a única coisa fora do banco** que você precisa guardar (num cofre de senhas): sem ele as sessões deixam de valer e a chave da IA gravada não pode ser decifrada (basta informar de novo `AI_API_KEY`).

## LGPD: encerramento e exclusão

- **Excluir a conta** (Configurações → Conta → Excluir): o openGym apaga o perfil, o histórico, as fotos e as credenciais do Coach; o CorpoFit AI, no mesmo gesto, cancela a assinatura no Asaas (melhor esforço) e **anonimiza** o espelho no PostgreSQL (nome "Usuário removido", e-mail nulo, consumo de IA apagado). Assinaturas e cobranças ficam, sem dados pessoais, por obrigação fiscal/legal.
- **Exportar dados:** o app exporta tudo em JSON e CSV (recurso do openGym).
- Defina com o jurídico o prazo de guarda dos registros financeiros e dos backups.

## Row Level Security (academias, personal, privacidade, biblioteca)

As tabelas de academia, vínculos, compartilhamento e biblioteca têm RLS **forçado**, com políticas por `app.user_id`, `app.tenant_id` e (apenas para código do servidor, depois de verificar o papel) `app.moderator`, `app.counter` e `app.eraser`. Cada transação define esses valores por `withContext` (`api/saas/org/context.js`).

O RLS só vale para um papel sem superusuário e sem `BYPASSRLS`. O dono padrão do Neon tem `BYPASSRLS`, por isso a migração `app_role` cria o papel `corpofit_app` e as transações trocam para ele (`SET LOCAL ROLE`). Para conferir em produção: `BEGIN; SET LOCAL ROLE corpofit_app; SELECT count(*) FROM "Membership"; ROLLBACK;` deve devolver 0. `RLS_ROLE` força outro papel; sem papel utilizável o servidor avisa no log.
