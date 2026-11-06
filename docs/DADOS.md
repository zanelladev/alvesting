# Dados

De onde vêm os números e os textos da arena, como entram no banco e o que foi conferido. Cada fonte tem a sua linha em
`docs/DEPENDENCIAS.md` (URL, plano, licença). Plano: §2, §5.5, §6, §7, §8 e §10. As decisões novas de cada
etapa estão em "Decisões" (seção 11, mercado; seção 19, notícias e briefing), e a da fonte das cotações, na ADR 0032.

Duas partes: **mercado** (brapi, seções 1 a 12, etapa 4) e **notícias, macro e briefing** (RSS, CVM, BCB e o briefing
congelado, seções 13 a 21, etapa 5).

Dinheiro é sempre `bigint` em centavos. Datas de pregão são `AAAA-MM-DD` no calendário de Brasília (UTC−3, sem
horário de verão); semanas são ISO 8601 (`2026-W45`).

## Mercado: brapi (etapa 4; fonte única desde a onda da brapi, 03/11/2026, ADR 0032)

Código em `apps/api/src/modules/market-data` (`domain`, `application`, `infrastructure`). A fila `market` do
worker-data roteia `eod {pregão}` e `universe {semana}`; o `sched-eod` e o `sched-universe` só publicam.

> **Mudança de fonte (03/11/2026).** O plano baixava o COTAHIST da B3 todo dia. A página da B3 veda "a coleta automatizada,
> inclusive por meio de ferramentas de inteligência artificial" (seção 10), então o COTAHIST **saiu**: o parser, o download, o
> arquivo dos ZIPs no Blob (container `cotahist`) e a carga por arquivo foram apagados. A **brapi** é a fonte única das cotações
> e o **banco é o cache**: cada barra é pedida uma vez e fica gravada. A decisão está na ADR 0032; o que a B3 deixou no disco e no
> banco de dev foi apagado em 04/11/2026, por decisão do Artur (fim da seção 1).

### 1. Fontes

| Fonte | Uso | Onde está documentada |
|---|---|---|
| brapi (`/api/v2/stocks/historical` e `/api/quote/list`) | As barras diárias (abertura, máxima, mínima, fechamento e quantidade) de todo papel do universo, do BOVA11, dos papéis em posição e das carteiras; a lista de ações que semeia papel novo | seções 2, 6, 7 e 8 |
| Logos da brapi (`icons.brapi.dev`, o campo `logo` da lista) | O SVG do logo da empresa, copiado para o nosso banco (`instrument_logo`) e servido pelo site do próprio domínio (ADR 0036) | seção 3a |
| Lista de feriados da B3 (`b3-holidays.json`) | Calendário futuro e "hoje é pregão?" dos agendadores. Datas de feriado são fato, e nada as baixa: o arquivo é escrito à mão | seção 5 |
| Yahoo Finance (consulta manual, uma vez) | Fonte independente da conferência de 01/11/2026 | seção 9 |

**O que a B3 deixou foi apagado em 04/11/2026, por decisão do Artur** ("Recriar do zero pela brapi"):

- **O banco de dev** (`alvesting_dev`) foi recriado do zero pelas migrations. Saíram com ele as 71.528 barras do arquivo da B3, os 208 dias
  do `trading_day`, os 435 papéis com ISIN e nome do arquivo (inclusive o GOLL54 e o AZUL53, de preço por lote) e os universos W44 e W45,
  calculados sobre elas com a regra de então.
- **`.data/b3/`** (fora do git: os ZIPs `COTAHIST_A2026` e `COTAHIST_D30102026` e o PDF do layout) foi apagado, e também os containers
  `cotahist` e `ensaio-cotahist` do Azurite local. Na Azure o container nunca existiu.
- **O schema** perdeu o que só existia para o arquivo: o valor `COTAHIST` dos enums `bar_source` e `trading_day_source`, a coluna
  `trading_day.cotahist_sha256`, a `instrument.quote_factor` e a `daily_bar.trades`, pela migration `20261104100000` (não aditiva: a
  exceção registrada na ADR 0032, nota de 04/11/2026). O código perdeu o filtro de fator de cota (mercado, universo e carteira). A origem
  da barra (`daily_bar.source`) ficou com um valor só, `BRAPI`, como registro de proveniência.
- **A carga inicial pela brapi** foi feita pelo orquestrador da onda no mesmo dia (`market:backfill`, 3 meses): 372 papéis com barra
  faltando, **373 requisições** (a lista e 372 históricos), **19.789 barras** gravadas e **60 pregões** confirmados em 74,4 s; a cota foi
  de 14.988 para 14.619 (**369 gastas**: 3 respostas do histórico vieram pelo limitador de 20 por minuto e não gastaram, seção 2) e houve
  114 avisos de fechamento diferente do ajustado (seção 4). O dev ficou com **20.029 barras `BRAPI` de 376 papéis** (375 ações e o BOVA11),
  de 2026-08-07 a 2026-11-03, 60 pregões confirmados, nenhum ISIN e nenhum universo (`universe_snapshot` vazio); 93 papéis têm menos de
  60 barras, porque não negociaram todo dia. Conferência: `count(*)` 20.029 e `sum(close_cents)` 36.505.401 em `daily_bar`. A primeira
  tentativa, antes da correção do cabeçalho de cota (seção 9), tinha gravado 240 barras de 4 papéis e parado. Detalhes na seção 9.

### 2. A brapi

`https://brapi.dev`, plano **gratuito** (preços e limites lidos em 03/11/2026; `docs/DEPENDENCIAS.md` tem os links):

| O que | Valor |
|---|---|
| Requisições | 15.000 numa **janela móvel de 30 dias**: a resposta do histórico que passa pela cota traz `X-RateLimit-Window: rolling-30d` (prova controlada de 04/11/2026), e o `RateLimit-Reset` dessas respostas é o tempo até a meia-noite UTC seguinte (inferência: a janela anda por dia UTC; nas respostas do limitador de 20 por minuto ele é 60). O FAQ ("Quais são os limites da API da brapi?") fala em ciclo mensal que reinicia na data de renovação do painel de cobrança; para o plano gratuito vale o que a API devolve. **Só a resposta 200 do histórico que passou pela cota gasta cota**: a lista, o 400 e o 404 não gastaram na prova, e 3 respostas 200 do histórico da carga do dev (04/11/2026) vieram pelo limitador de 20 por minuto, sem cabeçalho de cota, e também não gastaram (ver "Cabeçalhos de cota"). O cliente lê o `X-RateLimit-Remaining`, que só vem com a cota |
| Papéis por requisição | 1 (o Startup aceita 10 e o Pro, 20) |
| Requisições ao mesmo tempo | 1 na conta inteira, não por chave (acima disso, 429) |
| Histórico | até 3 meses, intervalo `1d` |
| Atualização dos dados | a cada 30 minutos (cotação; o fechamento do dia é o que a carga busca) |
| Autenticação | `Authorization: Bearer <token>`. O `?token=` na URL existe, mas aparece em log e histórico: nunca é usado |

Os dois endpoints que o código usa (docs salvos de 03/11/2026 e a página de autenticação):

- `GET /api/v2/stocks/historical?symbols=PETR4&startDate=2026-10-26&endDate=2026-10-30&interval=1d`: `results[].requestedSymbol` e
  `results[].data.historicalDataPrice[]`, com `date`, `open`, `high`, `low`, `close`, `volume` (**quantidade** negociada, não volume
  financeiro) e `adjustedClose`. A doc diz só que `date` é a "data do pregão em Unix timestamp, em segundos": **o cliente aceita uma
  forma, a meia-noite de Brasília (03:00 UTC), e descarta com aviso o que tem outra** (ver "A data da barra", abaixo; a prova controlada
  confirmou a forma). **O plano gratuito aceita no máximo 90 dias entre `startDate` e `endDate`** (acima disso, 400
  `DATE_WINDOW_EXCEEDED`, "Seu plano permite no máximo 90 dias de dados históricos"; a página de erros da doc chama o caso de
  `INVALID_RANGE`, que não apareceu) **e não olha a idade do início** (um pedido de um dia, 93 dias atrás, passou). Três meses de
  calendário vão de 89 a 92 dias, então o pedido começa 3 dias depois do limite de calendário (`historyStart`, 86 a 89 dias). A doc avisa
  que `open`/`high`/`low`/`close` "podem vir ajustados" em intervalos diários (o `includeRaw`, com os preços originais, é só do Pro):
  ver "Preço ajustado" na seção 4. Cada item de `results` traz `symbol` e `changed` (nos papéis da prova, o mesmo código e `false`):
  `changed = true` é ticker trocado, e os preços são da série de outro código. `data` traz também `usedInterval` e `usedRange`, que o
  código ignora.
- `GET /api/quote/list?type=stock&limit=1000&page=1`: `stocks[]` com `stock` (o código), `name`, `close`, `volume`, `type`, `subType`
  (`stock`, `unit`...) e `logo` (o endereço do SVG do logo em `icons.brapi.dev`, seção 3a), `currentPage`, `totalPages`, `totalCount` e
  `hasNextPage`. É a lista que semeia papel novo (seção 8) e aponta os logos. É o endpoint
  antigo (v1): a doc manda usar o `/api/v2/tickers` nas integrações novas e diz que o v1 "continua ativo e sem data de remoção". Na prova
  controlada o `limit=1000` foi aceito: **785 ações em uma página** (`hasNextPage` falso), todas `type = stock`, com `subType` `stock`
  (773) ou `unit` (12), nenhum nulo, e **375 viram semente** pelas regras da seção 3 (272 ON, 69 PN, 15 PNA, 9 PNB, 1 PNC, 9 UNT). A
  lista tem WEGE3, ABEV3, PETR4, TAEE11 e BPAC11 e não tem o BOVA11 (a referência vem de constante), e todo papel dela tinha volume no
  último pregão. **A lista tem outro limitador**: `RateLimit-Limit 20`, `RateLimit-Remaining 20`, `RateLimit-Reset 60` (20 por minuto) e
  nenhum `X-RateLimit-*`; ela não gastou cota, e o cliente não lê esse par de cabeçalhos (o "20" parece cota baixa para a reserva de
  500). A escolha do endpoint está na ADR 0032.

**Cabeçalhos de cota.** Nomes vistos na prova controlada e na carga do dev: `RateLimit-Limit` (15000), `RateLimit-Remaining`,
`RateLimit-Reset`, **`X-RateLimit-Limit`**, **`X-RateLimit-Remaining`** (**o único que o código lê**), **`X-RateLimit-Window`**
(`rolling-30d`), `X-Brapi-Concurrency-Limit` (1), `X-Brapi-Queue-Wait-Ms` e `X-Plan-Data-Freshness` (`1800s`: dado com até 30
minutos); num 429, a doc promete também `Retry-After` (segundos), que nenhuma das duas medidas viu. Há **dois pares** de cabeçalho
de limite, de dois limitadores:

| Par | Limitador | Quando vem | Entra na conta da cota |
|---|---|---|---|
| `X-RateLimit-Limit`/`-Remaining`/`-Window: rolling-30d` | a cota do plano (15.000 numa janela móvel de 30 dias) | só na resposta que gastou cota (o histórico); o par sem `X` vem junto e repete a cota (15000 e o restante) | **sim**: é o que o cliente lê |
| `RateLimit-Limit 20`/`-Remaining`/`-Reset 60` | 20 requisições por minuto | na lista, e **também** em respostas 200 do histórico que passaram só por ele, sem nenhum `X-RateLimit-*` | **não**: sem o par com `X`, a resposta não gastou cota |

**Achado da carga do dev (04/11/2026).** Uma resposta 200 do histórico (PETR4) veio pelo limitador de 20 por minuto, com `RateLimit-Limit
20`, `RateLimit-Remaining 20`, `RateLimit-Reset 60`, **sem nenhum `X-RateLimit-*`**, e não gastou cota (a cota foi de 14.989, na resposta
do BOVA11, para 14.988, na do BBDC4 logo depois). O cliente, que na época lia o `RateLimit-Remaining`, entendeu o "20" como a cota e
parou a carga na 5ª requisição por "cota baixa" (reserva de 500), com o sinal `brapi-cota-baixa` por engano. A correção: ler só o
`X-RateLimit-Remaining`, e a resposta que não o traz (a lista, e o histórico servido por esse limitador) **não muda** a cota conhecida.
Teste novo em `brapi.client.spec.ts`, com os cabeçalhos reais, e a brapi falsa do ensaio (`ensaio/fake-brapi.ts`) manda os dois pares.
Com a correção a carga andou inteira (seção 9, "Segunda prova real"). O erro da prova controlada de 04/11 (ler o `RateLimit-Remaining` da
lista) tinha a mesma raiz: o par sem o `X` é do limitador de 20 por minuto, e só o par com o `X` é a cota.

Como o cliente (`brapi.client.ts`) trata cada resposta:

| Resposta | Tratamento |
|---|---|
| 200 com o formato dos docs | As barras do período; o papel sem negócio vem sem a data (ou com preço nulo) e é falta, não erro. Barra com preço fora da escala (acima de R$ 10 milhões por ação, ou volume acima do `bigint` do Postgres: erro de unidade do provedor) também é falta, em vez de um `INSERT` que estoura e derruba o lote do papel toda noite |
| 200 sem o `X-RateLimit-Remaining` (a lista, ou o histórico servido pelo limitador de 20 por minuto) | As barras entram como as de qualquer outra resposta; a cota conhecida **não muda** (o `RateLimit-Remaining 20` desse limitador não é a cota) |
| 200 com JSON fora do formato | Falta daquele papel, com aviso; os outros seguem |
| 200 com `date` fora da forma esperada | A barra avulsa é descartada com aviso (papel, quantas e o timestamp da primeira); se **nenhuma** barra da resposta tem a forma, a resposta toda é `failed` (conta para a queda) |
| 200 com `changed = true` | O ticker foi trocado e a série é de outro código: falta daquele papel, com aviso, nada gravado |
| 401, 402, 403 | Erro de configuração: a busca **encerra**, o `job_run` fica `FAILED` (alerta `job-falhou`) e o corpo da resposta nunca é lido nem registrado (pode repetir o token). O que já veio foi gravado |
| 429 | Espera o `Retry-After` (teto de 30 s; sem o cabeçalho, 5 s) e repete **só aquele papel**, até 3 vezes. `Retry-After` acima do teto, ou cota restante na reserva, é a cota que acabou: a busca para (`brapi-cota-baixa`) |
| 5xx e timeout (15 s) | Repete aquele papel uma vez, depois de 1 s; se falhar de novo, ele fica como falta |
| 400, 404 | Falta daquele papel, sem repetir. O 400 que a prova viu é `DATE_WINDOW_EXCEEDED` (janela de mais de 90 dias) e o 404, `NOT_FOUND` ("Nenhum histórico encontrado para os símbolos informados", papel que a brapi não conhece); nenhum dos dois gastou cota |
| 5 papéis seguidos sem resposta | A brapi está fora do ar (ou a janela é recusada): a passada para e o resto fica como falta, em vez de gastar 2 requisições em cada um dos 300 papéis. O 400 e o 404 só contam enquanto **nenhum** papel respondeu bem nesta passada (a janela ou o plano recusando tudo); depois de uma resposta boa são do papel (suspenso, sem histórico) e não encerram a passada |
| Acabou o orçamento de tempo | A passada para com `time`, e o resto fica como falta (ver "O orçamento de tempo", abaixo) |

Falha num papel **nunca refaz a lista**: cada papel é gravado assim que chega, e a nova tentativa pede só a falta.

