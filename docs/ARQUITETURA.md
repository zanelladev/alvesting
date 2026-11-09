# Arquitetura (modelo C4)

A arquitetura da Alvesting nos três primeiros níveis do modelo C4 (contexto, contêineres e componentes), mais o desenho em sequência dos
três fluxos de negócio completos das [user stories](USER-STORIES.md). É o "diagrama de arquitetura" que a linha Web Apps do Playbook da
Católica SC pede. Os detalhes de cada peça estão nos documentos de cada uma: [INFRA.md](INFRA.md) (o que o Bicep cria),
[JOBS.md](JOBS.md) (agendadores, filas e workers), [API.md](API.md), [TELAS.md](TELAS.md) e [CONTA.md](CONTA.md); as decisões, nos
[ADRs](adr/).

**Como os diagramas foram desenhados.** Em Mermaid, que o GitHub e a Wiki desenham a partir do texto, com as convenções do C4: pessoa,
sistema, contêiner, componente, e cada seta com o verbo do que passa por ela. Usei o `flowchart` do Mermaid, e não o tipo `C4Context`, que
a documentação do Mermaid ainda marca como experimental e que embaralha diagramas com muitas caixas. **Cada caixa existe no Bicep e no
código:** a tabela de cada nível diz o arquivo.

**Estado (06/11/2026).** Tudo o que está aqui existe no código e foi testado sem a Azure (com os fakes, o Postgres e o Azurite locais e o
emulador do Service Bus). **Nada foi implantado**: o primeiro deploy depende do repositório público e da assinatura de estudante
([DEPLOY.md](DEPLOY.md), "Como implantar"). Até lá, o pipeline da Temporada 1 roda num Mac (seção 5), e essa parte **está em construção**.

---

## 1. Nível 1: contexto

Quem usa a Alvesting e com quais sistemas de fora ela fala.

```mermaid
flowchart TB
  visitante["<b>Visitante</b><br/>[pessoa]<br/>o investidor que acompanha a arena<br/>e a banca do TCC"]
  conta["<b>Pessoa com conta</b><br/>[pessoa]<br/>lança a própria carteira"]
  admin["<b>Admin e operador</b><br/>[pessoa]<br/>o Artur: o painel e os comandos"]

  alvesting["<b>Alvesting</b><br/>[sistema]<br/>arena pública de LLMs operando ações<br/>da B3 com dinheiro fictício"]

  brapi["<b>brapi</b><br/>[sistema externo]<br/>cotações diárias e logos"]
  openrouter["<b>OpenRouter</b><br/>[sistema externo]<br/>os seis LLMs da arena"]
  cvm["<b>CVM</b><br/>[sistema externo]<br/>fatos relevantes (dados abertos)"]
  bcb["<b>Banco Central</b><br/>[sistema externo]<br/>CDI, Selic, IPCA e dólar (SGS)"]
  rss["<b>Portais de notícia</b><br/>[sistemas externos]<br/>InfoMoney, Money Times,<br/>Seu Dinheiro, Agência Brasil (RSS)"]
  email["<b>E-mail</b><br/>[sistema externo]<br/>Azure Communication Services"]
  google["<b>Google</b><br/>[sistema externo, opcional]<br/>login social"]
  aoai["<b>Azure OpenAI</b><br/>[sistema externo, planejado]<br/>o chat da etapa 13"]

  visitante -->|"lê a arena, o ranking e as decisões (HTTPS)"| alvesting
  conta -->|"cria a conta e lança as compras (HTTPS)"| alvesting
  admin -->|"opera pelo painel e pelos comandos"| alvesting
  alvesting -->|"pede só as barras que faltam"| brapi
  alvesting -->|"pede a decisão de cada modelo"| openrouter
  alvesting -->|"baixa os fatos relevantes"| cvm
  alvesting -->|"lê as séries"| bcb
  alvesting -->|"lê os feeds"| rss
  alvesting -->|"manda a verificação e a redefinição de senha"| email
  alvesting -.->|"login, só se configurado"| google
  alvesting -.->|"chat, desligado"| aoai

  classDef pessoa fill:#14144c,stroke:#14144c,color:#ffffff
  classDef sistema fill:#4f58bf,stroke:#3a3f9d,color:#ffffff
  classDef externo fill:#e5e5e5,stroke:#737373,color:#171717
  classDef planejado fill:#ffffff,stroke:#737373,color:#525252,stroke-dasharray:4 3
  class visitante,conta,admin pessoa
  class alvesting sistema
  class brapi,openrouter,cvm,bcb,rss,email externo
  class google,aoai planejado
```

