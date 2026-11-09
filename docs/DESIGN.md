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
  canvas: "#ffffff"
  canvas-dark: "#171717"
  surface-card: "#f5f5f5"
  surface-card-dark: "#1f1f1f"
  surface-strong: "#efefef"
  surface-strong-dark: "#242424"
  hairline: "#e5e5e5"
  hairline-dark: "#262626"
  hairline-strong: "#d4d4d4"
  hairline-strong-dark: "#333333"
  control: "#8a8a90"
  control-dark: "#707077"
  ink: "#0a0a0a"
  ink-dark: "#fafafa"
  body: "#17171f"
  body-dark: "#f5f5f7"
  muted: "#6b6b72"
  muted-dark: "#a3a3a9"
  data-up: "#007a32"
  data-up-dark: "#9ae600"
  data-down: "#d6003a"
  data-down-dark: "#ff637e"
  moldura: "#000000"
  moldura-tinta: "#f5f5f5"
  moldura-cinza: "#8a8a8a"
  serie-openai: "#0b7a5c"
  serie-anthropic: "#c4512c"
  serie-google: "#1a62d6"
  serie-xai: "#0a0a0a"
  serie-deepseek: "#3b54e0"
  serie-qwen: "#6b46d9"
  serie-neutra: "#6b6b72"
typography:
  display:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "-0.027em"
  headline:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "-0.02em"
  title:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
    fontSize: "22px"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.023em"
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
  pill: "9999px"
  card: "8px"
  tile: "6px"
  rail-item: "16px"
  search: "12px"
  chat-box: "24px"
spacing:
  base: "4px"
  cell: "8px"
  gutter: "20px"
  gutter-desktop: "24px"
  section: "48px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.primary-foreground}"
  button-secondary:
    backgroundColor: "{colors.surface-strong}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "44px"
  button-secondary-hover:
    backgroundColor: "{colors.hairline}"
  field:
    backgroundColor: "{colors.surface-card}"
    textColor: "{colors.ink}"
    rounded: "{rounded.card}"
    padding: "0 12px"
    height: "44px"
  chip-selected:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.pill}"
    height: "32px"
  segmented-track:
    backgroundColor: "{colors.surface-strong}"
    rounded: "{rounded.pill}"
    height: "40px"
  segmented-selected:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    height: "32px"
  theme-selector-selected:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.pill}"
    size: "32px"
  card:
    backgroundColor: "{colors.canvas}"
    rounded: "{rounded.card}"
    padding: "24px"
  tooltip:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.canvas}"
    rounded: "{rounded.card}"
    padding: "8px 12px"
---

# Design System: Alvesting

Este arquivo descreve o sistema visual do site (`apps/web`) desde a onda "design premium" de 05/11/2026: a linguagem do Rallies AI (ADR 0035),
a primária do logo, os dois temas com o seletor e as peças das bibliotecas (ADR 0037). Os valores do cabeçalho são normativos e vêm do
`apps/web/src/app/globals.css`, a única fonte; cada cor tem o par claro e escuro (o sufixo `-dark`). O `docs/PRODUCT.md` diz para quem e
por quê; aqui fica só o visual.

## 1. Overview: o Placar Calmo

**Creative North Star: "O Placar Calmo"**

Um placar que se lê em segundos e não grita. A pergunta de cada tela (quem está ganhando, o que cada modelo tem, por que decidiu) tem a
resposta em primeiro plano, em números exatos e alinhados, sobre um fundo neutro com fios finos; a cor aparece só onde há decisão (a ação
principal, a escolha atual, o foco, a marca) e onde há dado (o verde e o vermelho com o glifo, a linha de cada laboratório). O movimento
explica a mudança, nunca decora: o valor que conta, a linha que se desenha, a pílula que anda até a escolha, o tema novo que se revela a
partir do controle tocado.

A densidade é a de um produto de dados (o registro `product`): tabelas densas de 13 px com algarismos tabulares, painéis encostados por
fios, a coluna do app enchendo a tela até 1.550 px. A calma vem do respiro entre os grupos, de uma sans só e de uma cor só de acento.
Premium nos detalhes: o alinhamento exato, os raios concêntricos, a sombra que só eleva, o anel de foco visível, os estados completos.