**O orçamento de tempo vale dentro de um papel.** A trava da fila `market` é renovada por 5 minutos (`QUEUES`); passar disso deixa
outra entrega assumir o job e refazer as requisições (só a cota se perde; o dado fica protegido pelo `ON CONFLICT DO NOTHING`). O
orçamento é de 4 minutos por passada (`FETCH_BUDGET_MS`), contado do início, e **nenhuma** espera passa dele: o `Retry-After` do 429, a
pausa de 1 s do 5xx, a espera da trava consultiva (até 15 s) e o timeout da requisição (o menor entre 15 s e o que resta) respeitam o
prazo. A requisição que não cabe nem sai (e não conta como feita). A lista e as barras da atualização semanal dividem o mesmo orçamento
(`WeeklyRefresh` passa às barras o que a lista deixou). **310 requisições em 4 minutos exigem latência média abaixo de 0,77 s por
requisição**, e a prova controlada mediu: 101 a 538 ms por requisição (média de 265 ms nas seis respostas 200 do histórico, contra 7 a
9 ms do `took` do servidor), uns 82 s para 310 papéis, com folga de quase 3 vezes. Se a latência subir, a passada para com `time` e o
`eod` reagenda; cada nova tentativa (de hora em hora, até o prazo das 00:30) pede só o que falta. As 4 tentativas somam 16 minutos e
cobrem os 310 papéis até uns 3 s por requisição; acima disso o dia fecha no prazo com papéis sem a barra (o `eod-barras-ausentes`
avisa acima de 10%). A medida é de uma noite, de uma máquina e de poucas requisições seguidas; a latência com 300 seguidas e com
a brapi sob carga não foi vista.

**A data da barra.** A doc diz só "Data do pregão em Unix timestamp, em segundos". O código aceita a meia-noite de Brasília (03:00
UTC), e **a prova controlada confirmou: as 77 barras de 3 papéis vieram todas às 03:00 UTC** (por exemplo `1793674800` é
`2026-11-03T03:00:00Z`). Por quê tanta cautela: `daily_bar` é só inserção, e a meia-noite UTC cairia no dia anterior no relógio de
Brasília (a segunda viraria domingo), gravada para sempre, com o `confirmTradingDays` podendo confirmar um domingo. Por isso o que não
tem a forma continua descartado com aviso e, se for a resposta inteira, vira falha (e a queda a conta). Se a brapi mudar a forma
(a abertura às 10:00, por exemplo), a constante `BRASILIA_MIDNIGHT_SECONDS` e o fake mudam juntos.

**Uma requisição por vez, na conta inteira.** Entre as réplicas do worker-data, o `universe` e a carga manual (`market:backfill`), a
trava é uma **trava consultiva de transação do Postgres** (`pg_advisory_xact_lock(hashtextextended('brapi', 0))`), que cada requisição
segura do envio à leitura do corpo e solta no commit, no rollback ou se o processo cair. A espera do `Retry-After` fica fora dela.

**A reserva de cota.** Antes de cada requisição o cliente olha o `X-RateLimit-Remaining` da última resposta que o trouxe; com ele igual à reserva
(`QUOTA_RESERVE = 500`, `domain/bar-plan.ts`), a próxima deixaria a conta abaixo dela e a busca para, registra o sinal
`brapi-cota-baixa` e deixa o resto como falta. 500 é uns 1,6 conjunto obrigatório por noite: sobra para recuperar um papel ou uma
janela à mão, e o alerta chega com dias de folga se o consumo for o planejado (seção 6).

**O que a licença permite** (FAQ da brapi, "O que a licença de uso permite", lido em 03/11/2026; os Termos de Uso são de
07/06/2025): "dentro do seu próprio produto você pode: exibir os dados para os seus usuários; guardar em cache, persistir e montar
séries históricas, gráficos e tabelas; calcular e publicar indicadores derivados [...]". "O que a licença não permite é entregar os
Dados a terceiros como feed, API ou base bruta, nem criar proxy, espelho ou wrapper da nossa API". O banco como cache e as telas se
enquadram. **A API pública não entrega cotação bruta** (parte 2 da onda, 03/11/2026; ADR 0033; `docs/API.md`, seção 6): as barras
de `/stocks/:ticker` e o fechamento do BOVA11 do `/arena/current` saíram, e o site as lê de uma **rota interna** da api, com um segredo
que só o servidor tem (a licença deixa "exibir os dados para os seus usuários", não "entregá-los a terceiros como feed, API ou base
bruta"). Também saiu a composição da carteira do Sorteio e das referências (o igual-peso segura o universo inteiro, e a marcação das
posições dele seria o fechamento de todo papel, todo pregão). Ficam os registros da arena dos **modelos** (posição com marcação, valor
e P&L, no máximo `maxPositions` por modelo) e o patrimônio, o ranking e o Monte Carlo de todos: o resultado publicado do
experimento, que a licença trata como uso dentro do produto e indicador derivado. Em caso de dúvida, a decisão é do Artur e do
orientador.

