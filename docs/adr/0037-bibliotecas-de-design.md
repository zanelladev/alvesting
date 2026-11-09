# ADR 0037: As bibliotecas de design (Arc, beUI e ReUI), a primária do logo e o seletor de tema

- **Status:** aceita
- **Data:** 05/11/2026
- **Origem:** o pedido do Artur de 05/11/2026 ("Quero que use libs para design: https://uiarc.dev/components/blocks/market-terminal
  https://beui.dev/charts https://reui.io/components/chart pode misturar libs as vezes, eu quero tudo animado com cara de premium [...] O
  Rallies parece muito mais clean, quero switch de temas também. A cor da aplicação, primária será em vez de amarelo #14144C (esse tom de
  azul é o da logo)") e as decisões dele na mesma conversa: só o que é gratuito e MIT das três; nada Pro (o market terminal da Arc é Pro, e o
  terminal será montado com peças grátis); a primária #14144C com uma variante clara no escuro; o seletor claro, escuro e sistema (o padrão
  continua o sistema), animado e guardado no navegador. A tarefa T0 da onda "design premium" (a fundação), relatório em
  `docs/redesign-premium/relatorios/fundacao.md`.
- **Completa:** o ADR 0035 (o design do Rallies AI nos dois temas). Ficam dele a linguagem visual, as cascas, os nomes dos tokens, a moldura
  e a arte. **Muda:** o "sem botão de tema" (agora há o seletor), a Geist 600 dos títulos (saiu: uma sans só, a do sistema), o âmbar da marca
  (agora a primária do logo), o anel de foco na tinta (agora na primária), a regra "nenhuma dependência npm nova" das telas (as peças das
  bibliotecas trazem o `motion` e o tooltip da Radix, só onde são usadas) e a etiqueta "simulado" ao lado de todo nome (a decisão 5 do 0035:
  agora ela é visível, discreta e **uma vez por contexto**, a nota no cabeçalho da faixa, da tabela e da barra das carteiras, a etiqueta junto
  do título na página do modelo, o aviso de página na arena e no ciclo; o fechamento da onda).

## Contexto

Misturar três bibliotecas tem um risco: três botões, três tooltips e três estilos de gráfico, cada um com a sua cor. A unidade vem de duas
regras: **uma peça por tipo** em todo o app (a tabela abaixo; uma tela só traz peça nova quando a tabela não tem uma para o caso, e
registra aqui), e **uma fonte de verdade das cores e das medidas** (os tokens do `apps/web/src/app/globals.css`), lida por cada biblioteca
pelo nome que ela espera.

As três são diferentes por dentro. A Arc (uiarc.dev, MIT, Copyright (c) 2026 Elia Kuratli) tem 121 componentes grátis em CSS Modules com o
Motion e um tema próprio (`foundation.css`, `data-theme="dark"`). A beUI (beui.dev, MIT, Copyright (c) 2026 Saurabh Chauhan) usa Tailwind
com os nomes do shadcn e o Motion, e tem a família de gráficos que cobre o produto inteiro (linha, barra, rosca, sparkline, velas e ranking no
tempo). A ReUI (reui.io, MIT, Copyright (c) 2025 Keenthemes Inc) é o shadcn com exemplos; os blocos de gráfico dela são Pro, e os
componentes grátis são os do shadcn sobre o Recharts 3. Quase tudo é componente de cliente com o Motion; o site é de servidor (as cascas e a
landing não têm JavaScript de cliente acima da dobra, e o LCP mobile da landing ficou em 2.488 e 2.521 ms na última medida, contra o teto de 2,5 s).

Critério de cada escolha: **cabe no visual do Rallies, tem o ramo de movimento reduzido, funciona pelo teclado e pesa pouco** (o que a peça
traz para a página que a usa). Foram lidos o `llms.txt` das três e o markdown (ou o código, no registro) de cada candidata.

## Decisão

### 1. O vocabulário: uma peça por tipo

