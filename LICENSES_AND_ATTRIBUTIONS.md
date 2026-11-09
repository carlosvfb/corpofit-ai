# Licenças e atribuições

Este documento não é aconselhamento jurídico. As regras do openGym que valem aqui estão em [LICENSE](LICENSE) (texto integral da AGPL-3.0) e [NOTICE.md](NOTICE.md) (avisos de terceiros), **ambos preservados sem alteração de conteúdo**. O NOTICE ganhou apenas uma seção final ("Modificações do CorpoFit AI").

## 1. O CorpoFit AI é um trabalho derivado do openGym (AGPL-3.0-or-later)

O openGym é © 2026 Duarte Santos, licenciado sob a **GNU Affero General Public License v3.0 ou posterior**. O CorpoFit AI modifica e estende o openGym (principalmente `api/saas/`, `frontend/src/saas/`, `api/prisma/`, pequenas alterações em `api/server.js`, `api/coach/`, `frontend/src/App.jsx` e outras telas, `web/Dockerfile`, a documentação e os testes) e, **por isso, é distribuído e oferecido sob a mesma licença**. Não se afirma, em lugar nenhum, que o produto tenha licença proprietária incompatível.

### Obrigações práticas

1. **Código-fonte aos usuários da rede (AGPL §13).** O CorpoFit AI é um serviço em rede modificado; quem usa tem direito ao **código-fonte correspondente da versão que está no ar**. O app traz a página pública **`/#/licenca`** (e o rodapé do site), que mostra o link configurado em **`SOURCE_CODE_URL`**. Obrigações do operador:
   - preencher `SOURCE_CODE_URL` com um repositório **público** que contenha exatamente o que está publicado (use *tags* por versão e atualize a cada deploy);
   - nesse repositório, **não** publicar segredos (`.env`, chaves, dados de usuários).
2. **Avisos de modificação e de copyright (AGPL §5 e §7).** Nenhum aviso de copyright, licença ou atribuição foi removido. Os arquivos novos do CorpoFit AI indicam a origem; o `NOTICE.md` registra a data e a natureza das modificações (2026-11-08, camada SaaS). Mantenha-os.
3. **Mesma licença nas obras derivadas (§5c).** Qualquer fork do CorpoFit AI também é AGPL-3.0-or-later.
4. **Sem restrições adicionais (§10).** Termos de uso do serviço não podem retirar os direitos que a AGPL concede sobre o código.
5. **Termos de uso do serviço ≠ licença do código.** Os Termos e a Política de Privacidade do site regulam o *serviço*; o código segue AGPL.
6. **Exceção de loja de aplicativos (NOTICE.md).** Vale só para a distribuição do app móvel do openGym em lojas. O CorpoFit AI **não distribui app móvel** nesta versão (as pastas `frontend/android`, `frontend/ios`, `watch-zepp` etc. continuam no repositório, sem uso nem build).
7. **Contribuições ao openGym original** exigem o `CLA.md` do projeto de origem; isso não se aplica ao CorpoFit AI, mas vale se você quiser enviar correções ao upstream.

## 2. Mídias de exercício (Gym visual): NÃO usadas

O `NOTICE.md` do openGym declara que as imagens e animações em `catalogue/media/` pertencem à **Gym visual** (gymvisual.com), **não são AGPL**, só podem ser usadas **dentro do aplicativo openGym**, que **um fork comercial precisa de licença própria** e que elas **não podem alimentar sistemas de IA**. O CorpoFit AI é comercial, então:

- O deploy na Vercel **não envia** `catalogue/media/` (`.vercelignore`), a imagem Docker web também não a copia (`web/Dockerfile`), e o frontend é construído com `VITE_NO_MEDIA=1` (padrão da imagem e do `docker-compose.corpofitai.yml`): o catálogo **não carrega referência a imagem/animação**, e nenhuma tela as pede. O app funciona só com texto e ícones vetoriais.
- Nenhuma mídia é enviada à IA (o Coach recebe só texto).
- ⚠️ **Ação sua antes de publicar o código:** o repositório ainda contém a pasta `catalogue/media/` (herdada do openGym, versões de 180 px). Distribuí-la num fork **comercial** exige licença da Gym visual. **Remova-a do repositório público do CorpoFit AI** (`git rm -r catalogue/media`), sabendo que isso afeta verificações do openGym que a esperam (`scripts/catalogue/check-media.mjs`, `build.mjs --check`); não fiz essa exclusão automaticamente por ser destrutiva e porque ela mexe em ferramentas de verificação que você pode querer ajustar junto. Se obtiver licença própria da Gym visual, construa o web com `--build-arg NO_MEDIA=0` e forneça as mídias licenciadas.

