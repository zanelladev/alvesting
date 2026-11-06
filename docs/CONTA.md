# Conta, login e LGPD (etapa 11, partes 1 e 2: a api e as telas)

Plano: §3, §5.6, §5.7, §8, §9 e §12. A **parte 1** entregou a conta **na api**: login, sessão, termos com aceite versionado, exportar e excluir, papéis
e o comando que promove um admin (seções 1 a 8). A **parte 2** entregou as **telas** (`/entrar`, `/cadastro`, `/verificar-email`, `/esqueci-senha`, `/redefinir-senha`,
`/conta`, `/termos` e `/privacidade`) e usa o que está aqui: a seção 9 diz como elas falam com a api, a 10 como se testam e a 11 o que não foi verificado. A **carteira** (etapa 12, parte 1: a api)
já está dentro, com a **versão 0.2** dos textos e o novo aceite (seção 5, "A carteira e a LGPD"; `docs/API.md`, seção 9); em 04/11/2026 a **política subiu para a 0.3** (a limpeza diária e o pior caso de cada prazo, seção 5), e os termos seguiram na 0.2; o chat (etapa 13) entra depois, com versão nova dos textos e novo aceite.

> **Os textos de termos e de privacidade são RASCUNHO** para o Artur e o orientador revisarem. Nenhum advogado os leu. Escritos só com o que existe hoje,
> estão em `apps/api/src/modules/account/legal/` (termos na **0.2**, a da carteira, e política na **0.3**, a da limpeza diária; a 0.1 foi a da conta) e levam o aviso de rascunho no topo. Ver o item 8 antes de abrir ao público.

## 1. Como está montado

- **Better Auth 1.7.15** montado direto no Express em `/api/auth/*` (`configure-app.ts`, antes dos body parsers do Nest; depois da trava de origem). Sem
  plugin e sem o adaptador da comunidade (ADR 0024). As respostas dele **não** usam o envelope `{ success, data, error }`: são o formato do Better Auth.
  Todas saem com `Cache-Control: no-store`, e a requisição vira uma linha de log (a mesma lista branca do log de requisição: método, caminho sem query, user-agent e `res.statusCode`), então o 5xx do login, do cadastro e da redefinição conta no sinal `api-5xx` (`docs/INFRA.md`, 5.3; `auth-route.spec.ts`).
  **O corpo tem teto de 16 KB** (413 `PAYLOAD_TOO_LARGE` no envelope; o corpo sem tamanho declarado, `Transfer-Encoding: chunked`, também é recusado): o handler do Better Auth lê o corpo inteiro para a
  memória e o limite de 100 KB do Nest não vale aqui. **Só as rotas que o site usa estão abertas** (cadastro, login por e-mail e Google, sessão, saída, verificação, reenvio da verificação e redefinição
  de senha); o resto do Better Auth (`update-user`, `verify-password`, `link-social`, listar e revogar sessões, trocar e-mail e senha, tokens do Google...) responde **404** até uma tela precisar de alguma (as da parte 2 não precisaram de nenhuma),
  com limite próprio (`CLOSED_PATHS`, `auth.ts`). Um teste lista as rotas que o pacote tem nesta versão e reprova a que não está na lista do site nem fechada: rota nova de uma atualização nasce fechada.
- **Rotas da conta** em `/api/v1`, no envelope, validadas pelo Zod, no Swagger (tag `conta`) e com `Cache-Control: no-store`: `GET /me`, `POST /me/consents`,
  `GET /me/export`, `DELETE /me` e, públicas, o `GET /legal` e o `GET /auth/providers` (parte 2: só diz se o Google está configurado, `{ google: boolean }`, para a tela de entrar oferecer o botão; nunca o client ID).
- **Módulo** `apps/api/src/modules/account` (`domain`, `application`, `infrastructure`, `presentation`). Só o papel HTTP o carrega.
- **Contratos** (`packages/contracts/src/account.ts`): `meSchema`, `consentProofSchema`, `legalSchema`, `userExportSchema`, `authProvidersSchema` e `ACCOUNT_LIMITS` (os tetos do cadastro e a validade dos links dos e-mails, 60 e 30 minutos: a api e as telas usam o mesmo número). Estritos de propósito.

## 2. Fluxos

| Fluxo | Como é |
|---|---|
| Cadastro por e-mail | `POST /api/auth/sign-up/email` com `name`, `email`, `password` (10 a 128 caracteres) e **`consent`**: as duas versões vigentes (`{ terms, privacy }`). Sem o aceite, ou com versão que não é a vigente, é 400 `CONSENT_REQUIRED` e nada nasce. Nada vem pré-marcado. Cada documento é conferido sozinho. O aceite e o perfil são conferidos **antes** de olhar o e-mail, então a recusa é a mesma para quem já tem conta. Perfil: `name` de 1 a 100 caracteres, sem caractere de controle (o NUL o Postgres nem guarda) e sem ser só espaço; e-mail de até 254 caracteres; `image` não existe (400 `INVALID_PROFILE`). A resposta de e-mail novo e de e-mail repetido é a mesma, com os mesmos valores, **inclusive quando dois cadastros do mesmo e-mail novo chegam juntos** (o segundo bateria no `UNIQUE` do banco e viraria um 422 que denuncia o e-mail livre: o P2002 vira a resposta genérica) |
| Verificação | O cadastro manda o link (`GET /api/auth/verify-email?token=...`, absoluto pelo `PUBLIC_URL`, vale 60 minutos); a tela manda `callbackURL: "/verificar-email?retorno=1"` (um caminho do site) no cadastro e no reenvio para o link terminar na tela que diz que o endereço foi confirmado (o padrão do Better Auth é `/`; a verificação não abre sessão, `autoSignInAfterVerification` é falso, então o destino não é a `/conta`). Sem verificar, o login é 403 `EMAIL_NOT_VERIFIED` e um e-mail novo sai. **O mesmo destinatário não recebe o mesmo tipo de e-mail duas vezes em 60 s** (o `AccountMailer` descarta o segundo, que vai ao log sem o endereço; o primeiro continua valendo): a tela diz "se não chegou, espere 1 minuto e tente de novo" |
| Login, sessão, logout | `POST /api/auth/sign-in/email`, `GET /api/auth/get-session`, `POST /api/auth/sign-out`. Cookie `alvesting.session_token`: `HttpOnly`, `SameSite=Lax` e `Secure` quando o site é https, o que decide o esquema do `PUBLIC_URL` (a produção sempre é: o contrato recusa outro; o e2e também, atrás do Front Door imitado em https), e então vira `__Secure-alvesting.session_token`. Em dev, em http, é `alvesting.session_token`, sem `Secure` (um `__Secure-` vindo de http o WebKit descarta). Sessão de até 7 dias, renovada a cada uso |
| Redefinição de senha | `POST /api/auth/request-password-reset` (`redirectTo` = a tela do site) manda o link `PUBLIC_URL/redefinir-senha?token=...` (vale 30 minutos); a tela chama `POST /api/auth/reset-password` com `{ newPassword, token }`. Revoga todas as sessões. A resposta do pedido é a mesma para e-mail cadastrado ou não |
| Google | `POST /api/auth/sign-in/social` com `provider: "google"`. **Entrar** não cria conta; **cadastrar** manda `requestSignUp: true` e `additionalData: { consent }` (o aceite explícito, igual ao do e-mail). Só existe com `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`; sem eles o provedor não é registrado e nada quebra. O Google precisa confirmar o e-mail. Não guardamos os tokens nem a foto |
| Aceite novo | Versão nova de um texto: `GET /me` mostra `consent.upToDate: false`, as rotas protegidas pelo `ConsentGuard` respondem 403 `CONSENT_REQUIRED`, e `POST /me/consents` com as versões que o usuário viu (409 se mudaram no meio) reabre. Exportar e excluir **não** dependem do aceite novo |
| Exportar | `GET /me/export`: JSON com tudo do dono (no envelope, `Content-Disposition: attachment`). Sem hash de senha, token de OAuth, token de verificação nem token de sessão |
| Excluir | `DELETE /me` com a sessão recente (até 5 minutos) **ou** `{ password }` (o corpo pode faltar de vez, como num `fetch` com `method: 'DELETE'`). Apaga a conta, as sessões, as contas vinculadas, os aceites e os pedidos pendentes; limpa o cookie; deixa uma linha de auditoria com o ULID. **Tudo numa transação só** (`user.deleteUser.beforeDelete`): uma falha no meio não deixa a pessoa sem credencial e com o cadastro vivo, nem apagada sem o rastro; falhou, nada foi apagado e a rota responde 500. Conta só com Google não tem senha: precisa entrar de novo para excluir. Senha errada 5 vezes em 15 minutos bloqueia (429) |

Origem: toda mutação em `/api/v1/me` exige `Origin` igual ao `PUBLIC_URL` (defesa em profundidade contra CSRF, além do `SameSite=Lax`); o Better Auth faz o mesmo nas rotas dele.