| Tipo | A peça | De onde | Por quê | Instalada agora | Ficou de fora |
|---|---|---|---|---|---|
| Botão | as classes `.btn` (a pílula cinza) e `.btn-primary` (a primária, uma por superfície) | nossa | O botão vive em tela de servidor, em `<a>`, em `<button>` e no envio dos formulários: a classe é o mesmo botão em toda parte, sem JavaScript. 44 px, `scale(0.96)` no toque em 150 ms, transição só do que muda, o anel único | já existia; refeita nos tokens | o Button da Arc (cliente, com Motion e a largura que segue o rótulo), o da beUI (Motion), o do shadcn na ReUI (cva e tailwind-merge) |
| Abas e controle segmentado | os links `.abas` e `.segmentado`, do servidor: as telas de uma área, o filtro do feed e as vistas da arena no celular (`?vista=decisoes\|carteiras`, com o `aria-current` na escolhida); e, desde 06/11/2026, o modo de preço do lançamento da carteira (o `RadioField` do `form-kit.tsx`: os radios nativos no desenho do segmentado, com a pílula que desliza até a escolhida em 250 ms, só CSS, num módulo) | nossa; o Segmented control da Arc (`segmented-control`) foi o escolhido para a vista dentro de uma tela | O desenho do segmentado do Rallies (o trilho cinza e a pílula do canvas). Nenhuma tela ganhou uma escolha de vista de cliente (o período de um gráfico): a das vistas da arena é do servidor, sem JavaScript | o da Arc: copiada e retirada em 05/11/2026 por falta de uso; volta do registro quando uma tela pedir | as Tabs da Arc e da beUI (o painel junto, que as telas não pedem), as da ReUI (sem a pílula que anda) |
| Tooltip | Tooltip, sobre o da Radix | Arc, `tooltip` | O Esc fecha, ele abre no foco do teclado e no hover, e o ponteiro passa para o balão (WCAG 1.4.13); 250 ms no primeiro e nenhum nos seguintes; transições interrompíveis (`@starting-style`); movimento reduzido sem deslocamento. No toque ele não abre: o que ele diz é complemento, e o que o toque precisa fica em texto na tela | sim (`components/arc/tooltip`, com `@radix-ui/react-tooltip` 1.4.1): a faixa e as carteiras da arena, os cartões do Explorar, os termos da carteira | o da beUI (floating-ui e Motion), o do shadcn na ReUI (sem a espera compartilhada) |
| Termo com explicação | o botão `Termo` (`components/wallet-charts.tsx`: a caixa de 44 px, o tooltip da Arc) e o sublinhado pontilhado no fio de controle (`.termo`) | nossa | Um desenho só para o "há mais a ler aqui" (o fechamento da onda juntou os três que havia: o `.dica`, o `.termo` e o rótulo do radio); a explicação também fica em texto na tela, para o toque. O radio "Valor total pago" do lançamento saiu do tooltip em 06/11/2026: o balão numa metade do segmentado não abre no toque, e a explicação é a dica à vista do campo de valor no modo total (e a descrição do radio para o leitor de tela) | sim (a carteira) | o termo de `tabIndex` sem papel nem caixa de 44 px (saiu do Explorar e do terminal, que agora mostram a explicação em texto) |
| Contador de número que rola | Animated counter (uma roda por algarismo, no sentido em que o número andou) | Arc, `animated-counter` | Gira só quando o número muda (nada na abertura da página), o leitor de tela lê o número inteiro uma vez, o idioma é fixo (pt-BR: o servidor e o navegador escrevem os mesmos algarismos), e com movimento reduzido troca na hora | sim (`components/arc/animated-counter`): o painel do gráfico do patrimônio, o resumo e a rosca da carteira | o Number Ticker da beUI (entra rolando na abertura) e o Animated Number (conta do zero ao aparecer) |
| Sparkline | Sparkline | beUI | A mesma família dos outros gráficos; uma imagem com o resumo no nome (nenhuma parada de Tab dentro de uma tabela), de servidor | sim (`components/beui/sparkline.tsx`): a tendência do ranking | a da Arc, a do shadcn |
| Gráfico de linhas | Line Chart | beUI | A linha que se desenha (o movimento que o produto permite: "a linha que se desenha", quando a legenda mostra a série de novo), o cursor que gruda nos pontos, um controle deslizante nativo pelo teclado com o valor de cada série, uma tabela escondida com todos os valores, e a linha que quebra no dado que falta | sim (`components/beui/line-chart.tsx`): o patrimônio da arena e do modelo | o Line chart da Arc; o chart do shadcn na ReUI (o Recharts 3 pesa várias vezes mais) |
| Gráfico de barras | Bar Chart | beUI | A mesma família, com a mesma leitura pelo teclado | não (nenhuma tela pediu barras) | as barras da Arc e do shadcn |
| Gráfico de rosca | Donut Chart | beUI | A mesma família; a fatia com o valor no centro e a legenda ligada, pelo teclado | sim (`components/beui/donut-chart.tsx`): a alocação da carteira | o Donut da Arc, o pie do shadcn |
| Velas | só o visual do Candlestick Chart (o pavio, o corpo, a grade, os preços à direita e a linha do último preço), refeito num componente de servidor, sem o código da peça | beUI (o desenho) | A série de preços não pode ir ao navegador como dado (ADR 0033): o desenho sai do servidor, com o resumo em texto, e o realce de um pregão é CSS e mostra só a data. A leitura das quatro cotações pelo cursor e pelas setas, que a peça tem, ficou de fora (a decisão sobre o ADR 0033 é do Artur e do orientador). A Arc não tem velas grátis (o market terminal é Pro) | só o visual (`components/velas.tsx`) | o Candlestick da beUI como componente de cliente; o market terminal da Arc (Pro: não foi lido nem refeito) |
| Ranking no tempo | Bump Chart (a posição de cada modelo por pregão) | beUI | As curvas entre as posições, a série que se fixa pela legenda, a tabela escondida com a posição de cada um em cada pregão; a caixa abre nos pregões mais novos | sim (`components/beui/bump-chart.tsx`): o ranking | o Race bar chart da Arc (Pro), o Slope chart da Arc (só dois tempos) |
| Tabela | as classes `.tbl`, `.th`, `.td` e `.row`, na caixa que rola (`TableScroll`, `ui.tsx`) com a pista de que há mais colunas (a borda que esmaece e, com o mouse, o "›" da faixa, só CSS) | nossa | As tabelas da arena e da carteira são curtas, de servidor, densas, e o e2e lê o DOM delas; nenhuma ordenação é pedida. As três do ranking têm as mesmas colunas (`table-layout: fixed`) | já existia | o Table da beUI (virtualizado, TanStack), o Sortable data table da Arc (Motion), o Data Grid da ReUI (TanStack Table) |
| Esqueleto de carregamento | Skeleton (`role="status"` com nome, a pulsação calma que para em uns 20 s, a troca suave para o conteúdo) | Arc, `skeleton` | O lugar reservado sem pulsar para sempre; com movimento reduzido não pulsa. Nenhuma tela tem estado de carregamento no cliente (as telas saem prontas do servidor, e nenhum grupo tem `loading.tsx`) | copiada e retirada em 05/11/2026 por falta de uso; volta do registro quando uma tela pedir | o Skeleton do shadcn na ReUI (pulsa sem fim) |
| Toast | Animated Toast Stack | beUI | Uma lista com `aria-live="polite"`, o fechar é um botão com nome, o Esc fecha, o prazo para com o ponteiro ou o foco (WCAG 2.2.1); com movimento reduzido troca na hora e o arrastar para fechar sai | sim (`components/beui/animated-toast-stack.tsx`): a carteira, a conta e o painel | o Toast da Arc (sem fila), o Sonner do shadcn na ReUI (um pacote a mais) |
| Seletor de tema | o seletor de três opções (claro, escuro e sistema), adaptado do Theme Toggle | beUI, `theme-toggle` (adaptado) | A revelação pela View Transition API (o tema novo num círculo que cresce do controle tocado), sem Motion: a landing não pode carregar biblioteca acima da dobra. Detalhes na seção 3 | sim (`components/beui/theme-selector.tsx`) | o Theme switch da Arc (dois estados, com Motion e lucide-react), o da beUI como está (dois estados, next-themes, Motion e lucide-react) |
| Select | Native select (o `<select>` do navegador com o desenho do campo) | ReUI (o do shadcn) | O seletor do sistema no celular (a roda do iOS, a lista do Android), nenhum JavaScript, e o teclado do navegador | sim (`components/reui/native-select.tsx`): o painel | o Select da Arc e o da beUI (lista própria em cliente, pior no celular) |
| Campo de dinheiro | o `MoneyField` (`components/wallet-lots.tsx`), o `.field` no padrão dos bancos brasileiros: o "R$" dentro do campo, à esquerda, e os centavos entrando pela direita (só algarismos; o Backspace tira o último; o milhar enquanto digita; colar passa pelo `parseBrl`), com a regra do dinheiro digitado (`parseBrl`, `lotCostCents`, `@alvesting/contracts/portfolio-rules`) | nossa | A regra da carteira é a do contrato (o "1.234" ambíguo é recusado; os tetos de `PORTFOLIO_LIMITS`), e o navegador não leva o zod (CLAUDE.md). Os centavos pela direita só precisam de algarismos: o teclado de números de qualquer celular serve, e o texto que o campo mostra é o que o `parseBrl` do envio lê | já existia (os centavos pela direita desde 06/11/2026) | o Money input da Arc: em `pt-BR` ele descarta o ponto (o `sanitize` do registro de 06/11/2026), e há teclado de Android com só o ponto de decimal: "35.50" viraria R$ 3.550 |
| Campo de número | Number field (os algarismos que rolam no − e no +, segurar repete e acelera, o número que faz força no limite) | Arc, `number-field` | Só inteiros pelo passo (a vírgula não entra), o teclado de números, o `spinbutton` com o valor lido inteiro, as setas, o PageUp e o PageDown, o Home e o End, e o ramo de movimento reduzido; o − e o + com 44 px | sim (`components/arc/number-field`, 06/11/2026): a quantidade do lançamento da carteira | o Adaptive Stepper da beUI (o `clsx`, o `tailwind-merge` e o `lucide-react` que ele pede), o `input type="number"` do navegador (o "e" do expoente, o ponto e a vírgula, a roda do mouse) |
| Data | Date picker e Calendar (o gatilho no desenho do campo, o calendário que abre embaixo dele, o disco do dia escolhido que desliza, os meses que deslizam) | Arc, `date-picker` e `calendar` (com o `use-today` do calendário) | Em português, com o **mês e o ano rápidos** (dois `<select>` nativos no título: uma compra de 2019 em três toques), os limites (nada depois de hoje em Brasília), o "Hoje" e o "Limpar", o teclado de uma grade e os 44 px de cada dia (sem o vão entre eles abaixo de 332 px) | sim (`components/arc/date-picker`, `calendar` e `lib/use-today.ts`, 06/11/2026): a data da compra do lançamento | o `input type="date"` do navegador (cada um desenha o seu, sem o tema, e no Chromium de mesa a data parcial chegava vazia), o Date Range Picker da beUI (um intervalo, e não um dia), o Calendar da ReUI (o do shadcn, sobre o `react-day-picker`, um pacote a mais) |
| Folha e diálogo | o `popover` do navegador (as folhas "Menu" e "Mais", sem JavaScript) e o `<dialog>` com `showModal()` quando precisar | nossa | A camada de cima do navegador já dá o Esc, o foco e o fundo; as folhas das cascas são de servidor. O primeiro `<dialog>` é o do lançamento da carteira (06/11/2026): centrado no desktop, a folha de baixo no celular, o véu com o desfoque leve, a entrada e a saída só em CSS (`@starting-style`, o `display` e o `overlay` discretos), sem fechar no clique fora (é um formulário) | já existia; o `<dialog>` em uso desde 06/11/2026 (`components/wallet-lots.tsx`, `wallet-lots.module.css`) | o Dialog, o Drawer e o Bottom sheet da Arc (Radix e Motion), o Drawer e o Bottom sheet da beUI (Motion) |

