# Status da implementação

Última atualização: 2026-11-08. Branch: `corpofitai-saas` (a partir do `main` do openGym). Nada foi commitado.

## Estratégia

O CorpoFit AI é o **openGym** com uma camada SaaS por cima, **sem trocar a stack**: React/Vite + API Node pura + estado em JSON por perfil, mais PostgreSQL/Prisma para o que é SaaS (assinaturas, cobranças, eventos, uso de IA, auditoria). Para rodar **somente na Vercel**, o "disco" do openGym foi substituído por um sistema de arquivos virtual sobre o PostgreSQL (`api/store/`): contas, treinos e Coach ficam no banco, sem VPS. O modo liga com `SAAS_MODE=1`; sem ele, nada de `api/saas/` é carregado e a API é o openGym original. Detalhes e justificativas: README.md, DATABASE.md e DEPLOY.md.

## Reaproveitado do openGym
Planos de treino (por dia ou rodízio, supersets, progressão), treino guiado, histórico, evolução, estatísticas, mapa muscular, medidas, planos prontos (PPL, Superior/Inferior, Full Body, 5×5) e programas de várias semanas, catálogo de exercícios em texto (5.600+ entradas, 19 idiomas incl. pt-BR), **Coach de IA** (pedidos `ask/create/review/debrief/adapt`, consentimento, validação, provedores Anthropic/OpenAI/Gemini/compatível), login por senha e e-mail, sessões, limitação de tentativas, painel admin, auditoria, importações/exportações, PWA, Docker/nginx. A CorpoFit AI **é** o Coach.

## Criado para o CorpoFit AI (além disso)
Planos prontos novos, escolhidos em Plano > Plano inicial e ajustados ao equipamento do usuário: **ABC**, **ABCD**, **Em casa** (só peso do corpo) e **Glúteos e pernas**, traduzidos nos 19 idiomas, com testes.

## Criado do zero
`api/saas/` (planos, entitlements, cliente/checkout/webhook/cancelamento do Asaas, rotas, admin, gate e registro de uso da IA, e-mail), `api/prisma/` (schema + migração), `frontend/src/saas/` (site público, cadastro/login por e-mail, recuperação de senha, assinatura, checkout, financeiro admin, cartão do plano, faixa de consumo), recuperação de senha por e-mail (`POST /api/login/password-forgot`), `api/store/` (disco virtual no PostgreSQL), `api/vercel-entry.js`, `vercel.json`, `.vercelignore`, `docker-compose.corpofitai.yml` (opcional), `api/docker-entrypoint.sh`, testes `api/test/saas-*.test.js`, a documentação e as páginas legais/licença.

## Alterado no openGym (pequeno e localizado)
`api/server.js` (flag SaaS, rotas, isenção de CSRF do webhook, e-mail obrigatório + aceite no cadastro SaaS, gancho de exclusão de conta, `/api/config`), `api/coach/` (leitura de tokens dos provedores, gancho de uso no fim do job, regras extras no prompt de sistema, `temperature` opcional), `api/Dockerfile`, `api/openapi.yaml` (+ `website/api.html` gerado), `frontend/src/App.jsx`, `Home`, `CoachChat`, `Admin`, `Settings`, `lib/exercises.js` (catálogo sem mídia sob `VITE_NO_MEDIA=1`), `lib/audit.js`, `web/Dockerfile` (sem mídias), título/manifest, `.env.example`, `NOTICE.md` (seção de modificações), README/ROADMAP/SECURITY originais movidos para `docs/upstream/`.

## Resultados dos testes (rodados nesta máquina, Windows)