| Caixa | Onde está no código |
|---|---|
| brapi | `apps/api/src/modules/market-data/infrastructure/brapi.client.ts` (a única porta para a brapi; ADR 0032) |
| OpenRouter | `apps/api/src/modules/arena/infrastructure/llm-gateway.ts` (`OPENROUTER_BASE_URL`) |
| CVM e Banco Central | `apps/api/src/modules/news/domain/cvm.ts` (`CVM_HOST`) e `bcb.ts` (`BCB_HOST`), lidos por `apps/api/src/modules/news/application/cvm-fetcher.ts` e `bcb-fetcher.ts` |
| Portais de notícia | `apps/api/src/modules/news/domain/sources.ts` (a lista fixa de feeds), lidos por `apps/api/src/modules/news/application/rss-fetcher.ts` |
| E-mail | `apps/api/src/modules/account/infrastructure/email/` (em dev e teste, um remetente falso que grava numa pasta) e `infra/modules/email.bicep` |
| Google (opcional) | `apps/api/src/modules/account/infrastructure/auth.ts` (só com `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`) |
| Azure OpenAI (planejado) | `infra/modules/openai.bicep` (só com `enableOpenAI`); o chat não existe: a tela `/chat` está desligada (`apps/web/src/app/(app)/(chat)/chat/page.tsx`) |

---

## 2. Nível 2: contêineres

O que roda, e onde, no perfil padrão da Azure (`infra/main.prod.bicepparam`, `profile = 'padrao'`). O perfil econômico tira o Front Door e o
ACR e põe cada app no próprio endereço ([INFRA.md](INFRA.md), 1.3).

```mermaid
flowchart TB
  pessoas["<b>Pessoas</b><br/>navegador, celular primeiro"]

  subgraph azure["Alvesting na Azure · rg-alvesting-prod · Chile Central (infra/main.bicep)"]
    fd["<b>Front Door Standard + WAF</b><br/>afd-alvesting<br/>TLS, limite por IP, cache do estático<br/>e da API pública"]
    subgraph cae["Container Apps · cae-alvesting, na VNet"]
      web["<b>Site</b> · ca-web<br/>[Next 16.4, React 19.3]<br/>telas montadas no servidor"]
      api["<b>API</b> · ca-api<br/>[NestJS 12, main.ts]<br/>API pública, conta, carteira, admin"]
      worker["<b>Worker de dados</b> · ca-worker-data<br/>[worker.ts]<br/>cinco filas"]
      decide["<b>Decisões</b> · job-worker-decisions<br/>[decide.ts]<br/>uma mensagem por execução"]
      sched["<b>Agendadores</b> · sete job-sched-*<br/>[schedule.ts]<br/>cron em UTC, só publicam"]
      migrate["<b>Migrations</b> · job-migrate<br/>migrate deploy e db:roles"]
    end
    sb[("<b>Service Bus Basic</b><br/>sb-alvesting<br/>seis filas com DLQ")]
    pg[("<b>PostgreSQL 17</b><br/>psql-alvesting<br/>privado, sem IP público")]
    blob[("<b>Blob</b> · stalvesting<br/>briefings · llm-io · backups")]
    kv["<b>Key Vault</b> · kv-alvesting<br/>segredos e o prompt da arena"]
    obs["<b>Application Insights<br/>e Log Analytics</b><br/>appi-alvesting · log-alvesting<br/>e os alertas"]
    acs["<b>Communication Services</b><br/>acs-alvesting (e-mail)"]
  end

  fontes["<b>brapi · CVM · BCB · RSS</b>"]
  llm["<b>OpenRouter</b>"]

  pessoas -->|"HTTPS"| fd
  fd -->|"/* e /_next/static/*"| web
  fd -->|"/api/*"| api
  web -->|"lê a api no servidor, com o X-Azure-FDID"| api
  api -->|"lê e grava (login de menor privilégio)"| pg
  api -->|"reprocesso, DLQ e evento corporativo"| sb
  api -->|"verificação e redefinição"| acs
  sched -->|"publica"| sb
  sb -->|"o KEDA acorda"| worker
  sb -->|"o KEDA acorda"| decide
  worker -->|"barras, notícias, macro, briefing, liquidação"| pg
  worker -->|"briefing congelado e dump do backup"| blob
  worker -->|"busca"| fontes
  worker -->|"revalida depois da liquidação"| web
  worker -->|"limpa o cache da borda"| fd
  decide -->|"lê o briefing, grava o IO bruto"| blob
  decide -->|"grava a decisão"| pg
  decide -->|"pede a decisão"| llm
  migrate -->|"migra e cria o login da api"| pg
  kv -.->|"cada segredo por referência, só para quem o lê"| cae
  cae -.->|"telemetria e logs"| obs

  classDef cont fill:#4f58bf,stroke:#3a3f9d,color:#ffffff
  classDef dado fill:#e2e7fd,stroke:#4f58bf,color:#14144c
  classDef externo fill:#e5e5e5,stroke:#737373,color:#171717
  class web,api,worker,decide,sched,migrate,fd cont
  class sb,pg,blob,kv,obs,acs dado
  class pessoas,fontes,llm externo
```

