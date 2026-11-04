# ADR 0033: A API pública sem cotação bruta, e o site lendo as cotações por uma rota interna

- **Status:** aceita
- **Data:** 03/11/2026
- **Origem:** `docs/PLANO.md`, §3, §5.16 e §9; `docs/DADOS.md`, seções 2 e 10; `docs/API.md`, seções 2 e 6; ADR 0018 (trava de origem), 0023 (o HTML sem cache na borda), 0028 (o papel mínimo do Postgres da api) e 0032 (a brapi como fonte única)

## Contexto

A ADR 0032 fez da brapi a fonte única das cotações e deixou um problema escrito: **a API pública de hoje entrega barra bruta**. A rota `GET /api/v1/stocks/:ticker` devolvia as 60 barras mais recentes (abertura,
máxima, mínima e fechamento) de qualquer ação, e o `GET /api/v1/arena/current` devolvia o fechamento e o fechamento anterior do BOVA11, ambos com `Cache-Control: public, s-maxage=300` e guardados na borda
do Front Door. Qualquer pessoa, sem login, montava a série de preços de uma ação por uma chamada por papel.

O que a licença da brapi diz (FAQ "A brapi é distribuidora licenciada da B3?", seção "O que a licença de uso permite", e Termos de Uso de 07/06/2025, seção 2; lidos em 03/11/2026, `docs/DEPENDENCIAS.md`):

> Na prática, dentro do seu próprio produto você pode: exibir os dados para os seus usuários; guardar em cache, persistir e montar séries históricas, gráficos e tabelas; calcular e publicar indicadores
> derivados (múltiplos, ROE, ROIC, medianas, comparações); cobrar pelas suas próprias funcionalidades. O que a licença **não** permite é **entregar os Dados a terceiros como feed, API ou base bruta**, nem criar
> proxy, espelho ou wrapper da nossa API como serviço concorrente ou de acesso público.

> Sob esta licença, você não pode: Revender, redistribuir ou sublicenciar os Dados ou o acesso à API para terceiros. Criar um serviço de proxy, "espelho" ou qualquer forma de wrapper em torno da nossa API com o
> intuito de oferecer um serviço concorrente ou de acesso público.

Uma rota pública, sem login, com cache na borda, que devolve a série de preços de um papel, é "API" e "base bruta" nesse sentido. O site, ao contrário, **exibe** os dados aos usuários, e isso a licença deixa.

## Decisão

1. **A cotação bruta sai da API pública.** Saem do contrato (`packages/contracts/src/public.ts`): as `bars` de `/stocks/:ticker` e o `macro.bova11` (`closeCents`, `previousCloseCents`) de `/arena/current`. **E
   saem a composição da carteira do Sorteio e das referências e os donos que não são modelo** (a correção da revisão de segurança, abaixo). Ficam os **registros da arena**, que são o resultado publicado do
   experimento e indicador derivado dele, e a licença os trata como uso dentro do produto: as posições dos **modelos** (marcação, valor, preço médio pago e P&L), o patrimônio, o ranking e o Monte Carlo. A **tabela
   campo a campo**, com as rotas, está em `docs/API.md`, seção 6; a classificação, em resumo:

   | Campo com preço nos schemas públicos | Classe | Por quê |
   |---|---|---|
   | `bars[]` (abertura, máxima, mínima e fechamento) de `/stocks/:ticker` | **bruto: saiu** | A série de preços de um papel, sem login e com cache na borda: a "base bruta" que a licença proíbe entregar |
   | `macro.bova11` (`closeCents`, `previousCloseCents`) de `/arena/current` | **bruto: saiu** | O fechamento de um papel e o anterior, guardados na borda: um feed de cotação |
   | `portfolio.holdings` (caixa, valor em ações e posições) do **Sorteio e das referências**, e os **donos que não são modelo** em `holders[]` de `/stocks/:ticker` | **bruto: saiu** | O igual-peso segura o universo da semana de início até o fim (`settlement/domain/simulation.ts`): uns 300 papéis em produção, e a marcação de cada um é o fechamento do dia. Uma chamada a `/competitors/igual-peso` (cacheada 300 s no Front Door, sem login) devolveria o fechamento do universo inteiro, e `/stocks/:ticker` o do papel pedido, todo pregão. O BOVA11 compra uma vez e segura: `(patrimônio − caixa) ÷ quantidade` devolve o fechamento dele (medido no banco do ensaio: erro de 1 centavo, por causa do CDI no caixa) |
   | `markCents`, `valueCents`, `avgPriceCents`, `costCents` (as posições dos **modelos**) | registro da arena | O que a liquidação e as execuções do experimento fizeram com o dinheiro fictício, só dos papéis que algum **modelo** segurou (no máximo `maxPositions` por modelo, 10 por padrão); a marcação já sai de `valueCents ÷ quantity` |
   | `cashCents`, `positionsValueCents` (de um **modelo**), `equityCents`, `capitalCents` | registro da arena | O estado das carteiras dos modelos e o capital fictício que é parâmetro do experimento |
   | `pnlCents`, os percentis do Monte Carlo (`equityCents` e `returnBps`, p5 a p95), `returnBps`, `percentileBps`, `excess*Bps`, `maxDrawdownBps`, `winRateBps`, `tradeCostBps`, e o `equityCents` do Sorteio e das referências | derivado | "Indicadores derivados" (a licença os deixa publicar): contas sobre o resultado, sem o preço de um papel. O patrimônio do BOVA11 e do igual-peso é o retorno normalizado deles (a "comparação" que a licença permite), e não o fechamento |

