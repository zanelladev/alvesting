---
name: Alvesting
description: Arena pública em que seis LLMs decidem BUY, HOLD ou SELL na B3, com dinheiro fictício. Precisa, calma, premium.
colors:
  primary: "#14144c"
  primary-dark: "#acb9fa"
  primary-hover: "#282b79"
  primary-hover-dark: "#c9d2fb"
  primary-foreground: "#ffffff"
  primary-foreground-dark: "#14144c"
  primary-50: "#f2f5fe"
  primary-100: "#e2e7fd"
  primary-200: "#c9d2fb"
  primary-300: "#acb9fa"
  primary-400: "#8c9aef"
  primary-500: "#6b78dc"
  primary-600: "#4f58bf"
  primary-700: "#3a3f9d"
  primary-800: "#282b79"
  primary-900: "#1c1d60"
  primary-950: "#14144c"
  folha: "#e6e9f0"
  folha-dark: "#1e2142"
  canvas: "#ffffff"
  canvas-dark: "#0b0d20"
  surface-card: "#f4f5f9"
  surface-card-dark: "#11142d"
  surface-strong: "#eceef4"
  surface-strong-dark: "#171a37"
  hairline: "#e4e7ee"
  hairline-dark: "#1a1d39"
  hairline-strong: "#d2d6e1"
  hairline-strong-dark: "#272b4d"
  control: "#7c8198"
  control-dark: "#6c71a6"
  ink: "#0d0f2b"
  ink-dark: "#eef0fa"
  body: "#3a3e5a"
  body-dark: "#c6c9dd"
  muted: "#5f647d"
  muted-dark: "#9398b6"
  escuro: "#0b0c24"
  escuro-dark: "#070818"
  escuro-fio: "#22254a"
  escuro-fio-dark: "#1b1e3e"
  escuro-tinta: "#ffffff"
  data-up: "#057a45"
  data-up-dark: "#4fd69c"
  data-down: "#c2183c"
  data-down-dark: "#ff7a90"
  selo-ok: "#057a45"
  selo-ok-dark: "#0a9455"
  selo-ok-tinta: "#ffffff"
  moldura: "#000000"
  moldura-tinta: "#f5f5f5"
  moldura-cinza: "#8a8a8a"
  serie-openai: "#0b7a5c"
  serie-anthropic: "#c4512c"
  serie-google: "#1a62d6"
  serie-xai: "#0d0f2b"
  serie-deepseek: "#3b54e0"
  serie-qwen: "#6b46d9"
  serie-neutra: "#5f647d"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "clamp(40px, 1.6rem + 2.6vw, 58px)"
    fontWeight: 500
    lineHeight: 1.04
    letterSpacing: "-0.034em"
  headline:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "clamp(30px, 1.3rem + 1.9vw, 44px)"
    fontWeight: 500
    lineHeight: 1.08
    letterSpacing: "-0.03em"
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "34px"
    fontWeight: 500
    lineHeight: 1.12
    letterSpacing: "-0.03em"
  body:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.45
    fontFeature: "tnum"
  label:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.33
    fontFeature: "tnum"
  hash:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"
    fontSize: "13px"
    fontWeight: 400
rounded:
  cell: "4px"
  button: "8px"
  field: "8px"
  segment-track: "10px"
  segment-choice: "7px"
  sidebar-item: "9px"
  card: "12px"
  chip: "6px"
  lab-logo: "28%"
spacing:
  base: "4px"
  cell: "8px"
  gutter: "20px"
  gutter-desktop: "24px"
  section: "48px"
  column-site: "1140px"
  column-app: "1040px"
  sidebar: "248px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.button}"
    padding: "0 18px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.primary-foreground}"
  button-secondary:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline-strong}"
    rounded: "{rounded.button}"
    padding: "0 18px"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-card}"
  field:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "0 12px"
    height: "44px"
  chip-selected:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.chip}"
    height: "32px"
  segmented-track:
    backgroundColor: "{colors.surface-card}"
    borderColor: "{colors.hairline}"
    rounded: "{rounded.segment-track}"
    height: "44px"
  segmented-selected:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.segment-choice}"
    height: "38px"
  theme-selector-selected:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.segment-choice}"
    size: "38px"
  sidebar-item-current:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    borderColor: "{colors.hairline}"
    rounded: "{rounded.sidebar-item}"
    height: "44px"
  page-cell:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.cell}"
  card:
    backgroundColor: "{colors.canvas}"
    borderColor: "{colors.hairline}"
    rounded: "{rounded.card}"
    padding: "24px"
  tooltip:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.button}"
    padding: "8px 12px"
---

# Design System: Alvesting

