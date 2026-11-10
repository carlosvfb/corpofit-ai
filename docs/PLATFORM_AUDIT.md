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

## 8. Fase 4 concluída (2026-11-09)

Entregue em `api/saas/org/trainers.js`, rotas `/api/trainer/*`, migração `20261109160000_trainers` e a tela `/personal` (Ajustes > Personal trainer).

- **Perfil profissional** (`TrainerProfile`): nome, bio e especialidades. É um cartão visível entre usuários logados; só o dono altera.
- **Vínculo** (`TrainerStudent`): o personal convida um aluno que já tem conta, ou o aluno pede um personal que tem perfil. Só o lado que NÃO iniciou aceita. Com `tenantId`, os dois precisam ser membros ativos da academia (personal ou nível acima; aluno), e o pedido entra no registro de atividade dela. Qualquer lado encerra; o personal perde o acesso na hora e os treinos já recebidos ficam com o aluno, arquivados.
- **Treinos enviados** (`Assignment`): o personal envia uma das rotinas que ele mesmo montou, no formato do link de rotina do app. O servidor limita tamanho e forma; o app do aluno valida e importa pelo mesmo caminho dos links de amigo. Cada edição guarda a versão anterior (até 20) com autor e data; o aluno não edita.
- **Comentários** dos dois lados em cada treino enviado.
- **Isolamento:** só as duas partes do vínculo veem vínculo, treinos e comentários (RLS por `app.user_id` no banco e verificação na API; terceiros recebem 404).
- **Testes:** `api/test/saas-trainers.test.js` (10) + `frontend/src/saas/Personal.test.jsx` (3). Suíte SaaS da API: 93 de 93.

Fora desta fase, de propósito: o personal **não lê** nenhum dado do aluno (treinos feitos, medidas, peso, fotos) nem altera as rotinas dele. Isso entra na Fase 5, com o consentimento por categoria. Sugestões de alteração e notificações também ficam para as próximas fases.

## 9. Fase 5 concluída (2026-11-09)

Entregue em `api/saas/org/privacy.js` e `projection.js`, rotas `/api/privacy/*` e `/api/trainer/shared|student`, migração `20261109190000_privacy` e as telas `/privacidade` (Ajustes > Privacidade e compartilhamento) e a leitura em `/personal`.

- **Modelo:** `SharingPermission` (aluno × personal × categoria × nível), `ConsentRecord` (histórico imutável de concessões, mudanças e revogações, sem política de UPDATE/DELETE) e `AccessLog` (cada leitura de dados do aluno por um personal).
- **Categorias disponíveis:** treinos realizados, rotinas, histórico de exercícios, peso corporal, medidas, observações e indicadores de atividade. Fotos de evolução e bem-estar existem no tipo, mas não podem ser compartilhadas (não há leitura segura implementada).
- **Níveis:** OFF (padrão), SEE e SUGGEST (só para rotinas). CHANGE_DIRECTLY existe no tipo e é recusado: alterar direto a conta do aluno não está implementado.
- **Verificação a cada requisição:** `GET /api/trainer/student` confere o vínculo ativo e o nível agora, registra o acesso e devolve só a projeção da categoria (e-mail, credenciais, dados do Coach e outras categorias nunca saem). Revogar, revogar tudo ou encerrar o vínculo cortam a próxima leitura.
- **Sugestões:** com ROUTINES = SUGGEST o personal envia uma sugestão para uma rotina do aluno; nada muda sem o aluno aceitar, e aceitar cria uma rotina nova (não sobrescreve).
- **Isolamento:** RLS no banco (o personal lê só as concessões feitas a ele, não o histórico nem os acessos) e checagens na API. Um teste de RLS apanhou um erro real (insert com RETURNING num registro que o autor não pode ler) e foi corrigido.
- **Testes:** `api/test/saas-privacy.test.js` (9) e `Privacy.test.jsx` (4) + novos casos em `Personal.test.jsx`. Suíte SaaS da API: 102 de 102.

Fora desta fase: fotos e bem-estar, alteração direta (CHANGE_DIRECTLY), compartilhamento com a academia como um todo e com recursos de IA por categoria (o Coach tem o consentimento próprio), exportação e exclusão dos registros (LGPD) e notificações.

## 10. Fase 6 concluída (2026-11-09)

Entregue em `api/saas/org/ai.js`, ganchos em `api/coach/jobs.js` (`setContextHook`, tenant e provedor no evento de uso), `api/saas/usage.js` e `api/saas/ai.js`, migração `20261109210000_ai_orgs`, rotas `/api/orgs/ai-context` e `/api/orgs/ai-usage` e, na tela da academia, a aba "Uso da IA" (dono e admin) e a escolha do usuário.