2. **Uma lista branca, em teste.** `packages/contracts/src/public-quotes.spec.ts` lê todo schema que `public.ts` e `cycle.ts` exportam, junta o nome de todo campo (em qualquer profundidade) e reprova
   (1) nome de cotação bruta (`open`, `high`, `low`, `close`, `previousClose`, `bars`, `volume`, `price`, `bid`, `ask` e afins, por palavra inteira do nome em camelCase) e (2) campo em centavos que não esteja na
   lista branca do próprio teste, **cada um com o motivo**. Ele também confere que cada campo da lista está na tabela do `API.md`. O `public-api.integration.spec.ts` pede toda rota pública sobre a
   temporada do ensaio (e cada ação e cada competidor dela, e confere que o teste cobre toda rota do controlador) e reprova a resposta que traga um desses campos. O e2e repete a varredura no build de produção.
   Campo novo com preço obriga a decidir no teste e a escrever a linha na tabela.

   **O nome do campo não basta, e a revisão de segurança provou.** A lista branca só olha o nome (`markCents` passa), e a mesma `markCents` na posição do igual-peso era o fechamento do universo. Por isso o
   teste de integração também olha a **semântica**: nenhuma resposta traz o preço de mais papéis do que um modelo pode ter na carteira (`maxPositions`, e o igual-peso do ensaio tem mais papéis que isso no banco),
   `/competitors/:slug` do Sorteio e das referências vem com `holdings` nulo, `/stocks/:ticker` só lista modelos entre os donos, e a conta `(patrimônio − caixa) ÷ quantidade` do BOVA11, que fecha com o que o
   banco tem, não fecha com o que a resposta traz. Cada um desses testes foi visto falhar sem a correção.

3. **O site lê as barras de uma rota interna.** `GET /api/v1/interno/barras/:ticker` devolve `{ bars }` (as 60 mais recentes de qualquer papel de `instrument`, o BOVA11 inclusive, da mais antiga à mais
   nova), é o mínimo de que o site precisa, e uma rota só serve às três telas: a home tira do BOVA11 o fechamento e o anterior, a página da ação desenha as velas, e o rodapé mostra a data do último pregão.
   - **Segredo só do servidor.** `Authorization: Bearer <QUOTES_SECRET>` (segredo `quotes-secret` do Key Vault, 384 bits do `seed-secrets.sh`, lido só pela `id-alvesting-web` e pela `id-alvesting-api`), conferido
     em tempo constante (SHA-256 dos dois lados e `timingSafeEqual`, o padrão da revalidação). **Sem o segredo, com o errado, ou com a api sem ele, a resposta é um 404 com o mesmo corpo do que a rota não existir**
     (`Cannot GET <caminho>` no envelope, que o guard escreve com a mesma frase do roteador do Nest) e `no-store`: a rota não se confirma a quem não a conhece. O papel desconhecido ou sem barra é lista vazia (200),
     para o 404 querer dizer só "não é para você". O segredo nunca vai a log (o log de requisição é lista branca, sem cabeçalho), a telemetria (lista branca de atributos) nem à resposta.
   - **Fora do Swagger** (`@ApiExcludeController`) e **fora do cache da borda**: o caminho não casa nenhum padrão da rota `api-public` do Front Door, e o `infra/tests/check.mjs` lê o controlador e confere. O prefixo
     é `interno` de propósito: a regra `BlockInterno` do WAF (que já bloqueia `/interno/`, o caminho da revalidação do worker) bloqueia a rota **na borda**, então pelo Front Door ela nem chega à api; o site a lê
     pelo ingress do `ca-api`, com o `X-Azure-FDID` e o segredo. A trava de origem vem antes do segredo.
   - **A api em produção recusa subir** com o valor de dev do `.env.example` (público), como já recusa o segredo da conta e a senha do banco de exemplo.