| Verificação | Resultado |
|---|---|
| API `npm test` (antes das mudanças) | 800 testes, 769 ok, **31 falhas já existentes** |
| API `npm test` (depois) | 848 testes (+48 novos, todos ok), **as mesmas 31 falhas, nenhuma nova** (depois, mais 11 testes de IA, todos ok) |
| API `npm test` (com o modo Vercel) | 873 testes, 842 ok, **as mesmas 31 falhas de antes, nenhuma nova** |
| Modo Vercel (`saas-vercel*.test.js`, `saas-vfs.test.js`) | Duas instâncias reais do servidor sobre o mesmo PostgreSQL: cadastro e login entre instâncias, sincronização de dados, cadastros simultâneos, limite de tentativas compartilhado, rotas SaaS, cron com segredo, segredo nunca gravado no banco, tarefa de IA em segundo plano visível por outra instância |
| Testes SaaS (`saas-*.test.js`, PostgreSQL real) | **59 de 59 ok**: status/entitlements, cliente Asaas, checkout cartão/Pix/Pix Automático, timeout, duplicidade, webhook (duplicado, fora de ordem, inválido, estorno, vencido, cancelamento), cancelamento, IA (limites, tokens, prompt, configuração), e **ponta a ponta com o servidor real** + Asaas falso por HTTP |
| Frontend `npm test` | 7.834 testes: **15 falhas → 10 já existentes (Windows) + 5 minhas, todas corrigidas** (fallbacks de `color-mix`, travessão, rótulo de auditoria); restam as falhas de baseline do Windows |
| `check-locales`, `check-source-strings --strict` | ok |
| `vite build` do frontend | ok |
| Verificação visual (navegador) | site público, cadastro (e-mail + termos), início com cartão do plano, Assinatura, Checkout, Financeiro admin: renderizam e funcionam; sem erros de console além do 401 de antes do login |

As 31 falhas da API e as 10 do frontend **existiam antes** e são específicas do Windows (permissões `chmod`, processo auxiliar do provedor de teste, separadores de caminho e finais de linha). Não foram "consertadas" porque são do openGym e do ambiente; rode a suíte em Linux/CI para ver o estado verdadeiro.

## Não verificado / depende de você
- **Asaas e provedor de IA nunca foram chamados de verdade** (sem credenciais): só mocks e um Asaas falso por HTTP. Ver "Itens a validar no Sandbox" em PAYMENTS_SETUP.md.
- **Imagens Docker não foram construídas** (Docker Desktop parado); são opcionais agora. O PostgreSQL dos testes foi um embutido.
- **Mídias de exercício:** a imagem web e o build do app **não** as incluem, mas a pasta `catalogue/media/` ainda está no repositório. **Remova-a antes de publicar o código** (LICENSES_AND_ATTRIBUTIONS.md §2).
- Texto dos exercícios de origem ExerciseDB (1.324) mantido sob MIT conforme o NOTICE do openGym; origem não verificada de forma independente.
- Termos e Privacidade são modelos; precisam de revisão jurídica.
- E-mail de recuperação de senha só funciona com `RESEND_API_KEY`/`MAIL_FROM`.
- Telas SaaS estão só em pt-BR (o restante usa os 19 idiomas do openGym); a acentuação do app segue a do openGym (lime).
- **Implantação na Vercel não foi feita nem validada de verdade**: o `vercel.json` (serviços `web` + `api`, cron) só foi exercitado localmente com `npm run dev:serverless`. Confira o primeiro deploy (DEPLOY.md).
- **Plano da Vercel:** roda no Hobby, com o cron nativo diário e um workflow do GitHub (`.github/workflows/cron-tick.yml`, a cada 5 min) para lembretes e revisões do Coach. Os termos da Vercel limitam o Hobby a uso não comercial; cobrar assinaturas é decisão sua (DEPLOY.md).
- **Limites do modo Vercel** (DEPLOY.md): fotos/vídeos desligados (limite de 4,5 MB por requisição; religar exige Vercel Blob), integrações e "comparar com outros" desligados, presença ao vivo parcial, descanso longo além do tempo máximo da função sem aviso, escala de alguns milhares de contas (cada requisição lê o `db.json`).
- Sem verificação de e-mail no cadastro, sem testes de navegador automatizados.

## Próximos passos
1. Preencher `.env` (seção CorpoFit AI) e homologar no Sandbox do Asaas.
2. `git rm -r catalogue/media`, publicar o repositório e preencher `SOURCE_CODE_URL`.
3. Criar o banco (Neon) e o projeto na Vercel, definir `APP_SECRET`, `CRON_SECRET` e demais variáveis, fazer o deploy, criar o admin e conferir o backup do banco (DEPLOY.md).
4. Revisão jurídica e teste real da IA com a chave de produção.