- **Provedores (já existiam, reaproveitados):** Anthropic, OpenAI, Gemini e compatível com OpenAI (`AI_PROVIDER` + `AI_API_BASE_URL`: OpenRouter, Ollama e gateways). A seleção é só no servidor; a chave nunca vai ao navegador. Trocar de modelo é mudar `AI_MODEL`.
- **Contexto por academia, sem misturar:** o espaço pessoal é o padrão. O usuário escolhe "usar a orientação desta academia na minha IA" (`User.aiTenantId`); o vínculo ATIVO é revalidado a cada mensagem. As instruções e o estilo que o dono configurou entram no prompt como preferência extra, marcada como subordinada às regras da plataforma e de segurança. Sair da academia, ter o vínculo removido ou a IA desligada pela academia encerra o efeito na hora. A academia nunca recebe o conteúdo das conversas nem dados do aluno.
- **Consumo e custo:** cada chamada grava `tenantId`, `provider`, modelo, tokens e `costMicros`. O custo só é estimado se `AI_PRICES` tiver o preço do modelo (JSON, USD por milhão de tokens); sem isso fica `null` e a tela diz "indisponível". Nenhum preço foi inventado.
- **Limites:** além do limite pessoal do plano, cada academia tem um teto mensal somando seus membros: `TENANT_AI_MONTHLY_CAP` (padrão 2000), que o dono pode apenas baixar. Ao atingir, a IA da academia responde 402 e o usuário volta ao espaço pessoal. Dono e admin veem só contagens (total, tokens, custo e mensagens por membro).
- **Ferramentas e aprovação:** o Coach já propõe mudanças tipadas (criar rotina, revisar, adaptar o treino em andamento), validadas e só aplicadas depois que o usuário aprova. Isso foi mantido. **Não** foram criadas ferramentas novas de IA para excluir, atribuir treino a aluno ou gerar relatórios, nem "desfazer" de ações da IA; ficam pendentes.
- **Modelo por academia:** não implementado (todas usam `AI_MODEL`); o consumo já guarda o modelo para quando existir.
- **Testes:** `api/test/saas-orgai.test.js` (8) e casos novos em `Gyms.test.jsx`. Suíte SaaS da API: 110 de 110. Os 5 testes do Coach que falham na máquina Windows são os mesmos de antes (processo auxiliar de teste).

## 11. Fase 7 concluída (2026-11-09)

Entregue em `api/saas/org/community.js`, rotas `/api/community/*`, migração `20261109230000_community` e a tela `/biblioteca` (Ajustes > Biblioteca).

- **Conteúdo:** rotinas, dicas e artigos. Cada item guarda autor, data, visibilidade (todos ou só a academia), academia dona, status de moderação e a declaração do autor de que o conteúdo é dele e pode ser compartilhado. Planos completos existem no modelo, mas a publicação deles não foi implementada; equipamentos personalizados também ficam para depois.
- **Higienização no servidor:** da rotina saem pesos, mídias, links, e-mail, telefone e quem enviou; textos com e-mail, telefone ou CPF são recusados. Nenhuma mídia de exercício circula (só texto e estrutura de treino), o que mantém a biblioteca fora do problema de licença das imagens do catálogo. Limite de 10 publicações por dia por autor.
- **Visibilidade:** o público vale para qualquer usuário logado; o da academia, só para membros ativos (publicar nela exige personal ou acima). Sair da academia ou ter o vínculo removido tira a visão na hora. Para quem não tem acesso, o conteúdo "não existe" (404).
- **Importar:** o servidor devolve o treino higienizado e conta a importação; o app o adiciona como rotina nova pelo mesmo caminho dos links de amigos, sem sobrescrever nada. Favoritar e buscar por texto e tipo.
- **Denúncias e moderação:** uma denúncia por pessoa e item, nunca no próprio conteúdo. Três pessoas diferentes escondem o item até um moderador decidir. Dono e admin da academia moderam só o conteúdo dela (ocultar, restaurar ou ignorar as denúncias, tudo registrado no histórico da academia); o admin da plataforma modera tudo pela API (`scope=platform`), sem tela própria ainda.
- **Isolamento:** RLS no banco. O papel de moderador e o contador de importações só são concedidos pelo servidor, depois de checar o papel ou a visibilidade, e valem para um escopo estreito (a academia do moderador, ou um único item). Teste prova que um moderador de academia não alcança conteúdo público e que o contador não mexe em outro item.
- **Testes:** `api/test/saas-community.test.js` (9) e `Library.test.jsx` (7). Suíte SaaS da API: 119 de 119.

