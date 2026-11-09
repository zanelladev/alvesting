# Alvesting v2: plano do TCC

**Status:** em implementação desde 31/10/2026, com os padrões recomendados nas decisões em aberto (§17) · **Versão do plano:** 2 (31/10/2026) · **Escopo:** refazer o TCC do zero
**Artifact para aprovar:** https://claude.ai/artifact/Qtbwu11bFbaUnf3xCdidaZ (mesmo conteúdo, com diagramas)

---

## 0. Resumo

A Alvesting v2 é uma **arena pública de LLMs operando ações da B3 com dinheiro fictício**. Antes de cada pregão,
todos os modelos recebem **o mesmo briefing** (notícias, dados de mercado, macro) e **o mesmo prompt**, que
fica oculto durante a temporada: o público vê o hash, não o texto. Cada modelo responde **BUY, HOLD ou SELL**
em JSON estrito. O sistema executa no preço oficial de abertura, rende o caixa no CDI e publica o ranking, com
um controle aleatório para separar habilidade de sorte.

O usuário logado lança a **própria carteira** (quantidade e preço de compra, unitário ou total) e conversa com
um **chat consultivo** que conhece a carteira, o que os modelos fizeram com aquelas ações e as notícias delas.
O chat é educacional: a decisão e a responsabilidade são do usuário.

Stack: **Node 26 LTS** (NestJS 12) no back, **Next 16.4 / React 19.3** no front, **Azure**: Front Door como
balanceador de borda, Container Apps (web, api, workers, agendadores), **Service Bus** com uma fila por tipo de
trabalho, PostgreSQL Flexible, Key Vault e Storage. Estrutura e convenções da Cargoos. Mobile é gate de teste em
todo PR.

---

## 0.1 O que mudou nesta versão

**Pedido do Artur:** faltavam balanceador de carga e fila para os workers.
- **Balanceador:** entrou o **Azure Front Door Standard** na borda (TLS, WAF com regras próprias, cache, rotas
  `/api/*` → api e `/*` → web, health probe). Dentro do ambiente, o **ingress do Container Apps** (Envoy sobre um
  Azure Load Balancer gerenciado) distribui entre réplicas e divide tráfego entre revisões.
- **Filas:** entrou o **Azure Service Bus** com 6 filas e dead-letter. Os cron jobs viraram **agendadores** que só
  publicam mensagens; o trabalho é feito por **dois workers** que consomem as filas e escalam pela fila.

**Revisão do Claude do amigo (31/10/2026)**, ponto a ponto:

| Ponto da revisão | O que fiz |
|---|---|
| Ranking com pouco valor estatístico (20 pregões, 1 amostra por dia) | **Aceito.** Sorteio obrigatório e **Monte Carlo de 1.000 carteiras aleatórias** com as mesmas regras; o resultado principal vira o percentil de cada modelo |
| Benchmark com vantagem (Ibovespa/BOVA11 reinvestem proventos; os modelos não recebem) | **Aceito.** A referência principal vira a **carteira igual-peso do universo, só preço**, calculada por nós com as mesmas regras; BOVA11 fica como linha de contexto com aviso |
| Falta pergunta de pesquisa e cronograma | **Aceito.** Seção 0.2 com pergunta, hipóteses, métrica e cronograma contado de trás para a frente (falta a data de entrega) |
| Prompt oculto atrapalha a reprodutibilidade | **Aceito como opção:** oculto durante a temporada, revelado no fim (o hash publicado confere). A decisão é sua (seção 17) |
| Contradição sobre os dados do chat (Azure vs reserva no OpenRouter) | **Aceito.** Chat só no Azure OpenAI, sem reserva fora da Azure em tempo de execução |
| Transferência internacional (LGPD) | **Aceito.** Informada na política e no consentimento (art. 33); Brazil South elimina a questão se o crédito permitir |
| Chat perto da linha da CVM | **Aceito.** A etapa do chat só começa depois do aval do orientador |
| Escopo grande para uma pessoa | **Parcial.** Não tirei carteira e chat (você pediu os dois); reordenei para a arena ir ao ar e a temporada rodar enquanto o resto é construído |
| Deploy tarde | **Aceito.** Infra e pipeline viraram as etapas 2 e 3 |
| Versões muito novas (sugere Node 24) | **Mantido Node 26:** você pediu a mais recente, e Next 16.4, NestJS 12 e Prisma 7.10 declaram suporte. ADR com volta para o 24 se alguma dependência quebrar |
| Ordem da tabela do universo | **Aceito.** Ordem embaralhada com semente do pregão, igual para todos, e documentada |
| Preço do fracionário | **Aceito.** Limitação declarada |
| Trechos de notícia | **Aceito em parte.** Os modelos recebem o trecho do RSS (arquivo privado); o site mostra só título, fonte e link. **Desvio (etapa 5):** só a Agência Brasil e a CVM mandam o trecho às LLMs; Money Times e Seu Dinheiro vedam reproduzir o conteúdo a terceiros e o InfoMoney não tem termos, então desses três vão só título, fonte, hora e tickers até haver autorização por escrito (`docs/DADOS.md`, seção 13) |
| Tabela de custos (R$ no meio, 21 vs 20 pregões, duração do crédito) | **Aceito.** Corrigida; o crédito dura pouco no perfil padrão, e isso está explícito |
| Várias contas no chat | **Aceito.** E-mail verificado, limite por usuário e por IP e teto diário global |

---

## 0.2 Pergunta de pesquisa e cronograma

**Pergunta:** com as mesmas notícias, os mesmos dados e o mesmo prompt, LLMs de ponta tomam decisões de compra e
venda na B3 melhores do que o acaso e do que o CDI numa temporada de 20 pregões?

**Hipóteses:**
- **H1:** pelo menos um modelo termina acima do percentil 95 das 1.000 carteiras aleatórias com as mesmas regras.
- **H2:** a média dos modelos supera o CDI e a carteira igual-peso do universo no período.

**Métricas:** percentil no Monte Carlo (principal), excesso de retorno sobre CDI e igual-peso, drawdown máximo.
O Sharpe entra só como descrição, porque 20 pontos dizem pouco. Se o orçamento permitir, 2 a 3 amostras por
modelo por pregão medem a variância do próprio modelo.

**Cronograma (contado da entrega, D):**

| Marco | Quando | Por quê |
|---|---|---|
| Etapas 1 a 7 (base, infra, dados, decisão, liquidação) | até D − 13 semanas | A temporada precisa de calendário |
| Temporada 0 (ensaio, 5 pregões) | D − 12 semanas | Prova que roda sozinha |
| Temporada 1 (20 pregões ≈ 4 semanas + feriados) | D − 11 a D − 6 semanas | O experimento |
| Telas, conta, carteira e chat | em paralelo à Temporada 1 | Não dependem do resultado |
| Análise, texto e revisão | D − 6 a D | Resultados e metodologia |

Precisa de **cerca de 13 semanas antes da entrega**. Falta você dizer a data.

---

## 1. O que as referências ensinam

| Referência | O que faz | Copiamos | Não copiamos |
|---|---|---|---|
| **Alpha Arena** (nof1) | US$ 10 mil reais por modelo, temporadas de 2 semanas; na 1.5 só ações dos EUA, 4 competições em paralelo com entradas idênticas dentro de cada uma. Feed "ModelChat", ranking com valor, retorno, P&L, taxas, acerto, Sharpe e nº de operações; página do modelo com posições e últimas 25 operações. Visual cru: IBM Plex Mono, papel, bordas pretas | Feed de justificativas curtas, ranking com risco, página do modelo, estética crua | Alavancagem, vendido, dinheiro real, competições paralelas (fase 5) |
| **Rallies.ai Arena** | Carteiras de ~US$ 100 mil desde dez/2025, 11 fundos. Feed com filtro Todos/Compra/Venda/Mantém e modelos respondendo uns aos outros; página do modelo com retorno vs SPY, drawdown e Sharpe; chat "com a sua carteira" | Filtro BUY/SELL/HOLD, comparação com índice, chat com contexto da carteira | Pesquisa na web pelos modelos (quebra a igualdade) |
| **TradeRank** | 22 modelos, US$ 10 mil simulados, temporadas de 28 dias, um ciclo por dia às 16:00 UTC. Triagem determinística, JSON estrito, um reparo, taxa de 0,1%, limitações públicas. A Temporada 7 foi encerrada por perda do servidor (14/08/2026) | Ciclo diário com contagem, triagem determinística, reparo único, limitações | Prompt publicado durante o jogo, servidor único sem backup gerenciado |

---

## 2. Regras da arena

| Regra | Valor (parâmetro da temporada) |
|---|---|
| Capital inicial | **R$ 100.000,00** por competidor |
| Duração | **20 pregões**. Temporada 0 = ensaio com provedores fake |
| Universo | Até **500 ações** (ON, PN, UNIT; sem FII, ETF, BDR, opções) por **volume financeiro médio de 60 pregões**, com presença em **≥ 90% dos pregões**. Refeito todo domingo, congelado na semana. Na tabela enviada aos modelos, **ordem embaralhada com semente do pregão** (igual para todos) |
| Ações | **BUY** (% do patrimônio, 5 a 25) · **SELL** (% da posição, 1 a 100) · **HOLD** (com motivo). Só compra, sem alavancagem, sem day trade |
| Limites | Até **10 posições** e **5 ordens** por ciclo |
| Decisão | **08:00** (Brasília) com dados até o fechamento anterior; prazo **09:30**, sem resposta = HOLD |
| Execução | **Preço de abertura** do mesmo pregão (a barra da brapi, desde a onda de 03/11/2026; antes o COTAHIST); vendas antes das compras; ações inteiras |
| Custos | **0,03%** por operação; sem slippage (limitação) |
| Caixa | Rende **CDI diário** (BCB, SGS 12) |
| Proventos | Não creditados na v2.0 (limitação). Por isso a referência principal é **só preço** |
| Referências | **Igual-peso do universo, só preço** (principal, mesmas regras e custos), **CDI**, **BOVA11** (contexto; inclui proventos) |
| Controle | **Sorteio** obrigatório no ranking + **Monte Carlo** de 1.000 carteiras aleatórias com as mesmas regras e semente fixa |
| Validação | JSON estrito; item inválido descartado; JSON inválido ganha 1 reparo; falhou = HOLD |
| Igualdade | Mesmo prompt e briefing (SHA-256 públicos), mesma hora, mesmos limites, sem ferramentas nem web |
| Ranking | Retorno da temporada; percentil no Monte Carlo; excesso sobre igual-peso e CDI; drawdown; acerto; nº de operações |
| Limitações declaradas | Sem slippage; sem proventos; preço do lote padrão usado para quantidades fracionárias; uma decisão por pregão |

