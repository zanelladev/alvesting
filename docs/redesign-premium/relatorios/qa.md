# Relatório da T3b (QA ao vivo, onda "design premium"): o site no celular e no computador, nos dois temas e com o seletor

Tarefa `task_0f556d5f6bdf` (dispatch `ctx_a5ac091bf822`), 05/11/2026, das 17:55 às 18:55 (horário de Brasília). Usei o site de verdade, a demo
do Artur (`next dev` em http://127.0.0.1:4300, com a api em 4310 e o banco do ensaio: a temporada "ensaio" encerrada, de 20 pregões, os seis
modelos simulados, o último ciclo em 01/12/2026), pelo Playwright do projeto, e listo o que está quebrado, ilegível, feio ou "barato" para a
tarefa de fechamento consertar. **Não consertei nada**: no repositório escrevi só este relatório e as capturas dos achados
(`docs/redesign-premium/qa/`). Nada foi commitado nem posto no índice. A demo não foi parada nem reiniciada, e nenhum dado dela mudou além da
sessão do login da demo, aberta no começo e encerrada no fim com o "Sair" (seção 1). Rodou em paralelo com a T3a (a revisão de código).

## Resumo

**17 achados: 2 que bloqueiam, 4 importantes e 11 menores.** Nenhum é de um tema só: todos valem no claro e no escuro, e o tema escolhido
pelo seletor ou guardado no navegador pinta exatamente como o do sistema (seção 4.3).

- **Bloqueiam**: (1) em 360 px a `/arena`, a `/arena?filtro=SELL` e o `/ranking` rolam de lado (366 px): as tabelas das carteiras não cabem, a
  coluna "Resultado %" sai cortada e a barra de abas estica; (2) no celular, a leitura do gráfico do patrimônio (o painel com os valores do
  pregão) **não fecha com o toque fora nem com a rolagem**, no Chromium com toque e no WebKit do iPhone 15, e fica cobrindo o gráfico (o
  telefone não tem Esc).
- **Importantes**: (3) os nomes no fim das linhas do gráfico "Posição por pregão" saem cortados ("Gemini 4 Argo", "BOVA11 (con"), em toda
  largura; (4) as tabelas cortam as últimas colunas sem nenhum sinal de que há mais à direita (o ranking em toda largura, até 1920 px; no
  celular, a tabela da landing esconde o "Percentil", o dado do painel "Sorte ou habilidade?"); (5) o título da página do DeepSeek quebra em
  duas linhas até em 1440 px ("DeepSeek V4" / "Pro (0813)"), com a segunda linha embaixo do logo; (6) o botão primário das telas de
  formulário (entrar, criar conta, esqueci a senha, carteira, admin) nasce cinza e esmaece para o azul logo depois do carregamento.
- **Menores**: (7) "Decisões | Carteiras" na arena parecem abas, mas são âncoras e nenhuma fica marcada; (8) a paginação "Mais antigas" usa a
  primária; (9) duas pílulas primárias "Lançar compra" na carteira; (10) a data do cursor cobre o rótulo do eixo no gráfico do patrimônio;
  (11) a série que a legenda mostra só esmaece em 150 ms, não se desenha; (12) o selo "[ok] fechado" do ciclo no verde do dado, com borda;
  (13) o cabeçalho do site troca de cor na hora e a pílula "Entrar" não encolhe no toque; (14) no desktop, o clique fora do menu "Mais" fecha
  e segue o link de baixo; (15) o anel de foco do cartão da faixa que encosta no "›" fica embaixo do botão; (16) "Resultado %" em duas linhas
  no cabeçalho das carteiras; (17) os nomes quebram em duas e três linhas nas tabelas do ranking no celular.
- **O que passou** (seção 4): **o axe sem nenhuma violação, de qualquer gravidade, em 292 análises** (as 27 telas em 360, 390, 1024, 1440 e
  1920 px nos dois temas, e as 11 principais no iPhone 15); **o tema nos três jeitos** (o sistema, a escolha guardada e o seletor nos três
  lugares) com zero diferença de cor elemento a elemento, a revelação em círculo de 250 ms, nenhuma transição de cor durante a troca (sem o
  "borrão"), a escolha que sobrevive ao recarregar e a página que já nasce no tema certo, mesmo com o JavaScript do Next bloqueado; **nenhuma
  barra de rolagem à vista** no Chromium com as barras desenhadas, e a rolagem funcionando pela roda, pelo teclado e pelo toque; nenhuma
  rolagem horizontal fora do achado 1, nenhum texto por cima de outro (fora o 10), nenhum alvo abaixo de 44 × 44 px; o trilho com o item certo
  nas 72 combinações; as folhas "Mais" e "Menu" fechando no Esc; o anel de foco na primária nos dois temas; a regra das cotações no terminal
  (nenhuma tabela de preços, o realce só com a data, o HTML sem a série de fechamentos); o `/chat` sem nenhum pedido; os campos com 16 px e os
  erros com `role="alert"`; nada animando na abertura fora o que foi decidido (a escadaria a partir de 1024 px, a fita) e o achado 6; o
  movimento reduzido trocando tudo na hora.

## 1. Como foi feito

- **As ferramentas**: o `@playwright/test` 1.64.1 do `apps/web` (o Chromium 156.0.8078.4 e o WebKit 27.2 do iPhone 15) e o
  `@axe-core/playwright` de lá. Um navegador por vez, fechado no fim de cada script. Os scripts ficaram em `.data/orquestracao/premium/qa/`
  (fora do git), com base nos da onda anterior (`.data/orquestracao/rallies/qa/`): `comum.mjs` (as telas, as larguras e o contexto),
  `medir.mjs` (o que roda dentro da página), `entrar.mjs`, `varredura.mjs`, `axe.mjs`, `tema.mjs`, `pintura.mjs`, `interacao.mjs`,
  `graficos.mjs`, `rolagem.mjs`, `toque.mjs`, `sondas1.mjs` a `sondas4.mjs`, `wk.mjs`, `evidencias.mjs` e `sair.mjs`; o que cada um mediu está
  em `out/*.ndjson`, que deixei lá como registro das medidas.
- **As barras de rolagem**: o Chromium abre com `ignoreDefaultArgs: ['--hide-scrollbars']`. Conferi antes que ele desenha as barras clássicas
  de 15 px como no Chrome do Artur (uma caixa de teste com `overflow: scroll` e `scrollbar-width: auto`: `offsetWidth` 200 e `clientWidth`
  185; sem a opção, 200 e 200). A medida de cada tela compara o `offsetWidth` com o `clientWidth` de cada caixa que rola e da página.
- **O contexto**: de 360 a 412 px, o celular (`isMobile`, toque e o agente do Pixel 7); de 768 px para cima, o Chrome do desktop. O iPhone 15 é
  o aparelho do Playwright (393 × 659, WebKit). O indicador do `next dev` escondido (`nextjs-portal{display:none!important}`) em toda página.
  A espera: o `h1`, as fontes, o rodapé com a data das cotações e a rede parada.
