# API pública da arena (etapa 9, parte 1)

As rotas que o site e qualquer leitor externo usam, o cache delas, como o site as lê e o que nunca sai. Plano: §5.4, §9, §10 e §12. Os formatos
estão em `packages/contracts/src/public.ts` (os mesmos schemas validam a resposta na API e no site); o Swagger está em `/api/docs`.
As telas que as leem (etapa 9, parte 2) estão em `docs/TELAS.md`. O prompt da arena nunca aparece aqui: o usuário vê a versão e o SHA-256.
**A API pública não entrega cotação bruta** (a barra de preço de um papel): a licença da brapi proíbe entregá-la a terceiros como feed, API ou base bruta. O site a lê de uma **rota interna** com segredo do servidor (seção 6; ADR 0033).
As rotas de **admin** (etapa 10, parte 2) estão na seção 8: sessão, papel `ADMIN` e aceite em toda rota, nunca com cache.
A **carteira do usuário** (etapa 12, parte 1) está na seção 9: sessão e aceite em toda rota, só o dono, nunca com cache.

## 1. Rotas

Tudo em `/api/v1`, só `GET`, sem login, no envelope `{ success, data, error }` (as rotas da conta, com sessão, estão na seção 7). `:id` de temporada e `?season=` aceitam o ULID ou o slug; sem
eles vale a **temporada atual**: a que está em andamento (a que começou por último, se houver mais de uma) ou, não havendo, a última encerrada.
Temporada em rascunho (`DRAFT`) não é pública: some da lista e dá 404.

| Rota | O que devolve |
|---|---|
| `/arena/current` | A temporada atual, o último ciclo (pregão, horários, versão e SHA-256 do prompt, SHA-256 do briefing e a contagem de itens BUY, SELL e HOLD que valeram), **o próximo ciclo** (`nextCycle`: o pregão e o instante da decisão, para a contagem da home), o macro (CDI, Selic, IPCA do mês e em 12 meses e dólar, cada um com a data do dado; **sem o BOVA11**, cujo fechamento é cotação bruta: seção 6) e as 5 primeiras linhas do ranking. Sem temporada: `season`, `lastCycle` e `nextCycle` nulos e `top` vazio |
| `/seasons?limit&cursor` | As temporadas em andamento e encerradas, da mais nova à mais antiga, com os parâmetros públicos (as sementes do Sorteio e do Monte Carlo inclusive) |
| `/seasons/:id/leaderboard` | Por competidor, marcado pelo tipo (`MODEL`, `RANDOM`, `EQUAL_WEIGHT`, `CDI`, `BOVA11`): posição, patrimônio, retorno, percentil no Monte Carlo, excesso sobre o igual-peso e sobre o CDI, drawdown máximo, acerto (e as vendas que o explicam), operações e custo de LLM acumulado. Ordem: maior retorno; o empate vale a ordem do elenco |
| `/seasons/:id/equity` | A série de patrimônio por pregão de cada competidor (uma lista de datas e, para cada um, um valor por data), para o gráfico SVG |
| `/seasons/:id/random-baseline` | Os percentis 5, 25, 50, 75 e 95 do patrimônio e do retorno das carteiras aleatórias, por pregão |
| `/competitors/:slug?season` | O competidor (provedor e ID do modelo fixados), a mesma linha do ranking, a carteira do último pregão liquidado (o patrimônio e, **só para o modelo**, a composição em `holdings`: caixa, valor em ações e posições com preço médio e P&L; no Sorteio e nas referências `holdings` é `null`, seção 6), a série e as 10 últimas decisões |
| `/cycles/:date?season` | O ciclo de um pregão (a rota da etapa 6, `docs/ARENA.md`, seção 9). `:date` é `AAAA-MM-DD`; o **ULID do ciclo** continua valendo, pela mesma lógica |
| `/decisions?season&action&competitor&limit&cursor` | O feed de decisões, do pregão mais novo ao mais antigo, com `summary`, `market_view`, os itens que valeram e, dos descartados, só a posição e o motivo. `action` filtra: BUY e SELL pedem um item válido daquela ação; HOLD pede a decisão que só segurou (sem BUY nem SELL válido: HOLD explícito, lista vazia ou HOLD forçado) |
| `/news?ticker&limit&cursor` | Título, fonte, hora, tickers e link. **Nunca o trecho (`snippet`).** Da mais nova à mais antiga |
| `/stocks?q` | Busca por ticker ou nome, até 20 resultados (o ticker exato primeiro). `%` e `_` não são curinga; caractere de controle (o NUL inclusive) é 400 |
| `/stocks/:ticker` | Quais **modelos** têm a ação (a posição do último pregão liquidado, com a marcação, o valor e o P&L; o Sorteio e as referências não entram, seção 6), o que os modelos decidiram sobre ela (itens válidos) e as notícias com ela. **Sem as barras de preço** (seção 6). O `:ticker` aceita minúsculas |

**Listas por cursor (keyset).** `limit` vai de 1 a 100 (padrão 20) e o `nextCursor` é a posição da última linha (`[pregão, id]` no feed, `[hora, id]` nas
notícias): é opaco, e `null` na última página. Pedir a página seguinte devolve o que veio no `nextCursor`. A posição vale mesmo com linhas novas na frente.
Cursor torto é 400, nunca 500 (o que o Zod aceitaria e o Postgres recusaria, como o ano 0000 numa data do cursor ou o NUL na busca, é recusado na entrada).
**Parâmetro desconhecido ou repetido é 400 em toda rota**, inclusive nas que não têm parâmetro nenhum (`/arena/current`, `/seasons/:id/leaderboard`, `/equity`, `/random-baseline` e `/stocks/:ticker`
usam o `noQuerySchema`): sem isso qualquer `?x=<aleatório>` seria uma chave nova no cache da borda e uma ida à origem. O teste de integração percorre a lista inteira de rotas com `?x=1`, `?x=a&x=b`, `?x[y]=1` e
`?utm_source=...` e exige 400 com `no-store`, então uma rota nova que esqueça o schema reprova. Dinheiro é centavo inteiro e taxa é ponto-base inteiro, como número JSON exato (a API recusa o que perderia precisão); valor do BCB é texto decimal.

**O próximo ciclo (`nextCycle` do `/arena/current`).** É o pregão seguinte ao último ciclo da temporada em andamento (ou o primeiro dela, antes de o primeiro abrir), pelo calendário de feriados da B3 que o site não tem, com o
`decisionAt` (`decisionTimeBrt` da temporada, em UTC). **Não depende do relógio**, porque a resposta é cacheada por até 300 s: quem desenha a contagem compara o `decisionAt` com a hora de agora, e se já passou, o ciclo está abrindo.
É nulo sem temporada em andamento, quando a última sessão já abriu (a mesma conta do agendador: `tradingDaysBetween(início, pregão) > sessões`) e quando o arquivo de feriados não cobre o ano do próximo pregão (hoje 2026 e 2027; o agendador, que
precisa do calendário, é quem acusa a falta). Código: `apps/api/src/modules/public/domain/next-cycle.ts`.

**Erros.** 400 (`VALIDATION_ERROR` ou `BAD_REQUEST`) para parâmetro, cursor ou data inválidos, 404 (`NOT_FOUND`) para temporada, competidor, ciclo ou ação que
não existem. Erro sai sempre com `Cache-Control: no-store`.

## 2. Cache

| Camada | O que faz |
|---|---|
| **A API** | Toda GET pública bem-sucedida manda `Cache-Control: public, s-maxage=300, stale-while-revalidate=300` e `ETag` (304 na requisição condicional). O tempo de vida é **uma constante só**, `PUBLIC_CACHE_TTL_SECONDS` (300 s, `packages/contracts`), usada pela API, pela borda e pelo site. **Tudo o que não declara cache sai com `no-store`**, e o filtro de erros põe `no-store` por cima do cabeçalho da rota |
| **Front Door** (perfil padrão) | A rota `api-public` (`infra/modules/frontdoor.bicep`) guarda **só** as GET públicas acima, uma a uma (`/api/v1/seasons` e `/api/v1/seasons/*`...), respeitando o `Cache-Control` da origem, com a **query string na chave**. Nunca o `/api/*` inteiro (login, conta, admin e chat não vão para o cache de ninguém). O HTML não tem cache na borda (desvio deliberado do plano §5.4, ADR 0023). No perfil econômico não há Front Door e nada muda |
| **O site** (`apps/web/src/lib/api.ts`) | O SSR chama a API pelo `API_INTERNAL_URL`, manda o `X-Azure-FDID` com o `FRONT_DOOR_ID`, valida a resposta com o schema do contrato e marca cada leitura com `fetch(..., { next: { revalidate: 300, tags } })`. Tags: `arena` (tudo que a liquidação muda) e `news`. As barras de preço vêm da rota interna (`apps/web/src/lib/quotes.ts`, seção 6), pelo mesmo cache e com a tag `arena` |
| **Revalidação** | `POST /interno/revalidar` no site, só com `Authorization: Bearer <REVALIDATE_SECRET>` (comparado em tempo constante), vence as duas tags com `revalidateTag(tag, { expire: 0 })`. A trava de origem deixa passar **só essa rota e só esse método com o segredo válido** (`docs/INFRA.md`, 3.3). Sem o segredo no ambiente a rota responde 503 |
| **Purge** | `POST {FRONT_DOOR_ENDPOINT_ID}/purge?api-version=2025-06-01` na ARM REST, corpo `{"contentPaths":["/api/v1/*"]}`, com o token da `id-alvesting-worker` (200 ou 202). O Front Door leva até 10 minutos para propagar e o purge vale para toda variação de query string |