A B3 tem **~415 a 425 companhias listadas**; contando ON, PN e UNIT há mais tickers, muitos ilíquidos. O filtro
de presença e volume é o que limita de fato. O número real sai do universo na etapa 4.

---

## 3. Funcionalidades

| Área | MVP (TCC) | Depois |
|---|---|---|
| Arena pública | Início (tira de cotações, gráfico, ranking com sorteio e percentil, feed com filtro BUY/SELL/HOLD, contagem para o próximo ciclo), ranking, modelo, ciclo (decisões + hashes), notícias (título, fonte e link), ação (velas), "Como funciona". As cotações vêm da brapi e o site as lê de uma rota interna: a API pública não entrega cotação bruta (ADR 0033) | Modelos respondendo uns aos outros, relatório diário, competições paralelas |
| Carteira | Compra com quantidade e **preço unitário ou total**; editar/apagar; posição com preço médio e P&L | Vendas, nota de corretagem, proventos |
| Chat consultivo | Contexto da carteira, da arena e das notícias; streaming; aviso fixo; limites | Push (PWA) |
| Conta | Google ou e-mail/senha verificado, termos, exportar e excluir | Outros logins |
| Admin | Temporadas, reprocessar ciclo, reenviar mensagem da DLQ, evento corporativo, custos, jobs | — |
| Mobile | Primeiro 360–430 px, PWA instalável | Push |

---

## 4. Arquitetura de software

Monorepo **pnpm + Turborepo**, como na Cargoos, com **uma imagem do back em quatro papéis**:

```
alvesting/
├─ apps/
│  ├─ web/            Next 16.4 (App Router), React 19.3, Tailwind 4, TanStack Query
│  └─ api/            NestJS 12 (SWC) · mesma imagem, quatro entradas:
│     ├─ src/main.ts        HTTP: API + chat SSE (ca-api)
│     ├─ src/worker.ts      consome as filas market, news, briefing, settlement, maintenance (worker-data)
│     ├─ src/decide.ts      processa 1 mensagem da fila decisions e sai (worker-decisions)
│     └─ src/schedule.ts    agendadores: só publicam mensagens (news | briefing | cycle | eod | universe | retention | backup)
├─ packages/
│  ├─ contracts/      Zod 4: DTOs, mensagens das filas e schema da decisão BUY/HOLD/SELL
│  └─ config/         tsconfig, eslint, prettier
├─ infra/             Bicep: main.bicep + módulos + parâmetros dev/prod
└─ docs/              PLANO, INFRA, JOBS, METODOLOGIA, RESULTADOS, RUNBOOK, DEPENDENCIAS, adr/
```

> Desvio (etapa 4): não existe `data/`. A lista de feriados da B3 é `apps/api/src/modules/market-data/domain/b3-holidays.json`
> (o `nest build` a leva para o `dist`; a imagem da api só copia `apps/api` e `packages/`). 2026 é a lista oficial; 2027 é
> provisório, até a B3 publicá-la (`docs/DADOS.md`, seção 5).

Módulos do back (DDD da Cargoos: `application / domain / infrastructure / presentation`): `market-data`, `news`,
`briefing`, `arena`, `ledger` (ordens, execuções, posições, métricas, Monte Carlo), `portfolio`, `chat`,
`account`, `admin`, e `messaging` (cliente do Service Bus, contratos das mensagens, conclusão/abandono).

Convenções da Cargoos: `/api/v1`, ULID, centavos (bigint), envelope `{ success, data, error }`, Swagger, Pino, Zod,
kebab-case, teste em todo use-case e endpoint, nunca comando destrutivo no banco.

Páginas públicas geradas estaticamente no Next, com cache no Front Door e purge após a liquidação.
> Desvio (etapa 9, ADR 0023): as páginas são dinâmicas e leem o cache de dados do Next (revalidado após a liquidação); o Front Door guarda só o estático e a API pública. Ver §5.4.

---

## 5. Infra na Azure

No formato da spec de produção da Cargoos (`cargoos-backend/specs/production-deployment.md`).

### 5.1 Da Cargoos para a Azure

| Cargoos (Hetzner) | Alvesting (Azure) | Por quê |
|---|---|---|
| Cloudflare (DNS, proxy, WAF) | **Azure Front Door Standard** | Borda com TLS, WAF com regras próprias, cache e POPs no Brasil |
| Hetzner Load Balancer (TLS + /health) | **Front Door** (entre origens) + **ingress do Container Apps** (Envoy + Azure LB entre réplicas) | Dois níveis: borda e réplicas; health probe nos dois |
| VPS API com Docker/PM2 | **Container Apps**: ca-web, ca-api, worker-data, worker-decisions, agendadores | Escala por HTTP e por fila, revisões para blue/green |
| BullMQ + Redis | **Service Bus** (6 filas com DLQ) | Fila gerenciada, dead-letter nativa, mensagem agendada, escala do worker pela fila |
| VPS DB com Postgres + PgBouncer | **PostgreSQL Flexible** B1ms privado | Backup, PITR e patches gerenciados |
| Redis (cache) | **Nenhum na fase 1** | Cache no Front Door + páginas estáticas; o Azure Cache for Redis está em aposentadoria |
| Doppler | **Key Vault** + identidade gerenciada | Nenhum segredo em env nem no GitHub |
| GHCR | **ACR** Basic | Pull por identidade |
| `pg_dump` → Storage Box + teste de restore | PITR 7 dias + `pg_dump` mensal no Blob + **restore de teste mensal** | "Backup que nunca foi restaurado não é backup" |
| Sentry + UptimeRobot | **App Insights** (OpenTelemetry) + health probe do Front Door | Um lugar só |
| GitHub Actions + SSH | **GitHub Actions com OIDC** + nova revisão + smoke + rollback | Sem chave, sem senha |

### 5.2 Topologia

```
 Usuários (celular · HTTPS)
        │
        ▼
 Azure Front Door Standard  ── TLS · WAF (regras próprias) · cache · /api/* → api · /* → web · probe /health
        │  só aceita na origem quem traz o X-Azure-FDID do nosso Front Door
┌───────┼──────────── East US 2 · rg-alvesting-prod ─────────────────────────────────────────┐
│ VNet  ▼  10.10.0.0/16                                                                      │
│ ┌─ Container Apps environment · ingress (Envoy + Azure LB gerenciado) ─────────────────┐   │
│ │  ca-web (1→5) ──SSR──▶ ca-api (1→5) ──chat──▶ Azure OpenAI                           │   │
│ │  agendadores (cron UTC) ──publicam──▶ Service Bus ──▶ worker-data (0→3, KEDA)        │   │
│ │                                                  └──▶ worker-decisions (job por      │   │
│ │                                                       evento, 1 msg = 1 modelo) ──▶ OpenRouter
│ └──────────────────────────────────────────────────────────────────────────────────────┘   │
│  PostgreSQL 17 Flexible B1ms (sub-rede privada, sem IP público) ◀── api e workers           │
│  Service Bus (Basic, 6 filas + DLQ) · Key Vault · Storage (Blob) · ACR · App Insights      │
└────────────────────────────────────────────────────────────────────────────────────────────┘
 Fora: brapi (as cotações; o COTAHIST da B3 saiu, ADR 0032) · CVM IPE · BCB SGS · RSS · Google OAuth
 Deploy: GitHub Actions ──OIDC──▶ ACR ──▶ nova revisão no Container Apps
```

### 5.3 Recursos

| Recurso | SKU / tamanho | Função |
|---|---|---|
| `afd-alvesting` | Front Door **Standard** · 1 endpoint · 2 grupos de origem · WAF com regras próprias | Balanceador de borda, TLS, cache, rotas, health probe |
| `cae-alvesting` | Container Apps environment, perfil Consumption, na VNet, ingress externo | Hospeda o código; ingress Envoy + Azure LB gerenciado |
| `ca-web` | 0,25 vCPU / 0,5 GiB · min 1 (0 fora de demo) · max 5 · escala por concorrência HTTP (50) | Next standalone |
| `ca-api` | 0,25 vCPU / 0,5 GiB · min 1 · max 5 · escala por concorrência HTTP (30) | API e chat SSE |
| `ca-worker-data` | 0,5 vCPU / 1 GiB · sem ingress · min 0 · max 3 · KEDA `azure-servicebus` por fila | Consome market, news, briefing, settlement, maintenance |
| `job-worker-decisions` | 0,5 vCPU / 1 GiB · **job por evento** na fila `decisions` · 1 msg = 1 execução · paralelismo 10 · timeout 25 min | Uma chamada de LLM por modelo, isolada |
| `job-sched-*` (7) | 0,25 vCPU / 0,5 GiB · cron em UTC · roda em segundos | Só publica mensagens |
| `job-migrate` | manual, disparado pelo CI | `prisma migrate deploy` |
| `sb-alvesting` | Service Bus **Basic** · 6 filas, cada uma com DLQ | Filas dos workers |
| `psql-alvesting` | PostgreSQL 17 Flexible · B1ms · 32 GB · backup 7 dias · acesso privado | Banco |
| `stalvesting` | Storage v2 LRS · Blob (hot → cool em 30 dias) | Briefings, IO bruto das LLMs, backups (o container `cotahist` saiu com a fonte, ADR 0032) |
| `kv-alvesting` | Key Vault Standard · RBAC | Segredos e prompts |
| `cralvesting` | Container Registry Basic | Imagens |
| `log-` + `appi-alvesting` | Log Analytics + App Insights | Logs, traces, métricas, alertas |
| `acs-alvesting` | Communication Services Email | Verificação e reset de senha |
| `oai-alvesting` | Azure OpenAI, modelo pequeno | Chat |
| `id-alvesting-apps` | Identidade gerenciada | AcrPull, Key Vault Secrets User, Storage Blob Data Contributor, Service Bus Data Sender/Receiver, purge do Front Door |

