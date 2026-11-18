# ADR 0041: A página regrada, um sistema visual próprio

- **Status:** aceita
- **Data:** 18/11/2026
- **Origem:** o pedido do Artur, em 18/11/2026, por um sistema visual novo, que mantivesse o produto, a arquitetura de informação, a
  acessibilidade, o desempenho da home e as garantias do e2e. Na fase 1 da tarefa ele viu três direções, e escolheu levar os padrões da
  landing nova de outro projeto dele, fora deste repositório: "manter linhas, conteúdo mais centralizado e sidebar na esquerda". A home e a
  arena foram desenhadas primeiro no Claude Design (desktop e celular, nos dois temas, com o movimento), e ele aprovou a direção em
  18/11/2026, com uma correção: o texto escuro no botão azul (o link primário herdava a cor do texto)
- **Substitui:** o sistema visual anterior, de 05/11 a 18/11/2026 (os tokens, a casca do app, a do site e as peças), que já tinha trocado as
  partes visuais do ADR 0034 (os tokens do ascii-ui, a casca de um cabeçalho só, a moldura de linhas, a cápsula, o foco âmbar e a Geist
  500). Ficam do 0034 a arte como arquivo (o quadro 0 no HTML, o laço só a partir de 1024 px, a procedência e a pendência dos termos do
  Higgsfield), a fita, a regra de nada de cliente na casca e a de fontes do sistema no texto. A arquitetura de informação e o comportamento
  das telas, de 05/11/2026, continuam: estão na decisão 10
- **Completa:** o ADR 0037 (as bibliotecas, a primária do logo e o seletor de tema): a tabela de peças dele vale para este sistema

## Contexto

O Artur quer manter o produto, a arquitetura de informação, a acessibilidade, o desempenho da home e as garantias do e2e, e trocar o sistema
visual: os tokens, as cascas, as formas das peças, a escala de tipo e a landing. A referência nova é de ritmo, não de marca: as linhas da
página, a coluna no centro, as faixas, os títulos em dois tons e as cenas animadas do método. Dela não entra código, componente, texto,
arquivo, cor nem fonte.

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
   `#ff7a90`). O selo do visto das cenas é o círculo verde com o visto branco nos dois temas (`selo-ok`, `#057a45` e `#0a9455`, e
   `selo-ok-tinta`, o branco; o pedido do Artur em 18/11/2026): o verde da alta no escuro é claro demais para o branco. A cor da barra do
   navegador é o canvas de cada tema. Todo par passa o AA, conferido pelo `tokens.spec.ts` (a tabela está no
   `docs/DESIGN.md`).
3. **O tipo.** A sans do sistema em tudo, com algarismos tabulares, e a Exo 2 só no nome da marca, como antes: nenhuma fonte baixada no
   caminho do LCP. Os títulos ganham **dois tons** na mesma frase (a tinta e o apoio, `.tom2`); o h1 do topo da landing e o título de cada
   seção dela crescem com a tela até o teto (`text-titulo`, de 40 a 58 px; `text-secao`, de 30 a 44 px), e o título de página do app é fixo
   (`text-pagina`, 34 px).
4. **A casca do app.** A partir de 1024 px, a **lateral de 248 px**, que fica na tela enquanto a página rola: a marca no topo, os itens com
   o ícone ao lado do rótulo (44 px, raio 9; o atual no segundo plano com o fio, e o ícone na primária), o "Mais", o seletor de tema e a
   "Conta" no pé. A lateral e a coluna de 1.040 px ficam juntas, com um fio só entre as duas, e o conjunto fica no centro, entre as duas
   células de fora (uma grade de quatro trilhas no `.app`, com o vão de 1 px; as células têm pelo menos 2rem, e a coluna cresce até 1.040 px
   antes delas): o pedido do Artur em 18/11/2026, olhando o site num monitor de 1.915 px, onde a lateral presa na borda deixava um vão de
   uns 315 px até a coluna ("a navbar perto da página, grudada, linha com linha"). No mesmo pedido saiu o "Buscar" do topo da lateral: a
   busca mora nas telas (o Explorar e as Ações). Abaixo de 1024 px, a marca numa linha no topo e a barra de abas fixa no pé (seis itens de
   60 × 56 px em 360, o atual na tinta, sem o círculo atrás do ícone). O principal é a página regrada. A barra secundária é a célula da direita: na arena, ao lado só do feed (`junto`: as carteiras, de 380 px, na
   faixa das decisões); no ranking e no Explorar, ao lado de tudo; na página da ação, embaixo do terminal (`embaixo`), porque ao lado ela
   não deixaria às duas colunas dele os 52rem que elas pedem. A linha de abas é a primeira faixa da coluna, 56 px com o fio embaixo, na
   mesma altura do título da barra secundária. A pilha de avisos fica no canto da coluna, dentro dela.