A fundação instalou quatro peças da Arc (o segmentado, o tooltip, o contador e o esqueleto) e o seletor de tema; as telas trouxeram os
gráficos, o toast e o select, pela tabela. No fechamento da onda (05/11/2026) o segmentado e o esqueleto saíram, por falta de uso (nenhuma tela
os importava: a pasta "para depois" que o CLAUDE.md proíbe), com o CSS e os testes que só eles tinham; voltam do registro quando uma tela pedir.
O `pnpm docs:check` confere que todo arquivo de `components/arc`, `beui` e `reui` tem a sua linha no `docs/DEPENDENCIAS.md` e que cada pasta
tem o `LICENSE`.

**Como se copia uma peça.** Do JSON do item no registro (a Arc em `https://uiarc.dev/r/{nome}.json`, a beUI em `https://beui.dev/r/{nome}`,
a ReUI pelo nome `@reui/{nome}` do registro dela, `https://reui.io/docs/registry`), à mão: o repositório usa imports relativos e o `tsconfig`
não tem alias de import (o `@/` que o CLI do shadcn usa para escrever os arquivos), então o CLI não foi usado. O arquivo vai para a pasta da biblioteca (`apps/web/src/components/arc`, `.../beui`, `.../reui`), com a origem, a
licença e o que mudou no topo, e o texto da MIT no `LICENSE` da pasta; a linha entra no `docs/DEPENDENCIAS.md` ("Componentes copiados de
registros"). Na adaptação, a peça perde toda cor crua e lê os tokens; a do shadcn que pinta `bg-muted` ou `bg-accent` troca para
`bg-surface-card` e `bg-surface-strong` (o `text-muted` nosso é a cor do texto secundário, e o `--accent` é o da Arc); o texto padrão vai
para o português. **Nada Pro**: nenhum item Pro foi lido, baixado nem refeito a partir da prévia, de nenhuma das três.

### 2. Os tokens: uma fonte de verdade, nos nomes de cada biblioteca

- **Cada cor tem os dois temas no mesmo lugar**, `--color-canvas: light-dark(#ffffff, #171717)`, no `@theme` do `globals.css`. O navegador
  escolhe o lado pelo `color-scheme` do `<html>`: `light dark` segue o sistema; a escolha guardada o fixa (seção 3). O build (o Lightning
  CSS do Turbopack) transforma o `light-dark()` em duas variáveis que o `color-scheme` liga, e o resultado vale em todo navegador do site. O
  bloco do escuro sobre o `prefers-color-scheme` saiu: não há mais duas listas de cores.
- **A primária é o azul do logo, `#14144C`**, o 950 de uma escala do mesmo tom em OKLCH (a matiz 275,49, do 50 ao 950: `#f2f5fe`, `#e2e7fd`,
  `#c9d2fb`, `#acb9fa`, `#8c9aef`, `#6b78dc`, `#4f58bf`, `#3a3f9d`, `#282b79`, `#1c1d60` e `#14144c`). No escuro ela é o 300 (`#acb9fa`), porque o
  azul quase preto some no fundo escuro. Ela pinta a ação principal (o botão primário), a escolha atual (o chip escolhido, o filtro do feed,
  o seletor de tema), o anel de foco e a marca; nunca enfeite. O link fica na tinta, como no Rallies (na primária, todo ticker e nome das
  tabelas viraria azul no escuro). O resto da paleta é a de antes: os neutros, o verde e o vermelho do dado e as cores dos laboratórios.
- **Um fio de controle**, `control` (`#8a8a90` e `#707077`), com 3:1 sobre o canvas e sobre o cinza do painel: o campo passa a ter o fio que o
  identifica (WCAG 1.4.11); o `hairline` continua o fio que separa.
- **Os nomes das bibliotecas** apontam para os tokens, nos dois temas, e só entra o nome que alguém lê (o `:root` vai inteiro no CSS único,
  que a landing baixa): o `--background` e o `--foreground` (o balão do tooltip da Arc), os `--chart-1` a `--chart-7` do shadcn (a cor de cada
  laboratório nas séries dos gráficos, `lib/chart.ts`), a sombra `--shadow-raised` e o espaço, o raio, a entrelinha e o movimento que o
  tooltip e o contador da Arc leem. A fundação tinha posto a lista inteira de cada biblioteca (o `--card`, o `--popover`, o `--accent`, o
  `--surface`, um `@theme inline` com os utilitários do shadcn e a variante `dark:`); o fechamento da onda tirou o que nenhum arquivo lia. A
  peça nova que pedir outro nome o acrescenta, e o `tokens.spec.ts` reprova o nome sem leitor.
- **O contraste é conferido por teste** (`apps/web/src/app/tokens.spec.ts`): ele lê o `globals.css`, resolve os dois lados de cada
  `light-dark()` e calcula a razão da WCAG para o texto e o texto secundário sobre o fundo e os cartões, o texto do botão primário sobre a
  primária (em repouso e no hover), o link, o dado, as séries, e com 3:1 o anel de foco, o fio dos controles e a pílula do seletor; confere
  que todo nome das bibliotecas lê um token, sem cor crua, e tem leitor; que nenhuma peça pinta cor crua (o círculo do logo das ações tem os
  tokens `logo-fundo` e `logo-contorno`); e que a cor da barra do navegador (o `theme-color`, que a meta não lê do CSS) é o canvas dos dois
  temas. A tabela das razões está no `docs/DESIGN.md`.

### 3. O tema: claro, escuro e sistema

- **O `<html>`** leva `data-tema` (a escolha: `claro`, `escuro` ou `sistema`), que fixa o `color-scheme` (o `sistema` deixa `light dark`), e
  o tema em uso na classe `dark`, que a sombra do escuro lê. O `data-theme` da Arc e a variante `dark:` do Tailwind, que a fundação punha, saíram
  no fechamento da onda: nenhuma peça os lia (as da Arc leem os nossos tokens).
- **Um script curto em linha no `<head>`** (`themeScript`, em `components/beui/theme-selector.tsx`, posto pelo layout raiz) lê a escolha do
  `localStorage` (`tema`; sem a chave, o `sistema`) e escreve os atributos antes da primeira pintura: a página nasce no tema certo, sem
  piscar e sem esperar a hidratação (o `<html>` leva `suppressHydrationWarning`). Ele também segue a troca do sistema quando a escolha é o
  `sistema`, a troca feita em outra aba, e põe a cor da barra do navegador (`theme-color`) na escolha. **Sem JavaScript** nada disso roda: o
  tema segue o sistema pela media query, e o seletor, que não faria nada, não aparece.
- **O seletor** é um grupo de radios do servidor (a legenda "Tema"; as opções Claro, Escuro e Sistema, com o ícone à vista e o nome em
  texto; o leitor de tela diz "Tema, grupo" e "Escuro, botão de opção, 2 de 3"; as setas trocam a escolha). A pílula da escolha, um círculo
  na primária, anda 44 px por opção em 200 ms. Ao tocar numa opção que muda a cor em uso, a página nova aparece num círculo que cresce do
  controle (a View Transition API, 250 ms, a saída quart): é a peça da beUI. O teclado troca na hora (animação em interação de teclado
  cansa), e o movimento reduzido e o navegador sem a API também. **Nenhuma transição roda durante a troca** (uma folha de estilo com
  `transition: none` entra, as cores mudam, e ela sai dois quadros depois): sem ela, todo elemento com transição de cor andaria junto, o
  "borrão" da troca de tema.
- **Onde ele fica:** no pé do trilho do app, em pé, entre o "Buscar" e a "Conta", com o rótulo "Tema" embaixo; no celular, na folha "Mais",
  como a linha "Tema"; e no cabeçalho do site, antes de "Entrar" (no celular, na folha do "Menu"). A landing não carrega nada por ele: é
  HTML, CSS e o script do `<head>`.

### 4. A tipografia: uma sans só

A do sistema (`ui-sans-serif, system-ui`: a SF no Apple, a Roboto no Android, a Segoe no Windows), com os pesos de verdade dela (400, 500 e
600) e **algarismos tabulares em todo número** (no `body`). A Geist 600 dos títulos saiu: era um pedido de 13,4 KB de alta prioridade no
caminho crítico da landing, e o Rallies usa uma sans só. O `font-display` continua como nome (os títulos que o usam não mudam), e aponta para
a mesma sans. **A mono é só para hash e código** (a classe `.hash`: a mono que quebra em qualquer ponto); tirar a mono dos tickers, dos
títulos das colunas e dos rótulos de cada tela é das tarefas de tela. O espaçamento dos títulos grandes para em -0,04 em.

### 5. O movimento

- **Tokens**, os mesmos em CSS e no Motion (`apps/web/src/lib/motion.ts`; o `motion.spec.ts` prende os dois): as durações de 150 ms (o que se
  repete: o toque, o hover), 200 ms (o que muda de lugar: a pílula) e 250 ms (o que muda a tela inteira: a troca de tema); as curvas de saída
  forte `--ease-out-quart`, `--ease-out-quint` e `--ease-out-expo`; e no Motion as molas de 0,15, 0,2 e 0,25 s, sem quique. Os nomes da Arc
  (`motionTokens`, `--duration-*`, `--ease-*`) apontam para os nossos.
- **O botão** encolhe a 0,96 no toque, em 150 ms, e a transição nomeia o que muda (nunca `all`). **O anel de foco é um só**: o contorno de
  2 px na primária, com 2 px de recuo, só no foco do teclado.
- **Nada anima na abertura da página.** Movimento reduzido: a regra global zera animação e transição, o botão não encolhe, e cada peça das
  bibliotecas tem o seu ramo (a pílula e a roda param, o esqueleto não pulsa, o tooltip só esmaece).

### 6. A marca

O triângulo de sempre, recolorido para `#14144C`. O desenho é um arquivo, `apps/web/public/marca.svg` (o ladrilho com o triângulo vazado), que
o CSS usa como máscara (`.marca`): o tema pinta, o azul do logo no claro e o tom claro dele no escuro, legível nos dois. O ícone do navegador
é o `apps/web/src/app/icon.svg` (o ladrilho no azul do logo com o triângulo branco). **Trocar pelo logo do Artur é trocar esses dois
arquivos**, sem mexer em código.

## Consequências

- **Dependências novas:** o `motion` 14.9.1 e o `@radix-ui/react-tooltip` 1.4.1, só no site e só na página que usar uma peça deles (a casca
  e a landing não usam). A Arc e a ReUI foram escritas sobre o Motion 12; a API da 14 é a mesma (`motion/react`), conferida pelo `tsc` e pelos
  testes. O `pnpm add` deles reorganizou o que o pnpm iça em `node_modules/.pnpm/node_modules`, e o `@nestjs/platform-express`, que importa o
  `rxjs` sem declarar, passou a achar o 6.6.7 do `inquirer`: a api não subia. O `pnpm-workspace.yaml` ganhou o `packageExtensions` que
  declara o `rxjs` como par dele (`docs/DEPENDENCIAS.md`, "Extensões de pacote do pnpm").
- **Regras novas no CLAUDE.md (seção Telas):** a peça de cada tipo é a da tabela acima, e peça nova entra aqui antes; as cascas continuam de
  servidor, e o seletor de tema é HTML com o script do `<head>`, sem componente de cliente.
- **O LCP da landing:** saiu a fonte (13,4 KB de alta prioridade); o CSS cresceu (o `light-dark()` vira duas variáveis por cor no build, os
  nomes das bibliotecas, o seletor); nenhum JavaScript de cliente entrou. A medida está no relatório da fundação.
- **Testes:** o `tokens.spec.ts` (o contraste e os nomes), o `motion.spec.ts` (os tokens de movimento), o `theme-selector.spec.tsx` (o
  script do tema num DOM de mentira e a marcação do seletor), o `arc.spec.tsx` (as peças da Arc em uso no HTML do servidor), o
  `site-chrome.spec.tsx` (onde o seletor entra) e o e2e `tema.spec.ts`, nos seis projetos (a troca, o recarregar, o sistema, o atributo antes
  da hidratação, sem JavaScript, o teclado e o axe nos dois temas escolhidos).
- **Ficam de fora:** todo item Pro das três (o market terminal da Arc, os blocos de gráfico da ReUI, o Race bar chart da Arc); o
  `foundation.css` da Arc (os nomes dela apontam para os nossos tokens, em vez de um segundo tema); o CLI do shadcn e o `components.json`
  (sem o alias `@/`, que o `tsconfig` não tem); o `cn` (`clsx` com `tailwind-merge`), que entra com a primeira peça que o usar; e a cor de
  aviso.

## Nota de 05/11/2026 (o fechamento da onda)

O que o fechamento decidiu (a revisão de código e o QA ao vivo da onda; o relatório em `docs/redesign-premium/relatorios/fechamento.md`):

- **Saíram por falta de uso** o segmentado e o esqueleto da Arc (com o CSS e os testes que só eles tinham), as chaves dos tokens de movimento
  da Arc que nada lia, o rótulo e o `animateOnView` do contador, as curvas `linear` e `step` do `xy-path` da beUI, os nomes das bibliotecas sem
  leitor no `:root`, o `@theme inline` do shadcn, a variante `dark:` e o `data-theme`.
- **O radio de lançar** é o desenho do radio nativo, de 20 px, dentro do alvo de 44 px do rótulo da opção: o estado é a espessura da borda (2 px
  no fio de controle desmarcado, 6 px na tinta marcado), sem `::before` nem fundo, o que sobrevive às cores forçadas em todo navegador.
- **As tabelas que rolam** dão a pista de que há mais colunas, só CSS (a borda que esmaece, por uma animação ligada à rolagem; com o mouse, o
  "›" redondo da faixa), e as três do ranking têm as mesmas colunas (`table-layout: fixed` e um `<colgroup>`).
- **As vistas da arena no celular** ("Decisões | Carteiras") são links do servidor (`?vista=`), no desenho do segmentado, sem a peça da Arc.
- **O termo com explicação** é um desenho só (a linha "Termo com explicação" da tabela), e o que o tooltip diz no Explorar e no terminal ficou
  em texto na tela.
- **O `pnpm docs:check`** confere o código copiado de registro: todo arquivo das três pastas tem a sua linha no `docs/DEPENDENCIAS.md`, e cada
  pasta tem o `LICENSE`.

**Nota de 06/11/2026.** A marca ganhou o desenho do Artur: o touro (o `Group.svg`, sem mudança, no `public/marca.svg` que a máscara `.marca`
pinta; no ícone do navegador, branco no ladrilho azul) e a Exo 2 600 no nome "Alvesting" (`font-marca`), a única fonte de fora do site:
só as nove letras do nome, 1,7 KB em linha no CSS (`docs/DEPENDENCIAS.md`, "Fontes tipográficas"; o arquivo inteiro do latim, mesmo sem
preload, subiu o LCP da landing para 2,55 s). A faixa do Monte Carlo do gráfico ganhou um "i" que a explica: o popover nativo, e não o
tooltip da Arc, porque o da Arc não abre no toque (`docs/DESIGN.md`, o termo com explicação). E o Sorteio e as referências trocaram a
inicial por ícones nossos (o dado, o "%" do CDI, o gráfico do BOVA11 e a balança do igual-peso), no círculo branco dos laboratórios.

**Nota de 06/11/2026 (o lançamento da carteira num modal).** O pedido do Artur sobre o formulário "Lançar uma compra" ("Os imput nao tem
formatação, nao da pra comprar meia ação, precisa ser um counter, com - e + tambem, o field de data ta nativo nao usa libs de ui, o imput de
reais tambem nao ta formato e falta o simbolo R$, quero esse lançamento em um modal"; relatório em
`docs/redesign-premium/relatorios/t1-lancamento.md`). Entraram duas linhas na tabela, o **campo de número** (o Number field da Arc) e a
**data** (o Date picker e o Calendar da Arc, com o mês e o ano rápidos), copiadas do registro em 06/11/2026 sem dependência npm nova (o
`lucide-react` que elas pedem virou os ícones nossos). Mudaram três: o **campo de dinheiro** (nosso, com os centavos pela direita; o Money
input da Arc fica de fora pelo ponto que ele descarta em `pt-BR`), a **folha e diálogo** (o `<dialog>` em uso, no lançamento e na edição) e o
**termo com explicação** (o radio do modo saiu do tooltip, que não abre no toque numa metade de segmentado). O CSS novo (o modal, o
segmentado, o campo de dinheiro e as três peças) mora em módulos dos componentes, e nada entrou no `:root` nem no `globals.css`: o CSS que a
landing baixa ficou igual (menos o `.w-fit` do radio antigo, que saiu). O Next junta os módulos pequenos num arquivo só (o `cssChunking`
padrão), que as telas do app que usam alguma peça da Arc ou o `form-kit` também baixam (20,9 KB, 4,2 KB comprimidos).