4. **O site** (`apps/web/src/lib/quotes.ts`) é o único módulo que lê `QUOTES_SECRET`: variável sem `NEXT_PUBLIC_`, módulo com `import 'server-only'` (o build quebra se um componente de cliente o importar), e um teste
   (`quotes-boundary.spec.ts`) que prova sem depender do bundler que nenhum componente de cliente chega a ele por cadeia de imports. As barras passam pelo **mesmo cache de dados do Next** das leituras da API pública,
   com a mesma tag (`arena`, do tipo `CacheTag` de `lib/cache.ts`) e o mesmo `revalidate` (300 s), então a revalidação que o worker pede depois de cada liquidação continua valendo (provado no e2e com uma api falsa
   que conta as leituras). Na home a leitura sai **em paralelo** com as que já existiam; na página da ação sai **depois** da leitura da ação, de propósito: o ticker bem formado que não existe responde 404 na
   leitura da ação, e a rota interna devolve 200 com lista vazia para ele, que o cache de dados do Next gravaria em disco (o `FileSystemCache` não expurga) a cada ticker inventado por quem visita. A ação vem do
   cache, então a espera é de microssegundos. As telas ficam iguais para o visitante: as velas e a faixa do BOVA11 são as mesmas, com o crédito trocado; mudam só as páginas do Sorteio e das referências, que
   mostram o patrimônio e não a lista de papéis (item 1).
   - **Um 404 da rota é defeito de configuração, não "página não encontrada".** O site o converte em `ApiError` 502 `QUOTES_REFUSED`, que a página mostra como "a arena não respondeu" (e o smoke do deploy, que abre a
     home, reprova antes de a revisão nova receber tráfego).
   - **O segredo ausente ou torto, e o endereço da api sem TLS, também.** Viram `ApiError` 503 `QUOTES_UNCONFIGURED` (e `console.error` com o nome da variável, nunca o valor): a página mostra a tela de erro
     montada no servidor, com o aviso fixo, e não um 500 em branco, que o React não renderiza no `error.tsx` (a regra 5 do Artur: o aviso fixo aparece no site). O smoke reprova do mesmo jeito. O segredo é **aparado
     nas pontas** (a api faz o mesmo, senão os dois valores nunca bateriam) e só passa se for ASCII visível (`QUOTES_SECRET_SHAPE`): uma quebra de linha no meio faria o `fetch` do Node recusar o cabeçalho com o
     valor inteiro na mensagem do erro, que o `withApiDown` registra com a cadeia de causas. A api aplica a mesma forma no boot e recusa o que não a tem. Em produção o endereço da api tem de ser `https` (ou o
     loopback), como a api exige do endereço do site: o segredo vai em cabeçalho.
   - **O raio de um defeito destes é a página inteira**, e é uma escolha, não um acaso: a faixa do BOVA11 (1 de 6 células da home) e as velas (1 de 4 seções da ação) derrubam a página quando só a rota de cotações
     falha (o segredo girado em um app só, um 5xx isolado), porque antes o BOVA11 vinha dentro do `arena/current` e só caía com a api toda. A alternativa era degradar só o trecho ("sem dado"), mas o smoke do deploy,
     que reprova a revisão nova, precisa ver o defeito, e uma célula vazia passaria por "ainda não há barra". Fica assim; o custo está no RUNBOOK 4.1 (a rotação do `quotes-secret` tem de ser a mais curta
     possível, e a ordem importa). O rodapé é a exceção: a data some sem derrubar nada, mas a falta vai para o log do servidor.
   - **O crédito.** O rodapé de toda tela diz "Cotações: brapi.dev" (com link e a data do último pregão, no lugar da B3), e o mesmo crédito aparece onde há cotação: a faixa do BOVA11 da home, a página da ação, a
     carteira e a lista de fontes de "Como funciona", que também diz que a brapi não é distribuidora licenciada da B3.