| Contêiner | No Bicep | No código |
|---|---|---|
| Front Door Standard + WAF | `infra/modules/frontdoor.bicep` (o perfil, os endpoints `alvesting` e `alvesting-green`, as rotas e o WAF) | a trava de origem: `apps/api/src/common/origin-lock.ts` e `apps/web/src/proxy.ts` (só atendem quem traz o `X-Azure-FDID` do perfil; ADR 0018) |
| Site (`ca-web`) | `infra/modules/containerapps.bicep` (`ca-web`) | `apps/web/` (imagem `apps/web/Dockerfile`; a leitura da api em `apps/web/src/lib/api.ts`) |
| API (`ca-api`) | `containerapps.bicep` (`ca-api`) | `apps/api/src/main.ts` e `app.module.ts` |
| Worker de dados (`ca-worker-data`) | `containerapps.bicep` (`ca-worker-data`, escala pela fila) | `apps/api/src/worker.ts`; as filas e os handlers em `apps/api/src/role.ts` (`queueHandlers`) |
| Decisões (`job-worker-decisions`) | `containerapps.bicep` (`job-worker-decisions`, por evento) | `apps/api/src/decide.ts` |
| Agendadores (`job-sched-news`, `-briefing`, `-cycle`, `-eod`, `-universe`, `-retention`, `-backup`) | `containerapps.bicep` (a lista `schedulers`, com o cron de cada um) | `apps/api/src/schedule.ts`; a tabela em `apps/api/src/role.ts` (`schedulers`) |
| Migrations (`job-migrate`) | `containerapps.bicep` (`job-migrate`, manual) | `apps/api/prisma/migrations/` e `apps/api/src/db-roles-cli.ts` |
| Service Bus Basic | `infra/modules/servicebus.bicep` (as filas `market`, `news`, `briefing`, `decisions`, `settlement` e `maintenance`) | `apps/api/src/modules/messaging/` (ADR 0004, 0005 e 0015) |
| PostgreSQL 17 | `infra/modules/postgres.bicep` | `apps/api/prisma/schema.prisma` e `apps/api/src/infrastructure/database/` (o papel mínimo da api: `table-policy.ts`, ADR 0028) |
| Blob | `infra/modules/storage.bicep` (os containers `briefings`, `llm-io` e `backups`, cada um com o acesso só de quem o usa: ADR 0030) | `apps/api/src/infrastructure/storage/blob-client.ts`; `modules/briefing/infrastructure/briefing.archive.ts`, `modules/arena/infrastructure/llm-io.archive.ts` e `modules/maintenance/application/backup-verify.handler.ts` |
| Key Vault | `infra/modules/keyvault.bicep` e `secret-access.bicep` (um papel por par workload e segredo; ADR 0020) | os segredos chegam como variáveis de ambiente por referência ao cofre, lidas e validadas em `apps/api/src/config/env.ts` |
| Application Insights, Log Analytics e alertas | `infra/modules/observability.bicep` e `alerts.bicep` | `apps/api/src/telemetry/` (o que sai é lista branca: `sanitize.ts`) e `telemetry/alert-logs.ts`; o runbook de cada alerta em [RUNBOOK.md](RUNBOOK.md) |
| Communication Services (e-mail) | `infra/modules/email.bicep` | `apps/api/src/modules/account/infrastructure/email/` |