- **O tema, de três jeitos**: (a) o sistema, pelo `colorScheme` do contexto, em todas as medidas; (b) a escolha guardada, com o
  `localStorage` `tema` posto por `addInitScript` contra o `colorScheme` oposto; (c) o seletor, com um clique (desktop) ou um toque
  (celular) em Escuro, um recarregar, Claro e Sistema, no pé do trilho (desktop), na folha "Mais" (celular) e no cabeçalho do site (desktop e,
  abaixo de 1024 px, na folha "Menu"). Em (b) e (c), a "impressão" das cores de cada elemento visível (a cor, o fundo, as bordas, o contorno,
  o `fill`, o `stroke`, a sombra, a imagem de fundo, o filtro, a opacidade e os `::before` e `::after`) foi comparada com a do sistema no
  mesmo tema, elemento a elemento.
- **A varredura** (17:59 a 18:08): as 27 telas do pedido (as 24 sem sessão e a `/conta`, a `/carteira` e o `/admin` com a sessão da demo) × 360,
  390, 412, 768, 1024, 1280, 1440 e 1920 px × claro e escuro = **432 combinações** no Chromium, e as 11 telas principais × os dois temas no
  iPhone 15 = **22**. Em cada uma: a rolagem horizontal (`scrollWidth` do `html` e do `body` contra o `clientWidth`) e o elemento que passa da
  largura; as barras de rolagem desenhadas; o texto cortado (caixa que corta, reticências, `line-clamp`); o texto por cima de texto (as
  caixas de linha de cada nó de texto, por `Range.getClientRects`); os alvos abaixo de 44 px; cada nome de competidor com o logo, a linha e a
  etiqueta; cada "simulado" à vista e onde mora; a primária (cada elemento cuja cor, fundo, borda, contorno, `fill` ou `stroke` é um tom da
  escala); a mono fora do hash e do código; a transição de `all`; a cor crua em atributo de SVG ou em `style`; as animações no `load` e
  depois da espera (`document.getAnimations()`); o CLS (`layout-shift`); a moldura de 1.550 px; o contraste do logo no círculo; a navegação e
  o item marcado; no celular, o rodapé contra a barra de abas; os erros de console e os pedidos que falham. O quadro e a página inteira de
  cada combinação ficaram em `shots/` para a revisão a olho, comparada com as capturas do Rallies em `.data/rallies-referencia/` e com as
  "depois" das tarefas em `docs/redesign-premium/*/`.
- **O axe** (18:09 a 18:13 e 18:41 a 18:44): todas as regras e todas as gravidades, depois de 400 ms parado (as transições de 150 a 250 ms
  terminam antes da leitura das cores): as 27 telas × 360, 390, 1024, 1440 e 1920 px × os dois temas = **270** no Chromium e as 11 principais
  × os dois temas = **22** no iPhone 15.
- **As interações**: o tema (as 10 telas principais que têm seletor × 1440 e 390 no Chromium e 8 no iPhone, mais a primeira pintura em 5 telas
  × as duas escolhas × os dois motores); o 308 do `/?filtro=SELL`; o trilho em 1024, 1440 e 1920 (12 telas × 2 temas); o menu e a folha "Mais";
  a folha "Menu" do site em 390, 768 e no iPhone; os 31 links da navegação; o teclado (40 Tabs em 12 telas × 390 e 1440 px × 2 temas, com o
  contorno, a cor dele em sRGB, a barra do pé e a caixa que corta de cada parada); os gráficos (o cursor, o painel, o contador, a legenda, o
  teclado, o toque, o gráfico de posições); o tooltip; o terminal da ação contra as 60 barras do DOBR4 lidas no banco do ensaio (só
  `SELECT`); o hover e o toque de cada peça; o movimento reduzido; a rolagem pela roda, pelo teclado e pelo gesto de toque do CDP; a arte; o
  `/chat`; os campos.
- **A sessão e os envios**: um login só, pelo formulário da `/entrar` (17:58), reaproveitado. Além dele, os únicos envios foram os de erro
  proposital (o e-mail inválido na `/entrar`, na `/esqueci-senha` e na `/cadastro`; a quantidade "abc" no formulário de lançar da carteira),
  com uma rede de segurança que abortava todo pedido à api que não fosse `GET`: **nenhum pedido foi abortado**, porque o próprio formulário
  barrou cada um antes de enviar. No fim (18:46), o "Sair" da `/conta` encerrou a sessão (depois dele a `/conta` manda para a entrada), e o
  `estado.json` foi apagado. Nada foi lançado, editado, apagado, aceito, exportado nem excluído, e nenhuma ação do `/admin` foi usada.

## 2. A matriz

Cada célula vale para o claro **e** o escuro: as 432 combinações foram medidas nos dois temas, e nenhum achado aparece num tema só (o 12 só
fica mais forte no escuro). O tema veio do sistema; a escolha guardada e o seletor pintam igual (seção 4.3), então a matriz vale para os três
jeitos. "ok": nenhum achado ali. Os números são os da seção 3. Ficam fora da matriz, por valerem para toda tela de uma casca: o **13** (o
cabeçalho do site, a partir de 1024 px, e a pílula "Entrar" na folha "Menu") e o **14** (o menu "Mais" do app, a partir de 1024 px). O iPhone 15
foi medido só nas 11 telas principais ("—" nas outras).

