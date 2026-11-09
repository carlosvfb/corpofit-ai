# Como usar a CorpoFit AI: cada funcionalidade e onde encontrá-la

Site: https://corpofitai.vercel.app (no celular, abra no navegador e use "Adicionar à tela inicial" para instalar).
As áreas novas ficam em **Ajustes** (engrenagem no canto da tela inicial). Tudo abaixo exige estar logado.

## 1. Primeiros passos
| O quê | Como |
|---|---|
| Criar conta | Site público → **Criar conta grátis**. Nome, e-mail, senha (10+ caracteres) e aceite dos Termos. |
| Entrar | **Entrar** com o nome (ou e-mail) e a senha. |
| Esqueci a senha | Tela de entrada → "Esqueci minha senha". O código vai por e-mail e só funciona com o envio de e-mail configurado (Resend). |
| Confirmar o e-mail | **Ajustes → Notificações e e-mail** → *Enviar código* → digitar os 6 números. Libera convites feitos ao seu e-mail antes de você ter conta. |
| Virar admin da plataforma | A primeira conta só vira admin se `FIRST_USER_ADMIN=1` estiver ligado no momento do cadastro; senão, use `ADMIN_UIDS` (veja DEPLOY.md). |

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

## 5. Academias (Ajustes → Academias)
| O quê | Como |
|---|---|
| Criar uma academia | Campo **Criar uma academia**. Você vira dono. |
| Convidar alguém | Academia → aba **Membros** → e-mail e papel. Quem ainda não tem conta fica como *aguardando cadastro* e só recebe o convite depois de se cadastrar e **confirmar o e-mail**. |
| Aceitar convite | Ajustes → Academias → **Convites** → *Aceitar convite*. |
| Papéis | Dono, administrador, gerente, personal, aluno. Cada um só gerencia quem está abaixo. |
| Marca e IA da academia | Aba **Configurações**: nome, cor, logo (https), contato, instruções para a IA e limite mensal. |
| Painel e histórico | Abas **Visão geral** (contagens reais) e **Atividade** (quem fez o quê). |
| Uso da IA | Aba **Uso da IA** (dono e admin): mensagens, tokens, custo estimado e contagem por membro. |
| Plano da academia | Aba **Plano** (dono, admin e gerente veem; só o dono contrata): limites e uso, planos, contratar e cancelar. |

## 6. Personal trainer (Ajustes → Personal trainer)
- **Virar personal:** preencha o perfil profissional.
- **Aluno novo:** *Convidar aluno* por e-mail (a pessoa precisa já ter conta). O aluno também pode pedir um personal pelo e-mail dele.
- **Enviar treino:** em um aluno ativo → *Enviar treino* → escolha uma das **suas** rotinas. O aluno vê o treino na mesma tela e toca em *Adicionar às minhas rotinas*. Cada edição guarda a versão anterior.
- **Sugestão para uma rotina do aluno:** só aparece se o aluno liberou "Ver e sugerir" nas rotinas.
- **Comentários:** nos treinos enviados, dos dois lados.
- **Ver dados do aluno:** só as categorias que o aluno liberou (botões "O aluno compartilha com você").

## 7. Privacidade (Ajustes → Privacidade e compartilhamento)
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

## 10. Administração da plataforma (só admin)
- **Ajustes → Painel de administração** (em inglês, "Admin dashboard"): **Financeiro e IA** (assinaturas, cobranças, webhooks, Premium manual, consumo) e **Academias e moderação** (academias com plano e contagens, e fila de denúncias de toda a biblioteca).

## 11. Dados e privacidade (LGPD)
- `GET /api/privacy/export` (logado): tudo o que a plataforma guarda sobre você nestas áreas, em JSON.
- Excluir a conta apaga esses dados e cancela assinaturas de academia que você pagava.

## 12. Para o dono do produto (configuração)
Variáveis na Vercel: `APP_SECRET`, `CRON_SECRET`, `DATABASE_URL`, `ASAAS_*`, `AI_*` (veja ENVIRONMENT.md), além de `GYM_PLANS` (preços e limites das academias), `AI_PRICES` (custo da IA), `TENANT_AI_MONTHLY_CAP`, `REQUIRE_VERIFIED_EMAIL=1` (opcional), `RESEND_API_KEY` e `MAIL_FROM` (e-mail). Relatório técnico completo e pendências: [PLATFORM_AUDIT.md](PLATFORM_AUDIT.md).