## 12. Fase 8 concluída (2026-11-10)

Entregue em `api/saas/org/gym-plans.js` e `billing.js`, rotas `/api/orgs/plans`, `/api/orgs/billing*`, migração `20261110090000_tenant_billing` e a aba "Plano" no painel da academia.

- **Reaproveitamento:** a assinatura de uma academia é uma `Subscription` com `tenantId` (e `tenantPlan`), paga por quem é dono. Todo o fluxo do Asaas existente vale sem duplicação: checkout (cartão, Pix, Pix Automático), webhooks idempotentes, inadimplência com tolerância e cancelamento. O `planCode` dessas linhas é só o valor técnico `PREMIUM` (chave estrangeira); o plano da academia está em `tenantPlan`. As consultas do plano pessoal e do painel Premium do admin passaram a ignorar linhas de academia.
- **Planos:** `GYM_FREE` (padrão, sem assinatura), `GYM_START` e `GYM_PRO`. Os **limites** (alunos, profissionais, mensagens de IA por mês) são padrões de partida, ajustáveis por `GYM_PLANS` (JSON) sem mexer no código. Os **preços não têm padrão**: um plano pago sem preço configurado aparece como "Preço a definir" e a contratação é recusada. Defina, por exemplo: `GYM_PLANS={"GYM_START":{"priceCents":19900}}`.
- **Direitos (entitlements) no servidor:** o plano em vigor sai da assinatura vigente (ativa, em tolerância ou cancelada dentro do período pago); senão, grátis. O app nunca decide.
- **Limites aplicados:** convidar ou mudar o papel de alguém para aluno, personal ou gerente confere a vaga (402 `plan-limit`); donos e administradores não contam. O teto de mensagens de IA da academia passou a ser o menor entre a plataforma, a configuração da academia e o plano. Acima do limite, ninguém é removido nem perde dados: só não entra gente nova até ampliar o plano.
- **Quem pode o quê:** dono contrata e cancela; dono, admin e gerente veem plano, uso e limites; aluno e personal não. Contratar nunca libera nada antes da confirmação do pagamento pelo webhook. Trocar de plano é cancelar o atual e contratar o novo (o atual vale até o fim do período pago).
- **Testes:** `api/test/saas-gymbilling.test.js` (10) e casos novos em `Gyms.test.jsx`. Suíte SaaS da API: 129 de 129 com `--test-concurrency=2`; com a concorrência padrão do Node (todos os arquivos ao mesmo tempo no mesmo PostgreSQL embutido) um teste diferente falha a cada rodada por sobrecarga, e cada um passa isolado.
- **Fora desta fase:** plano próprio para personal trainers (só avaliado: o personal independente hoje não paga; a decisão comercial é sua), upgrade com cobrança proporcional, trial, notas fiscais e a tela de planos de academia no site público.

## 13. Fase 9: fechamento e relatório final (2026-11-10)

### A descoberta mais importante do fechamento
Ao conferir o banco de produção (consulta somente de leitura), o papel de conexão do Neon (`neondb_owner`) tem **BYPASSRLS**: o Row Level Security das Fases 2 a 8 **não valia para ele**. As verificações de papel na API sempre valeram; o que faltava era a segunda camada, a do banco. Corrigido nesta fase: a migração `20261110130000_app_role` cria o papel `corpofit_app` (sem LOGIN, sem superusuário, sem BYPASSRLS) e `withContext` passa a trocar para ele (`SET LOCAL ROLE`) em toda transação de academia, personal, privacidade, biblioteca e IA. É automático em produção (schema `public`); `RLS_ROLE` força outro papel em qualquer ambiente. Se o papel não existir ou não puder ser assumido, o servidor avisa no log. A afirmação anterior de que "o papel padrão do Neon serve" estava errada.

### LGPD
- **Acesso e portabilidade:** `GET /api/privacy/export` devolve em JSON tudo o que a plataforma guarda sobre a pessoa em academias, vínculos com personal, treinos trocados, comentários, compartilhamento, consentimento, quem leu seus dados e biblioteca. Treinos, medidas e histórico continuam no export principal do app.
- **Eliminação:** ao excluir a conta, `eraseUserData` apaga perfil de personal, vínculos (levando junto treinos enviados e comentários), concessões, histórico de consentimento, registro de acessos, itens da biblioteca, favoritos e denúncias, e tira a pessoa de todas as academias. Cancela também as assinaturas de academia que ela pagava. Se era o único dono, a academia fica `NO_OWNER` para revisão, com os dados dela intactos. Mantidos por obrigação ou autoria pseudonimizada: cobranças (fiscal) e o registro de atividade das academias.
- **Minimização:** o personal só lê categorias que o aluno liberou, por projeção; fotos e bem-estar não são compartilháveis.