O sistema recusa, pelo `docs/PRODUCT.md`: o **cassino de cripto** (neon, gradiente, contagem regressiva, cara de aposta), a **corretora
tradicional** (home broker carregado, cheio de caixas, menus e banners), o **painel SaaS genérico** (cards iguais com ícone, números gigantes
soltos, gradiente roxo) e o **terminal hacker** (tudo preto, fonte mono em tudo, verde de matriz).

**Key Characteristics:**

- Uma sans só (a do sistema), algarismos tabulares em todo número, a mono só para hash e código.
- Neutros quase sem croma, uma primária (o azul do logo, `#14144C`) em até um décimo da tela.
- Dois temas com o mesmo desenho: claro, escuro e sistema, escolhidos no seletor e guardados no navegador.
- Fios de 1 px para estrutura; sombra só para elevação (o recorte sobre a moldura da landing, o tooltip).
- Movimento de 150 a 250 ms, saída forte, sem quique, parado com movimento reduzido; nada anima na abertura da página.
- Alvo de 44 px em todo controle, com a pílula visível de 28 a 36 px por dentro.

## 2. Colors: a paleta do placar

Neutros sem tom, uma primária azul-noite e as cores do dado; o escuro é o mesmo desenho com os valores trocados, no mesmo token.

### Primary

- **O azul do logo** (`#14144c`; no escuro `#acb9fa`, o 300 da escala): o botão primário (uma por superfície), a escolha atual (o chip
  escolhido, o filtro do feed, a pílula do seletor de tema), o anel de foco e a marca. O texto sobre ela é o branco no claro e o próprio azul
  no escuro (17,0:1 e 9,0:1). No hover, o 800 no claro e o 200 no escuro.
- **A escala** (do 50 `#f2f5fe` ao 950 `#14144c`, a matiz 275,49 em OKLCH): os tons claros (50 a 300) são os que aparecem sobre a moldura
  escura (a escadaria da landing, refeita no azul da marca pela tarefa da landing); os do meio ficam para o gráfico de uma série só (a
  carteira do usuário).

### Neutral

- **Canvas** (`#ffffff` / `#171717`): o fundo de toda tela e do cartão.
- **Cinza do painel** (`#f5f5f5` / `#1f1f1f`, `surface-card`): o painel, o ladrilho, o campo, o vazio.
- **Cinza do trilho** (`#efefef` / `#242424`, `surface-strong`): o trilho do segmentado e do seletor, a pílula cinza, o item ativo.
- **Fio** (`#e5e5e5` / `#262626`, `hairline`) e **fio forte** (`#d4d4d4` / `#333333`): toda borda de estrutura, de 1 px; o forte na grade do
  gráfico e no sublinhado do link.
- **Fio de controle** (`#8a8a90` / `#707077`, `control`): o que identifica um campo, com 3:1 no canvas e no cinza do painel.
- **Tinta** (`#0a0a0a` / `#fafafa`, `ink`): títulos, números, nomes, o link. **Corpo** (`#17171f` / `#f5f5f7`): o texto corrido.
  **Secundário** (`#6b6b72` / `#a3a3a9`, `muted`): rótulos, eixos, descrições (4,6:1 até no cinza do trilho).

### Tertiary (o dado)

- **Alta** (`#007a32` / `#9ae600`) e **queda** (`#d6003a` / `#ff637e`): só no glifo `▲ ▼` e no erro e no sucesso de formulário; o número
  fica na tinta. **Estável** é o secundário, com o `■`.
- **As séries** (uma por laboratório: OpenAI `#0b7a5c`, Anthropic `#c4512c`, Google `#1a62d6`, xAI na tinta, DeepSeek `#3b54e0`, Qwen
  `#6b46d9`, e o cinza do Sorteio; no escuro, os mesmos papéis mais claros): só na linha do gráfico e no anel do logo no fim dela, nunca no
  logo. São o `--chart-1` a `--chart-7` das peças do shadcn.
- **A moldura** (`#000000`, a tinta `#f5f5f5`, o cinza `#8a8a8a`): escura nos dois temas; nela só moram a arte, a legenda, a fita e texto
  para o leitor de tela.

### Contraste (WCAG 2.2 AA, conferido pelo `tokens.spec.ts`)

