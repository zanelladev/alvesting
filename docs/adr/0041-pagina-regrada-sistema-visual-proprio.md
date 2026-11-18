# ADR 0041: A página regrada, um sistema visual próprio

- **Status:** aceita
- **Data:** 18/11/2026
- **Origem:** o pedido do Artur para "fugir um pouco do Rallies" (o critério 5 do Demo Day do Playbook reprova na hora a cópia de design, e
  as capturas de referência do Rallies saíram do repositório em 09/11/2026). Na fase 1 da tarefa ele viu três direções, e escolheu levar os
  padrões da landing nova de outro projeto dele, fora deste repositório: "manter linhas, conteúdo mais centralizado e sidebar na esquerda".
  A home e a arena foram desenhadas primeiro no Claude Design (desktop e celular, nos dois temas, com o movimento), e ele aprovou a direção
  em 18/11/2026, com uma correção: o texto escuro no botão azul (o link primário herdava a cor do texto)
- **Substitui:** o ADR 0035 no sistema visual: os tokens, a casca do app, a do site e as peças que faziam o site ser lido como o Rallies.
  Ficam do 0035 a arquitetura de informação e o comportamento: as duas cascas por grupo de rota, o endereço de cada tela (a landing na `/`,
  a arena na `/arena`, o Explorar, o chat pronto e desligado), o item ativo pelo layout da área, o "Mais" e as folhas `popover` sem
  JavaScript, os temas (claro, escuro e sistema, com o seletor do ADR 0037), os logos dos laboratórios (os arquivos e a procedência), a arte
  só na moldura escura, o "simulado" uma vez por contexto e o 308 do `/?filtro=` no proxy

## Contexto

Desde 05/11/2026 (ADR 0035) o site usava a linguagem visual do Rallies AI. O que o fazia ser lido como ele, do mais marcante ao menos: a
casca do app (o trilho de ícones de 80 px, a coluna de 1.550 px com o fio de cada lado, a barra secundária encostada no trilho, medidos nas
capturas dele), a faixa dos modelos com o "›" redondo de rolar, o valor do fim de cada linha do gráfico numa pílula da cor da série, a
pílula em todo botão e o segmentado cinza, o logo do laboratório num círculo branco, os neutros sem tom e o verde-limão do escuro, a escala
de tipo em px medida lá, a landing de marketing com o nome gigante no rodapé, e as palavras (o Discover, o Today, o "Feed | Portfolios").

O Artur quer manter o produto, a arquitetura de informação, a acessibilidade, o desempenho da home e as garantias do e2e, e mudar o que faz
o site ser lido como o Rallies. A referência nova é de ritmo, não de marca: as linhas da página, a coluna no centro, as faixas, os títulos
em dois tons e as cenas animadas do método. Dela não entra código, componente, texto, arquivo, cor nem fonte; do Rallies não fica medida,
captura nem nome no código.

## Decisão

1. **A página regrada.** O fundo da página é a **folha** (o tom dos fios), e o conteúdo mora em células no canvas, com um vão de 1 px entre
   elas, onde a folha aparece e desenha os fios: os verticais de cada lado de uma coluna no centro, e os horizontais entre as faixas, de uma
   borda à outra da página. Cada faixa é uma `.linha` (as células laterais são o `::before` e o `::after` dela, nenhum elemento a mais), a
   coluna é a `.coluna` (até 1.140 px no site e 1.040 px no app, `--coluna`), e o vão de 48 px entre duas seções é uma faixa vazia
   (`.vao`, 28 px no celular). As células têm cantos de 4 px. Abaixo de 1024 px as laterais somem e a coluna enche a tela.