Este arquivo descreve o sistema visual do site (`apps/web`) desde 18/11/2026: **a página regrada** (ADR 0041, que substituiu o sistema visual
anterior), a primária do logo, os dois temas com o seletor e as peças das bibliotecas (ADR 0037). Os valores do cabeçalho são normativos e
vêm do `apps/web/src/app/globals.css`, a única fonte; cada cor tem o par claro e escuro (o sufixo `-dark`). O `docs/PRODUCT.md` diz para
quem e por quê; aqui fica só o visual.

## 1. Overview: a Página Regrada

**Creative North Star: "A Página Regrada"**

Um caderno de laboratório que se lê como um placar. O conteúdo mora em células sobre uma folha, separadas por fios de 1 px: uma coluna no
centro, com uma célula de cada lado, e faixas uma abaixo da outra. Os fios dão a estrutura e o ritmo; a pergunta de cada tela (quem está
ganhando, o que cada modelo tem, por que decidiu) tem a resposta em primeiro plano, em números exatos e alinhados. A cor aparece só onde há
decisão (a ação principal, a escolha atual, o foco, a marca) e onde há dado (o verde e o vermelho com o glifo, a linha de cada
laboratório). O movimento explica o método e a mudança, nunca decora: a cena do briefing que chega, a decisão que sai, o valor que conta, a
linha que se desenha, o tema novo que se revela a partir do controle tocado.

A densidade é a de um produto de dados (o registro `product`): tabelas densas de 13 px com algarismos tabulares, painéis separados por
fios, a coluna junto da lateral de navegação, e as duas no centro. A calma vem das faixas com respiro (o vão de 48 px entre as seções), de uma
sans só, dos títulos em dois tons e de uma cor só de acento. Premium nos detalhes: o alinhamento exato, os raios concêntricos, a sombra que
só eleva, o anel de foco visível, os estados completos.

O sistema recusa, pelo `docs/PRODUCT.md`: o **cassino de cripto** (neon, gradiente, contagem regressiva, cara de aposta), a **corretora
tradicional** (home broker carregado, cheio de caixas, menus e banners), o **painel SaaS genérico** (cards iguais com ícone, números gigantes
soltos, gradiente roxo) e o **terminal hacker** (tudo preto, fonte mono em tudo, verde de matriz). E recusa voltar ao sistema anterior: o trilho de
ícones, a pílula em todo controle, o logo no círculo, a faixa com o "›" de rolar e a pílula colorida no fim da linha do gráfico saíram.

**Key Characteristics:**

- A página regrada: a folha no fundo, as células no canvas, os fios de 1 px nos vãos, a coluna no centro (1.140 px no site; no app, 1.040 px junto da
  lateral, com as duas no centro).
- Uma sans só (a do sistema), algarismos tabulares em todo número, a mono só para hash e código, os títulos em dois tons.
- Neutros tingidos do azul do logo, uma primária (`#14144C`) em até um décimo da tela, o escuro azul-noite.
- Dois temas com o mesmo desenho: claro, escuro e sistema, escolhidos no seletor e guardados no navegador.
- Fios para estrutura; sombra só para elevação (o tooltip, o aviso, a janela da arena e os cartões das cenas).
- Movimento de 150 a 250 ms nas peças e em laços de CSS nas cenas da landing, saída forte, sem quique, parado com movimento reduzido; nada
  anima na abertura da página.
- Alvo de 44 px em todo controle, com a peça visível de 28 a 38 px por dentro.

## 2. Colors: a paleta da página

Neutros tingidos do azul do logo (a matiz 275), uma primária azul-noite e as cores do dado; o escuro é o mesmo desenho com os valores
trocados, no mesmo token.

### Primary

- **O azul do logo** (`#14144c`; no escuro `#acb9fa`, o 300 da escala): o botão primário (uma por superfície), a escolha atual (o chip
  escolhido, o filtro do feed, o ícone do item atual da lateral), o anel de foco, a marca e o estado atual (o ponto da temporada em
  andamento). O texto sobre ela é o branco no claro e o próprio azul no escuro (17,0:1 e 9,0:1). No hover, o 800 no claro e o 200 no escuro.
- **A escala** (do 50 `#f2f5fe` ao 950 `#14144c`, a matiz 275,49 em OKLCH): os tons claros (50 a 300) são os que aparecem sobre a moldura
  escura (a escadaria da landing, no azul da marca) e no rodapé escuro (a marca); os do meio ficam para o gráfico de uma série só (a
  carteira do usuário).

### Neutral

- **Folha** (`#e6e9f0` / `#1e2142`, `folha`): o fundo da página, que só aparece nos vãos de 1 px entre as células, e por isso desenha os fios.
- **Canvas** (`#ffffff` / `#0b0d20`): a célula, o cartão, a lateral e o cabeçalho; a cor da barra do navegador.
- **Segundo plano** (`#f4f5f9` / `#11142d`, `surface-card`): o painel, o campo, o vazio, o trilho do segmentado, o item atual da lateral, o
  hover.
