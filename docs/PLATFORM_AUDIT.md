# Auditoria da plataforma (academias, personal trainers, IA)

Data: 2026-11-09. Base: openGym 1.4.4 + camada CorpoFit AI. Este documento é a Fase 1 do plano de evolução.

## 1. O que existe hoje (repositório)

| Área | Estado |
|---|---|
| App (React 19 + Vite, Zustand), PWA | Funciona. Treinos, rotinas, histórico, 1RM, recordes, medidas, estatísticas, 19 idiomas |
| API (`node:http` puro, `routes` por `'MÉTODO /caminho'`) | Funciona. Sem framework |
| Dados de treino | Um documento JSON por perfil (`state-<uid>.json`); na Vercel, um disco virtual sobre o PostgreSQL (`KvFile`) |
| SaaS (Prisma + PostgreSQL) | `User` (espelho), `Plan`, `UsageRecord`, `BillingCustomer`, `Subscription`, `Payment`, `PaymentEvent`, `AdminAuditLog`, `AppSetting`, `ErrorLog`, `KvFile` |
| Login | Senha, passkey (WebAuthn), sessão assinada; recuperação por e-mail (precisa de Resend) |
| Pagamentos | Asaas (cartão, Pix, Pix Automático), webhooks idempotentes. Testado só com Asaas simulado e, parcialmente, no sandbox |
| IA | Coach do openGym com provedores HTTP (Anthropic, OpenAI, Gemini, compatível), consentimento, limites por plano, uso de tokens. Em produção: Anthropic |
| Mídias de exercício | Fora do repositório publicado (licença Gym visual) |

Incompleto ou fora do escopo atual: verificação de e-mail no cadastro, mídias próprias, notificações push fora do rest-timer, Redis/filas, painel de academia, papéis, tenants.

## 2. Estado do openGym oficial (conferido no GitHub em 2026-11-09)

| Item | Classificação |
|---|---|
| Release estável mais recente | **v1.4.4** (2026-11-03), a mesma base deste projeto. **Não existe release 1.4.5** |
| Papel de personal trainer (Gym Lead, aluno, SEE/SUGGEST/CHANGE_DIRECTLY) | **Apenas proposta**: issue aberta `DuarteSantos8/openGym#119`. O ROADMAP aponta v1.4.10. Não há código para integrar |
| Coach (contexto, ações, aprovação) | **Disponível na release estável** (já é a base da IA do CorpoFit AI). Branches de desenvolvimento `coach-146`, `coach-consent`, `coach-more` existem; não foram incorporadas |
| Biblioteca comunitária | Branches `community-145`, `library-146`: **em desenvolvimento**, não validadas |
| Equipamento por academia | Branch `equipment-per-gym`; PR #1097 (histórico nomeia a academia): **em desenvolvimento / PR aberto** |
| Multi-tenant, RLS, memberships | **Não existem** no openGym (é single-user ou uma instância por dono) |

Regra adotada: não incorporar PRs abertos nem branches sem validação; ler o código antes de contar com qualquer funcionalidade.

## 3. Incompatibilidades com o prompt original

1. **Stack alvo (NestJS, Next.js, React Native, Redis, BullMQ) ≠ stack atual.** Migrar significaria reescrever o produto, contra a regra de não substituir o que funciona. **Decisão: manter a stack** (API Node pura + Prisma/PostgreSQL + React/Vite/PWA) e acrescentar módulos em `api/saas/`.
2. **Dados de treino em documento JSON por perfil.** Dá isolamento natural por usuário, mas não por academia. Dados novos de academia (vínculos, permissões, consentimentos, treinos atribuídos) devem ir para tabelas Prisma com `tenant_id`, não para o JSON.
3. **Cada requisição na Vercel lê `db.json`.** Escala até alguns milhares de contas. Para centenas de academias, o índice de contas precisa migrar para linhas por usuário (item já no ROADMAP).
4. **Fila e cache (BullMQ/Redis).** Na Vercel só com serviço externo. Alternativa simples: tarefas em tabela + cron (já existe `/api/cron/tick`).
5. **Mídias.** Seguem proibidas sem licença comercial; o catálogo é só texto.

## 4. Plano por fases (mantendo a stack)