## 3. Tabelas (migrations `20261102100000_account` e `20261102110000_account_limits`, aditivas)

| Tabela | O que é |
|---|---|
| `user` | `id` (ULID), `name` (até 200 no banco, 100 na API), `email` (minúsculo, único, até 254), `email_verified`, `image` (sempre nula; teto de 2048 só como rede de segurança), `role` (`USER` ou `ADMIN`). Os tetos são `CHECK` do banco: a última barreira se um caminho novo esquecer a validação (antes, um nome de 5 milhões de caracteres era gravado sem erro) |
| `session` | `token` (a credencial; nunca sai), `expires_at`. `ip_address` e `user_agent` existem porque o Better Auth os grava, e um hook os deixa **nulos** (NULL diz "não coletado") |
| `account` | uma por forma de entrar: `credential` (`password` = scrypt) ou `google`. Os campos de token do Google existem e ficam sempre nulos (hook, no login novo e nos seguintes) |
| `verification` | pedidos de uso único (redefinição de senha: o identificador é o **resumo** do token) e o estado do fluxo do Google. O índice de `value` é **hash**: o estado do Google é texto do cliente, e o btree recusa linha acima de 2704 bytes |
| `consent` | o plano chama de `profile`. Uma linha por (usuário, documento, versão) com `sha256` e `accepted_at`. **Histórico que não se reescreve**: um gatilho do banco recusa `UPDATE` e outro recusa `DELETE` direto. A linha só some com a conta (a cascata do usuário passa pelo gatilho). **A api só tem `SELECT` e `INSERT` na tabela** (papel mínimo do Postgres, seção 11): o banco recusa o `UPDATE` e o `DELETE` direto antes mesmo do gatilho, e a api não consegue removê-lo |
| `portfolio`, `portfolio_lot` | **a carteira (etapa 12; migration `20261103130000_portfolio`, `docs/API.md`, seção 9)**: uma carteira por usuário e os lançamentos de compra dela (ticker, quantidade, custo total em centavos, data da compra opcional, criado e atualizado em). `ON DELETE CASCADE` de usuário para carteira e de carteira para lançamento, `CHECK`s de quantidade, custo, ticker e data, e **sem chave estrangeira para `instrument`** (ADR 0031) |

Invariantes que protegem a carteira (já coberta) e as conversas da etapa 13 (`domain/user-data.spec.ts`, lendo o `schema.prisma`): todo modelo ligado ao usuário (direto ou por outro modelo do
usuário) tem `onDelete: Cascade` e está no JSON de exportação; toda coluna dele ou sai no export ou está em `NEVER_EXPORTED` com o motivo; nenhum modelo fora do usuário guarda um `userId` solto
(sem `@relation`, o leitor não o veria). A carteira entrou sem exceção nenhuma e as conversas já nascem cobertas: o teste reprova o esquecimento. A outra ponta é o **catálogo do Postgres**
(`me.integration.spec.ts`, "o catálogo do banco"): toda chave estrangeira que parte do usuário, direta ou por outra tabela dele, é `ON DELETE CASCADE` de fato (uma migration escrita à mão com
`RESTRICT` passaria pelo schema e travaria a exclusão).

**Aceite sem versão nova**: a chave do aceite é (usuário, documento, versão), sem o SHA-256, então editar um texto sem subir a versão faria o aceite novo ser descartado em silêncio. Quem impede é o
teste dos hashes congelados (`legal-documents.spec.ts`); se o texto puder mudar fora do repositório, a chave passa a incluir o `sha256`.

**Janela do aceite no cadastro**: o Better Auth grava o aceite depois do commit do usuário. Se essa gravação falhar, o cadastro responde 500 (o log leva só o ULID), o usuário existe sem aceite, as rotas que o
exigem respondem 403 `CONSENT_REQUIRED` e `POST /me/consents` regulariza (testado).

## 4. Papéis

`user` (padrão) e `admin`, numa coluna do usuário. **Ninguém vira admin por HTTP**: no Better Auth o campo é `input: false` (o cadastro o ignora, a atualização do
perfil o recusa com 400; a rota `update-user` ficou fechada de vez) e não há plugin que o troque. O único caminho é `pnpm --filter @alvesting/api account:promote <e-mail>` (grava `audit_log`, ator `cli`, só com o
ULID). **Só promove e-mail já verificado, o que não basta**: o cadastro por e-mail não prova o dono do endereço, e quem cadastrou primeiro o e-mail do operador e abriu o link do único e-mail enviado (o do
cadastro dele: o do operador recebe um 200 genérico, sem conta nova nem e-mail) tem uma conta verificada, cuja senha seguiria valendo depois da promoção. **Antes do `promote`, o operador entra no site com a
própria senha**: se o login responde 401, a conta foi tomada, e "Esqueci a senha" (que revoga as sessões) a devolve. O comando lembra disso na saída; se promoveu a conta errada, o `account:demote` desfaz e
encerra as sessões. O papel é lido do banco a cada requisição: a promoção vale na hora. **O contrário é o `pnpm --filter @alvesting/api account:demote <e-mail>`** (etapa 10, parte 2, antes de abrir as rotas `/admin`): tira o papel **e apaga todas as
sessões da pessoa**, numa transação só com a linha de auditoria (`account.demoted`, ator `cli`, alvo o ULID, com o número de sessões encerradas). O papel já vale como `user` na próxima requisição (é lido do banco);
apagar as sessões é a segunda barreira, para um cookie que vazou deixar de valer para tudo. Repetir o comando não muda nada e **não derruba a sessão** de quem já voltou a entrar como usuário comum. As duas linhas de
auditoria (`account.promoted` e `account.demoted`) levam, na Azure, o nome da execução do job (`execution`, de `CONTAINER_APP_JOB_EXECUTION_NAME`), que liga a linha a quem a iniciou no log de atividade da assinatura.

**Primeiro admin na Azure** (e rebaixar um): o Postgres é privado, então os comandos rodam como uma **execução do `job-migrate` com outro comando**, que tem a rede e o segredo do banco e é manual. O passo a passo
(`az containerapp job show` ... `az containerapp job start --yaml`) está em `docs/INFRA.md`, seção 8.6, com a ressalva do que a documentação da Microsoft diz: o modelo da execução **substitui o modelo inteiro** do job
(imagem, variáveis e segredos incluídos), por isso os flags `--command` e `--args` sozinhos não bastam. O e-mail do operador vai na linha de comando e fica no histórico de execuções do job, visível a quem lê o grupo de recursos:
use o endereço da própria conta de operador. Depois do primeiro admin, o resto se faz pelo painel (`docs/TELAS.md`, seção 8): criar e iniciar temporada, reenviar a DLQ, reprocessar o ciclo, registrar evento.
**Não verificado na Azure** (nada rodou na assinatura): o `job start` com o modelo trocado.

Guards (`presentation/`): `SessionGuard` (sessão obrigatória; põe `req.account.userId` e o papel; **a rota usa sempre o ULID da sessão,
nunca um id da requisição**; nas mutações confere o `Origin`), `RolesGuard` com `@Roles('ADMIN')` e `ConsentGuard`. Falham fechado: sem o `SessionGuard` na frente, os outros dois
respondem 401. **As rotas `/admin` (etapa 10, parte 2; `docs/API.md`, seção 8) usam os três em toda rota, com o `@Roles('ADMIN')` em cada rota, e não na classe**: a rota que esquecer o papel nasce fechada. A carteira (etapa 12) e o chat (13) usam o `SessionGuard` e o `ConsentGuard`. O ator da trilha de auditoria das rotas de admin é `admin:<ULID da sessão>`, e as linhas de auditoria ficam depois de o admin excluir a conta (guardam só o ULID, como a linha da própria exclusão).

## 5. LGPD e dados pessoais

- **Dados mínimos**: nome, e-mail, resumo scrypt da senha, identificador da conta Google, sessão (sem IP nem navegador: as colunas ficam nulas), aceite e, para quem a usa, a **carteira** (ticker, quantidade, custo total e data da compra de cada lançamento; subseção "A carteira e a LGPD" abaixo).
- **Logs**: nunca e-mail, nome, IP, cookie ou token. O log de requisição é uma lista branca (`common/http-log.ts`; o token da redefinição no caminho vira `:token`); o logger do
  Better Auth deixa passar só a mensagem limpa e o nome do erro; o filtro de erros e a trava de origem passam por `common/redact.ts`; o e-mail que falha loga só o nome e o código do
  erro. Quando precisa identificar, é o ULID. O Better Auth tinha **dois caminhos de log fora do `logger` configurado** (o `ERROR [Better Auth]: ...` do roteador, com texto que o cliente mandou, e o
  `console.error('# SERVER_ERROR:', erro)` do better-call, com a pilha crua): `onAPIError: { throw: true }` os desliga, o erro de usuário vira só a resposta 4xx e a exceção inesperada
  cai no `AuthRoute`, que a loga com `redactPii` e responde 500 no envelope. O `redactPii` roda sobre texto do atacante (o Better Auth loga o `callbackURL` e o `Origin` inválidos), então é **linear no
  tamanho do texto**: cada regra é linear sozinha (lookbehind onde uma sequência poderia começar em qualquer letra) e o texto é cortado em 8 KB antes das regras (ReDoS: a regra do e-mail era quadrática e
  60 KB travavam a api por 1,6 s). Teste: `auth-flows.integration.spec.ts`, "nada de dado pessoal no log" (inclui o console), e `common/redact.spec.ts`.
