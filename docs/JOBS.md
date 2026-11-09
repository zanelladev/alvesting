# Agendadores, filas e workers

Tabela operacional do que roda sozinho na Alvesting: quem publica, em qual fila, quem consome e o que acontece quando falha.
Plano: §5.5 e §6. Tudo isto é criado por `infra/modules/containerapps.bicep` e `infra/modules/servicebus.bicep` (visão geral
da infra em `docs/INFRA.md`). Cron do Container Apps é **UTC**; Brasília é UTC−3, sem horário de verão.

```
 job-sched-* (cron UTC) ──publicam──▶ Service Bus (6 filas, DLQ em cada uma)
                                          │ KEDA (identidade gerenciada), por fila
                       ┌──────────────────┴──────────────────┐
                       ▼                                     ▼
        ca-worker-data (0→3)                    job-worker-decisions (por evento)
   market · news · briefing ·                   decisions: 1 mensagem = 1 execução,
   settlement · maintenance                     até 10 ao mesmo tempo, 1500 s cada
```

---

## 1. Agendadores

Só publicam mensagens, com `MessageId` determinístico (`eod:2026-10-30`). Cada um é um job do Container Apps de 0,25 vCPU e
0,5 GiB, que roda `node dist/schedule.js <nome>` com **timeout de 300 s** e **2 retentativas** (publicar de novo é seguro, a
mensagem é idempotente). Os sete dividem a identidade `id-alvesting-sched`: papel de **publicar** no Service Bus, mais o
`database-url` e a telemetria; sem Blob, sem prompt, sem chave de LLM. Só o `cycle` recebe duas variáveis a mais, em texto puro: a
versão do prompt (`PROMPT_ARENA_VERSION`) e o teto de custo do mês (`ARENA_MONTHLY_COST_CAP_USD`).

| Job | Nome | Cron (UTC) | Brasília | Publica em | Mensagem |
|---|---|---|---|---|---|
| `job-sched-news` | `news` | `*/30 * * * *` | a cada 30 min | `news` | seis `fetch {fonte, slot}`, uma por fonte da lista fixa (4 RSS, CVM IPE, BCB SGS) |
| `job-sched-briefing` | `briefing` | `30 10 * * 1-5` | 07:30 seg–sex | `briefing` | `freeze {pregão}`, se for pregão |
| `job-sched-cycle` | `cycle` | `0 11 * * 1-5` | 08:00 seg–sex | `decisions` | uma `decide` por competidor MODEL, se o briefing existe e o teto de custo do mês permite |
| `job-sched-eod` | `eod` | `30 0 * * 2-6` | 21:30 seg–sex | `market` | `eod {pregão}` (o reagendamento fica com o worker) |
| `job-sched-universe` | `universe` | `0 12 * * 0` | domingo 09:00 | `market` | `universe {semana}` (a semana ISO da segunda-feira seguinte) |
| `job-sched-retention` | `retention` | `0 13 * * *` | todo dia 10:00 | `maintenance` | `retention` |
| `job-sched-backup` | `backup` | `0 6 1 * *` | dia 1, 03:00 | `maintenance` | `backup-verify {mês}` |

O `job-migrate` não é agendador: é manual (`prisma migrate deploy`), disparado pelo CI antes de cada revisão nova.

O `eod` roda às 00:30 UTC de terça a sábado, que é 21:30 de segunda a sexta em Brasília (por isso o `2-6`); o pregão é o do dia
anterior à data UTC. O cron não sabe de feriado: se o dia é pregão, quem decide é o código, pelo calendário de
`apps/api/src/modules/market-data/domain/b3-holidays.json` (2026 é a lista oficial da B3; **2027 é provisório**, derivado por
regra até a B3 publicá-la: `docs/DADOS.md`, seção 5). O `eod` e o `briefing` só publicam se o dia for pregão; senão o
agendador sai com 0, sem publicar nada.

O que cada agendador faz (o código está em `modules/<módulo>/application/*-schedulers.ts`, ligado em `src/role.ts`):

- **`eod`:** `eod {pregão}`, com o pregão igual à data de Brasília de agora (às 00:30 UTC ainda é 21:30 do dia anterior).
- **`universe`:** `universe {semana}`, com a semana ISO **da segunda-feira seguinte** (o domingo 01/11/2026 publica
  `2026-W45`). Não consulta o calendário.
- **`news`:** seis `fetch {fonte, slot}`, uma por fonte da lista fixa de `modules/news/domain/sources.ts` (`infomoney`,
  `money-times`, `seu-dinheiro`, `agencia-brasil`, `cvm-ipe` e `bcb-sgs`). O `slot` é a meia hora UTC arredondada para baixo,
  sem milissegundos (`2026-11-01T17:30:00Z`); assim a retentativa do job cai no mesmo `MessageId` (`fetch:<fonte>:<slot>`).
  Roda todo dia, sem calendário. Se uma publicação falha, publica as outras e sai com erro no fim, dizendo quais ficaram de
  fora e a causa da primeira (o job tenta de novo, e publicar de novo é seguro).
- **`briefing`:** `freeze {pregão}`, com o pregão igual à data de Brasília de agora.
- **`cycle`** (etapa 6, `modules/arena/application/cycle-schedulers.ts`): só roda se for pregão. Primeiro **varre** os ciclos
  vencidos que a fila não fechou (`CycleCloser`, `docs/ARENA.md`, seção 5). Depois, para cada temporada `RUNNING` que já começou e não passou do último
  pregão: confere que a linha de `briefing` do pregão existe e que o **teto de custo do mês** permite (`ARENA_MONTHLY_COST_CAP_USD`,
  em dólares; os fakes custam zero e não dependem dele; sem o teto, o ciclo com modelo pago é pulado). Sem briefing ou sem orçamento,
  o ciclo fica registrado como **pulado**, com o motivo, e nenhum modelo é chamado. Senão, fixa no `cycle` o briefing e a versão do
  prompt (`PROMPT_ARENA_VERSION`; o agendador não lê o prompt) e publica uma `decide {ciclo, competidor}` por competidor MODEL
  (`MessageId` `decide:<ciclo>:<competidor>`). Idempotente: o ciclo é único por temporada e pregão, o pulado é reavaliado a cada
  execução e o fechado não republica. Se uma publicação falha, publica as outras e sai com erro no fim (o job tenta de novo). Variáveis
  e detalhes: `docs/ARENA.md`, seção 2.
- **`retention` e `backup`** (etapa 10, onda 3d, `modules/maintenance/application/maintenance-schedulers.ts`): `retention {data}`, com a data de Brasília de agora (todo dia às 10:00, uma mensagem por dia), e
  `backup-verify {mês}`, com o **mês de Brasília** (dia 1, 03:00; o 1º de dezembro às 02:59 UTC ainda é novembro lá). Só publicam, com `MessageId` determinístico (`retention:2026-11-04`,
  `backup-verify:2026-11`). Os sete nomes da tabela de agendadores têm código: um nome fora dela (e chaves herdadas como `toString`) sai com 1, com a lista dos que existem.

---

## 2. Filas

Service Bus **Basic**: só filas, sem tópicos, sessões nem detecção de duplicata (a idempotência está no banco). Todas com
dead-letter na expiração, lock de 1 minuto e TTL de 1 dia.

| Fila | Produtor | Consumidor | Mensagem | Entregas máx. | Concorrência no processo |
|---|---|---|---|---|---|
| `market` | `job-sched-eod`, `job-sched-universe` | `ca-worker-data` | `eod {pregão}` · `universe {semana}` | 10 | 1 |
| `news` | `job-sched-news` | `ca-worker-data` | `fetch {fonte, slot}` | 5 | 4 |
| `briefing` | `job-sched-briefing` | `ca-worker-data` | `freeze {pregão}` | 5 | 1 |
| `decisions` | `job-sched-cycle` | `job-worker-decisions` | `decide {ciclo, competidor}` | 3 | 1 por execução, até 10 execuções |
| `settlement` | `ca-worker-data`, após o `eod` | `ca-worker-data` | `settle {temporada, pregão}` | 5 | 1 (serializa) |
| `maintenance` | `job-sched-retention`, `job-sched-backup` | `ca-worker-data` | `retention` · `backup-verify` | 3 | 1 |

Os números de entregas e concorrência são os de `packages/contracts` (`QUEUES`); o `docker/servicebus/Config.json` do emulador
repete as entregas, e há teste que confere os dois.

### 2.1 O handler de cada mensagem (etapas 4 a 6)

O `ca-worker-data` liga cada fila ao handler dela em `src/role.ts` (`queueHandlers`): `market` ao `MarketQueueHandler`, `news` ao
`FetchHandler`, `briefing` ao `FreezeHandler`, `settlement` ao `SettleHandler` e `maintenance` ao `MaintenanceQueueHandler` (despacha a `retention` e o `backup-verify`, seção 8). Cada um é uma função `(mensagem, entrega?) =>
Promise<void>`, testável sem fila, e começa por **assumir** a linha de `job_run` da mensagem (seção 7). A `entrega` (`{ attempt,
lastAttempt }`) é opcional e quase todos a ignoram; o `DecideHandler` a usa para a última entrega (seção 3.2). Uma mensagem inválida, ou de outra fila, vai direto para a DLQ (`handleDelivery`). A fila `decisions` **não** é
consumida pelo worker: quem a consome é o `job-worker-decisions`, com `MessagingService.receiveOne`.