- **Terceiro plano** (`#eceef4` / `#171a37`, `surface-strong`): o toque, o acordeão aberto, a inicial no lugar do logo.
- **Fio** (`#e4e7ee` / `#1a1d39`, `hairline`) e **fio forte** (`#d2d6e1` / `#272b4d`): toda borda de dentro da célula, de 1 px; o forte no
  botão de apoio, na grade do gráfico e no sublinhado do link.
- **Fio de controle** (`#7c8198` / `#6c71a6`, `control`): o que identifica um campo, com 3:1 no canvas e no segundo plano.
- **Tinta** (`#0d0f2b` / `#eef0fa`, `ink`): títulos, números, nomes, o link. **Corpo** (`#3a3e5a` / `#c6c9dd`): o texto corrido.
  **Apoio** (`#5f647d` / `#9398b6`, `muted`): rótulos, eixos, descrições e a segunda parte dos títulos (`.tom2`).
- **A faixa escura** (`#0b0c24` / `#070818`, `escuro`; o fio entre as células dela, `escuro-fio`): o convite do fim da landing e o rodapé do
  site, escura nos dois temas (no escuro, um tom abaixo do canvas, para se destacar), com o texto branco e o apoio a 62%.

### Tertiary (o dado)

- **Alta** (`#057a45` / `#4fd69c`) e **queda** (`#c2183c` / `#ff7a90`): só no glifo `▲ ▼`, no selo da ação (BUY e SELL) e no erro e no
  sucesso de formulário; o número
  fica na tinta. **Estável** é o apoio, com o `■`.
- **O selo do visto** (`selo-ok`: `#057a45` / `#0a9455`, com o visto branco, `selo-ok-tinta`, nos dois temas): o círculo de 20 px das cenas
  do método (o briefing que chega, a decisão e o prazo cumpridos), com o visto de 12 px no traço de 2,5 (o 1,5 dos ícones daria menos de
  1 px). O verde da alta no escuro é claro demais para segurar o branco: este fica no mesmo tom, mais escuro (o pedido do Artur em 18/11/2026,
  "verde e branco").
- **As séries** (uma por laboratório: OpenAI `#0b7a5c`, Anthropic `#c4512c`, Google `#1a62d6`, xAI na tinta, DeepSeek `#3b54e0`, Qwen
  `#6b46d9`, e o apoio no Sorteio; no escuro, os mesmos papéis mais claros): só na linha do gráfico e no anel do logo no fim dela, nunca no
  logo nem no valor. São o `--chart-1` a `--chart-7` das peças do shadcn.
- **A moldura** (`#000000`, a tinta `#f5f5f5`, o cinza `#8a8a8a`): escura nos dois temas; nela só moram a arte, a legenda, a fita e texto
  para o leitor de tela.

### Contraste (WCAG 2.2 AA, conferido pelo `tokens.spec.ts`)

| Par | Claro | Escuro | Mínimo |
|---|---|---|---|
| tinta sobre canvas | 18,74:1 | 16,91:1 | 4,5:1 |
| tinta sobre o segundo plano | 17,21:1 | 15,91:1 | 4,5:1 |
| corpo sobre canvas | 10,41:1 | 11,71:1 | 4,5:1 |
| apoio sobre canvas | 5,82:1 | 6,78:1 | 4,5:1 |
| apoio sobre o segundo plano | 5,35:1 | 6,38:1 | 4,5:1 |
| apoio sobre o terceiro plano | 5,02:1 | 5,98:1 | 4,5:1 |
| texto do botão primário sobre a primária | 17,02:1 | 8,97:1 | 4,5:1 |
| texto do botão primário no hover | 12,27:1 | 11,42:1 | 4,5:1 |
| link sobre canvas | 18,74:1 | 16,91:1 | 4,5:1 |
| alta sobre canvas | 5,42:1 | 10,46:1 | 4,5:1 |
| queda sobre canvas | 6,02:1 | 7,72:1 | 4,5:1 |
| anel de foco sobre canvas, segundo e terceiro plano | 17,02, 15,62 e 14,67:1 | 10,14, 9,53 e 8,94:1 | 3:1 |
| fio de controle sobre canvas e segundo plano | 3,85 e 3,54:1 | 4,16 e 3,92:1 | 3:1 |
| selo BUY e selo SELL (o texto na cor do dado, sobre ela a 10%) | 4,72 e 5,20:1 | 9,17 e 6,92:1 | 4,5:1 |
| branco e apoio (62%) sobre a faixa escura | 19,23 e 7,66:1 | 19,87 e 7,73:1 | 4,5:1 |
| o visto branco sobre o selo verde, e o selo sobre o cartão | 5,42 e 5,42:1 | 3,90 e 4,92:1 | 3:1 |

