# Guia do código

Para quem vai contribuir com a Alvesting e para o Artur na prova de autoria (até 30/11/2026). É um mapa do código como ele está em
06/11/2026, sobre o commit `c9ca348`. O que a onda "Temporada 1 real" está mudando agora (o modo retroativo e o operador local, da T0; a
documentação do Playbook, a cobertura travada e o SonarCloud, da T2) vem marcado **em construção**, descrito pelo que foi pedido, e o
fechamento da onda atualiza essas partes.

**Como ler as referências.** Uma referência ao código é um trecho de código com o caminho e o símbolo separados por `#`, como
`apps/api/src/main.ts#bootstrap`: o caminho a partir da raiz do repositório e o nome (função, classe, constante) ou um trecho de texto
que aparece no arquivo. Abra o arquivo (no VS Code, Cmd+P e o caminho) e procure o símbolo (Cmd+F). O `node scripts/guia-check.mjs`
confere todas as referências deste guia: se um arquivo some ou um símbolo muda de nome, ele falha e diz a linha. Ele confere que o texto
existe, não que a frase sobre ele continua certa: isso é da revisão de quem muda o código.

**Sumário.** [1. Mapa de 10 minutos](#1-mapa-de-10-minutos) ·
[2. Uma requisição de ponta a ponta](#2-uma-requisição-de-ponta-a-ponta) ·
[3. As 25 perguntas da prova de autoria](#3-as-25-perguntas-da-prova-de-autoria) ·
[4. Como rodar do zero](#4-como-rodar-do-zero) ·
[5. Ensaio de mudança ao vivo](#5-ensaio-de-mudança-ao-vivo-um-campo-de-observação-no-lançamento) ·
[6. Os bugs mais difíceis](#6-os-bugs-mais-difíceis) ·
[7. O que ainda não rodou de verdade](#7-o-que-ainda-não-rodou-de-verdade) ·
[8. O histórico e o processo](#8-o-histórico-e-o-processo)

---

## 1. Mapa de 10 minutos

Um monorepo pnpm 12 + Turborepo, todo em TypeScript: dois apps (a api e o site), dois pacotes (os contratos e a configuração), a infra
da Azure em Bicep e os documentos. A api é **uma imagem com quatro papéis**: o HTTP, o worker das filas, o job de decisões e os
agendadores.

| Onde | O que é | Comece por |
|---|---|---|
| `apps/api` | Back-end em NestJS 12 (Node 26.13) | `apps/api/src/main.ts#bootstrap` (o HTTP) e `apps/api/src/role.ts#runRole` (os outros três papéis) |
| `apps/api/src/modules` | Um módulo por assunto, cada um em `application`, `domain`, `infrastructure` e `presentation` | a tabela abaixo |
| `apps/api/src/common` | O que toda rota usa: envelope, filtro de erros, validação Zod, trava de origem, ULID, log e trilha de auditoria | `apps/api/src/configure-app.ts#configureApp` |
| `apps/api/src/config` | O ambiente, validado por Zod na subida, e o `Secret` que esconde segredo de log | `apps/api/src/config/env.ts#envSchema` |
| `apps/api/src/infrastructure` | Prisma, o papel mínimo do Postgres, Blob e o `/health` | `apps/api/src/infrastructure/database/prisma.service.ts#PrismaService` |
| `apps/api/src/telemetry` | OpenTelemetry para o Application Insights, por lista branca | `apps/api/src/telemetry/sanitize.ts#sanitizeSpan` |
| `apps/api/src/ensaio` | A Temporada 0 na máquina: a arena inteira com fakes e relógio simulado, sem rede | `apps/api/src/ensaio/world.ts#createWorld` |
| `apps/api/src/*-cli.ts` | Os comandos de linha (`market:backfill`, `season:create`, `account:promote`...), um script cada no `package.json` | `apps/api/package.json#"account:promote"` |
| `apps/api/prisma` | O schema e as 22 migrations | `apps/api/prisma/schema.prisma#model Season` |
| `apps/api/seasons` | O arquivo da temporada (elenco e parâmetros) | o rascunho de hoje; **em construção (T0)**: `temporada-1.json` |
| `apps/web` | Site em Next 16.4 (App Router), React 19.3 e Tailwind 4 | `apps/web/src/app/layout.tsx#RootLayout` e `apps/web/src/proxy.ts#proxy` |
| `apps/web/src/app` | As telas, em grupos de rota que não mudam o endereço | a tabela das telas |
| `apps/web/src/components` | As peças da tela; as copiadas da Arc, da beUI e da ReUI (MIT) ficam em pastas próprias, com o `LICENSE` | `apps/web/src/components/ui.tsx#BUTTON` |
| `apps/web/src/lib` | O cliente de dados do servidor (`api.ts`), o que o navegador manda (`*-client.ts`), formatação e gráficos | `apps/web/src/lib/api.ts#reader` |
| `apps/web/e2e` | Playwright em seis projetos (três claros, que rodam tudo, e três escuros, que rodam o `@tema`) | `apps/web/playwright.config.ts#pixel-7` |
| `packages/contracts` | Zod 4: o contrato entre a api, o site e as filas | `packages/contracts/src/envelope.ts#envelopeSchema` |
| `packages/config` | tsconfig, ESLint e Prettier compartilhados | `packages/config/prettier.mjs#printWidth` |
| `infra` | A Azure em Bicep; o `check.mjs` confere tudo sem assinatura | `infra/main.bicep#module` e `infra/tests/check.mjs#NEVER_CACHED` |
| `scripts` | `docs-check`, `guia-check`, o deploy blue/green, o Lighthouse e a sonda de SSE, cada um com teste | `scripts/deploy.mjs#export async function main` |
| `.github` | CI, deploy e o template de PR | `.github/workflows/ci.yml#name: CI` |
| `docs` | O plano, um documento por assunto e os ADRs (uma decisão por arquivo) | [PLANO.md](PLANO.md) e [adr/](adr/) |

**Os módulos da api** (`apps/api/src/modules`):

| Módulo | O que faz | Quem o carrega |
|---|---|---|
| `market-data` | Cotações da brapi (a fonte única, com o banco como cache), calendário de pregões, universo da semana e logos | worker (`eod`, `universe`) e comandos |
| `news` | RSS dos portais, fatos relevantes da CVM e o macro do BCB | worker (`fetch`) |
| `briefing` | Congela às 07:30 a entrada que todos os modelos recebem, com SHA-256 | worker (`freeze`) |
| `arena` | Temporada, o ciclo das 08:00, a decisão de cada modelo e o gateway de LLM | agendador (`cycle`), job de decisões e a leitura do ciclo na api |
| `settlement` | A liquidação (refeita do zero), o CDI, o Sorteio, as referências, o Monte Carlo e as métricas | worker (`settle`) |
| `messaging` | Service Bus: publicar, consumir, a nova tentativa agendada, a DLQ e o `job_run` | todos |
| `public` | A API pública da arena (só GET, com cache) | api |
| `quotes` | As rotas internas de cotação para o site, com segredo | api |
| `account` | Login (Better Auth), sessão, aceite dos termos, exportar e excluir a conta | api |
| `admin` | As rotas do painel e a trilha de auditoria | api |
| `portfolio` | A carteira do usuário | api |
| `maintenance` | A limpeza diária dos dados pessoais e a conferência mensal do backup | worker |

**As telas** (`apps/web/src/app`; os parênteses são grupos de rota e não aparecem no endereço):

| Endereço | Grupo | De onde lê |
|---|---|---|
| `/` (a landing) | `(site)` | `apps/web/src/app/(site)/page.tsx#api.arenaCurrent()` e a fita, de rota interna |
| `/como-funciona`, `/termos`, `/privacidade` | `(site)` | os textos legais da api |
| `/arena`, `/ranking`, `/modelos/[slug]`, `/ciclos/[data]` | `(app)/(arena)` | a API pública (e a `/arena`, as barras do BOVA11, de rota interna) |
| `/explorar`, `/acoes`, `/acoes/[ticker]`, `/noticias` | `(app)/(explorar)` | a API pública e as barras, de rota interna |
| `/carteira` | `(app)/(carteira)` | `/api/v1/me/portfolio`, com o cookie da sessão |
| `/conta`, `/admin` | `(app)/(conta)` | `/api/v1/me` e `/api/v1/admin/*` |
| `/chat` | `(app)/(chat)` | nada: desligado até o aval do orientador |
| `/entrar`, `/cadastro`, `/esqueci-senha`, `/redefinir-senha`, `/verificar-email` | `(auth)`, na casca do app | o Better Auth (`/api/auth/*`) |
| `/health`, `/interno/revalidar`, `/logos/[arquivo]` | rotas de API do Next | — |

---

## 2. Uma requisição de ponta a ponta

### 2.1 Lançar uma compra na carteira, do toque até o banco e de volta

A tela da carteira é a melhor para seguir, porque passa por todas as camadas: página do servidor, formulário no navegador, trava de
origem, sessão, aceite, validação, serviço, repositório, Prisma e Postgres.

**A página nasce no servidor.**

1. `apps/web/src/app/(app)/(carteira)/carteira/page.tsx#WalletPage`: a página é um Server Component embrulhado em `withApiDown`. Lê o
   cookie da requisição (`apps/web/src/lib/account.ts#authCookieHeader`, que separa só os cookies da sessão: os outros não vão à api);
   sem ele, `redirect` para a entrada, sem nem chamar a api.
2. `apps/web/src/lib/wallet.ts#readPortfolio` chama `apps/web/src/lib/api.ts#apiGetFresh`: leitura sem o cache de dados do Next
   (`cache: 'no-store'`), porque é dado de uma pessoa.
3. `apps/web/src/lib/api.ts#export async function call`: o `fetch` do servidor vai ao endereço interno da api (`API_INTERNAL_URL`), com o
   `X-Azure-FDID` (a api tem a trava de origem) e o cookie, prazo de 10 s e `redirect: 'error'`. A resposta é validada pelo **mesmo schema**
   que a api usou para montá-la (`envelopeSchema(portfolioSchema)`); fora do contrato vira `ApiError` 502.
4. Se a api respondeu 401, a página manda para a entrada; 403 `CONSENT_REQUIRED`, para a conta aceitar os termos novos; outro erro vira a
   tela "a arena não respondeu" (`apps/web/src/lib/with-api-down.tsx#withApiDown`). Ao navegador vai só o que a tela usa de cada
   lançamento (`apps/web/src/app/(app)/(carteira)/carteira/page.tsx#lotView`).

**O toque em "Lançar compra".**

5. `apps/web/src/components/wallet-lots.tsx#export function BotaoLancar` abre o modal (o `<dialog>` com `showModal()`, em
   `apps/web/src/components/wallet-lots.tsx#const openDialog`), e o envio é do `apps/web/src/components/wallet-lots.tsx#function LotForm`:
   é a única parte da tela que roda no navegador (`'use client'`). O `run` lê o formulário (a quantidade e a data vão em campos escondidos,
   ao lado das peças da Arc; o valor, no texto que o campo de dinheiro mostra, com os centavos entrando pela direita) e confere com
   `apps/web/src/lib/wallet-client.ts#checkLot`, a **mesma regra de dinheiro da api**, importada pelo subcaminho sem zod
   (`@alvesting/contracts/portfolio-rules`): "35,50" vira 3.550 centavos nos dois lados.
6. `apps/web/src/lib/account-client.ts#export async function send`: `fetch('/api/v1/me/portfolio/lots')` na **mesma origem**, com
   `credentials: 'same-origin'`; o cookie (HttpOnly, SameSite=Lax) e o `Origin` vão sozinhos. Prazo de 15 s; sem rede vira status 0.
7. Quem leva `/api/*` para a api: no perfil econômico (a produção, ADR 0039) e em dev, o próprio site
   (`apps/web/src/lib/api-proxy.ts#export function forwardToApi`, chamado pelo `apps/web/src/proxy.ts#export function proxy` com
   `API_PROXY=on`, que o dev liga em `apps/web/next.config.ts#API_PROXY`); no padrão, a rota do Front Door
   (`infra/modules/frontdoor.bicep#patternsToMatch: ['/api/*']`), que também anexa o `X-Azure-FDID`.

**Na api, antes do Nest.** Tudo em `apps/api/src/configure-app.ts#configureApp`, nesta ordem:

8. `helmet` (cabeçalhos de segurança), `noStoreByDefault` (toda resposta sai `no-store`, a não ser que a rota diga outra coisa) e
   `apps/api/src/common/origin-lock.ts#originLock`: com `FRONT_DOOR_ID` no ambiente, quem não traz o `X-Azure-FDID` certo leva 403. A
   única exceção é `GET`/`HEAD` no caminho exato do `/health` ([ADR 0018](adr/0018-trava-de-origem-health-unica-excecao.md)).
9. Prefixo `/api/v1`, o filtro de erros e o interceptor do envelope, globais; o Better Auth fica montado à parte em `/api/auth/*`.

**No Nest.**

10. Guards da classe, nesta ordem (`apps/api/src/modules/portfolio/presentation/portfolio.controller.ts#@UseGuards(SessionGuard, ConsentGuard)`):
    `apps/api/src/modules/account/presentation/session.guard.ts#SessionGuard` (mutação sem o `Origin` do site é 403; a sessão vem do
    cookie pelo Better Auth; o usuário é conferido no banco e vira `req.account`) e
    `apps/api/src/modules/account/presentation/consent.guard.ts#ConsentGuard` (aceite vencido: 403 `CONSENT_REQUIRED`).
11. O corpo passa por `apps/api/src/common/zod-validation.pipe.ts#ZodValidationPipe` com
    `packages/contracts/src/portfolio.ts#lotBodySchema`: objeto estrito (campo a mais é 400) que já transforma "quantidade e valor" em
    custo total (`lotCostCents`).
12. O controller (`apps/api/src/modules/portfolio/presentation/portfolio.controller.ts#req.account!.userId`) passa ao serviço o **ULID da
    sessão**, nunca um id que veio da requisição.
13. O serviço (`apps/api/src/modules/portfolio/application/portfolio.service.ts#async add(`) confere o que o contrato não sabe (o ticker
    existe em `instrument` e a data não é futura em Brasília) e traduz o teto de 200 lançamentos em 409 `LOT_LIMIT`.
14. O repositório (`apps/api/src/modules/portfolio/infrastructure/portfolio.repository.ts#async add(`) abre uma transação, trava o dono
    (`pg_advisory_xact_lock`), cria a carteira se for o primeiro lançamento, conta, e grava com um ULID
    (`apps/api/src/common/id.ts#newId`). As colunas são listadas (`LOT_SELECT`), nunca `select *`.
15. O Prisma (`apps/api/src/infrastructure/database/prisma.service.ts#PrismaService`, pelo adaptador `pg`, pool de 4 conexões) leva ao
    Postgres 17, logado como `alvesting_api`, um login que só tem os privilégios da matriz
    (`apps/api/src/infrastructure/database/table-policy.ts#portfolio_lot`). O banco ainda confere: `CHECK` de quantidade e de custo e o
    gatilho que limita a carteira a 200 lançamentos sob trava
    (`apps/api/prisma/migrations/20261103130000_portfolio/migration.sql#portfolio_lot_api_guard`).

**E de volta.**

16. O serviço valida a saída com `lotSchema` (`apps/api/src/modules/portfolio/application/portfolio.service.ts#const toLot`), e o
    `apps/api/src/common/envelope.interceptor.ts#EnvelopeInterceptor` embrulha em `{ success: true, data, error: null }`. Erro passa
    pelo `apps/api/src/common/all-exceptions.filter.ts#AllExceptionsFilter`: 400 `VALIDATION_ERROR` com o caminho de cada campo, 409, 500
    genérico (o detalhe só vai ao log), sempre `no-store`.
17. A linha do log da requisição é uma lista branca (`apps/api/src/common/http-log.ts#httpLogOptions`): id, método, caminho sem a query,
    user-agent e status. Cabeçalho, query, cookie e IP não entram.
18. No navegador, o `send` devolve um `Reply`. Deu certo: `router.refresh()` pede ao servidor a página de novo (os passos 1 a 4), com o
    resumo e as posições recalculados, e um aviso diz o que aconteceu
    (`apps/web/src/components/wallet-lots.tsx#function done`). Deu errado: `apps/web/src/lib/wallet-client.ts#lotFailure` põe a frase em
    português **no campo** que a api apontou, sem repetir a mensagem da api.

### 2.2 O ciclo diário da arena

O trabalho pesado não passa pelo HTTP. Os agendadores só publicam mensagens; os workers as consomem
([ADR 0007](adr/0007-agendador-so-publica.md)). As horas são de Brasília; os crons estão em
`infra/modules/containerapps.bicep#{ name: 'cycle', cron: '0 11 * * 1-5' }` (UTC) e na tabela de [JOBS.md](JOBS.md), seção 1.

| Hora | O que acontece | Onde |
|---|---|---|
| a cada 30 min | Cada fonte de notícia vira uma mensagem `fetch`; o worker grava `news_item` e `macro_daily` | `apps/api/src/modules/news/application/fetch.handler.ts#FetchHandler` |
| 07:30 | O `freeze` congela o briefing do pregão: os bytes no Blob (`briefings/<pregão>/<sha256>.json`) e a linha `briefing` | `apps/api/src/modules/briefing/application/freeze.handler.ts#FreezeHandler` |
| 08:00 | O agendador do ciclo abre o ciclo e publica uma `decide` por modelo | `apps/api/src/modules/arena/application/cycle-schedulers.ts#async cycle(now: Date)` |
| 08:00 a 09:30 | Uma execução do job de decisões por mensagem: o modelo decide | `apps/api/src/modules/arena/application/decide.handler.ts#DecideHandler` |
| 09:30 | Prazo: quem não respondeu fica em HOLD | `apps/api/src/modules/arena/application/cycle-closer.ts#CycleCloser` |
| 10:00 | Abertura da B3: o preço oficial de abertura é o preço de execução | `apps/api/src/modules/settlement/domain/portfolio.ts#executeSession` |
| 21:30 | O `eod` pede à brapi as barras que faltam e publica a liquidação | `apps/api/src/modules/market-data/application/eod.handler.ts#EodHandler` |
| depois | O `settle` refaz a temporada do zero, rende o CDI, roda o Monte Carlo e revalida o site | `apps/api/src/modules/settlement/application/settle.handler.ts#SettleHandler` |

Os saltos, em ordem:

1. **Agendador.** O job do Container Apps roda `node dist/schedule.js cycle`: `apps/api/src/schedule.ts#exitAfter` →
   `apps/api/src/role.ts#runScheduler`, que acha o nome na tabela `schedulers` (nome desconhecido falha, em vez de sair com 0).
2. **Abrir o ciclo.** `apps/api/src/modules/arena/application/cycle-schedulers.ts#CycleSchedulers`: é pregão? Fecha antes os ciclos
   vencidos (`closeOverdue`). Para cada temporada em andamento: há briefing? O teto de custo do mês permite (`overBudget`, fail closed sem
   teto)? Grava o ciclo `OPEN` ou `SKIPPED` com o motivo (`upsertCycle`) e publica uma `decide {ciclo, competidor}` por modelo.
3. **Fila.** `apps/api/src/modules/messaging/infrastructure/messaging.service.ts#MessagingService` publica com `MessageId`
   determinístico (repetir é seguro). Cada fila tem entregas, trava e espera próprias em
   `packages/contracts/src/messages.ts#QUEUES`. Quem recebe passa pelo
   `apps/api/src/modules/messaging/application/handle-delivery.ts#handleDelivery`: corpo inválido ou de outra fila vai para a DLQ na hora;
   o handler que falha ganha uma **cópia agendada** (`retryLater`, [ADR 0015](adr/0015-nova-tentativa-agendada-nao-abandono-imediato.md)).
4. **Decidir.** O `job-worker-decisions` sobe por mensagem (KEDA), roda `apps/api/src/role.ts#runDecide` e entrega a mensagem ao
   `apps/api/src/modules/arena/application/decide.handler.ts#async execute(`. Os passos, todos no mesmo arquivo:
   - a linha de `job_run` barra a mensagem repetida (`apps/api/src/modules/messaging/infrastructure/job-run.store.ts#async claim(`);
   - depois das 09:30 o modelo não é chamado (HOLD `prazo`);
   - o prompt tem de ser o fixado no ciclo, pela versão e pelo SHA-256
     (`apps/api/src/modules/arena/infrastructure/arena.repository.ts#registerPromptSha256`), e ter a linha de canário
     (`apps/api/src/modules/arena/domain/leak-filter.ts#hasCanary`); senão, HOLD `prompt_divergente`;
   - o briefing lido do Blob tem de bater com o SHA-256 da linha;
   - a parte própria do modelo (caixa, posições e barras de 30 pregões delas):
     `apps/api/src/modules/arena/domain/own-part.ts#buildOwnPart`;
   - a chamada: `apps/api/src/modules/arena/infrastructure/llm-gateway.ts#buildRequestBody` (JSON Schema na resposta e, no OpenRouter,
     só provedores que aceitam todos os parâmetros e não guardam os dados) e `LlmGateway`;
   - a validação: `packages/contracts/src/llm-decision.ts#parseLlmDecision` (o formato) com **um reparo**
     (`apps/api/src/modules/arena/domain/llm-messages.ts#repairMessage`), depois as regras que dependem do universo e da carteira
     (`apps/api/src/modules/arena/domain/decision-validation.ts#validateSemantics`, por `buildDecisionItems`), item a item
     ([ADR 0016](adr/0016-itens-da-resposta-do-modelo-validados-um-a-um.md));
   - o filtro de vazamento do prompt (`apps/api/src/modules/arena/domain/leak-filter.ts#createLeakFilter`), o IO bruto no Blob
     (`apps/api/src/modules/arena/infrastructure/llm-io.archive.ts#LlmIoArchive`) e a decisão no banco;
   - na última entrega, a falha vira HOLD `falha` registrado, e não DLQ
     ([ADR 0021](adr/0021-dlq-vira-hold-pelo-handler-na-ultima-entrega.md)).
5. **Barras.** Às 21:30, `apps/api/src/modules/market-data/application/eod.handler.ts#EodHandler` pede à brapi, um papel por vez
   (`apps/api/src/modules/market-data/infrastructure/brapi.client.ts#BrapiClient`), só as barras que o banco não tem, e publica o
   `settle` (`apps/api/src/modules/settlement/application/settlement-publisher.ts#afterEod`).
6. **Liquidar.** `apps/api/src/modules/settlement/application/settle.handler.ts#SettleHandler` refaz a temporada do primeiro pregão até o
   último conhecido, numa transação com trava por temporada
   ([ADR 0022](adr/0022-liquidacao-refeita-do-zero-com-trava-por-temporada.md)): `apps/api/src/modules/settlement/application/settlement-plan.ts#buildPlan`,
   `apps/api/src/modules/settlement/domain/simulation.ts#simulateSeason` (que usa o `executeSession` de cada pregão e o
   `markToMarket`), o CDI (`apps/api/src/modules/settlement/domain/cdi.ts#interest`), o Monte Carlo
   (`apps/api/src/modules/settlement/domain/monte-carlo.ts#MONTE_CARLO_RUNS`) e as métricas
   (`apps/api/src/modules/settlement/domain/season-stats.ts#seasonStats`).
7. **Mostrar.** Concluída a liquidação, `apps/api/src/modules/settlement/application/cache-refresher.ts#afterSettle` pede ao site a
   revalidação (`apps/web/src/app/interno/revalidar/route.ts#POST`, com o segredo) e limpa o cache do Front Door. O site lê pela API
   pública (`apps/api/src/modules/public/presentation/public.controller.ts#PublicController`) com as tags de cache.

**Em construção (T0): a variante de hoje, até a Azure.** A assinatura de estudante e o repositório público ainda não existem. A T0
está construindo: o `cycle.mode` (`RETROATIVO` ou `AO_VIVO`) e o `cycle.executed_at` (a hora real em que o ciclo rodou); o
`arena:retroativo`, que repete os pregões passados da Temporada 1 (de 13/10/2026) vendo só o que o pipeline ao vivo teria visto às 07:30
de cada pregão; e o `arena:operar`, um operador local no Mac que roda a mesma agenda de produção com o relógio real e um barramento em
processo, e que nunca abre um ciclo "ao vivo" atrasado. O ensaio já é o mesmo motor com fakes: `apps/api/src/ensaio/world.ts#createWorld`
liga os handlers de verdade a um barramento em processo (`apps/api/src/ensaio/bus.ts`).

---

## 3. As 25 perguntas da prova de autoria

As perguntas são as do [guia de preparação do Playbook](https://github.com/CatolicaSC-Portfolio/The-Portfolio-Playbook/blob/main/documentation/guia-prova-de-autoria.md),
na mesma ordem. Cada uma tem a resposta curta, onde está no código e o que um professor perguntaria a mais.

### Arquitetura e decisões

#### 1. Desenhe a arquitetura: quais componentes existem e por onde passa uma requisição?

**Resposta.** Na Azure (o desenho; ainda não está no ar, seção 7): o **Front Door** na borda (TLS, WAF, cache, `/api/*` para a api e o
resto para o site); no **Container Apps**, o site (`ca-web`), a api (`ca-api`), o worker das filas leves (`ca-worker-data`), o job de
decisões (`job-worker-decisions`, um por mensagem), os sete agendadores (`job-sched-*`) e o job das migrations (`job-migrate`); o
**PostgreSQL Flexible** privado; o **Service Bus** com seis filas e DLQ; o **Blob** (briefings, IO bruto das LLMs, backups); o **Key
Vault** com os segredos; e o **Application Insights**. Uma requisição do usuário: navegador → Front Door → site (SSR) → api → Postgres, e
de volta (seção 2.1). O trabalho da arena: agendador → fila → worker → Postgres e Blob (seção 2.2).

**No código.**
- `infra/main.bicep#module` liga os módulos; `infra/modules/containerapps.bicep#'ca-worker-data'` cria os apps e os jobs;
  `infra/modules/frontdoor.bicep#patternsToMatch` tem as rotas da borda.
- `apps/api/src/role.ts#export const queueHandlers` diz que fila cada handler consome.

**Por quê? E se…?**
- *Por que uma imagem só para quatro papéis?* O código é o mesmo, e quem escolhe o papel é o comando do contêiner
  (`apps/api/src/role.ts#const MODULES`). Uma imagem a construir, testar e publicar.
- *Por que dois workers, e não um por fila?* As filas leves cabem numa réplica; as decisões rodam em job por evento, para isolar cada
  modelo ([ADR 0006](adr/0006-dois-workers-nao-um-por-fila.md)).
- O diagrama C4 (contexto, contêineres e módulos) e os diagramas de sequência: **em construção (T2)**, em `docs/ARQUITETURA.md`.

#### 2. Por que essa stack? Qual alternativa foi descartada e por quê?

**Resposta.** TypeScript de ponta a ponta: Node 26 com NestJS 12 na api, Next 16.4 com React 19.3 no site, PostgreSQL 17 com Prisma 7 e
Zod 4 nos contratos. Uma linguagem só deixa o **mesmo contrato** valer na api, no site e nas filas (`packages/contracts`). O Nest dá
módulos e injeção de dependência (cada peça é testável trocando a dependência por um fake); o Next dá a renderização no servidor, boa para
o celular e para quem não roda JavaScript; o Postgres dá transação, trava consultiva, `CHECK` e gatilho, que o projeto usa como última
barreira. A estrutura e as convenções vieram de outro projeto do Artur ([PLANO.md](PLANO.md), seções 0 e 4).

**As alternativas descartadas, com o motivo registrado:**
- BullMQ com Redis e Storage Queue → **Service Bus**: DLQ nativa, mensagem agendada e escala pela fila, sem Redis
  ([ADR 0004](adr/0004-service-bus-nao-storage-queue-nem-bullmq.md)).
- AKS → **Container Apps**: cron, fila e revisões nativos; AKS seria exagero ([ADR 0008](adr/0008-container-apps-nao-aks.md)).
- Terraform → **Bicep**: nativo da Azure, sem arquivo de estado para guardar ([ADR 0012](adr/0012-bicep-nao-terraform.md)).
- Application Gateway e Front Door Premium → **Front Door Standard**: borda global por uns US$ 35; o Premium só traria Private Link e
  regras gerenciadas ([ADR 0002](adr/0002-front-door-standard-nao-application-gateway.md), [ADR 0003](adr/0003-front-door-standard-nao-premium.md)).
- COTAHIST da B3 → **brapi** como fonte única: a B3 veda a coleta automatizada ([ADR 0032](adr/0032-brapi-fonte-unica-das-cotacoes-e-banco-como-cache.md)).
- Node 24 → **Node 26** mantido, com o caminho de volta escrito ([ADR 0013](adr/0013-node-26-lts.md)); TypeScript 6.0, e não 6.1, porque
  o typescript-eslint exige ([ADR 0014](adr/0014-typescript-6-0-x.md)).

**No código.** `package.json#packageManager` (pnpm 12.16.1), `.nvmrc` (26.13.0), `apps/api/src/app.module.ts#AppModule`.

**Por quê? E se…?** *Não há ADR comparando o NestJS com outro framework, nem o Postgres com outro banco*: é a stack que o Artur já
usava em outro projeto, de onde vieram também a estrutura e as convenções. É uma resposta honesta: o plano registra que o escopo já era
grande para uma pessoa só ([PLANO.md](PLANO.md), seção 0.1), e uma stack conhecida tira um risco do caminho.

#### 3. Onde fica o ponto de entrada e o que acontece na inicialização?

**Resposta.** Na api, `apps/api/src/main.ts#bootstrap`:
1. Antes de tudo, o gancho da telemetria entra pelo `--import` do `NODE_OPTIONS` da imagem
   (`apps/api/src/telemetry/preload.ts#APPLICATIONINSIGHTS_CONNECTION_STRING`); sem a connection string, não carrega nada.
2. `useApiLogin` e `requireApiLogin` (`apps/api/src/config/env.ts#export function requireApiLogin`): a api usa o login de menor
   privilégio do Postgres e, em produção, **recusa subir** com o do administrador.
3. `NestFactory.create(AppModule)`: o `ConfigModule` valida o ambiente inteiro com Zod
   (`apps/api/src/config/env.ts#export function parseEnv`): variável inválida derruba a subida, com o nome da variável e nunca o valor.
4. O logger Pino, os ganchos de desligamento e o `configureApp` (seção 2.1, passos 8 e 9), e o `listen` na porta.

Os outros papéis entram por `apps/api/src/worker.ts`, `decide.ts` e `schedule.ts`, que chamam
`apps/api/src/role.ts#export function exitAfter`: um contexto do Nest sem HTTP, com os módulos do papel
(`apps/api/src/roles.module.ts#DecideModule`, que é o único com o prompt e a chave do OpenRouter).

No site: `apps/web/src/instrumentation.ts#register` roda uma vez na subida e confere o contrato da trava de origem
(`apps/web/src/instrumentation-node.ts#checkOriginLockEnv`: `ORIGIN_LOCK=front-door` sem `FRONT_DOOR_ID` sai com código 1);
`apps/web/src/proxy.ts#proxy` roda em toda requisição; `apps/web/src/app/layout.tsx#RootLayout` é a raiz das páginas.

**Por quê? E se…?** *Por que falhar na subida?* Uma configuração errada que deixasse o app de pé com tudo verde seria pior: um
`FRONT_DOOR_ID` perdido desligaria a trava em silêncio, e um segredo trocado poria a api no login de dono das tabelas.

### Configuração e ambiente

#### 4. Onde é feita a configuração de conexão com o banco? O que muda entre dev e produção?

**Resposta.** A URL vem de `DATABASE_URL` (`apps/api/src/config/env.ts#DATABASE_URL`). O `PrismaService` abre o pool com o adaptador `pg`
(`apps/api/src/infrastructure/database/prisma.service.ts#export function poolConfig`): no máximo 4 conexões por processo, prazos de
conexão e de instrução, e para o login da api o `statement_timeout` de 10 s do próprio papel. As migrations usam
`apps/api/prisma.config.ts#defineConfig`, que em dev lê o `.env.local` e o `.env.example` da raiz.

| | Dev | Produção (Azure) |
|---|---|---|
| Banco | o Postgres 17 do `docker compose`, porta 25432, banco `alvesting_dev` | PostgreSQL Flexible B1ms, privado |
| Login da api | `API_DATABASE_URL` (`alvesting_api`), que o `useApiLogin` põe no lugar do `DATABASE_URL` | o segredo `database-url-api` no `DATABASE_URL` do `ca-api` |
| Workers, jobs e migrations | o administrador (`alvesting`) | o segredo `database-url` |
| De onde vem | `.env.example` (e o `.env.local`, fora do git, que vence) | Key Vault, por referência (`infra/modules/containerapps.bicep#database-url-api`) |

**Por quê? E se…?** *E se trocarem os dois segredos por engano?* A api não sobe em produção
(`apps/api/src/config/env.ts#requireApiLogin`). *E se a api for invadida?* O login dela não escreve nos resultados da arena, só acrescenta
na trilha de auditoria, e onde ela escreve um gatilho limita o estado
([ADR 0028](adr/0028-papel-minimo-do-postgres-da-api-e-backup-sem-dado-pessoal.md)).

#### 5. Quais variáveis de ambiente o projeto precisa? Onde são lidas e onde ficam em produção?

**Resposta.** A lista inteira, com o que cada uma faz, está no `.env.example` da raiz. Na api, todas passam por um schema Zod só
(`apps/api/src/config/env.ts#envSchema`), lido **uma vez**, na subida, pelo `ConfigModule`, e injetado como `ENV`. Os segredos viram um
`Secret` (`apps/api/src/config/secret.ts#class Secret`), que não aparece em log, JSON nem `inspect`, e saem do `process.env` depois da
leitura (`apps/api/src/config/env.ts#SECRET_VARIABLES`). O site lê poucas: `API_INTERNAL_URL` e `FRONT_DOOR_ID` em
`apps/web/src/lib/api.ts#env.API_INTERNAL_URL`, o `QUOTES_SECRET` só em `apps/web/src/lib/quotes.ts#QUOTES_SECRET` (módulo
`server-only`) e o `REVALIDATE_SECRET` em `apps/web/src/lib/cache.ts#hasValidRevalidateSecret`. Em dev o Next só copia do `.env.local` as
quatro da lista `apps/web/next.config.ts#DEV_ENV_VARIABLES`, para o prompt e a chave do OpenRouter nunca chegarem ao site.

Em produção, os segredos ficam no **Key Vault**, e o Container Apps os lê por referência, com a identidade de cada workload
(`infra/modules/containerapps.bicep#keyVaultUrl`). Quem semeia os que o Artur preenche à mão é `infra/scripts/seed-secrets.sh`.

**Por quê? E se…?** *Por que cada workload tem a própria identidade?* O worker não lê o prompt, e o agendador não lê a chave do
OpenRouter ([ADR 0020](adr/0020-uma-identidade-por-workload-segredo-a-segredo.md)). *E o prompt?* Fica no Key Vault, numa versão fixa
([ADR 0011](adr/0011-prompt-no-key-vault.md)); o repositório pode ser público.

#### 6. Se eu clonar o repositório agora, quais passos preciso seguir?

**Resposta.** Seção 4 deste guia, conferida comando por comando no checkout atual. Em uma linha: `nvm use`, `pnpm install`,
`docker compose up -d` (o Postgres e o Azurite: `docker-compose.yml#POSTGRES_DB: alvesting_dev`), as migrations
(`apps/api/package.json#prisma migrate deploy`), o login da api (`db:roles`) e `pnpm dev` (`package.json#turbo run dev`).

### Dados

#### 7. Quais são as entidades principais e como se relacionam? Onde isso está definido?

**Resposta.** No `apps/api/prisma/schema.prisma`, uma seção por etapa; o SQL de verdade está nas migrations. IDs são ULID gerados na
aplicação (`apps/api/src/common/id.ts#newId`) e dinheiro é centavo em `BigInt`.

- **Arena:** `apps/api/prisma/schema.prisma#model Season` (a temporada) tem muitos `Competitor` (os modelos, o Sorteio e as referências)
  e muitos `Cycle` (um por pregão, `@@unique([seasonId, date])`). Cada ciclo tem uma `Decision` por **modelo**
  (`@@unique([cycleId, competitorId])`), e cada decisão tem os `DecisionItem` (BUY, SELL ou HOLD por ticker). O Sorteio não decide pela
  fila: as escolhas dele são sorteadas na liquidação, com a semente da temporada
  (`apps/api/src/modules/settlement/application/settlement-plan.ts#seed: input.params.randomSeed`).
- **Liquidação:** `Order`, `Fill`, `Position`, `EquitySnapshot`, `SeasonStat` e `RandomBaseline`, todas derivadas e refeitas a cada
  liquidação; `CorporateEvent` (desdobramento, grupamento, bonificação).
- **Mercado e notícias:** `Instrument` (o papel), `DailyBar` (a barra do dia, só inserção), `UniverseSnapshot` e `UniverseMember` (o
  universo da semana), `NewsItem`, `MacroDaily` e `Briefing` (o que foi congelado às 07:30, com o SHA-256).
- **Conta e carteira:** `User` com `Session`, `Account` e `Consent` (o aceite, que não se reescreve), e
  `apps/api/prisma/schema.prisma#model Portfolio` (uma por usuário) com muitos `PortfolioLot`. Tudo do usuário apaga em cascata com ele.
- **Operação:** `JobRun` (uma linha por mensagem processada: é a idempotência das filas) e `AuditLog` (a trilha, só acréscimo).

**Por quê? E se…?** *Por que o ticker do lançamento não é chave estrangeira?* A limpeza de `instrument` não pode travar por causa da
carteira de alguém; a conferência é feita na escrita ([ADR 0031](adr/0031-carteira-tetos-ticker-sem-chave-patch-inteiro-e-arredondamento.md)).

#### 8. Mostre a última migration e explique o que ela faz.

**Resposta.** Hoje é a `20261105120000_instrument_logo`: cria a tabela `instrument_logo`, a cópia própria do SVG do logo de cada papel
que a brapi serve, para o site mostrá-lo do próprio domínio ([ADR 0036](adr/0036-logos-das-acoes-copia-propria-da-brapi.md)). Três
partes: o `CREATE TABLE` e a chave estrangeira em cascata, que saíram do `prisma migrate diff`; um `CHECK` escrito à mão
(`apps/api/prisma/migrations/20261105120000_instrument_logo/migration.sql#instrument_logo_values_check`: de 1 byte a 200 KB, o tamanho
batendo com o texto, o SHA-256 em hexadecimal); e o `GRANT SELECT` ao papel da api, porque nenhuma tabela nova nasce com privilégio para
ela. É só aditiva: nada existente muda.

**Em construção (T0):** a próxima migration acrescenta `cycle.mode` e `cycle.executed_at`, também aditiva e gerada pelo `migrate diff`.

**Por quê? E se…?** *Como se gera?* `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`, revisar e
versionar; nunca `migrate dev` nem `db push` (CLAUDE.md, "Banco"). *E se precisasse apagar uma coluna?* Em duas migrations: primeiro
adicionar e migrar, depois remover, porque a api nova e a antiga convivem por alguns minutos no deploy
([ADR 0029](adr/0029-blue-green-com-label-green-e-endpoint-green-no-front-door.md)).

#### 9. Em que trecho é feito o filtro por usuário?

**Resposta.** Em três lugares, de propósito:
1. O dono é sempre o ULID da **sessão**: o `SessionGuard` põe `req.account` e o controller passa
   `apps/api/src/modules/portfolio/presentation/portfolio.controller.ts#req.account!.userId`. Nenhuma rota aceita id de usuário no corpo,
   na query ou no caminho; o contrato estrito recusa campo a mais.
2. O repositório filtra pelo dono **na mesma instrução** que lê ou escreve: o `PATCH` é um `UPDATE ... FROM portfolio` com
   `apps/api/src/modules/portfolio/infrastructure/portfolio.repository.ts#p.user_id = ${userId}`, e o `DELETE` também. Nada de ler e
   depois escrever.
3. O lançamento de outro usuário é **404**, igual ao que não existe: a api não confirma que o id existe.

O teste: `apps/api/src/modules/portfolio/presentation/portfolio.integration.spec.ts#o dono: A nunca vê, muda nem apaga nada de B` e, na
tela, `apps/web/e2e/carteira.spec.ts#o usuário A não vê a carteira do B`. O export da LGPD segue a mesma regra
(`apps/api/src/modules/account/domain/user-data.ts#where: (userId) => ({ portfolio: { userId } })`).

**Por quê? E se…?** *Por que não ler e depois escrever?* Entre a leitura e a escrita outra requisição pode mudar a linha; com o filtro
na própria instrução não há essa janela. *Por que 404 e não 403?* O 403 diria que o lançamento existe.

### Autenticação e segurança

#### 10. Como é feita a autenticação? Onde a sessão é gerada, validada e quando expira?

**Resposta.** Pelo **Better Auth**, configurado em `apps/api/src/modules/account/infrastructure/auth.ts#export function createAuth` e
montado direto no Express, em `/api/auth/*`, depois da trava de origem
(`apps/api/src/modules/account/presentation/auth-route.ts#authRoute`; [ADR 0024](adr/0024-conta-better-auth-direto-no-express-e-aceite-em-consent.md)).
- **E-mail e senha, com verificação obrigatória** (`requireEmailVerification: true`), e Google opcional.
- **Gerada** no login (`/api/auth/sign-in/email`): uma linha em `session` e o cookie `alvesting.session_token` (HttpOnly, SameSite=Lax e
  Secure em https; `__Secure-` na frente em produção), em
  `apps/api/src/modules/account/infrastructure/auth.ts#cookiePrefix: 'alvesting'`.
- **Validada** em toda rota que pede sessão, pelo
  `apps/api/src/modules/account/presentation/session.guard.ts#this.auth.api.getSession`, que também confere o usuário no banco.
- **Expira** em 7 dias, renovada a cada uso depois de 1 dia (os padrões do Better Auth, anotados em
  `apps/api/src/modules/account/infrastructure/auth.ts#freshAge`). Excluir a conta sem a senha só vale com sessão de até 5 minutos.
  Redefinir a senha derruba todas as sessões (`revokeSessionsOnPasswordReset`).

**Por quê? E se…?** *Por que tantas rotas do Better Auth fechadas?* Cada rota sem uso é superfície de ataque
(`apps/api/src/modules/account/infrastructure/auth.ts#CLOSED_PATHS`); o teste lista as rotas da versão instalada e reprova a nova que não
estiver numa das listas. *E quem cadastra o e-mail de outra pessoa?* Sem verificar, não entra, e o Google não se liga sozinho a essa conta
(`disableImplicitLinking`).

#### 11. Como funciona a autorização? Mostre onde uma rota ou tela é bloqueada.

**Resposta.** Por papel, em guards do Nest:
- `apps/api/src/modules/account/presentation/roles.guard.ts#RolesGuard`: falha fechado. Sem `req.account` é 401, e rota sem `@Roles` é
  403, até para o admin.
- `apps/api/src/modules/admin/presentation/admin.controller.ts#@UseGuards(SessionGuard, RolesGuard, ConsentGuard)` na classe e
  `@Roles('ADMIN')` em **cada rota**: a rota nova que esquecer o papel nasce fechada.
- O papel mora numa coluna que nenhuma entrada aceita (`apps/api/src/modules/account/infrastructure/auth.ts#input: false`); só o
  comando `account:promote` o muda
  (`apps/api/src/modules/account/application/promote.ts#promoteToAdmin`).
- Na tela, `apps/web/src/app/(app)/(conta)/admin/page.tsx#if (me.role !== 'ADMIN') notFound();`: quem não é admin vê a 404.
- No banco: o login da api só tem o que usa, e gatilhos `*_api_guard` recusam o estado que a rota recusa em código
  (`apps/api/src/infrastructure/database/table-policy.ts#guard: 'season_api_guard'`).

Os testes: `apps/api/src/modules/admin/presentation/admin.integration.spec.ts` e o `apps/web/e2e/admin.spec.ts`.

#### 12. Como as senhas e os dados sensíveis são guardados? O que protege contra SQL injection e XSS?

**Resposta.**
- **Senha:** o Better Auth guarda só o resumo **scrypt** (N=2^14, r=16), em `account.password`. É abaixo do mínimo da OWASP, escolha
  consciente para a réplica de 0,25 vCPU, anotada em [CONTA.md](CONTA.md), seção 11 ("Limites conhecidos"). O token da redefinição de senha fica
  guardado como resumo (`apps/api/src/modules/account/infrastructure/auth.ts#storeIdentifier: 'hashed'`).
- **Segredos:** Key Vault em produção e `Secret` no processo (pergunta 5). O log é lista branca, e o texto de erro passa por
  `apps/api/src/common/redact.ts#redactPii` antes de ir ao log.
- **SQL injection:** toda consulta passa pelo Prisma, que manda os valores como parâmetro. O SQL escrito à mão usa o `$queryRaw` com
  template marcado, que também vira parâmetro (`apps/api/src/modules/portfolio/infrastructure/portfolio.repository.ts#Prisma.join(tickers)`).
  O único `$executeRawUnsafe` fora dos testes é o do ensaio, com nomes de tabela lidos do próprio catálogo, num banco descartável
  (`apps/api/src/ensaio/driver.ts#truncateAll`).
- **XSS:** o React escapa todo texto. O único `dangerouslySetInnerHTML` do site é o script do tema, uma constante nossa
  (`apps/web/src/app/layout.tsx#THEME_SCRIPT`). Os cabeçalhos de segurança estão em `apps/web/next.config.ts#securityHeaders`; o CSP não tem
  `script-src`, porque o Next injeta scripts em linha e pediria nonce (dito no próprio comentário). O SVG dos logos, que vem de fora, é
  validado (`apps/api/src/modules/market-data/domain/svg-check.ts`) e servido com um CSP que o deixa inerte (`sandbox`).
- **CSRF:** cookie SameSite=Lax e, nas mutações, a conferência do `Origin`
  (`apps/api/src/modules/account/presentation/session.guard.ts#SAFE_METHODS`).

### Regras de negócio e fluxo

#### 13. Abra o arquivo da funcionalidade principal e explique a regra de negócio linha a linha.

**Resposta.** O coração da arena é a execução das ordens de um pregão:
`apps/api/src/modules/settlement/domain/portfolio.ts#export function executeSession`. É uma **função pura**: recebe a carteira, os itens da
decisão, as barras e as regras, e devolve a carteira nova, as ordens e as execuções, sem relógio, acaso nem banco. Lendo de cima para
baixo:
1. `bpsOf`: cada BUY tem de estar entre 5% e 25% do patrimônio, cada SELL entre 1% e 100% da posição
   (`packages/contracts/src/llm-decision.ts#BUY_PERCENT_OF_EQUITY`). O contrato já recusou; esta é a última barreira.
2. No máximo 5 ordens por ciclo (`MAX_ORDERS_PER_CYCLE`); o HOLD não é ordem, mas ocupa o índice do item.
3. `equityAtOpen`: o patrimônio na **abertura de D** (caixa mais as posições pelo preço de abertura; sem barra, pelo último fechamento). É
   a base do percentual do BUY, medida antes de qualquer ordem.
4. `sequence`: **as vendas antes das compras**; entre elas, a ordem em que o modelo listou. A venda libera caixa para a compra.
5. SELL: sem posição, `no_position`; sem barra do dia, `no_bar` (nunca usa preço de outro dia); a quantidade é arredondada **para
   baixo** (ação inteira); abaixo de 1 ação, `below_one_share`. O caixa recebe o valor menos o custo da operação (`tradeCost`), e a
   posição perde a parte proporcional do custo (custo médio).
6. BUY: o limite de posições vale **na hora da execução**, depois das vendas; a quantidade-alvo é patrimônio × percentual ÷ preço de
   abertura; o caixa limita (`maxShares`, **sem alavancagem**); se coube menos que o alvo, a ordem sai `REDUCED`; o custo da operação vai por
   cima, do caixa, e entra no custo da posição.

Os testes: `apps/api/src/modules/settlement/domain/portfolio.spec.ts` (um `describe` por regra) e
`apps/api/src/modules/settlement/domain/hand-checked.spec.ts#a planilha conferida à mão (3 ações, 5 pregões)`, que compara centavo a centavo
com CSVs calculados à mão.

**Por quê? E se…?** *Por que executar na abertura e não no fechamento de ontem?* Nenhum modelo vê o preço de execução: decide até 09:30 e
executa às 10:00 ([ADR 0010](adr/0010-decidir-antes-executar-na-abertura.md)). *E se a resposta do modelo mandar 10 ordens?* O validador
da decisão corta da sexta em diante, na ordem listada (`validateSemantics`), e, se uma lista maior chegasse até aqui, o
`executeSession` lançaria erro em vez de executar: a última barreira.

#### 14. O que acontece se o usuário enviar um dado inválido? A validação está no front, no back ou nos dois?

**Resposta.** Nos dois, e no banco. Na carteira:
- **No navegador**, `apps/web/src/lib/wallet-client.ts#checkLot` confere todos os campos de uma vez com a mesma regra da api
  (`packages/contracts/src/portfolio-rules.ts#export function parseBrl`: "1.234" é ambíguo e é recusado) e põe a frase em português no
  campo, com o foco no primeiro. Nada é enviado.
- **Na api**, o `ZodValidationPipe` com o `lotBodySchema` estrito (400 `VALIDATION_ERROR` com o caminho de cada problema, montado em
  `apps/api/src/common/all-exceptions.filter.ts#fail('VALIDATION_ERROR', 'Entrada inválida', exception.issues)`), e o serviço confere o
  ticker e a data (`apps/api/src/modules/portfolio/application/portfolio.service.ts#private async check(`). Parâmetro de query desconhecido
  também é 400 (`noQuerySchema`).
- **No banco**, `CHECK` de quantidade, custo, ticker e data
  (`apps/api/prisma/migrations/20261103130000_portfolio/migration.sql#portfolio_lot_quantity_check`).

O site traduz o 400 da api pelo campo (`apps/web/src/lib/wallet-client.ts#API_FIELD_ERRORS`) e nunca mostra a mensagem da api, que poderia
repetir o que o cliente mandou.

**Por quê? E se…?** *Por que repetir?* A do navegador só poupa a ida e fala a língua da pessoa; a da api é a fronteira de confiança (um
`curl` pula o navegador); a do banco pega o caminho novo que esquecer as outras. *E um texto que o Zod aceita e o Postgres recusa (o
NUL)?* A regra do projeto é recusar na entrada, nunca dar 500 (CLAUDE.md, "Convenções").

#### 15. Como os erros são tratados e registrados? Se uma operação falhasse em produção, onde você veria?

**Resposta.**
- **HTTP:** `apps/api/src/common/all-exceptions.filter.ts#AllExceptionsFilter` transforma toda exceção no envelope, com o status certo; o
  500 é genérico para o cliente e completo (limpo de dado pessoal) no log e no span.
- **Log:** Pino em JSON no stdout (`apps/api/src/core.module.ts#LoggerModule.forRootAsync`), que o Container Apps manda ao Log Analytics.
- **Telemetria:** OpenTelemetry para o Application Insights, só com os atributos da lista branca
  (`apps/api/src/telemetry/telemetry.ts#export async function startTelemetry`, `apps/api/src/telemetry/sanitize.ts#SanitizingSpanProcessor`).
- **Alertas:** as linhas de log que viram alerta moram em `apps/api/src/telemetry/alert-logs.ts#ALERT_LOG` e são citadas por extenso pela
  consulta do Azure Monitor (`infra/modules/alerts.bicep#appSignals`); cada alerta tem uma seção no [RUNBOOK.md](RUNBOOK.md).
- **Filas:** o handler que falha deixa o `job_run` `FAILED` com o erro, ganha nova tentativa agendada e, na última, vai para a DLQ, que o
  painel `/admin` mostra e reenvia.
- **Site:** a página que não conseguiu ler a api escreve `[web] a api não atendeu a página` no log do servidor e responde a tela "a arena
  não respondeu" (`apps/web/src/lib/with-api-down.tsx#withApiDown`).

**Em produção, onde eu veria:** no Application Insights (a requisição e a exceção) e no Log Analytics (a linha do log), e por e-mail, pelo
alerta. **Nada disso rodou na Azure ainda** (seção 7); hoje o erro aparece no terminal e nos testes.

### Integrações

#### 16. Como o front-end se comunica com o back-end? Onde a chamada é feita e onde a resposta é tratada?

**Resposta.** De dois jeitos:
- **No servidor (SSR)**, para ler: `apps/web/src/lib/api.ts#export async function call`, chamado pelas leituras de `reader` (as públicas,
  com o cache de dados do Next e as tags que a liquidação vence) e por `apiGetFresh` (as do usuário, sem cache). A resposta é validada
  pelo schema do contrato, e o erro vira `ApiError` com o status e o código (`apps/web/src/lib/api.ts#export class ApiError`), que a
  página trata (`isNotFound`, `withApiDown`, o redirecionamento da carteira).
- **No navegador**, para escrever: `apps/web/src/lib/account-client.ts#export async function send`, na mesma origem. A resposta vira um
  `Reply` (status, código e os campos do problema), que cada formulário traduz.

As cotações brutas não vêm da API pública (a licença da brapi não deixa entregá-las como API): o servidor do site as lê de rotas internas
com um segredo (`apps/web/src/lib/quotes.ts#readTape`; [ADR 0033](adr/0033-api-publica-sem-cotacao-bruta-e-rota-interna-para-o-site.md)).

#### 17. O projeto usa API ou serviço externo? Onde está a integração e o que acontece se ele sair do ar?

| Serviço | Onde | Se sair do ar |
|---|---|---|
| brapi (cotações) | `apps/api/src/modules/market-data/infrastructure/brapi.client.ts#BrapiClient` | O `eod` se reagenda de hora em hora até 00:30; sem as barras do dia, a liquidação espera; a cota tem reserva (`QUOTA_RESERVE`) |
| OpenRouter (LLMs) | `apps/api/src/modules/arena/infrastructure/llm-gateway.ts#OPENROUTER_BASE_URL` | Novas tentativas agendadas (10 e 20 min) dentro do prazo; na última, HOLD `falha` registrado ([ADR 0021](adr/0021-dlq-vira-hold-pelo-handler-na-ultima-entrega.md)) |
| CVM, BCB e portais (RSS) | `apps/api/src/modules/news/application/cvm-fetcher.ts#CvmFetcher`, `bcb-fetcher.ts`, `rss-fetcher.ts` | A `fetch` tenta 5 vezes e vai para a DLQ; o briefing das 07:30 sai com as notícias que já foram coletadas (o que o barra é a falta de barras: menos de 80% do universo); a liquidação rende o caixa pela última taxa do CDI publicada até o pregão (`apps/api/src/modules/settlement/domain/cdi.ts#rateOnOrBefore`). Sem briefing, o ciclo é pulado com o motivo `sem_briefing` |
| E-mail (Azure Communication Services) | `apps/api/src/modules/account/infrastructure/email/acs-email-sender.ts#AcsEmailSender` | A falha vai ao log com a linha do alerta (`apps/api/src/modules/account/infrastructure/email/account-mailer.ts#ALERT_LOG.emailFailed`), e a resposta à pessoa não muda (o envio não é esperado, para o tempo não denunciar se o e-mail tem conta); em dev o e-mail cai numa pasta |
| Google (login) | `apps/api/src/modules/account/infrastructure/auth.ts#socialProviders` | Só existe com as duas variáveis; sem ele, entra-se por e-mail e senha |
| A api, para o site | `apps/web/src/lib/with-api-down.tsx#withApiDown` | O site responde a tela "a arena não respondeu", montada no servidor, com o aviso fixo |

**Por quê? E se…?** *Por que não abandonar a mensagem e deixar o Service Bus reentregar?* Ele reentrega na hora: um provedor fora do ar
gastaria as 3 entregas em segundos ([ADR 0015](adr/0015-nova-tentativa-agendada-nao-abandono-imediato.md)). *E nos testes?* Nenhum teste
chama serviço de verdade (CLAUDE.md, regra 3): a brapi falsa (`apps/api/src/ensaio/fake-brapi.ts#createFakeBrapi`), o LLM falso
(`apps/api/src/modules/arena/infrastructure/fake-llm.ts`) e os arquivos de fixture.

### Testes e qualidade

#### 18. Quais testes existem? Rode-os e explique um. Mostre o relatório de cobertura.

**Resposta.**
- **Vitest**, de unidade e de integração, nos três pacotes: `apps/api/vitest.config.ts#include` (`src/**/*.spec.ts`, um arquivo por vez,
  porque os de integração dividem o banco), `apps/web` (`vitest run --dir src`) e `packages/contracts`. Os de integração rodam com
  `TEST_DATABASE_URL` (o fixture cria o banco e aplica as migrations), o Azurite e, opcional, o emulador do Service Bus; sem a variável,
  aparecem como pulados, com o motivo no nome.
- **node:test** nos scripts (`scripts/*.test.mjs`), como `scripts/guia-check.test.mjs#referências quebradas`.
- **Playwright** (`apps/web/e2e`): seis projetos, mobile primeiro; o `pixel-7` e o `iphone-15` são gate de merge.
- **Outros:** o Lighthouse da home, o `infra/tests/check.mjs` (Bicep sem assinatura) e o ensaio da arena inteira (`pnpm --filter
  @alvesting/api arena:ensaio`), que tem de dar o mesmo relatório com a mesma semente.

Um teste para explicar: `apps/api/src/modules/settlement/domain/portfolio.spec.ts#a venda libera o caixa da compra mesmo listada depois dela`.
O modelo pediu primeiro "compre CCC3 com 25%" e depois "venda toda a BBB4", com só R$ 5,90 em caixa. O teste confere que a venda roda
antes (o índice 1 sai primeiro), que a compra executa por inteiro com o dinheiro dela (39 ações) e o caixa final, centavo a centavo.

**Cobertura.** A linha de base de 06/11/2026, sobre todo o `src` (sem o código gerado do Prisma): api 93,62% de linhas, site 69,63%,
contratos 100% (o Playbook pede 75% no backend e 25% no frontend). O provedor `@vitest/coverage-v8` entrou no commit `c9ca348`. **Em
construção (T2):** o `pnpm coverage`, que roda os três pacotes com os limites travados, e o `docs/QUALIDADE.md`, que explica como gerar
o relatório e o que conta como backend e frontend.

#### 19. Se eu mudar uma regra de negócio, qual teste deveria falhar? Faça a mudança e mostre.

**Resposta, com três ensaios prontos:**

| Mudança | Onde | O teste que falha |
|---|---|---|
| Executar as compras antes das vendas (inverter o `sequence`) | `apps/api/src/modules/settlement/domain/portfolio.ts#const sequence` | `apps/api/src/modules/settlement/domain/portfolio.spec.ts#a venda libera o caixa da compra mesmo listada depois dela`: a compra, sem caixa, sai `insufficient_cash`, e a lista de ordens esperada (`[1, 'SELL', 'FILLED'], [0, 'BUY', 'FILLED']`) não bate |
| Aceitar "1.234" como mil duzentos e trinta e quatro | `packages/contracts/src/portfolio-rules.ts#export function parseBrl` | `packages/contracts/src/portfolio-rules.spec.ts`, os casos do ponto ambíguo |
| Deixar a decisão de 9 ordens passar (subir o `MAX_ORDERS_PER_CYCLE`) | `packages/contracts/src/llm-decision.ts#MAX_ORDERS_PER_CYCLE` | `apps/api/src/modules/settlement/domain/portfolio.spec.ts#o limite de 5 ordens e as faixas de percentual são a última barreira` |

Para rodar um arquivo só (num clone novo, antes, `pnpm --filter @alvesting/api generate` e `pnpm --filter @alvesting/contracts build`;
seção 4):

```bash
pnpm --filter @alvesting/api exec vitest run src/modules/settlement/domain/portfolio.spec.ts
pnpm --filter @alvesting/contracts exec vitest run src/portfolio-rules.spec.ts
```

### CI/CD e deploy

#### 20. O que seria preciso alterar no CI/CD para executar as integrações manualmente, e não a cada merge?

**Resposta.** Quem publica a cada merge é o `deploy.yml`, pelo gatilho `push` na `main`
(`.github/workflows/deploy.yml#branches: [main]`). Ele **já tem** o gatilho manual
(`.github/workflows/deploy.yml#workflow_dispatch`, com a opção `images_only`). Para o deploy ficar só manual, basta tirar o bloco `push:`
do `on:`; o botão "Run workflow" do GitHub continua. Outro caminho, sem mexer no YAML: exigir aprovação no ambiente `production` do
GitHub, que os dois jobs declaram (`environment: production`); o [DEPLOY.md](DEPLOY.md) recomenda **não** pôr revisores obrigatórios hoje,
porque cada um dos dois jobs pediria a aprovação.

O `ci.yml` roda em todo PR e em todo push na `main` (`.github/workflows/ci.yml#pull_request:`). Dá para torná-lo manual do mesmo jeito
(um `workflow_dispatch` no lugar dos dois), mas ele é o portão do merge: manual, o PR entraria sem prova.

#### 21. Quais etapas o pipeline roda, em que ordem, e o que acontece quando um teste ou a análise estática falha?

**Resposta.** O `ci.yml` tem quatro jobs, que rodam **em paralelo** (nenhum `needs:`):
1. `check`: sobe o Postgres, o Azurite e o emulador do Service Bus; lint (ESLint e Prettier), tipos, testes de unidade e de integração,
   `docs:check` e o check da infra (`.github/workflows/ci.yml#Testes de unidade e de integração`).
2. `web`: build, Playwright e Lighthouse mobile.
3. `images`: constrói as duas imagens e prova que a api sobe com `/health`, que **recusa subir** com a configuração errada (sem
   `FRONT_DOOR_ID` com a trava ligada, sem a configuração da conta, com o login de administrador do banco), que não roda como root nem
   leva `.env`, e que os quatro papéis existem (`.github/workflows/ci.yml#A api recusa subir com o login administrador do banco`).
4. `whatif`: o what-if da infra na Azure, só quando o repositório tem a variável `AZURE_CLIENT_ID`.

Um passo que falha reprova o job, e o PR fica vermelho. **Em construção (T2):** um job de cobertura e o SonarCloud (só com o segredo
`SONAR_TOKEN`).

O `deploy.yml`: `images` (constrói e publica no ACR com a tag do commit) e `deploy`, um blue/green por app, a api antes do site:
fixar o tráfego, migrations, criar a revisão nova **sem tráfego** com o label `green`, smoke nela, Playwright mobile pelo endpoint green
do Front Door, só então virar o tráfego; no fim, o smoke de produção e a desativação das antigas. Qualquer prova que falha dispara o
`Desfazer` (`.github/workflows/deploy.yml#node scripts/deploy.mjs rollback`). A lógica está em
`scripts/deploy.mjs#export async function promote`, com teste que executa o `deploy.yml` de verdade contra um Container Apps falso
(`scripts/deploy.test.mjs`).

#### 22. Onde a aplicação está hospedada e como é feito o deploy? Como voltar à versão anterior?

**Resposta.** **Hoje não está hospedada em lugar nenhum**: o repositório não tem remoto e o deploy nunca rodou (seção 7). O desenho é
o Container Apps na Chile Central, no perfil econômico, sem o Front Door (ADRs 0039 e 0040), publicado pelo `deploy.yml` (pergunta 21;
[ADR 0029](adr/0029-blue-green-com-label-green-e-endpoint-green-no-front-door.md)). Para voltar:
- **Durante o deploy**, a prova que falha devolve 100% à revisão antiga nos dois apps (o passo `Desfazer`, que chama o
  `scripts/deploy.mjs#export async function rollback`).
- **Depois**, `node scripts/deploy.mjs revert` (`scripts/deploy.mjs#export async function revert`), passo a passo em [DEPLOY.md](DEPLOY.md),
  seção 6.
- **E o banco?** As migrations são só aditivas, então a revisão antiga roda sobre o banco novo; a mudança incompatível em `/api/v1` vai
  em lançamentos separados (CLAUDE.md, "Banco").

Até a Azure, **em construção (T0)**: um operador local no Mac (`arena:operar`) roda o pipeline nos horários de produção.

### Processo e histórico

#### 23. Escolha um commit e explique o que mudou e por quê. Qual foi o PR mais difícil?

**Resposta.** Os seis commits estão na seção 8. Um bom para explicar é o `1330645` (04/11/2026):
- a limpeza dos dados pessoais passou a rodar todo dia, e não mais aos domingos, porque a política de privacidade promete apagar o
  cadastro nunca confirmado em até 7 dias (`infra/modules/containerapps.bicep#{ name: 'retention', cron: '0 13 * * *' }`);
- o legado do COTAHIST saiu do banco numa migration não aditiva, a única exceção autorizada, porque não havia produção nem dado legado; ela
  tem uma guarda que falha inteira se alguma linha ainda usar o que sai
  (`apps/api/prisma/migrations/20261104100000_drop_cotahist_legacy/migration.sql#EXCEÇÃO à regra "migration só aditiva"`);
- o cliente da brapi passou a ler a cota pelo cabeçalho certo (o bug 6.1).

**Pull request:** ainda **não houve nenhum**. O repositório não tem remoto; o trabalho foi feito em ondas de tarefas, cada uma com
relatório, revisão de código e QA (os relatórios estão em `docs/redesign-*/relatorios/`), e o coordenador commitou cada tarefa conferida.
O template que todo PR vai usar já existe, com a checklist obrigatória (`.github/pull_request_template.md#Migration segura`).
Os PRs revisados pelo squad começam quando o repositório for público (seção 8). A resposta honesta à segunda parte, hoje, é contar uma
revisão das ondas: por exemplo, a revisão que achou a fita da home pela metade (bug 6.4).

#### 24. Qual foi o bug mais difícil? Como descobriu a causa e onde está a correção?

**Resposta.** Seção 6, com cinco bugs reais, cada um com o sintoma, como a causa foi achada, a correção e o teste que a protege. Para a
prova, o melhor é o da cota da brapi (6.1): o sintoma enganava ("cota baixa" com a cota quase cheia), a causa só apareceu comparando os
cabeçalhos das respostas reais, e a correção cabe numa função
(`apps/api/src/modules/market-data/infrastructure/brapi.client.ts#x-ratelimit-remaining`) com um teste que usa os cabeçalhos de verdade.

### Mudança ao vivo

#### 25. Adicione um campo novo a uma entidade e faça ele aparecer na tela. O que mudou em cada camada?

**Resposta.** Seção 5: o roteiro do campo "observação" no lançamento da carteira, arquivo por arquivo, para treinar antes da prova. As
camadas, de baixo para cima: o banco (`apps/api/prisma/schema.prisma#model PortfolioLot` e uma migration nova), o privilégio do papel da
api, o contrato (`packages/contracts/src/portfolio.ts#lotBodySchema`), o repositório e o serviço, o export da LGPD, e a tela
(`apps/web/src/components/wallet-lots.tsx#function LotForm`), com os testes de cada uma.

---

## 4. Como rodar do zero

Conferido em 06/11/2026 no checkout atual (Node 26.13.0, pnpm 12.16.1, Docker Desktop), sem copiar o repositório. A coluna "Conferido"
diz o que foi rodado e o que só foi conferido no código, com o motivo.

| # | Comando | O que faz | Conferido |
|---|---|---|---|
| 1 | `nvm install && nvm use` (na raiz) | Instala e liga o Node do `.nvmrc` (26.13.0) | Rodado: `node -v` deu v26.13.0 |
| 2 | `npm i -g pnpm@12.16.1` (dentro do Node 26) | O pnpm do campo `packageManager` | Rodado: `pnpm -v` deu 12.16.1 |
| 3 | `pnpm install` | Instala o workspace; só os pacotes do `allowBuilds` do `pnpm-workspace.yaml` rodam script de instalação | Não rodado: outro processo instalava no mesmo checkout; o `node_modules` existente funcionou nos passos seguintes |
| 4 | `docker compose up -d` | Postgres 17.11 na 25432 (cria o `alvesting_dev`) e Azurite na 25100, presos em 127.0.0.1 | Rodado `docker compose ps`: os dois de pé, o Postgres `healthy`; o profile opcional `servicebus` existe |
| 5 | `pnpm --filter @alvesting/api migrate:deploy` | `prisma migrate deploy`: aplica as migrations no banco do `DATABASE_URL` | Rodado num banco novo e vazio (`alvesting_t3_test`): as 22 migrations entraram; depois `prisma migrate status` em dia e o `migrate diff` vazio |
| 6 | `pnpm --filter @alvesting/api db:roles` | `nest build` e `dist/db-roles-cli.js`: cria o login `alvesting_api` e grava a senha da `API_DATABASE_URL` | **Não rodado, de propósito**: o login é um papel do **servidor Postgres inteiro**, não de um banco, e trocar a senha dele derruba quem já o usa (a demo que estava no ar); conferido no código (`apps/api/src/db-roles-cli.ts#provisionApiLogin`) |
| 7 | `pnpm dev` | `prisma generate` e o build dos contratos; depois a api (`nest start --watch`, porta 4310), os contratos (`tsc --watch`) e o site (`next dev`, porta 4300) | Rodado só o `turbo run dev --dry`, que listou essas tarefas: as portas 4300 e 4310 eram da demo, e o `next dev` trava a pasta `.next/dev`. Rodei a api compilada na porta 4320 sobre o banco do passo 5: `/api/v1/health` 200 no envelope, `/health` 200, Swagger em `/api/docs` 200, `/api/v1/me/portfolio` 401 sem sessão e parâmetro desconhecido 400; o processo foi parado |
| 8 | Abrir http://127.0.0.1:4300 e http://127.0.0.1:4310/api/docs | O site e o Swagger | Os endereços batem com o `.env.example` (`API_PORT`, `PUBLIC_URL`, `API_INTERNAL_URL`) |
| 9 | `pnpm --filter @alvesting/web exec playwright install chromium webkit` | Os navegadores do e2e, na primeira vez | Não rodado (baixa da rede); os navegadores já estavam no cache do Playwright |
| 10 | `pnpm check` | Lint, tipos, testes e `docs:check`: o portão local e o do CI | Rodado o `pnpm docs:check` (ok, 92 itens) e os testes da carteira contra o banco do passo 5 (114 da api e 107 dos contratos, verdes); o `pnpm check` inteiro fica para o fechamento da onda (uma execução pesada por vez no repositório) |

**O que o README e o CLAUDE.md não dizem** (anotado também no relatório da T3):
- **Ter dados na tela.** Depois do passo 5 o `alvesting_dev` está vazio: o site abre sem temporada. Os caminhos que existem são a carga da
  brapi (`market:backfill --confirmo-banco`, que pede o `BRAPI_TOKEN`) ou um banco sintético (`arena:ensaio`, que **apaga e recria**
  o `alvesting_ensaio`, ou o `e2e:seed`); a demo do Artur roda a api sobre o `alvesting_ensaio`. Nenhum dos dois documentos diz como
  apontar o `pnpm dev` para um banco com dados.
- **Rodar um arquivo de teste só** (o que se faz numa mudança ao vivo): o `pnpm test` gera o cliente do Prisma e constrói os contratos
  antes (o Turborepo faz), mas o `vitest run <arquivo>` direto, num clone novo, falha sem `pnpm --filter @alvesting/api generate` e
  `pnpm --filter @alvesting/contracts build`: o `apps/api/src/generated` e o `packages/contracts/dist` ficam fora do git.
- **O `nvm use` vale para o terminal em que rodou.** Num subshell (num `|`, por exemplo) ele não muda nada, e o pnpm de outro Node falha
  com "Failed to switch pnpm to v12.16.1". O README diz para instalar o pnpm dentro do Node 26, mas não mostra esse erro.
- **O `db:roles` mexe num papel do servidor.** O README o põe no passo a passo sem dizer que o login `alvesting_api` vale para todos os
  bancos do Postgres do compose.
- **A tabela "Testar" do README** diz que o `pnpm test` roda o Vitest dos contratos e da api; ele roda também o do site
  (`apps/web`, `vitest run --dir src`). E o e2e tem seis projetos, não três: os três escuros (`pixel-7-escuro`, `iphone-15-escuro` e
  `desktop-escuro`) rodam só os testes `@tema` (`apps/web/playwright.config.ts#grep: /@tema/`).

---

## 5. Ensaio de mudança ao vivo: um campo de observação no lançamento

O pedido treinado: "acrescente uma **observação** opcional ao lançamento da carteira e mostre na tela". **Não está implementado**: é o
roteiro para treinar. Cada camada, na ordem em que se faz, com o arquivo e o que muda. O limite de 200 caracteres é um exemplo.

**1. O banco (Prisma e a migration).**
- `apps/api/prisma/schema.prisma#model PortfolioLot`: `note String? @db.VarChar(200)`.
- Gerar o SQL, nunca com `migrate dev`: em `apps/api`,
  `pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`, que compara o banco do
  `DATABASE_URL` com o schema e escreve o `ALTER TABLE "portfolio_lot" ADD COLUMN "note" VARCHAR(200);`. Salvar numa pasta nova
  `apps/api/prisma/migrations/<AAAAMMDDhhmmss>_portfolio_lot_note/migration.sql`, com um comentário do porquê, como a
  `apps/api/prisma/migrations/20261105120000_instrument_logo/migration.sql#GRANT SELECT ON "instrument_logo"`.
- Acrescentar à mão o que o Prisma não emite: o **`GRANT UPDATE ("note") ON "portfolio_lot" TO "alvesting_api_group";`**. A api tem
  `SELECT` e `INSERT` na tabela inteira (a coluna nova já vem junto), mas o `UPDATE` é **por coluna**
  (`apps/api/prisma/migrations/20261103130000_portfolio/migration.sql#GRANT UPDATE ("ticker", "quantity", "cost_cents", "bought_on", "updated_at")`):
  sem o `GRANT`, o `PATCH` dá erro de permissão.
- `pnpm --filter @alvesting/api migrate:deploy`, depois o `migrate diff` de novo (tem de sair vazio) e
  `pnpm --filter @alvesting/api generate` (o cliente do Prisma com a coluna).

**2. A matriz de privilégios do papel da api.**
- `apps/api/src/infrastructure/database/table-policy.ts#apiColumns: { UPDATE: ['ticker', 'quantity', 'cost_cents', 'bought_on', 'updated_at'] }`:
  acrescentar `'note'` e uma palavra no `why`. O `api-role.integration.spec.ts` compara o catálogo do banco com esta matriz: o `GRANT`
  sem a matriz, ou a matriz sem o `GRANT`, reprova.

**3. O contrato (Zod, em `packages/contracts`).**
- `packages/contracts/src/portfolio-rules.ts#PORTFOLIO_LIMITS`: um `maxNoteLength: 200`. Mora aqui, no módulo sem imports, porque o
  formulário do navegador também lê o limite e não pode levar o zod.
- `packages/contracts/src/portfolio.ts#lotBodySchema`: `note` opcional, aparado, até o limite, e **sem caractere de controle** (o NUL o
  Postgres recusa, e o projeto recusa na entrada, nunca com 500; o nome do cadastro faz o mesmo em
  `apps/api/src/modules/account/infrastructure/auth.ts#!/\p{Cc}/u.test(name)`). No `transform`, `note: body.note || null`, para o texto
  vazio virar nulo.
- `packages/contracts/src/portfolio.ts#export const lotSchema`: `note: z.string().max(...).nullable()`. O export da LGPD usa o mesmo
  `lotSchema` (`packages/contracts/src/account.ts#portfolioLots: z.array(lotSchema)`), então ele também passa a exigir a nota.

**4. O domínio, o repositório e o serviço.**
- `apps/api/src/modules/portfolio/domain/positions.ts#export interface LotRecord`: `note: string | null` (o `consolidate` não usa).
- `apps/api/src/modules/portfolio/infrastructure/portfolio.repository.ts`: `note: true` no `LOT_SELECT` e no `interface LotRow`; no
  `async add(`, `note: input.note` no `create`; e no `async replace(`, que é **SQL escrito à mão**, a coluna no `SET` (`note = ${input.note}`) e
  no `RETURNING` (`l.note`). É o lugar mais fácil de esquecer: o tipo não avisa.
- `apps/api/src/modules/portfolio/application/portfolio.service.ts#const toLot`: `note: record.note`.

**5. O controller e o Swagger.**
- Nada muda em `apps/api/src/modules/portfolio/presentation/portfolio.controller.ts#schemaOf`: o corpo e a resposta do Swagger saem dos
  schemas do Zod (`z.toJSONSchema`). Confira o campo novo em http://127.0.0.1:4310/api/docs.

**6. A LGPD (o que um dado novo de pessoa arrasta).**
- `apps/api/src/modules/account/domain/user-data.ts#PortfolioLot`: `note: true` no `select` do export. O teste
  `apps/api/src/modules/account/domain/user-data.spec.ts#a coluna nova de um modelo do usuário também precisa de decisão (sai ou é segredo)`
  reprova a coluna sem decisão.
- A política de privacidade lista o que a carteira guarda
  (`apps/api/src/modules/account/legal/politica-de-privacidade.md#o código da ação (ticker), a quantidade, o custo total pago em reais`).
  Um texto livre é dado pessoal novo: a política sobe de versão e **todo usuário aceita de novo** antes de usar a carteira (o
  `ConsentGuard`). No ensaio dá para pular, mas diga isso ao professor: em produção não se publica o campo sem a política.
- O backup mensal não muda: a `portfolio_lot` já é pessoal (`table-policy.ts`, `personal: true`) e o dump não leva os dados dela.

**7. O site.**
- A leitura: `apps/web/src/app/(app)/(carteira)/carteira/page.tsx#const lotView` (ao navegador vai só o que a tela usa: acrescentar `note`) e
  `apps/web/src/components/wallet-lots.tsx#export type LotView` (`'note'` no `Pick`).
- O formulário: no `apps/web/src/components/wallet-lots.tsx#function LotForm`, um `TextField` com `name="note"`, opcional, com a dica
  "não escreva dado pessoal", e o valor guardado de volta na edição; no `run`, `note: text(data, 'note')`. Em
  `apps/web/src/lib/wallet-client.ts`: `note` no `export interface LotDraft` e no `export interface LotBody`, a conferência do tamanho no
  `checkLot` (com o `PORTFOLIO_LIMITS` do subcaminho) e o caminho `note` no `FIELD_OF` e no `API_FIELD_ERRORS`, para o 400 da api cair no
  campo certo.
- A exibição: o lançamento é um cartão com `Fact` (`apps/web/src/components/wallet-lots.tsx#<Fact term="Data da compra">`); a observação
  entra como mais um `Fact`. **Não** entra na tabela de posições (`apps/web/src/components/wallet-panels.tsx#WalletPositions`), que soma os
  lançamentos por ticker. Uma palavra longa sem espaço não pode alargar a página em 360 px (`min-w-0` e quebra de palavra; CLAUDE.md,
  "Telas").

**8. Os testes, em cada camada.**

| Camada | Arquivo | O que acrescentar |
|---|---|---|
| Contrato | `packages/contracts/src/portfolio.spec.ts` | aceita até 200, recusa 201 e o caractere de controle, o vazio vira nulo |
| Integração da api | `apps/api/src/modules/portfolio/presentation/portfolio.integration.spec.ts#describe('PATCH /api/v1/me/portfolio/lots/:id'` | o POST grava e devolve a nota; o PATCH troca e apaga; o GET a devolve |
| Papel do banco | `apps/api/src/infrastructure/database/api-role.integration.spec.ts` | nada novo: ele já compara o catálogo com a matriz (e reprova se faltar um dos dois) |
| LGPD | `apps/api/src/modules/account/presentation/me.integration.spec.ts` | o export leva a nota |
| Site, unidade | `apps/web/src/lib/wallet-client.spec.ts`, `apps/web/src/components/wallet-lots.spec.tsx`, `apps/web/src/app/(app)/(carteira)/carteira/page.spec.tsx` | o `checkLot` com a nota, o campo no formulário, o `Fact` no cartão, o `lotView` |
| e2e | `apps/web/e2e/carteira.spec.ts#describe('lançar uma compra'` (e o `apps/web/e2e/carteira-support.ts#addLot`, que lança pela api) | lançar com observação e vê-la no cartão, editar; nos projetos `pixel-7`, `iphone-15` e `desktop` |

**9. Os comandos, depois da mudança.**

```bash
pnpm --filter @alvesting/contracts build          # a api e o site leem o contrato pelo dist
pnpm --filter @alvesting/api generate             # o cliente do Prisma com a coluna nova
pnpm --filter @alvesting/contracts exec vitest run src/portfolio.spec.ts
TEST_DATABASE_URL=postgresql://alvesting:alvesting@localhost:25432/alvesting_test \
  pnpm --filter @alvesting/api exec vitest run src/modules/portfolio src/infrastructure/database src/modules/account
pnpm --filter @alvesting/web exec vitest run --dir src wallet carteira
pnpm build && pnpm --filter @alvesting/web exec playwright test e2e/carteira.spec.ts --project=pixel-7
pnpm check                                         # o portão: lint, tipos, testes e docs:check
```

**10. Os documentos.** [API.md](API.md), seção 9 (o corpo e o lançamento), [TELAS.md](TELAS.md), seção 9, e [CONTA.md](CONTA.md) (os dados
mínimos da carteira).

---

## 6. Os bugs mais difíceis

Contados a partir dos registros: os relatórios das ondas, os comentários do código, os ADRs e os testes. Só entra o que tem registro.

### 6.1 A cota da brapi lida no cabeçalho errado (04/11/2026)

- **Sintoma.** Na carga do banco de dev, a busca parou na 5ª requisição por "cota baixa" (a reserva é de 500) e disparou o sinal
  `brapi-cota-baixa`, com a cota de 15 mil quase inteira.
- **Como a causa foi achada.** Comparando os cabeçalhos das respostas reais: a resposta 200 do histórico do PETR4 veio pelo **limitador
  de 20 por minuto** (`RateLimit-Limit 20`, `RateLimit-Remaining 20`, `RateLimit-Reset 60`), sem nenhum `X-RateLimit-*`, e não gastou cota
  (ela foi de 14.989, na resposta anterior, para 14.988, na seguinte). O cliente lia o `RateLimit-Remaining` e entendeu o "20" como a cota.
- **Correção.** Ler **só** o `X-RateLimit-Remaining`, e a resposta sem ele não muda a cota conhecida
  (`apps/api/src/modules/market-data/infrastructure/brapi.client.ts#const readRemaining`); e, se cinco respostas do histórico vierem sem
  ele e nenhuma com ele, um aviso no log de que a reserva ficou cega (`BLIND_AFTER_RESPONSES`; um nulo isolado é normal: 3 de 372
  respostas na carga do dev). Commit `1330645`; o registro está em [DADOS.md](DADOS.md) ("Cabeçalhos de cota").
- **O teste.** `apps/api/src/modules/market-data/infrastructure/brapi.client.spec.ts#o histórico servido pelo limitador de 20 por minuto não muda a cota conhecida`,
  com os cabeçalhos reais; a brapi falsa do ensaio passou a mandar os dois pares.

### 6.2 O `rxjs` errado à mostra no `node_modules` (05/11/2026)

- **Sintoma.** Nenhuma api HTTP subia: "The requested module 'rxjs' does not provide an export named 'catchError'", depois "No driver
  (HTTP) has been selected". Caíram a api do e2e, os testes HTTP e a demo.
- **Como a causa foi achada.** O `pnpm add` de duas dependências do site refez o que o pnpm iça em `node_modules/.pnpm/node_modules`, e o
  `rxjs` dali passou do 7.8.2 para o 6.6.7 do `inquirer`. O `@nestjs/platform-express` importa o `rxjs` sem declará-lo e achava essa
  cópia. Uma instalação limpa, numa pasta à parte e sem rede, içava o 7.8.2 com os dois lockfiles: o problema era o `node_modules`
  incremental, não o lockfile.
- **Correção.** O `pnpm-workspace.yaml#packageExtensions` declara o `rxjs` como par do `@nestjs/platform-express`, que passa a receber o
  7.8.2 pelo link na pasta dele (com o `ponytail:` de quando tirar), e a linha em [DEPENDENCIAS.md](DEPENDENCIAS.md) ("Extensões de pacote
  do pnpm"). Registro: `docs/redesign-premium/relatorios/fundacao.md`, seção 5.
- **O teste.** Não há um teste só dele; o que pega a volta do problema são os testes que sobem o HTTP (os `*.integration.spec.ts` dos
  controllers) e a api do e2e.

### 6.3 O teste que pegou um token real da Azure pelo `az` (03/11/2026)

- **Sintoma.** Um caso do `cache-refresher.spec.ts` não injetava a credencial, e o `DefaultAzureCredential` do SDK, que tenta várias
  fontes em sequência, chegou à do `az` logado no Mac e pegou um token real do ARM. O token só foi ao `fetch` falso do teste; nada saiu
  para a Azure.
- **Como foi achado.** Na conferência da onda 3d, em 03/11/2026.
- **Correção.** `apps/api/vitest.config.ts#AZURE_TOKEN_CREDENTIALS`: todo teste da api roda só com a `WorkloadIdentityCredential` e sem o
  arquivo do token federado, então todo `getToken` falha na hora, sem rede e sem `az`. O teste que precisa de token injeta um falso
  (`apps/api/src/modules/settlement/application/cache-refresher.spec.ts#credential(goodToken())`), e o que exercita o caminho do SDK troca o
  módulo (`vi.doMock('@azure/identity'`). Entrou no commit `5a254da`.
- **O teste.** A própria configuração vale para todos os testes da api; o `cache-refresher.spec.ts` confere a credencial criada uma vez
  só, sem tocar o SDK de verdade.

### 6.4 A fita da home com um pregão pela metade (revisão de código, 04/11/2026)

- **Sintoma** (achado na revisão, antes de chegar a alguém). Das 21:30 em diante o `eod` grava as barras papel a papel e se reagenda de
  hora em hora se falta papel. Assim que o primeiro papel do universo ganhava a barra do dia, a fita da home passava a mostrar só os papéis
  já gravados ("Os mesmos 3 papéis da B3, lidos por todos os modelos"), e o cache do site guardava esse estado por 300 s.
- **Como a causa foi achada.** Lendo o `quotes.repository.ts`: o pregão da fita era o mais recente com barra de **qualquer** papel, sem
  olhar a cobertura; e o teste só cobria o pregão sem nenhuma barra. Registro: `docs/redesign-ascii/relatorios/revisao-codigo.md`, achado 1.
- **Correção.** A fita usa o pregão mais recente com a **cobertura mínima do briefing** (80% do universo,
  `apps/api/src/modules/briefing/domain/briefing.ts#LIMITS`), olhando no máximo uma semana para trás
  (`apps/api/src/modules/quotes/infrastructure/quotes.repository.ts#TAPE_LOOKBACK_MS`, no `async tape()`).
- **O teste.** `apps/api/src/modules/quotes/presentation/quotes.integration.spec.ts#no meio da carga do fim do dia`.

### 6.5 Uma barra absurda derrubava a carteira de todos os donos do papel (revisão do fechamento da etapa 12)

- **Sintoma.** Uma barra com fechamento gigante (o `daily_bar` só exige `close_cents >= 0`) fazia o valor de mercado sair do inteiro
  seguro do JavaScript, o `safeNumber` lançava, e o `GET /me/portfolio` dava 500 para **todo** usuário que tinha aquele papel.
- **Como a causa foi achada.** Na revisão do fechamento da etapa 12; o ADR registra o achado ("a primeira versão deixava o `safeNumber`
  lançar"), mas não o caminho até ele.
- **Correção.** Um teto de leitura de R$ 450.000,00 por ação (`packages/contracts/src/portfolio-rules.ts#maxCloseCents`): acima dele, a
  posição sai "sem fechamento", como a de um ticker sem barra, e o resto da carteira vale
  ([ADR 0031](adr/0031-carteira-tetos-ticker-sem-chave-patch-inteiro-e-arredondamento.md), item 1).
- **O teste.** `apps/api/src/modules/portfolio/presentation/portfolio.integration.spec.ts#uma barra absurda (acima de R$ 450.000,00)`.

---

## 7. O que ainda não rodou de verdade

Dito sem enfeite, em 06/11/2026:
- **O CI no GitHub nunca rodou.** O repositório é local e não tem remoto. O que o CI faz foi rodado na máquina (`pnpm check`, build, e2e,
  Lighthouse, o check da infra e o ensaio, conferidos do zero nos commits).
- **O deploy na Azure nunca rodou.** A assinatura de estudante ainda não existe; nada está hospedado. O blue/green foi provado só contra um
  Container Apps falso (`scripts/deploy.test.mjs`); o [DEPLOY.md](DEPLOY.md), seção 7, lista o que não foi verificado na Azure.
- **Os alertas nunca dispararam.** As consultas são conferidas localmente contra o texto esperado (`infra/tests/check.mjs#APP_SIGNALS_QUERY`).
- **Os procedimentos do runbook** estão todos marcados como não ensaiados, até o Artur ensaiar.
- **A Temporada 1 real ainda não começou.** Nenhum modelo de verdade foi chamado: os seis modelos da demo têm estratégias falsas com a
  etiqueta "simulado" (commit `a40143a`), e o prompt da arena espera a aprovação do Artur. **Em construção (T0):** o retroativo, de
  13/10/2026, e o operador local, até o último pregão de 2026.
- **O e-mail e o login com o Google** nunca saíram da máquina: em dev o e-mail cai numa pasta (`EMAIL_OUTBOX_DIR`), e o Google precisa
  da configuração do [CONTA.md](CONTA.md).
- **O chat** não existe: começa depois do aval do orientador.

---

## 8. O histórico e o processo

Os commits que existem hoje (`git log`), do mais novo ao mais antigo:

| Commit | Data | O que contém |
|---|---|---|
| `c9ca348` | 06/11/2026 | O provedor de cobertura do Vitest (`@vitest/coverage-v8` 5.0.5) nos três pacotes, registrado no DEPENDENCIAS.md, e a linha de base da cobertura |
| `43ce40c` | 06/11/2026 | Os logos das ações (copiados da brapi, guardados no banco e servidos pelo nosso domínio com CSP própria), a moldura de 1.550 px, o seletor de tema, as peças da Arc, da beUI e da ReUI (MIT) e as velas desenhadas no servidor |
| `3c9db10` | 06/11/2026 | O design no estilo do Rallies AI: a landing, o app com trilho de ícones no desktop e barra de abas no celular, os dois temas e os logos dos laboratórios (LobeHub, MIT). Só o visual como referência: nenhum código, marca, ilustração ou texto deles |
| `a40143a` | 06/11/2026 | A volta do design ASCII da v1, a fita de cotações por rota interna e o elenco simulado da Temporada 1 (seis modelos com estratégias falsas e a etiqueta "simulado") |
| `1330645` | 06/11/2026 | A limpeza diária dos dados pessoais, a política de privacidade 0.3, a saída do legado do COTAHIST e a leitura certa da cota da brapi |
| `5a254da` | 04/11/2026 | As etapas 1 a 12 do TCC: o monorepo, a api e o site, a brapi, notícias e briefing, o motor de decisão, a liquidação e o Monte Carlo, a API pública, a conta com a LGPD, a carteira, a infra em Bicep, o CI/CD com blue/green, a observabilidade e o runbook |

Os quatro do meio têm a data do registro no git (06/11, às 09:04); o trabalho é de 04 e 05/11, como dizem as mensagens ("Estado conferido
do zero em 04/11/2026" e "em 05/11/2026").

**Como o trabalho foi feito.** Em ondas de tarefas, cada uma com uma especificação, um relatório (o que foi feito, os critérios de aceite
com a evidência, os desvios), uma revisão de código e um QA mobile; os relatórios estão em `docs/redesign-*/relatorios/`. O código foi
escrito com agentes (Claude Code), sob a direção do Artur, que decide e responde por cada decisão (os ADRs as registram). O texto oficial
sobre o uso de IA fica no README (**em construção, T2**, para o Artur revisar).

**Como vai seguir, depois que o repositório for público.** Por pull request, nunca direto na `main`: uma branch por mudança, o template
`.github/pull_request_template.md` com a checklist obrigatória (o `pnpm check` verde, o `DEPENDENCIAS.md` em dia, o e2e mobile, nenhum
prompt no diff, migration segura, teste no caso de uso e no endpoint, ADR para decisão nova), o CI como portão e a revisão do squad
antes do merge. O merge na `main` publica pelo `deploy.yml`.

**Manter este guia.** Mudou um arquivo ou um nome que o guia cita? Rode `node scripts/guia-check.mjs`: ele diz a linha da referência
quebrada. A regra das referências é a do começo do guia.