5. **Infra.** O segredo `quotes-secret` (gerado ao acaso pelo `seed-secrets.sh`, nunca impresso), lido só pelas identidades do web e da api (`secret-access.bicep`, e a matriz escrita à mão do `check.mjs`), a variável
   `QUOTES_SECRET` nos dois Container Apps, a linha do `INFRA.md` 2.7 (o `check.mjs` confere a tabela contra o template), o valor de dev no `.env.example`, o mesmo valor sintético passado a todos os servidores do e2e
   pelo `playwright.config.ts` e a rotação no RUNBOOK (4.1).

## Consequências

- **A API pública deixa de ser um feed de cotação.** A licença da brapi cobre o que o produto faz: o site exibe a série e o BOVA11, e o resto é resultado do experimento.
- **Mudança incompatível, num lançamento só, porque não há deploy anterior.** O site antigo validava a resposta com o schema estrito que exigia `bars` e `macro.bova11` (e, na carteira do competidor, `cashCents`,
  `positionsValueCents` e `positions` soltos, que agora moram em `holdings`, nulo no Sorteio e nas referências), e o `CLAUDE.md` manda separar uma remoção de campo em três lançamentos (a api que aceita os dois
  formatos, o site novo, a api que tira o antigo). Aqui não existe site antigo para ler a api nova: o primeiro deploy público espera a decisão do PLANO §5.16. Depois do primeiro deploy, uma mudança assim volta a
  seguir a regra dos três lançamentos.
- **Uma dependência a mais entre o site e a api: o segredo.** Os dois precisam do mesmo valor. Girar um só derruba a leitura de cotação até o outro pegar o valor (a home e a página da ação mostram "não foi
  possível carregar os dados", com status 200, então nenhum alerta de 5xx a vê). O RUNBOOK (4.1) manda girar **a api primeiro e o site logo em seguida** (nunca o site primeiro: o cache de dados do Next inclui o
  cabeçalho `Authorization` na chave, e o segredo novo esvaziaria o cache na hora) e conferir a home e `/acoes/PETR4` no ato. A janela é de segundos a minutos; um `QUOTES_SECRET_PREVIOUS` aceito pela api durante a
  troca a eliminaria, e só vale o código se a rotação virar rotina.
- **O site faz uma leitura a mais por página que mostra cotação** (a das barras, do cache de dados; em paralelo na home e depois da leitura da ação na página dela), e o rodapé lê as barras do BOVA11 (60, em vez do
  `arena/current` inteiro) do mesmo cache. O LCP da home foi medido de novo (`docs/TELAS.md`, seção 5).
- **Sem tabela de preços nas telas**, como antes: as velas e um resumo em texto. A licença deixaria uma tabela ao usuário, e a escolha das etapas 4 e 5 continua, porque a tabela entregaria a série inteira a quem
  raspasse a página.

## Risco residual (decidido, e que o Artur e o orientador podem rever)

- **`markCents` e `valueCents` dos MODELOS seguem na API pública.** São o resultado do experimento (com o que cada modelo foi avaliado, só dos papéis que algum **modelo** segurou naquele pregão: no máximo
  `maxPositions` por modelo, 10 por padrão, uns 60 papéis no total com os 6 modelos), e a marcação se recupera de `valueCents ÷ quantity` de qualquer jeito, então escondê-la não esconderia o preço. Um leitor
  paciente reconstrói, ao longo dos pregões, o fechamento dos papéis que os modelos seguraram: é a parte do dado que o experimento precisa publicar para ser conferido. **Esta premissa estava errada na primeira
  versão deste ADR**, que dizia "só dos papéis que algum competidor segurou" sem ver que o igual-peso segura o universo todo (uns 300 papéis): a revisão de segurança mostrou que uma chamada a
  `/competitors/igual-peso` devolvia o fechamento do universo inteiro, e que `/stocks/:ticker` listava o igual-peso entre os donos de toda ação. Isso está corrigido (item 1), e o que resta é o limite acima.
  Se o orientador ou a brapi disserem que isso ainda é "base bruta", há duas saídas, da menor para a maior: trocar `markCents`, `valueCents` e `avgPriceCents` das posições dos modelos por **peso e retorno
  em pontos-base** (indicador derivado, que a licença deixa publicar), ou publicar só o retorno e o P&L (a lista branca do teste e a tabela do `API.md` mudam juntas).