5. **A casca do site.** O cabeçalho de 68 px, preso no topo, numa faixa: a marca e os links à esquerda, o tema e o botão "Entrar" à
   direita (abaixo de 1024 px, a folha do "Menu", como antes). O principal é uma folha de faixas (cada página monta as dela; a que não tem
   faixa própria vai numa `Faixa`, de uma coluna). O rodapé é a faixa escura: o mapa do site em colunas, com a marca, e o `<footer>` com o
   aviso fixo, as atribuições e o ©. O nome gigante saiu.
6. **As peças-assinatura.** O botão com raio de 8 px, e não a pílula: o primário na primária com uma sombra curta, o de apoio no canvas com
   o fio forte por dentro. O segmentado e o seletor de tema: o trilho de 44 px (raio 10) no segundo plano, com a escolha num quadrado do
   canvas (38 px, raio 7). O logo do laboratório num quadrado branco de cantos arredondados (28% do lado), com o mesmo contorno de 1 px; o
   logo das ações continua no círculo (o desenho da brapi conta com ele, ADR 0036). O **placar** dos modelos no lugar da faixa: uma régua
   de células iguais, de pelo menos 216 px, separadas pelos fios de 1 px, com a posição pelo contador do CSS, que rola para o lado dentro da
   própria caixa (os sete competidores não cabem na coluna), com a borda esmaecida (o "›" saiu). No fim de cada linha do gráfico, o logo
   com o anel da cor da série e o valor em texto na tinta (a pílula colorida saiu). O selo da ação na cor dela (BUY no verde, SELL no
   vermelho, HOLD no cinza; o pedido do Artur em 18/11/2026: a palavra diz a ação, e a cor reforça). As cotações e o macro da arena numa
   grade da página regrada, três por linha, de uma borda à outra da coluna.
7. **A landing.** O topo (a etiqueta da temporada, o h1 em dois tons, o parágrafo com os ícones dentro do texto e os dois botões; a partir
   de 1024 px, à direita, a janela da arena em miniatura, decorativa, com o dado de verdade do último pregão); os números da temporada (uma
   célula do serrilhado abrindo a faixa, e o capital, o universo e os pregões liquidados; as carteiras sorteadas ficam na cena delas); a
   escadaria numa faixa própria (a arte enchendo a moldura escura, a legenda e a fita embaixo dela); o método em seis cenas, uma por passo
   do pregão (o briefing, o prompt oculto, a decisão, a abertura, as mil carteiras sorteadas e as referências, cada uma com o dado da api e
   o texto embaixo, que diz o mesmo); a justificativa de um modelo em destaque; o placar com o gráfico do patrimônio (o desenho em SVG do
   servidor, sem JavaScript); o elenco dos seis laboratórios; a carteira; o FAQ em `details`; e o convite na faixa escura. Cada seção abre
   com o selo (o ícone e o nome numa etiqueta de 30 px), o título em dois tons, o parágrafo e o link.
8. **O movimento.** Na landing, só CSS (nenhum componente de cliente acima da dobra): as cenas em laço de 8 s, o ponto da temporada em
   andamento que pulsa a cada 2,6 s, o serrilhado dos números que anda um dente a cada 30 s, a seta dos botões e dos links que anda 2 px no
   hover (150 ms) e o "+" do FAQ que vira "×" (250 ms). Com movimento reduzido, tudo para no quadro de partida. O título e o parágrafo do
   topo aparecem parados (nada anima na abertura: o LCP).
9. **A primária** (`#14144C`; o 300 da escala no escuro) vai só na ação principal, na escolha atual, no foco, na marca e no estado atual (o
   ponto da temporada em andamento, que só aparece com ela em andamento). Enfeite nunca: o cadeado e a barra das cenas ficam na tinta.