| Fase | Entrega | Testes obrigatórios |
|---|---|---|
| 2 Fundação | `Tenant`, `Membership` (usuário × tenant × papel), `TenantSettings`, `ActivityLog`; RBAC central (`can(user, ação, recurso)`); RLS no PostgreSQL com `SET LOCAL app.tenant_id` por requisição | Usuário do tenant A tenta ler/gravar dados do B por ID: negado (API e RLS) |
| 3 Academias | Criar academia, convites, vínculos, alternar contexto, painel (só indicadores com dado real) | Convite, vínculo, remoção, isolamento |
| 4 Personal | `TrainerProfile`, `TrainerStudent`, treinos atribuídos, sugestões, comentários, histórico de alterações com antes/depois | Personal sem permissão não vê nem altera |
| 5 Privacidade | `SharingPermission` por categoria (OFF/SEE/SUGGEST/CHANGE_DIRECTLY), `ConsentRecord`, tela "Privacidade e compartilhamento", checagem em cada requisição, revogação imediata | Revogar bloqueia o próximo acesso |
| 6 IA | Camada de provedores (já existe), ferramentas tipadas com prévia, aprovação, desfazer, contexto por tenant/personal/indivíduo, custo por modelo | Isolamento de conversas, limite de consumo |
| 7 Comunidade | Publicar, importar, denunciar, moderar, visibilidade (pública ou da academia), sem dados pessoais | Visibilidade e moderação |
| 8 Monetização | Planos de academia e de personal, entitlements por tenant, limites de alunos/profissionais | Webhook, inadimplência, limites |
| 9 Fechamento | Documentação, auditoria de dependências, revisão LGPD | Suíte completa |

## 5. Riscos

- **Escopo:** as fases 2 a 8 são semanas de trabalho; entregar tudo de uma vez comprometeria a qualidade e a segurança.
- **Privacidade:** consentimento e RLS são o que mais precisa estar certo; começar por eles (fases 2 e 5 vêm antes de qualquer tela de personal).
- **LGPD:** dados de saúde e fotos de evolução são dados pessoais sensíveis; exigem base legal, minimização e RIPD antes de compartilhar com terceiros.
- **Custos de IA:** limites por tenant e por plano devem existir antes de abrir o recurso a academias.

## 6. Próximo passo

Fase 2: modelo de dados e RBAC com testes de isolamento entre tenants, em `api/saas/org/` (novo módulo) e novas migrações Prisma, sem alterar o fluxo atual de usuários individuais.

## 7. Fase 2 concluída (2026-11-09)

Entregue em `api/saas/org/` (`rbac.js`, `context.js`, `service.js`), rotas `/api/orgs*` (em `api/saas/routes.js` e `openapi.yaml`) e a migração `20261109130000_orgs`.

- **Dados:** `Tenant`, `TenantSettings`, `Membership` (usuário × academia × papel × status), `ActivityLog` (antes/depois). Uma conta serve a várias academias, sem duplicar.
- **Papéis:** GYM_OWNER, GYM_ADMIN, GYM_MANAGER, PERSONAL_TRAINER, STUDENT. Cada permissão vale só dentro do vínculo ATIVO. Ninguém gerencia quem tem o mesmo nível ou mais; o dono pode nomear outro dono. O último dono não sai.
- **Isolamento em duas camadas:** a API verifica o papel em cada operação (academia alheia responde 404, sem revelar que existe) e o PostgreSQL aplica Row Level Security por `app.tenant_id` / `app.user_id`, em transação (`withContext`). A migração usa `FORCE ROW LEVEL SECURITY`; superusuários do PostgreSQL nunca são restringidos, então em produção a aplicação deve conectar com um papel que não seja superusuário (o dono padrão do Neon serve). Em desenvolvimento, `RLS_ROLE=<papel sem superusuário>` faz o RLS valer mesmo conectado como dono (os testes usam isto).
- **Convites:** só para quem já tem conta (por e-mail ou id); o vínculo só vale depois do aceite do convidado.
- **Painel:** só contagens reais (membros por papel, alunos novos em 30 dias, profissionais). Frequência e evolução ficam para quando houver dados.
- **Testes:** `api/test/saas-orgs.test.js` (10), incluindo acesso a academia alheia por ID (404 em todas as operações), IDOR em vínculos, revogação imediata e RLS direto no banco com um papel sem superusuário. Suíte SaaS: 83 de 83.

Ainda não existe interface (telas) para academias: é a Fase 3. Convite de quem ainda não tem conta (por e-mail) também fica para a Fase 3.