- **A série de patrimônio do BOVA11 e do igual-peso é o retorno normalizado deles.** `equityCents` por pregão, dividido pelo capital inicial (que é público), dá o desempenho relativo do BOVA11 desde o primeiro
  pregão; sem o caixa nem a quantidade (item 1) não há como tirar o fechamento absoluto dele, mas quem tiver o fechamento de um dia (de qualquer outra fonte) reconstrói os outros por essa série, a menos do CDI do
  caixa. É a "comparação" que a licença deixa publicar, e é o que o ranking precisa mostrar: fica.
- **A carteira do usuário não é API pública e continua devolvendo o último fechamento de cada posição** (`GET /me/portfolio`: sessão, só o dono, `no-store`, `docs/API.md`, seção 9): é "exibir os dados para os
  seus usuários". O que sobra é uma conta que lance um papel só para ler o fechamento dele (até 200 lançamentos, atrás da sessão, do aceite dos termos e do limite de requisições do WAF). Se não for aceito:
  tirar `closeCents` e `closeDate` da posição e deixar o valor e o P&L.
- **O segredo é uma credencial estática.** Quem tiver acesso ao ambiente do `ca-web` ou da `ca-api` (ou ao Key Vault) a lê; o escopo por segredo (ADR 0020) limita isso a dois workloads, e a rotação é um comando
  (RUNBOOK 4.1). Não há rede privada entre o site e a api (o `ca-api` tem ingress externo para o Front Door; fechá-lo exigiria Private Link, só no Front Door Premium, ADR 0003).

## Alternativas consideradas

- **Manter as barras na API pública com `Cache-Control: private` ou sem cache:** descartado. Tirar o cache da borda não tira a rota de "API": continua sendo a série de preços de qualquer papel, sem login.
- **Exigir login na rota das barras:** descartado. O visitante da home e da página da ação não tem conta, e uma rota autenticada para qualquer usuário cadastrado continua sendo uma API de série de preços.
- **Tirar só as `bars` e o `macro.bova11` e deixar as posições de todos os competidores (a primeira versão deste ADR):** descartado pela revisão de segurança. O igual-peso segura o universo inteiro e o BOVA11 um
  papel só, então a lista de posições e o caixa deles devolvem o fechamento de todo papel, todo pregão: a série de preços saiu pela porta dos fundos. As telas do Sorteio e das referências perdem a lista de
  papéis (mostram o patrimônio), que é o preço de fechar isso sem mexer no modelo de dados.
- **Esconder também a série de patrimônio das referências:** descartado. É o retorno normalizado delas (derivado), é o que o ranking e o gráfico comparam, e sem o caixa e a quantidade não dá o fechamento.
- **Degradar só o trecho da página quando a rota de cotações falha ("sem dado" na faixa do BOVA11, seção vazia nas velas):** descartado (item 4). A página sobreviveria, mas o smoke do deploy (a faixa estar na
  home) não veria o defeito, e um segredo desencontrado passaria por "ainda não há barra".
- **Só o derivado na tela (variação e P&L), sem o preço:** descartado. O pedido é que as velas e a faixa do BOVA11 fiquem iguais para o visitante, e a licença deixa exibir.
- **Duas rotas (uma para o BOVA11, uma para as barras de uma ação):** descartado. Uma só, `barras/:ticker`, serve às três telas, e a home só pega os dois últimos fechamentos do que recebe.
- **O site lendo o banco direto:** descartado. O site não tem papel no Postgres (ADR 0028), e dar-lhe um aumentaria a superfície do workload mais exposto.
- **Um token curto assinado por chamada, em vez do segredo estático:** descartado. É o dobro do código para o mesmo modelo de ameaça (o segredo mora no mesmo lugar nos dois lados), e a rotação do segredo estático
  já é um procedimento conhecido (RUNBOOK 4.1).
- **Responder 401 ou 403 em vez de 404:** descartado. O pedido é que a rota não se confirme a quem não a conhece, e o 404 é igual ao de qualquer outra rota que não existe.