> Desvio (ADR 0020, `docs/adr/0020-uma-identidade-por-workload-segredo-a-segredo.md`): no lugar da `id-alvesting-apps`, uma identidade por workload (web, api, worker, decisions, sched, migrate) mais a do KEDA, cada uma lendo só os segredos dela, com o Key Vault no escopo de cada segredo.

Região: **East US 2** (mais barata, todos os serviços, cota de Azure OpenAI). Os POPs do Front Door no Brasil
cortam a latência dos estáticos; Brazil South fica como evolução.

> **07/11/2026:** a assinatura Azure for Students só libera cinco regiões, sem a East US 2 e sem a Brazil South. A produção foi para a
> Chile Central (ADR 0040).

### 5.4 Balanceamento de carga

| Camada | O que faz | Configuração |
|---|---|---|
| **Front Door Standard** (borda global) | Termina TLS do domínio próprio, aplica WAF, faz cache, roteia por caminho e tira origem doente do rodízio | Rotas `/api/*` → grupo `api` e `/*` → grupo `web`; probe `GET /health` a cada 30 s; cache de `/_next/static/*` (imutável) e das páginas públicas (`s-maxage` curto + purge após a liquidação); WAF com regras próprias (rate limit por IP; regras gerenciadas só no Premium) |
| **Ingress do Container Apps** (Envoy + Azure LB do ambiente) | Distribui entre réplicas de cada app, divide tráfego entre revisões | Probes de startup, readiness e liveness; blue/green por label |
| **Trava de origem** | Ninguém fala com o Container Apps sem passar pela borda | Middleware em web e api recusa requisição sem o `X-Azure-FDID` do nosso perfil (Private Link só existe no Premium, US$ 330/mês) |

> Desvio (ADR 0023, `docs/adr/0023-html-sem-cache-na-borda-so-a-api-publica-e-o-estatico.md`): o Front Door guarda o estático e as GET públicas da API (com o purge de `/api/v1/*` depois da liquidação); o HTML das páginas não é guardado na borda, e a página lê o cache de dados do Next, revalidado depois de cada liquidação.

Com web e api no mesmo domínio pelo Front Door, não há CORS e o cookie de sessão é primário.
**A validar na etapa 3:** o streaming SSE do chat passando pelo Front Door. Se a resposta for bufferizada, o chat
usa um subdomínio que vai direto ao ingress da api.

**Perfil econômico:** sem Front Door. O ingress do Container Apps continua sendo o balanceador (Envoy sobre Azure
Load Balancer, com domínio próprio e certificado gerenciado), mas sem cache de borda e sem WAF; a api vai para
subdomínio com CORS.

### 5.5 Filas e workers

Os agendadores (cron) só publicam mensagens. Quem trabalha são os workers, que consomem as filas, escalam pelo
tamanho da fila e devolvem para a fila o que falhar. Cada fila tem **dead-letter (DLQ)**: depois do número máximo
de entregas, a mensagem vai para a DLQ, um alerta dispara e o admin reenvia depois de corrigir.

| Fila | Produtor | Consumidor | Mensagem | Entregas máx. | Concorrência |
|---|---|---|---|---|---|
| `market` | `sched-eod` (21:30), `sched-universe` (domingo) | worker-data | `eod {pregão}` · `universe {semana}` | 10 | 1 |
| `news` | `sched-news` (a cada 30 min) | worker-data | `fetch {fonte, slot}`, uma por fonte (4 RSS, CVM IPE, BCB SGS) | 5 | 4 |
| `briefing` | `sched-briefing` (07:30) | worker-data | `freeze {pregão}` | 5 | 1 |
| `decisions` | `sched-cycle` (08:00) | worker-decisions | `decide {ciclo, competidor}` | 3 | 10 execuções |
| `settlement` | worker-data, após o `eod` | worker-data | `settle {temporada, pregão}` | 5 | 1 (serializa) |
| `maintenance` | `sched-retention` (diário), `sched-backup` (mensal) | worker-data | `retention` · `backup-verify` | 3 | 1 |

- **Reagendamento:** se o COTAHIST ainda não saiu, o worker publica a mesma mensagem com entrega agendada para
  +60 min (até 00:30); na última tentativa usa a brapi. Fim dos 4 crons do `eod`.

  > Mudança (onda da brapi, 03/11/2026; ADR 0032; `docs/DADOS.md`, seções 6 e 7; `docs/JOBS.md`, seção 4): o COTAHIST **saiu** (a B3 veda a
  > coleta automatizada, inclusive por IA) e a **brapi é a fonte única**, com o banco como cache. O `eod` pede só a falta, um papel por
  > vez (plano gratuito: 15 mil requisições por 30 dias, 1 papel por requisição, 1 por vez na conta): o conjunto obrigatório (o universo
  > da semana ISO, o BOVA11 e os papéis em posição de temporada em andamento) até o prazo das 00:30, e o opcional (as carteiras dos
  > usuários) uma vez, na tentativa que conclui. O reagendamento de +60 min fica, mas agora é por papel faltando, e não por "arquivo
  > ainda não publicado"; a brapi não é mais "a última tentativa". Barra gravada nunca é sobrescrita; o que já foi liquidado não muda
  > sozinho; a janela é de 5 pregões; a cota tem reserva de 500 e dois sinais novos (`brapi-cota-baixa` e `barras-divergentes`).
- **Encadeamento:** `eod` concluído publica `settle`; `settle` concluído chama a revalidação do site e o purge do
  Front Door.
- **Idempotência:** a chave natural de cada mensagem (pregão, ciclo + competidor) é única no banco; mensagem
  repetida não faz nada. Por isso o tier **Basic** basta: o Standard só acrescentaria detecção de duplicata,
  tópicos e sessões.
- **Decisões isoladas:** cada modelo roda numa execução própria do job, com timeout próprio; um modelo lento ou
  quebrado não atrasa os outros. Mensagem na DLQ vira HOLD registrado.
- **Escala:** regra KEDA `azure-servicebus` por fila (worker-data sobe quando há mais de 5 mensagens; o job de
  decisões abre uma execução por mensagem), autenticada por identidade gerenciada.
- **Local e testes:** emulador oficial do Service Bus no docker-compose.

### 5.6 Rede e segurança

- Banco **sem IP público** (sub-rede delegada + zona DNS privada).
- Identidade gerenciada para ACR, Key Vault, Storage, Service Bus e Front Door; segredos do Container Apps como
  referência ao Key Vault.
- Origem travada no Front Door (5.4); workers e agendadores sem ingress.
- API: helmet, rate limit, cota diária do chat no Postgres, Zod em toda entrada, guarda de dono em `/me`.
- Service Bus e Key Vault por RBAC; private endpoint só existe nos tiers caros (fase 4).

### 5.7 Segredos (Key Vault)

`database-url` · `openrouter-api-key` · `azure-openai-key` (ou identidade) · `better-auth-secret` ·
`google-oauth-client-secret` · `brapi-token` · `revalidate-secret` · `quotes-secret` · `front-door-id` · **`prompt-arena`** e
**`prompt-chat`**. O banco guarda só SHA-256 e versão do segredo. Service Bus e Storage não têm segredo: identidade. O `quotes-secret`
(onda da brapi, parte 2; ADR 0033) é o segredo da rota interna de cotações: o site o manda e a api o confere, e mais ninguém o lê.

### 5.8 Backups

1. **PITR** de 7 dias (35 se a banca pedir).
2. **`backup-verify`** mensal pela fila `maintenance`: `pg_dump` → Blob (cool, 12 meses), restauração num banco
   temporário, contagem das tabelas-chave. Falhou = alerta.

> Acréscimo (etapa 10, onda 3d; ADR 0028; `docs/JOBS.md`, seção 8): o dump leva o esquema inteiro e **não leva os dados das tabelas pessoais** (`user`, `session`, `account`, `verification`, `consent` e, desde a etapa 12, `portfolio` e `portfolio_lot`, a matriz
> `apps/api/src/infrastructure/database/table-policy.ts`), porque a política de privacidade promete cópia com dado pessoal só pelo ponto de restauração de 7 dias e o dump fica 12 meses. A contagem é de TODA tabela
> da matriz, tirada no mesmo instante do dump (`pg_export_snapshot`); as pessoais têm de voltar vazias. A fila `maintenance` também faz a `retention`, todo dia (a limpeza que a política promete, com o pior caso de cada item, e os `job_run` do `fetch`; decisão do Artur de 04/11/2026: "Todo dia, prazo de 7 dias").
3. Briefings e IO bruto no Blob: qualquer ciclo é reprocessável.

### 5.9 Observabilidade