| Tela | 360 | 390 | 412 | 768 | 1024 | 1280 | 1440 | 1920 | iPhone 15 |
|---|---|---|---|---|---|---|---|---|---|
| `/` | 4, 17 | 4, 17 | 4, 17 | 15 | 15 | 15 | 15 | 15 | 4, 17 |
| `/como-funciona` | ok | ok | ok | ok | ok | ok | ok | ok | — |
| `/arena` | 1, 2, 7, 8, 10, 11, 16 | 2, 7, 8, 10, 11, 16 | 2, 7, 8, 10, 11 | 7, 8, 10, 11, 15 | 7, 8, 10, 11, 15 | 8, 10, 11, 15, 16 | 8, 10, 11, 15, 16 | 8, 10, 11, 15, 16 | 2, 7, 8, 10, 16 |
| `/arena?filtro=SELL` | 1, 2, 7, 8, 10, 11, 16 | 2, 7, 8, 10, 11, 16 | 2, 7, 8, 10, 11 | 7, 8, 10, 11, 15 | 7, 8, 10, 11, 15 | 8, 10, 11, 15, 16 | 8, 10, 11, 15, 16 | 8, 10, 11, 15, 16 | — |
| `/ranking` | 1, 3, 4, 16, 17 | 3, 4, 16, 17 | 3, 4, 17 | 3, 4, 17 | 3, 4 | 3, 4, 16 | 3, 4, 16 | 3, 4, 16 | 3, 4, 17 |
| `/modelos/claude-opus-5-5` | 2, 4, 10 | 2, 4, 10 | 2, 10 | 10 | 10 | 10 | 10 | 10 | — |
| `/modelos/deepseek-v4-pro` | 2, 4, 5, 10 | 2, 4, 5, 10 | 2, 5, 10 | 5, 10 | 5, 10 | 5, 10 | 5, 10 | 5, 10 | 2, 4, 5, 10 |
| `/modelos/qwen3-8-max` | 2, 4, 5, 10 | 2, 4, 5, 10 | 2, 10 | 10 | 10 | 10 | 10 | 10 | — |
| `/modelos/sorteio` | 2, 10 | 2, 10 | 2, 10 | 10 | 10 | 10 | 10 | 10 | — |
| `/modelos/cdi` | 2, 10 | 2, 10 | 2, 10 | 10 | 10 | 10 | 10 | 10 | — |
| `/ciclos/2026-12-01` | 12 | 12 | 12 | 12 | 12 | 12 | 12 | 12 | — |
| `/explorar` | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `/acoes` | ok | ok | ok | ok | ok | ok | ok | ok | — |
| `/acoes?q=SI` | ok | ok | ok | ok | ok | ok | ok | ok | — |
| `/acoes/DOBR4` | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `/noticias` | 8 | 8 | 8 | 8 | 8 | 8 | 8 | 8 | — |
| `/noticias?ticker=DOBR4` | ok | ok | ok | ok | ok | ok | ok | ok | — |
| `/chat` | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `/termos` | ok | ok | ok | ok | ok | ok | ok | ok | — |
| `/privacidade` | ok | ok | ok | ok | ok | ok | ok | ok | — |
| `/entrar` | 6 | 6 | 6 | 6 | 6 | 6 | 6 | 6 | 6 |
| `/cadastro` | 6 | 6 | 6 | 6 | 6 | 6 | 6 | 6 | — |
| `/esqueci-senha` | 6 | 6 | 6 | 6 | 6 | 6 | 6 | 6 | — |
| `/rota-que-nao-existe` (404) | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `/conta` (sessão) | ok | ok | ok | ok | ok | ok | ok | ok | ok |
| `/carteira` (sessão) | 6, 9 | 6, 9 | 6, 9 | 6, 9 | 6, 9 | 6, 9 | 6, 9 | 6, 9 | 6, 9 |
| `/admin` (sessão) | 4, 6 | 4, 6 | 4, 6 | 4, 6 | 4, 6 | 6 | 6 | 6 | — |

Na página do modelo, o 4 em 360 e 390 px é a tabela das posições (Claude, DeepSeek e Qwen; o Sorteio e o CDI não têm composição pública).
O 2, o 10 e o 11 pedem a interação com o gráfico (o toque, o ponteiro, a legenda) e o 15 o foco do teclado; os outros se veem ao abrir a tela.

## 3. Os achados

Cada achado diz a tela, a largura, o tema e o navegador, o que está errado, o passo para ver, a gravidade, a captura e o conserto sugerido. Em
todos, o tema foi o do sistema, nos dois; a escolha guardada e o seletor dão a mesma pintura (seção 4.3).

### Bloqueiam

**1. Em 360 px a arena e o ranking rolam de lado: as tabelas das carteiras não cabem.**
- **Onde**: `/arena`, `/arena?filtro=SELL` e `/ranking`, em 360 px, claro e escuro, no Chromium (o Pixel 7 em 360 × 800). Em 390, 412 e no
  iPhone 15 (393) cabe.
- **O que está errado**: o documento fica com 366 px numa tela de 360 (`scrollWidth` 366, o do `body` 365). As tabelas das carteiras (Ação,
  Alocação, Resultado e Resultado %, com as células em `nowrap`) têm de 331 a 345 px numa coluna de 320: a do GPT-6.1 Sol vai a 345 por causa
  do "-R$ 1.330,30". A coluna "Resultado %" encosta na borda direita sem respiro e o cabeçalho dela quebra ("RESULTADO" / "%"); a página
  inteira passa a rolar de lado, e a barra de abas, que é fixa na largura da página, estica até 366 px, com o "Conta" saindo da tela.
- **Passo**: abrir a `/arena` num celular de 360 px e descer até "Carteiras"; `document.documentElement.scrollWidth` dá 366.
- **Gravidade**: bloqueia (quebra no celular; "nenhuma rolagem horizontal de 360 a 1920 px" é regra do TCC).
- **Captura**: `docs/redesign-premium/qa/01-arena-360-claro.png`, `01-ranking-360-escuro.png`.
- **Conserto sugerido**: fazer a tabela da carteira caber em 320 px: o resultado em reais com quebra permitida (ou sem o "R$" dentro da célula,
  com a unidade no cabeçalho), menos respiro entre as colunas abaixo de 390 px, ou a "Alocação" fora da tabela abaixo de 390 (ela já é o anel
  ao lado do número). Um teste de 360 px na `/arena` e no `/ranking` que desça até as carteiras pegaria a volta.

**2. No celular, a leitura do gráfico do patrimônio não fecha com o toque fora.**
- **Onde**: o gráfico "Patrimônio por pregão" da `/arena` e da página do DeepSeek (medidos), de 360 a 412 px e no iPhone 15, claro e escuro, no
  Chromium com toque e no WebKit; as outras páginas de modelo, do Sorteio e do CDI usam a mesma peça (`components/beui/line-chart.tsx`).
- **O que está errado**: o toque no gráfico abre o painel com os valores do pregão (certo). Depois, o toque fora (no título "Patrimônio", no
  título da página; duas vezes) e a rolagem da página **não o fecham**: o foco sai do controle (o `document.activeElement` vira o `body`), mas o
  painel continua lá, cobrindo uns dois terços do desenho, e o celular não tem Esc: não achei gesto que o feche. O relatório da T1a dizia que
  ele "fica aberto até o toque fora (a saída do foco)": a saída do foco acontece, e o painel não fecha.
- **Passo**: `/arena` no iPhone 15; tocar no meio do gráfico; tocar no título "Patrimônio" acima dele, ou rolar a página: o painel fica.
- **Gravidade**: bloqueia (quebra no celular: o gráfico principal da arena fica coberto e não há como dispensar a leitura).
- **Captura**: `docs/redesign-premium/qa/04-arena-iphone-claro.png` (o WebKit, depois de dois toques fora e da rolagem).
- **Conserto sugerido**: no `Inspetor` de `components/beui/line-chart.tsx`, a saída do foco pelo toque também fecha (hoje a via "toque" segura o
  painel aberto), e um `pointerdown` fora da figura fecha a leitura. Um e2e de toque nos dois celulares: tocar no gráfico, tocar fora, o painel
  some.

### Importantes

**3. Os nomes no fim das linhas do gráfico "Posição por pregão" saem cortados.**
- **Onde**: `/ranking`, em todas as larguras, claro e escuro, no Chromium e no iPhone 15.
- **O que está errado**: as etiquetas com o nome no fim de cada curva são cortadas na borda do gráfico: "Gemini 4 Argo", "Qwen3.8 Max" no
  limite, "Claude Opus", "DeepSeek V4", "Igual-peso do", "BOVA11 (con". Dois motivos se somam: a etiqueta tem 96 px no máximo (`max-w-24` com
  `truncate`: "DeepSeek V4 Pro" precisa de 101 px e o "Igual-peso do universo (só preço)" de quase 200), e a caixa que rola o gráfico corta o
  que passa da borda direita (em 1440 px, 932 px de conteúdo numa caixa de 912).
