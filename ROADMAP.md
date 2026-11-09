# Roadmap do CorpoFit AI

O roadmap do openGym está em [docs/upstream/OPENGYM_ROADMAP.md](docs/upstream/OPENGYM_ROADMAP.md).

## Antes de aceitar usuários pagantes
- Homologar no Sandbox do Asaas e fechar os "itens a validar" ([PAYMENTS_SETUP.md](PAYMENTS_SETUP.md)).
- Remover `catalogue/media/` do repositório público e publicar o código-fonte em `SOURCE_CODE_URL` ([LICENSES_AND_ATTRIBUTIONS.md](LICENSES_AND_ATTRIBUTIONS.md)).
- Revisão jurídica dos Termos e da Política de Privacidade; razão social, CNPJ, política de reembolso e DPO.
- Construir e testar as imagens Docker; backup e restauração do PostgreSQL **e** de `DATA_DIR`.
- Testar a CorpoFit AI com a chave de produção e ajustar limites/preço.
- E-mail transacional configurado (Resend) e teste do fluxo de recuperação de senha.

## Curto prazo
- Verificação de e-mail no cadastro; 2FA.
- Lembretes por e-mail para Pix mensal e cobranças vencidas (hoje o app mostra o status e o botão "Pagar com Pix").
- Preço e limites editáveis pelo admin (hoje em `api/saas/plans.js`).
- Paginação e filtros nas listas do financeiro; exportação de relatórios.
- Testes de navegador (Playwright) dos fluxos de cadastro, checkout e cancelamento.
- Tradução das telas SaaS pelo mecanismo de idiomas do openGym (hoje estão só em pt-BR).

## Médio prazo
- Normalizar o `db.json` (contas) em linhas por usuário no PostgreSQL: cada requisição deixaria de ler todas as contas e a escala subiria de alguns milhares para centenas de milhares.
- Fotos e vídeos (de exercício próprio e de progresso) pelo **Vercel Blob** com envio direto do navegador (o limite de 4,5 MB por requisição da função impede o fluxo atual).
- Cronômetro de descanso sem função esperando: Vercel Queues com entrega agendada.
- Integrações (webhooks assinados) e "comparar com outros" sobre fila/consulta no banco.
- Plano anual, cupons, troca de forma de pagamento com assinatura ativa.
- Mídia própria de exercícios, com licença clara.
- Streaming das respostas da IA e resumos de conversa para reduzir tokens.
