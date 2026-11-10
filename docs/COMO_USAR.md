# Como usar a CorpoFit AI: cada funcionalidade e onde encontrá-la

Site: https://corpofitai.vercel.app (no celular, abra no navegador e use "Adicionar à tela inicial" para instalar).
As áreas novas ficam em **Ajustes** (engrenagem no canto da tela inicial). Tudo abaixo exige estar logado.

## 0. Quatro portais, um para cada função
Uma mesma conta pode ter várias funções (aluno, personal, gestor de academia, admin), mas **cada função tem a sua entrada, o seu login e a sua tela**:

| Portal | Para quem | Aparelho | Endereço (entrada) | Depois do login |
|---|---|---|---|---|
| **Aluno** | quem treina | celular | `https://corpofitai.vercel.app/#/entrar` | app de treino (`/#/home`) |
| **Personal** | personal trainers | celular (barra de abas própria: Alunos, Treinos, Biblioteca, Perfil) | `/#/personal/entrar` | `/#/personal` |
| **Academia** | dono, administrador e gerente | computador (menu lateral, tabelas) | `/#/academia/entrar` | `/#/academia` |
| **Administração** | equipe da plataforma | computador | `/#/plataforma/entrar` | `/#/plataforma` |

- No site público, o cabeçalho tem **Para academias** e **Para personais**, e o rodapé tem **Administração**.
- Só a administração não tem cadastro: o acesso de admin é dado pelo dono do produto.
- Quem entra num portal sem ter a função vê uma explicação e o caminho certo (por exemplo, a administração responde "Acesso restrito").
- Dentro de qualquer portal há o atalho "Meu treino (app do aluno)" para voltar ao seu app.

## 1. Primeiros passos
| O quê | Como |
|---|---|
| Criar conta | Site público → **Criar conta grátis**. Nome, e-mail, senha (10+ caracteres) e aceite dos Termos. |
| Entrar | **Entrar** com o nome (ou e-mail) e a senha. |
| Esqueci a senha | Tela de entrada → "Esqueci minha senha". O código vai por e-mail e só funciona com o envio de e-mail configurado (Resend). |
| Confirmar o e-mail | **Ajustes → Notificações e e-mail** → *Enviar código* → digitar os 6 números. Libera convites feitos ao seu e-mail antes de você ter conta. |
| Virar admin da plataforma | A primeira conta só vira admin se `FIRST_USER_ADMIN=1` estiver ligado no momento do cadastro; senão, use `ADMIN_UIDS` (veja DEPLOY.md). |

### Entrar com o Google e foto de perfil
- **Continuar com o Google** aparece nas telas de entrada e cadastro quando o servidor tem `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`. A conta é criada (ou encontrada pelo e-mail) e a **foto do Google vira a foto de perfil**. Só vale e-mail verificado pelo Google.
- Se já existia uma conta com o mesmo e-mail, ela passa a entrar pelo Google; a senha antiga é removida e as sessões antigas encerradas (proteção contra quem cadastrou o e-mail de outra pessoa antes).
- **Foto de perfil para quem entrou de outro jeito:** Ajustes → **Foto de perfil** (ou Perfil no portal do personal, ou o seu nome no menu lateral dos portais de computador). A foto é reduzida no aparelho (256 px) e guardada no servidor; dá para trocar ou remover.
- **E-mails (Resend):** código de confirmação, redefinição de senha e convites saem pelo Resend quando `RESEND_API_KEY` e `MAIL_FROM` estão definidos. O `MAIL_FROM` precisa ser de um domínio verificado no Resend. `/api/health` mostra `mail: true` quando está configurado. Se o Resend recusar o envio, o motivo aparece nos logs da Vercel (`[mail] Resend recusou…`).

## 2. Treino (base do app)
- **Início**: o treino do dia, calendário da semana, começar um treino.
- **Plano**: suas rotinas e dias; **Plano inicial** traz os planos prontos (PPL, Superior/Inferior, Full Body, 5×5, ABC, ABCD, Em casa, Glúteos e pernas).
- **Começar**: treino guiado, com séries, cargas, descanso e recordes.
- **Estatísticas, Exercícios**: histórico, gráficos, mapa muscular, catálogo (busca e filtros).
- Em cada exercício, **Ver no YouTube** abre a busca em português.