- **Passo**: `/ranking` em 1440 px, a seção "Posição por pregão": a coluna dos nomes à direita.
- **Gravidade**: importante (texto cortado num rótulo de dado; o pedido cita "os rótulos no fim das linhas dos gráficos").
- **Captura**: `docs/redesign-premium/qa/02-ranking-1440-claro.png`.
- **Conserto sugerido**: reservar a calha das etiquetas dentro da largura do desenho (o `viewBox` ou um respiro à direita do tamanho da maior
  etiqueta) e usar o nome curto ("Igual-peso", "BOVA11", sem o sufixo de versão), como a legenda do gráfico do patrimônio faz.

**4. As tabelas cortam as últimas colunas sem nenhum sinal de que há mais à direita.**
- **Onde**: as três tabelas do `/ranking` (modelos, Sorteio e referências) em todas as larguras: em 1920 px fica fora a "Custo LLM"; de 1024 a
  1440, a "Operações" e a "Custo LLM" (e a "Acerto" na das referências); em 390, 8 das 12 colunas. No celular (360 a 412 px e o iPhone 15),
  a tabela do "Sorte ou habilidade?" da landing esconde a coluna **Percentil** (em 360 px também metade do "Retorno") e a das posições na
  página do modelo esconde "Quantidade" e "Preço médio". No `/admin`, a "Último job de cada tipo" esconde cinco colunas em 390 e a "Esperando"
  em 1024. Claro e escuro; Chromium e iPhone 15.
- **O que está errado**: as caixas rolam (pela roda horizontal, pelo trackpad, pelo toque e pelas setas na região focada: seção 4.2), mas,
  sem a barra de rolagem (o pedido do Artur), nada mostra que há colunas escondidas: nenhum esmaecimento na borda, nenhum "›" como o da faixa. A
  coluna cortada some no meio do texto ("Ope", "Ace"), e quem tem um mouse de roda só vertical não descobre o resto. Na landing, o painel é
  sobre o percentil e a coluna do percentil é a que fica de fora. As três tabelas do ranking também têm larguras diferentes (1.045, 1.030 e
  1.103 px), então as colunas não se alinham de uma para a outra (o "Tendência" e o "vs igual-peso" andam de lugar entre as três).
- **Passo**: `/ranking` em 1440 px, a tabela "Modelos": a última coluna à direita; a landing em 390 px, o painel "Sorte ou habilidade?".
- **Gravidade**: importante (dado escondido sem pista, e na landing o dado principal do painel).
- **Captura**: `docs/redesign-premium/qa/03-ranking-1440-claro.png`, `03-landing-390-claro.png`.
- **Conserto sugerido**: nas caixas de tabela que rolam, o mesmo "›" do `::scroll-button()` da faixa (com o mouse) e um esmaecimento na borda
  quando há mais (`mask-image` ou uma sombra lateral ligada ao `scroll-state` ou ao `animation-timeline: scroll()`), só CSS; no ranking,
  larguras fixas iguais nas três tabelas (`table-layout: fixed` e um `<colgroup>` comum) e as colunas de apoio (Acerto, Operações, Custo LLM)
  numa segunda linha ou na página do modelo; na landing, a tabela compacta (Pos., Competidor, Retorno e Percentil) cabe em 320 px com o nome
  curto e sem o `nowrap` no nome.

**5. O título da página do DeepSeek quebra em duas linhas, com a segunda embaixo do logo.**
- **Onde**: `/modelos/deepseek-v4-pro` em todas as larguras (e no iPhone 15); `/modelos/qwen3-8-max` em 360 e 390 px. Claro e escuro, Chromium
  e WebKit.
- **O que está errado**: o `h1` tem `max-w-[24ch]` com `text-balance` (uns 400 px a 26 px), então "DeepSeek V4 Pro (0813)" quebra em
  "DeepSeek V4" / "Pro (0813) simulado" mesmo com 1.300 px livres ao lado. O logo mora dentro do `h1`, na primeira linha: a segunda linha
  começa na borda esquerda, embaixo do logo, e não embaixo do texto, e o título parece quebrado. O do Claude e o do GPT (medidos) cabem numa
  linha em toda largura; o Gemini e o Grok têm nomes mais curtos que o do Claude.
- **Passo**: abrir `/modelos/deepseek-v4-pro` em 1440 px.
- **Gravidade**: importante (o título da página, feio em toda largura).
- **Captura**: `docs/redesign-premium/qa/05-modelo-deepseek-1440-claro.png`.
- **Conserto sugerido**: tirar o teto de 24 ch (ou subir para uns 32 ch) e pôr o logo fora do fluxo do texto (um flex com o logo e o `h1` lado
  a lado), para a linha que quebrar no celular começar embaixo do nome.

**6. O botão primário pisca na abertura das telas de formulário.**
- **Onde**: `/entrar`, `/cadastro`, `/esqueci-senha` e o formulário de lançar da `/carteira`, em todas as larguras, claro e escuro, no
  Chromium e no WebKit do iPhone 15; no `/admin`, os botões cinza dos formulários fazem o mesmo, do cinza do painel para o do trilho.
- **O que está errado**: o formulário nasce com o `fieldset` desativado até a hidratação (de propósito: sem JavaScript ele não pode se
  enviar), e o botão desativado é o cinza do painel. Quando a página hidrata, ele vira o azul da primária pela transição de 150 ms do `.btn`
  (a cor de fundo e a do texto): medido no `/entrar`, cinza dos 15 aos 125 ms depois do `load` e o esmaecer até os 273 ms; no iPhone 15, cinza
  até os 282 ms e o esmaecer até os 431. O `document.getAnimations()` logo depois do `load` pega as duas `CSSTransition` em toda largura. É
  um piscar da ação principal na abertura (o pedido: "nada se move na abertura da página").
- **Passo**: recarregar a `/entrar` olhando o botão "Entrar".
- **Gravidade**: importante (a primeira impressão das telas de conta; anima na abertura).
- **Captura**: `docs/redesign-premium/qa/06-entrar-390-claro.png` (o JavaScript segurado: cinza; 70 ms depois de hidratar; o fim).
- **Conserto sugerido**: a troca do desativado para o ativo não transiciona (por exemplo, a transição de cor do `.btn` só nos estados de
  `:hover` e `:active`, ou só depois de um atributo posto um quadro após habilitar o `fieldset`), ou o botão já nasce com o desenho ativo
  enquanto o `fieldset` segura o envio (o `aria-disabled` dá o estado ao leitor de tela). O motivo de desativar antes de hidratar continua.

### Menores

**7. "Decisões | Carteiras" na arena parecem abas, mas são âncoras, e nenhuma fica marcada.**
- **Onde**: `/arena` e `/arena?filtro=SELL`, abaixo de 1280 px (e no iPhone 15), claro e escuro.
- **O que está errado**: a navegação "Seções da arena" usa o desenho das abas grandes (`Abas grandes`), mas os dois itens são links para
  `#feed` e `#carteiras`, na mesma página: nenhum fica marcado, os dois ficam no cinza, e o toque só desce a página. No Rallies, "Feed |
  Portfolios" são abas de verdade, com a escolhida na tinta. Parece um controle quebrado.