### Auditoria de dependências
- Frontend: `npm audit --omit=dev` sem vulnerabilidades.
- API: 3 avisos altos, todos na cadeia `prisma` → `@prisma/config` → `deepmerge-ts` (esgotamento de pilha ao mesclar objetos recursivos, GHSA-ggr8-5vv4-36mx). É ferramenta de linha de comando usada nas migrações, sem entrada de usuário; a correção exige Prisma 7 (mudança incompatível) e **não foi aplicada**. Reavalie ao migrar de versão.

### A. Funcionalidades implementadas (todas testadas)
Multi-tenant com papéis (dono, administrador, gerente, personal, aluno), convites e vínculos; painel da academia com contagens reais; personal trainers com perfil, vínculos, treinos enviados com histórico e comentários; privacidade por categoria com consentimento, histórico e registro de acessos; sugestões de rotina com aceite do aluno; IA por academia (contexto escolhido pelo usuário, teto mensal, consumo e custo estimado); biblioteca comunitária com moderação; planos e cobrança de academias; exportação e eliminação LGPD.

### B. Pendente
Fotos de evolução e bem-estar (compartilhamento); alteração direta pelo personal (`CHANGE_DIRECTLY`); compartilhamento com a academia inteira; ferramentas de IA novas (excluir, atribuir a aluno, relatórios) e "desfazer" de ações da IA; modelo de IA por academia; publicação de planos completos e equipamentos na biblioteca; notificações push e internas dos novos eventos; plano próprio para personal independente; cobrança proporcional em troca de plano; convite a quem ainda não tem conta; verificação de e-mail no cadastro; tela de moderação para o admin da plataforma; migração do índice de contas (`db.json`) para linhas por usuário (escala além de alguns milhares); telas só em pt-BR.

### C. Banco e migrações (todas aditivas, sem apagar dados)
`orgs`, `trainers`, `privacy`, `ai_orgs`, `community`, `tenant_billing`, `erasure`, `app_role`. Tabelas novas: Tenant, TenantSettings, Membership, ActivityLog, TrainerProfile, TrainerStudent, Assignment, AssignmentComment, SharingPermission, ConsentRecord, AccessLog, CommunityItem, CommunityFavorite, CommunityReport. Colunas novas: `User.aiTenantId`, `UsageRecord.tenantId/provider/costMicros`, `Subscription.tenantId/tenantPlan`, `Assignment.kind/target`. Todas as tabelas de dados de academia têm RLS forçado.

### D. Testes
- API (SaaS, PostgreSQL real, `--test-concurrency=2`): **135 de 135** passam. Com a concorrência padrão do Node um teste diferente falha por rodada por sobrecarga do banco embutido da máquina de desenvolvimento; cada um passa isolado.
- Frontend (suíte inteira): 7.855 passam e 12 falham; as falhas são de empacotamento de apps, ícones sazonais, pacotes de assets e um fallback de CSS, em arquivos que este trabalho não alterou e que já falhavam no Windows. Os testes das telas de academia, personal, privacidade e biblioteca passam.
- Os 5 testes do Coach (`api/test/coach*`) que dependem de um processo auxiliar continuam falhando no Windows, como antes.

### E. Comandos
```
cd api && npm ci && npx prisma generate
npm run db:dev                      # PostgreSQL embutido para desenvolvimento
node --test --test-concurrency=2 test/saas-*.test.js
cd ../frontend && npm ci && npm test && npm run build
```
Produção: Vercel (`DEPLOY.md`); as migrações rodam no build.

### F. Variáveis novas
`AI_PRICES`, `TENANT_AI_MONTHLY_CAP`, `GYM_PLANS` (ver `.env.example`) e `RLS_ROLE` (opcional). Nada de credencial real em arquivos do repositório.