Depois de cada `settle` concluído o worker faz as duas coisas, **nessa ordem** (`docs/JOBS.md`, 4.2). Falha de uma ou das duas **não falha a liquidação**: vira um evento de log
(etapa e status, sem URL, sem cabeçalho, sem segredo) e o tempo de vida de 300 s limita o atraso. Sem as variáveis (dev, ensaio, perfil econômico) o passo é pulado com uma linha de log.

**Limites conhecidos.** (a) A revalidação vence o cache **do processo que a recebeu**: com até 5 réplicas do `ca-web`, o worker chama o ingress e cai numa só; as outras servem o dado velho até os 300 s
**e, passados eles, ainda para a primeira requisição**: o cache de dados do Next é stale-while-revalidate (serve a entrada vencida e a renova em segundo plano; `how-revalidation-works.md` e o `patch-fetch.js` do Next 16.4.3).
Quem abre o site depois de uma madrugada parada, numa réplica que perdeu a revalidação, vê o ranking de antes da liquidação (`ponytail` em `api.ts`; saída: cache handler compartilhado, fase 7 do plano, ou revalidar réplica a réplica).
(b) O Front Door não documenta `stale-while-revalidate`; a diretiva vale para outros caches e para o navegador. (c) Variar `q` ou `cursor` dá
chaves novas no cache: quem faz isso chega à origem, e o que a contém é o WAF (perfil padrão) e os índices abaixo. O nome do parâmetro, não: o desconhecido é 400 na origem (e a chave inteira da query string fica na rota,
`UseQueryString`, sem lista de nomes: uma lista no Bicep duplicaria o contrato, e esquecer um nome novo serviria a resposta de um valor para o pedido de outro).
(d) **Sem foto única entre as consultas.** Uma rota faz várias consultas em READ COMMITTED (até 4 em paralelo), e uma liquidação pode confirmar no meio. A liquidação troca as tabelas derivadas numa transação só, então cada consulta
vê o antes ou o depois, nunca meio a meio; o pior caso é uma resposta que mistura dois pregões vizinhos por milissegundos (o competidor com a métrica do pregão D e a série até D+1, por exemplo). A liquidação nunca encolhe a temporada,
então não há erro, e o purge e a revalidação, que rodam depois do commit, tiram a mistura do cache. Saída, se pesar: as consultas em `prisma.$transaction(..., { isolationLevel: 'RepeatableRead' })`, só leitura.
(e) **Mudança de contrato em duas releases.** O site valida a resposta com os mesmos schemas **estritos** que a API usa para montá-la, e o deploy vira a API antes do site (`scripts/deploy.mjs`): um campo novo na resposta faz o site
antigo responder `INVALID_RESPONSE` (502) até ele também virar. Por isso o campo novo entra em duas releases: primeiro o site e a API aceitam o campo (opcional, a API ainda não o manda), depois a API passa a mandá-lo.
Campo que sai ou muda de tipo é o inverso. (f) Uma notícia fora do contrato (mais de 50 tickers, por exemplo) não derruba a página: a linha é pulada e o id vai ao log (`noticia_fora_do_contrato`).

### Como o site lê

- Páginas que leem a API usam `export const dynamic = 'force-dynamic'` (ou `await connection()`): o `next build` da imagem não tem API para chamar. **Verificado** no build de produção com uma API falsa
  (01/11/2026): com `force-dynamic` ou `connection()` as leituras seguintes saem do cache de dados do Next sem tocar a API, e depois do `POST /interno/revalidar` a primeira leitura busca o dado novo.
  O que desliga o cache é `cache: 'no-store'` ou `revalidate: 0`, e o cliente nunca os usa.
- Escolha do mecanismo: `fetch` com `next.revalidate` e `next.tags` (e `revalidateTag`, que no Route Handler vence com `{ expire: 0 }`), e não `'use cache'`, `cacheTag` e `cacheLife`: estes exigem `cacheComponents`,
  que muda o modelo de renderização de todo o site e faz erro o `export const dynamic` que o `/health` já usa ("route segments that still export `dynamic`, `revalidate`, or `fetchCache` will error"). Fonte: a documentação que vem com o Next 16.4.3 (`node_modules/next/dist/docs`:
  `fetch.md`, `revalidateTag.md`, `updateTag.md`, `cacheTag.md`, `use-cache.md`, `cacheComponents.md`, `caching-without-cache-components.md`, `migrating-to-cache-components.md`, `how-revalidation-works.md`, `proxy.md`), lida em 01/11/2026.
  `updateTag` só existe em Server Action; o worker não é uma.
- A leitura das barras de preço (`readBars`, `apps/web/src/lib/quotes.ts`) também é `fetch` com `next.revalidate: 300` e a tag `arena`, e leva o segredo em `Authorization: Bearer`. Com `next.revalidate` explícito o Next guarda a resposta mesmo com `Authorization`
  na requisição de saída (o `autoNoCache` do `patch-fetch.js` só vale sem configuração de cache); a chave do cache é um hash que inclui o cabeçalho, e o corpo guardado é só a resposta da api (o e2e confere que o segredo não está em disco). O teste do e2e com a api falsa prova a
  segunda visita sem ida à api e a revalidação do worker vencendo a leitura.

## 3. O que nunca sai

O texto do prompt, o IO bruto das LLMs, os endereços do Blob (`briefing.uri`, `decision.io_uris`), o `news_item.snippet`, chaves, a config do competidor (recursos do provedor e preços), o conteúdo de `leak_fields`,
os hashes `meta_sha256` e tudo de `job_run`. Como é garantido: (1) todo corpo passa por um **schema estrito** antes de sair (campo a mais derruba a resposta em vez de vazar); (2) as consultas listam as colunas
(`select`/SQL explícito), nunca `*` (a leitura do ciclo, `GET /cycles/:id`, também); (3) o `snippet` nem é lido; (4) título e link de notícia são dado de terceiro: o título passa pela limpeza do worker de novo (sem HTML), e o link só sai se for `http` ou `https`, sem usuário
e senha (o banco também recusa `<tag` no título e link que não é http); (5) o texto do modelo (`summary`, `rationale`) já passou pela limpeza e pelo filtro de vazamento; (6) os `id` das linhas derivadas da
liquidação **não** são identificadores públicos (ADR 0022): tudo se identifica por slug, pregão e ticker.

**O teste de canário da etapa 6 varre todas as rotas.** `arena-cycle.integration.spec.ts` pede cada rota pública depois de um modelo devolver o prompt inteiro; `public-api.integration.spec.ts` planta um marcador
em cada coluna proibida (trecho, URIs, campos do filtro, erro do job, config) e confere que nenhuma rota o devolve.

## 4. Índices e EXPLAIN (migration `20261102000000_public_api_indexes`)

`news_item` é a única tabela que cresce sem teto (uns 700 itens por dia no máximo): GIN em `tickers` e btree em `(published_at DESC, id DESC)`. `EXPLAIN (ANALYZE, BUFFERS)` em 250 mil notícias
sintéticas (Postgres 17 local; tabela de 58 MB, GIN de 1 MB, btree de 14 MB):

| Consulta | Sem índice | Com os índices |
|---|---|---|
| Primeira página, sem filtro | varredura paralela da tabela, 7,5 mil páginas, 36,7 ms | `Index Scan` em `news_item_published_at_id_idx`, 0,06 ms |
| Página seguinte (`(published_at, id) < (...)`) | 20,7 ms | `Index Cond` na linha, 0,04 ms |
| Ticker popular (7,5% das linhas) | 21,4 ms | 0,16 ms (varre o btree e filtra) |
| Ticker raro (1 notícia) | 15,8 ms | 0,05 ms (`Bitmap Index Scan` no GIN e ordena) |
| Ticker inexistente | 14,1 ms | 0,02 ms |
| Ticker médio (4,9 mil notícias) e de cauda (179) | não medido sem índice (é varredura como as outras) | 0,35 e 0,57 ms |

Dois limites medidos na revisão, que a tabela não mostra. (1) **A lista pendente do GIN.** Com `fastupdate` ligado (o padrão) as linhas novas esperam numa lista pendente e toda consulta que usa o índice paga a leitura dela: o ticker
raro ou ausente levou 3,6 a 4,5 ms lendo 344 páginas, e 0,013 ms depois de esvaziá-la. A migration `20261102010000_news_item_tickers_fastupdate_off` desliga o `fastupdate` (a escrita é de uns 700 itens por dia: custa nada, e a consulta
fica estável). (2) **Ticker concentrado no passado.** Com 3.124 notícias do ticker, todas nos 5% mais antigos, o planejador escolheu o btree `(published_at DESC, id DESC)` e filtrou, descartando 237.561 linhas: 34 ms em 250 mil, linear no
tamanho da tabela e quase o custo de antes do índice (os tickers da tabela acima eram espalhados ao acaso). Notícia de ticker é recente por natureza, então hoje não acontece; o teto está num `ponytail` em `PublicRepository.news`:
se `news_item` passar de uns 1 milhão de linhas, limitar por janela de tempo ou forçar o caminho do GIN.

Os do **ranking**, do **feed** e da **ação** (20 pregões, 8 competidores, 1.446 posições, 221 itens, 3.218 barras: uma temporada inteira do ensaio) já rodam em menos de 0,3 ms com os índices que existem
(`cycle_season_id_date_key`, `decision_cycle_id_competitor_id_key`, `decision_item_decision_id_position_key`, `equity_snapshot_season_id_date_idx`, `position_competitor_id_date_ticker_key`, `daily_bar_instrument_id_date_key`,
`daily_bar_date_idx`): feed 0,13 a 0,26 ms, ranking 0,01 a 0,07 ms, série 0,02 a 0,18 ms, carteira 0,03 ms, "quem tem a ação" 0,17 ms, decisões sobre a ação 0,13 ms. São tabelas de milhares de linhas
por temporada; nenhum índice a mais. Estes números valem para as condições medidas (a temporada do ensaio, no Postgres local).

