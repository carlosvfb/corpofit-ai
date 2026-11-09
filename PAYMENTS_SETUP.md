# Pagamentos: Asaas

Gateway exclusivo da v1. Documentação oficial: <https://docs.asaas.com/>. Código: `api/saas/asaas/` (cliente, checkout, webhook, status, cancelamento, repositório) e `api/saas/routes.js`.

## Como funciona

| Modalidade | Fluxo implementado |
|---|---|
| **Cartão de crédito** | Checkout hospedado do Asaas (`POST /v3/checkouts`, `chargeTypes: RECURRENT`, `billingTypes: CREDIT_CARD`). Os dados do cartão **não passam pelo nosso servidor**. A pessoa volta para `/#/checkout/sucesso|cancelado|expirado`. |
| **Pix Automático** | `POST /v3/pix/automatic/authorizations` com `paymentCreationMode: SUBSCRIPTION` e `immediateQrCode` (1ª cobrança). O app mostra `payload`/`encodedImage`. Só aparece se o admin ligar em **Financeiro e IA**. Erros 400/403 viram "Pix Automático indisponível". |
| **Pix convencional** | `POST /v3/subscriptions` com `billingType: PIX`, busca a cobrança (`GET /v3/subscriptions/{id}/payments`) e o QR (`GET /v3/payments/{id}/pixQrCode`). **Cada ciclo exige pagar uma nova cobrança**: o app diz isso. Nos ciclos seguintes há o botão "Pagar com Pix" em Assinatura. |

Segurança: o corpo de `POST /api/billing/checkout` só aceita `method` e `cpfCnpj` (plano, preço e IDs externos são decididos no servidor, em `api/saas/plans.js`); o cliente Asaas é reaproveitado (`BillingCustomer`) e procurado por `externalReference` antes de criar; uma assinatura criada num *timeout* é adotada em vez de duplicada; pendências de outra forma de pagamento são abandonadas; CPF/CNPJ é validado (dígitos verificadores) e só os 4 últimos dígitos são guardados.

### Quando o Premium é liberado
**Somente** quando uma cobrança fica `CONFIRMED`/`RECEIVED`, e o estado é **reconfirmado na API do Asaas** (`GET /v3/payments/{id}`) antes de mexer no acesso. Criar assinatura/checkout, mostrar o QR Code, `CHECKOUT_PAID`, `PIX_AUTOMATIC_…_ACTIVATED` e a página de retorno **não** liberam Premium. Estados: `PENDING → ACTIVE` (pago) → `PAST_DUE` (vencida; tolerância configurável) → `CANCELED`/`SUSPENDED` (estorno/chargeback). Cancelamento mantém o Premium até o fim do período pago. O admin pode conceder/revogar Premium manualmente (auditado).

## Passo a passo

1. **Conta Asaas:** crie em <https://www.asaas.com/> (produção; exige cadastro/aprovação) e uma conta Sandbox para testes.
2. **Chave de API:** painel → Integrações → Chave de API (sandbox e produção têm chaves diferentes).
3. **`.env` (Sandbox):**
   ```env
   ASAAS_API_KEY=<chave sandbox>
   ASAAS_ENV=sandbox
   ASAAS_WEBHOOK_TOKEN=<32+ caracteres>      # openssl rand -hex 24
   ASAAS_WEBHOOK_URL=https://SEU-PROJETO.vercel.app/api/webhooks/asaas    # ou o seu domínio
   ```
4. **Webhook** (URL pública HTTPS; em desenvolvimento use um túnel, ex.: `cloudflared tunnel --url http://localhost:8080`). Crie por script (`cd api && npx tsx` não é necessário; use o utilitário Node abaixo) ou no painel (Integrações → Webhooks) com: URL do passo 3, **token de autenticação** = `ASAAS_WEBHOOK_TOKEN`, envio **sequencial** e os eventos `PAYMENT_*` (CREATED, UPDATED, CONFIRMED, RECEIVED, OVERDUE, REFUNDED, DELETED, RESTORED, CREDIT_CARD_CAPTURE_REFUSED, REPROVED_BY_RISK_ANALYSIS, CHARGEBACK_REQUESTED), `SUBSCRIPTION_*` (CREATED, UPDATED, INACTIVATED, DELETED), `CHECKOUT_*` (CREATED, PAID, CANCELED, EXPIRED) e `PIX_AUTOMATIC_RECURRING_AUTHORIZATION_*` (CREATED, ACTIVATED, CANCELLED, EXPIRED, REFUSED).
   Script: `cd api && node scripts/setup-asaas-webhook.mjs` (lê as variáveis do ambiente).
   O endpoint valida o header `asaas-access-token` (comparação em tempo constante), grava o evento em `PaymentEvent` (ID único), responde 200 e é **idempotente**. Falha temporária devolve 500 para o Asaas reentregar (**a fila é pausada após 15 falhas seguidas**: acompanhe em Financeiro e IA → Eventos do webhook).