| Mensagem | Chave em `job_run` | O que faz | Detalhe |
|---|---|---|---|
| `eod {pregão}` | `eod` + pregão | pede à brapi, um papel por vez, só as barras que o banco não tem (o universo da semana, o BOVA11 e as posições; depois as carteiras), grava cada papel assim que chega, confirma o pregão e pede a liquidação | seção 4; `docs/DADOS.md`, seções 6 e 7 |
| `universe {semana}` | `universe` + semana | antes de escolher, a atualização semanal da brapi (a lista de ações semeia papel novo, que recebe 3 meses, e o candidato fora do conjunto diário recebe a semana; no fim, os logos das ações, do icons.brapi.dev, só o que falta, mudou de endereço ou tem mais de 30 dias: ADR 0036); depois congela o universo da semana a partir dos 60 pregões anteriores à segunda-feira (até 500 ações, presença de 90%), sobre as barras da brapi (volume estimado) | `docs/DADOS.md`, seção 8 |
| `fetch {fonte, slot}` | `fetch` + `fonte:slot` | busca uma fonte: RSS e CVM IPE viram `news_item`, BCB SGS vira `macro_daily` | `docs/DADOS.md`, seções 13 a 16 |
| `freeze {pregão}` | `freeze` + pregão | monta o briefing das 07:30, grava os bytes no Blob (`briefings/<pregão>/<sha256>.json`) e a linha de `briefing` | seção 4; `docs/DADOS.md`, seção 18 |
| `decide {ciclo, competidor}` | `decide` + `ciclo:competidor` | uma decisão de um modelo: prazo, prompt, briefing, gateway com 1 reparo, validação, IO bruto no Blob `llm-io` e a `decision`. É do `job-worker-decisions`, não do worker | seção 3.2; `docs/ARENA.md` |
| `settle {temporada, pregão}` | `settle` + `temporada:pregão` | recalcula a temporada **do zero** até o pregão (ou até o último já liquidado, se for mais novo) e substitui as linhas derivadas: ordens, execuções, posições, patrimônio, métricas e Monte Carlo. O último pregão encerra a temporada | seção 4.1; `docs/METODOLOGIA.md` |
| `retention {data}` | `retention` + data | apaga o que a política de privacidade promete (sessão vencida, pedido de uso único vencido, cadastro nunca confirmado com mais de 6 dias, que some em até 7 depois de criado) e o `job_run` do `fetch` com mais de 30 dias, em lotes | seção 8.1 |
| `backup-verify {mês}` | `backup-verify` + mês | `pg_dump` do banco (sem os dados das tabelas pessoais) para o Blob `backups`, restauração num banco temporário e conferência das contagens; o banco temporário some | seção 8.2 |

---

## 3. Workers

### 3.1 `ca-worker-data`

- **Imagem da api**, comando `node dist/worker.js`. 0,5 vCPU / 1 GiB. **Sem ingress.**
- **0 a 3 réplicas.** Uma regra KEDA `azure-servicebus` por fila (`market`, `news`, `briefing`, `settlement`, `maintenance`),
  `messageCount: 5` (alvo de mensagens por réplica), autenticada pela identidade do KEDA (`id-alvesting-scale`, só das regras de
  escala; o código usa a `id-alvesting-worker`). A primeira mensagem já acorda o worker; ele só volta a zero depois de 5 minutos
  sem mensagem (período de resfriamento do Container Apps). Se o worker não acordar com mensagem na fila, veja a seção 11 do
  `docs/INFRA.md` (o KEDA pode exigir mais papel que a identidade tem).
- Consome as filas ao mesmo tempo, cada uma com a concorrência da tabela acima. O código consome as cinco que a regra do KEDA acorda
  (`market`, `news`, `briefing`, `settlement` e, desde a etapa 10, `maintenance`; a `decisions` é do job de decisões). O
  `settlement` serializa por trava consultiva no Postgres (uma por temporada), não por réplica: duas réplicas podem liquidar temporadas
  diferentes ao mesmo tempo, e a mesma temporada nunca (seção 4.1).
- **Encerramento:** o worker fica de pé até receber SIGTERM ou SIGINT. Aí cada consumidor para de pedir mensagens, espera os
  handlers em curso por até 270 s (`DRAIN_TIMEOUT_MS`; a busca da brapi do `eod` leva até 4 min) e só então fecha o receiver,
  para o `complete` ainda achar o link aberto (o SDK não espera por conta própria). Por isso o template define
  `terminationGracePeriodSeconds: 300`: com os 30 s padrão o SIGKILL chegaria no meio do `eod`. O que passar dos 270 s perde a
  trava e volta para a fila, e a linha de `job_run` barra a repetição.
- Lê `DATABASE_URL`, `BRAPI_TOKEN`, `WEB_INTERNAL_URL`, `REVALIDATE_SECRET` e `FRONT_DOOR_ENDPOINT_ID` (os três últimos são da revalidação e do purge,
  seção 4.2) e **não** recebe o prompt nem a chave do OpenRouter. Tem Blob (briefing e
  backup, este em fluxo pelo `backup-verify`) **por container**: `briefings` e `backups`. As cotações não vão ao Blob. Ele NÃO tem papel no `llm-io` (só as decisões o gravam, e nada o lê; `docs/INFRA.md`, 3.2 e ADR 0030). O IO bruto
  continua sem o texto do prompt, agora como defesa em profundidade (regra 4 do `CLAUDE.md`, com o teste de canário), e não porque o worker o alcançaria. Tem também o purge do Front Door. O ambiente de cada workload está na tabela da seção 2.7 do `docs/INFRA.md`.
- **O que o código das etapas 4 e 5 lê do ambiente:** `DATABASE_URL`, `SERVICEBUS_FQDN`, `STORAGE_BLOB_ENDPOINT`, `AZURE_CLIENT_ID`
  (o `DefaultAzureCredential` a lê sozinho) e `BRAPI_TOKEN` (o valor `PENDENTE` do Key Vault vale como ausente). Nenhuma variável
  nova para a infra: `STORAGE_CONNECTION_STRING` é só do Azurite em dev e no CI.
- **Blob:** escreve em `briefings` (o briefing congelado) e em `backups`. Os containers são criados pela
  infra; só no Azurite o código cria o que falta (`ContainerNotFound`).
- **Saída para a internet (HTTPS, 443):** `brapi.dev` (a única fonte de cotação; nada mais é baixado da B3), os feeds `www.infomoney.com.br`,
  `www.moneytimes.com.br`, `www.seudinheiro.com` e `agenciabrasil.ebc.com.br`, `dados.cvm.gov.br` e `api.bcb.gov.br`. Hoje a
  saída é livre (`docs/INFRA.md`, 3.1). Não verificado na Azure: algum site pode recusar o IP de saída.
- **Os agendadores** montam o cliente do Blob, mas nunca o usam; a `id-alvesting-sched` não tem papel de Blob e não precisa.
- **O `backup-verify` chama o `pg_dump` e o `pg_restore` do PATH da imagem** (`postgresql-client-17`, o major do servidor, do repositório PGDG: a imagem da api e o job `check` do CI o trazem desde a parte 4 da etapa 10, `docs/INFRA.md`, 2.8, e o código recusa binário de outro
  major), e cria e apaga um banco temporário no servidor com o login administrador (o `DATABASE_URL` do worker). Os workers seguem com esse login; só a api tem o papel mínimo (`docs/INFRA.md`, 2.2).

### 3.2 `job-worker-decisions`

- **Imagem da api**, comando `node dist/decide.js`. 0,5 vCPU / 1 GiB. Job **por evento** na fila `decisions`.
- **1 mensagem = 1 execução.** Cada execução tem 1 réplica (`parallelism: 1`, `replicaCompletionCount: 1`) que trata 1 mensagem e
  sai. **Até 10 execuções ao mesmo tempo** (`scale.maxExecutions: 10`; é o "paralelismo 10" do plano) e o roster de ~30 modelos
  cabe. KEDA consulta a fila a cada 30 s, então a execução começa até 30 s depois da mensagem.
- **Timeout de 1500 s (25 min) por execução** e **sem retry da réplica** (`replicaRetryLimit: 0`): quem reentrega é a fila. Um
  modelo lento ou quebrado não atrasa os outros.
- **O que cada execução faz** (etapa 6, `src/decide.ts`, `modules/arena/application/decide.handler.ts`): `MessagingService.receiveOne`
  busca **uma** mensagem de `decisions` (espera até 30 s por ela; se outra execução já a levou, sai com 0 sem fazer nada), trata e sai
  com 0, inclusive quando agendou nova tentativa ou mandou para a DLQ. Só erro de verdade (broker, trava perdida) sai com 1. O tratamento:
  `job_run` (`decide` + `ciclo:competidor`); ciclo e competidor; **prazo**; **igualdade do prompt** (versão e SHA-256 contra os do ciclo);
  briefing do Blob contra o SHA-256 da linha; a parte própria (caixa, posições e 30 pregões de barras delas); o gateway (com 1 reparo);
  validação; filtro de vazamento; IO bruto no Blob; `decision`. Detalhes: `docs/ARENA.md`, seção 3.
- **O prazo é 09:30** (Brasília): a execução que começa depois não chama o modelo e grava **HOLD `prazo`**; a que está esperando o
  modelo é abortada no prazo (o timeout de cada chamada é o menor entre o que falta até 09:30 e os 1500 s do job menos 2 minutos), e a
  decisão também vira HOLD `prazo`. Independentemente da fila.