- **Passo**: `/arena` em 390 px, logo abaixo do aviso.
- **Captura**: `docs/redesign-premium/qa/07-arena-390-claro.png`.
- **Conserto sugerido**: ou abas de verdade (a vista das decisões e a das carteiras), ou links com cara de link ("Ir para as decisões ›"),
  sem o desenho de abas.

**8. A paginação "Mais antigas" usa a primária.**
- **Onde**: `/arena`, `/arena?filtro=SELL` e `/noticias`, em todas as larguras, claro e escuro.
- **O que está errado**: o "Mais antigas" no pé do feed é `.btn-primary`, a única primária dessas telas: a cor da ação principal vai para a
  paginação (a Regra da Voz Única: "a ação principal, a escolha atual, o foco e a marca").
- **Captura**: `docs/redesign-premium/qa/08-arena-1440-claro.png`.
- **Conserto sugerido**: a pílula cinza (`.btn`), como o "Regras da arena".

**9. Duas pílulas primárias "Lançar compra" na carteira.**
- **Onde**: `/carteira`, em todas as larguras, claro e escuro, Chromium e iPhone 15.
- **O que está errado**: o "Lançar compra" da coluna do resumo (o link que leva ao formulário) e o botão de enviar do formulário são as duas
  primárias, com o mesmo texto, na mesma tela (no celular, uma embaixo da outra na mesma rolagem).
- **Captura**: `docs/redesign-premium/qa/09-carteira-1440-claro.png`.
- **Conserto sugerido**: o link do resumo como pílula cinza ou como link ("Lançar uma compra ›"); a primária fica no envio.

**10. A data do cursor cobre o rótulo do eixo no gráfico do patrimônio.**
- **Onde**: o gráfico do patrimônio da `/arena` (medido em 1440 px e no iPhone 15) e das páginas dos modelos (a mesma peça), claro e escuro.
- **O que está errado**: com o cursor perto das pontas, a pílula da data dele ("30/11", 1254 a 1305 px) fica por cima do rótulo do eixo
  ("01/12", 1260 a 1296 px), e no iPhone o "25/11" come metade do "01/12": um texto por cima do outro.
- **Captura**: `docs/redesign-premium/qa/10-arena-1440-claro.png` (e a `04-arena-iphone-claro.png`).
- **Conserto sugerido**: esconder o rótulo do eixo que a pílula do cursor cobre enquanto o cursor está à vista (como o terminal da ação faz
  com o marco que a etiqueta do último preço cobriria).

**11. A série que a legenda mostra só esmaece em 150 ms; não se desenha.**
- **Onde**: o gráfico do patrimônio da `/arena` (a legenda: CDI, igual-peso, BOVA11), em todas as larguras.
- **O que está errado**: o `DESIGN.md`, o ADR 0037 e o pedido falam da "linha que se desenha quando a legenda mostra uma série". O que roda é
  uma animação de opacidade de 0 a 1, em 150 ms, no grupo da série (`getKeyframes()`: `opacity` 0 → 1, a curva quart); nenhum traço avança
  da esquerda para a direita, e nenhum recorte anda. Não está quebrado, mas é menos do que foi prometido.
- **Captura**: nenhuma (é uma medida de movimento: `out/sondas3.ndjson`, "legenda-anim").
- **Conserto sugerido**: o recorte que cresce da esquerda (o `clip-path: inset()` ou o `pathLength` do Motion) em uns 250 ms na série que volta,
  com o ramo de movimento reduzido trocando na hora; ou ajustar o texto do `DESIGN.md` ao esmaecer.

**12. O selo "[ok] fechado" do ciclo pinta o texto no verde do dado, com borda.**
- **Onde**: `/ciclos/2026-12-01`, em todas as larguras, claro e escuro (no escuro, o verde-limão `#9ae600`).
- **O que está errado**: a situação do ciclo é uma pílula com borda e o texto no verde da alta. A Regra do Glifo diz que a cor do dado vai só
  no glifo ▲ ▼ ■ (e no erro e no sucesso de formulário), e no escuro o limão sobre o preto puxa para o "terminal hacker" que o `PRODUCT.md`
  recusa; é também a única pílula com borda que sobrou nas telas da arena.
- **Captura**: `docs/redesign-premium/qa/12-ciclo-390-escuro.png`.
- **Conserto sugerido**: a pílula cinza sem borda (a mesma do "simulado"), com o texto na tinta.

**13. O cabeçalho do site não tem o movimento do resto.**
- **Onde**: o cabeçalho do site (a landing, o Como funciona, os textos legais, a 404), a partir de 1024 px; a pílula "Entrar" também na folha
  "Menu". Claro e escuro.
- **O que está errado**: os links do cabeçalho, a pílula "Entrar" (e o `::before` dela) e os ladrilhos da faixa dos laboratórios trocam de cor
  na hora (`transition` 0 s), e a pílula não encolhe no toque; no app, o trilho, as linhas, os cartões e os botões andam em 150 ms com a saída
  quart, e o `.btn` encolhe a 0,96. O site parece de outra mão.
- **Captura**: nenhuma (medida: `out/sondas2.ndjson`, "hover-site", e `out/graficos.ndjson`, "hover").
- **Conserto sugerido**: a `.pill` com a transição nomeada do `.btn` (cor, fundo e `scale` em 150 ms) e o `active:scale-96`; os links do
  cabeçalho com a transição da cor.

**14. No desktop, o clique fora do menu "Mais" fecha e também segue o link de baixo.**
- **Onde**: toda tela do app, a partir de 1024 px (o menu curto ancorado no item "Mais"), claro e escuro.
- **O que está errado**: o clique num link da página com o menu aberto fecha o menu (certo) e segue o link (de `/arena` foi para
  `/modelos/gemini-4-argon`). O pedido pede que o toque fora não siga o link de baixo; no celular a folha é a tela inteira e não há "fora", mas
  num tablet de 1024 px ou mais, de toque, o menu curto aparece e o toque fora navega.
- **Captura**: nenhuma (medida: `out/sondas1.ndjson`, "mais-fora").
- **Conserto sugerido**: se a regra vale também para o menu curto, um fundo transparente atrás dele enquanto aberto (o `::backdrop` não existe
  para `popover="auto"`; um elemento irmão, ou o `popover` sobre um `dialog` não modal), que fica com o primeiro clique; ou anotar que, no
  desktop, o clique fora segue o link, como num menu comum.

**15. O anel de foco do cartão da faixa que encosta no "›" fica embaixo do botão.**
- **Onde**: a faixa dos modelos da landing ("Arena agora") e da arena, com o mouse (a partir de 768 px no teste), claro e escuro, no Chromium
  (o "›" é o `::scroll-button()`, só dele).
- **O que está errado**: pelo Tab, o cartão que fica na ponta direita termina 3 a 7 px além da borda da faixa, e o lado direito do anel (que
  é por dentro do cartão) fica embaixo do botão "›" de 44 px. O anel continua à vista nos outros três lados (a WCAG 2.4.11 pede que não suma
  inteiro), mas o cartão focado fica com a ponta escondida. É o resto do achado 2 da onda anterior.