5. **URLs de retorno:** `ASAAS_SUCCESS_URL`, `ASAAS_CANCEL_URL`, `ASAAS_EXPIRED_URL` (padrão `APP_URL/#/checkout/…`). Só redirecionam; **não** confirmam pagamento.
6. **Cartão (Sandbox):** use os cartões de teste do Asaas (<https://docs.asaas.com/docs/testando-pagamento-com-cartão-de-crédito>) na página hospedada. O webhook `PAYMENT_CONFIRMED`/`RECEIVED` ativa a assinatura.
7. **Pix convencional (Sandbox):** gere o QR no checkout e use, no painel Sandbox da cobrança, a opção de simular o pagamento para disparar `PAYMENT_RECEIVED`.
8. **Pix Automático:** exige conta **habilitada pelo Asaas** (consulte <https://docs.asaas.com/docs/pix-automatico>; o evento `PIX_AUTOMATIC_RECURRING_ELIGIBILITY_UPDATED` informa elegibilidade em subcontas). Só então ligue em Financeiro e IA → Configurações. A autorização só fica `ACTIVE` depois do pagamento inicial e da confirmação da instituição do pagador.
9. **Pagamentos confirmados:** Financeiro e IA (cobranças e eventos) ou a tabela `Payment` (`CONFIRMED`/`RECEIVED`).
10. **Cancelamento:** Assinatura → Cancelar. O servidor chama `DELETE /v3/subscriptions/{id}` (e `DELETE /v3/pix/automatic/authorizations/{id}`) e só marca `CANCELED` depois que o Asaas confirmar; falha de comunicação **não** cancela localmente.
11. **Reconciliação:** Financeiro e IA → Assinaturas → "Reconciliar" relê as cobranças no Asaas e reaplica as regras (mesmo caminho do webhook).

## Itens a validar no Sandbox (a documentação lida deixa dúvida)

- Checkout: envio de `customer` (cliente existente); o schema do `POST /v3/checkouts` lista `customerData`, o guia cita `customer`. Se for rejeitado, troque por `customerData` em `api/saas/asaas/checkout.js`.
- O checkout exige `items[].imageBase64`: enviamos um PNG 1×1 transparente (troque por um logotipo, se quiser).
- Vínculo da assinatura criada pelo checkout com o nosso registro: por `checkoutSession` (ao consultar a assinatura) ou, na falta, pelo cliente com assinatura pendente. Confirme que `checkoutSession` vem preenchido.
- Filtro `externalReference` em `GET /v3/customers` e `GET /v3/subscriptions` (evita duplicidade).
- Pix Automático: significado de `startDate`, política de retentativas (`retryPolicy`) e nomes de eventos aceitos ao criar o webhook por API.
- URL base de produção `https://api.asaas.com/v3` (não constava na página de referência lida; confirme em <https://docs.asaas.com/>; pode ser sobrescrita por `ASAAS_API_BASE_URL`).

## Homologação antes de aceitar pagamentos reais

- [ ] Sandbox: cartão aprovado, recusado e vencimento; webhooks chegando (log em Financeiro e IA).
- [ ] Sandbox: Pix pago, pendente e vencido; o 2º ciclo gera nova cobrança e "Pagar com Pix" funciona.
- [ ] Pix Automático habilitado e autorização testada (ou mantido desligado).
- [ ] Evento duplicado ignorado; token inválido → 401; queda do webhook e reconciliação.
- [ ] Cancelamento (cartão e Pix) e estorno refletidos no acesso.
- [ ] HTTPS válido; `ASAAS_WEBHOOK_URL` acessível publicamente.
- [ ] Termos/Privacidade revisados; razão social/CNPJ e política de reembolso definidos.
- [ ] Conta Asaas de produção aprovada e chave de produção gerada.
- [ ] Uma cobrança real de baixo valor, ponta a ponta, antes de divulgar.

## Sandbox → Produção

`ASAAS_ENV=production`, nova `ASAAS_API_KEY` e novo `ASAAS_WEBHOOK_TOKEN`; crie o webhook na conta de **produção**; confirme `APP_URL`/retornos com o domínio final; religue o Pix Automático só se a conta de produção estiver habilitada.

## Testes

`api/test/saas-checkout.test.js`, `saas-webhook.test.js`, `saas-client.test.js`, `saas-status.test.js` e `saas-e2e.test.js` (servidor real + PostgreSQL + um Asaas falso por HTTP) cobrem: cliente (criação/reuso), cartão, Pix, Pix Automático (e indisponibilidade), *timeout*/falha de rede, assinatura existente, evento duplicado, fora de ordem, pendente/confirmado/vencido/estornado, cancelamento, webhook inválido/sem token e isolamento entre usuários. São **mocks**: nunca houve chamada ao Sandbox real (sem credenciais); essa é a limitação.
