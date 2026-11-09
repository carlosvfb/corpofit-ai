# Segurança

A base de segurança é a do openGym (documentada em [docs/upstream/OPENGYM_SECURITY.md](docs/upstream/OPENGYM_SECURITY.md) e em `docs/SELF_HOSTING.md`): senhas com **scrypt**, sessões assinadas (HMAC) revalidadas a cada requisição com *versão de sessão* (sair de todos os aparelhos), cookie `HttpOnly`/`SameSite`/`Secure`, **proteção CSRF** por `Sec-Fetch-Site`/`Origin`, limitação de tentativas (por endereço e por conta, com espera crescente), `readBody` com teto, validação das gravações de estado, proteção SSRF nos *push endpoints*, trilha de auditoria e ~800 testes. O CorpoFit AI acrescenta:

## Autenticação e contas
- Cadastro SaaS exige **e-mail e aceite dos termos**; senha mínima de 10 caracteres com lista de senhas comuns (do openGym).
- **Recuperação por e-mail** (`POST /api/login/password-forgot`): código de 1 hora, guardado só como hash, uso único, **sem enumeração** (mesma resposta com e-mail existente ou não) e **sem bloquear a conta** de quem foi alvo do pedido (a senha atual segue valendo até o código ser usado). Limites: 5 por hora por endereço e 3 por e-mail.
- Resgatar o código encerra todas as sessões antigas (comportamento do openGym).

## Autorização
- Toda rota do SaaS valida o usuário **no servidor** com a mesma sessão do openGym; consultas filtram sempre por `userId`. `/api/admin/saas/*` exige admin (401/403). O frontend não decide plano, preço nem acesso.
- Plano, preço e limites vêm de `api/saas/plans.js` + `computeEntitlements`. O corpo do checkout só aceita `method` e `cpfCnpj`.
- Testes cobrem: rotas sem sessão, usuário comum no admin, isolamento de cobranças e do QR Pix entre usuários.

## Pagamentos
- Chaves só no backend; nunca em logs, respostas, frontend nem banco. Erros do Asaas não carregam a chave. **Sem dados de cartão no sistema** (checkout hospedado).
- **Webhook** (`POST /api/webhooks/asaas`): isento de CSRF (é chamado por servidor) mas autenticado por token em **tempo constante**; valida a estrutura; grava o evento com ID **único** (idempotência); para eventos que mudam acesso, **reconfirma o estado na API do Asaas** antes de agir (protege contra eventos fora de ordem ou forjados); erro temporário → 500 para reentrega; falhas vão ao `ErrorLog` sem *payload*.
- Premium só com cobrança `CONFIRMED`/`RECEIVED`; cancelamento só após confirmação do provedor; histórico financeiro nunca é apagado.
- Ações administrativas (conceder/revogar Premium, configurações, reconciliação) gravam `AdminAuditLog`; não existe rota que altere cobrança "na mão".
- Limites de tentativa em checkout (6/10 min), cancelamento e QR Pix (por usuário).

## IA
- Chave só no backend, criptografada em `coach.json` (chave derivada do segredo da sessão); nunca no banco de usuários.
- Limites por plano no servidor, **antes** do custo; consentimento expresso do Coach reaplicado no servidor; contexto só do usuário; saída validada antes de ser aplicada; regras de segurança de saúde no prompt de sistema.

## Cabeçalhos e rede
- O nginx do openGym envia CSP restritiva e demais cabeçalhos (`web/Dockerfile`). O *hash* do script em linha do `index.html` precisa continuar igual ao da CSP (há teste); **não** edite o `<script>` em linha de `frontend/index.html` sem atualizar o hash.
- HTTPS pela Vercel; o banco só aceita conexões autenticadas (Neon). Atrás de outro proxy, `TRUST_PROXY=1` só se ele reescreve `X-Forwarded-For` (a Vercel reescreve).
- `GET /api/cron/tick` exige `CRON_SECRET`; sem a variável, a rota fica fechada.

## Pontos conhecidos
- Sem verificação de e-mail no cadastro (o e-mail é confirmado só na prática, pelo recebimento do código de recuperação) e sem 2FA além das passkeys opcionais do openGym.
- Na Vercel, limites de tentativa, desafios de passkey e pareamentos ficam no PostgreSQL (`ephemeral.json`), compartilhados entre instâncias. Cada gravação usa controle otimista de revisão: ao disputar a mesma linha, a requisição perdedora é refeita. Em disco (hospedagem própria) continuam em memória, como no openGym.
- Cada requisição na Vercel carrega o `db.json` (contas) do banco: a escala é limitada (ver DEPLOY.md).
- Nenhum teste contra o Asaas ou provedor de IA reais (sem credenciais): só mocks. Revise antes de produção.
- Revise `npm audit` periodicamente em `api/` e `frontend/`.

Relate vulnerabilidades ao responsável pelo projeto (`SUPPORT_EMAIL`). Não abra *issues* públicas com detalhes exploráveis.