Fora do desenho, para ele caber: o ACR das imagens (`infra/modules/acr.bicep`, publicado pelo `deploy.yml`), as identidades de cada
workload (`identity.bicep`), a rede (`network.bicep`), o ambiente do Container Apps (`containerenv.bicep`), o orçamento (`budget.bicep`) e o
Azure OpenAI opcional (`openai.bicep`).

**A mesma imagem em quatro papéis.** A api, o worker, as decisões e os agendadores são uma imagem só (`apps/api/Dockerfile`); quem escolhe o
papel é o comando do contêiner (`node dist/main.js`, `worker.js`, `decide.js`, `schedule.js <nome>`). Cada papel carrega só os módulos dele
(`apps/api/src/app.module.ts` e `roles.module.ts`), e cada um tem a própria identidade: só as decisões leem o prompt e a chave do
OpenRouter, e só o worker tem o token da brapi ([INFRA.md](INFRA.md), 3.2).

---

## 3. Nível 3: componentes da api

Os módulos do NestJS dentro da imagem da api, agrupados pelo papel que os carrega. Cada módulo tem as camadas `application` (casos de uso e
handlers), `domain` (regras puras, sem banco nem rede), `infrastructure` (Prisma, Blob, clientes HTTP) e `presentation` (controllers e
guards), a convenção do `CLAUDE.md`.

```mermaid
flowchart LR
  subgraph http["main.ts · ca-api (HTTP)"]
    direction TB
    public["<b>public</b><br/>a API pública da arena"]
    cycles["<b>arena</b>, só a leitura<br/>GET /cycles/:id"]
    quotes["<b>quotes</b><br/>as rotas internas /interno do site"]
    account["<b>account</b><br/>Better Auth, /me, /legal"]
    portfolio["<b>portfolio</b><br/>/me/portfolio"]
    admin["<b>admin</b><br/>/admin"]
    health["<b>health</b><br/>/health e o SSE"]
  end
  subgraph wk["worker.ts · ca-worker-data"]
    direction TB
    market["<b>market-data</b><br/>eod, universo e logos (brapi)"]
    news["<b>news</b><br/>RSS, CVM e BCB"]
    briefing["<b>briefing</b><br/>o freeze das 07:30"]
    settlement["<b>settlement</b><br/>liquidação, referências e Monte Carlo"]
    maintenance["<b>maintenance</b><br/>retenção e backup-verify"]
  end
  subgraph dc["decide.ts · job-worker-decisions"]
    arena["<b>arena</b><br/>a decisão: gateway de LLM,<br/>validação e o IO bruto"]
  end
  subgraph sc["schedule.ts · job-sched-*"]
    schedulers["<b>*-schedulers.ts</b><br/>dos módulos: só publicam"]
  end
  core["<b>Core</b> (core.module.ts): config, logs Pino, Prisma, messaging (Service Bus)<br/><b>common</b>: envelope, filtro de erro, Zod, ULID, trava de origem, auditoria<br/><b>telemetry</b>: OpenTelemetry, por --import"]

  http --> core
  wk --> core
  dc --> core
  sc --> core
  admin -.->|"publica o reprocesso e o evento"| arena
  settlement -.->|"lê as decisões que valeram"| arena
```