- OpenTelemetry em api, workers e agendadores → App Insights (requests, dependências, exceções, mensagens).
- Métricas próprias: `llm.tokens`, `llm.cost_usd`, `cycle.duration`, `decision.invalid`, `chat.messages`.
- Logs Pino em JSON → Log Analytics (dentro dos 5 GB/mês gratuitos).
- Alertas: **mensagem na DLQ** de qualquer fila · fila `decisions` com mensagens às 09:35 · barras do dia ausentes
  (`eod-barras-ausentes`, no prazo das 00:30; antes "COTAHIST ausente às 00:35") · origem doente no Front Door · 5xx > 1% em 5 min · CPU ou disco do banco > 80% · orçamento 50/80/100%.

> Acréscimo (etapa 10, parte 1; `docs/INFRA.md`, seção 5; ADR 0026): o OpenTelemetry cobre api, workers e agendadores (o site fica de fora; o Front Door e o alerta de 5xx cobrem o site). Além da lista acima há o alerta de 5xx da própria api (`api-5xx`, sobre o log de requisição: o SSR do site chama a api direto e a métrica de 5xx do Front Door não o vê; vale também no perfil econômico, que não tem Front Door), os de job falho (`job_run` `FAILED`; a espera do `eod` virou `WAITING`), de falha de segurança da fila `news` (DTD no feed, host fora da lista fixa, ZIP que passa do teto ou mente o tamanho, arquivo da CVM que mudou de formato; alerta na primeira vez), de filtro de vazamento, de HOLD por falha ou resposta inválida acima de 2 em 15 minutos (a janela da regra: três modelos de seis juntos apontam causa comum), de e-mail da conta que falhou, de aceite não gravado e de ciclo pulado (o teto mensal de LLM estourado ou o briefing ausente: nenhum modelo é chamado; onda 3d), todos como sinais de uma regra de log só. O `api-5xx` conta também o `/api/auth/*` (a `AuthRoute` loga o `res.statusCode`). "Fila `decisions` com mensagens às 09:35" é implementado como "a fila não esvaziou em 15 minutos" (o alerta de métrica não tem horário, e uma chamada de modelo de raciocínio legítima passa de 5 minutos; é a única exceção ao "em até 10 minutos": detecta em 20), e "COTAHIST ausente" é "barras do pregão ausentes" (o job `eod`, não a fonte).

### 5.10 CI/CD

- `ci.yml` (PR): lint, typecheck, unit, integração (Postgres + emulador do Service Bus), Playwright mobile e
  desktop, Lighthouse mobile, `docs:check`, build, what-if do Bicep.
- `deploy.yml` (main): OIDC → imagem no ACR → job `migrate` → nova revisão (label `green`, 0% do tráfego) →
  smoke e Playwright mobile pelo Front Door → 100% para `green`; falhou, a revisão anterior segue.
- Migrations pela regra da Cargoos.

> Acréscimo (etapa 10, parte 4; ADR 0029, `docs/DEPLOY.md`): o blue/green é por app e a **api vai antes do web** (o web novo é provado contra a api nova). "Pelo Front Door" é um **segundo endpoint do mesmo perfil** (`alvesting-green`), que leva ao label `green` de
> cada app e passa pelo mesmo WAF e pela mesma trava de origem, sem custo novo; o smoke e o Playwright mobile rodam nele antes da virada, e depois dela o Front Door de produção é provado de novo. O `job-migrate` roda também o `db:roles` (o login de menor
> privilégio da api no Postgres, ADR 0028). Worker, decisões e agendadores não têm revisão: a imagem deles muda no `roll-roles`, depois do ponto sem volta. Voltar uma revisão é `node scripts/deploy.mjs revert`. O acesso da infra é por container (Blob) e por fila (Service Bus), sem
> política de imutabilidade (ADR 0030).

### 5.11 Escala

| Peça | Regra |
|---|---|
| Front Door | Global, sem configuração de escala; o cache segura picos das páginas públicas |
| `ca-web` / `ca-api` | 1 → 5 réplicas por concorrência HTTP |
| `ca-worker-data` | 0 → 3 réplicas pela profundidade das filas |
| `job-worker-decisions` | 0 → 10 execuções simultâneas, uma por mensagem; cabe roster de ~30 modelos |
| Service Bus | Basic aguenta folgado; Standard ou Premium só com tópicos, sessões ou volume muito maior |
| Banco | B1ms → B2s → General Purpose com CPU > 70% sustentado |

### 5.12 Custos estimados (USD/mês, East US 2)

| Item | Padrão | Econômico |
|---|---|---|
| Front Door Standard (taxa base + tráfego mínimo) | ~35 | 0 (o ingress do Container Apps balanceia) |
| Container Apps (web e api min 1; workers e agendadores dentro da franquia mensal) | 12–16 | 1–3 (min 0 fora de demos) |
| PostgreSQL B1ms + 32 GB | ~16 | 0 se a franquia de 12 meses valer; senão ~16 |
| Service Bus Basic (cobrança por operação) | < 1 | < 1 |
| Container Registry Basic | ~5 | 0 (GHCR; imagem sem segredo nem prompt) |
| Storage, Key Vault, DNS privado, e-mail | ~2 | ~2 |
| Log Analytics / App Insights (dentro dos 5 GB grátis; estimativa de ~1 a 3 GB por mês em `docs/INFRA.md`, 5.5) | 0–3 | 0 |
| Alertas do Azure Monitor (1 regra de log a cada 5 min com até 11 sinais, mais 9 a 12 séries de métrica; `docs/INFRA.md`, 5.6) | ~3,2 | ~3,0 |
| **Total Azure** | **≈ 72–83** | **≈ 5–10** (≈ 21–26 sem a franquia do Postgres) |
| LLMs da arena (6 modelos, 20 pregões, ~25 mil tokens de entrada por chamada) | 20–50 | 20–50 |
| Chat (modelo pequeno no Azure OpenAI) | 1–5 | 1–5 |

A fonte das cotações é a brapi **gratuita** (R$ 0, sem cartão): 15 mil requisições por 30 dias, e o plano usa uns 8 mil (`docs/DADOS.md`, seção 6). Os dois sinais novos da onda da brapi somam uns US$ 0,30 por mês aos alertas (linha acima). Fora da tabela, opcional: brapi Startup, R$ 99,99/mês, só se a cota apertar, ou entrar intraday ou proventos.
**Com os US$ 100 do Azure for Students, o perfil padrão dura cerca de 5 semanas e o econômico, de 10 meses a mais de um ano** (os alertas da etapa 10 acrescentaram uns US$ 2,7 por mês ao econômico).
Modelos do Marketplace não entram no crédito; a cota de Azure OpenAI pode vir zerada.

### 5.13 Fases de evolução

| Fase | Gatilho | Ação |
|---|---|---|
| 1 · TCC | até ~1 mil usuários | Setup acima |
| 2 · Latência BR | p95 mobile > 800 ms mesmo com cache | Brazil South |
| 3 · Banco | CPU > 70% sustentado | B2s → General Purpose; réplica de leitura |
| 4 · Isolamento | demo pública longa ou SLA | Front Door Premium com Private Link, HA do banco, private endpoints, min 2 réplicas |
| 5 · Mais competições | variações de prompt em paralelo | Service Bus Standard com tópicos (uma assinatura por competição) |
| 6 · Intraday e proventos | pedido dos usuários | brapi Startup/Pro e fila `quotes` |
| 7 · Cache distribuído | rate limit inconsistente entre réplicas | Azure Managed Redis |

### 5.14 Decisões deliberadas

| Decisão | Por quê |
|---|---|
| Front Door Standard, não Application Gateway | Borda global com cache e POP no Brasil por ~US$ 35; Application Gateway v2 é regional e custa várias vezes mais |
| Front Door Standard, não Premium | Premium (US$ 330) só traria Private Link e regras gerenciadas de WAF; a trava por `X-Azure-FDID` resolve no TCC |
| Service Bus, não Storage Queue nem BullMQ | DLQ nativa, mensagem agendada, métricas de fila no Azure Monitor, escala do worker pela fila, sem Redis |
| Service Bus Basic, não Standard | Idempotência no banco dispensa a detecção de duplicata; sem tópicos na fase 1 |
| Dois workers, não um por fila | worker-data junta as filas leves (uma réplica dá conta); decisões em job por evento para isolar cada modelo |
| Agendador só publica | Cron fica trivial; retry, DLQ e escala ficam na fila |
| Container Apps, não AKS | Cron, fila e revisões nativos; AKS é exagero |
| brapi como fonte única das cotações, o banco como cache (ADR 0032; antes: COTAHIST como preço oficial, ADR 0009) | A B3 veda a coleta automatizada, inclusive por IA; a licença da brapi deixa guardar, persistir e montar séries; gratuita (15 mil por 30 dias) |
| Decidir antes, executar na abertura | Nenhum modelo vê o preço de execução |
| Prompt no Key Vault | Repositório público; hash prova a igualdade |
| Bicep, não Terraform | Nativo, sem estado para guardar |
| Node 26 LTS | Pedido do Artur; dependências declaram suporte; ADR com volta para o 24 |
| TypeScript 6.0.x | typescript-eslint ainda exige TS < 6.1 |

### 5.15 Riscos e mitigações