O **macro** (a home) precisa do último dia com barra. `aggregate({ _max: { date: true } })` do Prisma vira `SELECT MAX(date) FROM (SELECT date FROM daily_bar WHERE 1=1 OFFSET $1) sub`, e o `OFFSET` impede o plano de índice do MAX:
varre a tabela inteira a cada falha de cache da rota mais acessada (26 ms em 600 mil barras sintéticas; 9,8 ms com as 71 mil barras do banco de dev, medido na revisão; cresce com a carga histórica). O `findFirst` com `orderBy: { date: 'desc' }` lê uma
entrada de `daily_bar_date_idx` de trás para a frente: 0,02 ms nas mesmas 600 mil. O teto: "quem tem a ação" filtra `position` por temporada, pregão e ticker pelo índice do competidor; se a tabela passar de algumas dezenas de milhares de linhas, índice em `(date, ticker)`. A onda 3d (papel do Postgres com `statement_timeout` de 10 s) mediu de novo no banco sintético do e2e (292 posições): 0,3 ms para a consulta de "quem tem a ação", então o índice continua fora; o teto é o mesmo. Desde o ADR 0033 a consulta só junta os donos que são **modelo** (`competitor.kind = 'MODEL'`): medida de novo no mesmo banco, com o SQL equivalente escrito à mão (não o que o Prisma gera), saiu a 0,09 a 0,38 ms, com o filtro e sem ele (o primeiro plano inclui a leitura fria), a mesma ordem de grandeza; o plano passa a entrar pelo índice `position_competitor_id_date_ticker_key`, a partir dos 4 modelos.

A **rota interna de cotações** (`QuotesRepository.bars`, seção 6) lê as 60 barras mais recentes de um papel por `daily_bar` ligada a `instrument` pelo ticker (único). `EXPLAIN (ANALYZE, BUFFERS)` no banco descartável do ensaio (2.616 barras, 65 do papel; Postgres 17 local):
0,28 ms, com `daily_bar_instrument_id_date_key` na busca das barras do papel e uma ordenação de 65 linhas. A ordenação é só das barras de UM papel (as barras de um papel crescem um pregão por dia), não da tabela, então o custo não cresce com a carga histórica dos outros. O teto: a ordenação é linear nas barras de um papel (hoje uns 65, porque a janela de carga é de 3 meses); se passarem de alguns milhares e a consulta pesar, a saída é buscar o id do papel primeiro e ordenar por `(instrument_id, date DESC)`, que esse mesmo índice único atende.

## 5. Dados sintéticos e e2e

Os testes de integração das rotas e o e2e usam o **driver do ensaio** (`docs/ENSAIO.md`): uma temporada inteira de mercado, notícias, macro e decisões inventados, sem rede e sem dado de terceiro.
`pnpm --filter @alvesting/api e2e:seed` recria e semeia o `alvesting_e2e_test` (a variável `E2E_DATABASE_URL` troca o banco; a api do e2e atende as rotas com o login de menor privilégio, `alvesting_api`, que o `db:roles` cria depois do semear: o semear e o `account:promote` seguem com o administrador); **recusa banco que não termine em `_test` ou `_ensaio` e `NODE_ENV=production`** (é o `arena:ensaio` com outro banco).
O `pnpm test:e2e` sobe a api do e2e já com o banco semeado (Postgres e Azurite do compose; no CI, do job `web`) e roda, nos três projetos (pixel-7, iphone-15 e desktop), `e2e/public-api.spec.ts`, `e2e/revalidate.spec.ts` e `e2e/quotes.spec.ts` (a rota interna de cotações, a varredura de cotação bruta nas rotas públicas e a prova de que o segredo não vaza do site: seção 6) e os das telas (`docs/TELAS.md`, seção 6). O `QUOTES_SECRET` do e2e (`e2e/api-server.ts`) é sintético e vai igual às apis e aos sites que as leem (`playwright.config.ts`); o `pnpm lighthouse` o passa à api e ao site também.
O Playwright **não reaproveita servidor que já esteja de pé** (`reuseExistingServer: false`, nos cinco servidores do e2e): o semear do banco faz parte do comando da api, e um servidor de outro build ou de outro banco o pularia em silêncio, com falhas que não têm relação com a mudança.
Porta ocupada (4301, 4303, 4304, 4305 ou 4306) é erro claro. `E2E_DATABASE_URL` e `STORAGE_CONNECTION_STRING` trocam o banco e o Azurite; pelo turbo (`pnpm test:e2e`) elas chegam porque estão em `turbo.json`. A recriação de banco (e2e, ensaio) só aceita o Postgres da própria máquina
(`localhost`, `127.0.0.1` ou `::1`) além do nome `_test`/`_ensaio`: um `E2E_DATABASE_URL` que aponte para outro servidor é recusado antes de qualquer conexão.

## 6. Decisões e pendências

- **Limite de taxa no perfil econômico: não implementado, de propósito.** O padrão tem o WAF (600 por minuto por IP). O econômico não tem, e um limitador por IP em memória só seria honesto se soubéssemos qual é o IP: atrás do ingress do Container Apps o `req.ip` é o do Envoy,
  e o SSR do site chama a api pelo mesmo ingress, então **todas as páginas do site contariam como um único IP** e o limite derrubaria o próprio site; o cabeçalho `X-Forwarded-For` certo (quantos saltos, qual posição) só se confere na Azure. O que existe no lugar, sem depender de IP:
  parâmetro desconhecido é 400, `limit` até 100, `statement_timeout` de 10 s no papel do Postgres da api (60 s nos workers), os índices acima e o cache de dados do site (300 s). Saída: limitador por IP em memória (teto de `limite × réplicas`, até 5) depois de medir o `X-Forwarded-For` na Azure, isentando a chamada do SSR.
