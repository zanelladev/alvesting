# Relatório da T2a (o Explorar, o terminal das ações e as notícias no design premium)

Tarefa `task_d5653509b8d1` (dispatch `ctx_20427a808309`), onda "design premium", 05/11/2026. Rodou em paralelo com a T2b (a carteira, a
conta, o admin, o chat, as telas de entrar e os textos legais). Nada foi commitado nem posto no índice: o trabalho está só no working tree
(`git diff`). Nada no `apps/api`, nenhuma dependência npm nova (o `apps/web/package.json` e o `pnpm-lock.yaml` não são meus nesta leva e não
os mudei), nenhuma rota nova (o dado das telas é o que a api e as rotas internas já entregavam). A demo (4300 e 4310) não foi tocada.

## Resumo

- **O terminal da ação** (`/acoes/[ticker]`), montado com peças grátis (o market terminal da Arc é Pro: não foi lido, baixado nem refeito):
  o cabeçalho com o logo de 40 px, o ticker (o h1), o nome, **o último fechamento e a variação sobre o pregão anterior** (o glifo só nela, a
  Regra do Glifo), a data do dado e o crédito "Cotações: brapi.dev"; **as velas no visual do Candlestick Chart da beUI**, desenhadas no
  servidor (`components/velas.tsx`: o pavio fino e o corpo, a alta vazada e a queda cheia, a grade tracejada, os preços no eixo da direita e
  a linha do último preço com a etiqueta), num painel que fica preso no topo enquanto a coluna do lado rola; e, ao lado no desktop (abaixo
  no celular), **quem tem a ação**, **o que os modelos decidiram** e **as notícias dela**. O realce de um pregão é CSS e mostra só a data.
- **A regra das cotações (ADR 0033) com dentes**: nenhum componente de cliente recebe barra, abertura, máxima, mínima, fechamento ou volume;
  as velas são SVG do servidor, com o resumo em texto. Um teste novo (`e2e/quotes.spec.ts`) lê o HTML da página **e o payload do React** e
  reprova campo de barra (a `RAW_FIELD`) e fechamento do meio da série (escrito ou em centavos). Foi **visto falhar** com dois componentes
  de cliente de mentira (seção 4).
- **O Explorar no desenho do Discover**: os cartões dos competidores (o logo do laboratório, o nome curto, o que ele é, as posições, o
  retorno com o glifo e o percentil), o "simulado" **uma vez por contexto**, o universo da semana em linhas com o logo, o ticker, o
  fechamento e a variação, e o **tooltip da Arc** onde explicar ajuda (o nome inteiro e o percentil no cartão, o que é o universo e, no
  terminal, a confiança).
- **A lista de ações e as notícias**: a sans no lugar da mono (nenhuma mono nas quatro telas) e o logo de cada ação à esquerda do ticker
  nos chips das notícias e no universo da semana (na lista das ações e no cabeçalho da ação ele já estava, da T0b); os fios do Rallies e o
  filtro por ticker como antes.
- **Movimento calmo**: o cartão acende e o conteúdo sobe 2 px, as linhas acendem e as velas recuam sob o véu, tudo em 150 ms com a saída
  forte; nada anima na abertura; com `prefers-reduced-motion`, nada se move (há teste).
- **A prova**: o `pnpm check` com exit 0 (o site com 49 arquivos e 913 testes), o `pnpm build` com exit 0, **o e2e inteiro nos seis
  projetos, um por vez e com 1 worker, com uma falha só, de um teste da T2b** (o `carteira.spec.ts:1527`, repassado a ela), e **os specs das
  minhas telas no build final sem nenhuma falha nos seis**; o Lighthouse com LCP de 2.412 ms, CLS 0 e TBT de 18 ms; o `docs:check` com 75
  itens; o ensaio com o SHA-256 de sempre; o `az` falso sem chamada; a guarda de rede com 6 tentativas ao registro do npm, uma por build,
  bloqueadas (seção 5).

## 1. O que mudou em cada tela

**O terminal da ação** (`app/(app)/(explorar)/acoes/[ticker]/page.tsx`, `components/velas.tsx`):
- O cabeçalho: o logo de 40 px (a T0b já o tinha posto no h1; ele é decorativo, e o nome do h1 continua o ticker), o nome da empresa, e à
  direita **o último fechamento** (26 px) e **a variação sobre o pregão anterior** com o glifo (`data-dir`), a linha "Fechamento do pregão
  de DD/MM/AAAA, com a variação sobre o anterior. Cotações: brapi.dev." e a busca "Buscar outra ação". O fechamento anterior não aparece, só
  a variação: o resto da série fica no desenho.
- O aviso da arena simulada **uma vez** na página (o `AvisoSimulado` da T1a, com os competidores de quem tem a ação e de quem decidiu, sem
  repetir um modelo), e nenhum nome leva a etiqueta.