| Risco | Prob. | Mitigação |
|---|---|---|
| Crédito acabar e a Azure desligar tudo | Alta no padrão | Perfil econômico, orçamento com alertas, dump mensal fora da assinatura |
| Perda de host (como na TradeRank S7) | Baixa | Serviços gerenciados, PITR, Blob, filas guardam o trabalho pendente |
| Mensagem envenenada travar uma fila | Média | Entregas máximas por fila → DLQ, alerta, reenvio pelo admin |
| Brapi atrasar, cair ou ficar sem cota | Média | Reagendamento +60 min até 00:30 pedindo só a falta; a janela de 5 pregões recupera na noite seguinte; reserva de 500 requisições e os sinais `eod-barras-ausentes` e `brapi-cota-baixa` (`docs/DADOS.md`, seção 6; RUNBOOK, seção 12) |
| Provedor de LLM fora | Média | Redelivery da fila + prazo 09:30; sem resposta = HOLD |
| SSE bufferizado no Front Door | Média | Validar na etapa 3; subdomínio direto ao ingress se precisar |
| Prompt vazar | Baixa | Key Vault; canário + n-gramas nos textos públicos |
| Injeção por notícia | Média | Dado delimitado e truncado; igual para todos |
| Custo de LLM disparar | Média | Teto checado antes do ciclo: estoura = ciclo inteiro em HOLD |
| Resultado ser sorte | Alta | Monte Carlo + sorteio; percentil como resultado principal |
| Benchmark injusto | Média | Igual-peso só preço como referência principal |
| Chat soar como recomendação | Média | Aval do orientador antes da etapa 13, aviso, termos |
| Ação ilíquida inflar resultado | Média | Filtro de presença e volume |
| Termos da B3 e dos sites de notícia vedarem a coleta automatizada ou a reprodução a terceiros (achado das etapas 4 e 5) | Alta | **Decisão do Artur e do orientador.** Pedir autorização por escrito à B3 e aos sites, ou usar fonte licenciada como primária. Até lá, **já é assim no código:** o trecho do Money Times, do Seu Dinheiro e do InfoMoney não vai às LLMs (só título, fonte, hora e tickers). **Recomendação das etapas 4 e 5, ainda sem decisão:** a página pública (etapa 9) não exibir tabela de preços da B3 nem trecho de notícia. A brapi também veda redistribuir os dados. Citações em `docs/DADOS.md` (seções 10 e 13) e `docs/DEPENDENCIAS.md` |
| Fato relevante da CVM chegar com atraso | Alta | Os dados abertos da CVM são refeitos uma vez por dia e passam por um CDN: o fato relevante entra no briefing um a dois pregões depois. Igual para todos os modelos e declarado como limitação (`docs/DADOS.md`, seção 14); fonte em tempo real (RAD/ENET) tem outros termos |

### 5.16 Checklist antes de abrir para o público

- [ ] Plano aprovado; data de entrega, créditos, região e roster definidos
- [ ] `infra/` sobe do zero; banco sem IP público; origem só aceita o Front Door
- [ ] Segredos e prompts no Key Vault; nada no GitHub nem nas imagens
- [ ] Orçamento, alertas (incluindo DLQ) e health probe ativos
- [ ] Restore de teste executado com sucesso
- [ ] 5 pregões seguidos da Temporada 0 sem intervenção e sem DLQ
- [ ] Playwright mobile e desktop verdes pelo Front Door
- [ ] Termos, privacidade (com a transferência internacional), exportar e excluir conta funcionando
- [ ] **Textos legais revistos** pelo Artur e pelo orientador: termos de uso e política de privacidade estão em **rascunho** (termos na versão 0.2, a da carteira, e política na **0.3**, a que promete o pior caso da limpeza diária; `apps/api/src/modules/account/legal/`), sem leitura de quem entende de direito; confirmar a base da transferência internacional (LGPD, art. 33), os prazos de retenção (cadastro não confirmado em até 7 dias, sessão guardada no máximo 8, pedido de uso único em até 1 dia depois de vencer, e a ressalva do texto de que, se uma limpeza falhar ou não rodar, o prazo cresce pelos dias sem limpeza; o corte de 5 dias no lugar de 6, que dá folga a uma limpeza perdida, é decisão do Artur, `docs/CONTA.md`, seção 5) e o controlador/contato (`docs/CONTA.md`, seção 8); a 0.2 e a 0.3 só vão ao ar junto da tela `/carteira`, que elas descrevem (`docs/DEPLOY.md`, seção 1; a tela existe desde a parte 2 da etapa 12, `docs/TELAS.md`, seção 9: os dois vão no mesmo deploy)
- [ ] **E-mail da conta com domínio próprio verificado** no Communication Services: o domínio gerenciado pela Azure aceita 5 e-mails por minuto e 10 por hora por assinatura, sem aumento, e qualquer pessoa gasta isso sem conta (`docs/CONTA.md`, seção 6)
- [ ] **Decidir a mitigação do pré-sequestro por cadastro** (`docs/CONTA.md`, seção 11; ADR 0031): quem cadastra primeiro o e-mail de outra pessoa guarda a senha dele, e se a vítima clicar no link de verificação que não pediu, a conta passa a existir verificada com a senha de quem cadastrou (a vítima só a recupera pela redefinição de senha). O risco pesa mais desde a etapa 12, porque a conta guarda carteira, mas a carteira **não fica exposta** enquanto quatro ajustes valerem, e eles estão presos em teste (o clique não abre sessão, o Google não se liga sozinho, a redefinição revoga as sessões, `change-email`, `update-user` e `link-social` fechados); o resíduo é a conta ocupada. As saídas: invalidar a senha e as sessões criadas antes da verificação, ou pedir a senha no próprio link. Decisão de produto do Artur, ainda não tomada
- [ ] **Limpeza periódica**, diária (`0 13 * * *`, 10:00 de Brasília), que a política de privacidade promete pelo pior caso (cadastros nunca confirmados apagados em até 7 dias depois de criados: corte de 6 dias mais 1 de espera; sessões e pedidos de uso único vencidos, em até 1 dia depois de vencer) na fila `maintenance` da etapa 10; papel do Postgres da api só com o que a conta escreve (`docs/CONTA.md`, seções 5, 8 e 11). **Código pronto na etapa 10, onda 3d** (a retenção, o papel e a matriz de tabelas); o segundo segredo (`database-url-api`) e o passo do deploy que cria o login (o `job-migrate` roda o `db:roles`) estão no Bicep desde a parte 4; falta aplicá-los na Azure e ver a retenção rodar. **Nenhum alerta vigia a ausência da limpeza** (agendador que não publica, worker que não acorda): só a conferência diária do RUNBOOK, em dia de pregão (`docs/INFRA.md`, 5.3, limitações); um alerta de contagem zero fica para a primeira semana real
- [ ] **Cotações (brapi), com a revisão do orientador** (`docs/DADOS.md`, seções 2 e 10; `docs/API.md`, seção 6; ADR 0032 e 0033): a licença da brapi deixa guardar, persistir e exibir aos usuários, e **proíbe entregar os Dados a terceiros como feed, API ou base bruta**. **Feito na parte 2 da onda (03/11/2026):** a API pública não entrega mais cotação bruta (saíram as barras de `/stocks/:ticker` e o fechamento do BOVA11 do `/arena/current`; um teste de contrato reprova a volta), **nem a composição da carteira do Sorteio e das referências e os donos que não são modelo** (a revisão de segurança mostrou que o igual-peso segura o universo inteiro, uns 300 papéis, e que `(patrimônio − caixa) ÷ quantidade` devolvia o fechamento do BOVA11: bastava uma chamada por pregão para reconstruir a série), o site lê as barras por uma rota interna com segredo do servidor, e o rodapé diz "Cotações: brapi.dev" (com link) e o crédito repete onde há cotação. **Falta o Artur e o orientador confirmarem** que isso basta para o TCC, com o risco residual do ADR 0033: os registros da arena dos **modelos** (`markCents` e `valueCents` das posições, no máximo `maxPositions` por modelo, que a licença trata como resultado e indicador derivado) seguem na API pública, e a carteira do usuário (privada) devolve o último fechamento de cada posição dele. As saídas, se não bastar, estão no ADR 0033: peso e retorno em pontos-base no lugar de `markCents`, `valueCents` e `avgPriceCents`, ou só o retorno e o P&L. A brapi **não é distribuidora licenciada da B3** (a B3, que vedava a coleta, saiu da fonte)
- [ ] Autorização por escrito (ou a decisão registrada de não exibir trecho) para os sites de notícia (`docs/DADOS.md`, seção 13)
- [ ] Atribuições na página pública: "Contém dados da CVM, licença ODbL" e "Fonte: Banco Central do Brasil" (a licença do BCB não foi conferida)

---

## 6. Agendadores, filas e workers

Cron em UTC (Container Apps usa UTC). Brasília = UTC−3, sem horário de verão.

**Agendadores (cron jobs):** só publicam mensagens, com `MessageId` determinístico (ex.: `eod:2026-10-30`).

| Agendador | Cron (UTC) | Brasília | Publica em | Mensagem |
|---|---|---|---|---|
| `sched-news` | `*/30 * * * *` | a cada 30 min | `news` | uma `fetch` por fonte |
| `sched-briefing` | `30 10 * * 1-5` | 07:30 seg–sex | `briefing` | `freeze {pregão}`, se for pregão |
| `sched-cycle` | `0 11 * * 1-5` | 08:00 seg–sex | `decisions` | uma `decide` por competidor, se o briefing existe e o teto de custo permite |
| `sched-eod` | `30 0 * * 2-6` | 21:30 seg–sex | `market` | `eod {pregão}` (o reagendamento fica com o worker) |
| `sched-universe` | `0 12 * * 0` | domingo 09:00 | `market` | `universe {semana}` |
| `sched-retention` | `0 13 * * *` | todo dia 10:00 | `maintenance` | `retention` |
| `sched-backup` | `0 6 1 * *` | dia 1, 03:00 | `maintenance` | `backup-verify` |
| `migrate` | — | a cada deploy | — | `prisma migrate deploy` (manual pelo CI) |

**Filas e workers:** ver tabela da seção 5.5. Todo processamento grava `job_run` e usa trava consultiva no
Postgres onde precisa serializar (settlement).

---

## 7. Um pregão, do briefing à liquidação