| Componente | Onde está | O que faz |
|---|---|---|
| `public` | `apps/api/src/modules/public/` | As rotas `GET` da arena, com cache e schema estrito na saída (`docs/API.md`, seção 1) |
| `arena` | `apps/api/src/modules/arena/` | Temporada e elenco, o ciclo das 08:00, a decisão de cada modelo (`modules/arena/application/decide.handler.ts`, `modules/arena/infrastructure/llm-gateway.ts`, `modules/arena/domain/decision-validation.ts`) e a leitura do ciclo (`modules/arena/presentation/cycles.controller.ts`) |
| `quotes` | `apps/api/src/modules/quotes/` | As barras, a fita e os logos para o servidor do site, só com o segredo dele (ADR 0033) |
| `account` | `apps/api/src/modules/account/` | Login (Better Auth), sessão, aceite versionado, exportar e excluir, papéis e os guards |
| `portfolio` | `apps/api/src/modules/portfolio/` | A carteira do usuário (ADR 0031) |
| `admin` | `apps/api/src/modules/admin/` | As rotas do painel, com a trilha de auditoria (ADR 0027) |
| `market-data` | `apps/api/src/modules/market-data/` | O calendário de pregões, o universo, as barras e os logos da brapi |
| `news` | `apps/api/src/modules/news/` | As notícias, os fatos relevantes e o macro |
| `briefing` | `apps/api/src/modules/briefing/` | A entrada comum congelada, com o SHA-256 |
| `settlement` | `apps/api/src/modules/settlement/` | A liquidação do zero, o CDI, o Sorteio, as referências, o Monte Carlo, o evento corporativo e a revalidação depois (ADR 0022) |
| `maintenance` | `apps/api/src/modules/maintenance/` | A retenção diária e o backup-verify mensal |
| `messaging` | `apps/api/src/modules/messaging/` | O cliente do Service Bus, a nova tentativa agendada e a DLQ (ADR 0015 e 0021) |
| `health` | `apps/api/src/infrastructure/health/` | O `/health` das sondas e o SSE de teste (ADR 0017) |

**O site** (`apps/web/src/`) não tem estado próprio: as telas são componentes de servidor que leem a api (`lib/api.ts`, com o cache de dados do
Next revalidado depois de cada liquidação), as cotações vêm das rotas internas (`lib/quotes.ts`, `import 'server-only'`), e a trava de
origem e o redirecionamento antigo ficam em `proxy.ts`. Os formulários (conta, carteira, painel) são componentes de cliente que chamam a
api direto, na mesma origem.

---

## 4. Os três fluxos de negócio, em sequência

### 4.1 O ciclo diário da arena

Os horários são de Brasília; o cron dos agendadores está em UTC no `infra/modules/containerapps.bicep` ([JOBS.md](JOBS.md), seção 1).

```mermaid
sequenceDiagram
  autonumber
  participant SCH as Agendadores
  participant SB as Service Bus
  participant W as ca-worker-data
  participant FON as RSS, CVM e BCB
  participant BR as brapi
  participant D as job-worker-decisions
  participant OR as OpenRouter
  participant DB as Postgres
  participant BL as Blob
  participant WEB as ca-web e Front Door

  Note over SCH,DB: a cada 30 min
  SCH->>SB: fetch {fonte, slot} (fila news)
  SB->>W: entrega
  W->>FON: busca (a da CVM é condicional)
  W->>DB: notícias e macro, sem duplicar

  Note over SCH,BL: 07:30 (pregão D)
  SCH->>SB: freeze {D} (fila briefing)
  SB->>W: entrega
  W->>DB: lê o universo da semana, as barras até D-1, o macro e as notícias até o corte
  W->>BL: briefings/D/sha256.json
  W->>DB: a linha do briefing, com o SHA-256

  Note over SCH,OR: 08:00, prazo às 09:30
  SCH->>DB: abre o ciclo de D (o briefing e a versão do prompt ficam fixados)
  SCH->>SB: uma decide {ciclo, competidor} por modelo (fila decisions)
  SB->>D: uma execução por mensagem
  D->>BL: lê o briefing
  D->>OR: o mesmo prompt e o mesmo briefing para todos
  OR-->>D: o JSON com BUY, HOLD ou SELL
  D->>D: valida item a item, e o que não vale é descartado com o motivo
  D->>BL: o IO bruto (llm-io)
  D->>DB: a decisão (quem não respondeu até 09:30 fica com HOLD)

  Note over SCH,WEB: 21:30
  SCH->>SB: eod {D} (fila market)
  SB->>W: entrega
  W->>BR: só as barras que faltam, um papel por vez
  W->>DB: as barras (só inserção)
  W->>SB: settle {temporada, D} (fila settlement)
  SB->>W: entrega
  W->>DB: liquida do zero: execução na abertura, CDI, Sorteio, referências e Monte Carlo
  W->>WEB: revalida o site e limpa o cache da borda
```