### Named Rules

**A Regra da Voz Única.** A primária cobre no máximo um décimo de qualquer tela: a ação principal, a escolha atual, o foco, a marca e o
estado atual (o ponto da temporada em andamento, só com ela em andamento). Link, ticker, nome e título ficam na tinta; o enfeite das cenas
(o cadeado, a barra do pregão) também. Se o azul aparece em toda linha de uma tabela, ele está no lugar errado.

**A Regra do Glifo.** A cor do dado nunca anda sozinha: alta, queda e estável levam `▲ ▼ ■` e o sinal, e a cor vai só no glifo. O selo da
ação é a outra casa da cor, com a palavra junto (o pedido do Artur em 18/11/2026): BUY no verde, SELL no vermelho e HOLD no cinza.

**A Regra do Token.** Nenhuma cor crua em peça, atributo de SVG ou `style`: hexadecimal ali não segue o tema. As peças das bibliotecas leem
os nomes delas (`--background`, `--primary`, `--surface`, `--accent`...), que apontam para os tokens.

**A Regra do Fio.** A estrutura da página é o vão entre células (a folha que aparece), não uma borda desenhada: um fio novo é uma célula a
mais ou uma faixa a mais. Dentro da célula, a borda de 1 px (`hairline`) separa o que é da mesma célula.

### O tema: claro, escuro e sistema

Cada token leva os dois valores (`light-dark(claro, escuro)`), e o `color-scheme` do `<html>` escolhe: `light dark` segue o sistema; o
seletor fixa `light` ou `dark` (`data-tema="claro"`, `"escuro"`; o padrão é `"sistema"`). O tema em uso também vai na classe `dark` (o do
Tailwind e do shadcn). Um script curto no `<head>` aplica a escolha guardada antes da primeira pintura; sem JavaScript, o tema segue o
sistema e o seletor não aparece. A cor da barra do navegador é o canvas de cada tema.

## 3. Typography: uma sans, títulos em dois tons

**Display Font:** a sans do sistema (`ui-sans-serif, system-ui`: SF, Roboto, Segoe), a mesma do texto.
**Body Font:** a mesma.
**Label/Mono Font:** a mono do sistema (`ui-monospace`), só para hash e código.
**Brand Font:** a Exo 2 600 (a tipografia da logo, desde 06/11/2026), só no nome "Alvesting" ao lado do touro (`font-marca`).

**Character:** uma grotesca só, nos pesos de verdade dela (400, 500 e 600), com algarismos tabulares em todo número: o dado alinha na
coluna e não pula quando muda. Os títulos são 500, com o espaçamento fechado, e em **dois tons** na mesma frase: a primeira parte na tinta,
a segunda no apoio, numa linha própria (`.tom2`; o h1 e o h2 continuam um texto só para o leitor de tela). A única fonte de fora é a Exo 2 do nome da marca, só
com as nove letras de "Alvesting" (1,7 KB em linha no CSS, sem requisição): o caminho do LCP da landing fica só com o HTML e o CSS.

### Hierarchy

- **Display** (500, de 40 a 58 px conforme a tela, 1,04, -0,034 em; `text-titulo`): o h1 do topo da landing.
- **Headline** (500, de 30 a 44 px, 1,08, -0,03 em; `text-secao`): o título de cada seção da landing e do convite.
- **Title** (500, 34 px, 1,12, -0,03 em; `text-pagina`): o título de página do app (o `PageHead`), um h1 por tela, fixo (o produto não
  muda de escala); as seções do app em 18/600.
- **Body** (400, 15 px no app e de 15 a 18 px na landing, 1,45): o texto corrido, até 65 caracteres por linha nos textos legais.
- **Label** (500, 13 px na célula e 12 px no cabeçalho de coluna e no eixo; o selo de seção em 14/500): tabelas, rótulos, chips. Caixa
  normal no que o e2e lê.
- **Hash** (mono 400, 13 px): o SHA-256 do prompt e do briefing, que quebra em qualquer ponto (`.hash`).

### Named Rules

**A Regra da Sans Única.** Título, número, ticker, rótulo de coluna e botão usam a mesma sans; a mono é só para hash e código. Ticker é a
sans 500 com algarismos tabulares, não a mono.

**A Regra do Algarismo Tabular.** Todo número é tabular (o `body` já leva o `tnum`): coluna de valor que se mexe ao trocar de dígito é
erro.

**A Regra dos Dois Tons.** O título diz a coisa na tinta e o contexto no apoio ("Quem está ganhando" / "depois de 17 pregões."), na mesma
frase. Nunca um rótulo em caixa alta acima do título: o selo da seção é o ícone e o nome, em caixa normal.

## 4. Elevation: plano, com fios