| Par | Claro | Escuro | Mínimo |
|---|---|---|---|
| tinta sobre canvas | 19,80:1 | 17,18:1 | 4,5:1 |
| tinta sobre o cinza do painel | 18,16:1 | 15,79:1 | 4,5:1 |
| corpo sobre canvas | 17,82:1 | 16,47:1 | 4,5:1 |
| secundário sobre canvas | 5,29:1 | 7,14:1 | 4,5:1 |
| secundário sobre o cinza do painel | 4,85:1 | 6,57:1 | 4,5:1 |
| secundário sobre o cinza do trilho | 4,60:1 | 6,19:1 | 4,5:1 |
| texto do botão primário sobre a primária | 17,02:1 | 8,99:1 | 4,5:1 |
| texto do botão primário no hover | 12,23:1 | 11,41:1 | 4,5:1 |
| link sobre canvas | 19,80:1 | 17,18:1 | 4,5:1 |
| alta sobre canvas | 5,48:1 | 11,69:1 | 4,5:1 |
| queda sobre canvas | 5,36:1 | 6,26:1 | 4,5:1 |
| anel de foco sobre canvas, painel e trilho | 17,02, 15,61 e 14,80:1 | 9,48, 8,71 e 8,21:1 | 3:1 |
| fio de controle sobre canvas e painel | 3,43 e 3,15:1 | 3,65 e 3,35:1 | 3:1 |
| pílula do seletor (a primária) sobre o trilho | 14,80:1 | 8,21:1 | 3:1 |

### Named Rules

**A Regra da Voz Única.** A primária cobre no máximo um décimo de qualquer tela: a ação principal, a escolha atual, o foco e a marca. Link,
ticker, nome e título ficam na tinta. Se o azul aparece em toda linha de uma tabela, ele está no lugar errado.

**A Regra do Glifo.** A cor do dado nunca anda sozinha: alta, queda e estável levam `▲ ▼ ■` e o sinal, e a cor vai só no glifo.

**A Regra do Token.** Nenhuma cor crua em peça, atributo de SVG ou `style`: hexadecimal ali não segue o tema. As peças das bibliotecas leem
os nomes delas (`--background`, `--primary`, `--surface`, `--accent`...), que apontam para os tokens.

### O tema: claro, escuro e sistema

Cada token leva os dois valores (`light-dark(claro, escuro)`), e o `color-scheme` do `<html>` escolhe: `light dark` segue o sistema; o
seletor fixa `light` ou `dark` (`data-tema="claro"`, `"escuro"`; o padrão é `"sistema"`). O tema em uso também vai em `data-theme` (o da
Arc) e na classe `dark` (o do Tailwind e do shadcn). Um script curto no `<head>` aplica a escolha guardada antes da primeira pintura; sem
JavaScript, o tema segue o sistema e o seletor não aparece. A cor da barra do navegador acompanha a escolha.

## 3. Typography: uma sans, números alinhados

**Display Font:** a sans do sistema (`ui-sans-serif, system-ui`: SF, Roboto, Segoe), a mesma do texto.
**Body Font:** a mesma.
**Label/Mono Font:** a mono do sistema (`ui-monospace`), só para hash e código.
**Brand Font:** a Exo 2 600 (a tipografia da logo, desde 06/11/2026), só no nome "Alvesting" ao lado do touro e no nome gigante do rodapé
(`font-marca`).

**Character:** uma grotesca só, nos pesos de verdade dela (400, 500 e 600), com algarismos tabulares em todo número: o dado alinha na
coluna e não pula quando muda. A única fonte de fora é a Exo 2 do nome da marca, só com as nove letras de "Alvesting" (1,7 KB em linha
no CSS, sem requisição): o caminho do LCP da landing fica só com o HTML e o CSS. O `font-display` dos
títulos traz o 600 com ele (a Geist que saiu só tinha essa face, e o navegador a usava em qualquer peso; a do sistema respeita o peso
pedido), e um peso explícito (`font-medium`) ainda ganha.

### Hierarchy