- **Falhou: a DLQ vira HOLD registrado** (plano §5.5; ADR 0015 e 0021). Nas duas primeiras entregas o `MessagingService` agenda uma cópia da
  mensagem para daqui a 10 e 20 minutos e conclui a original. Na **terceira** (a última) o `DecideHandler` recebe `lastAttempt` e, se falhar de
  novo, **grava a decisão como HOLD `falha`** e conclui a mensagem, que **não vai para a DLQ**; o `job_run` fica `FAILED` com o erro. Só se nem
  o HOLD puder ser gravado (banco fora) a mensagem vai para a DLQ. A rede de segurança é a **varredura** (`CycleCloser`, no `sched-cycle` e no
  início do `settle`): ciclo `OPEN` vencido há mais de 15 minutos fecha, e quem não tem decisão ganha HOLD `sem_resposta`. O ciclo fecha quando
  todos os MODEL têm decisão, normal ou HOLD forçado. **A exceção é o erro de configuração** (chave ausente, recusada ou sem crédito, HTTP
  401 e 402; prompt ausente ou sem canário): ele não vira HOLD nem na última entrega, a mensagem vai para a DLQ e o par fica sem decisão
  (`docs/ARENA.md`, seção 5; o `arena:retroativo` para no pregão antes da liquidação).
- **O reparo e o HOLD que guarda a chamada paga.** O reparo (a segunda chamada) só começa com 3 minutos de folga, no prazo e no job;
  sem eles, a primeira resposta vira HOLD `resposta_invalida` (ou `prazo`) **com o IO bruto e o custo**, em vez de se perder na nova
  tentativa da fila. `lockRenewalMs` (26 min) é maior que o `replicaTimeout` (25 min) por regra, com teste; se uma execução assumir
  uma linha `RUNNING` velha com a dona ainda viva, a segunda decisão não vale (`already_decided`) e o log avisa o custo pago que não
  entrou no teto.
- **O alerta de segurança (etapa 10).** Quando o filtro de vazamento age, o `DecideHandler` registra um aviso no log (`o filtro de
  vazamento agiu`, com `leakFields` e `ioLeakPaths`: só nomes de campos, nunca texto) além de `decision.leak_fields`. A etapa 10 criou o
  alerta para esse aviso e para mais de 2 HOLD `falha` ou `resposta_invalida` no pregão (cada um escreve a linha `HOLD forçado por falha ou resposta
  inválida`): o ADR 0021 tirou da DLQ o modelo que apenas falha, e sem este alerta esses casos não teriam sinal nenhum. Os dois são sinais da regra
  `alvesting-sinais-da-aplicacao` (`docs/INFRA.md`, seção 5.3). A decisão também alimenta as métricas `llm.tokens`, `llm.cost_usd` e
  `decision.invalid`, e o fechamento do ciclo, a `cycle.duration` (seção 5.2). Prompt sem a linha de canário é `LlmConfigError` (HOLD `falha`
  na última entrega), então também aparece.
- **Único workload com o prompt da arena e a chave do OpenRouter** (`id-alvesting-decisions`). O prompt chega como `PROMPT_ARENA`,
  por referência ao Key Vault, numa versão fixa; `PROMPT_ARENA_VERSION` traz essa versão (não é segredo) para o banco registrá-la
  com o SHA-256 do texto. O código lê `process.env`, sem SDK do Key Vault, guarda os dois dentro de um `Secret` que não aparece em
  log nem em JSON e **apaga o texto cru de `process.env`** depois do parse (um despejo do ambiente, um relatório de falha ou a
  telemetria não o expõem). Tem Blob para o IO bruto das LLMs e não tem purge.
  **O IO bruto grava o SHA-256 e a versão do prompt, nunca o texto** (critério de aceite da etapa 6, com teste de canário: o
  worker-data lê o mesmo container, `docs/INFRA.md`, 3.2, item 4).

### 3.3 `job-migrate`

Manual. `node node_modules/prisma/build/index.js migrate deploy`, timeout de 900 s, sem retry. Só recebe `DATABASE_URL`. Roda com a
`id-alvesting-migrate`, que é só da plataforma (puxa a imagem e lê o `database-url`; o código não recebe token dela).

**O login da api (etapa 10, onda 3d).** Depois do `migrate deploy` roda `node dist/db-roles-cli.js` (`pnpm --filter @alvesting/api db:roles`), idempotente: cria o login `alvesting_api` (membro do papel de grupo
que a migration `20261103100000_api_role` cria) e define a senha dele, lida da `API_DATABASE_URL`, com o login administrador. A senha vai ao servidor como resumo SCRAM e nunca em argumento, migration ou log
(`docs/INFRA.md`, 2.7). O comando já existe e é testado, e **desde a parte 4 da etapa 10 o `job-migrate` o roda** (`sh -c 'migrate deploy && node dist/db-roles-cli.js'`, com o `API_DATABASE_URL` vindo do segredo `database-url-api` do Bicep: `docs/INFRA.md`, 2.2 e 2.3). Nada rodou na Azure.

---

## 4. Um pregão (plano §7)

| Brasília | Evento |
|---|---|
| a cada 30 min | `job-sched-news` publica uma `fetch` por fonte; o worker ingere |
| 07:30 | `job-sched-briefing` publica `freeze`; o worker congela a entrada (SHA-256) |
| 08:00 | `job-sched-cycle` publica uma `decide` por modelo; uma execução do `job-worker-decisions` por modelo |
| 09:30 | Prazo: sem resposta = HOLD |
| 10:00 | Abertura: preço oficial de abertura = preço de execução |
| 21:30 | `job-sched-eod` publica `eod`; o worker pede à brapi as barras que faltam, publica `settle`, liquida, rende o CDI e roda o Monte Carlo (etapa 7, seção 4.1) e, concluída a liquidação, revalida o site e limpa o cache do Front Door (etapa 9, seção 4.2) |

- **O `eod` e a brapi (onda da brapi, ADR 0032; `docs/DADOS.md`, seções 6 e 7):** o `eod` monta o conjunto obrigatório (o universo da semana ISO,
  o BOVA11 e os papéis em posição de temporada em andamento) e pede à brapi **só a falta**, um papel por vez, o BOVA11 primeiro. Cada
  papel é gravado assim que chega; a falha de um papel (429 com `Retry-After`, 5xx, timeout, JSON fora do formato) não refaz a lista: a
  nova tentativa pede só o que falta. Se a resposta do BOVA11 não traz a barra do dia, a brapi ainda não a publicou e a passada custa uma
  requisição. Enquanto falta papel do obrigatório e o prazo não chegou, o worker publica a mesma `eod` com entrega agendada para daqui
  a 60 min, deixa o `job_run` em `WAITING` com o texto "faltam N de M papéis do conjunto obrigatório em <data>; nova tentativa agendada
  para <instante>" e **conclui** a mensagem original; a cópia agendada reassume a linha. Isso não é falha de verdade: não gasta entrega
  (a cópia sai sem o contador `attempt`), e o alerta de job falho não o conta, porque olha só o `FAILED`. O último agendamento é
  encaixado em 00:30 de Brasília do dia seguinte; a tentativa que cai a partir daí **conclui com o que tem**, registra a falta
  (a contagem e os 20 primeiros) e dispara o `eod-barras-ausentes` se faltar o BOVA11 ou mais de 10% do obrigatório. O opcional (as
  carteiras dos usuários) é pedido uma vez, na tentativa que conclui, e não segura a conclusão. A mensagem agendada conta como
  "agendada", não "ativa": o KEDA só acorda o worker quando ela vira ativa.
- **O que falha de verdade no `eod`:** 401, 402 ou 403 da brapi (token ausente, recusado ou plano sem o recurso) encerra a busca, deixa o
  `job_run` em `FAILED` (alerta `job-falhou`) e segue a regra da fila (até 10 entregas, depois a DLQ), sem o corpo da resposta e sem
  refazer a lista; o que já foi gravado fica. Cota restante na reserva (`brapi-cota-baixa`), 5 papéis seguidos sem resposta ou o fim do
  orçamento de 4 minutos **não** falham a mensagem: o resto fica como falta e o fluxo acima (nova tentativa em 60 min, prazo às 00:30)
  cuida dele.
- **A noite em que a brapi esteve fora:** se a brapi não deu nenhuma barra até 00:30, o pregão não é confirmado nem liquidado (a mensagem
  conclui e o `eod-barras-ausentes` alerta). O `eod` da noite seguinte pede, a cada papel, do pregão mais antigo que lhe falta na
  janela de 5 pregões até o de hoje (uma requisição por papel), confirma os dois pregões e a liquidação do mais novo refaz a temporada
  do zero, na ordem das datas. Fora da janela (mais de 5 pregões sem brapi), o `market:backfill` com `--de` recupera (RUNBOOK).
- **A noite do `universe`:** o domingo começa pela atualização semanal (a lista de ações, o papel novo, a semana dos candidatos e, no
  fim, os logos das ações: a passada reconfere os SVG guardados e baixa o que precisa, `docs/DADOS.md`, seção 3a) e só depois escolhe. A
  falha dos logos vira um aviso e nunca derruba o universo. O `universe` exige os 60 pregões confirmados: se algum falta (a brapi fora por mais de 5 pregões, a carga inicial que
  não rodou), falha dizendo os dias e pedindo a carga (`market:backfill`, seção 6), repete até 10 vezes e vai para a DLQ; corrigido o
  dado, reenviar a `universe`.