O sistema é plano: a estrutura é o fio (o vão entre células e a borda de 1 px) e os planos das superfícies, sem sombra. A sombra só eleva o
que flutua sobre outra coisa: o tooltip, o aviso (o toast), o menu "Mais" do desktop, o painel da leitura do gráfico, a janela da arena em
miniatura do topo da landing e os cartões das cenas do método. No escuro a sombra some no fundo, e a elevação vira um anel claro de 1 px
(branco a 8%).

### Shadow Vocabulary

- **Elevado** (`--shadow-raised`: `0 6px 18px rgb(0 0 0 / 0.08), 0 1px 3px rgb(0 0 0 / 0.04)`; no escuro o anel de 8% e `0 8px 22px` preto
  a 40%): o que flutua, acima.
- **Botão** (`--shadow-botao`: `0 1px 2px` da tinta a 24% e o brilho de 1 px por dentro): só o botão primário, que fica um passo acima da
  célula.
- **Escolha** (`--shadow-escolha`: `0 1px 2px` da tinta a 14% e o fio por dentro): o quadrado da escolha no segmentado e no seletor de tema.

### Named Rules

**A Regra Plana.** Superfície em repouso não tem sombra. Borda é estrutura (divisória, campo, tabela); sombra é elevação. Se um cartão tem
fio e sombra larga ao mesmo tempo, um dos dois sobra (a janela e os cartões das cenas são a exceção: flutuam sobre a cena, com o fio que os
recorta no escuro).

## 5. Components

O vocabulário é um só (ADR 0037): uma peça por tipo em todo o app, da Arc, da beUI, da ReUI ou nossa, com o motivo na tabela do ADR. As
peças copiadas moram em `apps/web/src/components/arc`, `.../beui` e `.../reui`, com o aviso MIT no topo e a linha de cada arquivo no
`docs/DEPENDENCIAS.md` (o `pnpm docs:check` confere). Peça nova só quando a tabela não tem uma, e registrada no ADR.

### A página regrada

- **A folha** (`.folha`): a pilha de faixas, com o vão de 1 px entre elas, na folha.
- **A faixa** (`.linha`): a célula da esquerda, a coluna e a da direita (as laterais são o `::before` e o `::after`), com o vão de 1 px.
- **A coluna** (`.coluna`; no app, `.coluna-app`): até 1.140 px no site e 1.040 px no app (`--coluna`), no centro, com cantos de 4 px;
  abaixo de 1024 px as laterais somem e ela enche a tela.
- **O vão** (`.vao`): a faixa vazia entre duas seções, 48 px (28 no celular), que desenha mais um fio na página.
- **A faixa escura** (`.escura`): o convite do fim e o rodapé, com as três células no `escuro`.
- **A seção** (`.secao`, a `Section` de `ui.tsx`; a da arena é a mesma): o fio de 1 px em cima e o título de 18 px na tinta; no app o fio
  vai de uma borda à outra da coluna ou do painel (come o respiro), e nas páginas de leitura do site acompanha a largura do texto.
- **A grade regrada** (as cotações e os ciclos da arena, os números do modelo, os cartões do Explorar): as células de uma borda à outra
  da coluna, separadas pelos fios. Onde a última linha pode ficar incompleta, cada célula desenha o próprio fio (`.celula-regrada`), e a
  casa vazia fica no fundo da página.

### Buttons

- **Shape:** o retângulo de raio 8, 44 px de altura, o texto 14/500, 18 px de cada lado.
- **Primary:** a primária com o texto dela e a sombra curta (`.btn .btn-primary`), uma por superfície; no hover, o tom da escala ao lado.
  Na faixa escura, o claro (`.btn-claro`: o branco com o texto no 950) e o de contorno no branco (`.btn-vazado`).
- **Secondary:** o canvas com o fio forte por dentro e o texto na tinta (`.btn`); no hover, o segundo plano.
- **Press / Focus:** encolhe a 0,96 no toque em 150 ms (a transição nomeia `scale`, a cor de fundo, a cor e a opacidade; nunca `all`); o
  anel de foco único (2 px na primária, 2 px de recuo), só no teclado. Desabilitado: o segundo plano com o texto de apoio, sem encolher. O
  formulário que nasce desativado até a hidratação (sem JavaScript ele não se envia) fica ativo sem transição: nada esmaece na abertura.
- **A seta:** os botões e os links "Abrir a arena ›" levam a seta, que anda 2 px para a frente no hover (150 ms) e volta.
- **Etiqueta e chip:** a peça de contorno (`.pill`: a etiqueta da temporada no topo da landing, o filtro por modelo do feed) e o chip
  (`.chip`), de 36 e 32 px visíveis na caixa de 44 px, raios 8 e 6; o chip escolhido é a primária. O fundo anda em 150 ms e o toque encolhe
  a 0,96, como o botão.