### 4.2 A conta, com a LGPD

Tudo passa pelo Front Door, numa origem só (o site em `/*` e a api em `/api/*`; ADR 0025). Em dev e no e2e, o e-mail cai numa pasta.

```mermaid
sequenceDiagram
  autonumber
  actor P as Pessoa
  participant WEB as ca-web
  participant API as ca-api (account)
  participant DB as Postgres
  participant EM as Communication Services

  P->>WEB: /cadastro (nome, e-mail, senha e o aceite dos dois textos)
  WEB->>API: POST /api/auth/sign-up/email {consent}
  API->>DB: o usuário e o aceite (versão e SHA-256 de cada texto)
  API->>EM: o link de verificação (60 min)
  P->>API: GET /api/auth/verify-email?token=...
  API->>DB: e-mail confirmado
  P->>WEB: /entrar
  WEB->>API: POST /api/auth/sign-in/email
  API-->>P: o cookie de sessão (HttpOnly, __Secure- em https)
  P->>WEB: /conta
  WEB->>API: GET /api/v1/me (com o cookie, no servidor)
  P->>API: GET /api/v1/me/export
  API-->>P: o JSON com tudo do dono
  P->>API: DELETE /api/v1/me (a senha, se a sessão não é recente)
  API->>DB: apaga tudo numa transação e grava a auditoria (só o ULID)
```

### 4.3 A carteira

```mermaid
sequenceDiagram
  autonumber
  actor P as Pessoa com conta
  participant WEB as ca-web
  participant API as ca-api (portfolio)
  participant DB as Postgres

  P->>WEB: /carteira
  WEB->>API: GET /api/v1/me/portfolio (o cookie, SessionGuard e ConsentGuard)
  API->>DB: os lançamentos do dono e o último fechamento de cada ação
  API-->>WEB: as posições: preço médio, fechamento com a data, valor e resultado
  P->>API: POST /api/v1/me/portfolio/lots (ação, quantidade, preço por ação ou total pago)
  API->>API: Zod estrito, o dinheiro digitado pelo parseBrl e o custo pelo lotCostCents
  API->>DB: INSERT com o dono = o ULID da sessão (o gatilho barra o 201º lançamento)
  P->>API: PATCH /api/v1/me/portfolio/lots/:id
  API->>DB: UPDATE filtrando o id e o dono na mesma instrução
  P->>API: DELETE /api/v1/me/portfolio/lots/:id
  API->>DB: DELETE filtrando o id e o dono (o lançamento de outro é 404)
```

---

## 5. A variante de hoje: o operador local no Mac (em construção)

Até a Azure existir, a Temporada 1 roda num Mac, com os serviços reais e o mesmo motor da Azure. **Em construção pela tarefa T0 da onda de
06/11/2026**; esta seção descreve o que ela vai entregar, e o relatório dela fica em `docs/temporada-1/relatorios/t0-temporada-real.md`.