- **Captura**: `docs/redesign-premium/qa/15-landing-1440-claro.png`.
- **Conserto sugerido**: `scroll-padding-inline-end` de uns 56 px na `.faixa` (o foco para antes do botão) ou o "›" escondido enquanto um
  cartão da faixa tem o foco (`.faixa:has(:focus-visible)::scroll-button(right)`).

**16. "Resultado %" em duas linhas no cabeçalho das carteiras.**
- **Onde**: a barra das carteiras da `/arena` e do `/ranking`, de 1280 a 1920 px, e as carteiras no pé da arena em 360 e 390 px e no iPhone 15;
  claro e escuro.
- **O que está errado**: "Resultado %" quebra em "RESULTADO" / "%", e os outros três títulos ficam encostados embaixo, numa linha de 40 px: o
  cabeçalho fica desigual (o "P&L %" do Rallies cabe numa linha). Já estava na onda anterior (o achado 10 de lá).
- **Captura**: `docs/redesign-premium/qa/16-arena-1440-claro.png`.
- **Conserto sugerido**: o título "%" (com o "Resultado" do lado dizendo que é em reais), ou "Result. %" com o nome inteiro no `abbr`, ou a coluna
  com largura para ele numa linha.

**17. Os nomes quebram em duas e três linhas nas tabelas do ranking no celular.**
- **Onde**: as tabelas do `/ranking` de 360 a 768 px e a do "Sorte ou habilidade?" da landing de 360 a 412 px (e no iPhone 15), claro e escuro.
- **O que está errado**: "Claude Opus 5.5" e "DeepSeek V4 Pro" quebram em duas linhas, "BOVA11 (contexto)" em duas e "Igual-peso do universo
  (só preço)" em três, com o logo na primeira; as linhas da tabela ficam com alturas diferentes. Nos outros lugares apertados o nome curto já
  resolveu (a faixa, a legenda, o Explorar).
- **Captura**: `docs/redesign-premium/qa/17-ranking-390-claro.png`.
- **Conserto sugerido**: o nome curto também nas referências ("Igual-peso", "BOVA11") e o nome numa linha (`whitespace-nowrap`) dentro da
  célula, já que a tabela rola (com a pista do achado 4).

## 4. O que passou, item a item do pedido

### 4.1 Rolagem horizontal e texto cortado (item 1)

- Nenhuma rolagem horizontal nas 432 combinações do Chromium e nas 22 do iPhone 15, **fora o achado 1** (as seis de 360 px da arena e do
  ranking). Nenhum elemento passa da largura nas outras.
- Nenhum texto por cima de outro (as caixas de linha de cada nó de texto), fora o 10, que pede a interação.
- O texto cortado de propósito: a descrição dos cartões do Explorar em duas linhas (`line-clamp-2`, como o Discover do Rallies) e o
  "Igual-peso do uni…" com reticências na barra "Populares" (o Rallies corta igual: "Trump Administrat…", "Bridgewater Asso…"). Os cortados
  que não são de propósito são o 3 e o 4.
- Os valores do contador, os hashes (a `.hash` quebra em qualquer ponto), os tickers e os nomes da faixa cabem em toda largura.

### 4.2 As barras de rolagem (item 2)

- **Nenhuma barra à vista** em nenhuma tela de 768 a 1920 px com o Chromium desenhando as barras clássicas (a regra `* { scrollbar-width:
  none }` do `globals.css`). De 360 a 412 px, no modo móvel do Chromium, a página não reserva largura para a barra; a medida ali só pegou a
  largura a mais do achado 1 (o `innerWidth` de 366).
- **A rolagem continua** (`out/rolagem.ndjson`): na página, a roda (700 px), o PageDown (796), o Espaço (1.592), a seta para baixo (1.632) e o
  Home (0); na faixa da arena e da landing, a roda horizontal (até o fim, 272 e 400 px) e o Tab pelos cartões (a faixa acompanha o foco); nas
  tabelas e no gráfico de posições do ranking, a roda horizontal; na barra das carteiras, a roda vertical; no celular, o gesto de toque do CDP na
  página, na faixa, nas tabelas e no admin. A captura depois de rolar não mostra barra nenhuma.
- O Shift com a roda vertical não rolou a faixa nem as tabelas no teste, mas é limite do teste: no macOS quem converte o Shift com a roda em
  rolagem horizontal é o sistema, e o evento sintético do Playwright não passa por ele.

### 4.3 Os dois temas e o seletor (item 3)

- **(a) O sistema**: o `<html>` com `data-tema="sistema"`, `color-scheme: light dark` e o tema do `colorScheme`; o fundo, a tinta e a moldura
  preta certos nos dois, em toda tela.
- **(b) A escolha guardada contra o sistema oposto**: nas 10 telas principais com seletor, em 1440 e 390 px no Chromium e em 8 no iPhone 15,
  **zero diferença** de cor elemento a elemento contra o sistema no mesmo tema (nada depende do `prefers-color-scheme` em vez do atributo). A
  cor da barra do navegador (`theme-color`) segue a escolha.
- **(c) O seletor**: nos três lugares (o pé do trilho em 1440, a folha "Mais" em 390 e no iPhone, o cabeçalho do site em 1440 e a folha "Menu"
  em 390 e no iPhone), o clique ou o toque em Escuro, Claro e Sistema troca o tema, guarda a escolha (o `localStorage`), o recarregar mantém,
  e o Sistema apaga a chave. A pintura depois da troca é igual à do sistema (a única diferença medida foi o anel de foco do botão "Menu" depois
  do Esc, efeito do próprio teste). A revelação é a View Transition (o `::view-transition-new(root)` com a animação `tema-revelar` de 250 ms),
  no Chromium e no WebKit; durante a troca **nenhuma transição de cor roda** (só a pílula do seletor anda, em 200 ms): sem o "borrão".
- **Sem piscar**: com a escolha guardada contra o sistema e o JavaScript do Next bloqueado, o `<html>` já tem o `data-tema`, a classe `dark` e o
  fundo do tema no `DOMContentLoaded` (5 telas × as duas escolhas, Chromium e WebKit): o script em linha do `<head>` vem antes do `<body>`.
- **A primária** (a escala do `#14144C`, conferida em sRGB): no claro, só os botões primários, a marca e a escolha atual (a pílula do seletor e o
  filtro do feed, desenhados no `::before`); no escuro, o 300 nos mesmos lugares, com o texto no 950. O que sai da regra está nos achados 8 e 9.
  O item ativo do trilho é o cinza do trilho (o círculo cheio do Rallies), e não a primária, como o `DESIGN.md` descreve.
- **O axe**: nenhuma violação em 292 análises (as 27 telas × 360, 390, 1024, 1440 e 1920 px × os dois temas no Chromium; as 11 principais × os
  dois temas no iPhone 15). O "incompleto" de contraste (de 17 a 24 nós por tela) é o de sempre: a pílula desenhada no `::before` (o filtro
  escolhido, os chips, a "Entrar"), o cartão da faixa que passa por baixo do "›", as etiquetas do gráfico de posições cortadas (o 3) e a arte;
  as cores deles são os tokens que o `tokens.spec.ts` confere, e as pílulas do fim das linhas do patrimônio medem de 4,6 a 19,8:1 no claro e de
  6,7 a 17,2:1 no escuro.