- **O `freeze` das 07:30 (etapa 5):** monta o briefing do banco (o universo congelado da semana, embaralhado pela semente do
  pregão, com o último fechamento; barras de até 30 pregões, até o anterior, só da triagem e das ações citadas nas notícias;
  macro do BCB; e as notícias vistas em (corte anterior, 07:30 de hoje]), grava os bytes em
  `briefings/<pregão>/<sha256>.json` e depois a linha de `briefing` (pregão único, SHA-256, URI). O corte das notícias é fixo
  em 07:30:00 de Brasília, e `news_item.first_seen_at` é a hora da gravação; chegando entre 07:30:00 e 07:30:10, o `freeze`
  espera até 07:30:10 antes de ler. Falha, sem gravar nada, se: ainda não são 07:30; não há universo congelado da semana ISO do
  pregão (o `universe` de domingo tem de ter rodado); menos de 80% do universo tem fechamento do pregão anterior (o `eod` do dia
  anterior falhou ou atrasou); ou já existe o briefing de um pregão posterior (os briefings são congelados em ordem). Dia sem
  pregão: ignora, sem assumir `job_run`. Repetido, não remonta nem regrava o Blob. Acima de 300 KB avisa no log ("briefing
  grande") e não corta nada (`docs/ARENA.md`, seção 10, tem a conta do pior caso e por que o elenco da Temporada 1 comporta). O
  bloco `rules` do briefing (capital, duração, posições, custo e horários) vem de `season.params` da temporada RUNNING que já
  começou no pregão, e das constantes da Temporada 1 se não há nenhuma; duas temporadas RUNNING com regras diferentes fazem o
  `freeze` falhar, porque o briefing do pregão é um só. Se o `freeze` for para a DLQ (5 entregas, uns 10 minutos), o ciclo das 08:00 fica sem briefing:
  corrija a causa e reenvie a `freeze` antes das 08:00 (painel `/admin`, DLQ; etapa 10); o `sched-cycle` só publica se a linha de
  `briefing` do pregão existir (senão registra o ciclo como pulado, `sem_briefing`, e roda de novo: um `freeze` reenviado depois das
  08:00, seguido de "Reprocessar um ciclo" no painel (`POST /admin/cycles/:date/rerun`, `docs/API.md`, seção 8), reabre o ciclo, até 5
  minutos antes do prazo das 09:30). O `az containerapp job start --name job-sched-cycle` faz o mesmo trabalho, mas **não confere o
  prazo**: iniciado perto ou depois das 09:30, publica `decide` que viram HOLD `prazo`. Prefira o painel.
- **Atraso das fontes de notícia (não é defeito):** a CVM refaz o IPE e o FCA uma vez por dia, por volta de 07:00 de Brasília,
  atrás de um CDN de 4 h, e o corte do briefing é 07:30:00, então o fato relevante entra no briefing **um a dois pregões depois**
  de entregue (`docs/DADOS.md`, seção 14). A busca da CVM é condicional (ETag em `fetch_state`): em 47 de 48 buscas do dia a
  resposta é 304 e nada é lido. A notícia de RSS publicada depois da busca das 07:00 só é vista pela das 07:30, que roda depois
  do corte, e entra no briefing do dia seguinte.
- **Encadeamento `eod` → `settle` → revalidação e purge (etapas 7 e 9, seções 4.1 e 4.2):** o `eod` que gravou barras publica a liquidação das
  temporadas que têm o pregão, e o `settle` concluído pede ao site que revalide e limpa o cache do Front Door.
- **Idempotência (etapas 4 e 5):** a chave natural de cada mensagem é única no banco (`job_run`, `unique (type,
  idempotency_key)`): pregão no `eod` e no `freeze`, semana no `universe`, `fonte:slot` no `fetch`, ciclo + competidor no
  `decide`, temporada + pregão no `settle`. Mensagem repetida não faz nada, e por isso o Basic basta. Os detalhes de como a linha é
  assumida estão na seção 7.

### 4.1 A liquidação (etapa 7)

O `settle {temporada, pregão}` recalcula a temporada **do primeiro pregão até D, do zero**, e substitui o resultado anterior. Regras de
conta (execução, custo, CDI, evento, Monte Carlo, métricas): `docs/METODOLOGIA.md`. O que importa à operação:

- **Quem publica.** O `eod` (`EodHandler`, com o `SettlementPublisher`) publica **uma** `settle` por temporada `RUNNING` ou `FINISHED`
  que tem o pregão, depois de o pregão concluir, e com o pregão mais novo entre os que acabaram de ser **confirmados** (o do dia e os de
  dias anteriores da janela que a brapi só entregou agora, depois de uma noite fora: a liquidação do zero processa os anteriores em ordem
  de data). Pregão fora da temporada (antes do início, depois do último) não publica. Isto acontece **antes** de a linha do `eod` ser
  concluída: se a publicação falhar, a fila repete o `eod` (que não pede nada, as barras já estão no banco) em vez de perder o
  encadeamento; e o `eod` repetido de um dia já concluído republica, caso a publicação anterior tenha se perdido.
- **Refazer o que já foi feito.** O `job_run` do `settle` barra a mensagem repetida (`settle repetido não muda nada`). O `eod` **nunca** reabre
  uma liquidação: a barra gravada não muda (só inserção), e a que chega atrasada para um pregão já liquidado é gravada sem pedir `settle`
  (entra no resultado quando a próxima liquidação regular recalcula a temporada; reprocessar antes é decisão do admin, RUNBOOK). Quem reabre é o
  evento corporativo novo (`JobRunStore.reopen`: marca `FAILED` com o motivo, e a próxima entrega a reassume como nova tentativa). Reabrir uma
  linha `RUNNING` tira a posse do dono antigo: o `succeed` dele não vale e a liquidação nova refaz com o dado novo.
- **Trava.** A leitura, a conta e a gravação acontecem numa transação só, que segura a **trava consultiva do Postgres da temporada**
  (`pg_advisory_xact_lock`). Duas liquidações da mesma temporada (de réplicas diferentes, ou de pregões diferentes) se enfileiram; a
  segunda lê depois que a primeira gravou. Temporadas diferentes não esperam uma pela outra. Tudo dentro da trava usa o cliente da transação:
  o pool tem 4 conexões por processo, e uma consulta de fora, esperando conexão enquanto a transação espera a trava, travaria as duas. A
  transação sobe o `idle_in_transaction_session_timeout` local para os 120 s dela (o do pool é 30 s): o Monte Carlo é CPU entre duas
  consultas, e sem isso o teto do contrato (10.000 carteiras) no worker de 0,5 vCPU perderia a conexão a cada entrega, com o erro enganoso
  de conexão, até a DLQ (ADR 0022).
- **Até onde vai.** Até o maior entre o pregão da mensagem e o último pregão já liquidado: uma cópia que chega tarde, ou a reliquidação
  de um dia antigo, refaz também os dias seguintes, e **nunca encolhe** a temporada. A mensagem tem de ser de um pregão da temporada
  (do primeiro ao último dela) e de uma temporada iniciada; senão falha dizendo qual.
- **Antes de ler as decisões.** A varredura dos ciclos vencidos (`CycleCloser.closeOverdue`) fecha o que a fila não fechou: quem não decidiu
  ganha HOLD `sem_resposta`. Ciclo `SKIPPED`, ausente ou com HOLD forçado vira HOLD de todos. Só o item que valeu (`dropped = false`) é lido.
- **Dados incompletos: não liquida, não apaga nada, falha para a fila tentar de novo** (`IncompleteDataError`, e `MissingCdiError` do domínio):
  pregão da temporada sem barra de nenhuma ação do universo (as barras do dia não foram carregadas); semana sem universo congelado; nenhum CDI
  publicado até o pregão anterior. Ação da carteira sem barra no dia **não** é incompleto: a ordem não executa e a posição é marcada pelo último
  fechamento (`daily_bar` nunca é denso). A transação desfaz tudo, e o resultado anterior continua inteiro. Cinco entregas ao longo de uns
  10 minutos; depois, DLQ (seção 5).
- **Encerrar a temporada.** Quando o pregão liquidado é o último dela (`params.sessions`), a mesma transação marca `FINISHED` e grava
  `finished_at`. Reliquidar uma temporada encerrada (barras trocadas depois, evento) refaz o resultado e mantém a hora do encerramento.
- **Evento corporativo.** `pnpm --filter @alvesting/api settle:event` (seção 6) registra o evento e reliquida direto, sem a fila. A rota `POST /admin/corporate-events` e o painel **não** reliquidam: a api
  não escreve nas tabelas de resultado (papel mínimo do Postgres, ADR 0028), então registram o evento, reabrem o `job_run` da `settle` de cada temporada que já passou da data ex e a **publicam na fila**; é este
  `SettleHandler`, no worker, que liquida (e revalida o site e limpa a borda).
- **Decisão.** O `job-worker-decisions` lê a carteira de cada modelo da **última liquidação antes do pregão** (caixa, posições, preço médio e as
  barras de 30 pregões delas). Se a liquidação do pregão anterior atrasou, ou nenhuma rodou e o pregão não é o primeiro da temporada (vale a
  carteira inicial), ele decide com a que existe e o log avisa (`a carteira da decisão não é a do pregão anterior`); a liquidação de depois
  executa a decisão sobre a carteira certa e registra a ordem que deixou de caber.
- **Custo.** 500 ações × 20 pregões, 1.000 carteiras aleatórias, pelo banco: cerca de 1,2 s para o `settle` do último pregão (ele lê ~9,5 mil
  barras e grava ~10 mil linhas de posição); medido num Mac arm64 com Postgres local (`docs/METODOLOGIA.md`, desempenho).

### 4.2 Depois da liquidação: revalidar o site e limpar a borda (etapa 9)

Quando uma `settle` termina (`SettleHandler`, depois de gravar o resultado e de marcar o `job_run` como `SUCCEEDED`), o worker faz duas chamadas, **nesta ordem**
(`CacheRefresher`, `modules/settlement/application/cache-refresher.ts`; formatos e limites em `docs/API.md`, seção 2):

1. **Revalidação do site:** `POST {WEB_INTERNAL_URL}/interno/revalidar` com `Authorization: Bearer {REVALIDATE_SECRET}`. O site vence as tags `arena` e `news` do cache de dados do Next; a próxima leitura de cada página busca o dado novo na API.
2. **Purge do Front Door:** `POST https://management.azure.com{FRONT_DOOR_ENDPOINT_ID}/purge?api-version=2025-06-01` com `{"contentPaths":["/api/v1/*"]}`, usando o token da `id-alvesting-worker`
   (que tem só a ação `Microsoft.Cdn/profiles/afdEndpoints/purge/action`). A API da Azure responde 202 e propaga em até 10 minutos.

Cada chamada tem prazo de 10 s e nenhuma segue redirecionamento (o Bearer e o token só vão para o endereço configurado). **A falha de uma ou das duas não falha a liquidação**: o resultado já está gravado e o job concluído, e a falha vira um aviso no log (`cache_publico_falhou`, com a etapa e o status, ou o nome do erro e, numa falha de rede, o código curto do erro de sistema em `causa`: `ECONNREFUSED`, `ENOTFOUND`, `UND_ERR_CONNECT_TIMEOUT`; nunca URL, cabeçalho, mensagem nem segredo). O tempo de vida do cache
público (300 s) limita o atraso. A segunda chamada roda mesmo que a primeira falhe. **Sem as variáveis** (dev, o ensaio, o comando `settle:event` e o perfil econômico, que não tem Front Door) cada passo é pulado com uma linha de log. A mensagem `settle` repetida (`already_done`) não chama nada: nada mudou.
O que se vê no Log Analytics: `ContainerAppConsoleLogs_CL | where Log_s has "cache_publico_falhou"`. O worker recusa subir com `REVALIDATE_SECRET` de menos de 32 caracteres e, em produção, com `WEB_INTERNAL_URL` que não seja https (nem loopback). A credencial da identidade é criada na primeira liquidação e reaproveitada.

---

## 5. DLQ (mensagem morta)

Depois do número máximo de entregas (ou do TTL de 1 dia) a mensagem vai para a dead-letter queue da própria fila. O alerta de
"mensagem na DLQ de qualquer fila" é o `alvesting-dlq-qualquer-fila` (etapa 10, `docs/INFRA.md`, seção 5.3): um e-mail por fila, em até 10
minutos. O reenvio, depois de corrigir a causa, é o botão "Reenviar" do painel `/admin` (seção "Filas e DLQ") ou `POST /admin/dlq/:queue/resubmit` (etapa 10, parte 2;
`docs/API.md`, seção 8): pelo MessageId, até 10 por chamada, **idempotente** (o que já saiu da DLQ responde `not_found`, sem publicar de novo) e com a linha em `audit_log`. Por baixo é o
`MessagingService.resubmitDeadLetter` (etapa 1), que só tira a mensagem da DLQ depois de publicá-la na fila. O painel lê a DLQ de cada fila por *peek* (20 mensagens no máximo) com o papel de Receiver da api.

O que cada fila do worker-data manda para a DLQ hoje. A espera entre as entregas é `retryDelayMs × tentativa` (1, 2, 3... minutos; 10 e 20 minutos na `maintenance`):

| Fila | Entregas | Vai para a DLQ quando |
|---|---|---|
| `market` | 10 (uns 45 min de espera ao todo) | o `eod` ou o `universe` falha nas 10: brapi com 401, 402 ou 403 (token ausente, recusado ou plano sem o recurso), banco fora, sem universo da semana, a publicação do `settle` que não sai, janela do `universe` incompleta, outra entrega ainda dona da linha (`JobBusyError`). Falta de barra, 429, 5xx e cota baixa **não** vão: o `eod` as trata reagendando e conclui a mensagem |
| `news` | 5 (uns 10 min) | a `fetch` falha nas 5: feed fora do ar ou sem resposta, resposta acima do teto, redirecionamento fora da lista, cabeçalho do CSV da CVM que mudou, série do BCB que falha |
| `briefing` | 5 (uns 10 min) | o `freeze` falha nas 5: sem universo da semana, cobertura abaixo de 80%, briefing posterior já existe, Blob fora, ainda antes das 07:30 |
| `settlement` | 5 (uns 10 min) | o `settle` falha nas 5: dados incompletos (pregão da temporada sem barras carregadas, semana sem universo, sem CDI), temporada inexistente ou não iniciada, pregão fora da temporada, outra entrega ainda dona da linha (`JobBusyError`), banco fora |
| `maintenance` | 3 (10 e 20 min de espera: a última entrega cai 30 min depois da primeira) | a `retention` ou o `backup-verify` falha nas 3: banco fora, `pg_dump`/`pg_restore` ausente ou de outro major, tabela sem decisão na matriz, contagem diferente depois da restauração, prazo de 20 min estourado, Blob fora, ou outra entrega ainda dona da linha (`JobBusyError`) por mais que os 30 min |
| todas | — | corpo que não é JSON, fora do schema, ou de outra fila: na hora, sem gastar entrega |

Reenviar da DLQ: o `eod`, o `universe`, o `freeze` e o `settle` valem depois de corrigida a causa (a linha de `job_run` fica `FAILED` e
é reassumida). Para o `settle` de um pregão sem barras, a correção é carregar o dia (`market:backfill --de <dia> --ate <dia>`, RUNBOOK) e reenviar a mensagem; o
resultado anterior da temporada não foi tocado enquanto isso. Uma `fetch` antiga é inútil, porque o slot seguinte rebusca o mesmo feed: um feed fora do ar por mais de uns 10
minutos manda a mensagem do slot para a DLQ, ruído que a etapa 10 trata no alerta.

**Reenviar uma mensagem da `maintenance` (`retention` ou `backup-verify`) só adianta quando o `job_run` dela não está `RUNNING`.** Se a réplica caiu no meio do `backup-verify` (deploy, falta de memória, escala para zero), a
linha fica `RUNNING` e só é reassumida **25 minutos depois do início** da execução que morreu (`lockRenewalMs` da fila; `JobRunStore.claim`). Reenviar antes disso dá `busy` de novo e a mensagem volta à DLQ. É por isso que a espera
entre as entregas da `maintenance` é de 10 e 20 minutos (e não 1 e 2): a terceira entrega cai depois dos 25 minutos e reassume o trabalho sozinha, antes da DLQ. A regra vale para toda fila e o `messages.spec.ts` a confere
(`retryDelayMs × (1 + ... + (entregas − 1)) > lockRenewalMs`). Conferir o estado antes de reenviar: `GET /admin/jobs` ou o painel (`status`, `startedAt`).

```bash
# Quantas mensagens há em cada estado (ativas, na DLQ, agendadas):
az servicebus queue show --resource-group rg-alvesting-prod --namespace-name sb-alvesting --name decisions \
  --query countDetails
```

---

## 6. Operação

```bash
RG=rg-alvesting-prod

# Disparar um agendador agora. Publica a mensagem de verdade; use em temporada de teste.
az containerapp job start --resource-group $RG --name job-sched-eod

# Execuções de um job (status, início, fim):
az containerapp job execution list --resource-group $RG --name job-sched-eod -o table
az containerapp job execution list --resource-group $RG --name job-worker-decisions -o table

# Logs de uma execução (Log Analytics; a tabela demora uns minutos para aparecer):
WS=$(az monitor log-analytics workspace show -g $RG -n log-alvesting --query customerId -o tsv)
az monitor log-analytics query --workspace "$WS" --analytics-query \
  "ContainerAppConsoleLogs_CL | where ContainerGroupName_s startswith '<nome da execução>' | order by TimeGenerated asc"

# O escalador do KEDA não acordou o worker? Veja os logs de sistema:
az monitor log-analytics query --workspace "$WS" --analytics-query \
  "ContainerAppSystemLogs_CL | where ContainerAppName_s == 'ca-worker-data' | order by TimeGenerated desc | take 50"
```

Comandos manuais do worker-data (etapas 4 e 5). Rodam na máquina de quem tem acesso ao banco e ao Blob do ambiente
(`DATABASE_URL`, e `STORAGE_CONNECTION_STRING` ou `STORAGE_BLOB_ENDPOINT`); em produção ainda não há job para a carga
histórica, e nenhum deles passa pela fila. O `market:universe` e o `briefing:freeze` assumem a mesma linha de `job_run` que a
fila (um não repete o outro); os demais não criam `job_run`:

```bash
pnpm --filter @alvesting/api market:backfill                   # carga da brapi: modo SEM rede (mostra o banco e a conta); --confirmo-banco <nome> busca de verdade
pnpm --filter @alvesting/api market:universe <AAAA-Www>        # congela o universo da semana (2026-W45)
pnpm --filter @alvesting/api market:logos                      # logos das ações: modo SEM rede (mostra o banco e a conta); --confirmo-banco <nome> busca a lista e os SVG
pnpm --filter @alvesting/api news:fetch <fonte>                # uma fonte agora, na rede de verdade
pnpm --filter @alvesting/api news:import <fonte-rss> <arquivo.xml> [--at <ISO com fuso>]   # RSS salvo em disco (replay)
pnpm --filter @alvesting/api briefing:freeze <AAAA-MM-DD>      # congela o briefing do pregão; falha se já existe um posterior
```

Comandos da arena (etapa 6, `docs/ARENA.md`, seção 1). Só o banco (`DATABASE_URL`); não passam pela fila nem chamam LLM. Em produção
o Postgres é privado e os JSON de `apps/api/seasons/` não estão na imagem, então **na Azure a temporada se cria e se inicia pelo painel `/admin`** (ou `POST /admin/seasons` e `PATCH /admin/seasons/:id`,
`docs/API.md`, seção 8), com o mesmo arquivo; o `season:start` e o `cycle:show` também rodam como uma execução do `job-migrate` com outro comando (`docs/INFRA.md`, seção 8.6). O primeiro admin, que o painel exige,
nasce pelo `account:promote` desse mesmo caminho. O **reprocesso do ciclo** (quando o agendador das 08:00 falhou, ou o `freeze` só chegou depois) é o botão "Reprocessar um ciclo" do painel, no lugar do
`az containerapp job start --name job-sched-cycle` que a seção 4 mencionava (e que não confere o prazo): só até 5 minutos antes do prazo das 09:30, só para quem falta, idempotente (`docs/API.md`, seção 8).

```bash
pnpm --filter @alvesting/api season:create apps/api/seasons/temporada-0.json   # cria a temporada (DRAFT) com o elenco do arquivo
pnpm --filter @alvesting/api season:start <id>                 # DRAFT -> RUNNING; início no próximo pregão depois de hoje
pnpm --filter @alvesting/api cycle:show <AAAA-MM-DD|id> [slug] # o ciclo do pregão: status, hashes, decisões (formato público)
```

O ensaio da Temporada 0 (etapa 8, a parte local; `docs/ENSAIO.md`) roda tudo isto de uma vez, na máquina: os agendadores, os handlers de
verdade de todas as filas e um barramento em processo no lugar do Service Bus, por 5 pregões, com o relógio simulado, provedores fake e nenhuma
rede. Usa o banco `alvesting_ensaio`, recriado a cada execução, e nunca o de dev:

```bash
pnpm --filter @alvesting/api arena:ensaio [--pregoes 5] [--semente N] [--retroativos K]   # relatório na tela e em .data/ensaio/
```

A Temporada 1 na máquina, até a Azure (ADR 0038; seção 9; `docs/RUNBOOK.md`, seção 13). O banco é sempre o de `TEMPORADA_DATABASE_URL` (o
`alvesting_temporada`), nunca o de dev:

```bash
pnpm --filter @alvesting/api temporada:preparar                     # cria e migra o banco da temporada, db:roles, copia o mercado do dev
pnpm --filter @alvesting/api arena:retroativo --dry-run [--ate D]   # o plano: pregões, chamadas e custo; nenhuma chamada e nenhuma escrita
pnpm --filter @alvesting/api arena:retroativo [--ate D] [--teto-usd 30]   # os pregões que já passaram, como RETROATIVO
pnpm --filter @alvesting/api arena:operar [--so-dados]              # o operador ao vivo nos horários de produção (o launchd o mantém)
```

Comando da liquidação (etapa 7). Só o banco (`DATABASE_URL`); não passa pela fila nem pelo Blob. O admin por tela existe desde a etapa 10 (parte 2): o painel `/admin` ("Evento corporativo") e
`POST /admin/corporate-events` registram o mesmo evento, com o ator `admin:<ULID>` na trilha, mas **enfileiram** a reliquidação (onda 3d, ADR 0028): o worker liquida, e é ele que revalida o site e limpa a borda. Em produção o Postgres é privado, então o
comando roda de onde há acesso a ele, ou como uma execução do `job-migrate` (`docs/INFRA.md`, seção 8.6):

```bash
# Registra um desdobramento (split), grupamento (reverse-split) ou bonificação (bonus) em ações e reliquida, direto, cada temporada que já
# liquidou até a data ex. O fator é de:para (cada "de" ações antigas viram "para" novas) e tem de ter a direção do tipo. Repetir o comando
# não muda o evento e refaz a liquidação; o mesmo ticker, data ex e tipo com outro fator corrige o evento. O ticker tem de estar no banco.
# O registro e a correção deixam uma linha em audit_log (ator "cli", fator antigo e novo), porque corrigir o fator muda, retroativamente, o
# resultado publicado: SELECT * FROM audit_log WHERE action LIKE 'corporate_event.%' ORDER BY created_at.
pnpm --filter @alvesting/api settle:event BBDC4 2026-11-05 split 1:2
pnpm --filter @alvesting/api settle:event ABCD3 2026-11-12 reverse-split 10:1
pnpm --filter @alvesting/api settle:event WXYZ3 2026-11-19 bonus 10:11
```

Se a reliquidação falha (dado incompleto), o evento fica registrado e o comando sai com erro dizendo a temporada e o motivo: corrija o dado
e rode de novo. Proventos em dinheiro estão fora da v2.0.

Mudar um cron ou criar um agendador: edite o vetor `schedulers` em `infra/modules/containerapps.bicep`, o mesmo cron em
`infra/tests/check.mjs` (`CRONS`), este documento e o `apps/api/src/schedule.ts`. O `check.mjs` falha se o Bicep e o §6 do plano
divergirem.

---

## 7. O que o código dos workers precisa respeitar (etapas 3 a 7)

- **Sem `SERVICEBUS_CONNECTION_STRING` em produção:** o cliente usa `SERVICEBUS_FQDN` e o `DefaultAzureCredential`, com
  `AZURE_CLIENT_ID` apontando para a identidade do próprio workload (`id-alvesting-worker`, `-decisions`, `-sched` ou `-api`;
  infra: `docs/INFRA.md`, seção 2.7). Worker e decisões carregam também a `id-alvesting-scale`, que é só do KEDA: o código não a
  pede, e o `AZURE_CLIENT_ID` garante que o `DefaultAzureCredential` escolha a certa. Os agendadores só têm papel de publicar.
- **Renovar o lock:** o lock da fila é de 1 minuto, mas uma decisão pode levar até 25 minutos. A opção
  `maxAutoLockRenewalDurationInMs` é do `createReceiver` (e não do `receiver.subscribe`), e o `MessagingService` já a passa com
  `QUEUES[fila].lockRenewalMs`: 26 minutos em `decisions` (o timeout de 25 do job, mais 1), 25 em `maintenance` (o `backup-verify`
  tem prazo de 20) e 5 nas demais. O handler não renova
  nada. Sem isso valeria o padrão do SDK (5 minutos), e a mensagem reapareceria e contaria uma entrega a mais (ADR 0015).
  **A mesma janela decide a espera entre as tentativas:** o `JobRunStore.claim` só reassume um `job_run` `RUNNING` (a réplica caiu no meio)
  depois de `lockRenewalMs`, então a última tentativa tem de cair depois disso (`retryDelayMs × (1 + ... + (entregas − 1)) > lockRenewalMs`,
  conferido para toda fila no `messages.spec.ts`). Com 1 minuto de espera a `maintenance` mandava o `backup-verify` para a DLQ uns 4
  minutos depois da queda, sem ninguém retomá-lo.
- **Handler que falha não abandona a mensagem:** agenda uma cópia dela (mesmo `MessageId`, propriedade `attempt` + 1) para daqui a
  `retryDelayMs × n` (10 e 20 minutos em `decisions` e em `maintenance`, 1, 2, 3... nas demais) e só então conclui a original; a última tentativa vai
  para a DLQ. Só se o agendamento falhar a mensagem é abandonada (volta na hora e conta uma entrega do broker). O
  `MaxDeliveryCount` do Service Bus fica de rede de segurança para processo que cai e trava que expira (ADR 0015). **Exceção da
  decisão (ADR 0021):** o handler da `decide` recebe a entrega (`{ attempt, lastAttempt }`) e, na última, grava o HOLD `falha` e não
  lança: a mensagem é concluída em vez de ir para a DLQ.
- **Sair com 0 ou 1:** o job só termina quando o processo sai. O `decide.js` trata uma mensagem (inclusive a que agendou nova
  tentativa), conclui e sai com 0; sai com 1 só quando o processo falha (ambiente inválido, exceção não tratada), e então a
  mensagem volta quando a trava vence.
- **Segredo por workload:** o que não está na tabela da seção 2.7 do `docs/INFRA.md` para o seu workload não existe no ambiente
  nem na identidade dele. Precisar de outro segredo é mudar o Bicep (e o `check.mjs`), não ler o cofre.
- **Pool de conexões pequeno:** até 10 execuções + 3 réplicas + api dividem as ~50 conexões do Postgres B1ms. O `PrismaService`
  usa pool de 4 por processo, espera até 10 s por conexão e põe `statement_timeout` de 60 s e `idle_in_transaction_session_timeout`
  de 30 s na sessão.
- **Idempotência pelo `JobRunStore` (`modules/messaging`), para todo handler novo (etapas 6 a 10):** `claim(mensagem)` cria a linha
  de `job_run` ou reassume uma `FAILED` ou `WAITING`, ou uma `RUNNING` mais velha que `lockRenewalMs` da fila (a dona caiu); só uma entrega
  concorrente vence o `UPDATE` condicional. O resultado é *assumida* (processa), *concluída* (não faz nada) ou *em processamento
  por outra entrega*: nesse caso o handler lança `JobBusyError` e a fila tenta de novo, em vez de concluir, para o trabalho não
  se perder se a dona não terminar. Termina com `succeed`, `fail` ou, só para quem agenda a própria nova tentativa, `wait` (só valem para quem ainda é a dona; o `fail` e o `wait`
  são de melhor esforço, e o erro do handler é o que sobe). Dentro, grave também de forma idempotente (upsert, chave única). Para **pedir de novo** o
  que já foi tratado (a liquidação refeita porque o dado mudou) existe `JobRunStore.reopen(mensagem, motivo)`: marca a linha `FAILED`,
  em qualquer estado, e quem pede o faz **antes** de publicar a mensagem (seção 4.1).
- **Retenção (etapa 10):** a fila `news` grava um `job_run` por fonte e por slot, uns 290 por dia (6 fontes × 48 slots); a mensagem `retention`
  limpa os do tipo `fetch` com mais de 30 dias (seção 8.1). `news_item` não tem retenção, de propósito (o teto está em `retention.handler.ts`). A
  tabela `fetch_state` tem uma linha por arquivo da CVM (`cvm-fca:<ano>` e `cvm-ipe:<ano>`).
- **O que mudou no `job_run` (etapa 10, parte 1).** (1) `job_run_status` ganhou o valor **`WAITING`** (migration aditiva
  `20261102120000_job_run_waiting`, só `ALTER TYPE ... ADD VALUE`): é a espera do `eod` pelo arquivo do pregão, que antes ficava `FAILED` com o texto
  "ainda não publicado". O `claim` reassume `WAITING` como reassume `FAILED`; o painel `GET /admin/jobs` (parte 2) e o alerta de job falho olham só o
  `FAILED`, sem filtrar por texto. (2) O `JobClaim` carrega `label` (`queue`, `type` e a chave natural, como `eod:2026-11-03`), preenchido pelo `claim`.
  (3) `JobRunStore.fail` escreve a linha de log `job_run falhou` (nível erro, com `queue`, `type`, `key`, `attempt`, `jobId` e o `reason` sem dado pessoal),
  ANTES de gravar o `FAILED`: o `job_run` mora no Postgres e não chega ao Log Analytics sozinho, e o alerta `job-falhou` lê essa linha; na fila `news` só
  alerta a partir da 3ª tentativa seguida, a não ser que o `reason` seja de segurança (DTD no feed, host fora da lista, ZIP que passa do teto ou mente o
  tamanho, arquivo da CVM que mudou de formato), que alerta na primeira como `news-seguranca` (`NEWS_SECURITY_MARKERS`, `docs/INFRA.md`, 5.3). `wait`
  escreve `job_run em espera` (informação) e não alerta. (4) O `eod` escreve, quando conclui no prazo das 00:30 sem o BOVA11 ou sem mais de 10% do
  conjunto obrigatório, a linha `barras do pregão ausentes: ...` (alerta `eod-barras-ausentes`). O alerta "barra BRAPI por mais de 2 pregões" **deixou de existir**
  com a fonte única: não há barra provisória a trocar (`docs/DADOS.md`, seção 7). (5) Dois sinais novos da onda da brapi: `brapi-cota-baixa` (o
  `BrapiClient` parou na reserva de cota) e `barras-divergentes` (o `BarLoader` viu uma barra com valor diferente do gravado; ela não muda).

---

## 8. Manutenção: retenção e backup-verify (etapa 10, onda 3d)

A fila `maintenance` (3 entregas, concorrência 1, trava renovada por 25 min, espera de 10 e 20 min entre as entregas) tem duas mensagens, ambas idempotentes pela linha de `job_run` (`retention` + data, `backup-verify` + mês) e consumidas pelo
`MaintenanceQueueHandler` no `ca-worker-data`. Código: `apps/api/src/modules/maintenance`. Falhou, o `job_run` fica `FAILED`, a linha `job_run falhou` sai (sinal `job-falhou`, `docs/INFRA.md`, 5.3) e a fila repete;
na terceira vai para a DLQ (`alvesting-dlq-qualquer-fila`). A espera de 10 e 20 minutos (e não 1 e 2) é para a última entrega cair depois da trava de 25 minutos: se a réplica morrer no meio do `backup-verify`, a linha fica `RUNNING`
e é reassumida pela terceira entrega, e não mandada à DLQ (seção 5 e `messages.spec.ts`).

### 8.1 `retention` (todo dia, 10:00 em Brasília)

Apaga o que a política de privacidade promete (`legal/politica-de-privacidade.md`, item 5; `docs/CONTA.md`, seção 5) e o que o `fetch` deixa para trás. Os cortes saem do **relógio do handler** (injetado nos testes),
e cada regra apaga **em lotes de 500** (`id IN (SELECT ... LIMIT n)`), do mais velho para o mais novo, até um lote vir incompleto (teto de 1.000 lotes por tabela: o resto fica para o dia seguinte).

**A limpeza é diária (`0 13 * * *`, desde 04/11/2026), então a linha fica o corte MAIS até 1 dia de espera pela limpeza seguinte, e a política promete esse pior caso, item a item** (decisão do Artur: "Todo dia, prazo de 7 dias").
O cadastro nunca confirmado tem corte de **6 dias**, então some em até **7 dias depois de criado**: a conta criada logo depois de uma limpeza tem menos de 6 dias nas 6 limpezas seguintes e é apagada
pela 7ª (a criada na hora exata de uma limpeza também só sai na 7ª depois dela, porque o corte é "antes de", estrito: é o pior caso, 7 dias exatos). A sessão vencida e o pedido de uso único vencido (corte 0) somem em até **1 dia depois de vencer**; como a
sessão vale até 7 dias desde o último uso (padrão do Better Auth: 7 dias, renovada no máximo uma vez por dia), o registro de uma sessão abandonada fica **no máximo 8 dias**. O `retention.handler.integration.spec.ts` roda o relógio de limpeza em
limpeza e confere cada uma dessas promessas (inclusive que nenhum cadastro some antes dos 6 dias e que o pior caso é exatamente 7), e o `infra/tests/check.mjs` confere o cron diário e o corte de 6 dias juntos. A promessa conta com a limpeza
rodando: uma execução que falha é reenviada pela fila (`job-falhou`, DLQ) e a do dia seguinte recolhe o que sobrou, mas um dia perdido adia o prazo em um dia até alguém corrigir (RUNBOOK, seção 3). **A política diz isso** (a ressalva no fim do
item 5: se uma limpeza falhar ou não rodar, o prazo cresce pelos dias sem limpeza), porque o relógio real não é o perfeito do teste: a limpeza sai pelo agendador, pela fila e pelo KEDA com minutos de atraso que variam de um dia para o outro. Um agendador
que não publica ou um worker que não acorda não escrevem linha nenhuma, e nenhum alerta vigia essa **ausência** (`docs/INFRA.md`, 5.3, limitações): só a conferência da segunda-feira vê um buraco de fim de semana.
Mudar o cron ou o corte do `user` muda a promessa: o texto da política, a versão dela (aceite novo) e o teste andam juntos (o `legal-documents.spec.ts` exige que o "6 dias" do texto seja o `RETENTION_DAYS.user`).

| Tabela | Regra | Por quê |
|---|---|---|
| `user` | `NOT email_verified` e criado há **mais de 6 dias** (some em até 7 depois de criado). A cascata leva `session`, `account` e `consent` (o gatilho do aceite deixa passar o `DELETE` em cascata e recusa o direto) | Cadastro nunca confirmado guarda nome e e-mail e pode ocupar o endereço de outra pessoa; o corte de 6 dias mais 1 dia de espera até a limpeza diária são os 7 dias que a política promete |
| `session` | `expires_at` **já vencida** (sem folga depois do vencimento; a sessão vale 7 dias desde o último uso) | O Better Auth só apaga a sessão vencida quando alguém a apresenta de novo (a linha não guarda IP nem user-agent: o hook `session.create` os grava nulos); a política diz que a limpeza apaga as sessões vencidas em até 1 dia depois de vencerem |
| `verification` | `expires_at` já vencida (o link de 60 e de 30 minutos não vale mais) | Cada `POST` anônimo em `/sign-in/social` grava uma linha; a política diz até 1 dia depois de vencer |
| `job_run` | `type = 'fetch'` e `started_at` há **mais de 30 dias** (qualquer estado) | A fila `news` grava uns 290 por dia; a chave é de janela de 30 minutos e não volta. Os outros tipos ficam (uma linha por pregão, semana, dia ou decisão: a própria `retention`, que agora é diária, soma uma por dia, uns 365 por ano) |
| `news_item` | **nenhuma retenção**, de propósito | É o histórico público e a reprodutibilidade da arena. Estimativa de uns 250 MB por ano no pior caso (700 itens por dia, trecho cheio) contra 32 GB; teto de 1 milhão de linhas (comentário `ponytail` em `retention.handler.ts`) |

A ordem é `user`, `session`, `verification`, `job_run` (a cascata do usuário primeiro, para as contagens das outras tabelas ficarem só com o que sobrou). **Cada `DELETE` vai ao log** com a tabela, o número do lote,
quantas linhas apagou e o corte (`retenção: linhas apagadas`), nunca com linha, e-mail, nome ou ULID de usuário. Rodar duas vezes não dá erro: a mesma mensagem repetida é barrada pelo `job_run`, e outro dia não acha
nada além do que passou do corte. A retenção de 180 dias de `chat_thread` e `chat_message` entra com a etapa 13.

**Dois cuidados do SQL** (`retention.repository.ts`; ambos têm teste de integração que falha sem eles). (1) A regra vem **repetida no `DELETE` de fora**: no `READ COMMITTED` a subconsulta escolhe as linhas num instante e o `DELETE` as
trava depois, e se alguém muda a linha nesse intervalo (o link de confirmação do e-mail, a renovação da sessão) o Postgres reavalia só o `WHERE` de fora; sem a regra ali a conta recém-confirmada seria apagada, com a cascata. (2) O
corte vai como **texto ISO com `Z` convertido para `timestamptz`** no SQL: o Prisma manda um `Date` sem fuso, e o Postgres o leria no `TimeZone` da sessão, deslocando todo corte em 3 horas num servidor em horário de Brasília (o
Flexible Server e o contêiner são UTC, e o `postgres.bicep` não define fuso, mas o teste roda o corte com a sessão em `America/Sao_Paulo`, `Asia/Tokyo` e `Pacific/Kiritimati`).

### 8.2 `backup-verify` (dia 1, 03:00 em Brasília)

"Backup que nunca foi restaurado não é backup" (plano 5.1). Tudo em fluxo, sem arquivo no disco efêmero do contêiner (a memória do envio é de uns 12 MiB: blocos de 4 MiB, 2 em voo):

1. Confere que `pg_dump` e `pg_restore` são do **major do servidor** (17) e recusa os outros (`postgresql-client-17` no PATH da imagem). Varre bancos temporários órfãos de uma execução que caiu (só o padrão exato, sem `FORCE`).
   Recusa o banco que tem tabela **sem decisão** na matriz (`apps/api/src/infrastructure/database/table-policy.ts`): o dump poderia levar dado pessoal que ninguém classificou.
2. Cria o banco temporário `alvesting_verify_AAAAMM_<8 hex>` no mesmo servidor.
3. `pg_export_snapshot()` numa transação `REPEATABLE READ` que fica aberta; conta as linhas de **toda** tabela da matriz nesse snapshot.
4. `pg_dump --snapshot` (formato custom) para o Blob `backups/alvesting-AAAA-MM.dump`, **com o esquema inteiro e sem os dados das tabelas pessoais** (`--exclude-table-data`: `user`, `session`, `account`,
   `verification`, `consent` e, desde a etapa 12, `portfolio` e `portfolio_lot`: a carteira do usuário), e o SHA-256 e o tamanho calculados no caminho. As contagens e o dump enxergam o mesmo instante, mesmo com a arena escrevendo.
5. Baixa o dump do Blob e o passa ao `pg_restore` (`--no-owner --exit-on-error`, lendo a entrada padrão) no banco temporário.
6. Conta de novo: toda tabela tem de ter a contagem da origem, e as **pessoais, zero**. Diferente, falha (só números na mensagem).
7. Grava no blob os metadados (`month`, `sha256`, `bytes`, `personal_data: excluded`) e **apaga o banco temporário**, dê certo ou não.

**LGPD.** O dump fica até 12 meses (cool em 30 dias e exclusão em 365, `infra/modules/storage.bicep`), e a política promete cópia com dado pessoal só pelo ponto de restauração de 7 dias; por isso o dado das tabelas pessoais
não vai para o dump (ADR 0028). Para restaurar um desastre inteiro, o dump traz o esquema e o dado público e o PITR traz o dado pessoal (`docs/INFRA.md`, seção 4).

**Quando falha.** O `job_run` vira `FAILED` e a linha do alerta sai; o banco temporário é apagado (`DROP DATABASE ... WITH (FORCE)`, só com o nome do padrão, pela única função que faz `DROP DATABASE`, `dropTempDatabase`, com teste);
o **dump que não passou na conferência é apagado do Blob**; a fila repete. Todo processo filho tem prazo (20 min no conjunto) e morre no abort. A senha vai no `PGPASSWORD` do ambiente do filho (que não herda o ambiente do worker),
nunca em argumento de linha de comando nem em log. Testes: `backup-verify.handler.integration.spec.ts` (dump truncado, contagem diferente, prazo estourado, tabela sem classificação, binário de outro major, snapshot,
dump de mais de um bloco), com os binários 17.11 do PATH ou, nesta máquina, de dentro do contêiner do projeto (`docs/DEPENDENCIAS.md`).

**Como saber se um dump foi verificado.** O container `backups` só guarda dump verificado **enquanto o processo chega ao fim da execução**: se ele morre depois do envio e antes da conferência (SIGKILL, falta de memória, escala para
zero), o dump inteiro e **não verificado** fica no Blob, e o que o distingue do verificado são os **metadados**, que só são gravados depois da conferência (passo 7). Dump com os metadados `sha256` e `personal_data: excluded` foi
conferido; **sem eles, não foi** e não serve de prova nem de restauração
(`az storage blob show --auth-mode login --account-name stalvesting --container-name backups --name alvesting-AAAA-MM.dump --query metadata`). A próxima entrega da mesma mensagem (o nome do blob é `alvesting-AAAA-MM.dump`) o
substitui, e a de outro mês não toca nele.

**O que a verificação prova e o que não prova.** Prova que o dump é legível e completo (o `pg_restore --exit-on-error` termina sem erro e as contagens de toda tabela da matriz batem) **no mesmo servidor em que foi tirado**. Não prova a
restauração num servidor limpo: o dump leva os **`GRANT` do papel de grupo `alvesting_api_group`** (confirmado: um `GRANT ... TO alvesting_api_group` por tabela e um `GRANT USAGE ON SCHEMA public`; o `--no-owner` não os tira), e com
`--exit-on-error` o `pg_restore` para no primeiro deles se o papel não existir no servidor novo. O backup-verify não vê isso porque o papel é do servidor e já existe nele. **Restaurar o dump num servidor novo:** crie antes o papel
(`CREATE ROLE alvesting_api_group NOLOGIN`), rode o `pg_restore`, e depois o `db:roles` (que cria o login e o põe no grupo). O dump não traz os papéis, os logins nem as senhas (o `pg_dump` não os inclui). O desastre inteiro é o PITR
(`docs/INFRA.md`, seção 4); o [RUNBOOK](RUNBOOK.md), seção 5, tem o passo a passo.

**Não verificado na Azure:** o `CREATE DATABASE` e o `pg_restore` no Flexible Server (o administrador não é superusuário), o envio de verdade para o Blob e o tempo com o banco real.

---

## 9. O operador local: a mesma agenda, no Mac, até a Azure (ADR 0038)

Enquanto a assinatura da Azure não existe, a Temporada 1 roda na máquina: o `arena:retroativo` cobre os pregões que já passaram e o
`arena:operar` roda os seguintes ao vivo (`docs/METODOLOGIA.md`, "Temporada 1"; o procedimento está no `docs/RUNBOOK.md`, seção 13). Os dois são o
**mesmo motor do ensaio** (`apps/api/src/ensaio/world.ts`, `assembleWorld`): os mesmos agendadores e handlers desta página, ligados ao barramento
do processo (`InProcessBus`) no lugar do Service Bus, com as peças reais (`apps/api/src/temporada/pieces.ts`).

**A agenda tem uma fonte só** (`apps/api/src/temporada/agenda.ts`, `AGENDA`): os crons da tabela da seção 1, em UTC, e o `agenda.spec.ts` os
compara com o vetor `schedulers` do `infra/modules/containerapps.bicep`. Mudar um cron é mudar os dois (e o `infra/tests/check.mjs`, seção 6).

| Job | Cron (UTC) | No operador |
|---|---|---|
| `news` | `*/30 * * * *` | igual; depois de um buraco (o Mac dormiu), só a meia-hora mais recente: o feed devolve o que tem agora |
| `briefing` | `30 10 * * 1-5` | igual, até o prazo do pregão; depois dele, não congela (quem congela é o retroativo). Não roda no `--so-dados` |
| `cycle` | `0 11 * * 1-5` | só abre ciclo `AO_VIVO` dentro da janela (até 09:30 menos 5 min), com o prompt fixado, com todo pregão anterior resolvido e se o pregão não tem ciclo. Não roda no `--so-dados` |
| `eod` | `30 0 * * 2-6` | igual: as novas tentativas até 00:30 são cópias agendadas no barramento; no `--so-dados` não pede a liquidação |
| `universe` | `0 12 * * 0` | igual, com a atualização semanal da brapi e os logos (o `icons.brapi.dev` está na lista branca) |
| `retention` | `0 13 * * *` | igual |
| `backup` | `0 6 1 * *` | **fora**: o `backup-verify` pede o `pg_dump` da versão do servidor e um servidor onde restaurar; no Mac a cópia é o `pg_dump` do RUNBOOK (13.6) |

**Cada volta** (a cada 20 s) roda, em ordem de horário, o que venceu desde a volta anterior, e entrega o que o barramento tem depois de cada
passo (o eod da véspera conclui antes do briefing do dia). A primeira volta olha 26 horas para trás (o universo, 7 dias), para o Mac que dormiu
a noite. A idempotência é a de sempre: o `job_run` de cada mensagem barra a repetição, então rodar de novo um passo que já rodou não muda nada.

**O que muda em relação à Azure.** Uma mensagem por vez, na ordem (a concorrência de `QUEUES` não vale); a cópia agendada (a nova tentativa do
eod, a da fila) vive na memória do processo, e se ele reiniciar a volta seguinte a repõe pelo cron perdido (o `job_run` em `WAITING` é
reassumido); a decisão roda no mesmo processo (não há o job de decisões; o limite de cada chamada é o mesmo da seção 3.2, o menor entre o que falta
até 09:30 e os 25 minutos da réplica menos 2); o Blob é o Azurite, nos containers `temporada-briefings` e `temporada-llm-io`; não há telemetria (o Application Insights) nem os
alertas do Azure Monitor: o sinal é o log do dia em `.data/operador/AAAA-MM-DD.log`, com uma linha de batimento a cada 30 minutos. A rede é
uma lista branca (o OpenRouter, a brapi e o `icons.brapi.dev`, a CVM, o BCB, os quatro feeds e o loopback); o resto é bloqueado e anotado no log.