## 3. IA (CorpoFit AI)
- **Onde:** botão **Conversar com a CorpoFit AI** no cartão "Seu plano" da tela inicial (ou Plano → *Coach*).
- Na primeira vez pede seu consentimento sobre o que a IA pode ler. Limite de mensagens por mês conforme o plano.
- **Usar a orientação de uma academia:** dentro da academia, marque "Usar a orientação desta academia na minha IA".

## 4. Assinatura pessoal
- **Início → Assinar Premium** (ou Ajustes → Assinatura e plano): cartão, Pix ou Pix Automático.
- O Premium só vale depois da confirmação do pagamento (webhook do Asaas). Cancelar mantém o plano até o fim do período pago.

## 5. Portal da academia (computador): `/#/academia`
| O quê | Como |
|---|---|
| Criar uma academia | Em **Minhas academias** → *Cadastrar uma academia*. Você vira dono. |
| Convidar alguém | Menu **Membros** (tabela com busca, papéis e situação) → e-mail e papel. Quem ainda não tem conta fica como *aguardando cadastro* e só recebe o convite depois de se cadastrar e **confirmar o e-mail**. |
| Aceitar convite | Quem gerencia: em **Minhas academias** → *Convites*. Aluno ou personal: Ajustes → Minhas academias (no app do celular). |
| Papéis | Dono, administrador, gerente, personal, aluno. Cada um só gerencia quem está abaixo. |
| Marca e IA da academia | Menu **Configurações**: nome, cor, logo (https), contato, instruções para a IA e limite mensal. |
| Painel e histórico | Menus **Visão geral** (contagens reais) e **Atividade** (quem fez o quê). |
| Uso da IA | Menu **Uso da IA** (dono e admin): mensagens, tokens, custo estimado e contagem por membro. |
| Plano da academia | Menu **Plano e cobrança** (dono, admin e gerente veem; só o dono contrata): limites e uso, planos, contratar e cancelar. |

## 6. Portal do personal (celular): `/#/personal`
- **Virar personal:** entre em `/#/personal/entrar` (ou crie conta em `/#/personal/cadastro`) e preencha o perfil profissional.
- **Abas (barra de baixo):** Alunos, Agenda, Exercícios (catálogo completo, com busca por nome em português), Biblioteca e Perfil (inclui "Treinos enviados").
- **Alunos:** cada aluno aparece com o último treino, quantos treinos fez nas últimas 4 semanas, o próximo treino marcado e **sinais de atenção** (sem treinar há 7+ dias, faltou 2+ vezes, presença a registrar). Quem precisa de você aparece primeiro. A frequência só aparece se o aluno compartilhou.
- **Ficha do aluno** (toque no nome): abas **Treinos**, **Agenda**, **Progresso**, **Notas** e **Acesso**.
  - **Treinos → Montar novo treino:** busque exercícios pelo nome, defina séries, repetições (ou segundos, ou minutos no cardio), carga e descanso, reordene e envie. Cada aluno recebe o treino que você montou para ele; **Editar treino** cria uma nova versão (a anterior fica no histórico) e avisa o aluno.
  - **Agenda → Marcar treino:** dia e horário exatos, duração, local, treino previsto e recado; dá para repetir toda semana (até 12 semanas). O sistema não deixa marcar dois alunos no mesmo horário. O aluno recebe um aviso e **confirma ou recusa**; remarcar volta a pedir confirmação. Depois do horário você registra **Treino feito** ou **Faltou**. Cancelar avisa a outra pessoa e, em séries, pergunta se cancela os próximos.
  - **Progresso:** treinos feitos, séries e cargas, peso, medidas, observações, só o que o aluno liberou. Cada leitura fica registrada para o aluno.
  - **Notas:** anotações privadas (lesões, metas, combinados). O aluno nunca as vê.
  - **Acesso:** o que o aluno compartilha com você e o botão de encerrar o vínculo (a agenda futura entre vocês é cancelada).