- **O selo da ação** (`.badge[data-action]`, `ActionBadge`): a etiqueta de 24 px, raio 6, na sans 600, na cor da ação: BUY no verde do
  dado e SELL no vermelho, com o fundo da cor a 10% e o fio dela a 35% por dentro, e HOLD no apoio, no segundo plano.
- **Paginação e atalhos:** o botão de apoio ("Mais antigas", o "Lançar compra" que leva ao formulário); a primária fica no envio.

### Segmented control e abas

- **Navegação entre telas e vistas:** os links `.segmentado` (o trilho de 44 px e raio 10 no segundo plano com o fio, e a escolha num
  quadrado do canvas de 38 px e raio 7) e `.abas` (15/500, a escolhida na tinta com o traço de 2 px embaixo, na linha de abas de 56 px), do
  servidor, com o `aria-current` na escolhida: as telas de uma área, o filtro do feed (a escolha na primária) e as vistas da arena no
  celular ("Decisões | Carteiras", `?vista=`).
- **Escolha dentro da tela:** o `RadioField` do form-kit (os radios nativos no desenho do segmentado, a escolha que desliza só por CSS): o
  modo de preço do lançamento da carteira e a escala do gráfico do patrimônio ("R$ | %"), fora de um formulário, com a legenda só para o
  leitor de tela e desativado até a hidratação.

### Theme selector (a peça da fundação)

Três radios num trilho de 44 px (Claro, Escuro e Sistema, com o ícone à vista e o nome em texto, a legenda "Tema"), cada um na caixa de 44
px, e a escolha: o quadrado do canvas de 38 px, o mesmo do segmentado, que anda 44 px por opção em 200 ms. No pé da lateral do app ele fica
com o rótulo "Tema" ao lado; na folha "Mais" do celular e na folha do "Menu" do site, como a linha "Tema"; no cabeçalho do site, antes de
"Entrar". Tocar numa opção que muda a cor em uso revela a página nova num círculo que cresce do controle (a View Transition API, 250 ms,
adaptada do Theme Toggle da beUI); o teclado e o movimento reduzido trocam na hora, e nenhuma transição roda durante a troca.

### Cards / Containers

- **Corner Style:** 4 px na célula da página; 8 px no botão, no campo e na moldura; 12 px no cartão que flutua dentro de uma célula; 9 px
  no item da lateral; 10 e 7 px no segmentado; 13 px na janela da arena. Raio concêntrico: o de fora é o de dentro mais o respiro.
- **Background:** a célula no canvas; o cartão no canvas com o fio (`.card`), ou o segundo plano sem fio (`.vazio`, `.painel`).
- **Shadow Strategy:** nenhuma (a Regra Plana).
- **Internal Padding:** 20 px na coluna do celular e 24 px no desktop; 24 px no cartão; 8 px de cada lado na célula de tabela.

### Inputs / Fields

- **Style:** o campo (`.field`): 44 px, raio 8, o segundo plano, o fio de controle (3:1), 16 px de texto (abaixo disso o Safari do iPhone
  dá zoom).
- **Focus:** o anel único.
- **Error / Disabled:** a borda no vermelho do erro (`aria-invalid`); o texto de apoio.
- **Dinheiro:** o mesmo campo, com a regra do contrato (`parseBrl`; o "1.234" ambíguo é recusado).
- **Select:** o `<select>` do navegador com o desenho do campo (o Native select da ReUI): o seletor do sistema no celular.
- **Caixa de marcar:** a nativa de 20 px na cor da tinta, dentro do alvo de 44 px do rótulo.
- **Radio:** o desenho do radio nativo, de 20 px, dentro do alvo de 44 px do rótulo da opção (o radio e o texto); o estado é a espessura da
  borda, 2 px no fio de controle desmarcado e 6 px na tinta marcado, com o miolo no canvas (sobrevive às cores forçadas do sistema).
- **Termo com explicação:** o sublinhado pontilhado no fio de controle (`.termo`), num botão de 44 px com o tooltip da Arc; a mesma
  explicação fica em texto na tela, para o toque. Quando a explicação não cabe em texto na tela (a faixa do Monte Carlo do gráfico), o "i"
  num círculo (`.info`, 16 px numa caixa de 44) abre o balão (`.info-balao`) no clique, no toque e pelo teclado: o popover nativo, que o
  Esc e o toque fora fecham.

### Navigation