> **A brapi não é distribuidora licenciada da B3.** O FAQ ("A brapi é distribuidora licenciada da B3? Vocês fazem contrato e
> SLA?") diz: "Não. A brapi não é Distribuidora nem Redistribuidora licenciada pela B3, não faz parte dessa cadeia de licenciamento e
> não utiliza dados da B3. Também não fazemos contratos individuais, calls comerciais nem oferecemos SLA." Os dados vêm de "dados
> abertos e públicos". Para um TCC isso basta; para um produto com compliance de market data seria preciso um fornecedor licenciado.
> A página pública diz a fonte e que o dado não é recomendação: o rodapé de toda tela traz "Cotações: brapi.dev" (com link e a data do
> último pregão), o aviso fixo diz que nada ali é recomendação, e a faixa do BOVA11, a página da ação, a carteira e a lista de fontes de
> "Como funciona" repetem o crédito (e esta última diz que a brapi não é distribuidora licenciada da B3).

### 3. O que é gravado

Ação à vista do lote padrão e o BOVA11. A **classe** do papel (`instrument.spec`) sai do sufixo do código e do tipo da lista da
brapi, porque a brapi não informa a espécie da B3 nem o ISIN:

| Sufixo do código | `spec` | Observação |
|---|---|---|
| `3` | `ON` | PETR3, VALE3 |
| `4` | `PN` | PETR4 |
| `5`, `6`, `7`, `8` | `PNA`, `PNB`, `PNC`, `PND` | ELET6 é PNB |
| `11` | `UNT` | só se a brapi diz `subType = unit` (ETF e FII também terminam em 11, e o `subType` da lista é nulo para alguns ativos: nulo **não** semeia o 11; na prova controlada nenhum dos 785 vinha nulo, e 9 dos 12 `unit` viraram semente). O código digitado à mão em `market:backfill --papeis` vale pelo sufixo |
| `1`, `2`, `9`, `10`, `12`... | fora | direito, recibo, fundo: não é ação do lote padrão |
| (BOVA11) | `CI`, `kind = REFERENCE` | semeado por constante, sempre buscado, fora do universo |

O código é `^[A-Z][A-Z0-9]{3}\d{1,2}$` (`B3SA3`, `BPAC11`). O papel semeado pela lista entra com **ISIN nulo**, o nome da lista (sem
caractere de controle, até 60 caracteres; sem nome, o código) e `last_seen` no último pregão da janela da carga (a lista o trouxe). A coluna
só avança, com a barra mais nova que se grava, e **não é a data da última barra do papel**: o que não negocia nos últimos pregões fica com a
data da carga. Nada lê a coluna. O papel que já existe nunca é tocado: o `INSERT ... ON CONFLICT DO NOTHING` mantém o nome, o ISIN e a
classe gravados.

Nada no código depende do ISIN nem da classe para decidir: o vínculo do CNPJ pelo FCA da CVM (seção 14) é pela raiz de quatro letras do
código; o universo e a carteira filtram por `kind`. O ISIN nulo fica registrado em `deferred`: quem precisar dele (um cruzamento com a
CVM por ISIN, por exemplo) o busca depois. Como a brapi cota por unidade, não existe o papel por lote que o arquivo antigo trazia (o
fator de cota, `quote_factor`, saiu do schema em 04/11/2026, seção 1).

### 3a. Os logos das ações (ADR 0036, 05/11/2026)

O logo da empresa ao lado do ticker, como o Rallies faz nas carteiras. A brapi dá acesso aos logos em todos os planos (o FAQ, citado no
ADR), e a lista que a atualização semanal já pede (`/api/quote/list`, seção 2) traz em cada ação o campo `logo`, o endereço de um SVG em
`https://icons.brapi.dev/icons/<TICKER>.svg`. Decisão do Artur: **"Cópia guardada por nós"**. O job baixa o SVG, recusa o inseguro e o
guarda no banco; o site o serve do próprio domínio (rota da T3), lendo-o das rotas internas da api (`docs/API.md`, seção 6). Nenhum dado
do visitante vai à brapi, a política de privacidade não muda e **nenhum SVG entra no git**. Código: `application/logo-refresh.ts` (a
passada), `domain/svg-check.ts` (o validador), `infrastructure/brapi.client.ts` (`logoUrl`) e `infrastructure/market.repository.ts`.

**O que vale da lista.** Só o endereço exato `https://icons.brapi.dev/icons/<nome>.svg` (o nome com letras, dígitos, `_` e `-`, até 32;
sem porta, usuário, query, fragmento, ponto nem percent-encoding). Qualquer outra coisa (ausente, nula, número, `http`, outro host, outro
caminho) é "sem logo", e o valor torto num papel nunca derruba a lista. O **ícone padrão** que a brapi põe para quem não tem logo,
`https://icons.brapi.dev/icons/BRAPI.svg`, também é "sem logo".

**A tabela `instrument_logo`** (migration `20261105120000_instrument_logo`, só aditiva): um logo por papel (a chave é o `instrument_id`, com
cascata: o logo some com o papel), a URL de origem, o SVG (o texto baixado, byte a byte, o BOM inclusive), o SHA-256 dos bytes, os bytes e a
data da última busca que passou no validador. Um `CHECK` é a rede de segurança: de 1 byte a 200 KB, o tamanho é o do próprio SVG em UTF-8 e o
SHA-256 é hexadecimal minúsculo. A api só lê (`SELECT`, matriz `table-policy.ts`); quem grava é o worker e o `market:logos`. Não é dado
pessoal: entra no dump mensal.

**A passada** (`LogoRefresh`): no fim da atualização semanal (seção 8, item 4), depois da lista e das barras, com o que sobra do orçamento de
4 minutos, e no `market:logos` (sem rede por padrão; busca só com `--confirmo-banco <nome>`, como o `market:backfill`; sem teto de tempo).

1. **Reconfere todo SVG guardado** com o validador de hoje e apaga o que ele recusa (o ticker e o motivo vão ao log, nunca o conteúdo). A
   tabela só guarda o que passa na regra de hoje, e por isso as rotas internas leem o banco como está. **Depois de mudar o validador,
   roda-se o `market:logos`** (RUNBOOK, 12.7).
2. **Baixa só o que precisa**, dos papéis do banco que a lista traz com logo: sem logo guardado, endereço trocado ou guardado há mais de 30
   dias (`LOGO_MAX_AGE_MS`). Um pedido por vez, no endereço que o `logoUrl` conferiu, sem token nem cookie, sem seguir redirecionamento
   (`redirect: 'error'`), com prazo de 10 s (o corpo inclusive), `Content-Type` `image/svg+xml` e teto de 200 KB lido do corpo **já
   descomprimido** (o host comprime: o `Content-Length` do ABEV3 era 888 e o corpo lido, 1.617 bytes; a leitura para no teto, sem ler o resto). 5 falhas seguidas
   (rede, prazo, HTTP diferente de 200, tipo errado) são o host fora do ar e param a passada; a recusa do validador não conta como falha.
3. **Grava**: o SVG novo, ou com outro SHA-256, entra inteiro; o mesmo SHA-256 não regrava o SVG (só a URL e a data andam, e os 30 dias
   contam de novo). O recusado vira "sem logo" nesta passada, com o motivo e o ticker no log, e não apaga o guardado antes (que passou no
   passo 1). Nada aqui sobe exceção de rede, e a falha da passada inteira (o banco, por exemplo) vira um aviso: a atualização e o universo
   seguem.

**O validador** (`svgRefusal`, função pura, sem dependência): lê o XML com um leitor pequeno que entende só a declaração (em UTF-8),
comentários, CDATA, elementos e atributos entre aspas, e **recusa o resto** (na dúvida, o monograma). A raiz é `<svg>`. Recusa: `<script>`,
`<foreignObject>`, `<iframe>`, `<frame>`, `<embed>`, `<object>`, `<applet>`, a animação que troca atributo (`<set>`, `<animate>`,
`<animateMotion>`, `<animateTransform>`, `<animateColor>`, `<discard>`), `<handler>`, `<listener>`, `<meta>`, `<link>` e `<base>`; atributo
`on*`; `<!DOCTYPE>` e `<!ENTITY>` (e entidade sem declaração); instrução de processamento; `xml:base`; `javascript:` (e `vbscript:`) em
qualquer atributo; `href` e `src` que não sejam `#id` ou imagem embutida em `data:image/(png|jpeg|gif|webp);base64`; `url()` que não seja
`#id` ou essa imagem; `@import` e endereço (`//`) no `<style>` e no atributo `style`; o caractere nulo; e o que passa de 200 KB. Nomes valem
sem o prefixo de namespace e sem caixa (`svg:script` e `SCRIPT` são `<script>`); valores, depois das entidades do XML (`&#106;`), dos
escapes do CSS (`\75`) e sem os espaços e controles que o navegador ignora num endereço (`java&#9;script:`); o texto do `<style>` é
conferido inteiro (um comentário no meio de `@import` não o esconde). Os casos de teste (`svg-check.spec.ts`) levam os ataques conhecidos de
SVG e os disfarces deles.

**A prova real** (05/11/2026, a única chamada externa da onda junto com a carga, abaixo): pelo código de verdade (o `BrapiClient`, o
`LogoRefresh` e o `MarketRepository` do `dist`), num banco descartável (`alvesting_t1_prova_test`, criado com as 22 migrations e apagado no
fim), com um `fetch` contador que barrava a 2ª requisição à brapi e o 11º SVG:

| O que | Resultado |
|---|---|
| A lista (`/api/quote/list?type=stock&limit=1000&page=1`) | 200 em 230 ms; 783 ações em uma página (`hasNextPage` falso); só o limitador de 20 por minuto (`RateLimit-Limit 20`, `RateLimit-Remaining 20`, `RateLimit-Reset 60`) e nenhum `X-RateLimit-*`: não gasta cota (seção 2) |
| O campo `logo` | 783 de 783 com texto, todos na forma exata; 752 com o nome do próprio ticker; **31 com o mesmo endereço, `BRAPI.svg`: o ícone padrão** (o único repetido); 373 sementes (seção 3) |
| Os 10 SVG (ABEV3, B3SA3, BBAS3, BBDC4, ITUB4, MGLU3, PETR4, TAEE11, VALE3, WEGE3) | 200, `Content-Type: image/svg+xml`, `server: GitHub.com` (o GitHub Pages), `Cache-Control: max-age=600`, comprimido (o `Content-Length` menor que o corpo lido); 14 a 166 ms; nenhum com o token (`Authorization` ausente) |
| O que veio | 263 a 2.191 bytes (11.439 no total); a raiz `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56">`, sem `viewBox`, nos 10; nenhuma declaração XML, `<style>` nem imagem embutida; gradiente só no PETR4 |
| O validador | aceitou os 10 (nenhum recusado); os 10 gravados |

**A carga do dev** (05/11/2026, uma vez, `market:logos --confirmo-banco alvesting_dev` sobre o `dist` recém-compilado, sem a guarda de rede;
antes, a migration pelo `migrate:deploy`, que não mudou nenhuma linha: 20.029 barras e `sum(close_cents)` 36.505.401, 376 papéis e 60 pregões
antes e depois):

| O que | Resultado |
|---|---|
| Pedidos | **1 à lista** e **357 ao icons.brapi.dev**; **nenhum ao histórico** (a cota da brapi não muda: a lista não traz o `X-RateLimit-Remaining`) |
| A lista | 783 ações, 752 com logo; 357 das 375 ações do banco com logo |
| Gravado | **357 logos**, 0 iguais, **0 recusados**, 0 sem resposta, em **44,1 s** (uns 0,12 s por SVG) |
| Tamanho | **507.174 bytes**: de 222 a 15.198 (AXIA3 e AXIA7), média 1.421, mediana 1.006; 296 SHA-256 distintos (a ON e a PN de uma empresa dividem o logo) |
| Forma | nenhuma imagem embutida, `<image>`, `<style>` nem declaração XML; 69 com gradiente; 57 com `viewBox`; 223 com a raiz exata `<svg ... width="56" height="56">` |
| Sem logo | 18 ações do banco: AUAU3, B1003, CALI3, CASN3, CASN4, CEED3, EQPA5, EQPA6, FASA3, HBTS5, JOPA4, MAPT3, MSPA4, MWET4, NATU3, PATI4, SHUL3 e TOKY3 (o ícone padrão, ou fora da lista de hoje) |

Depois: `prisma migrate status` em dia e `prisma migrate diff` vazio no `alvesting_dev`. O `alvesting_ensaio` (a demo) não recebeu a
migration (o coordenador a aplica). Os números acima são contagens e formas: nenhum SVG ficou fora do banco.

**Não visto:** o 429, o 5xx e o redirecionamento do icons.brapi.dev (cobertos por teste com `fetch` falso); um logo de verdade com imagem
embutida, `<style>` ou algo que o validador recuse (nenhum dos 357); e se a brapi conta o SVG no limite de 1 requisição por vez da conta (a
passada não toma a trava consultiva da brapi: o host é outro e estático).

### 4. Preço e volume

- Preço: centavos por ação, em `bigint` (o `19,99` da brapi vira `1999`: `Math.round`, nunca trunca). A brapi cota por unidade.
- **O volume financeiro é estimado: quantidade × fechamento.** A brapi informa a quantidade, não o volume em reais. A diferença para o
  volume real é pequena, porque o fechamento é o último negócio e não o preço médio do dia; o universo (seção 8) é uma classificação
  por volume médio de 60 pregões, onde esse erro não troca de posição quem está longe da vizinhança. A seção 9 tem os números da
  conferência.
- `daily_bar` guarda abertura, máxima, mínima, fechamento, volume e a origem (`BRAPI`, a única). **Barra gravada nunca é sobrescrita**
  (seção 6).
- O banco recusa, por `CHECK` (migration `20261101170000_market_data_integrity`; a de 04/11/2026 refez o de `daily_bar` sem a coluna
  `trades`, que saiu), preço e volume negativos e máxima abaixo da mínima em `daily_bar`, posição menor que 1 em `universe_member` e
  semana fora de `AAAA-Www` (W01 a W53) em `universe_snapshot`. O
  cliente da brapi já recusa esses casos antes (a barra com máxima abaixo da mínima, preço zero ou volume negativo é descartada e vira
  falta, para não derrubar o lote); o `CHECK` é a rede de segurança. Abertura e fechamento fora de [mínima, máxima] passam.
- **Preço ajustado.** A doc da brapi diz que o OHLC diário "pode vir ajustado" (proventos, desdobramentos e grupamentos) e que os
  preços originais (`includeRaw`) são só do Pro. **Medido na prova controlada (WEGE3, 60 pregões):** o `close` difere do `adjustedClose`
  em **30 das 60 barras**, então o OHLC que a brapi serve **não vem ajustado por provento**; o `adjustedClose` é um campo à parte (que
  o código não usa). O que a prova **não** mediu é desdobramento ou grupamento (nenhum caiu na janela): uma série ajustada por eles
  seria indistinguível da original neste teste. A barra gravada é a **capturada na noite do pregão**, e **não muda depois**. Quem
  **entra depois** traz o histórico como a brapi o serve hoje: a carga de 3 meses de um papel novo pode vir ajustada por um
  desdobramento. O cliente registra (papel e quantidade, **nunca preço**) as barras cujo `close` difere do `adjustedClose` (`brapi:
  barras com fechamento diferente do fechamento ajustado`; na prova, `adjusted: 30` para a WEGE3). Dois efeitos, ambos conhecidos e
  nenhum silencioso: (1) a nova busca de um pregão que já tem barra, com valor diferente, registra o sinal `barras-divergentes` e não
  muda nada (seção 6; na prova, as 5 barras que já estavam gravadas voltaram idênticas); (2) **um desdobramento ou grupamento que cai
  dentro da janela carregada depois do evento** pode deixar a série ajustada, e o evento corporativo do admin (que multiplica a
  quantidade na data ex) aplicaria o fator duas vezes. O RUNBOOK diz para conferir a série antes de registrar o evento de um papel
  assim.
- **Sem papel por lote.** O arquivo da B3 cotava GOLL54 e AZUL53 por lote (de 1.000 e 1.000.000 ações) e o código os filtrava por um fator
  de cota. Os dois saíram com o dev recriado (seção 1), a brapi não lista papel por lote, e o filtro saiu do código e do schema.

### 5. Calendário de pregões (`trading_day`)

Um dia de pregão é dia útil que não está na lista de feriados da B3 (`b3-holidays.json`, ao lado do módulo; o `nest build` o copia
para o `dist` e a imagem da api o leva). **O arquivo é escrito à mão** a partir da página de feriados da B3 e atualizado uma vez por
ano (RUNBOOK): datas de feriado são fato, nenhum job baixa nada da B3. O mesmo calendário em código (`TradingCalendar`) responde aos
agendadores sem consultar banco: às 07:30 as barras do dia não existem, e o `sched-eod` só publica `eod` se for pregão. A tabela
`trading_day` guarda os dias: **`BRAPI`** para os confirmados (o pregão tem barras gravadas) e `CALENDAR` para os previstos pela
lista (os futuros). Cada `eod` e `universe` semeia os dias futuros até o fim da lista, sem rebaixar dia já confirmado (a carga manual
não semeia: o `confirmTradingDays` insere o dia que ganhou barra).

- **Só se confirma o dia que tem barra.** `MarketRepository.confirmTradingDays` confere no SQL (`WHERE EXISTS (SELECT 1 FROM
  daily_bar ...)`): um dia sem nenhuma barra seria "confirmado" sem dado e o universo o contaria. Nunca reescreve dia já confirmado.
  Quem lê `source` trata `CALENDAR` como previsão e qualquer outro valor como dado confirmado (`UniverseRepository.confirmedDaysBetween`:
  `source <> CALENDAR`).
- **`CALENDAR` é previsão, não fonte de leitura.** A lista muda (2027 é provisório) e a linha não acompanha. Quem precisa saber se um
  dia é pregão pergunta ao `TradingCalendar`. Quando a B3 publicar a lista de 2027, trocar o JSON e apagar as linhas previstas
  (`DELETE FROM trading_day WHERE source = 'CALENDAR'`): o próximo `eod` ou `universe` as semeia de novo, agora certas.
- **2026: oficial.** 14 dias sem sessão, copiados da página da B3: 01/01, 16 e 17/02 (Carnaval), 03/04, 21/04, 01/05, 04/06, 07/09,
  12/10, **02/11 (Finados, segunda-feira)**, 20/11, 24/12, 25/12 e 31/12. A Quarta-feira de Cinzas (18/02) abre às 13h e conta como
  pregão. Conferido em 01/11/2026, contra o arquivo da B3 (então a fonte): 208 dias com cotação, de 02/01 a 30/10, exatamente os dias
  úteis fora da lista (o teste `trading-calendar.spec.ts` trava 247 pregões em 2026, 208 até 30/10).
- **2027: provisório.** Os 12 dias de 2027 são os feriados nacionais que caem em dia útil mais a véspera de Natal e o último dia do
  ano, que a B3 fechou em 2025 e 2026. A mesma regra reproduz as listas oficiais de 2024, 2025 e 2026. **Trocar pela lista da B3 quando
  ela sair.** Enquanto for provisória, um dia útil que a B3 abra e a lista marque como feriado passa em silêncio: o `sched-eod` não
  publica o `eod` e o erro aparece 60 pregões depois, quando o universo falha por janela incompleta.
- Ano fora da lista: o calendário **falha alto** (`CalendarCoverageError`) em vez de responder "não é pregão".

### 6. Cotas, carga inicial e o que se pede

**O banco é o cache.** Cada barra é pedida uma vez e fica gravada; só a falta vai à brapi. A licença permite guardar e montar séries,
e o plano gratuito (15 mil por mês) só dá conta assim. As regras:

- **Só inserção.** `INSERT ... ON CONFLICT (instrument_id, date) DO NOTHING`. Barra existente nunca é sobrescrita. Se uma nova busca
  traz valor diferente do gravado para o mesmo papel e pregão, o `BarLoader` registra o sinal
  **`barras-divergentes`** (papel, data e campos, os 20 primeiros) e não muda nada; correção de dado é pelo evento corporativo do
  admin. **Limite conhecido:** a divergência é achada por uma leitura antes do `INSERT`, então, com duas gravações **simultâneas** da
  mesma barra com valores diferentes (o `eod` da noite e um `market:backfill` à mão ao mesmo tempo), a que perde a corrida grava zero e
  não vê a linha da vencedora: o dado não duplica nem se perde (medido: 200 pares simultâneos, 200 linhas, nenhum erro), mas a
  divergência pode passar sem o sinal. O `eod` repetido é serializado pelo `job_run` e as requisições, pela trava, então só a carga manual
  durante a noite abre essa janela; o RUNBOOK diz para não rodar a carga manual entre 21:30 e 00:30.
- **Papel sem linha em `instrument` não tem a barra gravada.** O BOVA11 só nasce em `instrument` pela carga inicial; antes dela o `eod`
  o pede toda noite e descarta a resposta. O `BarLoader` registra o aviso (`barras de papel sem linha em instrument foram descartadas`,
  os 20 primeiros) para a causa não ficar invisível.
- **O que já foi liquidado não muda sozinho.** Barra que chega atrasada para um pregão já confirmado é gravada, mas o `eod` não pede a
  liquidação dele de novo (`SettlementPublisher.afterEod` não reabre o `job_run`). Reprocessar é decisão do admin pelo RUNBOOK.
  Observação honesta: a liquidação é refeita do zero a cada vez (ADR 0022), então a barra atrasada entra no resultado quando a **próxima
  liquidação regular** (a do pregão seguinte) recalcula a temporada; o `eod` nunca força isso.
- **A janela é de 5 pregões** (`WINDOW_SESSIONS`): o dia que falhou é recuperado na noite seguinte. O pedido de cada papel começa no
  pregão **mais antigo que lhe falta** na janela e vai até D; pedir 1 dia ou 5 custa a mesma requisição.
- **Obrigatório e opcional** (`quoteTargets`): o **obrigatório** é o universo da semana ISO de D, o BOVA11 (primeiro: é a sonda de
  "o dia saiu") e os papéis em posição de temporada `RUNNING` (precisam de marcação mesmo fora do universo, as posições da última
  liquidação); o **opcional** são os papéis das carteiras dos usuários (`portfolio_lot`) fora do obrigatório.
- **A conta da cota** (`bar-plan.spec.ts` monta o mês e falha acima do teto de 9.000, 60% da cota):

| Item | Conta | Requisições |
|---|---|---|
| Noites, o obrigatório | 21 pregões × 310 papéis (o universo de uns 306 mais o BOVA11 e as posições) | 6.510 |
| Novas tentativas dos papéis sem negócio | 3 × uns 195 papéis-noite (uns 9 por noite) | 585 |
| Carteiras dos usuários, o opcional | 21 × uns 20 papéis | 420 |
| Domingos | 4 × (1 da lista + uns 100 candidatos fora do conjunto diário) | 404 |
| **Um mês** | | **7.919** |
| Carga inicial (uma vez) | a lista, os 375 papéis que ela semeia e o BOVA11: 377 num banco novo (medidas na prova controlada); a do dev, em 04/11/2026, fez 373 (4 papéis já vinham da primeira passada) e gastou 369 de cota | 377 |
| **O primeiro mês** | | **8.296, de 15.000** |

O alvo do pedido era "umas 7.500 de 15.000": 310 × 21 = 6.510 mais uns 100 por semana × 4,3 = 430 dá 6.940, e a carga inicial leva a
uns 7.320 (377 medidas na prova controlada; eram 420 estimadas). A janela é móvel de 30 dias (seção 2), e a conta de um mês vale para
qualquer janela de 30 dias. Os extras (novas tentativas, carteiras) somam uns 1.000. A reserva de 500 sobra, e o teto do teste (9.000) deixa a folga
de uma noite com a brapi fora do ar. O pior caso das carteiras é todo ticker fora do universo (uns 140 papéis): +2.500 por mês,
ainda abaixo da cota.

- **Carga inicial: `market:backfill`.** 3 meses de barras de todo papel da lista da brapi mais o BOVA11 (377 requisições num banco
  novo; a do dev, em 04/11/2026, fez 373), **só inserção e retomável** (só a falta). Não publica
  `settle`. Aceita `--papeis`, `--de` e `--ate` (a prova controlada e a recuperação de um papel). **Modo sem rede** por padrão: mostra o
  banco de destino (servidor e nome, sem credencial) e quantas requisições faria; só busca de verdade com `--confirmo-banco <nome do
  banco mostrado>`. No fim mostra as requisições feitas e a cota restante informada pela brapi (só o número). A janela padrão começa
  3 meses de calendário antes do **dia da execução** mais 3 dias (`historyStart`, 86 a 89 dias): a brapi só aceita **90 dias entre
  `startDate` e `endDate`** (400 `DATE_WINDOW_EXCEEDED` acima, que não gasta cota) e não olha a idade do início. Quem passa `--de` e
  `--ate` mais de 90 dias afastados vê os papéis falharem (cinco seguidos encerram a passada). Procedimento no RUNBOOK.
- **A carga só confirma o pregão quando é completa.** O universo exige os 60 pregões confirmados, e um dia "confirmado" com a barra de
  poucos papéis o deixaria passar na conferência e congelar-se com buraco (e universo congelado não se refaz). Por isso o
  `confirmTradingDays` só roda numa carga **sem `--papeis`**, que **não parou** (cota, tempo ou queda), com o BOVA11 respondido e **no
  máximo 10%** dos papéis da carga sem resposta (`MISSING_ALERT_PERCENT`, a mesma conta do `eod`). A carga parcial grava as barras e avisa
  "Carga parcial: nenhum pregão foi confirmado"; a seguinte, que pede só a falta, confirma. O `eod` confirma por conta própria, ao concluir.
- ponytail: o papel com pregão sem negócio dentro da janela (buraco legítimo) volta a ser pedido a cada passada da carga manual, porque
  o banco não tem como saber que o buraco é legítimo. O teto é uma carga inteira (uns 380 pedidos, 2,5% da cota).

### 7. Mensagem `eod {pregão}`

1. Se o pregão não for dia de pregão (calendário), ignora.
2. Assume a mensagem em `job_run` (`eod` + pregão, único). Já concluída: não pede nada à brapi (só republica a liquidação do pregão, que
   o `job_run` do settle barra). Outra entrega trabalhando: falha com `JobBusyError` e a fila repete. `RUNNING` mais velho que a
   renovação da trava da fila (5 min), `FAILED` ou `WAITING` é reassumido por uma só entrega.
3. Monta o conjunto obrigatório e **pede só a falta**: cada papel que não tem a barra de D, do pregão mais antigo que lhe falta na
   janela até D, **um por vez e na ordem, o BOVA11 primeiro**. Cada papel é gravado assim que chega. Se a resposta do BOVA11 não traz a
   barra de D, o dia ainda não saiu na brapi (nenhum outro papel terá) e a passada acaba com **uma requisição só**. O orçamento de tempo
   (4 minutos, dentro dos 5 da trava da fila; vale também dentro de cada papel, seção 2) é dividido com o opcional.
4. **Conclusão.** D está completo quando todo papel do obrigatório tem a barra de D. Enquanto falta papel e o prazo não chegou, a mesma
   mensagem é publicada agendada para daqui a 60 minutos e a linha de `job_run` fica `WAITING` (o alerta de job falho não a conta); a
   nova tentativa pede **só o que falta**. No **prazo das 00:30** de Brasília (`planMissingFile`) o dia conclui com o que tem, registra a
   falta (a contagem e os 20 primeiros) e dispara o `eod-barras-ausentes` se faltar o BOVA11 ou mais de 10% do obrigatório
   (`MISSING_ALERT_PERCENT`).
5. **O papel sem negócio mantém as novas tentativas até o prazo.** A brapi não distingue "não negociou hoje" de "ainda não saiu" para
   aquele papel; um papel suspenso (ou ilíquido num dia sem negócio) mantém as novas tentativas de 22:30, 23:30 e 00:30, e só ele é
   pedido (uma requisição por tentativa). Consequência: **numa noite com algum papel sem negócio o dia conclui às 00:30, e não às
   21:40** (o que é o normal para um universo de uns 300 papéis). A liquidação e o site esperam até então. Se isso incomodar, a saída é
   concluir quando os faltantes todos "responderam sem a barra" com o BOVA11 presente; não foi feita, porque sem dado real não se sabe
   separar o papel sem negócio do que a brapi entrega com atraso.
6. **Concluiu:** o opcional é pedido **uma vez**, nesta tentativa, e não segura a conclusão (o que não vier hoje a janela de amanhã
   pede). Confirma como `BRAPI` os pregões da janela que têm barra e ainda não estavam confirmados, semeia o calendário futuro, e o
   `SettlementPublisher.afterEod` publica a liquidação **antes** de a linha concluir (uma publicação que falha repete o `eod`). Vão
   para a liquidação o pregão e os anteriores da janela que acabam de ser confirmados (a noite em que a brapi esteve fora), em ordem
   de data; a liquidação do mais novo refaz a temporada do zero, na mesma ordem. Sem nenhuma barra (a brapi fora a noite inteira),
   nada é confirmado nem liquidado: a mensagem conclui, o `eod-barras-ausentes` alerta e a noite seguinte recupera pela janela.
7. O `eod` não tem mais "reserva": há uma fonte só, e não existe barra provisória a trocar (`replaceProvisionalDays`,
   `datesWithBrapiBars` e o `reopen` que trocava barra da brapi pela do arquivo saíram).

### 8. Universo semanal (`universe {semana}`)

Regra do plano, sobre a semana ISO da mensagem: os **60 pregões antes da segunda-feira da semana**, confirmados (precisam estar todos
carregados, conferidos contra o calendário; senão a mensagem falha dizendo os dias que faltam e pedindo a carga inicial, e não congela
universo torto). O banco é consultado no intervalo da janela: com um buraco, o dia anterior à janela não entra no lugar do que falta.
Para cada ação (`kind = STOCK`, com as barras da brapi e o volume estimado):

- presença = pregões da janela com negócio; passa com **≥ 90%** (54 de 60, em inteiros);
- volume médio = soma do volume financeiro (estimado, seção 4) ÷ 60 (dia sem negócio conta zero);
- ordem por volume médio, do maior para o menor, desempate pelo ticker; **até 500**.

Grava `universe_snapshot` (semana única, janela, quantas negociaram, quantas passaram) e `universe_member` (posição, volume médio,
presença). É **congelado**: a semana já gravada só é reconhecida. Nenhuma ação passar nos filtros também falha.

**A atualização semanal, dentro do `universe` e antes de ele escolher** (`WeeklyRefresh`): sem ela um papel fora do conjunto diário
nunca teria barra, e o universo nunca o veria entrar.

1. Busca a lista de ações da brapi (`/api/quote/list?type=stock&limit=1000`, uma requisição) e **semeia o papel novo** em `instrument`
   (seção 3). Se a lista não vier (brapi fora, formato torto, páginas demais, tempo), o universo segue só com o que o banco tem.
2. O candidato **fora do conjunto diário** (universo da semana que acabou, BOVA11, posições e carteiras) que **não tem nenhuma barra nos
   3 meses** recebe os **3 meses** de barras (a partir do dia da execução). É o papel novo, ou o que a carga da semana anterior não
   trouxe: **o banco decide, e não "foi criado agora"**; se a carga de um papel novo falhou, na semana seguinte ele não é mais novo e ainda
   precisa do histórico. Um papel listado e suspenso, sem nenhuma barra, pede os 3 meses toda semana (no máximo uma requisição por
   papel por semana).
3. O candidato que tem barra mas **nenhuma dos 5 últimos pregões** recebe a semana. O conjunto diário não muda dentro da semana ISO,
   então o papel ou foi buscado a semana toda ou em dia nenhum; o buraco de um papel sem negócio não o pede de novo.
4. No fim, **os logos das ações** (seção 3a, ADR 0036): com a mesma lista, a passada reconfere os SVG guardados e baixa do icons.brapi.dev só
   o que falta, mudou de endereço ou tem mais de 30 dias, dos papéis que o banco tem. A falha dela vira um aviso e nunca derruba o universo.

A lista, as barras e os logos dividem **um** orçamento de tempo de 4 minutos (seção 2): a atualização passa às barras o que a lista deixou,
e aos logos o que as barras deixaram.

A falha aqui nunca derruba o universo (a cota baixa, a lista que não veio e um papel sem resposta deixam o candidato com menos
presença); só o erro de configuração (401, 402, 403) sobe. O `sched-universe` roda no domingo às 09:00 e publica a semana ISO **da
segunda-feira seguinte**. O comando `market:universe <semana>` escolhe sobre o que o banco já tem, **sem rede** e sem a atualização
semanal.

**O dev ainda não tem universo sobre as barras da brapi** (`universe_snapshot` vazio desde que o dev foi recriado, seção 1): o
`market:universe <semana>` o calcula, sem rede, quando os 60 pregões da janela estão confirmados (a carga de 04/11/2026 confirmou 60,
de 07/08 a 03/11; a janela de uma semana nova precisa dos pregões até a sexta anterior).

Os universos que existiam antes (W44 e W45) eram das barras do arquivo da B3, com a regra de então, e saíram com o dev recriado. A W45
(a de 02/11/2026, que abre num feriado), calculada em 03/11/2026, deu: janela de 60 pregões, de 06/08 a 30/10; 404 ações negociaram,
306 passaram na presença de 90%, 306 no universo. As dez primeiras, por volume financeiro médio por pregão: PETR4 (R$ 2,50 bi), VALE3
(1,82 bi), ITUB4 (1,46 bi), BBDC4 (1,07 bi), BPAC11 (1,05 bi), BBAS3 (1,00 bi), B3SA3 (0,99 bi), AXIA3 (0,93 bi), PETR3 (0,73 bi) e
SBSP3 (0,72 bi). Fica como ordem de grandeza (uns 300 papéis), não como resultado a reproduzir: o volume da brapi é estimado (seção 4).

### 9. Conferência com fonte independente

Conferido em 01/11/2026, **antes** de a brapi ser a fonte única, contra o gráfico diário do **Yahoo Finance**
(`https://query1.finance.yahoo.com/v8/finance/chart/<TICKER>.SA?range=5d&interval=1d`, uma consulta por papel) e, para PETR4, VALE3 e
ITUB4, contra a **brapi** (`/api/v2/stocks/historical`, `startDate=endDate=2026-10-30`, sem token, que só atende esses papéis de teste).
Pregão de 30/10/2026:

| Papel | Abertura | Máxima | Mínima | Fechamento | Quantidade negociada | Fontes |
|---|--:|--:|--:|--:|--:|---|
| PETR4 | 52,45 | 53,66 | 52,36 | 52,71 | 61.743.200 | Yahoo, brapi |
| VALE3 | 59,44 | 62,98 | 59,42 | 62,02 | 34.856.400 | Yahoo, brapi |
| ITUB4 | 39,20 | 39,34 | 38,69 | 38,69 | 51.157.200 | Yahoo, brapi |
| BBDC4 | 14,00 | 14,18 | 13,81 | 13,86 | 86.702.200 | Yahoo |
| WEGE3 | 49,00 | 49,66 | 48,36 | 48,36 | 16.840.900 | Yahoo |

Abertura, máxima, mínima, fechamento e quantidade foram **iguais** nas fontes, nos cinco papéis, e iguais às do arquivo da B3 de então
(o `VOLTOT ÷ QUATOT` do arquivo bateu com o preço médio dele, com diferença de até 0,017%). O volume estimado (quantidade × fechamento)
contra o volume financeiro do arquivo daquele pregão: PETR4 R$ 3.254.484.072 contra R$ 3.265.521.701 (-0,34%), VALE3 R$ 2.161.793.928
contra R$ 2.153.151.338 (+0,40%), ITUB4 R$ 1.979.272.068 contra R$ 1.991.804.592 (-0,63%), BBDC4 R$ 1.201.692.492 contra
R$ 1.209.607.602 (-0,65%) e WEGE3 R$ 814.425.924 contra R$ 822.028.790 (-0,92%): menos de 1% nos cinco, o que muda o volume médio
de um papel mas não a ordem de quem está longe da vizinhança.
**Não conferido:** o volume estimado contra uma fonte que informe volume financeiro em papel menos líquido e qualquer papel fora desses
cinco (a prova de 04/11/2026, abaixo, só reconferiu a WEGE3 de 30/10, que bateu com a tabela). **Nenhum teste chama a brapi de
verdade:** os testes usam um `fetch` falso no formato dos docs (`ensaio/fake-brapi.ts`, corrigido pelo que a prova mediu); a única
chamada real da onda foi a prova controlada do integrador, abaixo.

**Prova controlada de 04/11/2026** (10 requisições de 10 permitidas, entre 01:08 e 01:14, no plano gratuito, num banco descartável
`alvesting_brapi_test` criado com as 19 migrations e apagado no fim; o token só no `Authorization`, e nunca em saída). Foi feita pelo
código de verdade (o `BrapiClient` e o `MarketRepository` dos jobs; só o disparo é a linha de comando), com um contador que
barrava a 11ª requisição:

| # | O que | Resultado |
|---|---|---|
| 1 a 3 | `market:backfill --papeis WEGE3,ABEV3,BOVA11 --de 2026-10-27 --ate 2026-11-03` | 200 nos três; 15 barras gravadas (5 pregões cada: 27, 28, 29 e 30/10 e 03/11, porque 02/11 foi feriado); 0,7 s no total; nenhum pregão confirmado (carga parcial, por desenho) |
| 4 | `market:backfill --papeis WEGE3` na janela padrão (07/08 a 03/11, 60 pregões, 88 dias) | 200 com 60 barras; 55 gravadas, e as 5 que já estavam voltaram idênticas (nenhuma `barras-divergentes`); 485 ms |
| 5 e 9 | a lista (`/api/quote/list`), pelo `listStocks` | 200; 785 ações em uma página; 375 sementes; 241 e 101 ms |
| 6 | BOVA11, um dia só (03/08, 93 dias atrás) | 200 com a barra |
| 7 | BOVA11, de 02/02 a 03/11 (274 dias) | 400 `DATE_WINDOW_EXCEEDED`; 538 ms |
| 8 | `ZZZZ3`, um papel que não existe | 404 `NOT_FOUND`; 316 ms |
| 10 | BOVA11, de 03/11 a 04/11 (o fim é hoje, antes do pregão) | 200, só com a barra de 03/11 |

A cota: a primeira resposta trouxe 14.998 (havia 1 requisição anterior na janela, então a cota antes da prova era 14.999) e a última,
14.993. Gastaram 6, as seis respostas 200 do histórico (1, 2, 3, 4, 6 e 10); as duas listas, o 400 e o 404 não gastaram.

O que a prova decidiu, item a item (as suposições que o código fazia e que o fake repetia):

1. **`date` é 03:00 UTC (meia-noite de Brasília)?** Sim, nas 77 barras. A suposição estava certa.
2. **O limite do histórico.** A suposição estava errada em dois pontos: o código de erro é `DATE_WINDOW_EXCEEDED` (e não
   `INVALID_RANGE`), e o limite é o **tamanho** do período (no máximo 90 dias entre `startDate` e `endDate`), e não a idade do início.
   88 dias passaram, 274 não, e um pedido de um dia, 93 dias atrás, passou. O limite exato (89 ou 90) não foi medido; o
   `historyStart` pede 86 a 89 dias. O `fake-brapi.ts` e o teste do `historyStart` foram corrigidos.
3. **O fechamento ajustado.** `close` difere de `adjustedClose` em 30 das 60 barras da WEGE3: o OHLC não vem ajustado por provento
   (seção 4). Desdobramento e grupamento não foram medidos.
4. **A latência.** 101 a 538 ms (média de 265 ms nas respostas 200 do histórico): 310 papéis levam uns 82 s, e o orçamento de 4
   minutos tem folga de quase 3 vezes (seção 2).
5. **A lista.** `limit=1000` aceito, uma página (`totalPages` 1, `totalCount` 785, `hasNextPage` falso), `subType` `stock` ou `unit`
   e nunca nulo, 375 sementes. **Um erro do cliente apareceu aqui:** a resposta da lista traz `RateLimit-Remaining` 20 (um limitador de
   20 por minuto, fora da cota), e o cliente a lia como a cota, o que pararia a lista na 2ª página por "cota baixa" (a reserva é 500).
   A primeira correção (só a resposta do histórico alimenta a cota restante) **não bastava**: a carga do dev, abaixo, mostrou que o
   próprio histórico às vezes vem por esse limitador. A correção de agora lê só o `X-RateLimit-Remaining` (seção 2; testes novos em
   `brapi.client.spec.ts`). Trocar para o `/api/v2/tickers` não foi avaliado, porque o v1 funcionou; a ADR 0032 mantém a escolha.
6. **Papel sem negócio ou suspenso.** Não medido: todo papel da lista tinha volume no último pregão, e não havia um suspenso para
   pedir. O papel que a brapi não conhece é 404 `NOT_FOUND`, sem gastar cota. Segue em aberto se o 404 é comum no `eod` (seção 2) e se
   vale a saída "concluir quando só os sem negócio faltam" (seção 7, item 5).
7. **Os cabeçalhos de cota.** `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `X-RateLimit-Limit`,
   `X-RateLimit-Remaining` e `X-RateLimit-Window: rolling-30d`: a janela é **móvel de 30 dias**, e não o ciclo mensal que o FAQ
   descrevia (seção 2). O par sem `X` é "o limitador que serviu a resposta", e só o par com `X` é a cota: a carga do dev, abaixo,
   mostrou a diferença. `symbol` igual ao pedido e `changed = false` nos três papéis.

**Não visto:** 429, 5xx e timeout (o tratamento é o dos docs, coberto por teste com fake); o horário em que a barra do dia D passa a
existir na brapi (a prova rodou depois da meia-noite, e a de 03/11 já estava lá à 01:08 do dia 04; `X-Plan-Data-Freshness: 1800s` diz
que o dado tem até 30 minutos); papel suspenso; desdobramento e grupamento; o limite exato de 89 ou 90 dias; e o `limit` máximo da
lista. A primeira noite de produção é quem mede o horário. Os números acima são contagens e formas, não cotações: nada da resposta
ficou no repositório.

**Segunda prova real: a carga inicial do dev (04/11/2026).** O `market:backfill` de 3 meses, com `--confirmo-banco`, no `alvesting_dev`
recém-recriado (seção 1), rodado pelo orquestrador da onda, com o token só no `Authorization` e nenhum valor da resposta guardado fora
do banco. Foi a primeira carga completa contra a brapi de verdade (a prova controlada tinha 10 requisições):

| O que | Resultado |
|---|---|
| Primeira passada, com o cliente que lia o `RateLimit-Remaining` | Gravou 240 barras de 4 papéis e **parou na 5ª requisição por "cota baixa"** (reserva de 500), com o sinal `brapi-cota-baixa` por engano |
| A causa | Uma resposta 200 do histórico (PETR4) veio pelo **limitador de 20 por minuto**: `RateLimit-Limit 20`, `RateLimit-Remaining 20`, `RateLimit-Reset 60`, sem nenhum `X-RateLimit-*`, e **não gastou cota** (a cota foi de 14.989, na resposta do BOVA11, para 14.988, na do BBDC4 logo depois) |
| A correção | Ler só o `X-RateLimit-Remaining` (seção 2). Teste novo em `brapi.client.spec.ts` com os cabeçalhos reais, fixtures do spec com `x-ratelimit-remaining` e a brapi falsa do ensaio mandando os dois pares. Mutação: com o cabeçalho antigo, 6 testes falham, o novo inclusive |
| Carga com a correção | 372 papéis com barra faltando; **373 requisições** (a lista e 372 históricos); **19.789 barras** gravadas; **60 pregões** confirmados; 74,4 s |
| Cota | De 14.988 para 14.619: **369 gastas** (372 históricos menos 3 que vieram pelo limitador de 20 por minuto e não gastaram) |
| Fechamento diferente do ajustado | 114 avisos (papel e quantidade, nunca preço; seção 4) |
| Estado final do dev | **20.029 barras `BRAPI`** (as 240 da primeira passada e as 19.789 da segunda) de **376 papéis** (375 ações e o BOVA11), de 2026-08-07 a 2026-11-03; 60 pregões confirmados; nenhum ISIN; 93 papéis com menos de 60 barras (não negociaram todo dia); `count(*)` 20.029 e `sum(close_cents)` 36.505.401 em `daily_bar` |

O que ela decidiu: (1) o cabeçalho da cota, acima; (2) **a latência de requisições seguidas**, que a prova controlada não via: 74,4 s para
373 pedidos (uns 0,2 s cada, contando a gravação), então uns 62 s para os 310 papéis de uma noite, contra o orçamento de 240 s; (3) a
conta da cota se confirma: a carga gastou 369 dos 15.000 (seção 6); (4) o risco que a prova controlada deixou em aberto, os papéis do
arquivo antigo fora da lista, que a brapi poderia recusar com 404 e deixar a carga "parcial" para sempre (acima de 10% dos papéis),
**deixou de existir**: o dev recriado só tem papel que veio da lista. Continua sem medida a noite real (papéis sem negócio, novas
tentativas e carteiras): os 7.919 pedidos por mês seguem sendo conta, não medida.

### 10. Termos de uso da B3 e por que o COTAHIST saiu

A página das cotações históricas (lida em 01/11/2026) diz: "Os dados e informações disponibilizados nesta página são de propriedade
exclusiva da B3 e destinam-se estritamente à consulta informativa" e "Para manutenção da segurança do site e integridade dos dados e
informações disponibilizados, é expressamente vedada a coleta automatizada, inclusive por meio de ferramentas de inteligência
artificial, para quaisquer finalidades, comerciais ou não, próprias ou de terceiros". Os Termos e Condições de Uso
(`https://www.b3.com.br/pt_br/termos-de-uso-e-protecao-de-dados/termos-de-uso/`) dizem que os dados podem ser usados "para uso
exclusivamente pessoal" e que "não é permitida a reprodução, modificação, transmissão, comercialização, locação, publicação,
distribuição ou quaisquer outras formas de utilização para fins comerciais [...] sem autorização prévia e por escrito da B3".

O plano original (ADR 0009) baixava o COTAHIST todo dia por job e mostrava preços numa página pública: isso entrava em conflito com o
texto acima. **Em 03/11/2026 o Artur escolheu a brapi** (a ADR 0032 supera a 0009): nada mais se baixa da B3 (nem arquivo, nem
página). A lista de feriados é a única informação da B3 que o repositório guarda, e é um fato escrito à mão. A brapi, por sua vez,
veda entregar os Dados a terceiros como feed, API ou base bruta (seção 2): a cotação bruta saiu da API pública e o site a lê por uma
rota interna com segredo (ADR 0033; `docs/API.md`, seção 6). A conformidade com a licença da brapi (o que sobra: os registros da
arena e a carteira privada, com o risco residual do ADR 0033) segue no checklist do plano (5.16), para o Artur e o orientador.
Em 04/11/2026, por decisão do Artur, o que a B3 tinha deixado no disco e no banco foi apagado (seção 1): os arquivos, as barras, os
universos e, do schema, o valor e as colunas que só existiam para o arquivo.

### 11. Decisões

| Decisão | Motivo |
|---|---|
| A brapi é a fonte única; o COTAHIST saiu (ADR 0032, supera a 0009) | Os termos da B3 vedam a coleta automatizada, inclusive por IA; a licença da brapi deixa guardar, persistir e montar séries |
| O banco é o cache: cada barra é pedida uma vez | 15 mil requisições por mês, uma ação por requisição: só a falta vai à brapi |
| A data da barra tem uma forma só (meia-noite de Brasília); o que difere é descartado com aviso | `daily_bar` é só inserção: um dia errado por um dia ficaria para sempre. A doc não diz a hora; a prova controlada de 04/11/2026 confirmou 03:00 UTC nas 77 barras |
| A cota restante vem só do `X-RateLimit-Remaining` | O `RateLimit-Remaining` sem o `X` é do limitador que serviu a resposta: a lista e, às vezes, o próprio histórico vêm pelo de 20 por minuto, que não gasta cota. O "20" lido como cota parou a carga do dev na 5ª requisição por "cota baixa" (achados da prova controlada e da carga do dev, de 04/11/2026) |
| A janela do pedido tem no máximo 90 dias (`historyStart`: 86 a 89) | A brapi recusa mais que isso com 400 `DATE_WINDOW_EXCEEDED` e não olha a idade do início (prova controlada) |
| O orçamento de tempo vale dentro de um papel e para a lista | A trava da fila é de 5 minutos; passar dela deixa outra entrega refazer as requisições |
| A carga manual só confirma o pregão quando é completa | Pregão confirmado com a barra de um papel deixaria o universo congelar-se com buraco |
| Preço ou volume fora da escala vira falta do dia | O `INSERT` que estoura derrubaria o lote do papel toda noite, até o dado do provedor mudar |
| Só inserção; barra gravada nunca é sobrescrita; valor diferente vira `barras-divergentes` | O que foi liquidado não pode mudar por uma busca; correção é pelo evento corporativo do admin |
| O que já foi liquidado não muda sozinho | O `eod` não reabre `settle`; reprocessar é decisão do admin (RUNBOOK) |
| Janela de 5 pregões, pedido do mais antigo que falta até D | O dia que falhou é recuperado na noite seguinte, sem custar mais requisição |
| BOVA11 primeiro e como sonda de "o dia saiu" | Se ele não tem a barra de D, nenhum outro papel terá: a passada custa 1 requisição |
| O dia só conclui com o obrigatório inteiro, ou no prazo das 00:30 | Um papel que a brapi demora a entregar tem até 3 horas; o que falta é registrado, e o alerta só dispara acima de 10% ou sem o BOVA11 |
| Opcional (carteiras) pedido uma vez, na tentativa que conclui | O papel de um usuário não pode segurar a liquidação da arena |
| Pausa nas 5 falhas seguidas, 429 com `Retry-After` e teto, 5xx repetido uma vez | Brapi fora do ar não gasta 2 requisições em cada um dos 300 papéis; o limite simultâneo (1) vira espera, não falha |
| Reserva de 500 requisições | Não zerar a conta: sobra para a recuperação à mão |
| Uma requisição por vez por trava consultiva do Postgres | O plano gratuito só aceita 1 simultânea na conta, e há réplicas do worker e a carga manual |
| `trading_day.source = BRAPI` só com barra gravada | Dia "confirmado" sem dado seria contado pelo universo |
| O volume do universo é estimado (quantidade × fechamento) | A brapi informa a quantidade, não o volume em reais; menos de 1% de diferença nos cinco papéis conferidos (seção 9) |
| O legado do COTAHIST saiu do schema e do código (04/11/2026) | Sem produção nem dado legado, e o dev recriado do zero: o valor dos enums, `cotahist_sha256`, `quote_factor` e `daily_bar.trades` saíram numa migration não aditiva, exceção registrada na ADR 0032, com guarda que recusa se sobrar dado |
| A atualização semanal fica dentro do `universe` | O mínimo que funciona: lista, papel novo e a semana dos candidatos, antes de escolher |
| Os logos das ações são uma cópia própria dos SVG do icons.brapi.dev, no banco (ADR 0036) | O visitante não fala com a brapi; o SVG passa pelo validador antes de entrar, e o site o serve do próprio domínio |
| Só o endereço exato do icons.brapi.dev vale, e o ícone padrão (`BRAPI.svg`) é sem logo | O job baixa desse endereço: nada de outro host, porta, query ou caminho; o ícone padrão (31 das 783 ações na prova de 05/11/2026) não é o logo da empresa |
| A passada reconfere os SVG guardados e apaga o que o validador de hoje recusa | A tabela só guarda o que passa na regra de hoje, e as rotas internas leem o banco como está (a lista e o SVG nunca discordam) |
| O mesmo SHA-256 não regrava o SVG; mais de 30 dias pede de novo | O logo muda pouco: uma semana comum não pede nada, e o que mudou entra em até 30 dias |
| `trading_day` `CALENDAR` é previsão, não fonte de leitura | A lista muda (2027 é provisório) e a linha não acompanha. Ver seção 5 |
| `CHECK` no banco e índice na FK de `universe_member` | Rede de segurança para a brapi; migration só aditiva (o `CHECK` de `daily_bar` foi refeito sem a coluna `trades` em 04/11/2026) |
| Universo vazio ou janela incompleta falham | Universo é congelado por semana: um errado não tem como ser refeito |
| `--skipApiVersionCheck` no Azurite do `docker-compose.yml` | O `@azure/storage-blob` 12.34.0 pede a API 2026-10-06 e o Azurite 3.37.0 a recusa |
| O `yauzl` fica | A CVM também lê ZIP em fluxo (`infrastructure/zip/zip-reader.ts`) |

### 12. Variáveis de ambiente

| Variável | Onde | Para quê |
|---|---|---|
| `SERVICEBUS_FQDN` | Azure (a infra injeta) | Service Bus pelo namespace, com `DefaultAzureCredential` (`AZURE_CLIENT_ID` escolhe a identidade). A connection string, se existir, vence |
| `STORAGE_BLOB_ENDPOINT` | Azure (a infra injeta) | Blob pelo endereço da conta, com `DefaultAzureCredential` (briefing, IO das LLMs e backup; as cotações não vão ao Blob) |
| `STORAGE_CONNECTION_STRING` | dev e CI | Blob do Azurite (`.env.example`). **Nova**: a infra não define |
| `BRAPI_TOKEN` | Azure (segredo `brapi-token`, só o worker-data) | Token da brapi, enviado só em `Authorization` (sem redirecionamento: o `fetch` do cliente usa `redirect: 'error'`). Aparado nas pontas, e um `Secret` como os outros (não aparece em JSON, `inspect` nem template, e sai do `process.env` depois do parse). `PENDENTE` vale como ausente: o `eod`, a atualização semanal e o `market:backfill` recusam |

## Notícias, macro e briefing (etapa 5)

Código em `apps/api/src/modules/news` e `apps/api/src/modules/briefing` (`domain`, `application`, `infrastructure`). O
worker-data consome a fila `news` (mensagem `fetch {fonte, slot}`, **uma por fonte**) e a fila `briefing` (mensagem
`freeze {pregão}`). O `sched-news` (a cada 30 minutos, todo dia) e o `sched-briefing` (07:30 de Brasília, só em pregão)
apenas publicam, com `MessageId` determinístico (`fetch:infomoney:2026-11-01T17:30:00Z`, `freeze:2026-10-30`).

> **Os resultados "no banco de dev" desta parte** (a ligação do CNPJ pelo FCA, o universo da semana 2026-W44, o briefing congelado de
> 30/10) foram medidos em 01/11/2026 no dev de então. O dev foi **recriado do zero em 04/11/2026** (seção 1), e esses dados não estão
> mais lá (`instrument.cnpj` vazio, sem universo, sem briefing): ficam como registro do que foi medido, não como o estado de hoje. Os
> comandos "para refazer" valem para a semana do pregão em que se refaz, depois da carga e com os 60 pregões da janela confirmados.

### 13. Feeds RSS

A lista é fixa em `domain/sources.ts`. Nenhuma URL vem de mensagem, de banco ou de ambiente.

| Id (`source`) | Nome | Feed | Itens por busca |
|---|---|---|---|
| `infomoney` | InfoMoney | `https://www.infomoney.com.br/feed/` | 10 (cobrem 1,9 h num domingo) |
| `money-times` | Money Times | `https://www.moneytimes.com.br/mercados/feed/` | 10 (cobrem 40 h) |
| `seu-dinheiro` | Seu Dinheiro | `https://www.seudinheiro.com/feed/` | 10 (cobrem 29 h) |
| `agencia-brasil` | Agência Brasil | `https://agenciabrasil.ebc.com.br/rss/economia/feed.xml` | 10 (cobrem 32 h) |

Treze candidatos foram conferidos em 01/11/2026 (resposta, tipo do conteúdo, codificação, formato da data de publicação).
Ficaram os quatro que são RSS 2.0 em UTF-8, com data com fuso e conteúdo de mercado. Os rejeitados e o motivo estão em
`docs/DEPENDENCIAS.md`, "Diferenças em relação ao plano". Cada um dos quatro, buscado de verdade pelo código em
01/11/2026 (`news:fetch`), devolveu 10 itens, 10 aproveitáveis e 10 gravados.

**O que fica guardado**, por item: título (até 300 caracteres), fonte, hora de publicação, link normalizado e um trecho de
até 300 caracteres (o `description` do feed; o corpo inteiro, `content:encoded`, não é lido). A página pública (etapa 9)
mostra **só título, fonte e link**. O trecho é privado e **só vai para o briefing quando os termos da fonte deixam**: hoje,
a Agência Brasil e a CVM. InfoMoney, Money Times e Seu Dinheiro levam ao briefing só título, fonte, hora e tickers (veja
os termos abaixo); o trecho deles fica guardado no banco, e a decisão volta a ser do código com uma linha.

**Tickers.** Procura-se o padrão de ticker da B3 (quatro caracteres, o primeiro uma letra, mais um ou dois dígitos:
`PETR4`, `B3SA3`, `BPAC11`) no título e no trecho **guardados**, só em maiúsculas e isolado de letra, dígito ou `_`
colados (`PETR4F` e `XPETR4` não contam), e só vale se for um instrumento conhecido (etapa 4). Nome de empresa não
vira ticker ("Petrobras" não é `PETR4`).

**Duplicata.** `news_item.url_hash` é único: SHA-256 da URL normalizada (minúsculas no esquema e no host, sem porta
padrão, sem fragmento, sem `utm_*`, `fbclid`, `gclid` e afins, parâmetros em ordem, sem barra final). Só `http` e `https`
passam, sem usuário e senha: a URL vira link na página pública. A mesma matéria buscada de novo (outro slot, outro
feed) não duplica, e a primeira hora em que foi vista não muda.

**Hora.** A data do feed só vale com fuso explícito (`+0000`, `-0300`, `GMT`, `Z`). Sem fuso (Investing.com, Exame) é
descartada, porque o fuso do servidor mudaria de máquina para máquina; vale então a hora da busca. Data no futuro
(relógio do feed errado) também vale a hora da busca: nenhuma fonte publica depois de ser vista.

**Termos de uso (lidos em 01/11/2026).**

| Fonte | O que o site diz | Efeito aqui |
|---|---|---|
| InfoMoney | Não há página de termos: o rodapé só tem política de privacidade e de cookies. "© 2000-2026 InfoMoney" | Tratado como todos os direitos reservados. Sem autorização |
| Money Times | Termos de Uso, item (xv): "Não reproduzir e/ou distribuir por quaisquer meios, no todo ou em parte, a qualquer terceiro, sem prévia e expressa autorização do MONEY TIMES, quaisquer dos conteúdos disponibilizados no Site" | **Veda**, sem autorização escrita |
| Seu Dinheiro | O mesmo item (xv), com "SEU DINHEIRO" | **Veda**, sem autorização escrita |
| Agência Brasil (EBC) | Termos de Uso da EBC: "Reprodução autorizada mediante indicação da fonte" e o portal é para "finalidades de uso pessoal, sem intuito comercial ou lucrativo" | Autorizada com a fonte; o projeto é acadêmico e sem receita |

**Risco, para o Artur e o orientador decidirem** (do mesmo tipo do da B3, seção 10): três dos quatro sites não
autorizam reproduzir o conteúdo a terceiros, e o trecho de até 300 caracteres iria para o provedor da LLM (OpenRouter,
Azure OpenAI) dentro do briefing. O uso seria de excerto curto do próprio RSS, que o site publica para ser lido por
programa, com a fonte e o link, em trabalho acadêmico. Isso é interpretação, não autorização.

**Padrão seguro, já no código** (revisão de segurança): `allowExcerpt` em `domain/sources.ts` é `false` para InfoMoney,
Money Times e Seu Dinheiro e `true` para a Agência Brasil, e a montagem do briefing esvazia o trecho de quem não autoriza
(fonte que saiu da lista também: ninguém sabe mais o que os termos dela dizem). O que vai ao provedor da LLM desses três é
título, fonte, hora e tickers; o título e o link são usados como um agregador usa, e o link aparece sempre com a fonte.
Liberar um deles é trocar um `false` por `true`, depois de autorização por escrito, e vale para o briefing seguinte, sem
rebuscar nada. Saídas para o Artur: pedir autorização por escrito, ficar só com a Agência Brasil e a CVM, ou manter assim
(só o título). A escolha vai para o plano, seções 5.15 e 5.16.

**robots.txt (lido em 01/11/2026, uma vez, no fechamento da etapa).** Nenhum dos caminhos buscados é proibido: InfoMoney e Seu
Dinheiro têm `Disallow` vazio, o Money Times só proíbe `/wp-admin/`, as buscas e dois artigos, a Agência Brasil só os
diretórios do sistema (`/includes/`, `/modules/`...) e a CVM só `/api/`, `/revision/` e páginas de conjunto (os arquivos são
`/dados/CIA_ABERTA/DOC/...`). A Agência Brasil e a CVM declaram `Crawl-delay: 10`, e a `api.bcb.gov.br` não tem `robots.txt`
(404). **Decisão registrada:** cada feed é pedido uma vez a cada 30 minutos, um arquivo por vez (nenhum link do feed é
seguido); na CVM são dois arquivos em seguida (FCA e IPE), quase sempre dois 304 de poucos bytes, e no BCB até cinco chamadas
em seguida, só quando falta dado. Não há espera de 10 s entre as duas buscas da CVM. O `Crawl-delay` é diretiva de
rastreador, e o pedido aqui é de um arquivo de dado aberto por 30 minutos, com um `User-Agent` que diz o que somos; se a CVM
ou a EBC pedir, a espera entra em `cvm-fetcher.ts`.

### 14. CVM (IPE e FCA): o fato relevante no ticker certo

Dois arquivos anuais dos dados abertos da CVM (licença ODbL, informada na página de cada conjunto), ambos ZIP, CSV
separado por ponto e vírgula, em latin1, com CRLF e uma aspa solta no meio de campo aqui e ali ("classe "C""). **Atribuição:**
a ODbL exige indicar a fonte de quem usa publicamente um trabalho feito com a base. A página pública (etapa 9) mostra título,
fonte e link de documentos da CVM, e leva o aviso **"Contém dados da CVM, licença ODbL"** no rodapé de toda tela (item do checklist da etapa 9, feito: `docs/TELAS.md`, seção 1).

- **IPE**, `ipe_cia_aberta_<AAAA>.zip` (um CSV): os documentos que as companhias entregam. Colunas usadas:
  `CNPJ_Companhia`, `Nome_Companhia`, `Categoria`, `Tipo`, `Assunto`, `Data_Entrega` e `Link_Download`. Em 01/11/2026:
  38.317 linhas, 2.105 fatos relevantes e 4.789 comunicados ao mercado.
- **FCA**, `fca_cia_aberta_<AAAA>.zip` (dez CSV): o formulário cadastral. Usa-se `fca_cia_aberta_valor_mobiliario_<AAAA>.csv`
  (965 linhas): `CNPJ_Companhia` e `Codigo_Negociacao`.

O IPE traz o CNPJ, não o ticker. O ticker sai de três passos, **nesta ordem**, só para os instrumentos conhecidos da etapa 4
(`buildTickerCnpj`, em `domain/cvm.ts`):

1. o código que o FCA cita para o CNPJ (`PETR3` e `PETR4` para a Petrobras). Código que o FCA atribui a dois CNPJ é
   ambíguo e fica sem. O campo vem com "NÃO HÁ", "N/A", "000000", "tgma3" (minúsculo) e até "PETR3, PETR4": só vale o que
   tem o formato de ticker depois de maiúsculas (481 das 965 linhas, 468 códigos);
2. as outras séries da mesma companhia, pela raiz de quatro letras: o FCA lista a unit `KLBN11`, e `KLBN3` e `KLBN4`
   herdam o CNPJ. Raiz que o FCA atribui a dois CNPJ não herda (não há caso em 2026);
3. as lacunas conhecidas do cadastro, uma lista curada de cinco companhias com o CNPJ conferido no IPE (`FCA_GAPS`): BTG
   Pactual (o FCA cita "000000"; `BPAC3`, `BPAC5` e `BPAC11`, a sétima em volume no universo de 2026-W44), CSN (`CSNA3`), Marfrig/MBRF
   (`MBRF3`), CSN Mineração (`CMIN3`) e Equatorial Pará (`EQPA3`). Se o FCA passar a citar o código, vale o FCA.

O resultado vai para `instrument.cnpj` (coluna nova, 14 dígitos). **Documento da CVM vai para o ticker pelo CNPJ e só por
ele**: o assunto de uma companhia pode citar outra, e o texto não marca ticker nenhum. Documento de companhia sem
instrumento conhecido não vira notícia.

**O que entra.** Só `Fato Relevante` e `Comunicado ao Mercado` (assembleia, demonstração financeira e reunião da
administração são 80% das linhas e não mudam o preço do dia seguinte), entregues nos **últimos 7 dias** (a janela cobre
uns dias sem o worker; o que já entrou não entra de novo). Título: `<categoria>: <companhia> - <assunto>`; trecho: o tipo
do comunicado, menos o genérico "Outros Comunicados...". A CVM informa só o dia da entrega: a hora é meia-noite de
Brasília. O texto não tem o corpo do documento, só os metadados (a CVM não o publica no arquivo).

**Busca condicional.** Os dois ZIP são refeitos uma vez por dia (Last-Modified do IPE em 01/11/2026: 10:00:17 GMT, ou
07:00 em Brasília; o do FCA, 10:12:46 GMT), apesar de a página do conjunto dizer "Periodicidade de atualização:
Semanal". Cada busca manda `If-None-Match` e `If-Modified-Since` com o que guardou em `fetch_state`; conferido com o
servidor de verdade: **HTTP 304**, e a segunda busca do dia não baixa nem lê nada. O 304 só anda `fetch_state.checked_at`: a
coluna diz "última checagem" (o painel da etapa 10 lê daqui), e os validadores continuam os da última carga. O validador de
cada arquivo só é guardado **depois de ele ser processado por inteiro**, e o do FCA por último, depois do IPE: uma falha no
meio faz a próxima busca ler de novo. Quando o FCA vem de novo (arquivo novo), o IPE é lido **sem condição**, mesmo com o ETag
igual, porque um documento antes sem ticker pode ter passado a ter. Isso não vive na memória do processo: como o validador do
FCA só vai depois do IPE, a repetição de uma busca que falhou no meio lê o FCA e o IPE de novo, com o mapeamento já aplicado.
Na virada do ano a janela cruza dois arquivos (o de 2026 e o de 2027), e o do ano novo pode faltar (404), ou vir vazio ou só
com outras categorias, até meados de janeiro (espera, sem erro); no resto do ano a falta é erro.

**Arquivo que mudou de formato não passa por "processado".** Antes da primeira linha o leitor confere o cabeçalho (as sete
colunas do IPE e as duas do FCA que o código lê) e falha dizendo quais faltam, sem repetir o conteúdo do arquivo. Um IPE em
que **nenhuma** linha é fato relevante ou comunicado ao mercado também falha (o valor de `Categoria`, o formato da data ou o
link mudou): um IPE de ano inteiro tem milhares. Nos dois casos o ETag não é guardado, e a fila repete. Tetos do que vem da
rede: 200 mil linhas no IPE e 5 mil documentos na janela de 7 dias (hoje 38 mil e uns 130), porque cada documento guardado
custa uns 0,8 KB de heap e o worker tem 1 GiB. O log leva só números (`year`, `rows`, `accepted`, `inWindow`).

Ambiente novo, sem nenhum instrumento (a carga inicial da brapi ainda não rodou), não tem a que ligar um CNPJ: a busca espera
com um aviso, sem baixar nada e sem guardar validador, para os arquivos do dia ainda serem lidos quando o `market:backfill` ou a
atualização semanal criar os instrumentos.

**Conferido uma vez com os arquivos reais** (em `.data/cvm/`, fora do git; `cvm-real-files.spec.ts`, só com `REAL_DATA_TESTS=1`, pulado sem isso e sem eles; os
números esperados vieram do módulo `csv` do Python, independente do `csv-parse` do código): o leitor acha as mesmas
38.317 linhas do IPE (2.105 e 4.789 por categoria) e as 965 do FCA; a janela de 25/10 a 01/11 tem **133 documentos**; o fato
relevante "Relatório de Produção e Vendas 3T26" da Petrobras (28/10/2026) fica em **`PETR3` e `PETR4`**, os dois
comunicados "Notícia divulgada na mídia" e "Petrobras conclui perfuração com mais uma descoberta" também, os da Dexco em
`DXCO3`, a unit `KLBN11` leva `KLBN3` e `KLBN4`, e a lacuna do BTG leva `BPAC11` e `BPAC3`. O assunto da CVM traz um
caractere de controle (BEL) em linhas de assembleia, e ele não chega ao título. Os cabeçalhos reais têm as sete colunas do IPE
e as duas do FCA que o leitor exige (o mesmo teste passa a ler os dois arquivos com a conferência de cabeçalho ligada).

**No banco de dev (01/11/2026, busca de verdade):** 408 dos 435 instrumentos ganharam CNPJ; do universo da semana
2026-W44, 298 dos 305; 133 documentos na janela, 116 com ticker conhecido e gravados (85 com um ticker, 15 com dois, 13
com três e 3 com quatro). Ficam **sem CNPJ** sete do universo, todos pequenos (posições 146 a 305): `OBTC3`, `AMAR3`,
`WDCN3`, `HAGA4`, `LUXM4`, `EPAR3` e `NORD3`. A segunda busca: 304, nada lido.

**Limite da fonte, para o Artur saber.** Os dados abertos da CVM não são tempo real, e o atraso é **sistemático**, não
eventual. O IPE é refeito às 07:00 de Brasília (Last-Modified de 01/11/2026: 10:00:17 GMT) e passa por um CDN com
`Cache-Control: public, max-age=14400`, que pode servir a cópia velha por até 4 h. A busca das 07:00 corre 17 segundos antes
de o arquivo ser refeito, e a das 07:30 corre depois do corte do briefing (07:30:00). Então a busca que vê o arquivo novo é a
das 07:30 em diante, e o documento só entra no briefing do pregão seguinte àquele dia. Na prática: **o fato relevante entra
dois pregões depois de ser entregue, ou um, se foi entregue na sexta ou no fim de semana** (entregue na terça à tarde, está
no arquivo de quarta de manhã, é visto na quarta depois das 07:30 e vai no briefing de quinta). É igual para todos os
modelos, mas é um atraso de um a dois pregões nos fatos relevantes, e pode pesar na pergunta de pesquisa. Uma fonte em
tempo real (o RAD/ENET da CVM) tem outros termos e fica fora desta etapa; a decisão é do Artur.

### 15. Macro do Banco Central (SGS)

| Id (`macro_daily.series`) | Série SGS | O que é | Casas |
|---|--:|---|--:|
| `cdi_daily_pct` | 12 | CDI do dia, % ao dia (é a série que rende o caixa, plano 2) | 6 |
| `selic_target_pct_year` | 432 | Meta Selic definida pelo Copom, % ao ano | 2 |
| `ipca_month_pct` | 433 | IPCA, variação do mês, % | 2 |
| `ipca_12m_pct` | 13522 | IPCA acumulado em 12 meses, % | 2 |
| `usd_brl_ptax_sell` | 1 | Dólar PTAX de venda, R$ por US$ | 4 |

A **série 1 é o PTAX de venda**: conferida em 01/11/2026 contra o PTAX oficial (OData do BCB, `CotacaoDolarDia`), venda de
29/10/2026 = 5,3744 e de 30/10/2026 = 5,4212, iguais nas duas fontes. O BOVA11 do macro não vem do BCB: sai das barras da
etapa 4.

**Valor e data.** O valor é texto decimal com as casas da série (`"0.050788"`, nunca float) e vira `NUMERIC(18,8)`. A data é a
**do valor**, não a da busca: o IPCA de setembro é `2026-09-01` mesmo buscado em outubro, e o CDI de 29/10 só aparece
depois (conferido: em 01/11, domingo, o último CDI publicado é o de 29/10). Valor com mais casas que as da série (a fonte
mudou de precisão) falha em vez de gravar arredondado.

**Busca só o que falta.** Do último dia guardado até hoje; a primeira vez, 400 dias. Nunca refaz o histórico a cada 30
minutos. O SGS tem manias que só apareceram na chamada de verdade (01/11/2026), e o código trata cada uma:

- janela sem valor novo: **HTTP 404** com `{"erro":{"statusCode":404,"detail":"...Value(s) not found"}}`. Não é falha, é
  "nada de novo" (um 404 com outro corpo continua sendo falha);
- janela de um dia só (`dataInicial` igual a `dataFinal`): **HTTP 400** ("DataFinal deve ser maior que dataInicial"). Por isso
  a janela começa **no último dia guardado**, e não no seguinte: tem sempre mais de um dia, traz de volta o último ponto
  (que não muda nada) e pega uma revisão dele;
- a meta Selic vem **projetada** para os dias seguintes (o último ponto de 01/11 já tinha 04/11): a janela termina hoje;
- código de série que não existe: o servidor não responde (a chamada de teste ficou pendurada), e o prazo de 20 s corta;
- ponto datado **fora da janela pedida** (2099, 1900, um dia depois de hoje) falha a série, sem gravar nem os pontos bons: o
  SGS respeita `dataFinal`, então é resposta errada ou hostil, e um ponto de 2099 faria o último dia guardado ser 2099 e a
  série nunca mais ser buscada, sem erro nenhum;
- uma série que falha não impede as outras de gravar; a busca falha no fim, dizendo quais, e a fila repete.

**No banco de dev (01/11/2026):** CDI 273 pontos (29/09/2025 a 29/10/2026), meta Selic 401 (até 01/11/2026), IPCA mensal 13
e em 12 meses 13 (até 09/2026), PTAX 274 (até 30/10/2026). A segunda busca grava 0.

**Termos.** A licença do BCB **não foi conferida**: o portal de dados abertos (`dadosabertos.bcb.gov.br`) respondeu HTTP 502 em
01/11/2026. A API é pública, sem token. Enquanto a licença não for lida, qualquer exibição pública do macro mostra
**"Fonte: Banco Central do Brasil"** (item do checklist da etapa 9, feito no rodapé de toda tela: `docs/TELAS.md`, seção 1).

### 16. A fila `news`: o que o `fetch` faz

1. Confere que a fonte está na lista fixa (senão falha antes de assumir a mensagem: nenhuma URL vem da fila).
2. Assume `job_run` (`fetch` + `fonte:slot`, único). Já concluída: não faz nada. Outra entrega trabalhando: `JobBusyError`, e a
   fila repete. `FAILED` é reassumido.
3. Busca e grava (RSS, CVM ou BCB, seções 13 a 15). Falha de rede, HTTP de erro ou corpo torto: a mensagem fica `FAILED` com o
   motivo (sem corpo de resposta) e a fila repete até 5 vezes, depois a DLQ (ADR 0015).

O slot é a meia hora UTC a que o cron pertence, sem milissegundos (`2026-11-01T17:30:00Z`): o retry do job de agendamento
cai no mesmo slot e no mesmo `MessageId`. Cada fonte tem a sua linha por slot, então o `job_run` ganha uns **290 registros
por dia** (6 fontes, 48 slots); a limpeza é a mensagem `retention` da etapa 10.

**Segurança das buscas** (`infrastructure/source-http.ts`; a fronteira de confiança do worker):

| Controle | Como |
|---|---|
| Só URL da lista fixa | A busca recebe a fonte, não uma URL. Só `https`, só o host da fonte, sem usuário, sem porta |
| Redirecionamento | O `fetch` não segue sozinho. Até 3 saltos, e cada um passa pela mesma conferência (um feed que redireciona para `http://169.254.169.254` não leva o worker junto) |
| Prazo | 20 s no total, valendo também para o corpo |
| Tamanho | Teto contado no corpo **já descomprimido**: RSS 2 MB, ZIP da CVM 30 MB (IPE) e 10 MB (FCA), BCB 1 MB. Estoura: cancela a leitura |
| Bomba de ZIP | O CSV é lido em fluxo; o tamanho inflado declarado no ZIP tem teto (128 MB o IPE, 32 MB o FCA) e o `yauzl` confere o declarado com os bytes de verdade; o CRC32 é conferido no fim; a linha do CSV tem teto de 128 KB; o IPE tem teto de 200 mil linhas e de 5 mil documentos na janela (o que fica na memória) |
| XML | `<!DOCTYPE` e `<!ENTITY` são recusados antes de qualquer leitura (sem XXE nem bomba de entidades); o XML é validado antes; aninhamento limitado a 20; nome de tag como `__proto__` é recusado. A conferência olha o documento inteiro, CDATA e comentário incluídos: um item cujo texto traz literalmente `<!DOCTYPE` derruba a fonte (falha fechada) até sair do feed, de 1 a 2 dias. Aceito de propósito: poupar o CDATA exige um leitor igual ao do parser, e um desvio entre os dois seria um furo de XXE (`ponytail` em `rss.ts`) |
| Cabeçalho do CSV | As colunas que o código lê têm de estar no cabeçalho do IPE e do FCA, senão a busca falha dizendo quais faltam |
| Log | Nenhum corpo, cabeçalho ou URL com query vai para log ou mensagem de erro: só status, host e contagens. Um ZIP sem a entrada esperada lista no máximo 10 nomes de entrada, de até 80 caracteres e sem caractere de controle |
| `User-Agent` | `Alvesting/0.1 (projeto academico; leitor de feeds e dados abertos)`, sem e-mail nem endereço (o repositório pode ficar público) |

### 17. Texto de terceiro é dado, nunca instrução

Título, trecho, assunto da CVM e nome de empresa passam por `cleanText` (`domain/text.ts`) na entrada e **de novo** na
montagem do briefing: HTML fora (tags, script, style, comentário; tag de bloco separa palavras, tag de linha não), entidades
decodificadas (uma vez só), caracteres de controle e invisíveis fora (controles C0 e C1, largura zero, soft hyphen, BOM,
sobreposição de direção, caracteres de tag do plano 14, substitutos soltos e os ignoráveis por padrão do Unicode: seletores
de variação, preenchimentos de Hangul, Khmer e Mongol), espaços colapsados, NFC e tamanho truncado em caracteres (não bytes)
com reticências. **A ordem importa:** espaços e invisíveis saem **antes** do HTML (e de novo depois de decodificar as
entidades), porque `<` + largura zero + `script>` vira `<script>` se o invisível sair depois de a tag ter sido procurada; e o
HTML sai até **não sobrar tag**, porque a tag mais interna sai primeiro e pode juntar as pontas de outra (`<<<b>b>script>`
vira `<script>` na primeira passada). Aninhamento artificial que não estabiliza em 6 passadas perde todo `<` que sobrar.
Resultado, com teste de propriedade: a saída nunca tem o começo de uma tag. O `<` solto ("lucro < 5%") é texto e fica. Cada
passada é linear e são no máximo 6 por etapa, então uma entrada de 1 MB é limpa em milissegundos. O banco repete a regra: um
CHECK (`news_item_text_check`) recusa título ou trecho com o começo de uma tag, para o caminho novo que esquecer a limpeza.

No briefing o texto de terceiro só aparece como **valor de um campo de dado** (`title` e `snippet` de um item de notícia,
`name` de uma linha da tabela). O briefing não tem texto de instrução, e nada de fonte externa é interpolado em frase
nenhuma. A serialização (seção 18) escreve `<`, `>` e a crase como sequências de escape Unicode (barra invertida, `u` e
quatro dígitos hexadecimais): o JSON é o mesmo, mas uma notícia não consegue escrever uma tag de fechamento nem uma cerca de
código para fechar o bloco em que o briefing for posto num prompt.

Testes (`briefing.spec.ts`, `freeze.integration.spec.ts`, `fetch.integration.spec.ts`): uma notícia que manda o modelo
comprar 25% de `PETR4` e revelar o prompt, uma que imita uma resposta do modelo, uma que tenta fechar a string JSON e abrir
um item falso (`"},{"source":...`), uma com cerca de código, `</news>` e `<<<FIM>>>`, uma com sobreposição de direção. Em
todas: o texto fica dentro de **um** item de notícia, escapado; o resto do briefing é idêntico ao de antes da notícia; as
chaves são as mesmas; os bytes não têm `<`, `>` nem crase. Do feed RSS ao briefing, ponta a ponta, no Postgres.

**O que isso não resolve**, para constar: limpar não muda o sentido. "Compre PETR4" continua sendo uma frase legível dentro de
um campo de dado, e o que impede o modelo de obedecê-la é o prompt da arena (etapa 6), que fica no Key Vault e precisa dizer
que `news` é dado de terceiro. O briefing só garante que a frase chega **onde** deve e **sem** quebrar o formato.

### 18. Briefing congelado

`freeze {pregão}` (fila `briefing`, 07:30 de Brasília) monta a entrada comum a todos os modelos (plano 10) e a congela. As
posições de cada modelo **não** entram aqui: são a parte própria de cada um, na etapa 6.

**Formato** (`alvesting-briefing/1`): JSON canônico, `date` é o pregão D, `data_through` é o último pregão com dado (D-1).

| Seção | Conteúdo |
|---|---|
| `rules` | Capital R$ 100.000,00 em centavos, 20 pregões, até 10 posições e 5 ordens por ciclo, BUY de 5% a 25% do patrimônio, SELL de 1% a 100% da posição, custo de 3 pontos-base, só comprado, ações inteiras, execução ao preço oficial de abertura do mesmo pregão, vendas antes das compras, decisão às 08:00 com prazo 09:30. Números e flags, nenhuma frase de instrução |
| `macro` | Os cinco valores da seção 15, cada um com a **data do valor** (ou `null` se ainda não há), mais o BOVA11 (fechamento em centavos, variação em pontos-base, das barras da etapa 4). Só valores até D-1 |
| `universe` | A tabela da semana (`week`), colunas `ticker`, `name`, `close_cents`, `change_bps`, `avg_volume_cents`, uma linha por ação (até 500; hoje 305). `close_cents` é o fechamento de D-1 e `change_bps` a variação sobre D-2; `null` quando a ação não negociou. Em **ordem embaralhada** |
| `screening` | A regra da triagem e as 15 ações escolhidas |
| `bars` | Barras de 30 pregões (`date`, `open_cents`, `high_cents`, `low_cents`, `close_cents`, `volume_cents`) das ações da triagem e das citadas nas notícias |
| `news` | `from` e `until` da janela e os itens: `source` (nome da fonte), `published_at`, `title`, `snippet` (até 300 caracteres; **vazio nas fontes cujos termos não autorizam o trecho**, seção 13) e `tickers` (só ações do universo) |

**Serialização canônica** (`domain/canonical-json.ts`): chaves em ordem de unidade UTF-16, sem espaço nem quebra de linha,
UTF-8. **Sem float**: preço e volume são centavos inteiros, variação é ponto-base inteiro (1 bp = 0,01%, arredondado com
inteiros, meio para longe do zero), macro é texto decimal fixo. Número que não é inteiro seguro, `undefined`, `Date` e
afins são recusados: nada some nem muda de forma em silêncio. O **SHA-256 é o dos bytes exatos gravados no Blob**.

**Exemplo sintético** (2 ações, 3 pregões; no arquivo de verdade é uma linha só e as quebras abaixo foram acrescentadas só para
ler; SHA-256 dessa linha: `6f8e9f2c2341498d10a0cae2181479c49b3762842aed6d16785a16ad45fc8aca`, 1.718 bytes; conferido por fora do
código com o `json` do Python, chaves ordenadas e sem espaço):

```
{"bars":{"by_ticker":{"AAAA3":[["2026-10-27",990,1020,970,1000,500000000],["2026-10-28",1000,1030,980,1010,500000000],["2026-10-29",1040,1070,1020,1050,500000000]],"BBBB4":[["2026-10-27",1990,2020,1970,2000,500000000],["2026-10-28",1990,2020,1970,2000,500000000],["2026-10-29",1970,2000,1950,1980,500000000]]},"columns":["date","open_cents","high_cents","low_cents","close_cents","volume_cents"],"sessions":3},
"data_through":"2026-10-29","date":"2026-10-30","format":"alvesting-briefing/1",
"macro":{"bova11":{"change_bps":-31,"close_cents":16050,"date":"2026-10-29"},"cdi_daily_pct":{"date":"2026-10-29","value":"0.050788"},"ipca_12m_pct":null,"ipca_month_pct":null,"selic_target_pct_year":null,"usd_brl_ptax_sell":{"date":"2026-10-29","value":"5.3744"}},
"news":{"from":"2026-10-29T10:30:00Z","items":[{"published_at":"2026-10-29T21:10:00Z","snippet":"Trecho de até 300 caracteres.","source":"Agência Brasil","tickers":["AAAA3"],"title":"Notícia de exemplo sobre AAAA3"}],"until":"2026-10-30T10:30:00Z"},
"rules":{"buy_percent_of_equity":[5,25],"decision_deadline_brt":"09:30","decision_time_brt":"08:00","execution":"official_open_same_session","long_only":true,"max_orders_per_cycle":5,"max_positions":10,"season_sessions":20,"sell_percent_of_position":[1,100],"sells_before_buys":true,"starting_capital_cents":10000000,"trade_cost_bps":3,"whole_shares_only":true},
"screening":{"rule":{"pool":100,"rank_by":"abs_change_bps_last_session","size":15},"tickers":["AAAA3","BBBB4"]},
"universe":{"columns":["ticker","name","close_cents","change_bps","avg_volume_cents"],"rows":[["AAAA3","EMPRESA A",1050,396,900000000],["BBBB4","EMPRESA B",1980,-100,400000000]],"shuffle":"sha256_of_date_colon_ticker","week":"2026-W44"}}
```

**Semente do embaralhamento.** A posição de cada ação na tabela é a ordem do SHA-256 de `<pregão>:<ticker>` (`2026-10-30:PETR4`),
em hexadecimal. É igual para todos os modelos, não depende da ordem em que o banco devolve as linhas, não guarda estado e
qualquer um confere: `printf '2026-10-30:PETR4' | shasum -a 256`. A ordem de volume viciaria a atenção do modelo nas
primeiras linhas.

**Triagem** (`domain/screening.ts`). Das **100 ações mais líquidas** do universo (posição 1 a 100 por volume médio), as **15 que
mais se mexeram no último pregão**, em valor absoluto da variação, altas e baixas juntas; desempate pelo maior volume de D-1 e
depois pelo ticker. Ação que não negociou nos dois últimos pregões não entra. O universo tem até 500 ações e o briefing não
leva as barras de todas; a variação do dia aponta onde há notícia ou fluxo, e o corte nas 100 mais líquidas evita que um papel
quase parado, com um negócio de um centavo, ocupe a lista. É uma heurística declarada, igual para todos, e não uma
recomendação.

**Barras.** Das 15 da triagem mais as citadas nas notícias do briefing (só ações do universo, **no máximo 40**, as mais
citadas primeiro). Qualquer origem de barra vale (a BRAPI, e a barra legada que o banco de dev ainda tem).

**Notícias.** Cada notícia entra em **exatamente um** briefing: a janela é `(corte anterior, corte deste]` sobre a hora em que o
worker **viu** a notícia pela primeira vez (`first_seen_at`), não sobre a hora que a fonte diz (uma notícia vista tarde não se
perde; as da CVM têm só o dia). **A hora vista é a da gravação**, carimbada pelo buscador logo antes do INSERT (`seenNow`,
nunca antes do começo da busca), e não a do começo da busca: entre uma e outra passam até 20 s de rede e o processamento do
ZIP, e um lote que começou antes do corte e gravou depois da leitura do freeze ficaria com hora de antes do corte, fora deste
briefing e do seguinte (que começa no corte). O corte é fixo, 07:30 de Brasília do pregão, e não a hora em que o worker rodou.
O início é o corte do briefing anterior já congelado (ou do pregão anterior, se não há), com no máximo 7 dias para trás. No
máximo 100 por fonte, as mais recentes. Em ordem de hora, e a da mesma hora pelo `url_hash`. **A busca das 07:30 roda depois
do corte**: o que sai entre 07:00 e 07:30 só entra no briefing do dia seguinte (a notícia mais fresca tem até 30 minutos).
Não há teto global de notícias: o pior caso (100 de cada fonte) passa de 300 KB, e o freeze só avisa no log (`briefing grande`,
com tamanho e contagem) quando o briefing passa de 300 KB; cortar notícia é decisão da etapa 6, que sabe o orçamento de tokens.

**Pré-condições** (falha, a fila repete, e nada é gravado):

- o universo congelado da semana do pregão existe (não se usa o de outra semana: ele mudaria a regra do experimento sem
  ninguém ver);
- pelo menos 80% do universo tem fechamento do último pregão. Abaixo disso o `eod` do dia anterior falhou, e congelar daria
  aos modelos um dia de dado velho sem aviso;
- o último pregão com dado é anterior ao do briefing (sem olhar para o futuro: barra, macro ou notícia de depois do corte
  não entram);
- não é antes das 07:30: um congelamento precoce trancaria dado velho para o pregão inteiro, porque o congelado nunca é
  refeito;
- não existe briefing de um pregão **posterior**: a janela dele começa no corte anterior a ele, que é o deste (ou antes), e
  congelar este agora repetiria as mesmas notícias nos dois. O reenvio da DLQ dias depois e `briefing:freeze <data passada>`
  caem aqui; os briefings são congelados em ordem. O pregão já congelado continua sendo "já feito", mesmo havendo um posterior.

**Folga depois do corte.** Chegando antes de 07:30:10, o freeze espera até 07:30:10 para ler o banco. O buscador carimba a
notícia na hora da gravação, então uma carimbada até 07:30:00 já terminou de gravar quando a leitura começa, a não ser que a
confirmação demore mais que 10 s. O cron das 07:30 chega ao worker segundos depois do corte e o ciclo das 08:00 está a 30
minutos, então a espera custa nada.

**Idempotência.** Primeiro os bytes vão para o Blob, depois a linha de `briefing` (pregão único, SHA-256, URI), nunca ao
contrário: a linha só existe se o arquivo existe. O blob se chama `briefings/<pregão>/<sha256>.json`, então um briefing
diferente nunca sobrescreve o de outro (uma corrida entre duas montagens não deixa o hash de uma apontando para os bytes de
outra), e o arquivo confere com o hash por construção (`BriefingArchive` recusa SHA-256 que não é o dos bytes). `freeze`
repetido encontra a linha, não remonta e não regrava o Blob; o processo que cai entre gravar a linha e concluir o `job_run` é
reconhecido na repetição. Como o corte é fixo, **remontar o mesmo pregão com os mesmos dados no banco dá o mesmo SHA-256**,
também semanas depois. O congelado é o que vale: o `macro` e as barras não são "do momento" (`macro_daily` não guarda quando o
valor passou a ser conhecido, e uma revisão de valor sobrescreve a linha; a barra de preço, ao contrário, nunca muda depois de gravada), então
refazer um pregão antigo pode dar outro hash, e o do Blob continua sendo o autoritativo. Notícia e barras de sessão passada
em geral não mudam; o macro é o que mais muda (o IPCA de setembro, de data 01/09 e publicado em outubro, entraria num
refazimento de 02/10, por exemplo).

**Resultado no banco de dev (briefing do pregão de 30/10/2026, dados até o fechamento de 29/10)**, com as barras reais da etapa
4, o universo real da semana 2026-W44 (criado com `market:universe 2026-W44`: 400 ações negociaram, 305 passaram e entraram), o
macro real do BCB buscado uma vez e as **8 notícias de fixture** (`modules/news/testing/fixtures/*.xml`, textos inventados,
importadas com `news:import ... --at 2026-10-30T00:00:00Z`, entre elas as de ataque):

| | |
|---|---|
| SHA-256 | `7ccc20294fca1d59678bfc43d2ce00e572e47c34ed452834b432001e61e74fa8` |
| Bytes | 43.405 (as 305 linhas do universo somam a maior parte) |
| Linhas da tabela do universo | 305 (em ordem embaralhada) |
| Triagem | 15 ações (as maiores variações entre as 100 mais líquidas) |
| Ações citadas nas notícias | 5 (`BBAS3`, `ITUB4`, `PETR3`, `PETR4`, `VALE3`) |
| Ações com barras | 20 (15 da triagem e 5 citadas, nenhuma em comum), 600 barras de 30 pregões |
| Notícias | 8 (todas de fixture, vistas entre o corte de 29/10 e o de 30/10) |
| Macro | CDI e PTAX de 29/10, meta Selic de 29/10 (13,75), IPCA de 01/09 (0,82 e 4,58) e BOVA11 (R$ 166,51, -1,16%) |
| URI | `http://127.0.0.1:10000/devstoreaccount1/briefings/2026-10-30/7ccc20294fca...json` (o endereço lógico do Azurite; o SDK chega nele pelo proxy da connection string) |

Os bytes baixados do Blob e conferidos por fora (`shasum -a 256`) dão o mesmo SHA-256 da linha. Repetir `briefing:freeze 2026-10-30`
respondeu "já congelado" com o mesmo hash. Conferido também por fora do código: a ordem da tabela (SHA-256 de `pregão:ticker`, em Python), a
variação em pontos-base das 20 ações com barras (frações exatas, em Python) e a triagem (uma consulta SQL independente) batem com o
arquivo. O Blob de dev está em `.data/azurite-demo/` (fora do git): o Azurite do
`docker-compose.yml` que estava no ar ainda não tem o `--skipApiVersionCheck` (só vale depois de `docker compose up -d azurite`),
então o congelamento usou um Azurite temporário, já encerrado.

**Este briefing de dev é de antes da regra do trecho por fonte** (seção 13): 7 das 8 notícias de fixture são do InfoMoney e do
Money Times e foram congeladas com o trecho. Com o código de hoje o mesmo retrato do banco dá **outro SHA-256,
`3241e9e3e8f2fef98b90f9ba78bc5f45dd7cfa737d4a2ac5a4a1f80cc41e4c42`, com 42.856 bytes**, e a única diferença são esses 7
trechos esvaziados: o briefing gravado, com os 7 trechos esvaziados e serializado de novo, é byte a byte o de hoje (conferido
com uma leitura só de consulta ao banco, sem gravar nada). A linha e o Blob **não foram regravados**: o congelado é imutável,
e refazê-lo exigiria apagar a linha de `briefing` e o `job_run` `freeze:2026-10-30` do banco de dev, o que a regra do banco de
dev não permite sem decisão do Artur. É o único caso em que "a mesma entrada dá o mesmo SHA-256" não vale: a entrada mudou de
regra, não de dado. A partir de agora um briefing novo sai com a regra de hoje.

Para refazer:

```bash
pnpm --filter @alvesting/api market:universe 2026-W44
pnpm --filter @alvesting/api news:fetch bcb-sgs
pnpm --filter @alvesting/api news:import infomoney apps/api/src/modules/news/testing/fixtures/infomoney.xml --at 2026-10-30T00:00:00Z
pnpm --filter @alvesting/api news:import money-times apps/api/src/modules/news/testing/fixtures/money-times.xml --at 2026-10-30T00:00:00Z
pnpm --filter @alvesting/api news:import agencia-brasil apps/api/src/modules/news/testing/fixtures/agencia-brasil.xml --at 2026-10-30T00:00:00Z
pnpm --filter @alvesting/api briefing:freeze 2026-10-30     # precisa do Azurite com --skipApiVersionCheck
```

### 19. Decisões (etapa 5)

| Decisão | Motivo |
|---|---|
| Quatro feeds (InfoMoney, Money Times, Seu Dinheiro, Agência Brasil) | Os que são RSS 2.0 em UTF-8, com data com fuso e conteúdo de mercado; os outros nove candidatos falharam num desses pontos (`docs/DEPENDENCIAS.md`) |
| Trecho de até 300 caracteres é privado; a página pública mostra título, fonte e link | Mostrar título, fonte e link é o uso de agregador. O risco de termos está na seção 13 |
| O trecho só vai ao briefing (e às LLMs) para a Agência Brasil e a CVM (`allowExcerpt` por fonte) | Money Times e Seu Dinheiro vedam reproduzir a terceiros sem autorização escrita, e o InfoMoney não tem termos. O padrão seguro fica no código até haver autorização; reverter é uma linha, e o trecho continua no banco |
| `first_seen_at` é a hora da gravação, não a do começo da busca; o freeze espera 10 s depois do corte | Uma notícia gravada depois da leitura do freeze, mas carimbada antes do corte, não entraria em briefing nenhum. Carimbar na gravação e ler só depois da folga fecha a corrida |
| Freeze fora de ordem falha | Os briefings são congelados em ordem; senão a janela de um repete as notícias do outro |
| O validador do FCA é guardado por último, e o FCA lido de novo força o IPE sem condição | A repetição de uma busca que falhou no meio não pode perder o "reler o IPE" (antes vivia só na memória) |
| Cabeçalho do CSV conferido e IPE sem linha aceita falha | A CVM mudar o formato não pode virar "processado, zero documentos" com o ETag guardado |
| `news_item`: `tickers` NOT NULL, `published_at <= first_seen_at`, URL até 2048, título e trecho sem começo de tag (CHECK) | Rede de segurança para o caminho que esquecer a limpeza ou o carimbo; a migration `20261101190000_news_item_guards` é só aditiva |
| GET condicional só para a CVM; o RSS é baixado inteiro a cada busca | O IPE tem 1,8 MB e muda uma vez por dia; um feed tem 60 a 130 KB. Validador de RSS que não muda enquanto o conteúdo muda esconderia notícia, e o ganho é pequeno |
| `instrument.cnpj` (coluna) em vez de tabela de mapeamento | É o cruzamento "CNPJ do FCA x instrumentos da etapa 4" já pronto para a consulta. Aditiva, nula até o FCA citar o código |
| CNPJ só pelo FCA, mais a raiz de quatro letras e cinco lacunas curadas | O FCA deixa 21 das 289 ações do universo antigo sem código (BTG, a quinta em volume, cita "000000"). A raiz resolve as séries da mesma companhia; a lista curada cobre o que o cadastro não cobre, com o CNPJ conferido no IPE |
| Documento da CVM marca ticker só pelo CNPJ, nunca pelo texto | O assunto de uma companhia pode citar outra. "Ticker certo" é o da companhia que entregou |
| Documento de companhia sem instrumento não é gravado | Não é notícia da arena, e o IPE tem 38 mil linhas por ano |
| Só fato relevante e comunicado ao mercado, janela de 7 dias | Assembleia, demonstração e reunião são 80% das linhas e não movem o dia seguinte |
| Macro: cinco séries, `NUMERIC(18,8)`, data do valor | Texto decimal fixo, sem float; o IPCA mostra o mês a que se refere |
| Janela do SGS começa no último dia guardado | O SGS recusa janela de um dia só (400) e responde 404 à janela sem valor; 404 com "Value(s) not found" é "nada de novo" |
| Notícia entra no briefing pela hora em que o worker a **viu**, em `(corte anterior, corte deste]` | Cada uma entra em exatamente um briefing, sem depender do relógio da fonte (a CVM só tem o dia) e sem perder a que chegou tarde |
| Corte fixo às 07:30, não a hora em que o worker rodou | O briefing vira função do banco e do pregão: refeito depois, dá o mesmo SHA-256. A contrapartida é a notícia de 07:00 a 07:30 entrar no dia seguinte |
| JSON canônico só com inteiros, `<`, `>` e crase escritos como escape Unicode | A mesma entrada dá os mesmos bytes; float tem mais de uma grafia; o texto de terceiro não fecha um bloco do prompt |
| Blob `briefings/<pregão>/<sha256>.json` | O nome carrega o hash: nada sobrescreve nada, e o arquivo confere com a linha por construção |
| Tabela do universo ordenada pelo SHA-256 de `<pregão>:<ticker>` | Embaralhamento reproduzível e público, sem gerador de números pseudoaleatórios nem estado |
| Triagem: 15 maiores variações absolutas entre as 100 mais líquidas | Heurística declarada, igual para todos, que leva barras de onde há movimento sem encher o briefing |
| Barras: triagem e até 40 citadas | Teto de tamanho; o briefing do dev tem 43 KB |
| Sem universo da semana, o briefing falha | Cair no universo de outra semana mudaria a regra do experimento sem ninguém ver |
| Sem 80% do universo com fechamento de D-1, o briefing falha | O `eod` do dia anterior falhou; dado velho sem aviso é pior que atraso |
| Regras do briefing: constantes da Temporada 1 (`domain/rules.ts`) que a temporada RUNNING sobrescreve (etapa 6) | Capital, duração, posições, custo e horários vêm de `season.params` do pregão (`rulesOfSeasons`); sem temporada valem os do plano 2. O limite de ordens e as faixas de BUY e SELL vêm do contrato da decisão, o mesmo que valida a resposta do modelo |
| Comandos `news:fetch`, `news:import` e `briefing:freeze` | Operação manual e replay de fixture, como o `market:backfill`. O `import` lê arquivo do disco, nunca URL |
| `JobRunStore` das etapas 4 a 7 reaproveitado | `fetch` e `freeze` assumem a mensagem como `eod` e `universe` |

### 20. Limitações e o que fica para depois

- **Termos dos sites de notícia** (seção 13) e **da B3** (seção 10): decisão do Artur e do orientador. Até lá, o trecho de
  InfoMoney, Money Times e Seu Dinheiro não vai ao briefing.
- **CVM não é tempo real** (seção 14): o fato relevante entra no briefing dois pregões depois de entregue (um, se na sexta).
- **Notícia entre 07:00 e 07:30** entra no briefing do dia seguinte (a busca das 07:30 roda depois do corte).
- **Sete ações do universo sem CNPJ** (pequenas), e o FCA pode mudar: a lista curada de lacunas é revista quando o universo mudar.
- **O InfoMoney mostra só 10 itens** por busca; na hora de maior movimento a busca de 30 em 30 minutos pode perder o excedente
  (`ponytail` em `sources.ts`).
- **O IPE não traz o corpo do documento**, só título, assunto e link; o RSS traz só o trecho do `description`, que pode estar vazio.
- **Limpar não muda o sentido** (seção 17): o prompt da arena (etapa 6) precisa dizer que `news` é dado de terceiro, e o
  briefing vai no turno do usuário, nunca concatenado ao prompt de sistema. O schema da decisão e os tetos são a última barreira
  contra um "Compre 25% de PETR4" dentro de um campo.
- **A licença do BCB não foi conferida** (portal fora do ar em 01/11/2026).
- **`job_run` cresce** uns 290 registros por dia; a retenção é da etapa 10. A de `news_item` também (a tabela não tem retenção).
- **As posições de cada modelo** não estão no briefing: são a parte própria de cada um (etapa 6).
- **Sem teto global de notícias** (seção 18): o pior caso passa de 300 KB; a etapa 6 decide o corte com o orçamento de tokens.
- **Para as etapas 9 e 10** (checklist, no plano). **Feito na etapa 9** (`docs/API.md` e `docs/TELAS.md`): nenhuma rota expõe
  `news_item.snippet` nem `briefing.uri` (a URL do blob dá o nome da conta), a página escapa título e link, o rodapé traz o aviso da ODbL
  e "Fonte: Banco Central do Brasil", e a migration `20261102000000_public_api_indexes` criou o índice GIN em `news_item.tickers` e o btree
  em `(published_at DESC, id DESC)` para `/acoes/[ticker]` e `/noticias` (a revisão de banco mediu, em 100 mil linhas, 11,7 ms sem índice e
  0,2 ms com). **Feito na etapa 10 (parte 1):** o sinal `news-seguranca` alerta na primeira vez as falhas de classe segurança da fila `news` (feed com DTD,
  redirecionamento fora da lista, resposta acima do teto, ZIP que mente o tamanho, arquivo da CVM que mudou de formato), separadas da queda de rede
  (`docs/INFRA.md`, seção 5.3; ADR 0026).
- **O Blob do briefing não é write-once**: `uploadData` sobrescreve, e a identidade do worker tem papel na conta toda. O nome com
  o hash protege contra erro do próprio código, não contra um worker comprometido. A proteção de verdade (papel por container e
  política de imutabilidade em `briefings` e `llm-io`) é da infra.

### 21. Variáveis de ambiente (etapa 5)

Nenhuma nova. O worker usa o que a etapa 4 já definiu: `DATABASE_URL`, `SERVICEBUS_FQDN`, `STORAGE_BLOB_ENDPOINT` e
`AZURE_CLIENT_ID` (o container de briefings é `briefings`, criado pela infra; o Azurite cria o dele). Nenhuma fonte de
notícia pede token.