| Hora (Brasília) | Evento |
|---|---|
| a cada 30 min | `sched-news` → fila `news` → worker-data ingere |
| 07:30 | `sched-briefing` → `briefing` → worker-data congela a entrada (SHA-256) |
| 08:00 | `sched-cycle` → uma mensagem por modelo em `decisions` → uma execução do worker-decisions por modelo |
| 09:30 | Prazo: sem resposta = HOLD |
| 10:00 | Abertura: preço oficial de abertura = preço de execução |
| 16:55 | Fechamento |
| ~20:45 | a barra do dia costumava sair no COTAHIST da B3; agora é a brapi (a hora em que ela tem a barra de todo papel é o que o `eod` descobre, de hora em hora) |
| 21:30 | `sched-eod` → `market` → worker-data pede à brapi só as barras que faltam (reagenda +60 min por papel faltando, até 00:30) → publica `settle` → liquida, rende CDI, marca, roda o Monte Carlo do dia, revalida o site e limpa o cache do Front Door |

---

## 8. Modelo de dados (PostgreSQL 17, Prisma 7)

- **Identidade:** `user`, `session`, `account`, `verification` (Better Auth) · `profile` (termos e versão)
  > Desvio (etapa 11, ADR 0024): a tabela dos termos se chama `consent` (uma linha por usuário, documento e versão, com o SHA-256 do texto e a data; histórico que não se reescreve). O papel (`user` ou `admin`) é uma coluna de `user`.
- **Mercado:** `instrument` · `daily_bar` · `trading_day` · `universe_snapshot` + `universe_member` · `macro_daily`
- **Notícias:** `news_item` (`url_hash` único) · `briefing` (pregão único, SHA-256, URI no Blob)
- **Arena:** `season` · `competitor` · `prompt_version` (só SHA-256 e versão do segredo) · `cycle` · `decision`
  (ciclo + competidor únicos) · `decision_item` · `order` · `fill` · `position` · `equity_snapshot` ·
  `season_stat` · `random_baseline` (Monte Carlo: semente, distribuição por pregão, percentis) · `corporate_event`
- **Usuário:** `portfolio` · `portfolio_lot` (quantidade, custo total em centavos, data) · `chat_thread` · `chat_message`
  > Acréscimo (etapa 12, parte 1; ADR 0031): `portfolio` (uma por usuário) e `portfolio_lot` (ticker, quantidade, custo total em centavos, data opcional) existem, são dado pessoal (fora do dump mensal, no export, apagadas com a conta) e o ticker é texto validado na escrita contra `instrument`, **sem chave estrangeira**.
- **Operação:** `job_run` · `audit_log`

---

## 9. API (`/api/v1`, atrás do Front Door)

| Grupo | Rotas |
|---|---|
| Públicas (cache) | `GET /arena/current` · `/seasons` · `/seasons/:id/leaderboard` · `/seasons/:id/equity` · `/seasons/:id/random-baseline` · `/competitors/:slug` · `/cycles/:date` · `/decisions?action=BUY\|SELL\|HOLD` · `/news` · `/stocks?q` · `/stocks/:ticker` |
| Conta | `/api/auth/*` (Better Auth) · `GET /me/export` · `DELETE /me` · (etapa 11) `GET /me` · `POST /me/consents` · `GET /legal` · `GET /auth/providers`, ver `docs/API.md`, seção 7 |
| Carteira | `GET /me/portfolio` · `POST /me/portfolio/lots` · `PATCH`/`DELETE /me/portfolio/lots/:id` |
| Interna (só o site) | `GET /interno/barras/:ticker`: as barras de preço, que nenhuma rota pública entrega (a licença da brapi); `Authorization: Bearer <QUOTES_SECRET>`, 404 sem ele, fora do Swagger e do cache; `docs/API.md`, seção 6; ADR 0033 |
| Chat | `GET`/`POST /me/chat/threads` · `POST /me/chat/threads/:id/messages` (SSE) · `DELETE /me/chat/threads/:id` |
| Admin | `POST /admin/seasons` · `PATCH /admin/seasons/:id` · `POST /admin/cycles/:date/rerun` · `POST /admin/dlq/:queue/resubmit` · `POST /admin/corporate-events` · `GET /admin/costs` · `GET /admin/jobs` |

Rotas do site: `/`, `/ranking`, `/modelos/[slug]`, `/ciclos/[data]`, `/noticias`, `/acoes/[ticker]`, `/carteira`,
`/chat`, `/como-funciona`, `/conta`, `/admin`.

> Acréscimo (etapa 12, parte 1; `docs/API.md`, seção 9; ADR 0031): as quatro rotas da carteira existem, com sessão e aceite em toda rota, só do dono (o lançamento de outro usuário é 404) e sempre `no-store`. O `PATCH` troca o lançamento **inteiro**, com o mesmo corpo do `POST`; o `POST` responde 409 `LOT_LIMIT` com 200 lançamentos; quem aceitou os textos 0.1 recebe 403 `CONSENT_REQUIRED` até aceitar os 0.2. A tela `/carteira` é a parte 2 (`docs/TELAS.md`, seção 9): sem aceite em dia ela manda para a `/conta`.

> Acréscimo (etapa 11, parte 2): a conta tem as telas `/entrar`, `/cadastro`, `/verificar-email`, `/esqueci-senha`, `/redefinir-senha`, `/termos` e `/privacidade`, além da `/conta` (`docs/CONTA.md`, seção 9; ADR 0025).

> Acréscimo (etapa 10, parte 2; `docs/API.md`, seção 8; `docs/TELAS.md`, seção 8; ADR 0027): as sete rotas de admin existem, mais uma leitura, `GET /admin/seasons` (o painel precisa ver o rascunho, que a API pública esconde), e o `/admin` é um painel só do admin (404 para quem não é). O `@Roles('ADMIN')` está em cada rota; a mutação grava `audit_log` com o ator `admin:<ULID>`; o reprocesso do ciclo nunca publica nos últimos 5 minutos antes do prazo das 09:30 nem depois dele, e nunca muda decisão gravada; a regra de uma temporada em andamento é conferida na transação do início, sob trava; o reenvio da DLQ é idempotente pelo MessageId (até 10 por chamada); o evento corporativo registra e **enfileira** a reliquidação, e o worker liquida (a api não escreve nas tabelas de resultado: papel mínimo do Postgres, ADR 0028); o `account:demote` existe. O primeiro admin na Azure nasce de uma execução do `job-migrate` com outro comando (`docs/INFRA.md`, 8.6), e a temporada se cria e se inicia pelo painel.

---

## 10. LLMs, prompt oculto e igualdade

**Roster sugerido:** topo de cada laboratório (Anthropic, OpenAI, Google, xAI, DeepSeek, Alibaba), mais Sorteio,
igual-peso, CDI e BOVA11. IDs fixados na criação da temporada.

**Gateway:** cliente OpenAI-compatível (SDK `openai`) com `baseURL` por competidor: OpenRouter, Azure OpenAI ou `fake`.

**Entrada de cada modelo** (igual para todos, exceto a própria carteira): regras e data; macro (CDI, Selic, IPCA,
dólar, BOVA11); tabela do universo (≤ 500 linhas, **ordem embaralhada com semente do pregão**); barras de 30
pregões para posições, ações citadas e top 15 da triagem; notícias desde o último ciclo (título, fonte, hora,
tickers, trecho do RSS de até 300 caracteres); a própria carteira.

A **triagem** (etapa 5, `docs/DADOS.md`, seção 18) é a das 15 maiores variações absolutas do último pregão entre as 100 ações
mais líquidas do universo; a **ordem** da tabela é a do SHA-256 de `<pregão>:<ticker>`. O trecho só vai das fontes que os termos
deixam (§0.1). O briefing congelado leva a triagem e as ações citadas; as barras das posições de cada modelo ficam na parte
própria dele.

**Saída (JSON estrito, Zod):**

```json
{
  "summary": "até 600 caracteres, em português; vai para o feed público",
  "market_view": "otimista | pessimista | neutro",
  "decisions": [
    { "ticker": "WEGE3", "action": "BUY",  "percent_of_equity": 10,  "confidence": 0.7, "rationale": "até 280 caracteres" },
    { "ticker": "VALE3", "action": "SELL", "percent_of_position": 50, "confidence": 0.6, "rationale": "…" },
    { "ticker": "ITUB4", "action": "HOLD", "rationale": "…" }
  ]
}
```

**Prompt oculto:** Key Vault (`prompt-arena`, versionado), nunca no repositório, na imagem nem em resposta da API.
Cada ciclo publica SHA-256 do prompt e do briefing, parâmetros e horários. Filtro de vazamento: canário + n-gramas
de 8 palavras nos textos públicos. **Revelação:** recomendo revelar o texto no fim de cada temporada (o hash
publicado confere); a decisão é sua.

**Parâmetros iguais:** tokens de saída, esforço de raciocínio "médio" onde existir, sem ferramentas, JSON Schema
onde aceito; o que o provedor aplicou é gravado. **Custo:** `usage` de cada resposta em `decision`.

---

## 11. Carteira e chat consultivo

**Lançar compra:** qualquer ação da B3 (o teto de 500 é só das IAs), quantidade inteira, modo **"preço por ação"**
ou **"valor total pago"**, valor em R$, data opcional. Custo total em centavos; preço médio = Σ custo ÷ Σ
quantidade; P&L = quantidade × último fechamento − Σ custo.

> Acréscimo (etapa 12, parte 1; `docs/API.md`, seção 9; ADR 0031): os tetos são de 1.000.000 de ações e R$ 1.000.000.000,00 por lançamento e 200 lançamentos por usuário (a soma do pior caso cabe em inteiro seguro). O valor digitado lê no jeito brasileiro (`1.234,56`); o ponto com 1 ou 2 dígitos depois é decimal e o ponto com 3 (`1.234`) é recusado por ambíguo. Os dois modos geram o mesmo custo total. Arredonda-se só o preço médio (no centavo) e o P&L percentual (em ponto-base), pela regra do domínio; o fechamento é o da barra mais recente do papel, com a data, e o valor é **estimado**.