- Nada some num tema: o logo dos laboratórios no círculo (nenhum abaixo de 3:1), as linhas dos gráficos, as bordas e o anel de foco aparecem
  nos dois.

### 4.4 O movimento (item 4)

- **Na abertura**: o `document.getAnimations()` logo depois do `load` só pega a fita da landing (contínua, decidida na onda anterior e na T1b) e
  as transições do achado 6; a escadaria só anda a partir de 1024 px, depois do `load` (em 360 e 412 px fica no quadro 0 e o arquivo inteiro nem
  é pedido); o urso da 404 anda em 1440 e fica parado em 390. Nenhum CLS no carregamento de nenhuma tela.
- **O hover e o toque**: 150 ms com a saída quart no botão (e a seta que anda 2 px no "Abrir a arena"), no cartão da faixa, no cartão do
  Explorar (que acende e sobe 2 px), nas linhas, na legenda, nas abas e no trilho; o botão encolhe a 0,96 no toque. A exceção é o 13.
- **Os gráficos**: o cursor gruda no pregão (o mesmo x dentro da coluna, salto de uma coluna de 41,7 px); o painel acompanha, dentro da tela,
  no fundo do canvas com a sombra de elevação; o **contador** não gira quando o ponteiro anda dentro do mesmo pregão e gira quando o pregão
  muda (os algarismos rolam por uns 480 ms, a mola da Arc assentando); o teclado (a seta, o Home, o End e o Esc) troca o pregão e fecha o painel,
  com o anel na figura (o controle é invisível); o gráfico de posições fixa a série pela legenda e o Esc solta. Os achados ficam no 2, 10 e 11.
- **O tooltip** (a Arc): abre em uns 290 ms no hover e na hora pelo foco do teclado, fecha no Esc, fica dentro da tela, a tinta no claro e o
  canvas no escuro, 13 px e raio 8; no Explorar, na arena e na confiança do terminal.
- **Movimento reduzido** (`reducedMotion: 'reduce'`): nenhuma animação na abertura; o contador troca na hora (nenhum quadro intermediário); o
  painel salta sem deslizar; a legenda troca na hora; o cartão da faixa e o do Explorar sem transição e sem subir; a troca de tema sem a View
  Transition; a escadaria e o urso parados no quadro 0 e a fita parada no começo.

### 4.5 A navegação (item 5)

- **O trilho** (1024, 1440 e 1920 px): o item certo marcado nas 72 combinações (Arena na arena, no ranking, no modelo e no ciclo; Explorar no
  Explorar, nas ações, no terminal e nas notícias; Chat; Carteira; Conta na conta e no admin).
- **A barra de abas no pé** (360, 390 e o iPhone): os seis itens de 60 a 65,5 × 56 px dentro da largura (fora o 360 com o achado 1); a área
  segura pelo `env(safe-area-inset-bottom)` na barra, na coluna e no `scroll-padding-bottom`, com o `viewport-fit=cover` (o Playwright não
  emula o recorte do iPhone; conferido no CSS); o rodapé termina acima dela; o foco do teclado não fica embaixo dela (no máximo 2 a 3% da
  altura do item, a borda); o último campo focado fica acima dela.
- **A folha "Mais"**: no celular, a tela inteira acima da barra de abas, o Esc fecha, e o foco percorre a folha e a barra sem ir para a página
  coberta; no desktop, o menu curto de 240 × 230 px ancorado no item, o Esc fecha (o clique fora está no 14).
- **O site**: abaixo de 1024 px, a folha "Menu" pelo botão de 44 px, os links de 52 px, o Esc fecha, o toque embaixo dos links fecha sem seguir o
  link de baixo, e o foco não vai para a página; acima, os links na linha.
- **A moldura**: em 1920 px o app tem 1.550 px, centrado (185 px de cada lado), com o fio dos dois lados nos dois temas.
- **Os links**: os 31 endereços da navegação (o site, o app, a entrada e a 404) respondem 200 e abrem a tela certa; o `/?filtro=SELL` dá 308
  para a `/arena?filtro=SELL` (e o `#feed` leva ao feed).

### 4.6 Os alvos de toque (item 6)

Nenhum botão nem link fora de texto abaixo de 44 × 44 px em nenhuma das 454 combinações (os radios do seletor de tema medidos pelo rótulo,
44 × 44).

### 4.7 O teclado (item 7)

Em 12 telas × 390 e 1440 px × os dois temas, 40 Tabs cada: o anel é o contorno sólido de 2 px com 2 px de recuo, na primária em sRGB
(`20,20,76` no claro e `172,185,250` no escuro) em toda parada; a ordem segue a leitura (o cabeçalho, a navegação, a página, o rodapé); o foco na
faixa vai primeiro ao "›" (com o anel nele) e depois aos cartões; o controle dos gráficos e os tooltips respondem como na seção 4.4. A exceção é
o 15.

### 4.8 Os modelos (item 8)

- **O "simulado" uma vez por contexto**: a landing, uma vez em cada recorte (o aviso do hero, o "Arena agora", a faixa dos laboratórios, a
  justificativa, o "Sorte ou habilidade?"); a arena e o ciclo, o aviso de página uma vez; o ranking, uma vez na tabela dos modelos e uma no
  título das carteiras; o modelo, a etiqueta junto do título; o Explorar, uma vez na grade dos modelos e uma na barra "Populares". Nenhuma
  pílula com borda em nome nenhum (a única pílula com borda que sobrou é a do 12, que não é do "simulado").
- **O logo e o nome numa linha** na faixa, nas carteiras, nas legendas e nas tabelas do desktop; no feed e nos cartões do Explorar o logo maior
  fica ao lado de duas linhas (o nome e a data) ou em cima (o desenho do Discover), como no Rallies. As exceções são o 5 e o 17.
- **O Sorteio e as referências neutros**: a inicial no círculo cinza (S, C, I, B), sem "simulado" e sem cor de laboratório; as páginas deles
  mostram só o patrimônio, com a frase da licença.

### 4.9 O terminal da ação e a regra das cotações (item 9)