- **O app:** a partir de 1024 px, a lateral de 248 px, que fica na tela enquanto a página rola, junto da coluna, com um fio só entre as
  duas, e o conjunto no centro, entre as células de fora (o pedido do Artur em 18/11/2026: "a navbar perto da página, grudada"): a marca no
  topo, os itens com o ícone de 20 px ao lado do rótulo (44 px, raio 9; o atual no segundo plano com o fio por dentro, e o ícone na
  primária), o "Mais" e, no pé, o seletor de tema e a "Conta". A busca mora nas telas (o Explorar e as Ações), e não na lateral. Abaixo de 1024 px, a marca numa linha no
  topo e a barra de abas de 56 px no pé (o ícone em cima e o rótulo embaixo; o atual na tinta, com o ícone na primária). O "Mais" abre o
  `popover` das telas de apoio: a folha da tela inteira no celular, um menu curto a 8 px do fio da lateral no desktop.
- **A área:** no celular, a trilha ("Início › Arena") e o segmentado das sub-telas; a partir de 1024 px, a linha de abas, a primeira faixa
  da coluna (56 px, o fio embaixo), com o botão de contorno "Regras da arena" à direita.
- **O site:** o cabeçalho de 68 px numa faixa, preso no topo: a marca e os links logo depois dela (14/500, apoio, a tinta e o segundo plano
  no hover), o seletor de tema e o botão "Entrar" à direita; abaixo de 1024 px, a folha do "Menu".
- **O rodapé do site:** a faixa escura, com o mapa do site em colunas (e a marca) e o aviso fixo, as atribuições e o ©.
- **A marca:** o touro do Artur (`public/marca.svg`, como máscara), na primária (o azul do logo no claro, o tom claro no escuro e no
  rodapé escuro), com o nome "Alvesting" na Exo 2 ao lado; trocar o logo é trocar o arquivo (e o `app/icon.svg`).

### Data

- **O placar** (`.faixa`, `FaixaDeModelos`): os modelos e o Sorteio numa régua de células iguais, de pelo menos 216 px (o nome inteiro, o
  retorno grande), separadas pelos fios de 1 px, com a
  posição pelo contador do CSS; onde não cabe, rola dentro da própria caixa, com a borda da direita esmaecida enquanto há mais.
- **Tabela** (`.tbl`, `.th`, `.td`, `.row`, na caixa `TableScroll`, entre um fio em cima e outro embaixo, sem cantos): a célula 13/400,
  o cabeçalho 12/500 no apoio, o fio entre as linhas, 8 px de cada lado. A
  que passa da coluna rola dentro da caixa dela, e a borda da direita esmaece enquanto há mais colunas; o nome do competidor fica numa
  linha. As três tabelas do ranking têm as mesmas colunas.
- **Gráficos:** a família da beUI (linha, rosca, sparkline, o desenho das velas e o ranking no tempo), um estilo só em todas as telas, com a
  série de cada laboratório; no fim de cada linha, o logo com o anel da cor da série e o valor em texto na tinta. A linha, a rosca e o
  ranking no tempo se leem pelo teclado; a sparkline e as velas são imagens com o resumo em texto (as velas não entregam a série, ADR 0033).
  Na landing, o gráfico pequeno de servidor (`GraficoMini`), decorativo, com o mesmo dado em texto ao lado.
- **O logo do laboratório:** o desenho da marca num quadrado branco de cantos arredondados (28% do lado), com o contorno de 1 px, nos dois
  temas; o logo das ações fica no círculo (ADR 0036).
- **Contador:** o Animated counter da Arc, em pt-BR, que só gira quando o número muda.
- **Tooltip:** o da Arc, o balão na tinta com raio 8 e 13 px; no toque ele não abre, e o que ele diz é complemento.
- **Toast:** o Animated Toast Stack da beUI, com a região viva.

### A landing

- **O selo de seção** (`.selo`): o ícone e o nome numa etiqueta de 30 px, raio 9, no segundo plano com o fio; um por seção.
- **O ícone no texto** (`.ico`): 22 px, raio 6, o canvas com o fio forte, na linha de base do texto corrido do topo.
- **A janela da arena** (`.janela`): o app em miniatura (a lateral, o placar dos quatro primeiros e o gráfico), com o dado de verdade do
  último pregão, decorativa (`aria-hidden`, nenhum link dentro), a partir de 1024 px à direita do título; no celular, embaixo dos botões.
- **Os números** (`.numeros`): a célula do serrilhado que abre a faixa (o `::before` da grade: fileiras de dentes de 24 px no terceiro
  plano, que andam um dente a cada 30 s) e os números da temporada (o capital, o
  universo e os pregões liquidados), numa linha a partir de 1024 px e em 2 × 2 no celular, a branca primeiro; o número em 46 px e o que ele
  é embaixo, no apoio.
- **As cenas do método** (`.cena`): três células por linha a partir de 1024 px, cada uma com a cena em cima (300 px, o segundo plano, os
  cartões flutuando) e o título e o texto embaixo; a cena é decorativa (`aria-hidden`), e o texto diz o mesmo.