2. **Os tokens, nos dois temas, com os nomes de antes.** Os neutros são tingidos do azul do logo (a matiz da primária), e o escuro é o
   azul-noite (o canvas `#0b0d20`); a folha é `#e6e9f0` no claro e `#1e2142` no escuro. A faixa escura do fim do site (o convite e o rodapé)
   é escura nos dois temas (`escuro`, `#0b0c24` e `#070818`), com o texto branco (19:1) e o apoio a 62% (7,7:1). A primária continua o azul
   do logo, `#14144C` (o 300 da escala no escuro); a alta e a queda foram refeitas para o canvas novo (`#057a45` e `#c2183c`; `#4fd69c` e
   `#ff7a90`). A cor da barra do navegador é o canvas de cada tema. Todo par passa o AA, conferido pelo `tokens.spec.ts` (a tabela está no
   `docs/DESIGN.md`).
3. **O tipo.** A sans do sistema em tudo, com algarismos tabulares, e a Exo 2 só no nome da marca, como antes: nenhuma fonte baixada no
   caminho do LCP. Os títulos ganham **dois tons** na mesma frase (a tinta e o apoio, `.tom2`); o h1 do topo da landing e o título de cada
   seção dela crescem com a tela até o teto (`text-titulo`, de 40 a 58 px; `text-secao`, de 30 a 44 px), e o título de página do app é fixo
   (`text-pagina`, 34 px).
4. **A casca do app.** A partir de 1024 px, a **lateral de 248 px à esquerda**, fixa: a marca no topo, o "Buscar" como o primeiro item,
   desenhado como o campo de busca, os itens com o ícone ao lado do rótulo (44 px, raio 9; o atual no segundo plano com o fio, e o ícone na
   primária), o "Mais", o seletor de tema e a "Conta" no pé. Abaixo de 1024 px, a marca numa linha no topo e a barra de abas fixa no pé
   (seis itens de 60 × 56 px em 360, o atual na tinta, sem o círculo atrás do ícone). O principal é a página regrada, com a coluna de 1.040
   px no centro do que sobra. A barra secundária é a célula da direita: na arena, ao lado só do feed (`junto`: as carteiras, de 380 px, na
   faixa das decisões); no ranking e no Explorar, ao lado de tudo; na página da ação, embaixo do terminal (`embaixo`), porque ao lado ela
   não deixaria às duas colunas dele os 52rem que elas pedem. A linha de abas é a primeira faixa da coluna, 56 px com o fio embaixo, na
   mesma altura do título da barra secundária.
5. **A casca do site.** O cabeçalho de 68 px, preso no topo, numa faixa: a marca e os links à esquerda, o tema e o botão "Entrar" à
   direita (abaixo de 1024 px, a folha do "Menu", como antes). O principal é uma folha de faixas (cada página monta as dela; a que não tem
   faixa própria vai numa `Faixa`, de uma coluna). O rodapé é a faixa escura: o mapa do site em colunas, com a marca, e o `<footer>` com o
   aviso fixo, as atribuições e o ©. O nome gigante saiu.
6. **As peças-assinatura.** O botão com raio de 8 px, e não a pílula: o primário na primária com uma sombra curta, o de apoio no canvas com
   o fio forte por dentro. O segmentado e o seletor de tema: o trilho de 44 px (raio 10) no segundo plano, com a escolha num quadrado do
   canvas (38 px, raio 7). O logo do laboratório num quadrado branco de cantos arredondados (28% do lado), com o mesmo contorno de 1 px; o
   logo das ações continua no círculo (o desenho da brapi conta com ele, ADR 0036). O **placar** dos modelos no lugar da faixa: uma régua
   de células iguais, de pelo menos 216 px, separadas pelos fios de 1 px, com a posição pelo contador do CSS, que rola para o lado dentro da
   própria caixa (os sete competidores não cabem na coluna), com a borda esmaecida (o "›" saiu). No fim de cada linha do gráfico, o logo com o anel da cor da série e o valor em texto na tinta (a pílula
   colorida saiu). O selo da ação na cor dela (BUY no verde, SELL no vermelho, HOLD no cinza; o pedido do Artur em 18/11/2026: a palavra
   diz a ação, e a cor reforça). As cotações e o macro da arena numa grade da página regrada, três por linha, de uma borda à outra da coluna.