- **As velas**: antes eram o `CandlesChart` do `components/charts.tsx` (um SVG de 360 × 230, no máximo 384 px de largura, com os preços à
  esquerda dentro do desenho e as velas na tinta e no cinza do texto). Agora são o visual do Candlestick da beUI, de servidor: o SVG de
  `viewBox` 1000 × 280 que estica só na horizontal (o traço que não escala), uma coluna por pregão com a vela no meio, a alta vazada e a
  queda cheia nas cores do dado (a forma diz a direção sem a cor), a grade tracejada (2 6), os preços no eixo da direita em HTML na sans, e
  a linha do último preço tracejada (3 4) na tinta a 45% com a etiqueta do último fechamento no eixo (o marco que ela cobriria some). As
  datas embaixo, em % da largura (no celular, a primeira, a do meio e a última). Embaixo, o resumo em texto (o mesmo da `desc` do SVG: o
  período, o primeiro e o último fechamento com a variação, a mínima e a máxima; com um pregão só, "1 pregão, em DD/MM/AAAA: ..."), a
  legenda das velas e o crédito com a data.
- **O realce de um pregão**: com o mouse sobre o desenho, a coluna do ponteiro fica limpa, com a linha do cursor (a tinta a 30%) e a data
  numa etiqueta no eixo de baixo (`content: attr(data-data)`), e as outras recebem um véu do canvas a 55%, em 150 ms. **Só a data, nenhum
  preço, e nenhuma parada de Tab** (as colunas são `aria-hidden`); nas pontas, a etiqueta se alinha para dentro da figura. No toque nada
  acende.
- **O painel das velas** é o cartão do app (o fio, raio 8, sem sombra) e, quando há duas colunas, fica preso a 24 px do topo enquanto a
  coluna do lado rola. As duas colunas dependem do lugar do principal (uma consulta de contêiner, `@[52rem]`: a partir de 1280 px a barra
  "Explorar" come 300 px dele); abaixo disso, uma embaixo da outra, na ordem da leitura (as velas, os donos, as decisões, as notícias).
- **Quem tem a ação**: era uma tabela de cinco colunas (que na coluna estreita do terminal rolaria dentro da caixa). Agora cada modelo é um
  item da lista, com o nome curto e o logo do laboratório (a T1a) e os quatro números em pares (o valor, o resultado com o glifo, a
  quantidade e o preço médio), numa linha que acende no hover. Só os modelos, como antes (ADR 0033).