- **Agenda geral:** a aba **Agenda** é um calendário do mês. Cada dia mostra pontos coloridos (amarelo aguardando, verde confirmado, cinza feito, vermelho faltou); **toque no dia** para ver todos os compromissos dele, com as ações de cada um, e use **Marcar neste dia**.
- **Montar treino igual à área do aluno:** o botão *Adicionar exercício* abre o mesmo seletor de exercícios do app (catálogo completo, busca, filtros, seus exercícios) e a mesma tela de configuração (séries, repetições, carga, descanso, progressão, superséries). Também dá para enviar uma rotina do seu próprio Plano.
- **Aluno novo:** *Convidar aluno* por e-mail (a pessoa precisa já ter conta). O aluno também pode pedir um personal pelo e-mail dele.
- **Enviar treino:** em um aluno ativo → *Enviar treino* → escolha uma das **suas** rotinas. O aluno vê o treino em **Ajustes → Meu personal** (app do aluno) e toca em *Adicionar às minhas rotinas*. Cada edição guarda a versão anterior.
- **Sugestão para uma rotina do aluno:** só aparece se o aluno liberou "Ver e sugerir" nas rotinas.
- **Comentários:** nos treinos enviados, dos dois lados.
- **Ver dados do aluno:** só as categorias que o aluno liberou (botões "O aluno compartilha com você").

## 7. Privacidade (Ajustes → Privacidade e compartilhamento)
- **Atalho ao aceitar um personal:** o app pergunta se ele pode acompanhar seu treino. "Acompanhar meu treino" libera treinos feitos, histórico de cargas, frequência e deixa ele sugerir mudanças nas rotinas; "Treino, medidas e peso" libera também o corpo e as observações; "Não compartilhar" não libera nada. Você ajusta depois, categoria por categoria, e revoga quando quiser.
- **Enviar ao personal, em qualquer tela:** com um personal vinculado, as telas **Plano**, **Estatísticas** e **Medidas** mostram um aviso com o botão *Enviar ao personal*. Um toque libera (a mesma permissão de Privacidade) as rotinas, os treinos e estatísticas, ou o peso e as medidas, e o personal passa a ver sempre o dado atualizado. *Parar de enviar* revoga na hora. Os treinos marcados entre vocês já aparecem para os dois.
- **Treinos marcados:** em Ajustes → Meu personal, a seção "Treinos marcados com seu personal" mostra dia e horário e tem **Confirmar** e **Não posso**.
- Para cada personal vinculado, escolha por categoria: *Não compartilhar* (padrão), *Ver* ou, nas rotinas, *Ver e sugerir*.
- **Revogar tudo** de um personal, **histórico de consentimento** e **Quem leu seus dados**.
- Fotos de evolução e bem-estar ainda não podem ser compartilhadas.

## 8. Biblioteca (Ajustes → Biblioteca)
- **Explorar**: busca, filtro por tipo, biblioteca pública ou de uma academia. **Favoritos**, **Meus**.
- **Publicar**: rotina (sem pesos, mídia nem links), dica ou artigo, para todos ou só uma academia (personal ou acima). Exige declarar que o conteúdo é seu.
- **Adicionar às minhas rotinas**: importa como rotina nova, sem sobrescrever nada.
- **Denunciar**: 3 pessoas diferentes escondem o item até um moderador decidir.
- **Moderação** (dono e admin de academia): fila de denúncias do conteúdo da academia.

## 9. Notificações (Ajustes → Notificações e e-mail)
Convites, vínculos, treinos e sugestões recebidos, comentários e mudanças de compartilhamento. Um aviso aparece no cartão da tela inicial quando há novidades.

## 10. Administração da plataforma (computador): `/#/plataforma`
- Menus: **Academias** (plano e contagens), **Moderação** (denúncias de toda a biblioteca), **Financeiro e IA** (assinaturas, cobranças, webhooks, Premium manual, consumo) e **Configurações da instância** (o painel de administração original).

## 11. Dados e privacidade (LGPD)
- `GET /api/privacy/export` (logado): tudo o que a plataforma guarda sobre você nestas áreas, em JSON.
- Excluir a conta apaga esses dados e cancela assinaturas de academia que você pagava.

## 12. Para o dono do produto (configuração)
Variáveis na Vercel: `APP_SECRET`, `CRON_SECRET`, `DATABASE_URL`, `ASAAS_*`, `AI_*` (veja ENVIRONMENT.md), além de `GYM_PLANS` (preços e limites das academias), `AI_PRICES` (custo da IA), `TENANT_AI_MONTHLY_CAP`, `REQUIRE_VERIFIED_EMAIL=1` (opcional), `RESEND_API_KEY` e `MAIL_FROM` (e-mail). Relatório técnico completo e pendências: [PLATFORM_AUDIT.md](PLATFORM_AUDIT.md).