- O cabeçalho (o monograma "D", esperado na demo, o ticker, o nome, o último fechamento R$ 39,61 com a variação ▼ -0,93% e a frase "Fechamento
  do pregão de 01/12/2026 [...] Cotações: brapi.dev"), as velas com o resumo em texto ("60 pregões, de 03/09/2026 a 01/12/2026: fechamento de R$
  86,59 para R$ 39,61 (-54,26%), mínima de R$ 38,86 e máxima de R$ 94,35."), quem tem a ação (só modelos), as decisões e as notícias.
- **Nenhuma tabela** no principal; o realce de uma vela mostra **só a data** (o `::after` com o `data-data`, nenhum tooltip nem balão).
- **O HTML** (`page.content()`, com o payload do React) contra as 60 barras do DOBR4 lidas no banco do ensaio (só `SELECT`): nenhum
  fechamento, abertura, máxima ou mínima do meio da série aparece, escrito ou em centavos, fora os do resumo; o único valor que bateu, R$ 40,49,
  é o preço médio de quem tem a ação (coincide com a abertura de 12/11). O desenho das velas permite refazer o fechamento só por aproximação:
  pelas coordenadas do SVG e os marcos do eixo, o erro médio é de 10,6 centavos e o maior de 24,4 (1 de 60 dentro de 1 centavo).

### 4.10 O `/chat` desligado (item 10)

Os nove controles desativados, nenhum formulário, o aviso "[!] O chat está desligado [...]"; com o registro de rede ligado, o clique, o toque,
a digitação, o Enter e o Espaço em cada controle não fazem **nenhum pedido** (no Chromium em 390 e 1440 e no iPhone 15), e a caixa fica vazia.

### 4.11 Os campos (item 11)

Todo campo com 16 px (as buscas, a entrada, a criação de conta, a carteira e o admin; nada de zoom no iPhone). O envio com erro proposital: o
e-mail inválido na `/entrar`, na `/esqueci-senha` e na `/cadastro` e a quantidade "abc" na carteira mostram a frase embaixo do campo, ligada por
`aria-describedby`, com `role="alert"`, o `aria-invalid` no campo e o foco no primeiro inválido, nos dois temas, no Chromium e no WebKit; nenhum
pedido saiu para a api. A carteira da demo não tem lançamentos (o "Nenhuma compra ainda"), então a rosca, o toast e o contador dela não
aparecem aqui (têm o e2e da T2b).

### 4.12 A cara, contra o Rallies (item 12)

Comparei a arena em 1920 com a captura do Artur, a landing, a arena e o Discover em 1440 e 390 com as do Rallies e as telas com as "depois" das
tarefas. O que ficou mais limpo e certo: a moldura de 1.550 px com os fios, o trilho, a faixa com o nome numa linha e o "›", o gráfico com as
pílulas do fim das linhas e a faixa do Monte Carlo leve, a legenda sem etiquetas, os cartões do Explorar no desenho do Discover, a sans em tudo
(nenhuma mono fora do hash e do código em nenhuma tela), nenhum `transition: all`, nenhuma cor crua em SVG ou `style`, o escuro coerente. O que
parece erro ou menos limpo que o Rallies está nos achados 3, 4, 5, 7, 12, 16 e 17.

## 5. Observações que não são achados

- **A fita da landing anda desde a abertura**: é a decisão da onda anterior (ADR 0034) mantida pela T1b; para com movimento reduzido.
- **O quarto painel da landing ("Sua carteira, anotada por você") não tem recorte** e fica com a metade direita vazia: decisão do plano
  (`docs/redesign-rallies/plano.md`, d.5: "Só texto [...] a landing não lê a sessão"). Se o Artur quiser, um recorte sem número (o formulário de
  lançar vazio, por exemplo) preencheria sem ler a sessão.
- **As telas da conta (entrar, criar conta, esqueci a senha) não têm seletor de tema**: o ADR 0037 põe o seletor em três lugares (o trilho, a
  folha "Mais" e o cabeçalho do site), e a tela dividida não é nenhum deles; a escolha feita no resto do site vale ali.
- **No celular, o gráfico da arena fica abaixo da dobra** (o título, a descrição e o aviso vêm antes, e a faixa começa perto dos 300 px); no
  Rallies, o gráfico é a primeira coisa. É escolha de hierarquia, e o aviso é obrigatório; fica a anotação.
- **O contador do painel gira por uns 480 ms** quando o pregão muda (a mola da Arc assentando), mais do que os 150 a 250 ms dos outros
  movimentos; só gira quando o número muda, como o pedido pede.
- **O erro de leitura do `/admin`** ("Não deu para ler a DLQ [...]", a demo sem o Service Bus) aparece na caixa com o fio vermelho do erro de
  formulário (`CAIXA_ERRO`), a mesma peça do erro de envio: coerente; o texto é o esperado na demo.
- **Os pedidos de `/__nextjs_font/geist-latin.woff2`** que o WebKit cancelou na `/conta` são do indicador do `next dev`, não do site.

## 6. Os números

| Medida | Combinações | Resultado |
|---|---|---|
| Varredura no Chromium (com as barras desenhadas) | 27 telas × 8 larguras × 2 temas = 432 | rolagem horizontal só no achado 1 (6); 0 barra à vista de 768 a 1920 px; 0 texto sobreposto; 0 alvo < 44 px; 0 mono fora do hash; 0 `transition: all`; 0 cor crua; 0 CLS |
| Varredura no iPhone 15 (WebKit) | 11 telas × 2 temas = 22 | 0 rolagem horizontal; os achados 2 a 6, 9, 10, 16 e 17 nas telas da matriz |
| axe (todas as regras e gravidades) | 270 no Chromium + 22 no iPhone 15 = 292 | **0 violação** |
| Tema: a escolha guardada contra o sistema oposto | 10 telas × 2 larguras (Chromium) + 8 (iPhone) | 0 diferença de cor |
| Tema: o seletor (Escuro, recarregar, Claro, Sistema) | as mesmas 28 | 0 diferença real; a View Transition de 250 ms; 0 transição de cor na troca |
| Tema: a primeira pintura com o JavaScript bloqueado | 5 telas × 2 escolhas × 2 motores = 20 | o tema guardado já no `DOMContentLoaded` |
| Trilho | 12 telas × 3 larguras × 2 temas = 72 | 72 certos |
| Teclado | 12 telas × 2 larguras × 2 temas × 40 Tabs | o anel na primária em toda parada; o 15 |
| Links da navegação | 31 | 31 com 200 e a tela certa |
| Rolagem | 7 telas × 1440 e 390 px | a roda, o teclado e o toque rolam a página, a faixa e as tabelas |
| `/chat` | Chromium 390 e 1440, iPhone 15 | 0 pedido |
| Campos com erro proposital | 4 telas × 2 temas × 2 motores | o erro com `role="alert"`; 0 pedido à api |

## 7. Os arquivos

- **No repositório**: este relatório (`docs/redesign-premium/relatorios/qa.md`) e as 16 capturas dos achados em `docs/redesign-premium/qa/`
  (`01-arena-360-claro.png`, `01-ranking-360-escuro.png`, `02-ranking-1440-claro.png`, `03-ranking-1440-claro.png`, `03-landing-390-claro.png`,
  `04-arena-iphone-claro.png`, `05-modelo-deepseek-1440-claro.png`, `06-entrar-390-claro.png`, `07-arena-390-claro.png`,
  `08-arena-1440-claro.png`, `09-carteira-1440-claro.png`, `10-arena-1440-claro.png`, `12-ciclo-390-escuro.png`, `15-landing-1440-claro.png`,
  `16-arena-1440-claro.png`, `17-ranking-390-claro.png`). Os achados 11, 13 e 14 são de movimento e de comportamento, sem captura: a medida está
  em `out/`. Nenhum arquivo de código foi tocado.
- **Fora do git** (`.data/orquestracao/premium/qa/`): os scripts e as medidas (`out/*.ndjson` e os logs), deixados como registro. As capturas de
  trabalho (`shots/`, 172 MB) e a sessão da demo (`estado.json`) foram apagadas no fim.