- **Display** (600, 30 px, 1,3, -0,027 em): o título do hero. O CTA final da landing vai a 42 px (-0,04 em).
- **Headline** (600, 26 px, 1,5, -0,02 em): o título de página do app (o `PageHead`); um h1 por tela.
- **Title** (600, 22 px, 1,35, -0,023 em): as seções; o item do feed em 18/600.
- **Body** (400, 15 px na landing e 14 px no app, 1,45): o texto corrido, até 65 caracteres por linha nos textos legais.
- **Label** (500, 13 px na célula e 11 px no cabeçalho de coluna e no eixo): tabelas, rótulos, chips. Caixa normal no que o e2e lê.
- **Hash** (mono 400, 13 px): o SHA-256 do prompt e do briefing, que quebra em qualquer ponto (`.hash`).

### Named Rules

**A Regra da Sans Única.** Título, número, ticker, rótulo de coluna e botão usam a mesma sans; a mono é só para hash e código. Ticker é a
sans 500 com algarismos tabulares, não a mono.

**A Regra do Algarismo Tabular.** Todo número é tabular (o `body` já leva o `tnum`): coluna de valor que se mexe ao trocar de dígito é
erro.

## 4. Elevation: plano, com fios

O sistema é plano: a estrutura é o fio de 1 px e o cinza das superfícies, sem sombra. A sombra só eleva o que flutua sobre outra coisa: o
recorte de UI sobre a moldura da landing (`0 24px 64px -24px` preto a 45%), o tooltip, o aviso (o toast) e o painel da leitura do gráfico.
No escuro a sombra some no fundo, e a elevação vira um anel claro de 1 px (branco a 8%).

### Shadow Vocabulary

- **Elevado** (`box-shadow: 0 6px 18px rgb(0 0 0 / 0.08), 0 1px 3px rgb(0 0 0 / 0.04)`; no escuro o anel de 8% e `0 8px 22px` preto a 40%):
  o tooltip, o aviso e o painel da leitura do gráfico (`--shadow-raised`). A sombra de repouso, que era da pílula do segmentado da Arc, saiu
  com ele.
- **Recorte** (`box-shadow: 0 24px 64px -24px rgb(0 0 0 / 0.45)`): só o recorte de UI sobre a moldura da landing (`.recorte`).

### Named Rules

**A Regra Plana.** Superfície em repouso não tem sombra. Borda é estrutura (divisória, campo, tabela); sombra é elevação. Se um cartão tem
fio e sombra larga ao mesmo tempo, um dos dois sobra.

## 5. Components

O vocabulário é um só (ADR 0037): uma peça por tipo em todo o app, da Arc, da beUI, da ReUI ou nossa, com o motivo na tabela do ADR. As
peças copiadas moram em `apps/web/src/components/arc`, `.../beui` e `.../reui`, com o aviso MIT no topo e a linha de cada arquivo no
`docs/DEPENDENCIAS.md` (o `pnpm docs:check` confere). Peça nova só quando a tabela não tem uma, e registrada no ADR.

### Buttons

- **Shape:** a pílula (`9999px`), 44 px de altura, o texto 14/500.
- **Primary:** a primária com o texto dela (`.btn .btn-primary`), uma por superfície; no hover, o tom da escala ao lado.
- **Secondary:** a pílula cinza do trilho com o texto na tinta (`.btn`); no hover, o fio.
- **Press / Focus:** encolhe a 0,96 no toque em 150 ms (a transição nomeia `scale`, a cor de fundo, a cor e a opacidade; nunca `all`); o
  anel de foco único (2 px na primária, 2 px de recuo), só no teclado. Desabilitado: o cinza do painel com o texto secundário, sem encolher.
  O formulário que nasce desativado até a hidratação (sem JavaScript ele não se envia) fica ativo sem transição: nada esmaece na abertura.
- **Pill e chip:** a pílula de contorno (`.pill`) e o chip cinza (`.chip`) de 32 px visíveis na caixa de 44 px; o chip escolhido é a
  primária. O fundo anda em 150 ms e o toque encolhe a 0,96, como o botão (o cabeçalho do site inclusive).
- **Paginação e atalhos:** a pílula cinza ("Mais antigas", o "Lançar compra" que leva ao formulário); a primária fica no envio.

### Segmented control e abas

- **Navegação entre telas e vistas:** os links `.segmentado` (o trilho cinza de 40 px e a pílula do canvas de 32 px) e `.abas` (15/500, a
  escolhida na tinta), do servidor, com o `aria-current` na escolhida: as telas de uma área, o filtro do feed e as vistas da arena no celular
  ("Decisões | Carteiras", `?vista=`). O Segmented control da Arc, de cliente, saiu por falta de uso (ADR 0037).