> Acréscimo (etapa 12, parte 2; `docs/TELAS.md`, seção 9): a tela `/carteira`, mobile primeiro. Mostra o resumo (custo, valor estimado e resultado), as posições por ticker (preço médio, o fechamento **com a data dele**, valor e resultado com sinal e palavra, "sem cotação" para o ticker sem barra) e os lançamentos, e lança, edita e apaga com o formulário da regra de dinheiro da api (a confirmação de apagar é na própria página, sem `window.confirm`). O aviso "valores estimados pelo último fechamento disponível; não é recomendação de investimento" está na tela, além do aviso fixo do rodapé. Link fixo "Carteira" no cabeçalho, que continua sem ler a sessão.

**Contexto do chat:** carteira (posições, preço médio, P&L, pesos), o que a arena fez com essas ações (contagens e
resumos), notícias recentes (títulos e links), CDI e Selic.

**Regras do assistente** (`prompt-chat`): educacional; cenários, prós e contras; não garante retorno; a decisão é
do usuário; não executa ordens; não revela instruções; cita a data dos dados; responde em português.

**Modelo:** só **Azure OpenAI**, sem reserva fora da Azure em tempo de execução. Se a assinatura não tiver cota, a
troca para OpenRouter é decidida antes da etapa 13, junto com a política de privacidade e o texto.

**Limites:** e-mail verificado para usar o chat; 30 mensagens por usuário e 60 por IP por dia; teto diário global
(o teto mensal dividido pelos dias) para um abuso não esgotar o mês; SSE; conversas apagáveis.

---

## 12. Responsabilidade, CVM e LGPD

- **CVM:** consultoria (Resolução CVM 19/2021) e análise (Resolução CVM 20/2021) são reguladas; a Alvesting é
  acadêmica e não presta esses serviços. O chat cruza a carteira real com as decisões dos modelos, então **a etapa
  do chat só começa com o aval do orientador**.
- **Termos de uso** com aceite versionado: o software não se responsabiliza por decisões do usuário.
- **LGPD:** dados mínimos, consentimento, exportar e excluir, chat retido 180 dias, provedores como operadores,
  logs pseudonimizados. **Transferência internacional** (dados em East US 2) informada na política e no
  consentimento (art. 33); Brazil South elimina a questão se o crédito permitir.

---

## 13. Mobile e testes

Mobile é gate de merge.

| Camada | Ferramenta | O que cobre |
|---|---|---|
| Unidade | Vitest 5 | Planejador de pedidos da brapi e a conta da cota, cliente da brapi (429, 5xx, 401, reserva), universo, validador, execução e custos, CDI, métricas, Monte Carlo (semente fixa), preço médio, dedupe, filtro de vazamento |
| Integração | Vitest + Supertest + Postgres + emulador do Service Bus | Endpoints, guarda de dono, LGPD, idempotência de cada mensagem (processar duas vezes = mesmo estado), DLQ |
| Contrato | Zod em `packages/contracts` | Mensagens das filas e respostas de LLM (incluindo JSON quebrado) |
| E2E | Playwright 1.64: Pixel 7 (Chromium), iPhone 15 (WebKit), desktop | Arena, modelo, ciclo, carteira nos dois modos, chat com LLM fake, excluir conta |
| Visual · a11y · desempenho | Snapshots, `@axe-core/playwright`, Lighthouse CI mobile | Telas-chave; alvos ≥ 44 px; LCP ≤ 2,5 s, CLS ≤ 0,1, TBT ≤ 200 ms |
| Pós-deploy | Smoke + Playwright mobile pelo Front Door | Antes de virar o tráfego |

Nenhum teste chama LLM, B3, CVM, BCB ou brapi de verdade. Cobertura mínima de 80% no domínio.

---

## 14. Documentação obrigatória

Regra: **tudo que vem de fora é documentado no mesmo PR que o introduz.**

| Arquivo | Conteúdo |
|---|---|
| `docs/DEPENDENCIAS.md` | Pacote, serviço, API, fonte de dados, ferramenta, fonte tipográfica, arquivo baixado: item, tipo, versão, licença, para quê, onde, data, link |
| `docs/adr/NNNN-*.md` | Uma decisão por arquivo (5.14 vira as primeiras) |
| `docs/INFRA.md` · `docs/JOBS.md` | Spec da Azure e tabela de agendadores, filas e workers |
| `docs/METODOLOGIA.md` · `docs/RESULTADOS.md` | Regras, limitações e a resposta à pergunta de pesquisa |
| `docs/RUNBOOK.md` | Reprocessar ciclo, reenviar mensagem da DLQ, girar segredo, restaurar backup, voltar revisão |

Cobrança: `pnpm docs:check` no CI, template de PR e `CLAUDE.md` do repo.

---

## 15. Dependências externas (inventário inicial)

Versões conferidas no npm e em nodejs.org em 31/10/2026.

| Item | Versão | Para quê |
|---|---|---|
| Node.js | 26.13.0 LTS | Runtime (LTS desde 28/10/2026) |
| pnpm / Turborepo | 12.16.1 / 2.11.10 | Monorepo |
| TypeScript | 6.0.3 | Ver 5.14 |
| Next.js / React | 16.4.3 / 19.3.1 | Front |
| Tailwind CSS / TanStack Query | 4.3.3 / 5.105.0 | Front |
| NestJS / CLI | 12.3.2 / 12.0.11 | API, workers, agendadores |
| Prisma | 7.10.1 | ORM |
| Zod / Better Auth | 4.6.7 / 1.7.14 | Contratos, login |
| Pino / nestjs-pino | 10.4.0 / 5.3.1 | Logs |
| `openai` | 7.47.0 | Cliente único de LLM |
| `@azure/service-bus` | a fixar na etapa 1 | Filas |
| `@azure/identity`, `@azure/keyvault-secrets`, `@azure/storage-blob`, `@azure/monitor-opentelemetry` (1.20.1) | etapa 1 | Identidade, segredos, Blob, telemetria |
| `yauzl` (no lugar do `fflate`), `fast-xml-parser`, `csv-parse` | etapas 4–5 | ZIP da CVM (o do COTAHIST saiu), RSS, CSV da CVM. O `fflate` falhou no anual de 2026 (`unexpected EOF`); ver `docs/DEPENDENCIAS.md` |
| Vitest / Playwright / axe / Lighthouse CI / ESLint | 5.0.5 / 1.64.1 / 4.14.0 / 0.15.1 / 10.14.0 | Testes e lint |
| Emulador do Service Bus (imagem Docker oficial) | etapa 1 | Filas no dev e no CI |
| Geist (só o 500); o texto e a mono são as fontes do sistema | `next/font` (OFL) | Tipografia do sistema visual ascii-ui (ADR 0034, 04/11/2026; a Inter do plano do porte saiu pelo LCP da home). Até então, IBM Plex Mono e Sans (a estética crua) |
| **Serviços** | | Azure (5.3), OpenRouter, Azure OpenAI, Google OAuth, GitHub Actions |
| **Dados** | | brapi (as cotações, fonte única), CVM IPE e FCA, BCB SGS, feeds RSS (InfoMoney, Money Times, Seu Dinheiro, Agência Brasil); a lista de feriados da B3, escrita à mão |

---

## 16. Plano de execução

Cada etapa vira um comando `/ecc:orchestrate` em `docs/tcc-v2/ORQUESTRACAO.md`. A ordem põe a arena no ar e a
temporada rodando o quanto antes; telas, conta, carteira e chat são construídos enquanto ela corre.

<!-- ETAPAS:INICIO -->

<a id="step-1"></a>
### Etapa 1: Fundação do monorepo e documentação obrigatória

Criar o monorepo novo da Alvesting v2: pnpm + Turborepo, Node 26 LTS, apps/web (Next 16.4), apps/api (NestJS 12 com SWC e entradas main, worker, decide e schedule), packages/contracts (Zod 4), docker-compose com Postgres 17, Azurite e emulador do Service Bus, lint e CI base, e docs/ com DEPENDENCIAS.md, ADRs e docs:check.
**Aceite:** pnpm dev sobe web e api; pnpm check verde no CI; docs:check falha se uma dependência não estiver em DEPENDENCIAS.md.
**Fora do escopo:** telas, domínio da arena, infra Azure.

<a id="step-2"></a>
### Etapa 2: Infra base em Bicep: Front Door, Container Apps, Service Bus e banco privado