- **Telemetria** (etapa 10, `docs/INFRA.md`, 5.1): o Application Insights recebe requisições, consultas e exceções da api, e **nunca** e-mail, nome, IP, cookie, token de sessão, de verificação ou de redefinição (nem no caminho nem na query da URL). Lista branca
  no processador de spans (`telemetry/sanitize.ts`), o `redact.ts` sobre texto de exceção e o SQL sem valores; a rota do login é `/api/auth/*`. Teste: `telemetry.integration.spec.ts` faz o cadastro, a verificação, o login e a redefinição com canários e confere o que sai, e, desde a etapa 12, as quatro rotas da carteira (quantidade, custo e data do lançamento não saem em span nem em SQL; a rota é o padrão `/api/v1/me/portfolio/lots/:id`).
- **Exclusão** apaga tudo do usuário no banco, **numa transação só** (a carteira e os lançamentos inclusive, pela cascata). Ficam a linha de auditoria (só o ULID) e as cópias de segurança do banco (ponto de restauração de 7 dias).
- **Retenção que a política promete** (`legal/politica-de-privacidade.md`, item 5): sessões vencidas, pedidos de uso único vencidos (`verification`) e cadastros nunca confirmados são apagados pela
  **limpeza diária da fila `maintenance`** (a mensagem `retention`, todo dia às 10:00 de Brasília, `0 13 * * *`; etapa 10, onda 3d, diária desde 04/11/2026; `docs/JOBS.md`, seção 8.1). As regras: `session` **já vencida** (sem folga);
  `verification` já vencida; `"user"` com `email_verified` falso criado há **mais de 6 dias** (`RETENTION_DAYS.user`; a cascata leva `account`, `session` e `consent`; o gatilho do aceite deixa passar o `DELETE` em cascata). Em lotes de 500, com o
  relógio injetado, e a contagem de cada `DELETE` no log, sem dado pessoal. O teste (`retention.handler.integration.spec.ts`) tem linhas de cada lado de cada corte (1 ms para cada lado), roda duas vezes sem erro, prova que a conta confirmada
  (ou a sessão renovada) no meio de um lote não é apagada e que o corte não depende do fuso do banco. Antes dela, o Better Auth só apagava a sessão vencida quando alguém a apresentava de novo.
  **O que a política diz tem de bater com a cadência, e ela promete o PIOR CASO de cada item** (o corte mais a espera até a próxima limpeza, que agora é de 1 dia): o cadastro nunca confirmado some em **até 7 dias depois de criado**
  (corte de 6 dias mais 1; a conta criada logo depois de uma limpeza tem menos de 6 dias nas 6 seguintes e sai na 7ª); a sessão e o pedido de uso único vencidos somem em **até 1 dia depois de vencer**, e como a sessão vale 7 dias desde o
  último uso (o padrão do Better Auth, 604800 s e renovação a cada 86400 s, fixado em teste), o registro de uma sessão abandonada fica **no máximo 8 dias**. O teste do pior caso (`retention.handler.integration.spec.ts`, "a promessa da
  política") roda o relógio injetado de limpeza em limpeza, com cadastros e sessões criados 1 ms antes, na hora exata, 1 ms depois e a 6, 12 e 18 horas de uma limpeza, e confere que nenhum fica mais que a promessa (e que o pior caso é
  exatamente 7 dias); o `infra/tests/check.mjs` confere o cron diário e o corte de 6 dias juntos. Antes (o texto 0.2) a limpeza era semanal e o texto dizia "até 14 dias" para o cadastro e para a sessão abandonada; a
  **decisão do Artur de 04/11/2026** ("Todo dia, prazo de 7 dias") trocou a cadência, o corte (de 7 para 6 dias) e o texto, que subiu para a **0.3**. A promessa conta com a limpeza rodando: um dia perdido (a execução falhou e a fila ainda repete,
  ou o agendador não rodou) adia o prazo em um dia, e o `job-falhou` e a conferência diária do RUNBOOK (seção 1, item 5) são o que pega isso. **O texto da política diz isso** (a ressalva no fim do item 5: "Se uma limpeza falhar ou não
  rodar, o que passou do corte é apagado na próxima que rodar, e o prazo cresce pelos dias sem limpeza"), porque o relógio real não é o perfeito do teste do pior caso: a limpeza sai do agendador pela fila e pelo KEDA, com minutos de atraso que
  variam de um dia para o outro. Nenhum alerta vigia a **ausência** da limpeza (um agendador que não publica, um worker que não acorda): só a conferência da segunda-feira vê um buraco de fim de semana (`docs/INFRA.md`, 5.3, limitações). **Decisão do
  Artur, em aberto:** se ele quiser os 7 dias como compromisso duro, o corte de `user` cai para 5 (o pior caso com a limpeza em dia vira 6 dias, e uma limpeza perdida o leva a uns 7, com a folga dos minutos de atraso); isso muda o texto, a versão, o teste do pior caso e o `check.mjs`.
- **Cópia de segurança mensal sem dado pessoal** (etapa 10, onda 3d; ADR 0028). O `backup-verify` guarda o `pg_dump` por 12 meses no Blob, e a política promete que as cópias guardam dado pessoal só pelo ponto de restauração
  de 7 dias. Então o dump leva o **esquema inteiro, mas não os dados das tabelas pessoais** (`user`, `session`, `account`, `verification`, `consent` e, desde a etapa 12, `portfolio` e `portfolio_lot`, a classificação escrita à mão em
  `apps/api/src/infrastructure/database/table-policy.ts`, a mesma do papel do Postgres): a restauração de teste confere que elas voltam vazias (com um lançamento de verdade na origem). `audit_log` não é pessoal (só ULID; a política mantém a linha depois da
  exclusão). O chat (13) entra nessa matriz com a migration dele: o teste reprova o modelo ligado ao usuário que não esteja como pessoal, e o `backup-verify` recusa o banco que tem tabela sem decisão.
  O texto da política (rascunho 0.2 e 0.3) diz isso no item 5; a revisão é do Artur.
- **Exportação** leva o cadastro, as contas vinculadas, as sessões, os aceites e a carteira (`portfolios` e `portfolioLots`). Ficam de fora, e a política diz isso, os registros de `audit_log` (guardam só o ULID) e os pedidos pendentes de `verification`
  (guardam credencial).
- **Log do WAF** (Front Door): guarda IP e URL com query de quem foi bloqueado, 90 dias (docs/INFRA.md, 2.5). A política de privacidade cita isso e o prazo.
- **Transferência internacional**: dados em East US 2 (Estados Unidos) e, para quem entra com Google, no Google. A política informa e pede o consentimento específico e em
  destaque (LGPD, art. 33, VIII), junto com as garantias do operador (art. 33, II). **A confirmação da base jurídica é do orientador** (item 8).

### A carteira e a LGPD (etapa 12, os textos 0.2)

- **O que se guarda**: por lançamento, o ticker, a quantidade, o custo total em centavos, a data da compra (opcional) e as datas de criação e de alteração. Nada de corretora, conta de investimento, CPF ou nota de corretagem: é só o que o usuário digita. O preço usado para o valor de mercado
  vem do banco de mercado (público), nunca do usuário.
- **Para quê e por quanto tempo**: mostrar o preço médio, o valor estimado e o ganho ou a perda (execução de contrato, art. 7º, V); **até o usuário apagar o lançamento ou a conta**. Não há histórico das alterações (o `PATCH` troca o lançamento e o `DELETE` o apaga); só o ponto de restauração
  de 7 dias do banco guarda estados antigos.
- **Exportar e excluir cobrem a carteira**: `GET /me/export` leva `portfolios` e `portfolioLots` (o custo como número em centavos; a data da compra como `AAAA-MM-DD`, o dia que o dono digitou, e não uma meia-noite UTC); `DELETE /me` leva a carteira e os lançamentos na mesma transação, pela cascata (o teste conta as linhas antes e depois
  e prova que a transação inteira volta atrás se a auditoria da exclusão falha). O `user-data.spec.ts` passa sem exceção nova.
- **Fora do backup mensal e dos logs**: as duas tabelas são `personal: true` na matriz (`table-policy.ts`), então o dump não leva os dados delas (o `backup-verify.handler.integration.spec.ts` semeia um lançamento de verdade e confere que ele não está no dump nem na restauração); o log de requisição e a telemetria não levam o conteúdo da carteira.
- **Os textos 0.2** (rascunho, `legal/`): a política descreve a carteira (itens 2, 3, 5, 6, 7 e 9: o que se guarda, a finalidade e a base legal, a retenção, o backup sem o dado pessoal e o ponto de restauração de 7 dias, a transferência internacional "inclusive a carteira", e que exportar e excluir a cobrem), e os termos ganham a
  seção 4, "A carteira": ela é **informativa**, os valores são **estimados pelo último fechamento disponível** (que pode estar atrasado ou faltar, e não considera proventos, desdobramentos, corretagem nem impostos) e **nada ali é recomendação**. As linhas `TERMS@0.2` e `PRIVACY@0.2` entraram no `FROZEN` do `legal-documents.spec.ts`; as `@0.1` ficam como
  registro do que a conta aceitou. **Quem aceitou a 0.1 recebe 403 `CONSENT_REQUIRED` nas rotas da carteira até aceitar a 0.2** (a `/conta` já mostra o formulário do aceite novo; exportar e excluir seguem abertos): `portfolio.integration.spec.ts` faz o usuário nascer com a 0.1, vê o 403 nas quatro rotas e a carteira abrir depois do aceite.
  Os e2e já aceitam a versão vigente (os helpers leem `GET /legal`, em vez de repetir um número).

### A política 0.3 (04/11/2026, a limpeza diária)

- **O que mudou:** só o item 5 da política (sessão, cadastro não confirmado e links por e-mail passam a dizer o **pior caso** da limpeza diária, sem falar de limpeza semanal) e a linha de versão e vigência (`Versão: 0.3`, `Vigência: 04/11/2026`). O resto do texto é o da 0.2. Ainda é **rascunho**.
- **Os termos não mudaram** (o SHA-256 é o mesmo da 0.2), então **seguem na 0.2**. A regra de versão é a do arquivo (seção 8, item 1): a versão sobe quando o texto muda, **documento por documento**, e o aceite guarda (usuário, documento, versão, SHA-256). O cadastro novo leva `{ terms: '0.2', privacy: '0.3' }`, que vem do `GET /legal`.
- **Quem aceitou a 0.2 tem de aceitar a 0.3** antes de usar a carteira e o resto do que pede aceite (toda rota atrás do `ConsentGuard`, o `/admin` inclusive): `GET /me` mostra `consent.upToDate: false` com **só a política pendente** (os termos 0.2 seguem aceitos), as rotas respondem 403 `CONSENT_REQUIRED`, e `POST /me/consents` com as versões vigentes reabre; exportar e excluir seguem abertos. Está provado no `portfolio.integration.spec.ts` (o usuário que nasceu com os textos 0.1, e o que nasceu com os 0.2: 403 nas quatro rotas da carteira, exportar 200, o aceite reabre) e no `me.integration.spec.ts` (o histórico guarda a política 0.2 e a 0.3, cada uma com o SHA-256 que a pessoa viu).
- O `legal-documents.spec.ts` ganhou a linha `PRIVACY@0.3` no `FROZEN` (as anteriores ficam, como registro do que foi aceito) e a conferência de que o texto diz o pior caso de cada item (cadastro em até 7 dias, sessão guardada no máximo 8, pedido de uso único em até 1 dia depois de vencer) e não fala mais de "semanal" nem de "14 dias". O mesmo spec exige que o "6 dias" do texto seja o `RETENTION_DAYS.user` do código (mudar o corte sem mudar o texto reprova), a ressalva da limpeza que falha ou não roda e a menção ao ponto de restauração do banco no cadastro apagado. O `auth-flows.integration.spec.ts` fixa a validade da sessão (7 dias, renovada no máximo uma vez por dia), que é o padrão do Better Auth e a base do "8 dias".

## 6. Configuração

As variáveis estão no `docs/INFRA.md`, 2.7 (a tabela é comparada com o Bicep pelo `check.mjs`); os valores de exemplo, marcados como tal, no `.env.example`.

| Variável | Em produção | Em dev e teste |
|---|---|---|
| `PUBLIC_URL` | obrigatória, `https`, só a origem | padrão `http://127.0.0.1:4300` |
| `BETTER_AUTH_SECRET` | obrigatória: 32 caracteres ou mais, com pelo menos 12 distintos, **diferente do exemplo do `.env.example`** | o de exemplo serve |
| `ACS_CONNECTION_STRING`, `EMAIL_SENDER_ADDRESS` | obrigatórias (Communication Services) | opcionais |
| `EMAIL_OUTBOX_DIR` | **a api recusa subir** se existir | liga o remetente falso: cada e-mail vira um arquivo JSON na pasta |
| `LEGAL_CONTROLLER_NAME`, `LEGAL_CONTACT_EMAIL` | obrigatórias, juntas, **e diferentes dos valores de exemplo do `.env.example`** (copiar o arquivo publicaria uma política com um controlador de mentira, LGPD art. 9) | opcionais, juntas |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | opcionais; o Google só existe com as duas | idem |

A api **recusa subir** em produção com qualquer violação (a mensagem lista só os nomes das variáveis, nunca os valores). O worker e os agendadores não leem nada disto.

**O que o Artur precisa fazer no Google Cloud** (só se quiser o login com Google): (1) Console, "APIs e serviços", tela de consentimento OAuth (OAuth consent screen): tipo Externo, nome Alvesting, escopos
`openid`, `email` e `profile` (os três são básicos) e os links da política e dos termos do site (parte 2). (2) "Credenciais" (Credentials), criar credenciais, ID do cliente OAuth (OAuth client ID), tipo
**Aplicativo da Web** (Web application), com o URI de redirecionamento autorizado `<PUBLIC_URL>/api/auth/callback/google` (em dev, `http://127.0.0.1:4300/api/auth/callback/google`). (3) O ID do cliente vai em
`ALVESTING_GOOGLE_CLIENT_ID` (não é segredo) e o secret no Key Vault (`ALVESTING_SECRET_GOOGLE_OAUTH_CLIENT_SECRET` no `seed-secrets.sh`). Enquanto o app estiver em "teste", só entram os usuários de teste.

**Na Azure**: (1) escolher `ALVESTING_LEGAL_CONTROLLER_NAME` e `ALVESTING_LEGAL_CONTACT_EMAIL` (passo 2 do `docs/INFRA.md`); (2) o domínio de e-mail gerenciado (`<guid>.azurecomm.net`) nasce no deploy e o
remetente `DoNotReply@...` vai sozinho para `EMAIL_SENDER_ADDRESS`; (3) o `seed-secrets.sh` gera o `better-auth-secret`, e o Bicep guarda o `acs-connection-string` quando roda com `writeDerivedSecrets=true`;
(4) o Communication Services manda a partir do domínio gerenciado: confira a caixa de spam no primeiro teste real.

**A cota de e-mail do Communication Services (leia antes de abrir ao público).** O domínio gerenciado pela Azure (`<guid>.azurecomm.net`) aceita **5 e-mails por minuto e 10 por hora por assinatura, sem como
aumentar** (e 10 consultas de estado por minuto e 20 por hora, que o `pollUntilDone` também gasta); o domínio próprio verificado começa em 30 por minuto e 100 por hora, e tem pedido de aumento (Learn,
"Service limits for Azure Communication Services", seção Email, lida em 02/11/2026). Cada cadastro de endereço novo, cada reenvio da verificação e cada pedido de redefinição de conta existente manda um e-mail, e
**qualquer pessoa os pede sem ter conta**: com 10 pedidos a cota da hora acaba para todos, o envio seguinte falha em silêncio (só vai ao log) e quem se cadastrou não consegue verificar o e-mail. O código
limita o dano de um alvo só (o mesmo tipo de e-mail para o mesmo destinatário, no máximo uma vez a cada 60 s) e dá ao envio um prazo de 30 s; **a cota em si só se resolve com um domínio próprio verificado**
(decisão do Artur: DNS e domínio), item obrigatório do checklist (seção 8). Um balde global no código não criaria capacidade, e o que decide quem perde a cota (um atacante ou uma pessoa que esqueceu a senha) é
política que fica para a etapa 10 junto com o alerta de falha de envio; hoje o envio que falha só vai ao log.

**Identidade gerenciada no e-mail**: o `EmailClient` aceita um `TokenCredential`, e seria melhor que a chave. Não foi feito porque a documentação do Communication Services lida em 02/11/2026 (autenticação,
identidade gerenciada, quickstart de e-mail, quickstart de service principal e as páginas de papéis internos) não diz qual papel do Azure RBAC basta **para enviar** (o quickstart usa Contributor). A troca
é: papel confirmado, `ACS_ENDPOINT` no lugar da connection string, `DefaultAzureCredential` no `createEmailSender` e o segredo `acs-connection-string` saindo do `email.bicep`.

## 7. Testes

`pnpm --filter @alvesting/api test` (com `TEST_DATABASE_URL`): cadastro (inclusive os 8 simultâneos do mesmo e-mail e a validação do perfil), e-mail falso, verificação, login, sessão, logout, redefinição, limite de tentativas, o Google com `fetch` falso (início do
fluxo e callback, e os tokens que ficam nulos também no login seguinte), papel admin impossível por HTTP, a lista das rotas do Better Auth abertas e fechadas, o teto do corpo, a origem e o `callbackURL` (CSRF), `/me` com dois usuários
(A nunca lê nem apaga nada de B), a exclusão numa transação (com uma falha de verdade injetada no banco), o histórico de aceite, os guards (inclusive a rota sem `@Roles`, que nem o admin abre) e o log sem dado pessoal (inclusive o console). Os de contrato e de schema não precisam de banco.
`pnpm test:e2e`, sempre nos três projetos (pixel-7, iphone-15 e desktop): `account-api.spec.ts` (só HTTP) contra a api de produção na **porta 4308** (`NODE_ENV=test`, a única que liga o remetente falso, `EMAIL_OUTBOX_DIR`
numa pasta temporária), agora **atrás da trava de origem** como na Azure (cada chamada leva o `X-Azure-FDID` e o IP do limite de tentativas vai no `X-Azure-SocketIP`); e, da parte 2, `conta.spec.ts` e `conta-layout.spec.ts`
(seção 10), que usam um navegador de verdade. Nada chama o Google, o Communication Services nem a Azure. `pnpm --filter @alvesting/web test` cobre as peças das telas sem navegador (seção 10).

## 8. Antes de abrir ao público (checklist do plano, 5.16)

1. **Rever os dois textos** (Artur e orientador), agora nas versões **0.2 dos termos** (a da carteira) e **0.3 da política** (a da limpeza diária): o aviso `RASCUNHO` sai do texto na revisão. A revisão cobre também o que a 0.2 acrescentou (a carteira como dado pessoal: itens 2, 3, 5, 6, 7 e 9 da política, e a seção 4 dos termos) e o que a 0.3 acrescentou (os prazos do item 5 da política, pelo pior caso). Edição de um texto **sem subir a versão** reprova o `legal-documents.spec.ts` (o aceite guarda o SHA-256 do que o usuário viu): suba
   `Versão:` no próprio arquivo e acrescente a linha em `FROZEN`. Versão nova pede novo aceite de todos. **O teste "é rascunho" do `legal-documents.spec.ts` e os e2e `apps/web/e2e/account-api.spec.ts` e `apps/web/e2e/conta.spec.ts` conferem o texto `RASCUNHO`** (o último, na página `/termos` e na `/privacidade`): eles vão quebrar de propósito
   nessa hora e precisam ser ajustados junto.
2. Confirmar com o orientador a base da transferência internacional (art. 33) e o prazo de retenção que o texto promete.
3. Preencher `ALVESTING_LEGAL_CONTROLLER_NAME` e `ALVESTING_LEGAL_CONTACT_EMAIL` e testar o e-mail real pelo Communication Services (nenhum teste o chama).
4. Medir na Azure o que o código supõe (seção 11).
5. **Domínio próprio verificado no Communication Services** (seção 6): o domínio gerenciado pela Azure aceita 5 e-mails por minuto e 10 por hora para todos, sem aumento, e qualquer pessoa gasta isso sem conta.
6. **Primeiro admin e rebaixar admin** (seção 4): o `account:demote` existe, e o caminho do `account:promote` e do `account:demote` na Azure (uma execução do `job-migrate` com o modelo trocado, `docs/INFRA.md`, 8.6) está definido e **ainda não foi provado na Azure**: faça o primeiro com a conta de operador e confira o log da execução.
7. **Papel do Postgres da api** (seção 11): **feito no código** (etapa 10, onda 3d, ADR 0028): migration `20261103100000_api_role`, o comando `db:roles` e a matriz de tabelas. **Na Azure** (parte 4 da etapa 10, no Bicep e sem implantar): o segundo segredo (`database-url-api`, senha de `ALVESTING_PG_API_PASSWORD`), a identidade da api lendo só ele, o `job-migrate` que roda o comando depois do `migrate deploy`, o `DATABASE_URL` do `ca-api` trocado por ele e a api recusando subir em produção com outro login (`docs/INFRA.md`, 2.2 e 8.2). Nada disso rodou na Azure.
8. **A limpeza periódica da fila `maintenance`** (etapa 10): **feita no código** (seção 5; `docs/JOBS.md`, seção 8.1). Falta o primeiro pregão na Azure para vê-la rodar: o `job-sched-retention` roda todo dia às 10:00 (diário desde 04/11/2026: a política promete o pior caso, 7 dias para o cadastro nunca confirmado).

## 9. As telas (parte 2)

Código em `apps/web/src`: `app/` as páginas, `components/` as peças (`form-kit.tsx` e `account-forms.tsx` os formulários, `legal-text.tsx` o texto legal) e `lib/` o que fala com a api (`account.ts` a leitura do servidor, `account-client.ts` o navegador,
`account-validation.ts`, `safe-path.ts`). Estética crua de `globals.css`, mobile primeiro (alvos de 44 px, inclusive nas caixas de marcar; sem rolagem horizontal em 360 px). Todas as páginas são dinâmicas (`force-dynamic`).

| Rota | O que faz | Lê da api |
|---|---|---|
| `/entrar` | E-mail e senha; o botão do Google só se a api o tem. `?proximo=` (o caminho de volta, só interno), `?aviso=` e `?error=` (o erro do Google) são listas fechadas: o que não está nelas não aparece, e nada da URL vira texto | `GET /api/v1/auth/providers` |
| `/cadastro` | Nome, e-mail, senha e as **duas caixas do aceite** (termos e privacidade, cada uma com a versão vigente e nunca marcada; a da privacidade diz que os dados vão para servidores nos Estados Unidos, art. 33). O texto abre noutra aba | `GET /api/v1/legal` e `/auth/providers` |
| `/verificar-email` | Três estados pela URL: depois do cadastro (o link foi mandado; dá para pedir outro), `?retorno=1` (o link foi aberto: confirmado) e `?retorno=1&error=` (o link venceu ou já foi usado). O cadastro manda `/verificar-email?retorno=1` como `callbackURL`, e o Better Auth acrescenta o `error` | nada |
| `/esqueci-senha` | Pede o e-mail; a resposta é a mesma para e-mail cadastrado ou não | nada |
| `/redefinir-senha?token=` | A senha nova. O token vem do link do e-mail, vai direto ao formulário e nunca aparece na tela; a página responde com `Referrer-Policy: no-referrer` (`next.config.ts`) | nada |
| `/conta` | Dados mínimos, os aceites (documento, versão e data de Brasília), sair, **baixar os dados** (um link para `/api/v1/me/export`, que a api serve como anexo: funciona sem JavaScript), **excluir** (diz antes o que apaga e o que fica; pede a caixa marcada; pede a senha só se a api responder `REAUTH_REQUIRED`) e, se um texto mudou de versão, o aceite novo | `GET /api/v1/me`, com o cookie |
| `/termos`, `/privacidade` | O texto vigente, a versão, a vigência e o SHA-256 (e, na privacidade, o controlador e o contato). O aviso de rascunho vem no próprio texto | `GET /api/v1/legal` |

O cabeçalho ganhou o link fixo **Conta** (`/conta`) e, na etapa 12, o **Carteira** (`/carteira`, `docs/TELAS.md`, seção 9). Ele não lê a sessão: as páginas públicas da arena não a leem (protege o LCP da home e o cache de dados delas), então os links são os mesmos para quem entrou ou não, e a `/conta` manda quem não entrou para
`/entrar?proximo=%2Fconta` (307), assim como a `/carteira` manda para `/entrar?proximo=%2Fcarteira`. Desde a etapa 12 a `/conta` diz que **exportar** leva a carteira com os lançamentos e que **excluir** a apaga junto (a política 0.2, itens 5 e 7, promete isso).

### 9.1 Uma origem só

O navegador fala com **uma origem só**: o cookie é `SameSite=Lax`, o `Origin` das mutações tem de ser o `PUBLIC_URL` e o link do e-mail aponta para `PUBLIC_URL/api/auth/...`.

- **Na Azure** o Front Door manda `/api/*` para a api e `/*` para o site. O site **não** tem proxy para a api (nenhum caminho de produção que só exista para dev).
- **Em dev** (`pnpm dev`: site 4300, api 4310) o `rewrites` do `next.config.ts` repassa `/api/*` à api, **só na fase do servidor de desenvolvimento** (`devRewrites`): o build e o servidor de produção não o têm (`next-config.spec.ts`). Conferido à mão com o `next dev` e a
  api no banco de teste: cadastro, link do e-mail (absoluto pelo `PUBLIC_URL`), verificação, entrar, `/conta` renderizada com o cookie, exportar e excluir.
- **No e2e** um **Front Door imitado** (`apps/web/e2e/front-door.ts`, porta 4311) faz o papel dele: `/api/*` vai para a api da conta (4308) e o resto para o site da conta (4309); descarta o `X-Azure-FDID` e o `X-Azure-SocketIP` que o cliente mandar e escreve os
  seus; reescreve o `Host` para o da origem (`originHostHeader`) e leva o original em `X-Forwarded-Host`. **Serve https**, com um certificado autoassinado gerado na subida pelo `openssl` (1 dia, a chave só passa por um diretório temporário), e o `PUBLIC_URL` da api da conta é
  `https://127.0.0.1:4311`: assim a api emite o cookie de produção (`Secure`, com o prefixo `__Secure-`), e o Chromium e o WebKit o guardam e devolvem de verdade (medido: o WebKit 27 descarta um `__Secure-` vindo de http://127.0.0.1). Os testes abrem os contextos com `ignoreHTTPSErrors`;
  o smoke do deploy, que roda contra o Front Door publicado, não. A api e o site da conta rodam **atrás da trava de origem** (`ORIGIN_LOCK=front-door`), então a chamada do servidor do site à api só passa se levar o
  `X-Azure-FDID`: um site que a esquecesse falharia no e2e, e não só na Azure. Único desvio: o `X-Azure-SocketIP` de verdade é o IP do soquete; aqui o teste o escolhe (por um `X-Forwarded-For`), para os três projetos não dividirem o balde do limite de tentativas.
- **No perfil econômico** (`ca-web` e `ca-api` em hosts diferentes, sem Front Door) a sessão não funciona sem domínio próprio comum.

### 9.2 O que o servidor lê, e como

- **Nunca pelo cache de dados do Next.** `apiGetFresh` (`lib/api.ts`) lê com `cache: 'no-store'`, sem `next.revalidate` e sem tags (a revalidação da liquidação nem as vê), manda o `X-Azure-FDID` como toda chamada interna e não segue redirecionamento. Usam-no o `GET /me`
  (dado de uma pessoa), o `GET /legal` (o aceite grava a versão que a pessoa viu; texto velho vira 409) e o `GET /auth/providers` (um "google: false" velho esconderia o botão depois de o Google ser ligado). A leitura pública da arena (`apiGet`) segue como antes e nunca leva cookie.
- **O cookie vai só para a api.** A página da conta lê o cabeçalho `Cookie` da requisição e `authCookieHeader` (`lib/account.ts`) deixa passar só os cookies do Better Auth (`alvesting.` e `__Secure-alvesting.`), **como vieram** (a assinatura é base64 codificada: decodificar e codificar de novo mudaria o valor).
  Os de outro script (um rastreador) ficam no site.
- **O servidor chama `GET /api/v1/me`, e não `/api/auth/get-session`**: a chamada interna não passa pelo Front Door, não leva o `X-Azure-SocketIP` e cairia no balde único "sem IP confiável" do Better Auth (100 por 10 s no total).
- **Sem sessão, ninguém**: sem cookie, ou com a sessão que a api não reconhece (401), `readMe` devolve nulo e a página redireciona (sem chamar a api, se nem há cookie). Qualquer outro erro (a trava de origem, 5xx, a rede) vira a tela de "a arena não respondeu", montada no servidor, e não um redirecionamento.
- **A resposta sai com `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`** (o que o Next põe numa página dinâmica; o e2e confere `private` e `no-store` em `/conta`, e `no-store` no redirecionamento).
- **O que a parte 2 não faz**: o servidor não repassa ao navegador o cookie renovado que a api devolve quando a sessão passa de metade do prazo (um Server Component não escreve cookie), então o cookie vale 7 dias a partir do login, ainda que o banco renove a sessão a cada uso
  (comentário `ponytail` em `app/conta/page.tsx`; a saída é renovar por um Route Handler ou pelo cliente).

### 9.3 Os formulários

- **Exigem JavaScript, e dizem isso.** Um `<form>` sem handler faria um GET com a senha na URL (histórico, log da borda). Por isso o `<fieldset>` nasce **desativado** e só é ativado depois da hidratação, o método é `post` e o `<noscript>` diz "Esta tela precisa de JavaScript para enviar o
  formulário". Os textos (`/termos`, `/privacidade`), a exportação (um link) e o redirecionamento da `/conta` não dependem dele.
- **Acessíveis.** Todo campo tem `<label>`; a dica e o erro ficam ligados ao campo por `aria-describedby` e o erro marca `aria-invalid`; o **foco vai ao primeiro erro** (ou ao aviso do formulário, que é `role="alert"`); o aviso de sucesso é uma região `role="status"` que existe desde o
  começo, e **recebe o foco** quando chega (o botão que enviou ficou desativado durante o envio, e no celular o aviso fica abaixo do botão: o foco também rola a tela até ele); `autocomplete` certo (`email`, `current-password`, `new-password`, `name`) e `type` certo (`email`, `password`).
  **O erro de um campo some assim que a pessoa mexe nele** (senão o leitor de tela seguiria anunciando "inválido" para um campo já corrigido); volta no próximo envio, se o valor ainda não servir. A conferência de campo repete as regras da api com os mesmos números (`ACCOUNT_LIMITS`,
  no pacote de contratos); a api confere tudo de novo. O aviso de `/entrar?aviso=` (saiu, conta excluída, senha redefinida) é um parágrafo **renderizado no servidor, logo abaixo do título**, e não uma região viva que já nasce com texto (o leitor de tela não a anuncia ao carregar).
- **Só o necessário vai ao navegador.** Os módulos que rodam lá leem `ACCOUNT_LIMITS` e `REAUTH_REQUIRED` pelo subcaminho `@alvesting/contracts/account-constants` (`packages/contracts/src/account-constants.ts`, um módulo **sem imports**); pelo índice do pacote o bundler levava junto o zod e os schemas
  do contrato (123 KB, 36 KB comprimidos, em seis telas) só para ler seis números, e o formulário só vale depois de hidratar. O `conta-layout.spec.ts` confere, em cada tela, que nenhum script baixado contém o zod.
- **Prazo.** Cada pedido do navegador tem 15 s (`AbortSignal.timeout`, `account-client.ts`): estourado, vira "sem conexão" (status 0), e o formulário volta a poder ser enviado, em vez de ficar em "Enviando…" até o navegador desistir. Cadastro e exclusão que o servidor tenha concluído mesmo assim
  respondem no reenvio igual a qualquer outro (cadastro repetido: a resposta genérica; exclusão repetida: 401 "sua sessão acabou").
- **Erros em português, por código.** `messageFor` (`lib/account-client.ts`) troca o código da api por uma frase; nunca mostra a mensagem crua (em inglês no Better Auth, ou com o que o cliente mandou). O 429 diz quanto esperar quando a api manda o `X-Retry-After`.
  Entrar com o e-mail não confirmado diz "espere 1 minuto e tente entrar de novo" (o mesmo tipo de e-mail sai uma vez por minuto) e leva ao reenvio.
- **Redirecionamento só para caminho interno.** O `proximo` passa por `safeInternalPath` (`lib/safe-path.ts`): uma `/` seguida de outra `/` ou de `\`, endereço absoluto, `javascript:`, espaço e caractere de controle voltam ao padrão (`/conta`). O caminho de volta da verificação é uma constante da tela, e a api ainda confere o `callbackURL`.
- **O botão "voltar"** pode devolver a página do cache de ida e volta do navegador (bfcache) com o formulário desativado e a senha na tela: ao voltar assim, o formulário é destravado e limpo (`pageshow` com `persisted`). A `/entrar` sai com `Cache-Control: no-store`, e o navegador não a guarda nesse cache (medido
  em Chromium e WebKit: o "voltar" a recarrega, e o formulário volta limpo por ser uma página nova); o tratamento é para o navegador que a restaura mesmo assim, e o e2e o exercita com o evento `pageshow` disparado à mão. Depois de **redefinir a senha**, a tela troca a entrada do histórico
  (`location.replace`) em vez de empilhar a nova: o "voltar" não devolve a `/redefinir-senha?token=…`, que ficaria no histórico de um computador compartilhado com o link ainda aberto (vale 30 minutos).
- **O Google** (só com a api configurada): "Entrar com o Google" e "Cadastrar com o Google" são botões de envio do próprio formulário. Entrar não cria conta; cadastrar exige as duas caixas do aceite e manda `requestSignUp` com o aceite em `additionalData` (`googleBody`, testado). Os erros do callback voltam em `/entrar?error=`.

### 9.4 O que a parte 1 deixou para a parte 2

| Item | Como ficou |
|---|---|
| Rewrites do Next de `/api/*` para a api em dev | Feito, só na fase de desenvolvimento (9.1) |
| Ler `GET /legal` sem o cache de dados do Next | Feito (`apiGetFresh`, 9.2) |
| `X-Forwarded-For` por teste (limite por IP) | Feito: o e2e escolhe o IP de cada teste; atrás da trava, vai como `X-Azure-SocketIP` pelo Front Door imitado |
| `Referrer-Policy: no-referrer` na redefinição | Feito (`next.config.ts`, conferido no e2e) |
| Chamar `GET /api/v1/me` (e não `get-session`) no servidor | Feito (9.2) |
| Mostrar `CONSENT_REQUIRED`, `INVALID_PROFILE`, `EMAIL_NOT_VERIFIED`, `REAUTH_REQUIRED`, 413 e 429, e "espere 1 minuto" | Feito (`messageFor` e os formulários) |
| `DELETE /api/v1/me` sem corpo | Feito (o corpo só vai com a senha) |
| Abrir `change-password`, `update-user`, `list-sessions`, `revoke-*` e `link-social` | **Não**: nenhuma tela as pede. Seguem fechadas (seção 1) |

## 10. Testes das telas

Sempre em pixel-7 (Chromium), iphone-15 (WebKit) e desktop; e-mail e IP únicos por teste (`e2e/account-support.ts`); e-mail só `@example.test`; nada vai à rede (o e-mail cai numa pasta e o Google não participa).

- `e2e/conta.spec.ts`: o **fluxo completo pelas telas** (cadastro com o aceite, o link do e-mail falso, a verificação, entrar, a conta, **exportar** com o conteúdo do arquivo baixado conferido, sair, entrar de novo, excluir e não conseguir mais entrar); a **redefinição de senha** até entrar com a
  senha nova (o link não vale duas vezes, e a página responde `no-referrer` e `no-store`); **sem o aceite não há cadastro** (um erro por campo, o foco no primeiro, nenhum usuário criado); **o Google não aparece sem a api configurada**; os **termos e a privacidade com cada linha do texto**
  e a versão, a vigência e o SHA-256 iguais aos da api; **dois usuários em contextos separados** (A não vê, não exporta e não apaga nada de B); `/conta` **privada** (307 sem sessão; `private` e `no-store`; o token da sessão não aparece no HTML); o `proximo` só interno; excluir com a **sessão antiga** (a primeira ida do DELETE
  é respondida no navegador com o `REAUTH_REQUIRED`, o código do pacote de contratos que a api também devolve: o e2e não tem como envelhecer a sessão, que mora no banco da api, e a api devolvendo-o de verdade é o `me.integration.spec.ts`; a senha errada é recusada pela api de verdade e a certa exclui); o botão voltar (a página recarregada e a
  restaurada do cache de ida e volta, com o `pageshow` disparado à mão); **o fluxo por toque** (`.tap()` no texto das caixas de marcar, nos botões e nos links, nos dois projetos de toque e no desktop com um contexto que tem toque); as telas **sem JavaScript**; e o Front Door imitado (roteia, sobrescreve o `X-Azure-FDID` e deixa as duas origens travadas).
  O fluxo completo confere também que a tela da conta diz que **exportar leva a carteira** (e o arquivo baixado leva o lançamento criado pela api) e que **excluir a apaga** (etapa 12, parte 2; a tela da carteira tem o `carteira.spec.ts`, `docs/TELAS.md`, seção 9), e **o cookie que o navegador guardou** ao entrar pela tela: `__Secure-alvesting.session_token`, `Secure`, `HttpOnly`, `SameSite=Lax`, 7 dias, e `document.cookie` vazio, em Chromium e em WebKit. O cadastro confere que o erro de um campo some quando ele é corrigido, o "esqueci a senha" que o foco vai ao aviso, e a redefinição que o "voltar" não devolve
  a página do token.
- `e2e/conta-layout.spec.ts`: em **19 estados das telas novas** (cada tela, mais os estados de erro e de aviso, a conta com o erro da exclusão e a conta com o maior nome e um e-mail comprido): sem rolagem horizontal em 360 px, o cabeçalho cabe, **todo alvo de toque com pelo menos 44 px** (as caixas de marcar também), nenhum erro no console, o axe sem violação séria ou
  crítica e **sem nenhuma violação, de qualquer impacto, em 360 px**. O alvo de toque é medido cru (43,6 px não vira 44). Em cada tela também: o rodapé com o aviso fixo e as atribuições e o link da conta no cabeçalho, e nenhum script baixado com o zod.
- `e2e/account-api.spec.ts`: a api da conta atrás da trava de origem (sem o `X-Azure-FDID` é 403) e o ciclo só por HTTP. `e2e/smoke.spec.ts` ganhou três testes que valem num site publicado (antes todos com a etiqueta `@pos-virada`, porque a revisão antiga não tem a conta e o deploy provava pelo Front Door antes da virada; desde o blue/green da etapa 10, parte 4, o green é provado antes da virada e a etiqueta acabou: os que só chamam a api levam `@api`, `docs/DEPLOY.md`, seção 1): a tela de entrar abre e a conta sem sessão manda para ela; os textos
  legais saem da api sem cache; e o **POST do login pelo Front Door** (e-mail que não existe: 401 `INVALID_EMAIL_OR_PASSWORD`; prova que `/api/auth/*`, o `Content-Length`, o WAF, a trava de origem e o `PUBLIC_URL` fecham, sem criar conta nem mandar e-mail; só no site publicado).
- Na api, o `auth-flows.integration.spec.ts` ganhou o teste do **corpo que as telas mandam ao Google** (`googleBody`): os caminhos de volta relativos são aceitos, o cadastro novo vai para `/conta` e os erros voltam em `/entrar?error=` com os códigos de verdade (`signup_disabled`, `account_not_linked`,
  `email_not_verified` e `access_denied`), que são os da lista fechada de `/entrar`. É o que cobre o Google sem um Google de verdade (o `me.integration.spec.ts`, o `GET /auth/providers` com e sem o Google, e o contrato).
- Unidade (`pnpm --filter @alvesting/web test`, sem navegador): `safe-path`, `account-validation`, `account-client` (o POST, o código do erro, o `X-Retry-After`, as frases e o corpo do Google), `account` (o filtro do cookie, `readMe`), `apiGetFresh`, o texto legal (`legal-text`), as peças dos formulários renderizadas no servidor
  (rótulos, `autocomplete`, caixas desmarcadas, campos desativados, o aviso de JavaScript, o botão do Google só com a api), as páginas `/entrar` e `/conta` (os estados que a api do e2e não produz, como o texto que mudou de versão) e o `next.config.ts`.
- `pnpm lighthouse` (a home, com o link "Conta" no cabeçalho): em cinco execuções, LCP (mediana de 3 coletas) de 2.329 a 2.348 ms, CLS 0 e TBT de 14 a 38 ms; a margem do LCP segue a de `docs/TELAS.md`, seção 5. O comando agora faz 5 coletas por execução (a revisão mediu, com o Mac ocupado, LCP até 2.436 ms e TBT até 173 ms: dentro das metas, com menos margem).
- Portas do e2e: 4308 (api da conta), **4309** (site da conta) e **4311** (Front Door imitado, em https). A 4310 é a da api do `pnpm dev`.

## 11. O que não foi verificado e limites conhecidos

- **Não verificado nas telas**: o login com o Google **no navegador**, e um Google de verdade nunca foi chamado (o botão, o corpo do pedido e a tradução dos códigos de erro têm teste, e a api tem o fluxo inteiro com um provedor falso; o e2e roda sem Google configurado, que é o que a prova de "sem Google" exige); o aceite novo na tela (a api do e2e tem uma versão só dos textos: a página tem teste de unidade, sem navegador);
  leitor de tela de verdade e iPhone físico (só o axe e o WebKit do Playwright). O cookie `Secure` com o prefixo `__Secure-` **está** no e2e, em Chromium e em WebKit, atrás do Front Door imitado em https com certificado autoassinado; o que isso não prova é a cadeia de confiança do certificado do Front Door de verdade (o smoke pós-deploy roda sem `ignoreHTTPSErrors`).
- **Rotas do Better Auth abertas só quando uma tela as pedir** (seção 1): `change-password`, `update-user`, `list-sessions`, `revoke-*`, `link-social`. Abra uma a uma, na lista do teste (`OPEN`) e fora de `CLOSED_PATHS`,
  **com limite próprio** e a validação que faltar: o `change-password` com `revokeOtherSessions: true`; o `update-user` só com teto de nome e sem `image` (hoje o hook zera a imagem, mas o nome não tem validação fora do cadastro).
- **Não verificado na Azure**: (a) se o Front Door põe o `X-Azure-SocketIP` na origem e se sobrescreve o que o cliente mandar (a api o usa como IP atrás do Front Door; sem IP confiável o Better Auth junta todos os pedidos de uma réplica num balde por caminho, e o limite de
  3 logins por 10 s viraria global); (b) o envio real pelo Communication Services e a entrega na caixa de entrada; (c) o login real com o Google; (d) o cookie `__Secure-alvesting.session_token` com o certificado e o Front Door de verdade e num iPhone físico (o e2e o exercita atrás de um Front Door imitado em https, em Chromium e em WebKit, e a página da conta o lê pelo servidor; o primeiro login na Azure é a prova que falta, `docs/DEPLOY.md`, seção 4, passo 8);
  (e) que o Front Door repassa o `Content-Length` do cliente nos POST de `/api/auth/*` (o teto do corpo recusa o corpo sem tamanho declarado, `Transfer-Encoding`, com 413; se a borda passar a fragmentar o corpo, o login
  inteiro quebra e a saída é contar os bytes na leitura: comentário `ponytail` em `auth-route.ts`); (f) a cota de e-mail da assinatura (seção 6).
- **Limites conhecidos**: o limitador de tentativas, o freio da exclusão e o intervalo mínimo entre e-mails ficam na memória de cada réplica (o WAF, 30 por minuto por IP em `/api/auth/*`, é o limite de verdade); cadastro nunca verificado
  guarda o e-mail até a limpeza diária da fila `maintenance`, em até 7 dias depois de criado (seção 5); sem ligação automática entre conta de senha e conta Google com o mesmo e-mail (decisão
  contra o sequestro de cadastro, ADR 0024); sem troca de e-mail e sem 2FA; **pré-sequestro por cadastro com o e-mail de outra pessoa**: quem cadastra primeiro o e-mail da vítima (sem nunca o verificar) guarda a senha dele, e se a vítima clicar no link
  de verificação que não pediu, a senha de quem cadastrou primeiro passa a valer (o texto do e-mail diz "se você não criou uma conta, ignore"; a mitigação de verdade, invalidar as credenciais ao verificar
  ou pedir a senha no próprio link, é decisão de produto e não está feita); **sem aviso ao dono do e-mail** quando alguém tenta se cadastrar com ele (o Better Auth tem o gancho `onExistingUserSignUp`; usá-lo manda e-mail
  a partir de um pedido anônimo e disputa a cota, então espera a decisão do domínio de e-mail); **a política de senha é só o tamanho** (10 a 128 caracteres: `1234567890` e a senha igual ao e-mail passam, sem lista de senhas
  comuns), com o scrypt padrão do Better Auth (N=2^14, r=16; abaixo do mínimo da OWASP, escolha consciente para 0,25 vCPU: medir na réplica antes de mudar); sem bloqueio por conta (só por IP).
  **O pré-sequestro e a carteira (etapa 12, reavaliado na revisão do fechamento)**: a conta agora guarda uma carteira, e a pergunta é se quem cadastrou primeiro o e-mail da vítima chega a ela. **Não chega, enquanto quatro ajustes valerem, e todos estão presos em teste**: (1) o clique no link de verificação **não abre sessão**
  (`autoSignInAfterVerification: false`; o `auth-flows.integration.spec.ts` confere que a resposta do clique não traz cookie e que não há sessão); (2) o Google **não se liga sozinho** a uma conta de senha com o mesmo e-mail (`disableImplicitLinking`: `account_not_linked`, mesmo spec); (3) a **redefinição de senha** troca o hash, consome o token e revoga todas as
  sessões numa transação só (`revokeSessionsOnPasswordReset` e o `resetCredentialPassword` do Better Auth 1.7.15: a senha de quem cadastrou primeiro deixa de valer e a sessão dele cai; o spec confere); (4) `change-email`, `update-user` e `link-social` estão **fechados** (`CLOSED_PATHS`, e o spec reprova rota nova que nasça aberta). A senha do atacante só vale entre o clique da vítima e a redefinição, e nesse intervalo a vítima, sem
  sessão, não consegue lançar nada. O **resíduo é a conta ocupada**: o atacante guarda uma conta verificada com o e-mail da vítima, que só a recupera pela redefinição de senha, sem dado dela. O risco de verdade é alguém desligar um desses ajustes sem perceber, e por isso os testes os prendem. A mitigação de verdade (invalidar a senha e as sessões criadas antes da verificação,
  ou pedir a senha no próprio link) segue **decisão de produto, não tomada nem feita**: o plano não a fecha e o padrão recomendado não existe. Está como item do checklist do `docs/PLANO.md`, §5.16, para o Artur decidir antes do primeiro deploy público.
- **Limites das telas** (revisão do fechamento da parte 2, adiados de propósito): (a) **sem aviso enquanto o formulário hidrata**: com o JavaScript lento, bloqueado ou com erro, a pessoa vê um formulário quase normal (os campos desativados têm só a borda cinza) que ignora o toque e não diz por quê; o `<noscript>` cobre só o JavaScript desligado. A saída é uma linha
  "Carregando o formulário…" enquanto `!hydrated`, e pede uma decisão de layout (reservar a altura da linha, que fica em branco depois, ou deixar o conteúdo abaixo subir uma vez) e que a linha não apareça junto do aviso do `<noscript>`; (b) a URL da redefinição de senha mantém o `?token=` na barra de endereço enquanto a página está aberta (a saída da tela troca a entrada do histórico,
  mas um link aberto e abandonado segue visível); tirá-lo com `history.replaceState` faria o recarregar da página cair em "link incompleto" (o link do e-mail serve de novo); (c) o lint do site liga só 6 das regras do `jsx-a11y` (as do `eslint-config-next`, em aviso), e as demais do conjunto `recommended` (rótulo ligado ao campo, `autocomplete` válido, `autoFocus`)
  só o axe do e2e cobre; ligá-las em erro é uma mudança em `apps/web/eslint.config.mjs`, que o hook `config-protection` do ecc bloqueia, e fica para quem puder desligá-lo; (d) o e2e não envelhece a sessão (o `REAUTH_REQUIRED` da tela é respondido no navegador; o da api, no `me.integration.spec.ts`) e não compara capturas de tela (a linha de base de um Mac não vale no Linux do CI).
- **Papel do Postgres da api** (etapa 10, onda 3d; ADR 0028): a api roda com o login `alvesting_api`, membro de um papel de grupo sem login (`alvesting_api_group`) que a migration `20261103100000_api_role` cria e preenche **só com o
  que a api usa**, tabela por tabela, conferido no código. Na conta: `SELECT`, `INSERT`, `UPDATE` e `DELETE` em `user`, `session` e `account`; `SELECT`, `INSERT` e `DELETE` em `verification` (o Better Auth sem plugin só cria, procura e consome o pedido de uso único; o `UPDATE` é dos plugins email-otp e siwe, que não estão ligados, e a migration `20261103110000_api_role_least_privilege` o revoga); só `SELECT` e `INSERT` em `consent`; só `INSERT` em
  `audit_log`; e `SELECT` no resto que ela lê. Pela carteira (etapa 12, migration `20261103130000_portfolio`, ADR 0031): `SELECT` e `INSERT` em `portfolio` (a linha nunca muda e a cascata do usuário a apaga como dono da tabela) e `SELECT`, `INSERT` e `DELETE` em `portfolio_lot`, com `UPDATE` só nas colunas
  `ticker`, `quantity`, `cost_cents`, `bought_on` e `updated_at` e o gatilho `portfolio_lot_api_guard` (200 lançamentos por carteira, sob trava). Pelas rotas `/admin`: `INSERT`/`UPDATE` em `season`, `cycle` e `corporate_event`, `INSERT`/`DELETE` em `competitor`, `INSERT` de `id`, `version` e `created_at` em `prompt_version` (o SHA-256 do texto é do job de decisões) e `UPDATE` em `job_run` (reabrir a
  `settle`); o ESTADO em que ela escreve nessas quatro tabelas é de gatilhos `*_api_guard` (migration `20261103120000_api_role_guards`, `docs/API.md`, seção 8). **Nada nas tabelas de resultado da arena** (o evento corporativo agora enfileira a liquidação). Sem `ALTER DEFAULT PRIVILEGES`: a tabela nova é classificada à mão
  (`apps/api/src/infrastructure/database/table-policy.ts`), e o `api-role.integration.spec.ts` compara o catálogo com a matriz.
  **A exclusão da conta não pede `DELETE` em `consent`**: a cascata do `DELETE` do usuário é um gatilho de integridade referencial, que o Postgres executa com os privilégios do **dono da tabela** que ele consulta
  (`ri_triggers.c`: "we'll do the check as that table's owner"); o teste prova que o `DELETE` do usuário leva sessão, conta e aceite, e que o `DELETE` direto em `consent` é recusado (`42501`). O banco também recusa
  a remoção de gatilho, a mudança, o esvaziamento e a criação de tabela, o `DELETE` em `audit_log` e o `SET ROLE` para o administrador.
  O login e a senha NÃO estão na migration: o comando `pnpm --filter @alvesting/api db:roles` (idempotente, com o login administrador, depois do `migrate deploy`) lê a senha da `API_DATABASE_URL` e a grava como resumo
  SCRAM. O `statement_timeout` do papel é de 10 s (os workers: 60 s) e, em produção, o `CONNECTION LIMIT` é 24 (5 réplicas × 4 do pool, com folga; o papel comum não o tira). Em dev e no e2e a api roda com este login (`API_DATABASE_URL` no `.env.example`); o semear e o `account:promote` seguem com o administrador.
  Workers, decisões e agendadores seguem com o administrador nesta onda (`ponytail` em `table-policy.ts`: um segundo papel, de escrita sem DDL, é o próximo passo).