```mermaid
flowchart LR
  subgraph mac["Mac do Artur, até a Azure"]
    retro["<b>arena:retroativo</b><br/>os pregões de 13/10/2026 até ontem,<br/>cada um só com o que existia às 07:30 dele"]
    operar["<b>arena:operar</b><br/>o relógio real e a agenda de produção"]
    bus["<b>barramento em processo</b><br/>no lugar do Service Bus"]
    handlers["<b>os mesmos handlers</b><br/>market-data, news, briefing,<br/>arena, settlement, maintenance"]
    pg[("<b>Postgres local</b><br/>alvesting_temporada")]
    azurite[("<b>Azurite</b><br/>no lugar do Blob")]
  end
  fontes["<b>brapi · OpenRouter · CVM · BCB · RSS</b><br/>só esses hosts passam pela guarda de rede"]
  azure["<b>Azure, depois</b><br/>pg_dump e restauração"]

  retro --> bus
  operar --> bus
  bus --> handlers
  handlers --> pg
  handlers --> azurite
  handlers --> fontes
  pg -.-> azure
```

- **O que já existe e é reaproveitado:** o ensaio da Temporada 0 (`apps/api/src/ensaio/`): `world.ts` liga os handlers de verdade a um
  barramento em processo (`bus.ts`, com a paridade contra o Service Bus testada em `bus-parity.spec.ts`), e `driver.ts` monta a linha do
  tempo com os agendadores de produção (`runScheduler`, em `role.ts`). O retroativo e o operador são esse motor com as peças reais no lugar
  dos fakes.
- **O que muda para quem lê o resultado:** cada ciclo grava o modo (`RETROATIVO` ou `AO_VIVO`) e a hora real em que rodou; o site marca os
  pregões retroativos. Pregão com o Mac desligado não vira "ao vivo" atrasado: fica para o retroativo. As regras de visibilidade de cada
  fonte e a honestidade do trecho retroativo ficam no `docs/METODOLOGIA.md` e no `docs/DADOS.md`.
- **O que não existe nesta variante:** o site público, o Front Door, os alertas e a telemetria na Azure. O banco da temporada vai para a
  Azure depois, pelo `pg_dump` e a restauração do [RUNBOOK.md](RUNBOOK.md).

---

## 6. As decisões que dão a forma

| Decisão | ADR |
|---|---|
| O agendador só publica; o trabalho é dos workers, que escalam pela fila | [0007](adr/0007-agendador-so-publica.md), [0006](adr/0006-dois-workers-nao-um-por-fila.md) |
| Service Bus (e não Storage Queue nem BullMQ), no plano Basic | [0004](adr/0004-service-bus-nao-storage-queue-nem-bullmq.md), [0005](adr/0005-service-bus-basic-nao-standard.md) |
| Container Apps (e não AKS), Front Door Standard (e não Application Gateway nem Premium), Bicep (e não Terraform) | [0008](adr/0008-container-apps-nao-aks.md), [0002](adr/0002-front-door-standard-nao-application-gateway.md), [0003](adr/0003-front-door-standard-nao-premium.md), [0012](adr/0012-bicep-nao-terraform.md) |
| Decidir antes da abertura e executar no preço de abertura | [0010](adr/0010-decidir-antes-executar-na-abertura.md) |
| Nova tentativa agendada e a decisão que esgota vira HOLD | [0015](adr/0015-nova-tentativa-agendada-nao-abandono-imediato.md), [0021](adr/0021-dlq-vira-hold-pelo-handler-na-ultima-entrega.md) |
| Uma identidade por workload, segredo a segredo; o Blob por container e o Service Bus por fila | [0020](adr/0020-uma-identidade-por-workload-segredo-a-segredo.md), [0030](adr/0030-blob-por-container-service-bus-por-fila-e-sem-imutabilidade.md) |
| A trava de origem e a única exceção de saúde | [0018](adr/0018-trava-de-origem-health-unica-excecao.md) |
| O papel mínimo do Postgres da api e o backup sem dado pessoal | [0028](adr/0028-papel-minimo-do-postgres-da-api-e-backup-sem-dado-pessoal.md) |
| Blue/green com o label `green` e o endpoint green no Front Door | [0029](adr/0029-blue-green-com-label-green-e-endpoint-green-no-front-door.md) |
| A brapi como fonte única, com o banco como cache, e a API pública sem cotação bruta | [0032](adr/0032-brapi-fonte-unica-das-cotacoes-e-banco-como-cache.md), [0033](adr/0033-api-publica-sem-cotacao-bruta-e-rota-interna-para-o-site.md) |