### Theme selector (a peça da fundação)

Três radios num trilho cinza de 40 px (Claro, Escuro e Sistema, com o ícone à vista e o nome em texto, a legenda "Tema"), cada um na caixa de
44 px, e a pílula da escolha: um círculo de 32 px na primária, que anda 44 px por opção em 200 ms. No pé do trilho do app ele fica em pé, com
o rótulo "Tema" embaixo; na folha "Mais" do celular e na folha do "Menu" do site, como a linha "Tema"; no cabeçalho do site, antes de
"Entrar". Tocar numa opção que muda a cor em uso revela a página nova num círculo que cresce do controle (a View Transition API, 250 ms,
adaptada do Theme Toggle da beUI); o teclado e o movimento reduzido trocam na hora, e nenhuma transição roda durante a troca.

### Cards / Containers

- **Corner Style:** 8 px no cartão, no campo e na moldura; 6 px no ladrilho e no painel da landing; 16 px no item do trilho; 24 px na caixa
  do chat. Raio concêntrico: o de fora é o de dentro mais o respiro.
- **Background:** o canvas com o fio (`.card`), ou o cinza do painel sem fio (`.vazio`, `.painel`).
- **Shadow Strategy:** nenhuma (a Regra Plana).
- **Internal Padding:** 24 px no cartão; 8 px de cada lado na célula de tabela.

### Inputs / Fields

- **Style:** o campo do cadastro do Rallies (`.field`): 44 px, raio 8, o cinza do painel, o fio de controle (3:1), 16 px de texto (abaixo
  disso o Safari do iPhone dá zoom).
- **Focus:** o anel único.
- **Error / Disabled:** a borda no vermelho do erro (`aria-invalid`); o texto secundário.
- **Dinheiro:** o mesmo campo, com a regra do contrato (`parseBrl`; o "1.234" ambíguo é recusado).
- **Select:** o `<select>` do navegador com o desenho do campo (o Native select da ReUI): o seletor do sistema no celular.
- **Caixa de marcar:** 44 × 44, marcada na tinta com o glifo `✕` no canvas.
- **Radio:** o desenho do radio nativo, de 20 px, dentro do alvo de 44 px do rótulo da opção (o radio e o texto); o estado é a espessura da
  borda, 2 px no fio de controle desmarcado e 6 px na tinta marcado, com o miolo no canvas (sobrevive às cores forçadas do sistema).
- **Termo com explicação:** o sublinhado pontilhado no fio de controle (`.termo`), num botão de 44 px com o tooltip da Arc; a mesma
  explicação fica em texto na tela, para o toque. Quando a explicação não cabe em texto na tela (a faixa do Monte Carlo do gráfico, desde
  06/11/2026), o "i" num círculo (`.info`, 16 px numa caixa de 44) abre o balão (`.info-balao`) no clique, no toque e pelo teclado: o
  popover nativo, que o Esc e o toque fora fecham.

### Navigation

- **O app:** o trilho de 80 px no desktop (o ícone em cima e o rótulo de 12/500 embaixo, numa caixa de 58 × 54, raio 16; o ativo com o
  círculo cheio atrás do ícone) e a barra de abas de 56 px no pé do celular; o "Mais" abre o `popover` das telas de apoio. A marca no topo.
- **O site:** o cabeçalho de 64 px com a marca, os links no meio (14 px, secundário, a tinta no hover), o seletor de tema e a pílula
  "Entrar"; abaixo de 1024 px, a folha do "Menu".
- **A marca:** o ladrilho com o triângulo vazado, na primária (o azul do logo no claro, o tom claro no escuro), desenhado pelo arquivo
  `public/marca.svg` como máscara; trocar o logo é trocar o arquivo (e o `app/icon.svg`).

### Data

- **Tabela** (`.tbl`, `.th`, `.td`, `.row`): a célula 13/400, o cabeçalho 11/500 no secundário, o fio entre as linhas, 8 px de cada lado. A
  que passa da coluna rola dentro da caixa dela, e a borda da direita esmaece enquanto há mais colunas (com o mouse, o "›" redondo da faixa
  também); o nome do competidor fica numa linha. As três tabelas do ranking têm as mesmas colunas.