Criar a infra em Bicep: Front Door Standard com rotas /api e /*, ambiente do Container Apps na VNet com ca-web, ca-api, worker-data, worker-decisions e agendadores, Service Bus Basic com 6 filas e DLQ, PostgreSQL privado, Key Vault com identidade gerenciada, ACR, Storage, Log Analytics e orçamento.
**Aceite:** deploy do zero num resource group vazio sobe tudo; o what-if da segunda execução não mostra mudanças; banco sem acesso público e origem só aceita o Front Door.
**Fora do escopo:** réplica de leitura, HA do banco, Front Door Premium.

<a id="step-3"></a>
### Etapa 3: Pipeline de deploy com smoke mobile pelo Front Door

Montar o pipeline no GitHub Actions com OIDC: imagens no ACR, job de migração, nova revisão de ca-web e ca-api, smoke e Playwright mobile pelo Front Door, rollback para a revisão anterior e teste do streaming SSE pelo Front Door; publicar a versão mínima (olá + /health) já nesta etapa.
**Aceite:** merge na main publica sem passo manual; smoke falho mantém a revisão antiga com 100% do tráfego; resultado do teste de SSE registrado em ADR.
**Fora do escopo:** blue/green com labels, alertas completos.

<a id="step-4"></a>
### Etapa 4: Dados de mercado da B3

Implementar no worker-data a fila market: parser do COTAHIST pelo layout oficial, mensagem eod que se reagenda em +60 min se o arquivo não saiu, carga histórica pelos arquivos anuais, calendário de pregões e universo semanal (até 500 ações por volume de 60 pregões, presença >= 90%).
**Aceite:** parser bate com um arquivo de amostra conferido; processar a mesma mensagem duas vezes não duplica nada; universo da semana gravado.
**Fora do escopo:** liquidação de ordens, cotação intraday.

> Mudança (onda da brapi, 03/11/2026; ADR 0032): o parser do COTAHIST, o download da B3, o arquivo dos ZIPs e a carga por arquivo anual
> foram apagados. A etapa 4 passa a ter a **brapi como fonte única**: o `eod` pede só a falta (obrigatório e opcional) e se reagenda por
> papel faltando; a carga histórica é o `market:backfill` pela brapi (3 meses, só inserção, retomável); o universo roda sobre as barras da
> brapi (volume estimado), com uma atualização semanal dentro do `universe`. O aceite continua: o mesmo `eod` duas vezes não duplica
> nada, e o universo da semana é gravado.

<a id="step-5"></a>
### Etapa 5: Notícias, macro e briefing congelado

Implementar no worker-data as filas news (uma mensagem por fonte: RSS e CVM IPE, com dedupe e marcação de tickers) e briefing (macro do BCB, notícias, barras D-1 e universo embaralhado com semente do pregão, congelados no Blob com SHA-256), com notícias como dado delimitado e truncado.
**Aceite:** a mesma entrada gera o mesmo SHA-256; notícia com instrução embutida chega só como texto delimitado; fato relevante da CVM fica no ticker certo.
**Fora do escopo:** resumo de notícias por LLM.

<a id="step-6"></a>
### Etapa 6: Motor de decisão da arena

Implementar temporadas, competidores e ciclos; sched-cycle publica uma mensagem por modelo na fila decisions; worker-decisions (job por evento) chama o gateway LLM (OpenRouter, Azure OpenAI ou fake) com o prompt oculto do Key Vault, valida BUY/HOLD/SELL com 1 reparo, aplica o prazo 09:30 e grava IO bruto e hashes.
**Aceite:** ciclo completo com provedor fake; mensagem na DLQ vira HOLD registrado; nenhuma resposta da API contém o prompt (canário).
**Fora do escopo:** telas, métricas do ranking.

<a id="step-7"></a>
### Etapa 7: Liquidação, métricas e controle aleatório

Implementar a fila settlement: execução no preço oficial de abertura, custo de 0,03%, CDI no caixa, posições, snapshot, métricas, referência igual-peso do universo só por preço, Sorteio obrigatório e Monte Carlo de 1.000 carteiras aleatórias com as mesmas regras para o percentil de cada modelo.
**Aceite:** fixtures batem com a planilha conferida à mão; nenhuma ordem usa preço anterior à decisão; percentil reproduzível com a mesma semente.
**Fora do escopo:** proventos.

<a id="step-8"></a>
### Etapa 8: Temporada 0 em produção e início da Temporada 1

Ligar a Temporada 0 em produção com provedores fake e acompanhar 5 pregões seguidos sem intervenção; depois ligar a Temporada 1 com as LLMs reais e o teto mensal de custo, para o experimento correr enquanto o resto é construído.
**Aceite:** 5 ciclos fake consecutivos sem intervenção e sem mensagem na DLQ; primeiro ciclo real completo dentro do teto.
**Fora do escopo:** telas públicas.

<a id="step-9"></a>
### Etapa 9: API pública e telas da arena, mobile primeiro

Implementar a API pública com cache e as telas da arena na estética crua: início (cotações, gráfico SVG, ranking com Sorteio e percentil, feed com filtro BUY/SELL/HOLD, contagem), ranking, modelo, ciclo, notícias (título e link), ação e Como funciona, com purge do Front Door após a liquidação.
**Nota de 04/11/2026:** o visual mudou. As telas saíram da estética crua para o sistema ascii-ui da v1, com o código da v2 (§17, item 7; ADR 0034; `docs/TELAS.md`, "Sistema visual (ascii-ui)").
**Aceite:** Playwright verde em Pixel 7, iPhone 15 (WebKit) e desktop; sem rolagem horizontal em 360 px; LCP <= 2,5 s no Lighthouse mobile da home.
**Fora do escopo:** login, carteira, chat.

<a id="step-10"></a>
### Etapa 10: Observabilidade e endurecimento

Implementar OpenTelemetry para o App Insights (requests, dependências, mensagens, tokens e custo de LLM), logs Pino, painel da arena, alertas (job falhou, DLQ > 0, origem doente, 5xx, banco, orçamento), blue/green com label green, backup-verify na fila maintenance e RUNBOOK.md.
**Aceite:** falha forçada dispara alerta em até 10 min; a restauração de teste passa; o runbook cobre reprocessar ciclo, reenviar DLQ, girar segredo, restaurar backup e voltar revisão.

<a id="step-11"></a>
### Etapa 11: Conta, login e LGPD

Implementar Better Auth com Google e e-mail/senha verificado (Azure Communication Services), papéis usuário/admin, termos e privacidade com aceite versionado que informa a transferência internacional (art. 33 da LGPD), exportar dados e excluir conta.
**Aceite:** rotas /me exigem sessão e só leem dados do dono; excluir a conta apaga carteira e conversas; aceite registrado com versão e data.
**Fora do escopo:** login social além do Google.

<a id="step-12"></a>
### Etapa 12: Carteira do usuário

Implementar a carteira: lançamentos de compra com quantidade e preço unitário ou valor total, edição e exclusão, posição consolidada com preço médio ponderado e P&L pelo último fechamento, e telas mobile.
**Aceite:** os dois modos de preço geram o mesmo custo total para os mesmos números; e2e mobile cria, edita e apaga um lançamento; o usuário A não vê a carteira do B.
**Fora do escopo:** nota de corretagem, vendas do usuário, imposto de renda.

<a id="step-13"></a>
### Etapa 13: Chat consultivo, após o aval do orientador

Com o aval do orientador, implementar o chat: contexto com carteira, decisões da arena e notícias; SSE; prompt oculto no Key Vault; aviso fixo; só Azure OpenAI; e-mail verificado; limites por usuário e por IP e teto diário global; histórico apagável.
**Aceite:** e2e mobile com LLM fake mostra streaming e aviso; pedido para revelar instruções é recusado; a 31ª mensagem do dia recebe 429.
**Fora do escopo:** executar ordens, ferramentas ou busca na web.

<a id="step-14"></a>
### Etapa 14: Análise e fechamento do TCC

Fechar a Temporada 1: conferir dados contra a B3, calcular o percentil de cada modelo no Monte Carlo e o excesso sobre CDI e igual-peso, responder à pergunta de pesquisa em RESULTADOS.md, revisar METODOLOGIA.md e as limitações, revelar o prompt se for a decisão e fechar DEPENDENCIAS.md.
**Aceite:** os números do RESULTADOS.md se reproduzem a partir do Blob e do banco; DEPENDENCIAS.md cobre tudo que o docs:check enxerga.
**Fora do escopo:** novas funcionalidades.

<!-- ETAPAS:FIM -->

---

## 17. Decisões para aprovar

1. **Data de entrega do TCC:** define o cronograma (seção 0.2). Precisa de ~13 semanas.
2. **Créditos da faculdade:** quanto e até quando. Com Front Door, o perfil padrão custa ≈ US$ 72–83/mês; o
   econômico, ≈ US$ 5–10.
3. **Balanceador:** Front Door no perfil padrão (recomendo se o crédito der) ou só o ingress do Container Apps.
4. **Prompt:** oculto na temporada e revelado no fim (recomendo) ou oculto para sempre.
5. **Repositório:** repo novo `alvesting` (recomendo) ou branch órfã no `ainvesting`.
6. **LLMs:** OpenRouter no cartão para a arena e Azure OpenAI no crédito para o chat (recomendo).
7. **Visual:** estética crua do Alpha Arena (recomendo) ou ascii-ui da v1. **Decidido em 04/11/2026: o ascii-ui da v1, com o código da v2** (o pedido do Artur; ADR 0034). **Trocado em 05/11/2026 pelo design do Rallies AI, nos dois temas seguindo o sistema** (o pedido do Artur, "Quero que copie o Design do Rallies AI"; ADR 0035): uma landing pública com a escadaria ASCII no hero e o app (o trilho de ícones no desktop e a barra de abas no celular), o `/chat` pronto e desligado até o aval do orientador e os logos dos laboratórios ao lado dos modelos; do ascii-ui ficou a arte (a escadaria e o urso). Pendência dele antes de publicar o repositório: conferir os termos vigentes da API do Higgsfield, de onde vem a arte do hero.
8. **Confirmar padrões:** R$ 100 mil, 20 pregões, CDI no caixa, East US 2, filtro de liquidez.

---

## 18. Fontes desta pesquisa

Nada foi baixado nem instalado. Leitura e consultas:

- Alpha Arena, Rallies, TradeRank (navegação só de leitura)
- Cargoos (local): `specs/production-deployment.md`, `docs/DEPLOY.md`, `CLAUDE.md`, `package.json`, `playwright.config.ts`
- nodejs.org/dist/index.json; registro do npm
- B3: cabeçalhos HTTP do COTAHIST (sem download; a fonte saiu na onda da brapi); horário do pregão; nº de companhias
- brapi.dev/pricing
- Azure: Container Apps billing, Azure for Students, aposentadoria do Azure Cache for Redis, PostgreSQL na conta
  gratuita, Foundry, **Front Door pricing** (Standard US$ 35, Premium US$ 330), **Service Bus tiers** (Microsoft
  Learn, out/2026: Basic só filas; Standard acrescenta tópicos, sessões, transações e detecção de duplicata)
- CVM: Resoluções 19 e 20/2021; dados abertos IPE
- OpenRouter: taxa sobre créditos (fontes secundárias)
- Revisão do plano feita pelo Claude de um amigo (Artifact público, 31/10/2026), lida como dado