- **Cotação na API pública: decidido em 03/11/2026 (ADR 0033).** A licença da brapi, a fonte única das cotações (`docs/DADOS.md`, seção 2), deixa, dentro do produto, "exibir os dados para os seus usuários", "guardar em cache, persistir e montar séries históricas, gráficos e tabelas" e "calcular e publicar indicadores derivados", e **não deixa "entregar os Dados a terceiros como feed, API ou base bruta"**, nem criar "proxy, espelho ou wrapper" da API deles "como serviço concorrente ou de acesso público" (FAQ "O que a licença de uso permite" e Termos de Uso, seção 2). Uma rota pública, com cache na borda, que devolve a barra de preço de um papel é um feed. Por isso **a cotação bruta saiu da API pública** (as barras de `stocks/:ticker` e o fechamento do BOVA11 no macro de `arena/current`) e o site a lê de uma rota interna, com um segredo que só o servidor tem (abaixo). **Também saíram a composição da carteira do Sorteio e das referências e os donos que não são modelo** (a revisão de segurança mostrou que o igual-peso segura o universo inteiro, uns 300 papéis, e que `(patrimônio − caixa) ÷ quantidade` devolvia o fechamento do BOVA11: `competitors/igual-peso` e `stocks/:ticker` entregavam, a cada pregão, o fechamento de todo papel). Ficam os **registros da arena**: o que os **modelos** fizeram com o dinheiro fictício (posições com marcação, valor e P&L, caixa), o patrimônio de todos, o ranking e o Monte Carlo, que são o resultado publicado do experimento e indicador derivado dele. Cada campo com preço dos schemas públicos (`packages/contracts/src/public.ts` e `cycle.ts`):

  | Campo | Onde | Classe | Motivo |
  |---|---|---|---|
  | `bars[]` (`date`, `openCents`, `highCents`, `lowCents`, `closeCents`) | era `stocks/:ticker` | bruto: **saiu** | A série de preços de um papel (60 barras OHLC): a base bruta que a licença proíbe entregar. Agora só na rota interna |
  | `macro.bova11` (`date`, `closeCents`, `previousCloseCents`) | era `arena/current` | bruto: **saiu** | O fechamento e o anterior de um papel, guardados na borda: um feed de cotação. Agora só pela rota interna (a home e o rodapé o leem de lá) |
  | `portfolio.holdings` (`cashCents`, `positionsValueCents`, `positions[]`) do **Sorteio e das referências**, e os donos que não são modelo em `holders[]` | `competitors/:slug`, `stocks/:ticker` | bruto: **saiu** | O igual-peso segura o universo da semana de início até o fim (uns 300 papéis), e a marcação de cada posição é o fechamento do dia: uma chamada devolvia a cotação do universo inteiro, todo pregão. O BOVA11 segura um papel só: `(patrimônio − caixa) ÷ quantidade` é o fechamento dele. Agora `holdings` é `null` para eles e `holders[]` só lista modelos |
  | `markCents` | `competitors/:slug` (`portfolio.holdings.positions[]`, **só de modelo**), `stocks/:ticker` (`holders[]`, só modelo) | registro da arena | A marcação da posição de um **modelo** no último pregão liquidado: o preço com que a liquidação avaliou a carteira dele, só dos papéis que algum modelo tem (no máximo `maxPositions` por modelo, 10 por padrão). Quantidade e valor já a dão (`valueCents` ÷ `quantity`), então tirá-la não esconderia nada |
  | `valueCents` | idem | registro da arena | Quantidade × marcação: o valor da posição do modelo |
  | `avgPriceCents` | idem | registro da arena | O preço médio que o modelo pagou (custo ÷ quantidade), das execuções da arena: o resultado das ordens dele, não uma barra |
  | `costCents` | `competitors/:slug` (`portfolio.holdings.positions[]`, só de modelo) | registro da arena | O custo total que o modelo pagou na posição (valor mais custos das compras) |
  | `pnlCents` | idem, e `holders[]` | derivado | Valor menos custo |
  | `cashCents`, `positionsValueCents` | `competitors/:slug` (`portfolio.holdings`, só de modelo) | registro da arena | O caixa e a soma das posições do modelo no pregão: o estado da carteira dele no experimento |
  | `equityCents` | `seasons/:id/leaderboard`, `seasons/:id/equity`, `competitors/:slug` (`portfolio` e `series`), `arena/current` (`top`) | registro da arena | O patrimônio de cada competidor por pregão, o Sorteio e as referências inclusive: o resultado do experimento. O do BOVA11 e o do igual-peso é o retorno normalizado deles (a "comparação" que a licença permite), e sem o caixa e a quantidade não dá o fechamento absoluto |
  | `equityCents` e `returnBps` (p5 a p95) | `seasons/:id/random-baseline` | derivado | Os percentis das carteiras aleatórias do Monte Carlo: conta da Alvesting sobre simulações, sem preço de papel |
  | `capitalCents` | `params` da temporada (`seasons`, `arena/current` e as outras) | registro da arena | O capital inicial fictício: parâmetro do experimento |
  | `returnBps`, `percentileBps`, `excessEqualWeightBps`, `excessCdiBps`, `maxDrawdownBps`, `winRateBps`, `tradeCostBps` | ranking, competidor, `params` | derivado | Taxas em pontos-base sobre o resultado: nenhum preço de papel |

  Fora da tabela, por não serem preço de papel: o custo das LLMs (`llmCostMicroUsd` e `costMicroUsd`, em micro-dólares), os valores do BCB do macro e o `percent` e a `confidence` que o modelo respondeu. **A lista é guardada por teste.** `packages/contracts/src/public-quotes.spec.ts` lê todo schema que `public.ts` e `cycle.ts` exportam e reprova (1) campo com nome de cotação bruta (`open`, `high`, `low`, `close`, `previousClose`, `bars`, `volume`, `price`, `bid`, `ask` e afins, em qualquer profundidade) e (2) campo em centavos que não esteja na lista branca do próprio teste, com o motivo de cada um; ele também confere que cada campo da lista branca está nesta tabela. O `public-api.integration.spec.ts` pede toda rota pública, sobre a temporada do ensaio, e reprova a resposta que traga um desses campos. **O nome do campo não basta**: a mesma `markCents` na posição do igual-peso era o fechamento do universo, então o mesmo teste olha também o que o campo carrega (nenhuma resposta traz o preço de mais papéis do que um modelo pode ter, `holdings` do Sorteio e das referências é `null`, `holders[]` só tem modelo, e a conta `(patrimônio − caixa) ÷ quantidade` do BOVA11 não fecha com o que a resposta traz). Campo novo com preço obriga a decidir no teste e a escrever uma linha aqui.

  **A rota interna (site → api).** `GET /api/v1/interno/barras/:ticker` devolve `{ bars }`: as 60 barras mais recentes de um papel (`date`, `openCents`, `highCents`, `lowCents`, `closeCents`), da mais antiga à mais nova. Vale para qualquer papel de `instrument`, o BOVA11 inclusive (a home tira dele o fechamento e o anterior, e o rodapé, a data do último pregão). Papel desconhecido ou sem barra é lista vazia (200): o 404 desta rota quer dizer só "não é para você". É o mínimo de que o site precisa, e só ele a usa:
  - **Segredo só do servidor.** `Authorization: Bearer <QUOTES_SECRET>` (segredo `quotes-secret` do Key Vault, lido só pela `id-alvesting-web` e pela `id-alvesting-api`: `docs/INFRA.md`, 2.6 e 2.7; 32 caracteres ou mais, só ASCII visível e sem espaço, o seed gera 384 bits; aparado nas pontas dos dois lados, e a api recusa subir com o que não tem essa forma). A comparação é em tempo constante (SHA-256 dos dois lados e `timingSafeEqual`, como a da revalidação). **Sem o segredo, com o errado, ou com a api sem `QUOTES_SECRET` (a rota fica desligada), a resposta é um 404 com o mesmo corpo do que a rota não existir** (`Cannot GET <caminho>` no envelope) e `Cache-Control: no-store`. Com ele, 200, também `no-store`. O segredo nunca vai a log (o log de requisição é uma lista branca, sem cabeçalho), a telemetria (lista branca de atributos) nem à resposta.
  - **Fora do Swagger e fora do cache da borda.** `@ApiExcludeController`, e o caminho não casa nenhum padrão da rota `api-public` do Front Door (o `infra/tests/check.mjs` lê o controlador e confere). O caminho leva `/interno/`, que a regra `BlockInterno` do WAF já bloqueia na borda: pelo Front Door a rota nem chega à api; o site a lê pelo endereço interno do ingress (`API_INTERNAL_URL`), como lê o resto.
  - **O site.** `apps/web/src/lib/quotes.ts` (`import 'server-only'`: um componente de cliente que o importe quebra o build) lê `QUOTES_SECRET` do ambiente do servidor (sem `NEXT_PUBLIC_`), na home em paralelo com as leituras de antes e na página da ação depois da leitura da ação (o ticker que não existe é 404 sem tocar a rota interna nem gravar uma entrada vazia no cache em disco), com a mesma tag (`arena`) e o mesmo `revalidate` (300 s) do cache de dados do Next, então a revalidação do worker depois da liquidação continua valendo. Um 404 da rota (segredo errado ou ausente na api) vira `ApiError` 502 `QUOTES_REFUSED`, que a página mostra como "a arena não respondeu" (e o smoke do deploy reprova), nunca como "ação não encontrada". O segredo ausente, curto ou fora da forma no ambiente do site, e o `API_INTERNAL_URL` sem `https` em produção (o segredo iria em claro), viram `ApiError` 503 `QUOTES_UNCONFIGURED` (a mesma tela de erro, com o aviso fixo, e no log o nome da variável, nunca o valor); o valor só chega ao `fetch` depois de aparado e conferido, para o erro do Node (que repete o cabeçalho inválido inteiro) nunca o levar ao log.
  - **Sem deploy anterior.** A remoção dos campos é incompatível com o site antigo (o schema estrito dele exigia `bars`, `macro.bova11` e o caixa e as posições soltos na carteira do competidor, que agora moram em `portfolio.holdings`, nulo no Sorteio e nas referências), e o CLAUDE.md manda separar um lançamento assim em três. Aqui vai de uma vez porque o primeiro deploy público espera esta decisão (PLANO, §5.16): não existe site antigo para ler a api nova. Depois do primeiro deploy, uma mudança assim segue a regra dos três lançamentos.
  - **A carteira do usuário não é API pública.** `GET /me/portfolio` (seção 9) exige sessão, é só do dono e `no-store`; devolve, por posição, o último fechamento do papel (`closeCents`, com a data), o valor e o P&L. É "exibir os dados para os seus usuários" e fica como está. O risco que sobra (uma conta que lance um papel só para ler o fechamento dele, até 200 lançamentos, atrás do aceite dos termos e do limite do WAF) está no ADR 0033; se o orientador não aceitar, a saída é tirar `closeCents` e `closeDate` e deixar só o valor e o P&L.
  - As telas seguem **sem tabela de preços**: as velas da página da ação e a faixa do BOVA11 da home, com a data do dado e o crédito "Cotações: brapi.dev" (rodapé de toda tela, a faixa, a página da ação e a carteira: `docs/TELAS.md`).
- O efeito da revalidação sobre uma página está **provado por teste** desde a parte 2 (`apps/web/e2e/fixture.spec.ts`, nos três projetos): a api falsa muda a notícia, a página continua com o dado do cache, e só depois do `POST /interno/revalidar` mostra o novo. A rota, as tags, o cliente e o gancho do worker têm os testes da parte 1.
- Atrás do Front Door o `HEAD` e o `OPTIONS` não foram exercitados (sem Azure). O que conferir depois do primeiro deploy está em `docs/DEPLOY.md` ("Cache da API pública").
- **HTML sem cache na borda (ADR 0023).** O plano (§5.4) previa o Front Door guardando também as páginas públicas (`s-maxage` curto e purge depois da liquidação). Ficou só o estático e a API pública: o HTML sai do cache de dados do Next, que a revalidação vence a cada liquidação, e o cache de
  HTML na borda traria o risco de HTML e RSC de renders diferentes, mais uma camada para limpar (`/*`) e nenhum ganho medido.
- **O papel do banco da api (etapa 10, onda 3d; ADR 0028).** A api roda com o login `alvesting_api`, de menor privilégio, e não com o administrador (dono das tabelas) que os workers e as migrations usam. A migration
  `20261103100000_api_role` dá ao papel de grupo dele só o que a api usa, tabela por tabela (`apps/api/src/infrastructure/database/table-policy.ts`, escrita à mão, com o motivo de cada linha): `SELECT`, `INSERT`,
  `UPDATE` e `DELETE` em `user`, `session` e `account`; `SELECT`, `INSERT` e `DELETE` em `verification` (a migration `20261103110000_api_role_least_privilege` revoga o `UPDATE`, que só os plugins email-otp e siwe do Better Auth usam); só `SELECT` e `INSERT` em `consent`; só `INSERT` em `audit_log`; as escritas do admin (seção 8, "O que a api escreve"); e `SELECT` no que ela só lê.
  **Nenhuma escrita nas tabelas de resultado da arena** (ordens, execuções, posições, patrimônio, métricas, Monte Carlo e decisões). O banco recusa o resto (`42501`): DDL, remover o gatilho do aceite, o `UPDATE` e o
  `DELETE` direto em `consent`, o `DELETE` em `audit_log`, o `SET ROLE` para o administrador. Todo SQL segue parametrizado. O `api-role.integration.spec.ts` compara o catálogo com a matriz e conecta como o login novo; os specs HTTP
  e os três projetos do e2e rodam a api com ele. Tabela nova (o chat; a carteira já entrou, seção 9) precisa de uma linha na matriz e de um `GRANT` na migration dela, senão o `table-policy.spec.ts` reprova. Detalhes: `docs/CONTA.md`, seção 11.
  **O estado em que ela escreve também é do banco** (migration `20261103120000_api_role_guards`): o privilégio de tabela diz o que a api toca, e não quando. Em `prompt_version` ela só tem `INSERT` de `id`, `version` e `created_at` (o SHA-256 do texto é do
  job de decisões: com a tabela inteira a api forjava o compromisso). Em `season`, `competitor`, `cycle` e `job_run` um gatilho `*_api_guard`, que vale só para o login da api, recusa (`42501`) o que as rotas de admin já recusam em código: mudar as regras, o elenco ou o prazo de uma temporada
  em andamento, reabrir outra coisa que a `settle`. O login também tem limite de conexões em produção (24).