7. **A landing.** O topo (a etiqueta da temporada, o h1 em dois tons, o parágrafo com os ícones dentro do texto e os dois botões; a partir
   de 1024 px, à direita, a janela da arena em miniatura, decorativa, com o dado de verdade do último pregão); os números da temporada (uma
   célula do serrilhado abrindo a faixa, e o capital, o universo e os pregões liquidados; as carteiras sorteadas ficam na cena delas); a escadaria numa faixa própria (a arte enchendo a moldura escura, a legenda e a fita embaixo dela); o método em seis
   cenas, uma por passo do pregão (o briefing, o prompt oculto, a decisão, a abertura, as mil carteiras sorteadas e as referências, cada uma
   com o dado da api e o texto embaixo, que diz o mesmo); a justificativa de um modelo em destaque; o placar com o gráfico do patrimônio (o
   desenho em SVG do servidor, sem JavaScript); o elenco dos seis laboratórios; a carteira; o FAQ em `details`; e o convite na faixa escura.
   Cada seção abre com o selo (o ícone e o nome numa etiqueta de 30 px), o título em dois tons, o parágrafo e o link.
8. **O movimento.** Na landing, só CSS (nenhum componente de cliente acima da dobra): as cenas em laço de 8 s, o ponto da temporada em
   andamento que pulsa a cada 2,6 s, o serrilhado dos números que anda um dente a cada 30 s, a seta dos botões e dos links que anda 2 px no
   hover (150 ms) e o "+" do FAQ que vira "×" (250 ms).
   Com movimento reduzido, tudo para no quadro de partida. O título e o parágrafo do topo aparecem parados (nada anima na abertura: o LCP).
9. **A regra da primária** fica a do ADR 0035, com um caso a mais: a ação principal, a escolha atual, o foco, a marca e o estado atual (o
   ponto da temporada em andamento, que só aparece com ela em andamento). Enfeite nunca: o cadeado e a barra das cenas ficam na tinta.

## Consequências

- **O e2e.** As garantias não mudam (360 px sem rolagem horizontal, os alvos de 44 px, o axe nos dois temas, a primária só onde a regra
  deixa, o dado conferido contra a api). Mudaram as medidas e os nomes: o `layout.spec.ts` mede a lateral de 248 px, a coluna de 1.040 px
  no centro (em 1440 e 1920 px) e a linha de abas de 56 px; o "Mais" do desktop abre a 8 px da lateral; o fundo da página no `tema.spec.ts`
  é a folha; o `landing.spec.ts` confere as seções novas (o placar, o método com o dado do último ciclo, a justificativa, o elenco, a
  carteira, o FAQ e o rodapé na faixa escura); a tinta e o apoio que a carteira e a conta leem trocaram de valor; o teste do "›" da faixa
  virou o da rolagem do placar pelo teclado.
- **O desempenho da home.** Nada entrou no caminho crítico: nenhuma fonte, nenhuma imagem, nenhum script de cliente; a janela do topo, as
  cenas e o gráfico são HTML e SVG do servidor, e o movimento é CSS. O CSS cresceu com as peças da landing; o Lighthouse mobile da home
  está em `docs/TELAS.md`, seção 5.
- **O merge com as telas.** Os nomes dos tokens e das classes ficaram (`canvas`, `ink`, `btn`, `pill`, `chip`, `segmentado`...), e os
  novos são poucos (`folha`, `escuro`, `escuro-fio`, `escuro-tinta`; `.linha`, `.coluna`, `.vao`): o que outra tarefa escreve com eles
  segue o tema novo sem mudar.
- **Ficam de fora** os documentos que contam a história do Rallies (o ADR 0034, o 0035 com a nota de substituição, o plano e os relatórios
  das ondas): eles registram o que foi decidido na época.