- **Gráficos:** a família da beUI (linha, rosca, sparkline, o desenho das velas e o ranking no tempo), um estilo só em todas as telas, com a
  série de cada laboratório e o rótulo no fim da linha. A linha, a rosca e o ranking no tempo se leem pelo teclado; a sparkline e as velas são
  imagens com o resumo em texto (as velas não entregam a série, ADR 0033).
- **Contador:** o Animated counter da Arc, em pt-BR, que só gira quando o número muda.
- **Tooltip:** o da Arc, o balão na tinta com raio 8 e 13 px; no toque ele não abre, e o que ele diz é complemento.
- **Toast:** o Animated Toast Stack da beUI, com a região viva.

### Motion

Os tokens moram no `globals.css` e, para o Motion, em `apps/web/src/lib/motion.ts` (o `motion.spec.ts` prende os dois): 150 ms no que se
repete (o toque, o hover, a cor), 200 ms no que muda de lugar (a pílula), 250 ms no que muda a tela (a troca de tema); as curvas
`--ease-out-quart` (`cubic-bezier(0.25, 1, 0.5, 1)`), `--ease-out-quint` (`cubic-bezier(0.22, 1, 0.36, 1)`) e `--ease-out-expo`
(`cubic-bezier(0.16, 1, 0.3, 1)`); as molas do Motion sem quique (`bounce: 0`). Com `prefers-reduced-motion`, nada se desloca: a regra
global zera animação e transição, e cada peça tem o seu ramo. A série que a legenda mostra de novo se desenha da esquerda para a direita, num
recorte que cresce em 250 ms (`.linha-desenha`). O esmaecer da borda das tabelas que rolam é uma animação ligada à rolagem, e não ao tempo:
nada anda sozinho.

## 6. Do's and Don'ts

### Do:

- **Do** use a primária (`#14144c`, `#acb9fa` no escuro) só na ação principal, na escolha atual, no anel de foco e na marca.
- **Do** escreva toda cor por token (`bg-canvas`, `text-ink`, `var(--color-primary)`) e deixe as peças das bibliotecas lerem os nomes delas
  (`--background`, `--primary`, `--surface`, `--accent`), que apontam para os tokens.
- **Do** use a sans do sistema em tudo, com algarismos tabulares; a mono só no hash e no código (`.hash`).
- **Do** deixe a etiqueta "simulado" visível, discreta e uma vez por contexto (a honestidade é obrigatória; o peso, não).
- **Do** dê a todo controle a caixa de 44 px, o anel único no foco do teclado e os estados completos (repouso, hover, foco, ativo,
  desabilitado, carregando, erro).
- **Do** anime só o que explica uma mudança, entre 150 e 250 ms, com saída forte, e escreva o ramo de movimento reduzido.
- **Do** pegue a peça da tabela do ADR 0037 antes de escrever uma nova; peça nova entra no ADR.

### Don't:

- **Don't** pareça um **cassino de cripto**: neon, gradiente, contagem regressiva, cara de aposta.
- **Don't** pareça uma **corretora tradicional**: home broker carregado, cheio de caixas, menus e banners.
- **Don't** pareça um **painel SaaS genérico**: cards iguais com ícone, números gigantes soltos, gradiente roxo.
- **Don't** pareça um **terminal hacker**: tudo preto, fonte mono em tudo, verde de matriz.
- **Don't** pinte link, ticker ou nome de tabela na primária, nem use a mono nos tickers, nos títulos das colunas ou nos rótulos.
- **Don't** repita o `▲ ▼` em duas colunas da mesma linha, nem ponha o sufixo de versão ("(0902)") no nome em lugar apertado.
- **Don't** use `transition: all`, quique, mola que passa do ponto, ou animação na abertura da página.
- **Don't** escreva hexadecimal em atributo de SVG ou em `style`: não segue o tema.
- **Don't** use faixa lateral colorida, texto em gradiente, vidro decorativo, "número gigante com rótulo" nem rótulo em caixa alta acima de
  toda seção.
- **Don't** traga item Pro de nenhuma das três bibliotecas, nem o refaça a partir da prévia.