- **A citação** (`.citacao`): a justificativa de um modelo em 31 px, o contexto no apoio e a decisão na tinta, e quem disse ao lado.
- **O FAQ** (`.faq`): o título numa célula e as perguntas na outra, cada uma um `details` do navegador, com o "+" que vira "×".

### Motion

Os tokens moram no `globals.css` e, para o Motion, em `apps/web/src/lib/motion.ts` (o `motion.spec.ts` prende os dois): 150 ms no que se
repete (o toque, o hover, a cor), 200 ms no que muda de lugar (a escolha do seletor), 250 ms no que muda a tela (a troca de tema); as curvas
`--ease-out-quart` (`cubic-bezier(0.25, 1, 0.5, 1)`), `--ease-out-quint` (`cubic-bezier(0.22, 1, 0.36, 1)`) e `--ease-out-expo`
(`cubic-bezier(0.16, 1, 0.3, 1)`); as molas do Motion sem quique (`bounce: 0`). Na landing, só CSS: as cenas do método em laço de 8 s, com o
movimento do desenho (as linhas do briefing que entram uma a uma, de desfocadas a nítidas, com o visto e o SHA-256 que se digita; o
tracejado que leva cada laboratório ao prompt; o "decidindo" que dá lugar às ordens; a barra do pregão que enche até a ordem executar; os
logos que chegam à régua do percentil; as linhas das referências que se desenham; e, no fim do laço, tudo some e recomeça), o ponto da temporada em andamento que pulsa a cada 2,6 s, o serrilhado dos números que anda
um dente a cada 30 s, a seta que anda 2 px e o "+" do FAQ que gira em 250 ms. Com `prefers-reduced-motion`, nada se desloca: a regra global zera animação e transição, e cada peça
fica no quadro de partida. A série que a legenda mostra de novo se desenha da esquerda para a direita, num recorte que cresce em 250 ms
(`.linha-desenha`). O esmaecer da borda das tabelas e do placar que rolam é uma animação ligada à rolagem, e não ao tempo.

## 6. Do's and Don'ts

### Do:

- **Do** monte a tela em faixas da página regrada: a coluna no centro, as células laterais, o vão de 1 px; um fio novo é uma célula a mais.
- **Do** use a primária (`#14144c`, `#acb9fa` no escuro) só na ação principal, na escolha atual, no anel de foco, na marca e no estado
  atual.
- **Do** escreva toda cor por token (`bg-canvas`, `text-ink`, `var(--color-primary)`) e deixe as peças das bibliotecas lerem os nomes delas
  (`--background`, `--primary`, `--surface`, `--accent`), que apontam para os tokens.
- **Do** use a sans do sistema em tudo, com algarismos tabulares; a mono só no hash e no código (`.hash`); o título em dois tons.
- **Do** deixe a etiqueta "simulado" visível, discreta e uma vez por contexto (a honestidade é obrigatória; o peso, não).
- **Do** dê a todo controle a caixa de 44 px, o anel único no foco do teclado e os estados completos (repouso, hover, foco, ativo,
  desabilitado, carregando, erro).
- **Do** anime só o que explica uma mudança ou o método, entre 150 e 250 ms nas peças, com saída forte, e escreva o ramo de movimento
  reduzido.
- **Do** pegue a peça da tabela do ADR 0037 antes de escrever uma nova; peça nova entra no ADR.

### Don't:

- **Don't** pareça um **cassino de cripto**: neon, gradiente, contagem regressiva, cara de aposta.
- **Don't** pareça uma **corretora tradicional**: home broker carregado, cheio de caixas, menus e banners.
- **Don't** pareça um **painel SaaS genérico**: cards iguais com ícone, números gigantes soltos, gradiente roxo.
- **Don't** pareça um **terminal hacker**: tudo preto, fonte mono em tudo, verde de matriz.
- **Don't** volte às marcas do sistema anterior: o trilho de ícones, a pílula em todo controle, o logo do laboratório no círculo, o "›" de rolar a
  faixa, o valor numa pílula colorida no fim da linha, o nome gigante no rodapé.
- **Don't** pinte link, ticker ou nome de tabela na primária, nem use a mono nos tickers, nos títulos das colunas ou nos rótulos.
- **Don't** repita o `▲ ▼` em duas colunas da mesma linha, nem ponha o sufixo de versão ("(0902)") no nome em lugar apertado.
- **Don't** use `transition: all`, quique, mola que passa do ponto, ou animação na abertura da página.
- **Don't** escreva hexadecimal em atributo de SVG ou em `style`: não segue o tema.
- **Don't** use faixa lateral colorida, texto em gradiente, vidro decorativo, "número gigante com rótulo" nem rótulo em caixa alta acima de
  toda seção.
- **Don't** traga item Pro de nenhuma das três bibliotecas, nem o refaça a partir da prévia.