- **As decisões dos modelos**: itens de feed (a data com o link do ciclo, o modelo com o logo, a ordem, o percentual, a confiança e a
  justificativa, que quebra a palavra longa). **A confiança é explicada pelo tooltip da Arc uma vez**, na primeira decisão que a tem ("A
  confiança vai de 0 a 1 e é a que o próprio modelo declara na resposta. Ela não muda o tamanho da ordem."): uma parada de Tab, e não uma
  por decisão (são até 20).
- **As notícias da ação**: a lista das notícias (abaixo), com o logo nos chips, e "Todas as notícias de X".

**O Explorar** (`app/(app)/(explorar)/explorar/page.tsx`, `components/arena/explorar.tsx`):
- O título "Explore as carteiras da arena" e a busca, com o fio de uma borda à outra do principal embaixo (como o do Discover).
- **Os cartões** (um por competidor, em duas grades, "Modelos" e "Controle e referências"; uma coluna no celular, duas a partir de 640 px e
  quatro a partir de 1024 px): o logo do laboratório (ou a inicial), **o nome curto numa linha** (o sufixo de versão vai para o leitor de
  tela e para o tooltip), o que o competidor é em até duas linhas, o número de posições (só os modelos têm composição pública; nos outros, o
  traço) e o retorno com o glifo, com **o percentil embaixo**. Sem etiqueta "simulado" em nenhum nome: a nota vai **uma vez**, no cabeçalho
  da grade dos modelos (e nada no Controle e nas referências, que não decidem). No hover o cartão acende no cinza do painel e o conteúdo
  sobe 2 px em 150 ms (o levantar discreto do Discover: sobe o conteúdo, não o cartão, para o ponteiro não sair dele no meio); no toque,
  acende no cinza do trilho. **O tooltip da Arc** em cada cartão de modelo: o nome inteiro e "Percentil X: o retorno ficou acima de X% das
  carteiras sorteadas do Monte Carlo." (a mesma frase da faixa da arena).
- **O universo da semana**: cada papel numa linha com fio, com o logo à esquerda do ticker, o fechamento e a variação com o glifo, em
  colunas (antes: o ticker na mono, sem logo, e a variação entre parênteses junto do fechamento), duas colunas a partir de 640 px e três a
  partir de 1536 px; a linha acende no hover. O começo da frase, "Os papéis que o briefing deu a todos os modelos", é o termo explicado pelo
  tooltip da Arc (as regras do universo, de `docs/METODOLOGIA.md`). A falha só da fita vai para o log e a seção diz que não há.
- **A barra "Explorar"** (de todas as telas do grupo): o acordeão "Populares" (`details`, sem JavaScript) com todos os competidores pelo
  retorno, o nome curto numa linha e a nota "simulado" uma vez; e os grupos (Modelos, Controle e referências, Ações, Notícias).

**A lista de ações** (`app/(app)/(explorar)/acoes/page.tsx`): o ticker na sans 500 (era a mono 600), ao lado do logo que a T0b já tinha
posto dentro do link (a 14 px). A busca, o aviso da busca inválida e o resto como antes.

**As notícias** (`app/(app)/(explorar)/noticias/page.tsx`, `components/news-list.tsx`): **os chips de ticker com o logo da ação à
esquerda** (a 6 px, como os do feed), na sans 500 (eram a mono, sem logo), no `/noticias` e na página da ação (o `NewsList` recebe o índice
dos logos). O item de feed (o fio `hairline`, o título em 15/600, o respiro que dá os 44 px) já era da onda do Rallies; o filtro por ticker,
"Limpar filtro", o aviso do ticker torto e "Mais antigas" como antes.

## 2. As peças e de onde vêm

| Peça | De onde | Onde entra | Como |
|---|---|---|---|
| Velas | beUI, `candlestick-chart` (registro `https://beui.dev/r/candlestick-chart`, lido em 05/11/2026; MIT) | o terminal da ação | **Só o visual**, refeito num componente de servidor (`components/velas.tsx`), sem nenhum código da peça (o dela é de cliente, com o Motion, e receberia a série como prop). Saíram o cursor com as quatro cotações, as setas, o Home e o End (decisão do Artur e do orientador sobre o ADR 0033), o volume (abaixo), a entrada animada e as molas. Linha nova em `docs/DEPENDENCIAS.md`, "Componentes copiados de registros" |
| Tooltip | Arc, `tooltip` (instalado pela fundação em `components/arc/tooltip`, sobre o da Radix) | o cartão do modelo e o termo do universo, no Explorar; a confiança, no terminal | como está (a T1a o usa na faixa da arena com o mesmo `envolver`) |
| Logo do papel | T0b (`components/logo-do-papel.tsx`, `lib/logos.ts`) | as quatro telas | como está: `versoesDosLogos()` no servidor e o `LogoDoPapel` com a versão; sem ela, o monograma |
| Casca do grupo, aviso e nota "simulado", nome curto e logo do laboratório | T1a (`arena/pagina.tsx`: `ComBarra`, `NavegacaoDaArea`, `AvisoSimulado`; `ui.tsx`: `NotaSimulada`; `competidor.tsx`: `Competidor`, `NomeCurto`, `Logo`; `decisions.tsx`: `ActionBadge`) | as quatro telas | como estão |

**Não entraram**: o **controle segmentado da Arc** (a troca entre "Modelos" e "Papéis da semana" não virou escolha dentro da tela: as duas
seções ficam na página, uma embaixo da outra, como as grades do Discover; nada a escolher) e a **escolha do período das velas** (a rota
interna entrega uma janela fixa, `INTERNAL_BARS_LIMIT` = 60 pregões, sem parâmetro; recortar janelas menores no servidor seria só enfeite
sobre o mesmo dado). Nenhuma peça fora da tabela do ADR 0037, então o ADR não mudou.

## 3. Cada critério, com a evidência

| Critério | Evidência |
|---|---|
| O terminal: o cabeçalho com o logo, o ticker, o nome, o último fechamento e a variação (o glifo), a data e o crédito | `arena.spec.ts` ("ação": o fechamento e a variação contra a rota interna, o `data-dir`, a frase da data e do crédito); `components.spec.tsx` (o `UltimoFechamento`: alta, queda e um pregão só); `explorar.spec.ts` (o logo no h1) |
| As velas no visual do Candlestick da beUI, com a linha do último preço | `explorar.spec.ts` ("o desenho": uma vela por pregão com a classe da direção, a linha `data-ultimo` e a etiqueta do último fechamento); `components.spec.tsx` (a geometria e o desenho); as capturas da seção 6 |
| Ao lado no desktop, abaixo no celular: quem tem a ação, as decisões e as notícias | `explorar.spec.ts` (as duas colunas e o painel preso a 24 px no desktop; uma embaixo da outra no celular, na ordem da leitura); `arena.spec.ts` (o conteúdo de cada uma, por igualdade) |
| **A regra das cotações**: a série nunca vai ao navegador como dado; nenhum componente de cliente recebe barra; o resumo em texto; o realce só com a data e sem parada de Tab | `quotes.spec.ts` ("a página da ação não entrega a série de preços", visto falhar com os dois componentes de mentira, seção 4); `components.spec.tsx` ("nenhum fechamento do meio da série aparece no HTML"; o realce `aria-hidden` sem foco); `explorar.spec.ts` (o realce mostra só a data; nada no desenho recebe o foco); `velas.tsx` é de servidor (sem `'use client'`), e o tooltip da Arc, de cliente, recebe só o texto da explicação e o elemento que ele envolve (o cartão, o termo), nenhum preço da série |
| A leitura das quatro cotações pelo cursor fica de fora | não foi feita (seção 7) |
| O Explorar no desenho do Discover: os cartões (o logo do laboratório, o nome sem o sufixo, o "simulado" uma vez) e os papéis da semana (o logo, o ticker, o fechamento e a variação) | `arena.spec.ts` (os cartões e o universo, por igualdade); `explorar.spec.ts` (o "simulado" uma vez por contexto e o nome numa linha); `components.spec.tsx` (o cartão, a barra e o universo) |
| A lista de ações e as notícias: o logo, a sans, os fios e o filtro por ticker como hoje | `arena.spec.ts` e `fixture.spec.ts` (a busca, as notícias e o filtro, como antes); `explorar.spec.ts` ("as quatro telas são todas na sans") |
| O logo à esquerda do ticker nas quatro telas, e o monograma sem logo | `explorar.spec.ts` ("o logo de cada ação à esquerda do ticker, em toda linha com ticker das quatro telas": o primeiro filho do link, a imagem ou o monograma pelo índice da rota interna); `logos.spec.ts` (a T0b) |
| Movimento: 150 ms nos cartões e nas linhas, o realce da vela, o tooltip onde ajuda; nada na abertura; com movimento reduzido nada se move | `explorar.spec.ts` (o cartão em 150 ms e 2 px; o tooltip no cartão, no universo e na confiança; "movimento reduzido": sem transição, sem subir, o véu na hora e nenhuma animação rodando) |
| Mobile primeiro e os dois temas: de 360 a 1920 px sem rolagem, sem barra visível, alvos de 44 px, velas legíveis, axe nos dois temas | `layout.spec.ts`, o laço de `ROUTES` (as quatro telas, com `/acoes?q=MO` e `/noticias?ticker=MOVE3`): 360 px e os 44 px e os dois axe nos seis projetos (`@tema`), 390 a 1920 px nos três claros; `logos.spec.ts` (o axe e a rolagem das telas com monograma); `explorar.spec.ts` (o corpo da vela com pelo menos 2 px no celular) |
| Os docs | `docs/TELAS.md` (as linhas do Explorar, das ações, do terminal e das notícias na tabela das telas; as velas na seção 3; os logos, 4a; os testes, seção 6; o sistema visual e o movimento, seção 10); `docs/DEPENDENCIAS.md` (a linha da beUI `candlestick-chart`); o ADR 0037 não mudou (nenhuma peça fora da tabela) |
| A prova pedida (o check, o build, o e2e, o movimento reduzido, o Lighthouse, os docs, o ensaio, o `az`, a guarda e as capturas) | seções 5 e 6 |

## 4. Os testes

**Vermelho antes do código.** Os testes de unidade das velas (`components.spec.tsx`, "velas: a geometria" e "velas: o desenho e o
cabeçalho") e os do Explorar e dos chips das notícias foram escritos antes e vistos falhar (o `./velas` que não existia; 6 vermelhos nas
peças do Explorar e no chip com o logo). **O teste da regra das cotações** (`e2e/quotes.spec.ts`, "a página da ação não entrega a série de
preços") foi visto falhar no build, com dois componentes de cliente de mentira postos na página da ação e tirados depois:
- o 1º recebia as barras como prop (o que um Candlestick de cliente faria): o teste reprovou com as chaves `bars`, `openCents`, `highCents`,
  `lowCents` e `closeCents` no payload do React (na 1ª versão do teste apareceu também o `open`, que era o `<details open>` da barra: a
  varredura passou a contar só a chave seguida de número, lista ou objeto);
- o 2º recebia só a lista dos fechamentos, sem nome de campo: **a 1ª versão do teste passou** (o buraco: a busca por centavos não pegava o
  número solto numa lista). Corrigi a busca (o número entre os separadores do JSON e do HTML) e o teste reprovou com **58 fechamentos do
  meio da série**. Sem as mentiras, ele passa no build real.

**O que o teste novo confere**: o HTML de `/acoes/MOVE3` e as cadeias de `self.__next_f.push` decodificadas (o fluxo do RSC); nenhuma chave
de objeto que traga número, lista ou objeto bate com a `RAW_FIELD` (a mesma das rotas públicas, que subiu para o topo do arquivo); e nenhum
fechamento do meio da série aparece escrito ("66,17", com ou sem o R$) nem em centavos, fora os que a página mostra por outro motivo (o
primeiro fechamento, a mínima e a máxima do resumo, o preço médio de quem tem a ação, e o fechamento redondo, que pode ser marco do eixo). O
último aparece.

**O `e2e/explorar.spec.ts`** (novo; nos três projetos claros, e os de mouse só no desktop): o "simulado" uma vez por contexto e o nome curto
numa linha; o tooltip da Arc (o nome inteiro e o percentil no cartão, pelo ponteiro; o universo, pelo foco do teclado, e o Esc); o cartão
que acende e sobe 2 px em 150 ms; o logo à esquerda do ticker em toda linha com ticker das quatro telas (a imagem para quem tem logo no
índice da rota interna, o monograma para os outros); a sans em tudo; o terminal (uma vela por pregão com a classe da direção, a linha do
último preço com a etiqueta, nenhuma parada de Tab no desenho, o realce com a data e o véu, a etiqueta da ponta dentro da figura, a
confiança explicada uma vez, as duas colunas com o painel preso a 24 px do topo no desktop e uma embaixo da outra no celular, e o corpo de
cada vela com pelo menos 2 px no celular); e **o movimento reduzido** (`reducedMotion: 'reduce'`: o cartão acende sem transição e não sobe,
o véu troca na hora e nenhuma animação roda na página). As larguras de 360 a 1920 px, os alvos de 44 px e o axe nos dois temas das quatro
telas vêm do laço de `ROUTES` do `layout.spec.ts` (todas estão nele).

**Expectativas que mudaram, com o motivo** (o contrato de DOM mudou junto com o teste):
- `e2e/arena.spec.ts` (as minhas seções): o cartão do Explorar mostra o percentil embaixo do retorno e o nome inteiro sem a etiqueta (o
  "simulado" uma vez por contexto); cada papel do universo é uma linha em colunas (o ticker, o fechamento e a variação), sem os parênteses
  de antes; na ação, o cabeçalho do terminal (o último fechamento e a variação contra a rota interna, com o `data-dir`, a data e o crédito),
  quem tem a ação como itens com os quatro números em pares (era uma tabela, que na coluna estreita rolaria) e as decisões sem a etiqueta no
  nome (a página avisa uma vez).
- `components.spec.tsx` e `lib/chart.spec.ts`: os testes da geometria das velas saíram do `chart.spec.ts` com o `layoutCandles` e foram para
  o bloco "velas" (`layoutVelas`, a coluna por pregão no `viewBox` de 1000); o resumo de um pregão só diz "1 pregão, em DD/MM/AAAA" (era "1
  pregões, de X a X").
- `e2e/fixture.spec.ts` (três linhas, com o aval do coordenador): o resumo de uma barra espera "1 pregão" (o singular), e não "1 pregões".
- `e2e/logos.spec.ts` (uma linha, da T0b, com o aval do coordenador): o teste de que as páginas só pedem coisa ao próprio site procurava
  `img[src^="/logos/MOVE3.svg"]` na página inteira, em modo estrito; agora o chip de cada notícia da ação também tem o logo dela, e o teste
  procura o logo no cabeçalho (`h1`), como o coordenador pediu (sem depender da ordem do DOM).
- Dois defeitos meus achados no e2e e corrigidos no próprio teste: a altura do nome "numa linha" era comparada com 24 px fixos (o nome do
  cartão é de 15 px em 24 de linha: dava 24, igual ao limite); agora a conta é a altura sobre a altura da linha (< 1,5). E o tooltip da
  Radix com o balão alcançável (WCAG 1.4.13) só fecha num movimento do ponteiro fora da área de passagem: o `page.mouse.move(0, 0)` salta de
  uma vez e para na ponta dela, e o balão ficava aberto; o ponteiro agora sai em passos (`{ steps: 10 }`). O `carteira.spec.ts` da T2b tem o
  mesmo padrão e reprovava pelo mesmo motivo: o coordenador repassou à T2b.

## 5. Os comandos e os resultados

Todos com o ambiente da onda: o Node 26.13 do nvm, o `az` falso no `PATH`, a guarda de rede no `NODE_OPTIONS` com o meu log
(`.data/guardas/t2a-explorar-rede.log`) e o aviso de versão do pnpm desligado; e os pesados sob a trava (`.data/trava-pesada`,
"t2a-explorar"), com o disco acima de 58 GB livres em todo começo. A trava ficou comigo nas capturas de antes (por volta das 15:42), nos
builds com as mentiras (16:10 a 16:12) e das 16:40 às 17:24 (o resto).

| O quê | Comando | Resultado |
|---|---|---|
| Unidade, tipos e lint do site, durante o trabalho (sem a trava) | `pnpm --filter @alvesting/web test`, `tsc --noEmit`, `eslint`, `prettier --write` em cada arquivo gravado | verde; os testes novos vistos falhar antes (seção 4) |
| Build do site | `pnpm --filter @alvesting/web build` | exit 0 às 16:10 e 16:11 (com os componentes de mentira), 16:40, 16:48 e **17:14 (o final)**; às 16:12 reprovou só pelo `wallet-lots.tsx` da T2b, ainda em obra (`error TS2322`), e avisei o coordenador |
| O teste das cotações contra as mentiras | `playwright test --workers=1 --project=desktop e2e/quotes.spec.ts` (16:10 a 16:12) | vermelho com a 1ª (as chaves `bars`, `openCents`, `highCents`, `lowCents`, `closeCents`), verde com a 2ª na 1ª versão do teste (o buraco), vermelho com a 2ª depois da correção (58 fechamentos) |
| O e2e inteiro, os seis projetos, um por vez, com 1 worker | `pnpm --filter @alvesting/web exec playwright test --workers=1 --project=<projeto>` (16:50 a 17:09, no build das 16:48) | **desktop: 510 passaram, 3 pulados, 1 falhou** (o `carteira.spec.ts:1527` da T2b, abaixo); **pixel-7: 498, 16 pulados**; **iphone-15: 498, 16 pulados**; **desktop-escuro: 162**; **pixel-7-escuro: 161, 1 pulado**; **iphone-15-escuro: 161, 1 pulado**. Os pulados: os de sempre (o login do smoke; nos de toque, os de teclado e mouse da arena, da carteira, do layout, do hero e do tema) e os meus de mouse nos de toque (o tooltip do cartão e do universo, o levantar do cartão, o realce, a confiança e o movimento reduzido do hover) e o de celular no desktop (a vela legível) |
| Os specs das minhas telas no build final | o mesmo comando com `e2e/explorar.spec.ts e2e/quotes.spec.ts e2e/logos.spec.ts e2e/layout.spec.ts e2e/arena.spec.ts e2e/fixture.spec.ts` (17:14 a 17:20, no build das 17:14) | **nenhuma falha**: desktop 203 e 2 pulados; pixel-7 194 e 11; iphone-15 194 e 11; desktop-escuro 55; pixel-7-escuro 55; iphone-15-escuro 55 |
| O `tema.spec.ts:75` sozinho, três vezes | `playwright test --workers=1 --project=desktop e2e/tema.spec.ts:75` (17:00) | três vezes "2 passed" (seção 7) |
| Lighthouse | `pnpm lighthouse` (17:10) | **exit 0**: LCP 2.412 ms (2.404 a 2.429), CLS 0, TBT 18 ms (seção 6) |
| `docs:check` | `pnpm docs:check` | "docs:check ok: 75 itens documentados em docs/DEPENDENCIAS.md" (o script confere os pacotes npm, as imagens Docker e as actions, e nenhum mudou; a linha das velas está na tabela dos componentes copiados, que ele não lê) |
| `pnpm check` | `TEST_DATABASE_URL=…/alvesting_t2a_explorar_test pnpm check`, com o Azurite do compose (17:21 a 17:23) | **exit 0**: o lint e "All matched files use Prettier code style!"; os tipos; os testes: o site **49 arquivos e 913 testes**, os contratos **13 e 501**, a api **154 arquivos (2 pulados) e 3.153 testes (9 pulados)**, os `scripts/*.test.mjs` com 131 e nenhuma falha; o `docs:check` com 75 itens |
| Ensaio | `ENSAIO_DATABASE_URL=…/alvesting_t2a_explorar_ensaio pnpm --filter @alvesting/api arena:ensaio` (17:24) | **exit 0**, "RESULTADO: OK"; o `.data/ensaio/relatorio-s1-p5.txt` (22.068 bytes) com o SHA-256 **`081d860b31b6c69997424d92beacc190eefed498835b61e2ebe9b442d8891f12`**, o de sempre. Os meus dois bancos (`alvesting_t2a_explorar_test` e `alvesting_t2a_explorar_ensaio`) foram apagados no fim, no `alvesting-postgres-1` |
| O `az` falso | `.data/guardas/az-stub/calls.log` | **vazio** (0 linhas) |
| A guarda de rede | `.data/guardas/t2a-explorar-rede.log` | **6 linhas, todas bloqueadas**: `TCP registry.npmjs.org`, de seis processos, **uma por build** (fiz seis `pnpm --filter @alvesting/web build`; a T1a fez quatro e teve quatro linhas). Nenhum teste, servidor ou código do site tentou rede: o `pnpm exec`, o `pnpm docs:check` e os servidores com a guarda não reproduzem a linha. Não achei a origem exata dentro do build (não é o remendo de lockfile do Next, que só age com um `package-lock.json`, e não há nenhum acima do repositório). Não está vazio como o pedido pede; fica dito aqui |

## 6. O Lighthouse e as capturas

**O Lighthouse** (`pnpm lighthouse`, 5 coletas, mediana, às 17:10, no build das 16:48): **LCP 2.412 ms** (2.404 a 2.429), **CLS 0**, **TBT
18 ms** (14 a 24). O teto de 2,5 s passou com 88 ms de folga: sem A/B. O que a landing baixa na coleta mediana (no fio e cru): JavaScript
151.773 B em 10 arquivos (478.769 B crus), CSS 16.178 B (93.211 B crus, o arquivo único do site), documento 39.478 B (171.123 B). Nenhum
componente de cliente das minhas telas entra na landing (as velas são de servidor, e o tooltip só carrega onde é usado). **O peso do meu
bloco no CSS único**: 31 regras, 6.037 B crus e uns **494 B no fio** (o gzip do arquivo com e sem as regras dele). O build final (o das
17:14, que só trocou uma classe de alinhamento no cartão) gerou o **mesmo arquivo de CSS, byte a byte** (o mesmo nome com o hash e os mesmos
93.211 B: a `items-start` já existia), então a medida vale para ele.

**As capturas** (o build final; `docs/redesign-premium/explorar/`): as quatro telas em 1440 × 900 e 390 × 844, nos dois temas (`explorar-*`,
`acoes-*` com a busca `?q=MO`, `acao-*` com o MOVE3 e `noticias-*`), o realce de um pregão (`acao-1440-claro-realce.png` e
`acao-1440-escuro-realce.png`, só a figura) e o tooltip do cartão no hover (`explorar-1440-claro-dica.png` e
`explorar-1440-escuro-dica.png`). As de antes estão em `antes/`, tiradas no começo da tarefa sobre o build final da T1a.

**Contra o Discover do Rallies** (`.data/rallies-referencia/discover-1440-*.jpeg` e `discover-390-*.jpeg`): o mesmo esqueleto, com a barra
de 300 px com o acordeão "Populares" e os grupos com a seta, o título em duas linhas, a busca com o fio de uma borda à outra e a grade de
quatro colunas. Cada cartão tem o logo, o nome, a descrição em duas linhas e a linha dos números (Posições e Retorno, como o Holdings e o
YTD Return dele) sobre um fio. Onde ficamos diferentes de propósito:
- a busca é um campo com o botão "Buscar", que funciona sem JavaScript;
- o topo não tem ilustração (o `docs/PRODUCT.md` pede calma, e a arte mora na moldura da landing);
- o percentil fica embaixo do retorno;
- a nota "simulado" aparece uma vez por contexto, e o glifo só no retorno;
- a primária `#14144C` só na marca do trilho e no foco (o item ativo do trilho é o cinza do trilho; correção do fechamento da onda, M15 da
  revisão de código).

**Contra as de antes**, tela a tela:
- **O Explorar**: os nomes cabem numa linha, sem etiqueta e sem sufixo; antes, "Qwen3.8 Max (0902) simulado" quebrava em duas linhas nos
  populares e nos cartões. Os rótulos e os valores do cartão ficam alinhados, e o percentil é novo. No universo, o ticker na sans com o
  logo, e o fechamento e a variação em colunas.
- **O terminal**: as velas enchem o painel, quando antes o desenho tinha no máximo 384 px, com o resumo ao lado. O último fechamento e a
  variação ficaram no cabeçalho. Do lado, itens compactos no lugar da tabela de cinco colunas, que tinha a etiqueta em cada nome.
- **A busca e as notícias**: a sans no lugar da mono, e o logo nos chips.

## 7. Desvios e decisões

- **O volume não entrou** nas velas, embora o pedido o peça embaixo delas: a rota interna das barras (`GET /api/v1/interno/barras/:ticker`)
  entrega só a data, a abertura, a máxima, a mínima e o fechamento (o schema estrito `internalBarsSchema`), e o volume do banco é estimado.
  Mostrá-lo pediria um campo novo na rota interna, no `apps/api`, que não é meu nesta leva ("nenhuma rota nova"). Fica para depois (seção
  8).
- **A leitura das quatro cotações de cada dia pelo cursor** não foi feita, como o pedido manda: é decisão do Artur e do orientador sobre o
  ADR 0033.
- **A escolha do período** e **o segmentado** não entraram (seção 2).
- **A confiança explicada uma vez**, e não em cada decisão: até 20 paradas de Tab iguais seriam ruído para quem navega pelo teclado; o termo
  é o mesmo em todas as decisões.
- **A troca do `charts.tsx`**: o arquivo só tinha o `CandlesChart` (a T1a levou o resto para `components/beui/`) e saiu inteiro; o
  `lib/chart.ts` perdeu o `layoutCandles` e o tipo `Bar` (a geometria nova mora com o desenho, em `velas.tsx`) e passou a exportar o
  `xLabelsOf` e o `yScale`, que as velas usam.
- **A única falha do e2e inteiro é da T2b**: o `carteira.spec.ts:1527` ("os termos com explicação", no desktop) espera o tooltip fechar
  depois de `page.mouse.move(0, 0)`, e o tooltip da Arc (a Radix com o balão alcançável) só fecha num movimento fora da área de passagem; o
  salto de uma vez para o ponteiro na ponta dela. Os meus três testes de tooltip tinham o mesmo defeito e foram corrigidos
  (`{ steps: 10 }`); o do `carteira.spec.ts` é da T2b, e o coordenador repassou a ela. Não mexi nele.
- **O `tema.spec.ts:75`** ("sistema" segue o `prefers-color-scheme`, em `/`; da fundação) reprovou uma vez no e2e inteiro do desktop (a
  escolha "Claro" não tinha valido quando o teste conferiu, sem esperar) e passou nas três rodadas sozinho, como o coordenador pediu:
  oscila; não mexi nele (fica para o fechamento). Saídas das três rodadas sozinho (`playwright test --workers=1 --project=desktop
  e2e/tema.spec.ts:75`, que pega o teste em `/` e em `/ranking`): "2 passed (9.3s)", "2 passed (9.2s)" e "2 passed (9.2s)"; e ele passou de
  novo no 2º e2e inteiro dos seis projetos.
- **O e2e inteiro foi no build das 16:48.** Depois dele, a revisão das capturas achou os rótulos "Posições" e "Retorno" do cartão do
  Explorar desalinhados (o percentil embaixo do retorno empurrava a coluna da direita para cima), e a troca de `items-end` por `items-start`
  na linha dos números entrou no build das 17:14. Para não segurar a trava mais 20 minutos por uma classe de alinhamento, rodei de novo
  nesse build os specs das minhas telas nos seis projetos (sem falha, seção 5) e refiz todas as capturas; o CSS gerado é o mesmo, byte a
  byte.

## 8. O que fica para depois

- O volume embaixo das velas: pede o campo na rota interna (e decidir se o volume estimado do banco serve).
- A leitura das quatro cotações pelo cursor (o Candlestick da beUI de cliente): depende da decisão sobre o ADR 0033.
- O `tema.spec.ts:75` que oscila no e2e inteiro (da fundação).

## 9. Os arquivos tocados

**O site** (`apps/web`):
- `src/app/(app)/(explorar)/acoes/[ticker]/page.tsx`: o terminal.
- `src/app/(app)/(explorar)/explorar/page.tsx`: as duas grades, o tooltip do cartão e o do universo.
- `src/app/(app)/(explorar)/acoes/page.tsx`: o ticker na sans.
- `src/app/(app)/(explorar)/noticias/page.tsx`: o índice dos logos para a lista.
- `src/components/velas.tsx` (novo): as velas e o cabeçalho do terminal (`Velas`, `UltimoFechamento`, `layoutVelas`).
- `src/components/charts.tsx` (removido): só tinha o `CandlesChart`.
- `src/components/arena/explorar.tsx`: o cartão, a barra e o universo.
- `src/components/news-list.tsx`: o logo e a sans nos chips.
- `src/lib/chart.ts` (por trechos): saíram o `layoutCandles` e o tipo `Bar`; o `xLabelsOf` e o `yScale` passaram a ser exportados.
- `src/lib/chart.spec.ts` (por trechos): saíram os testes das velas, que foram para o `components.spec.tsx`.
- `src/components/components.spec.tsx` (por trechos): os blocos "explorar", "velas: a geometria" e "velas: o desenho e o cabeçalho", e o
  chip com o logo no `NewsList`.
- `src/app/globals.css`: só o bloco "explorar (T2a, design premium)", entre o comentário de abertura e o "fim do bloco explorar (T2a)".
- `e2e/explorar.spec.ts` (novo).
- `e2e/arena.spec.ts` (as seções do Explorar e da ação).
- `e2e/quotes.spec.ts` (o teste novo; a `RAW_FIELD` subiu para o topo do arquivo, para os dois testes).
- `e2e/fixture.spec.ts` (três linhas) e `e2e/logos.spec.ts` (um trecho), com o aval do coordenador (seção 4).

**Os docs**:
- `docs/TELAS.md` (por trechos: as linhas do Explorar, das notícias, das ações e do terminal na tabela das telas; as velas, na seção 3; onde
  está o logo, 4a; os testes, seção 6; o sistema visual e o movimento, seção 10).
- `docs/DEPENDENCIAS.md` (a linha da beUI `candlestick-chart`, em "Componentes copiados de registros").
- `docs/redesign-premium/explorar/` (as capturas: `antes/` e as de depois).
- `docs/redesign-premium/relatorios/explorar.md` (este relatório).

Fora do repositório (o scratchpad da sessão): os scripts dos servidores e das capturas, os logs e o item do registro da beUI lido para as
velas. Os dois componentes de mentira do teste das cotações entraram no repositório só para as compilações de prova e saíram em seguida
(nenhum resto: `grep -ri mentira apps/web/src` acha só um comentário antigo do seletor de tema).