### G. O que falta para vender
1. Definir preços e limites dos planos de academia (`GYM_PLANS`) e revisar os padrões.
2. Homologar o pagamento no Sandbox do Asaas, inclusive o de academia, e depois em produção.
3. Confirmar o papel `corpofit_app` em produção (consulta de leitura abaixo) e acompanhar o log do primeiro deploy.
4. Revisão jurídica de Termos e Privacidade, RIPD para fotos e dados de saúde antes de liberar esses compartilhamentos, e designar o encarregado (DPO).
5. Teste real da IA de ponta a ponta com a chave de produção, e configurar `AI_PRICES` para ver o custo.
6. Domínio próprio, e-mail transacional (Resend) e backups do Neon.
7. Rodar a suíte completa em Linux (CI) para ter o estado verdadeiro, sem as falhas do Windows.

Verificação do RLS em produção (somente leitura): conectado como o dono do banco, `BEGIN; SET LOCAL ROLE corpofit_app; SELECT count(*) FROM "Membership"; ROLLBACK;` deve devolver 0.

## 14. Suíte do personal: agenda, ficha do aluno e montador (2026-11-10)
- **Banco:** `TrainingSession` (dia e horário exatos em UTC, duração, local, status PLANNED/CONFIRMED/DONE/MISSED/CANCELLED, série semanal) e `TrainerNote` (anotações privadas), migração `20261110180000_trainer_suite`. RLS: a agenda é das duas partes do vínculo; as anotações, só do personal.
- **API:** `api/saas/org/schedule.js` e rotas `/api/trainer/overview|sessions|notes` e `/api/privacy/preset` (todas em `openapi.yaml`). Marcar com repetição semanal (até 12), recusa de horário que colide com outra sessão do personal (409), confirmar/recusar pelo aluno, remarcar (volta a pedir confirmação), registrar feito/faltou perto do horário, cancelar (uma ou a série). Encerrar o vínculo cancela a agenda futura. Avisos in-app para a outra parte. Exportação LGPD inclui agenda e anotações; excluir a conta leva tudo junto (cascata do vínculo).
- **Privacidade:** a visão geral só usa frequência se o aluno liberou ACTIVITY ou WORKOUTS, e cada leitura entra no registro de acessos. Atalhos de compartilhamento (`none`, `training`, `full`) passam por `setPermission`, então geram o mesmo histórico de consentimento. O aluno continua no controle; CHANGE_DIRECTLY segue recusado.
- **Falha achada pelos testes:** `listSessions` dependia só do RLS para isolar; agora filtra explicitamente por participante (defesa em profundidade).
- **App:** portal do personal com barra Alunos | Agenda | Exercícios | Biblioteca | Perfil; ficha do aluno com abas Treinos, Agenda, Progresso, Notas, Acesso; montador de treino a partir do catálogo (só texto, sem mídia); no app do aluno, treinos marcados com confirmar/recusar e o atalho de compartilhamento ao aceitar um personal.
- **Testes:** `saas-schedule.test.js` (10), `TrainerPages.test.jsx` (5); suíte SaaS da API 153 de 153; frontend `src/saas` 41 de 41.
- **Não verificado:** uso real em celular e produção (a verificação visual fica por conta do primeiro uso após o deploy); notificação push da agenda (só aviso dentro do app).

## 15. Gestão da academia (2026-11-10)
- **Banco:** migração `20261111100000_gym_ops`: a gestão (dono, administrador, gerente) lê e atualiza os vínculos com `tenantId` da própria academia e lê a agenda e os treinos enviados desses vínculos. Insert/update de vínculo só com a academia em uso e vínculo ativo de gestão.
- **API:** `api/saas/org/gym-ops.js` e `/api/orgs/roster|assign-trainer|schedule|workouts` (em `openapi.yaml`). Vincular aluno a personal é proposta (o aluno aceita); trocar encerra o vínculo anterior e cancela a agenda futura; tudo vai para o registro de atividade e avisa as partes.
- **Privacidade:** a gestão não lê dados de treino do aluno nem anotações privadas do personal; o aluno é avisado no app de que a academia vê o vínculo, a agenda e os treinos enviados.
- **Falha evitada:** com a nova política de leitura, `listLinks` e `listAssignments` dependiam só do RLS; agora filtram explicitamente por participante.
- **App:** portal da academia com Visão geral (números), Alunos, Equipe, Agenda (calendário), Treinos e Membros e convites.
- **Testes:** `saas-gymops.test.js` (5, sob papel que obedece ao RLS); suíte SaaS 158 de 158; frontend `src/saas` 44 de 44.
- **Não feito:** relatório de frequência por aluno para a gestão (depende de permissão do aluno), cobrança de mensalidade dos alunos pela academia, e criação de treinos diretamente pela gestão.