## 7. A conta (etapa 11)

As rotas abaixo **não** são públicas no sentido da seção 1: pedem sessão (exceto o `GET /legal` e o `GET /auth/providers`), saem sempre com `Cache-Control: no-store` e nunca entram na rota com cache do Front Door (que lista as GET públicas uma a uma). Todas no envelope, validadas pelo Zod e no Swagger (tag `conta`).
As telas da conta (etapa 11, parte 2) as leem pelo servidor sem o cache de dados do Next (`apiGetFresh`, `docs/CONTA.md`, seção 9) e as chamam do navegador pela mesma origem do site (`docs/TELAS.md`).
O login em si é o Better Auth, em `/api/auth/*`, **fora do envelope** e do Swagger (`docs/CONTA.md`, seção 2); `/api/auth/*` também nunca é cacheado e tem a regra de limite própria do WAF. Só as rotas que o site usa estão abertas (o resto responde 404), o corpo tem
teto de 16 KB (413 `PAYLOAD_TOO_LARGE` no envelope) e o cadastro devolve 400 `INVALID_PROFILE` para nome, e-mail ou imagem fora do que aceitamos (`docs/CONTA.md`, seção 1).

| Rota | O que faz |
|---|---|
| `GET /api/v1/legal` | Público. O controlador e o contato (da configuração) e os dois textos vigentes (`TERMS`, `PRIVACY`) com versão, vigência, SHA-256 e texto. Sem cache de propósito: o aceite grava a versão que o usuário viu |
| `GET /api/v1/auth/providers` | Público. `{ google: boolean }`: se a api tem o login com o Google (o ID **e** o segredo do cliente OAuth existem). A tela de entrar só oferece o botão com `true`. Sem cache de propósito (um `false` guardado esconderia o botão depois de o Google ser ligado); nunca devolve o client ID |
| `GET /api/v1/me` | Sessão. `id`, `name`, `email`, `emailVerified`, `role` e o estado do aceite (`consent.upToDate` e, por documento, a versão vigente e quando este usuário a aceitou, ou `null`) |
| `POST /api/v1/me/consents` | Sessão. Corpo `{ terms, privacy }` com as versões que o usuário viu. 200 se são as vigentes (idempotente), 409 se não são |
| `GET /api/v1/me/export` | Sessão. O JSON de LGPD (art. 18): o usuário, as contas vinculadas, as sessões, os aceites e a carteira (`portfolios` e `portfolioLots`, seção 9), sem hash de senha, token de OAuth, token de verificação nem token de sessão. `Content-Disposition: attachment` |
| `DELETE /api/v1/me` | Sessão. Apaga a conta e tudo dela, numa transação só. Pede a sessão recente (até 5 minutos) ou `{ password }` (o corpo pode faltar): 403 `REAUTH_REQUIRED` ou `INVALID_PASSWORD`, 429 depois de 5 senhas erradas. Limpa o cookie |

Erros próprios: 401 `UNAUTHORIZED` (sem sessão), 403 `FORBIDDEN` (origem fora do `PUBLIC_URL` numa mutação, ou papel insuficiente), 403 `CONSENT_REQUIRED` (nas rotas de recurso que usam o `ConsentGuard`; `/me`, `/me/consents`, `/me/export` e `DELETE /me` ficam de fora de propósito),
409 (aceite de versão que não é a vigente). Parâmetro de query desconhecido ou repetido é 400, como nas rotas públicas. **Dono**: toda rota usa o ULID da sessão, nunca um id da requisição (o teste de dois usuários prova que A não lê nem apaga nada de B).

## 8. As rotas de admin (etapa 10, parte 2)

O painel da arena (`/admin` no site, `docs/TELAS.md`, seção 8) e quem opera com `curl` falam com estas rotas. Todas em `/api/v1/admin`, no envelope, com os schemas de
`packages/contracts/src/admin.ts` (os mesmos validam a resposta na api e no site), no Swagger (tag `admin`) e **sempre com `Cache-Control: no-store`**, erro inclusive. Nenhuma está
na rota com cache do Front Door (`infra/tests/check.mjs` lê o controlador e reprova a que cair nela ou a que faltar na lista). Parâmetro de query não existe: o desconhecido é 400.

**Guards, em toda rota, nesta ordem** (`presentation/admin.controller.ts`): `SessionGuard` (sessão; **mutação exige `Origin` igual ao `PUBLIC_URL`**, 403 `FORBIDDEN` sem ele), `RolesGuard` e
`ConsentGuard` (403 `CONSENT_REQUIRED` com o aceite dos termos vencido). O `@Roles('ADMIN')` está **em cada rota, e não na classe**: o `RolesGuard` nega o que não tem `@Roles` (403, até para o
admin), então uma rota nova que esqueça de declarar o papel nasce fechada. O teste de integração confere os três guards na ordem e o papel em cada handler. Sem sessão é 401; usuário comum, 403.
O papel é lido do banco a cada requisição: o `account:demote` tira a rota na hora (e apaga as sessões).

| Rota | O que faz |
|---|---|
| `GET /admin/seasons` | Todas as temporadas, **o rascunho inclusive** (a API pública o esconde), da mais nova à mais antiga, no formato do arquivo do `season:create` (`name`, `params`, `competitors`) mais o estado. É o que o painel mostra e devolve para editar |
| `POST /admin/seasons` | Cria o rascunho com o elenco. Corpo: **o mesmo arquivo do `season:create`** (`seasonFileSchema`, estrito: campo a mais, segredo inclusive, é 400, e a mensagem nunca repete o valor). 201 com a temporada. 409 `SEASON_SLUG_TAKEN` |
| `PATCH /admin/seasons/:id` | Ou **inicia** a temporada (`{ "status": "RUNNING" }`, o `season:start`: a data de início é o próximo pregão depois de hoje, em Brasília), ou **edita o rascunho** (`name`, `params` e/ou `competitors`; o que for enviado substitui o campo inteiro, o slug não muda, e o conjunto é conferido de novo: um Sorteio, as três referências...). **Temporada em andamento ou encerrada não muda nada: 409 `SEASON_LOCKED`** (regras, elenco e prompt ficam fixos, `docs/ARENA.md`). 409 `SEASON_RUNNING_EXISTS` se outra já está em andamento (o briefing é um por pregão: duas com regras diferentes derrubam o `freeze`). **A conferência e o início são um passo só**, na mesma transação e sob uma trava consultiva do Postgres: dois inícios simultâneos de rascunhos diferentes não passam os dois (um 200 e um 409). O comando `season:start` não confere isso |
| `POST /admin/cycles/:date/rerun` | Reprocessa o ciclo do pregão (a seção 2 do `docs/ARENA.md`). Ver "Reprocessar o ciclo" abaixo |
| `POST /admin/dlq/:queue/resubmit` | Reenvia da DLQ para a fila, pelo MessageId. Corpo `{ "messageIds": [...] }`, **de 1 a 10 por chamada**. Ver "Reenviar a DLQ" |
| `POST /admin/corporate-events` | Registra um desdobramento, grupamento ou bonificação em ações e **enfileira** a reliquidação das temporadas que já passaram da data ex (o `settle:event`, mas quem liquida é o worker). Corpo `{ ticker, exDate, kind, factor }`; resposta `{ event, queued, pending }`. 502 `PUBLISH_FAILED` se o Service Bus recusa |
| `GET /admin/costs` | O custo das LLMs no mês de Brasília, por competidor e por dia, e o acumulado contra o teto |
| `GET /admin/jobs` | O último `job_run` de cada tipo e os estados, os `FAILED` recentes, o `fetch_state` e a DLQ de cada fila |