10. **A arquitetura de informação e o comportamento** (de 05/11/2026) continuam:
    - **Duas cascas, por grupos de rota do Next**, sem mudar endereço, com um layout raiz só (o `html`, o `body`, a fonte e o viewport): a
      do site (`(site)`: a landing, o Como funciona e os textos legais; a 404 da raiz traz a mesma casca) e a do app
      (`(app)/(arena|explorar|carteira|chat|conta)`, e o `(auth)`, com entrar e criar conta na área da conta, a pedido do Artur em
      06/11/2026). O app tem uma `nav "Principal"` só, desenhada como a lateral e como a barra de abas (decisão 4). **O item ativo sai do
      servidor, sem JavaScript**: cada área tem o seu layout, que passa a área à `AppShell`, e o item dela leva `aria-current="page"`. O
      "Mais" abre um `popover` com as telas de apoio (Como funciona, Notícias, Ações, Termos, Privacidade), sem JavaScript: a folha da tela
      inteira no celular e um menu ao lado da lateral no desktop (o Esc devolve o foco ao "Mais"). O erro fica um por grupo (o `error.tsx`,
      com a casca do grupo em volta), todos com o mesmo `ApiDown`. A 404 de dentro do app (o `notFound()` lançado
      por uma página) aparece com o JavaScript (o limite visto no Next 16.4.3).
    - **As rotas**: a landing na `/`; a `/arena` (o conteúdo da home de antes), o `/explorar` e o `/chat`, pronto e desligado até o aval
      do orientador (a etapa 13). O `/?filtro=` e o `/?cursor=` de antes levam ao feed da `/arena` com 308, no `src/proxy.ts`, depois da
      trava de origem: os `redirects()` do `next.config.ts` rodam antes do proxy, e sem o `X-Azure-FDID` o pedido responderia 308 em vez
      de 403.
    - **Os temas**: claro, escuro e sistema (o padrão), pelo seletor do ADR 0037; o script em linha do `<head>` põe `data-tema` e a classe
      `dark` no `<html>` antes da pintura, e sem JavaScript vale o sistema. Cor fixa não segue o tema (hexadecimal em atributo de SVG ou em
      `style` some num dos dois): as cores vão por classe ou por `var()`. A suíte roda no claro, e o escuro roda em três projetos a mais
      (`pixel-7-escuro`, `iphone-15-escuro` e `desktop-escuro`), que pegam só os testes marcados `@tema`.
    - **Os logos dos laboratórios**: os SVG do LobeHub Icons (`@lobehub/icons-static-svg` 1.102.0, MIT) em `public/laboratorios/`, com a
      procedência em `docs/DEPENDENCIAS.md`; as versões coloridas, onde o pacote as tem (o Claude, o Gemini, o DeepSeek e o Qwen), como
      imagem, e o GPT e o Grok, só em preto, como máscara preta, no quadrado branco da decisão 6. O logo é decorativo, com o nome sempre ao
      lado em texto; o Sorteio e as referências levam ícones nossos (`public/referencias`). O laboratório sai do `modelId` ou, no provedor
      fake, do slug do elenco (`lib/laboratorio.ts`): o contrato público não muda. A cor do laboratório vai só na linha do gráfico. As
      marcas são dos donos, e o rodapé de toda tela diz isso.
    - **A arte só na moldura escura** (`.moldura`: o preto e a tinta da arte nos dois temas; o que segue o tema da página fica fora dela,
      por cima): a escadaria na landing e o urso na 404. O quadro 0 da escadaria vem no HTML; o do urso chega no navegador depois do `load`
      (`public/ascii/arte/urso-q0.json`), porque a árvore da 404 vai no documento de toda página.
    - **O "simulado"** visível, discreto e uma vez por contexto (ADR 0037): a nota no cabeçalho do placar, da tabela e da barra das
      carteiras, a etiqueta junto do título na página do modelo e o aviso de página na arena e no ciclo; nunca uma etiqueta em cada nome.

## Consequências

- **O e2e.** As garantias não mudam (360 px sem rolagem horizontal, os alvos de 44 px, o axe nos dois temas, a primária só onde a regra
  deixa, o dado conferido contra a api). Mudaram as medidas e os nomes: o `layout.spec.ts` mede a lateral de 248 px junto da coluna de
  1.040 px, com um fio só, e o conjunto no centro (em 1440 e 1920 px), a lateral na tela quando a página rola e a linha de abas de 56 px;
  o "Mais" do desktop abre a 8 px do fio da lateral; o fundo da página no `tema.spec.ts`
  é a folha; o `landing.spec.ts` confere as seções novas (o placar, o método com o dado do último ciclo, a justificativa, o elenco, a
  carteira, o FAQ e o rodapé na faixa escura); a tinta e o apoio que a carteira e a conta leem trocaram de valor; o teste do "›" da faixa
  virou o da rolagem do placar pelo teclado; e o `conta.spec.ts` confere que a pilha de avisos fica dentro da coluna.
- **O desempenho da home.** Nada entrou no caminho crítico: nenhuma fonte, nenhuma imagem, nenhum script de cliente; a janela do topo, as
  cenas e o gráfico são HTML e SVG do servidor, e o movimento é CSS. Mas a landing cresceu: o documento foi de 39,5 para 50,2 KB no fio (de
  456 para 782 elementos) e o CSS de 18,8 para 22,8 KB, e o LCP simulado do Lighthouse mobile soma o que chega antes do elemento do LCP (o
  parágrafo do topo, que pinta em 106 ms no trace). A medida, no mesmo Mac, carregado por outros trabalhos: mediana de **2.723 ms** (de
  2.717 a 2.795), CLS 0 e TBT de 22 ms, contra 2.491 ms, 0 e 17 ms antes do redesenho; acima do teto de 2,5 s. **A decisão do Artur, em
  18/11/2026: aceitar o LCP acima de 2,5 s e subir o teto para 2,8 s** (`apps/web/lighthouserc.json`), sem cortar o conteúdo novo. As
  medidas e os cortes, se um dia for preciso voltar abaixo de 2,5 s, estão em `docs/TELAS.md`, seção 5.
- **O merge com as telas.** Os nomes dos tokens e das classes ficaram (`canvas`, `ink`, `btn`, `pill`, `chip`, `segmentado`...), e os
  novos são poucos (`folha`, `escuro`, `escuro-fio`, `escuro-tinta`; `.linha`, `.coluna`, `.vao`): o que outra tarefa escreve com eles
  segue o tema novo sem mudar.