## 3. Texto do catálogo de exercícios

Segundo o `NOTICE.md` e `catalogue/README.md` do openGym, o catálogo é composto por (contagem verificada em `catalogue/exercises/*.json`, 6.554 arquivos):

| Origem (`textSource`) | Qtde | Licença / observação |
|---|---|---|
| `opengym` | 4.308 | Escrito para o openGym; AGPL-3.0 |
| *(sem campo)* | 922 | Entradas do openGym sem o campo; tratadas como próprias do openGym (AGPL-3.0). **Confirmar com o autor** se algum caso for duvidoso |
| `exercisedb` | 1.324 | Nomes, músculos e instruções originados do **ExerciseDB v1** (AscendAPI), via `hasaneyldrm/exercises-dataset`, sob **MIT** (texto da licença em `NOTICE.md`; © 2026 Hasan Emir Yıldırım). **Mantidos com atribuição**; a origem do dado original do ExerciseDB foi registrada pelo openGym, mas **não foi verificada de forma independente aqui**. Se o seu jurídico exigir mais rigor, exclua essas entradas |
| Traduções `i18n/*` (inclusive pt-BR) | — | Traduções originais do openGym produzidas com assistência de modelos de linguagem (ver NOTICE.md); AGPL-3.0 |

Os arquivos gerados (`frontend/src/lib/exercises-data.js` etc.) saem de `catalogue/` por `scripts/catalogue/build.mjs`; não os edite à mão.

## 4. Outros componentes do openGym mantidos (com seus avisos)

Detalhes e textos de licença completos em **NOTICE.md**:

- Geometria do mapa corporal (`frontend/src/lib/body-paths.js`): derivada de **MuscleMap** (Melih Colpan), MIT.
- QR de cartões de academia: **lean-qr** (MIT) e **jsQR** (Apache-2.0); `@capacitor-mlkit/barcode-scanning` (Apache-2.0, só no app nativo, não usado aqui).
- Dependências de runtime e build do openGym (React, react-router-dom, Zustand, Vite, Vitest, `@simplewebauthn/server`, `web-push`, `undici`, etc.): ver `frontend/package.json` e `api/package.json` (licenças permissivas: MIT/Apache-2.0/BSD/ISC).

## 5. Acréscimos do CorpoFit AI

| Componente | Licença |
|---|---|
| Prisma e `@prisma/client` (api) | Apache-2.0 |
| `embedded-postgres` (somente desenvolvimento) | MIT (binários do PostgreSQL: PostgreSQL License) |
| Código novo do CorpoFit AI (`api/saas/`, `frontend/src/saas/`, `api/prisma/`, testes, documentação, Compose/Docker) | AGPL-3.0-or-later |
| Imagens base: `postgres:16-alpine`, `caddy:2-alpine`, `nginx`, `node` | licenças próprias de cada imagem |

Verifique as licenças exatas das dependências instaladas antes de publicar (`npx license-checker --summary` em `api/` e `frontend/`).

## 6. Serviços externos

**Asaas** (pagamentos), o **provedor de IA** escolhido em `AI_PROVIDER` (Anthropic por padrão) e **Resend** (e-mail, opcional) são serviços de terceiros sob os termos deles. Você é responsável pelo contrato com cada um e por informar isso na Política de Privacidade.

## 7. Resumo do que foi mantido, removido e criado

- **Mantido do openGym:** quase tudo (planos, treino guiado, progressão, histórico, estatísticas, mapa muscular, Coach de IA, admin, sync, importações, 19 idiomas, catálogo em texto, PWA).
- **Desativado/removido do produto:** mídias de exercício (build e imagem); apps móveis e relógios (sem build); a tela de login do openGym é trocada, em modo SaaS, pelo site público e pelo cadastro por e-mail.
- **Criado:** a camada SaaS (planos, assinatura, Asaas, webhooks, financeiro, limites e consumo da IA, recuperação de senha por e-mail, páginas legais e de licença).