**Reprocessar o ciclo.** É o caminho do agendador (`CycleSchedulers.rerun`), mais estrito: (1) **nunca publica nos últimos 5 minutos antes do prazo das 09:30** de Brasília do pregão (`RERUN_MARGIN_MS`) **nem depois
dele**: um `decide` publicado tarde só começa depois do prazo (a KEDA consulta a fila a cada 30 s, e o job leva um tempo para subir) e gravaria HOLD `prazo`, ou seja, uma decisão depois do prazo, pedida pelo admin.
Também não antes da hora da decisão (08:00). Um pregão que já passou é sempre "depois do prazo". A resposta é 200 com o resultado `past_deadline` (a margem final e o que vem depois) ou
`not_open_yet`, e **nada é criado, nem o ciclo**; (2) só publica para o MODEL que **ainda não tem decisão** gravada, e a decisão gravada nunca muda (a primeira vale, `docs/ARENA.md`, seção 3);
(3) **não varre** os ciclos vencidos de outros dias (isso é do agendador e da liquidação); (4) o ciclo aberto continua com o briefing e a versão do prompt que fixou; o pulado (sem briefing,
orçamento) é reavaliado, como no agendador, então um `freeze` reenviado da DLQ antes das 09:30 reabre o ciclo; (5) é **idempotente**: o ciclo é um só por temporada e pregão, e o MessageId
(`decide:<ciclo>:<competidor>`) é o mesmo. Resultado por temporada em andamento: `published` (com a contagem), `skipped` (com o motivo), `already_closed`, `no_pending`, `not_started`,
`season_over`, `past_deadline`, `not_open_yet`. Dia que não é pregão (ou fora do calendário da B3 que a api tem, 2026 e 2027) é 409 `NOT_A_TRADING_DAY`. A api precisa de `PROMPT_ARENA_VERSION`
(sem ela, 503 `NOT_CONFIGURED`) e de `ARENA_MONTHLY_COST_CAP_USD`: o teto de custo vale também aqui (`docs/INFRA.md`, 2.7). Falha ao publicar no Service Bus é 502 `PUBLISH_FAILED` (repetir é seguro).
**São duas camadas, e a segunda já existia:** a rota só *publica* até 5 minutos antes das 09:30, e o worker ainda precisa acordar (a KEDA consulta a fila a cada 30 s, `docs/JOBS.md`, seção 3). A margem de 5 minutos
cobre a consulta e a partida do job com folga e ainda deixa o tempo de uma chamada de modelo (o reparo exige 3, `MIN_REPAIR_MS`); uma `decide` que mesmo assim comece depois do prazo (a fila parada, o job que não sobe) é fechada
pelo próprio `DecideHandler` como HOLD `prazo`, **sem chamar o modelo** (`docs/ARENA.md`, seção 4), que é o mesmo que acontece com a mensagem das 08:00 que o worker demora a pegar: isso é do sistema, e não de um pedido do
admin. Uma temporada com a janela da decisão mais curta que a margem (a decisão às 09:27 e o prazo às 09:30, por exemplo) nunca abre o reprocesso. A margem é uma constante só (`RERUN_MARGIN_MS`, em `cycle-schedulers.ts`).

**Reenviar a DLQ.** Usa o `MessagingService.resubmitDeadLetter`, que só tira a mensagem da DLQ **depois** de publicá-la na fila de origem, com o mesmo MessageId. A resposta traz um resultado por id:
`resubmitted`, `not_found` (não está na DLQ: **é o que um id já reenviado responde, sem publicar de novo**, e por isso repetir a chamada é seguro) ou `invalid` (o corpo continua inválido ou é de outra
fila: fica na DLQ). O teto de 10 por chamada vale porque cada id abre um receiver e examina até 100 mensagens da DLQ. `:queue` é uma das seis filas; o MessageId só pode ter letras, dígitos e `: . _ -`.
Service Bus fora do ar (ou sem cliente configurado) é 503 `SERVICE_BUS_UNAVAILABLE`, sem repetir o erro do SDK (ele pode trazer o endereço do namespace; vai só ao log, limpo).

**O evento corporativo** registra o evento como o `settle:event` (`kind` é `split`, `reverse-split` ou `bonus`, `factor` é `de:para`, e a direção do fator tem de bater com o tipo: 400
`INVALID_EVENT`; o ticker precisa existir no banco), mas **não reliquida dentro da requisição**: a api não escreve nas tabelas de resultado da arena (papel mínimo do Postgres, ADR 0028). Para cada temporada que já liquidou
até a data ex (ou além), ela **reabre o `job_run` da `settle`** e **publica a `settle` na fila** (`SettlementPublisher.resettle`, `JobRunStore.reopen`), até o pregão que a temporada já tinha liquidado; **o worker liquida** (e
revalida o site e limpa a borda, como em toda liquidação). A resposta diz o que ficou **enfileirado**: `queued` (temporada e pregão) e `pending` (as que liquidaram só até antes da data ex: o evento entra quando chegarem lá). O
resultado publicado muda quando o worker termina, em alguns minutos, e o cache público leva até 5 minutos depois disso. Repetir não muda o evento (`unchanged`) e enfileira de novo (o job é reaberto outra vez). Se o Service Bus
recusa a publicação, o **evento fica registrado** e a resposta é 502 `PUBLISH_FAILED` sem o texto do SDK (repetir é seguro: o MessageId é determinístico). O `settle:event` (comando) e o ensaio seguem liquidando direto
com o login administrador.

**Custos.** `month` (o mês de **Brasília**: às 22h do dia 30, em Brasília, já é dia 1º em UTC, e continua o mês velho), `spentMicroUsd` (a soma que o `sched-cycle` compara com o teto, de todas as
temporadas: `ArenaRepository.monthlySpendMicroUsd`), `capMicroUsd` (`null` = teto não configurado, e o ciclo com modelo pago é pulado) e `rows`, uma por (dia, temporada, competidor), do dia mais novo ao
mais antigo, com `costMicroUsd` inteiro (1 US$ = 1.000.000, sem float). A soma das linhas é o acumulado. O competidor que decidiu e não custou (os fakes) entra com zero.

**Jobs, filas e DLQ.** `jobs`: o último `job_run` de cada tipo (`eod`, `universe`, `fetch`, `freeze`, `decide`, `settle`...) com `counts` por estado (`RUNNING`, `SUCCEEDED`, `FAILED`, `WAITING`; o `WAITING`
é o `eod` que espera o arquivo do pregão e **não é falha**); `failures`: os 10 `FAILED` mais recentes; `fetchStates`: a última conferência de cada arquivo da CVM (a etag e o `Last-Modified` não saem). O
`error` de um job passa por `redactText` (sem e-mail, IP, token nem query de URL) e é cortado em 300 caracteres. **`queues`: a DLQ das seis filas, lida por *peek* com o papel de Receiver que a identidade da
api já tem** (`infra/modules/servicebus.bicep`): `count` vai até 20 (`capped: true` = "20 ou mais"), `messages` traz o MessageId (limpo de dado pessoal, como o resto do texto), as entregas, o motivo, a descrição (limpa) e a hora, **nunca o corpo**.
`resubmittable` diz se o MessageId mostrado é o de verdade e tem a forma que o reenvio aceita (a de `dlqMessageIdSchema`); uma mensagem que outra ferramenta pôs na DLQ, com outro formato, aparece na lista **sem o botão de reenvio** (que responderia 400).
Contar de verdade pede a API de administração do Service Bus, que exige o papel de dono: **a resposta não o pede**. Se não deu para ler (sem cliente, sem permissão, broker fora, 5 s sem resposta), a fila sai
`{ "status": "unavailable" }` e o motivo vai só ao log. **Não verificado na Azure**: se o papel de Receiver da `id-alvesting-api` basta para o *peek* da sub-fila de dead-letter (a documentação do Service
Bus diz que sim para `Listen`; nada rodou na assinatura).

**A trilha de auditoria.** Toda mutação grava uma linha em `audit_log` com o **ator `admin:<ULID>`** (o ULID da sessão, nunca um id da requisição), a ação, o alvo e o detalhe, **sem dado pessoal** (ULID,
slug, data, nome de fila e MessageId; o teste procura o e-mail e o nome do admin em todas as linhas). A criação, a edição e o início de temporada gravam a linha **na mesma transação** da mudança. O reprocesso, o
reenvio e o evento gravam **antes** da ação, como registro da intenção: se não deu para gravar, a ação não acontece (o pedido rejeitado depois, por 400, também deixa a linha). O registro do evento deixa ainda a
linha do próprio serviço, com o fator antigo e o novo.

| Ação | Alvo | Detalhe |
|---|---|---|
| `admin.season.create` | o ULID da temporada | `slug`, `models` |
| `admin.season.update` | o ULID da temporada | `slug`, `fields` (quais campos) |
| `admin.season.start` | o ULID da temporada | `slug` |
| `admin.cycle.rerun` | o pregão (`2026-11-03`) | `date` |
| `admin.dlq.resubmit` | a fila | `queue`, `messageIds` |
| `admin.corporate_event` | `TICKER:data-ex` | `ticker`, `exDate`, `kind`, `factor` |
| `corporate_event.created` / `.updated` | `TICKER:data-ex:TIPO` | o fator antigo e o novo (do serviço) |

`account.promoted` e `account.demoted` (os comandos, ator `cli`; na Azure o detalhe leva também o nome da execução do job) completam a trilha de papéis (`docs/CONTA.md`, seção 4).

**O que a api escreve por causa das rotas de admin** (a matriz do papel do Postgres, `table-policy.ts`, ADR 0028): `season` (criar, editar o rascunho, iniciar), `competitor` (a edição do rascunho troca o elenco: apaga e
recria), `prompt_version` (só `id`, `version` e `created_at`) e `cycle` (o reprocesso), `corporate_event`, `job_run` (só o `UPDATE` que reabre a `settle`) e `audit_log` (só `INSERT`, por `appendAudit`). **Não escreve** em `order`, `fill`, `position`,
`equity_snapshot`, `season_stat`, `random_baseline`, `decision` nem `decision_item`: o banco recusa. Quem refaz o resultado de um evento é o worker. **O banco também recusa o estado errado** (gatilhos `*_api_guard`, só para o login da api): `season` só nasce em
rascunho e só o rascunho é editado e iniciado; `competitor` só muda no rascunho; `cycle` só nasce aberto ou pulado, numa temporada em andamento, e só o pulado é reavaliado (a data, a temporada e o prazo nunca mudam); `job_run` só reabre a linha `settle`. Rota de admin nova que
escreve numa tabela com estado (o chat; a carteira já trouxe o `portfolio_lot_api_guard`, seção 9) traz o gatilho dela junto com o `GRANT`.

**Testes** (nenhum chama o Service Bus nem a Azure): `modules/admin/presentation/admin.integration.spec.ts` (api de verdade, Postgres, e um Service Bus FALSO que é uma pasta,
`modules/messaging/infrastructure/fake-service-bus.ts`, com o `MessagingService` de verdade por cima; só liga com `SERVICEBUS_FAKE_DIR` e **fora de produção**, onde o app recusa subir com ela),
`admin-reports.service.spec.ts` (o que da mensagem da DLQ sai para o painel e a leitura que não responde, com relógio falso), `cycle-schedulers.integration.spec.ts` (o reprocesso e a margem de 5 minutos),
`arena.repository.seasons.integration.spec.ts` (a auditoria na mesma transação, a edição só do rascunho e a trava do início exclusivo: dois inícios juntos, um 200 e um 409) e o e2e do painel (`docs/TELAS.md`, seção 8).

## 9. A carteira do usuário (etapa 12)

Plano: §3, §8, §9, §11 e §12; ADR 0031. A tela `/carteira` (parte 2 da etapa; `docs/TELAS.md`, seção 9) usa estas rotas: lê `GET /me/portfolio` no servidor, sem o cache de dados do Next, e o navegador lança, edita e apaga pelas outras três, na mesma origem. A api não mudou com a tela. Todas em `/api/v1/me/portfolio`, no envelope, no Swagger (tag `carteira`) e **sempre com `Cache-Control: no-store`**, erro inclusive: é dado pessoal e financeiro.
Nenhuma está na rota com cache do Front Door (`infra/tests/check.mjs` lê o controlador e reprova a que cair nela ou a que faltar na lista). Os formatos estão em `packages/contracts/src/portfolio.ts` (os schemas, com o zod) e a regra de dinheiro,
em `packages/contracts/src/portfolio-rules.ts` (**sem imports**: o formulário do site a lê pelo subcaminho `@alvesting/contracts/portfolio-rules`, sem levar o zod ao navegador).

**Guards, em toda rota, nesta ordem** (`presentation/portfolio.controller.ts`, na classe): `SessionGuard` (sessão; **mutação exige `Origin` igual ao `PUBLIC_URL`**, 403 `FORBIDDEN` sem ele) e `ConsentGuard` (403 `CONSENT_REQUIRED` com o aceite dos termos
vencido: quem aceitou a versão 0.1 dos textos fica sem a carteira até aceitar a 0.2; exportar e excluir a conta seguem abertos). **O dono é sempre o ULID da sessão**: nenhum id de usuário nem de carteira entra no corpo, na query ou no caminho
(campo a mais no corpo e parâmetro de query são 400). O lançamento de outro usuário é **404**, igual ao que não existe, e a escrita já filtra pelo dono na mesma instrução.

| Rota | O que faz |
|---|---|
| `GET /me/portfolio` | Os lançamentos do dono (pela data da compra, do mais recente ao mais antigo; sem data, no fim), as posições por ticker (ordem alfabética) e os totais. Sem parâmetros |
| `POST /me/portfolio/lots` | Lança uma compra. 201 com o lançamento. 409 `LOT_LIMIT` com 200 lançamentos |
| `PATCH /me/portfolio/lots/:id` | Troca o lançamento **inteiro**, com o mesmo corpo do POST (a data que faltar no corpo limpa a data; o corpo parcial é 400). 200 com o lançamento como ficou |
| `DELETE /me/portfolio/lots/:id` | Apaga o lançamento. 200 `{ "deleted": true }`; apagar de novo é 404 |

**O corpo do POST e do PATCH** (estrito):

| Campo | Regra |
|---|---|
| `ticker` | 4 caracteres e 1 ou 2 dígitos (`PETR4`, `B3SA3`, `BOVA11`); aceita minúsculas e sai maiúsculo. Tem de ser uma **ação que a api conhece**: as que `/stocks?q` busca (`instrument.kind = STOCK`), **cotadas por unidade** (`quote_factor = 1`, o que deixa de fora o GOLL54 e o AZUL53, papéis por lote que o banco de dev guarda com preço truncado, `docs/DADOS.md`, seção 4); ticker desconhecido, referência (o BOVA11) e papel por lote são 400 no campo |
| `quantity` | inteiro de 1 a 1.000.000 |
| `mode` | `unit`: `valueCents` é o preço de **uma** ação; `total`: `valueCents` é o **total pago** no lançamento |
| `valueCents` | inteiro de 1 a 100.000.000.000 (R$ 1.000.000.000,00), em centavos |
| `boughtOn` | `AAAA-MM-DD`, opcional (ou nulo); não antes de 1900-01-01 e **não no futuro** (em Brasília) |

**O custo total** do lançamento é `quantity × valueCents` no modo `unit` e o próprio `valueCents` no modo `total`: **os dois modos geram o mesmo custo para os mesmos números** (100 ações a 3.550 e 100 ações com total 355.000 gravam 355.000). É o único valor
guardado: o modo não é. O custo tem o mesmo teto de R$ 1.000.000.000,00; o produto acima dele (quantidade e preço cada um dentro do próprio teto) é 400 no campo `valueCents`.

**O lançamento** (`lot`): `id`, `ticker`, `quantity`, `costCents`, `boughtOn` (`AAAA-MM-DD` ou `null`), `createdAt` e `updatedAt`. Nunca o id do usuário nem o da carteira.

**A posição** (`positions[]`, a soma dos lançamentos de um ticker; tudo em centavos inteiros, número JSON exato):

| Campo | O que é |
|---|---|
| `quantity`, `costCents` | Σ quantidade e Σ custo dos lançamentos do ticker |
| `avgPriceCents` | Σ custo ÷ Σ quantidade, no centavo mais próximo (o meio vai para longe do zero, a regra de `docs/METODOLOGIA.md`) |
| `closeCents`, `closeDate` | o `close_cents` da barra **mais recente** do papel e o dia dela; **nulos** se o ticker não tem barra, ou se a barra passa de R$ 450.000,00 por ação (`maxCloseCents`: não é cotação, é dado ruim) |
| `valueCents` | valor de mercado: `quantity × closeCents`, exato; nulo sem fechamento |
| `pnlCents` | P&L: `valueCents − costCents`, exato (negativo é perda); nulo sem fechamento |
| `pnlBps` | P&L sobre o custo em **pontos-base** (1% = 100), no ponto-base mais próximo (o meio vai para longe do zero); nulo sem fechamento **e também com fechamento quando passaria do inteiro seguro** (custo de centavos sobre valor alto: uns R$ 9.007 por ação com 1 centavo por 1.000.000 de ações) |

O contrato (`positionSchema`) só aceita dois estados: com fechamento (`closeCents`, `closeDate`, `valueCents` e `pnlCents` são números; só o `pnlBps` pode ser nulo) ou sem (os cinco nulos).

**Os totais** (`totals`): `costCents` é o de **todos** os lançamentos; `valueCents`, `pnlCents` e `pnlBps` só contam as posições **com** fechamento, e `pricedCostCents` é o custo dessas posições (`pnlCents = valueCents − pricedCostCents`); `unpriced` diz quantas posições ficaram de fora.
Sem nenhuma posição com fechamento, `valueCents`, `pnlCents` e `pnlBps` são nulos (o valor e o P&L vêm juntos; o `pnlBps` também é nulo quando passaria do inteiro seguro). Cada posição tem a data do **próprio** fechamento (um papel parado tem data mais antiga), e o valor é **estimado**: o fechamento não é ajustado por provento nem desdobramento.

**Contas e arredondamento.** No servidor tudo é `bigint` (`apps/api/src/modules/portfolio/domain/positions.ts`); o número sai como JSON exato, e `safeNumber` recusa o que perderia precisão. O **valor de mercado** da carteira inteira só cabe em inteiro seguro (9,007 × 10^15 centavos) com um fechamento de até
R$ 450.000,00 por ação (200 lançamentos de 1.000.000 de ações, o pior caso): é o teto `maxCloseCents`, e uma barra acima dele deixa a posição **sem fechamento**, e não derruba o `GET` com 500 (o `daily_bar` só exige `close_cents >= 0`, e um 500 cairia em todo detentor do ticker). Com esse teto o valor, o P&L em centavos e a soma deles
cabem sempre. O **P&L percentual** sai do inteiro seguro antes disso, com custo de centavos sobre valor alto, e então é nulo; o resto da posição vale. Os tetos e o pior caso (200 lançamentos × R$ 1 bilhão = 2 × 10^13 centavos, 450 vezes abaixo do inteiro seguro; 2 × 10^8 ações) estão no ADR 0031 e no teste do contrato. **Arredonda-se em dois lugares só**, os dois pela regra do domínio
(`divRound`): o preço médio e o P&L percentual. O custo, o valor de mercado e o P&L em centavos são exatos.

**O valor digitado em reais** (`parseBrl`, no contrato sem zod; a api não lê texto, recebe centavos). O formulário lê no jeito brasileiro e manda centavos:

| Digitado | Resultado |
|---|---|
| `1.234,56` · `1234,56` · `0,5` · `12` | R$ 1.234,56 · R$ 1.234,56 · R$ 0,50 · R$ 12,00 |
| `12.5` · `12.50` · `0.35` | R$ 12,50 · R$ 12,50 · R$ 0,35: **um ponto único com 1 ou 2 dígitos depois é o separador decimal** (o teclado numérico de alguns Android só tem o ponto) |
| `1.234.567` | R$ 1.234.567,00: dois pontos ou mais, em grupos de 3, são milhar |
| `1.234` · `12.345` | **recusado como ambíguo**: um ponto com exatamente 3 dígitos depois, sem vírgula, tanto pode ser milhar quanto três casas, e adivinhar erraria mil vezes sem aviso. Escreva `1.234,00` ou `1234` |
| `0` · `0,00` | recusado (zero) |
| `-5` · `1e3` · `0x10` · `R$ 12` · `12,345` · `1,234.56` · `007` | recusado (negativo, expoente, hexadecimal, texto, três casas, formato inglês, zero à esquerda) |
| mais de R$ 1.000.000.000,00 | recusado (acima do teto) |

**Erros.** 400 `VALIDATION_ERROR` com os caminhos dos campos (a mensagem nunca repete o que o cliente mandou) para corpo, `:id` (tem de ser ULID) ou query inválidos, ticker desconhecido e data futura; 401 `UNAUTHORIZED`; 403 `FORBIDDEN` (Origem) e `CONSENT_REQUIRED`; 404 `NOT_FOUND` (o lançamento
não existe ou é de outro usuário: a resposta é a mesma); 409 `LOT_LIMIT` (200 lançamentos).

**Concorrência e o teto de 200 lançamentos.** O POST roda numa transação que trava o usuário (`pg_advisory_xact_lock`, o molde das temporadas e da liquidação), cria a carteira se for o primeiro lançamento, conta e só então grava: seis POST ao mesmo tempo com três lugares livres dão três 201 e três 409 (teste).
Atrás da trava do serviço está a do banco: o gatilho `portfolio_lot_api_guard` (migration `20261103130000_portfolio`) conta os lançamentos da carteira sob uma trava própria e recusa o 201º com `42501`, só para o login da api (o administrador, que semeia e testa, passa). O gatilho vale também para quem esquecer a
trava do serviço; o `api-role.integration.spec.ts` prova a espera da segunda conexão (o 200º de uma e o 200º da outra no mesmo instante: um passa).

**Abuso e limite de uso (risco aceito).** Não há limite por usuário nem por método nas escritas da carteira. O único freio é o `RateLimitPorIp` do WAF (600 requisições por minuto por IP, qualquer caminho: `wafRateLimitPerMinute` em `infra/main.bicep`); em dev e no e2e não há Front Door. O dano máximo é pequeno e limitado: 200 lançamentos por
usuário, corpo de até 100 KB (o padrão do Nest; só `/api/auth/*` tem 16 KB) recusado por um schema de 5 campos, transação de milissegundos e pool de 4 conexões; um IP faz no máximo uns 10 POST ou DELETE por segundo, que viram só rotatividade de linhas no Postgres. Se o abuso aparecer, a saída é uma regra do WAF para `POST`, `PATCH` e `DELETE` em
`/api/v1/me/` (algo como 60 por minuto por IP), ao lado da `RateLimitAuth`, com a mesma conferência no `infra/tests/check.mjs`. Não feito: é endurecimento opcional e não deu para verificar o WAF na Azure.

**Aceite vencido.** O `ConsentGuard` fica na classe, então com o aceite da versão vigente vencido **todas** as rotas da carteira dão 403 `CONSENT_REQUIRED`, inclusive o `DELETE` do lançamento; o que continua aberto são as rotas dos direitos do titular (`GET /me`, `POST /me/consents`, `GET /me/export` e `DELETE /me`, que apaga a carteira inteira). A política de privacidade (item 7) diz isso:
a tela da carteira pede o aceite primeiro. Tirar o guard só do `DELETE` seria possível (mover o `@UseGuards` da classe para as outras três rotas e trocar o teste dos guards), e não foi feito: uma pessoa que tem lançamentos já aceitou a versão que criou a carteira, e só uma versão nova a deixa nesse estado (ADR 0031).

**O banco.** `portfolio` (uma por usuário: `user_id` único; nasce no primeiro lançamento) e `portfolio_lot` (ticker, quantidade, `cost_cents` bigint, `bought_on` date, `created_at` e `updated_at`), com `ON DELETE CASCADE` de usuário para carteira e de carteira para lançamento. `CHECK`s: quantidade de 1 a 1.000.000, custo de 1 a 10^11,
ticker no formato do contrato e data a partir de 1900. **Sem chave estrangeira para `instrument`** (ADR 0031): a limpeza de `instrument` não trava por causa da carteira de um usuário, e o ticker que sai de lá fica no lançamento, sem fechamento. O papel mínimo da api (ADR 0028; `table-policy.ts`, as duas tabelas `personal: true`):
`portfolio` só com `SELECT` e `INSERT` (a linha nunca muda e não sai por `DELETE` direto: some junto com a conta, pela cascata, que roda com os privilégios do dono da tabela); `portfolio_lot` com `SELECT`, `INSERT` e `DELETE`, e `UPDATE` **só nas colunas** `ticker`, `quantity`, `cost_cents`, `bought_on` e
`updated_at` (a carteira dona e a data de criação nunca mudam). Os `GRANT` estão na migration, tabela por tabela e sem `ALTER DEFAULT PRIVILEGES`.

**LGPD.** A carteira é dado pessoal (`docs/CONTA.md`, seção 5): sai no `GET /me/export` (`portfolios` e `portfolioLots`, o custo em centavos e a data da compra como `AAAA-MM-DD`), some junto com a conta, na mesma transação (a cascata), e fica **fora do dump do backup mensal** (só o ponto de restauração de 7 dias a guarda). Os textos legais
estão na versão 0.2 (rascunho). Nada da carteira vai ao log nem à telemetria: o log de requisição é uma lista branca; o span da rota leva o padrão (`/api/v1/me/portfolio/lots/:id`), e o do Postgres, o SQL com os valores como parâmetro (`telemetry.integration.spec.ts`). Não há trilha de auditoria dos lançamentos (ADR 0031).

### Consulta e EXPLAIN

O `GET` faz duas consultas: os lançamentos do dono (Prisma, uma consulta) e **uma só para as barras da carteira inteira**, e não uma por ticker (o teste espia o `$queryRaw` e exige uma chamada para uma carteira de três papéis). O `LATERAL` lê **uma entrada** do índice `daily_bar_instrument_id_date_key` por papel, de trás para a frente:

```sql
SELECT i.ticker, b.date, b.close_cents
FROM instrument i
CROSS JOIN LATERAL (
  SELECT d.date, d.close_cents FROM daily_bar d WHERE d.instrument_id = i.id ORDER BY d.date DESC LIMIT 1
) b
WHERE i.ticker IN (...) AND i.quote_factor = 1
```

O `quote_factor = 1` (só papel cotado por unidade) entra como `Filter` na linha de `instrument` que o índice do ticker já leu: não muda o plano. Os tempos abaixo são de antes dele e não foram medidos de novo.

`EXPLAIN (ANALYZE, BUFFERS)` no Postgres 17.11 local, num banco descartável com dado **sintético** (600 papéis × 1.000 pregões = 600 mil barras; 5.001 carteiras e 150.200 lançamentos; a carteira medida tem 200 lançamentos em 150 papéis distintos):

| Consulta | Plano | Tempo |
|---|---|---|
| Último fechamento de 150 papéis (a da api) | `Nested Loop`: `Index Scan` em `instrument_ticker_key` e 150 voltas de `Index Scan Backward` em `daily_bar_instrument_id_date_key` com `LIMIT 1` (503 páginas no cache do Postgres e 102 lidas do disco, na primeira execução) | 1,3 ms |
| a alternativa descartada: `DISTINCT ON (ticker)` sobre todas as barras dos 150 papéis | `Seq Scan` nas 600 mil barras, `Hash Join` e `Sort` externo em disco (5 MB) | 177 ms |
| Lançamentos do dono | `Index Scan` em `portfolio_user_id_key`, `Bitmap Index Scan` em `portfolio_lot_portfolio_id_idx` e `Sort` de 200 linhas | 0,10 ms |
| `PATCH` (`UPDATE ... FROM portfolio`, filtrado pelo dono) | `Index Scan` em `portfolio_lot_pkey` e em `portfolio_user_id_key` | 0,13 ms |
| `DELETE` com o id de outro usuário (0 linhas) | com um id que não existe, `Index Scan` na chave primária e a carteira nem chega a ser consultada (`never executed`, 0,016 ms); com o lançamento **de outro usuário** (o caso do 404 por dono), lê o lançamento pela chave primária e a carteira por `portfolio_user_id_key`, e o filtro da junção descarta a linha | 0,03 ms |
| A contagem do teto (a do serviço e a do gatilho) | `Bitmap Index Scan` ou `Index Only Scan` em `portfolio_lot_portfolio_id_idx` (o planejador varia com o tamanho da tabela) | 0,035 ms |

A migration cria só os dois índices que essas consultas usam (`portfolio_user_id_key` e `portfolio_lot_portfolio_id_idx`); `daily_bar` não ganha nenhum. Com uma carteira só nas tabelas o planejador faz varredura sequencial (0,07 ms): os números da tabela são com as 5 mil carteiras.
O teto de 200 lançamentos limita a consulta e a resposta (uns 80 KB no pior caso). Estes números valem para as condições medidas; o plano com a tabela de barras de produção não foi visto (nada rodou na Azure).

**Testes** (nenhum chama B3, LLM ou a Azure; tudo sintético, e-mails `@example.test`): `packages/contracts/src/portfolio-rules.spec.ts` (a regra de dinheiro, com o teste de propriedade dos dois modos e do pior caso) e `portfolio.spec.ts` (os schemas); no api, `modules/portfolio/domain/positions.spec.ts` (preço médio, arredondamento,
P&L, sem fechamento, o pior caso, a barra acima do teto e o percentual fora do inteiro seguro) e `modules/portfolio/presentation/portfolio.integration.spec.ts` (a api de verdade com o login de menor privilégio: os dois modos, os 400 e a query nas quatro rotas, o dono com dois usuários, o 404, o aceite vencido, o teto e a corrida, a barra absurda, o papel por lote, o Swagger); `infrastructure/database/api-role.integration.spec.ts` (o catálogo, as recusas do banco, o gatilho e a espera da segunda
conexão), `table-policy.spec.ts` e `domain/user-data.spec.ts` (a carteira coberta pelos invariantes); `me.integration.spec.ts` (o export e a exclusão: as linhas antes e depois); `telemetry.integration.spec.ts` (nada da carteira na telemetria); `backup-verify.handler.integration.spec.ts` (a carteira fora do dump); `infra/tests/check.mjs` (as rotas fora do cache);
e, nos e2e, `smoke.spec.ts` (a sonda 401, com `@api`) e `account-api.spec.ts` (o ciclo da conta com os dois modos, o export e a exclusão pelo build de produção).

