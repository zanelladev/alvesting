# Relatório da T0 (a fundação do design premium)

Tarefa `task_07692c51a62e` (dispatch `ctx_06939a2e7584`), onda "design premium", 05/11/2026. Rodou em paralelo com a T0b (a infraestrutura
dos logos das ações). Nada foi commitado nem posto no índice: o trabalho está só no working tree (`git diff`). Nada no `apps/api`: o conserto do
`rxjs`, que o coordenador me passou, mexeu só no `pnpm-workspace.yaml` e no lockfile, na raiz. A demo (4300 e 4310) não foi subida nem
reiniciada por mim.

## Resumo

- **O vocabulário** (ADR 0037, `docs/adr/0037-bibliotecas-de-design.md`): uma peça por tipo, das três bibliotecas (só o grátis e MIT, nada
  Pro) ou nossa. Da Arc: o segmentado, o tooltip, o contador e o esqueleto (instalados). Da beUI: os seis gráficos (sparkline, linha, barra,
  rosca, velas e ranking no tempo), o toast e o seletor de tema (este adaptado e instalado). Da ReUI: o select nativo. Nossos: o botão, a
  tabela, o campo de dinheiro e as folhas e diálogos.
- **Os tokens**: cada cor com os dois temas no mesmo lugar (`light-dark()`), a primária `#14144C` numa escala OKLCH do 50 ao 950 (o 300
  `#acb9fa` no escuro), um fio de controle de 3:1, e os nomes do shadcn e da Arc apontando para os tokens. O contraste é conferido por teste.
- **O tema**: claro, escuro e sistema, guardado no navegador, aplicado por um script em linha no `<head>` antes da pintura; o seletor é HTML
  do servidor (radios), com a pílula que anda e a revelação da View Transition API adaptada da beUI, sem Motion. Ele fica no pé do trilho,
  na folha "Mais" e no cabeçalho do site.
- **A tipografia**: uma sans só, a do sistema, com algarismos tabulares em todo número; a Geist saiu (13,4 KB de alta prioridade a menos no
  caminho do LCP), e o `font-display` traz o 600 que ela dava aos títulos; a mono só para hash e código (`.hash`).
- **O movimento**: 150, 200 e 250 ms e as curvas quart, quint e expo, em CSS e em `lib/motion.ts` (molas sem quique), presos por teste; o
  botão a 0,96 no toque; o anel de foco único na primária.
- **A marca**: o triângulo recolorido para `#14144C`, desenhado pelo arquivo `public/marca.svg` como máscara (o tema pinta); trocar o logo é
  trocar esse arquivo e o `app/icon.svg`.
- **Um incidente no caminho**: o `pnpm add` do `motion` e do tooltip fez o pnpm içar o `rxjs@6.6.7` do `inquirer`, e o
  `@nestjs/platform-express`, que importa o `rxjs` sem declarar, derrubava toda api HTTP. Consertado com o `packageExtensions` no
  `pnpm-workspace.yaml` (seção 5).
- **A prova**: o `pnpm check` com exit 0 (o site com 48 arquivos e 855 testes, entre eles o de contraste); o `pnpm build` com exit 0; o
  `e2e/tema.spec.ts` verde nos seis projetos (11 testes no desktop, 10 e o de teclado pulado nos de toque); o e2e inteiro nos seis, um por
  vez e com 1 worker, **sem nenhuma falha**; o Lighthouse com LCP de 2.409 ms, CLS 0 e TBT de 15 ms (antes, 2.488 e 2.521 ms); o
  `docs:check` com 75 itens; o ensaio com o SHA-256 de sempre; o `az` falso sem chamada e a guarda de rede sem registro (seção 6).

## 1. O vocabulário

A tabela inteira, com o motivo de cada escolha e o que ficou de fora, está no ADR 0037 (seção 1). O resumo:

| Tipo | A peça | De onde | Instalada agora |
|---|---|---|---|
| Botão | `.btn` e `.btn-primary` | nossa (as três trazem o botão como componente de cliente; o nosso vive em tela de servidor, em `<a>` e em `<button>`) | já existia; refeita |
| Abas e controle segmentado | Segmented control (vista dentro da tela); os links `.abas` e `.segmentado` entre telas | Arc | sim |
| Tooltip | Tooltip (sobre o da Radix) | Arc | sim |
| Contador de número que rola | Animated counter | Arc | sim |
| Sparkline | Sparkline | beUI | não (a tarefa da tela) |
| Gráfico de linhas | Line Chart | beUI | não |
| Gráfico de barras | Bar Chart | beUI | não |
| Gráfico de rosca | Donut Chart | beUI | não |
| Velas | Candlestick Chart | beUI (a Arc não tem velas grátis; o market terminal é Pro) | não |
| Ranking no tempo | Bump Chart | beUI (o Race bar chart da Arc é Pro) | não |
| Tabela | `.tbl`, `.th`, `.td`, `.row` | nossa | já existia |
| Esqueleto de carregamento | Skeleton | Arc | sim |
| Toast | Animated Toast Stack | beUI | não |
| Seletor de tema | o seletor de três opções, adaptado do Theme Toggle | beUI | sim |
| Select | Native select | ReUI (o do shadcn) | não |
| Campo de dinheiro | `.field` com a regra `parseBrl` do contrato | nossa | já existia |
| Folha e diálogo | o `popover` do navegador e o `<dialog>` | nossa | já existia |

Lido antes de escolher: o `llms.txt` das três (a Arc com 240 componentes e 140 blocos, 121 e 22 grátis; a beUI; a ReUI com 1.264 exemplos
grátis e 678 blocos Pro); o código (o JSON do registro) do `arc-foundation`, do `arc-motion-tokens`, do `theme-switch`, do `button`, do
`segmented-control`, do `tooltip`, do `animated-counter` e do `skeleton` da Arc e do `theme-toggle` da beUI; e o markdown do `toast`, do
`select`, do `money-input`, do `dialog`, do `bottom-sheet`, do `sortable-data-table`, do `sparkline` e do `line-chart` da Arc, do `number`,
do `tooltip`, do `tabs`, do `button`, do `select`, do `drawer`, do `table`, do `animated-toast-stack` e dos seis gráficos da beUI, e do
`sonner`, do `native-select`, do `chart` e do `skeleton` da ReUI. Nenhum item Pro foi aberto.

**Como foi copiado**: do JSON do registro, à mão (o `tsconfig` do site não tem alias de import, o `@/` que o CLI do shadcn usa para escrever
os arquivos, e o `tsconfig` não é meu; por isso também não criei o `components.json` nem o `lib/utils.ts`: nenhuma peça instalada usa o `cn`,
e a primeira que usar o traz). Cada
arquivo tem a origem, a licença e o que mudou no topo, e a pasta tem o `LICENSE` (o da beUI conferido com `diff` contra o do repositório
dela). As adaptações, peça por peça, estão no `docs/DEPENDENCIAS.md` ("Componentes copiados de registros").

## 2. Os tokens e o contraste

Cada cor do `@theme` tem o par `light-dark(claro, escuro)`, e o `color-scheme` do `<html>` escolhe o lado. O Lightning CSS do build
transforma o `light-dark()` em duas variáveis por cor que o `color-scheme` liga (conferido no CSS final e numa transformação de teste com o
`lightningcss` 1.33: `:root[data-tema=escuro]{--lightningcss-light: ;--lightningcss-dark:initial;color-scheme:dark}`), e isso vale em todo
navegador do site. O bloco do escuro sobre o `prefers-color-scheme` saiu: uma lista só de cores.

**A primária e a escala** (a matiz 275,49 do `#14144C` em OKLCH; todas dentro do sRGB): 50 `#f2f5fe`, 100 `#e2e7fd`, 200 `#c9d2fb`, 300
`#acb9fa`, 400 `#8c9aef`, 500 `#6b78dc`, 600 `#4f58bf`, 700 `#3a3f9d`, 800 `#282b79`, 900 `#1c1d60`, 950 `#14144c`. No claro a primária é o
950; no escuro, o 300. O hover do botão é o 800 e o 200.

**Os nomes das bibliotecas** (o bloco `:root` da camada base e um `@theme inline` para os utilitários do shadcn): `--background`,
`--foreground`, `--card`, `--popover`, `--primary`, `--primary-foreground`, `--secondary`, `--muted`, `--muted-foreground`, `--destructive`,
`--border`, `--input`, `--ring` e `--chart-1` a `--chart-7` (o shadcn); `--surface`, `--surface-raised`, `--surface-muted`, `--text-secondary`,
`--text-muted`, `--border-subtle`, `--border-strong`, `--accent`, `--accent-strong`, `--accent-subtle`, `--accent-foreground`, `--success`,
`--warning`, `--danger`, `--info`, as sombras, o espaço, os raios, as alturas, as durações e as curvas que as peças copiadas leem (a Arc). O
`foundation.css` da Arc não entrou: ele seria um segundo tema.

**O contraste** (`apps/web/src/app/tokens.spec.ts`, 98 testes: os pares abaixo nos dois temas, a escala, os nomes das bibliotecas sem cor
crua e o peso do `font-display`; visto falhar antes dos tokens, 59 falhas):

| Par | Claro | Escuro | Mínimo |
|---|---|---|---|
| `ink` sobre `canvas` | #0a0a0a sobre #ffffff: **19,80:1** | #fafafa sobre #171717: **17,18:1** | 4,5:1 |
| `ink` sobre `surface-card` | #0a0a0a sobre #f5f5f5: **18,16:1** | #fafafa sobre #1f1f1f: **15,79:1** | 4,5:1 |
| `body` sobre `canvas` | #17171f sobre #ffffff: **17,82:1** | #f5f5f7 sobre #171717: **16,47:1** | 4,5:1 |
| `muted` sobre `canvas` | #6b6b72 sobre #ffffff: **5,29:1** | #a3a3a9 sobre #171717: **7,14:1** | 4,5:1 |
| `muted` sobre `surface-card` | #6b6b72 sobre #f5f5f5: **4,85:1** | #a3a3a9 sobre #1f1f1f: **6,57:1** | 4,5:1 |
| `muted` sobre `surface-strong` | #6b6b72 sobre #efefef: **4,60:1** | #a3a3a9 sobre #242424: **6,19:1** | 4,5:1 |
| `primary-foreground` sobre `primary` (o botão primário) | #ffffff sobre #14144c: **17,02:1** | #14144c sobre #acb9fa: **8,99:1** | 4,5:1 |
| `primary-foreground` sobre `primary-hover` | #ffffff sobre #282b79: **12,23:1** | #14144c sobre #c9d2fb: **11,41:1** | 4,5:1 |
| `link` sobre `canvas` | #0a0a0a sobre #ffffff: **19,80:1** | #fafafa sobre #171717: **17,18:1** | 4,5:1 |
| `data-up` sobre `canvas` | #007a32 sobre #ffffff: **5,48:1** | #9ae600 sobre #171717: **11,69:1** | 4,5:1 |
| `data-down` sobre `canvas` | #d6003a sobre #ffffff: **5,36:1** | #ff637e sobre #171717: **6,26:1** | 4,5:1 |
| `ring` (o anel de foco) sobre `canvas` | #14144c sobre #ffffff: **17,02:1** | #acb9fa sobre #171717: **9,48:1** | 3:1 |
| `ring` sobre `surface-card` | #14144c sobre #f5f5f5: **15,61:1** | #acb9fa sobre #1f1f1f: **8,71:1** | 3:1 |
| `ring` sobre `surface-strong` | #14144c sobre #efefef: **14,80:1** | #acb9fa sobre #242424: **8,21:1** | 3:1 |
| `control` (o fio do campo) sobre `canvas` | #8a8a90 sobre #ffffff: **3,43:1** | #707077 sobre #171717: **3,65:1** | 3:1 |
| `control` sobre `surface-card` | #8a8a90 sobre #f5f5f5: **3,15:1** | #707077 sobre #1f1f1f: **3,35:1** | 3:1 |
| `primary` (a pílula do seletor) sobre `surface-strong` | #14144c sobre #efefef: **14,80:1** | #acb9fa sobre #242424: **8,21:1** | 3:1 |

O teste também cobre as sete séries dos laboratórios sobre o canvas (3:1, a linha) e o dado sobre o cinza do painel.

## 3. Cada item da tarefa, com a evidência

1. **O vocabulário** (seção 1): o ADR 0037, com a tabela, o motivo, a licença e o que ficou de fora.
2. **As peças base instaladas**: `apps/web/src/components/arc/` (o segmentado, o tooltip, o contador, o esqueleto e os tokens de movimento
   da Arc) e `apps/web/src/components/beui/theme-selector.tsx`; as dependências `motion` 14.9.1 e `@radix-ui/react-tooltip` 1.4.1, pelo pnpm,
   com a versão exata (`-E`). **Evidência**: o `arc.spec.tsx` (as quatro peças no HTML do servidor: o segmentado com o grupo, o
   `aria-pressed` e uma parada de Tab; o contador em pt-BR, `R$ 1.234,50`; o esqueleto como `status` "Carregando"; o tooltip sem mexer no
   gatilho), o `tsc` e o lint verdes. O botão é o nosso (a classe), refeito.
3. **Os tokens** (seção 2). **Evidência**: o `tokens.spec.ts`.
4. **O tema**. O `<html>` leva `data-tema` (a escolha), `data-theme` (o da Arc) e a classe `dark` (o `@custom-variant dark` do Tailwind 4); o
   script do `<head>` (`themeScript`) aplica a escolha guardada antes da pintura, segue o sistema e a outra aba, troca o `theme-color`, e põe a
   revelação da View Transition API no toque (o círculo que cresce do controle, 250 ms), com a troca na hora pelo teclado, com movimento
   reduzido e sem a API, e nenhuma transição durante a troca. **Evidência**: o `theme-selector.spec.tsx` (o script num DOM de mentira: a
   escolha sobre o sistema, o valor estranho e o `localStorage` bloqueado, a sincronia dos seletores, a revelação só no toque, o sistema que
   muda; visto falhar antes do código) e o `e2e/tema.spec.ts` (seção 4).
5. **A tipografia**: a sans do sistema em tudo, o `tabular-nums` no `body`, o `font-display` apontando para a mesma sans e trazendo o 600
   (a camada base), o `.hash` para a mono; a Geist saiu do `layout.tsx` (nenhuma fonte baixada no build). **Evidência**: o teste "a
   tipografia" do `tokens.spec.ts` (visto falhar antes da regra) e as capturas.
6. **O movimento**: `--duration-fast/base/slow` (150, 200 e 250 ms) e `--ease-out-quart/quint/expo` no CSS, o `MOTION` em `lib/motion.ts`
   (as molas com `bounce: 0`), o `.btn` com `active:scale-96` e a transição nomeada, o anel de foco único na primária. **Evidência**: o
   `motion.spec.ts` (visto falhar antes do código).
7. **A marca**: `public/marca.svg` (o ladrilho com o triângulo vazado, a máscara da `.marca`) e o `app/icon.svg` (o ladrilho `#14144c` com o
   triângulo branco). **Evidência**: as capturas (a marca no cabeçalho do site, no trilho e na barra do app no celular, nos dois temas); a
   tela dividida e o rodapé usam a mesma `Marca`.
8. **Os docs**: `docs/DESIGN.md` (o formato do comando `document` da `impeccable`: o cabeçalho YAML com os tokens e as seis seções, com a
   estrela-guia "O Placar Calmo"), o ADR 0037, o `docs/DEPENDENCIAS.md` (os dois pacotes, a seção dos componentes copiados, a extensão do
   pnpm e a saída da Geist), o `docs/TELAS.md` (seção 10: a cor, o tema, a tipografia, o movimento e as peças) e a frase do CLAUDE.md (seção
   Telas).

## 4. Os testes novos

| O teste | O que prova |
|---|---|
| `apps/web/src/app/tokens.spec.ts` | o contraste dos pares da seção 2 nos dois temas; a primária é o `#14144c` e a escala tem um tom só, do claro ao escuro; no escuro ela é um tom claro da escala; todo nome do shadcn e da Arc lê um token, sem cor crua; o `font-display` leva o 600 na camada base |
| `apps/web/src/lib/motion.spec.ts` | as durações e as curvas do CSS e do Motion são as mesmas; as molas não quicam |
| `apps/web/src/components/beui/theme-selector.spec.tsx` | o script do tema (seis casos) e a marcação do seletor (o grupo "Tema", os três radios sem nenhum marcado no HTML, o em pé e o com rótulo) |
| `apps/web/src/components/arc/arc.spec.tsx` | as quatro peças da Arc no HTML do servidor |
| `apps/web/src/components/site-chrome.spec.tsx` (dois testes a mais) | o seletor antes de "Entrar" no menu do site; no trilho entre o "Buscar" e a "Conta", e na folha "Mais" |
| `apps/web/e2e/tema.spec.ts` (`@tema`, nos seis projetos) | na landing e no ranking: a troca e o recarregar (claro, escuro e de volta ao sistema, que apaga a escolha); o "sistema" segue o `prefers-color-scheme` emulado e muda junto, e a escolha guardada não; o `<html>` já vem no tema guardado antes da hidratação (o JavaScript do Next bloqueado, e o atributo lido no momento em que o `<body>` aparece); sem JavaScript o tema segue o sistema e o seletor some; o axe sem violação nos dois temas escolhidos; e, só no desktop, o teclado (o Tab chega ao radio escolhido, as setas trocam o tema, o anel aparece) |

Nenhum teste existente mudou de expectativa: o "o tema é o do sistema" do `layout.spec.ts` continua valendo (no "sistema" o `color-scheme`
calculado continua `light dark`, e as metas de cor são as de antes), as cores que o e2e confere (o canvas, a moldura, a tinta da caixa de
marcar) são as mesmas, e os testes de ordem do Tab contam no mínimo (o grupo do tema é uma parada a mais dentro da folha). O teste novo do
teclado é pulado nos projetos de toque, como os outros de teclado da suíte: são 4 pulados a mais (o `pixel-7`, o `iphone-15`, o
`pixel-7-escuro` e o `iphone-15-escuro`).

## 5. O `rxjs` içado (o incidente)

O `pnpm add` das 12:02 refez o que o pnpm iça em `node_modules/.pnpm/node_modules`: o `rxjs` passou de 7.8.2 para o 6.6.7 do
`inquirer@6.5.2`. O `@nestjs/platform-express` importa o `rxjs` (`multer/multer/multer.utils.js`) sem declarar (os pares dele são só o
`@nestjs/common` e o `@nestjs/core`), achava essa cópia, e nenhuma api HTTP subia ("The requested module 'rxjs' does not provide an export
named 'catchError'", depois "No driver (HTTP) has been selected"): caíram a api do e2e e os testes HTTP, e a demo da 4310 ficou fora (a T0b
relatou ao coordenador; às 13:20 ela respondia 200 no `/api/v1/health`). Numa instalação limpa, numa
pasta à parte e sem rede, os dois locks (o de antes e o meu) içam o 7.8.2: o estado ruim era do `node_modules` incremental. Primeiro reparei
o link e a entrada do `node_modules/.modules.yaml` (cópia no scratchpad) para seguir; depois, pelo pedido do coordenador, o conserto
durável: o `packageExtensions` no `pnpm-workspace.yaml` dá ao `@nestjs/platform-express` o par `rxjs ^7.1.0` (o intervalo do
`@nestjs/common`), com o comentário `ponytail:`, e o `pnpm install` (12:26, com a trava) pôs o link na pasta dele. **Provas**: o import
dinâmico do `@nestjs/platform-express` de `apps/api` com o Node 26.13 carrega; a pasta dele no `.pnpm` tem o `node_modules/rxjs ->
../../rxjs@7.8.2`; o `quotes.integration.spec.ts` e o `cycles.controller.integration.spec.ts` passaram (66 testes, banco
`alvesting_t0fundacao_test`); a linha no `docs/DEPENDENCIAS.md` ("Extensões de pacote do pnpm").

## 6. Os comandos e os resultados

Toda execução pesada rodou com a trava (`.data/trava-pesada`, dono `t0-fundacao`, das 12:18 às 13:19, solta no fim; o disco nunca ficou abaixo
de 9 GB livres), com o `az` falso no `PATH` e a guarda de rede
(`NODE_OPTIONS=--import .data/guardas/net-guard.mjs`, `NET_GUARD_LOG=.data/guardas/t0-fundacao-rede.log`), inclusive o build (sem a Geist ele
não fala mais com o Google).

A rodada final (12:55 a 13:19), sobre o build final, numa sequência só (`build`, capturas, os seis projetos, Lighthouse, `check` e ensaio):

| O quê | Comando | Resultado |
|---|---|---|
| Build | `pnpm build` (12:55) | **exit 0**, os 4 pacotes. Os 6 avisos de CSS são os do `::scroll-button()` da faixa (da onda anterior: o Lightning CSS não conhece o pseudo-elemento), os mesmos dos builds de antes |
| Capturas | o spec temporário, `playwright test --workers=1 --project=desktop zz-capturas-t0` (12:55) | 6 passaram (24,6 s): as 17 PNG da seção 8 |
| O e2e inteiro, os seis projetos, um por vez, com 1 worker | `pnpm exec playwright test --workers=1 --project=<projeto>` em `apps/web` (12:55 a 13:15) | **desktop: 476 passaram, 1 pulado** (5,8 min); **pixel-7: 470, 7 pulados** (4,7 min); **iphone-15: 470, 7 pulados** (4,7 min); **desktop-escuro: 155** (1,5 min); **pixel-7-escuro: 154, 1 pulado** (1,5 min); **iphone-15-escuro: 154, 1 pulado** (1,9 min). **Nenhuma falha.** Os pulados são os 13 de antes (os 11 de sempre: o login do smoke nos três claros e, nos dois de toque, o "só com o teclado" da carteira e os três das folhas do `layout.spec.ts`; mais os 2 da rolagem da faixa, da onda anterior) e os 4 do teclado do tema |
| `e2e/tema.spec.ts` | dentro do e2e acima | **desktop e desktop-escuro: 11 passaram**; **pixel-7, iphone-15, pixel-7-escuro e iphone-15-escuro: 10 passaram, 1 pulado** (o de teclado) |
| O `logos.spec.ts` da T0b nos escuros | dentro do e2e acima | verde: a correção da T0b (o `rgb` dentro do `light-dark`, 12:48) entrou neste build |
| Lighthouse | `pnpm lighthouse` (13:16 a 13:17) | **exit 0**: LCP 2.409 ms, CLS 0, TBT 15 ms (seção 7) |
| `pnpm check` | `TEST_DATABASE_URL=…/alvesting_t0fundacao_test`, o Azurite do compose, `pnpm check` (13:17 a 13:19) | **exit 0**: o lint e o `prettier --check .` ("All matched files use Prettier code style!"); os tipos; os testes (o `test` de cada pacote com `cache bypass`, rodado de verdade): o site **48 arquivos e 855 testes**, os contratos **13 e 501**, a api **154 arquivos e 2 pulados, 3.153 testes e 9 pulados**, os `scripts/*.test.mjs` **113, 0 falha**; o `docs:check` com "75 itens documentados" |
| Ensaio | `ENSAIO_DATABASE_URL=…/alvesting_t0fundacao_ensaio pnpm --filter @alvesting/api arena:ensaio` (13:19) | **exit 0**; o `.data/ensaio/relatorio-s1-p5.txt` (escrito às 13:19:50) com o SHA-256 `081d860b31b6c69997424d92beacc190eefed498835b61e2ebe9b442d8891f12`, o de sempre |
| O `az` falso | `wc -l .data/guardas/az-stub/calls.log` | **0 linha**: nenhuma chamada |
| A guarda de rede | `.data/guardas/t0-fundacao-rede.log` | **não existe**: nenhuma conexão para fora foi tentada (a guarda só escreve o arquivo quando bloqueia) |
| Os bancos | `DROP DATABASE` do `alvesting_t0fundacao_test` e do `alvesting_t0fundacao_ensaio` no `alvesting-postgres-1` | apagados; nenhum `alvesting_verify_*` sobrou; os outros bancos não são meus e ficaram |

As rodadas de antes, para o registro:

| Rodada | Resultado |
|---|---|
| A primeira (12:28 a 12:45, o build das 12:25) | os três claros verdes (desktop 476, pixel-7 e iphone-15 470); nos escuros, o "sem JavaScript" do `tema.spec.ts` reprovou porque o spec e o CSS mudaram às 12:39, depois do build (o build final o aprovou), e os dois do `logos.spec.ts` reprovaram no Chromium pelo contorno da T0b, que ela corrigiu |
| A final interrompida (12:48 a 12:54) | parada por mim no meio do pixel-7, para corrigir o peso dos títulos (seção 9, item 6); o desktop tinha passado (476, 1 pulado) |

## 7. O Lighthouse e o JavaScript e o CSS da landing

`pnpm lighthouse` (5 coletas, mediana; o Lighthouse 12.6.1 no celular simulado: tela pequena, CPU 4x mais lenta e 4G lenta), no build final
(12:55), das 13:16 às 13:17. **Passou**: o `lhci` saiu com 0. O "antes" é a medida final da onda anterior, no mesmo Mac e com o mesmo
Lighthouse (05/11, 10:46 e 10:48, `docs/redesign-rallies/relatorios/linhas-barras.md`, seção 6; os relatórios ficaram em
`apps/web/.lighthouseci`):

| | Antes (a onda anterior) | Depois (a fundação) |
|---|---|---|
| LCP, mediana (faixa) | 2.488 ms (2.310 a 2.497) e 2.521 ms (2.329 a 2.524) | **2.409 ms** (2.404 a 2.421) |
| CLS | 0 e 0 | **0** |
| TBT, mediana | 17 e 32 ms | **15 ms** (12 a 19) |
| FCP, mediana | 909 e 911 ms | 905 ms |
| exit do `lhci` | 0 e 1 (a 2ª reprovou o LCP por 21 ms) | **0** |

- **O elemento do LCP** é o mesmo nas 5 coletas e no antes: o parágrafo do hero (`main.mx-auto > section.grid > div.grid > p.text-15`).
  **As fases**: o TTFB é o de sempre (452 a 454 ms; antes, 453), e o atraso de renderização caiu de 2.036 e 2.067 ms para 1.952 a 1.966 ms:
  saiu o pedido da fonte, de alta prioridade, que ficava no caminho crítico.
- **Sem A/B**: a meta passou com 91 ms de folga, e o A/B das regras comuns é só para a reprovação por menos de 50 ms.

O que a landing baixa (a coleta mediana, o fio e o tamanho cru; 22 pedidos nos dois lados):

| Recurso | Antes | Depois | No fio |
|---|---|---|---|
| Documento (o HTML e o payload do React) | 34.861 B / 155.851 B | 38.651 B / 167.529 B | +3.790 B |
| CSS (um arquivo) | 12.788 B / 62.280 B | 13.921 B / 71.356 B | +1.133 B |
| JavaScript (10 arquivos) | 151.528 B / 478.435 B | 151.525 B / 478.363 B | −3 B |
| Fonte | 1, a Geist 600: 13.989 B / 13.456 B | nenhuma | −13.989 B |
| Imagens | 8: 13.842 B | 9: 14.575 B (mais a máscara `marca.svg`) | +733 B |
| **Total** | 227.745 B | **219.409 B** | **−8.336 B** |

- **O JavaScript** não mudou: o seletor é HTML com o script em linha do `<head>`, e o Motion e o tooltip da Radix só vão para a tela que usar
  uma peça da Arc (nenhuma da landing).
- **O CSS** cresceu 1,1 KB no fio: o `light-dark()` vira duas variáveis por cor no build, os nomes das bibliotecas (o `:root` do shadcn e o da
  Arc), o seletor e a revelação, o movimento e o anel de foco. **O documento** cresceu 3,8 KB no fio: o seletor no cabeçalho (os três radios
  com os ícones, no HTML e de novo no payload do React) e o script do tema.

## 8. As capturas

**17 PNG** em `docs/redesign-premium/fundacao/`, tiradas do build final (12:55) por um spec temporário (copiado para `apps/web/e2e/` só
durante a execução e apagado logo depois; o dado é o sintético do e2e, e a conta da carteira é `@example.test`), com o tema escolhido pelo
seletor (o `localStorage`), as fontes carregadas e nenhuma transição em curso:

| Tela | 1440 × 900 | 390 × 844 | A folha (390) |
|---|---|---|---|
| Landing (`/`) | `landing-1440-claro.png`, `landing-1440-escuro.png` | `landing-390-claro.png`, `landing-390-escuro.png` | o "Menu" com a linha "Tema": `landing-390-claro-folha.png`, `landing-390-escuro-folha.png` |
| Arena (`/arena`) | `arena-1440-claro.png`, `arena-1440-escuro.png` | `arena-390-claro.png`, `arena-390-escuro.png` | o "Mais" com a linha "Tema": `arena-390-claro-folha.png`, `arena-390-escuro-folha.png` |
| Carteira (`/carteira`, quatro lançamentos) | `carteira-1440-claro.png`, `carteira-1440-escuro.png` | `carteira-390-claro.png`, `carteira-390-escuro.png` | — |

E `revelacao-1440-meio.png`: a troca do claro para o escuro na Arena, a meio caminho (a animação a 5% da velocidade pelo CDP): o círculo do
tema novo cresce a partir do seletor, no pé do trilho, por cima do tema antigo.

O que se vê: o botão primário e a pílula do seletor no `#14144C` no claro e no 300 da escala (`#acb9fa`, com o texto `#14144C`) no escuro; o
seletor no cabeçalho do site antes de "Entrar", no pé do trilho entre "Buscar" e "Conta" (em pé, com o rótulo "Tema") e na linha "Tema" das
folhas; a marca recolorida no cabeçalho do site, no trilho e na barra do app no celular (a tela dividida das telas da conta usa a mesma
`Marca`, sem captura aqui). A escadaria do hero continua âmbar (refazê-la no azul é de outra tarefa)
e a mono continua nos tickers e nos rótulos (tirá-la é das tarefas de tela; a fundação deixou a classe e o token).

## 9. Desvios e o que fica

**Desvios do pedido** (cada um com o motivo):

1. **Sem o CLI do shadcn, o `components.json` e o `lib/utils.ts`.** O `tsconfig` do site não tem alias de import (os imports são relativos), e
   o CLI precisa do `@/` para escrever os arquivos; o `tsconfig` não é meu. As peças foram copiadas do JSON do registro, à mão (o ADR 0037
   diz como), e nenhuma das instaladas usa o `cn`: o `clsx` e o `tailwind-merge` entram com a primeira peça que os pedir.
2. **O seletor de tema não é um componente de cliente.** É HTML do servidor (três radios num `fieldset`) com o script em linha do `<head>`:
   as cascas são de servidor, sem `motion` (CLAUDE.md), e a landing não pode carregar Motion acima da dobra. Da beUI vieram a revelação pela
   View Transition API (o círculo que cresce do controle) e a troca sem o borrão; o Motion do Theme Toggle dela ficou de fora.
3. **O botão é o nosso** (a classe `.btn`, refeita), não o de uma biblioteca: os das três são componentes de cliente, e o nosso vive em tela
   de servidor, em `<a>` e em `<button>` (o ADR 0037, a linha do botão).
4. **O `pnpm-workspace.yaml`** não estava na minha lista: o `packageExtensions` do `rxjs` (seção 5) entrou pelo pedido do coordenador.
5. **Quatro testes pulados a mais**: o "o seletor funciona pelo teclado" do `tema.spec.ts` roda só no `desktop` e no `desktop-escuro` e é
   pulado nos quatro projetos de toque, como os outros testes de teclado da suíte (o `carteira.spec.ts` "só com o teclado" e os quatro de
   teclado do `layout.spec.ts`). Os pulados de antes continuam os mesmos.
6. **Uma regressão minha, achada e corrigida antes do fim**: na conferência das capturas da rodada final, o título do hero estava no 400.
   A Geist só tinha a face 600, e o navegador a usava em qualquer peso pedido; com a fonte do sistema, os 20 usos do `font-display` sem
   peso declarado (os títulos de página, de seção e de cartão e os números grandes) caíram para o 400, contra o que o `DESIGN.md` e o
   `TELAS.md` dizem. A correção é uma regra na camada base, `.font-display { font-weight: 600 }`, com um teste no `tokens.spec.ts` (visto
   falhar antes). O resultado é o peso de antes em todo título; só o `h4` do painel do admin, que pede `font-medium`, passa a sair no 500
   que ele pede (com a Geist ele saía no 600). A rodada final foi parada no meio (a das 12:48) e refeita do zero com a correção.
7. **A falha da T0b no e2e escuro** (seção 6): os dois testes do `logos.spec.ts` que conferem o contorno do logo reprovam no Chromium escuro,
   por causa do `oklch(1 0 0 / 0.1)` do `logo-do-papel.tsx`; os dois arquivos são da T0b, e a falha foi mandada ao coordenador
   (`msg_d2054fd5f884`, com a causa e a troca sugerida).

**O que fica para depois**:

- **As telas**: tirar a mono dos tickers, dos títulos das colunas e dos rótulos (a sans com `tabular-nums` já é a do `body`; a mono fica na
  classe `.hash`); trocar o que ainda é âmbar ou cinza por peça da tabela; instalar os gráficos, o toast e o select quando usarem, pela tabela
  do ADR 0037.
- **O hero**: a escadaria ASCII no azul da marca (outra tarefa da onda).
- **O logo do Artur**: trocar o `apps/web/public/marca.svg` (a máscara do cabeçalho, do trilho e da tela dividida) e o `apps/web/src/app/icon.svg`
  (o ícone do navegador), e mais nada.
- **O `packageExtensions`**: sai quando o `@nestjs/platform-express` declarar o `rxjs` (o comentário `ponytail:` no arquivo).

## 10. Os arquivos tocados

Novos:

- `apps/web/src/components/arc/`: `LICENSE`, `lib/motion-tokens.ts`, `segmented-control/segmented-control.tsx` e `.module.css`,
  `tooltip/tooltip.tsx` e `.module.css`, `animated-counter/animated-counter.tsx` e `.module.css`, `skeleton/skeleton.tsx` e `.module.css`,
  `arc.spec.tsx`
- `apps/web/src/components/beui/`: `LICENSE`, `theme-selector.tsx`, `theme-selector.spec.tsx`
- `apps/web/src/lib/motion.ts`, `apps/web/src/lib/motion.spec.ts`, `apps/web/src/app/tokens.spec.ts`
- `apps/web/public/marca.svg`
- `apps/web/e2e/tema.spec.ts`
- `docs/DESIGN.md`, `docs/adr/0037-bibliotecas-de-design.md`
- `docs/redesign-premium/fundacao/` (as 17 capturas), `docs/redesign-premium/relatorios/fundacao.md`

Alterados:

- `apps/web/src/app/globals.css` (os tokens, os nomes das bibliotecas, o tema, o movimento, a base, o botão, o anel de foco, o seletor e a marca)
- `apps/web/src/app/layout.tsx` (o script do tema no `<head>`; a Geist saiu)
- `apps/web/src/app/icon.svg` (o ladrilho `#14144c`)
- `apps/web/src/components/icones.tsx` (a `Marca`, agora a máscara do `public/marca.svg`)
- `apps/web/src/components/app-shell.tsx` (só o seletor: no pé do trilho e na folha "Mais")
- `apps/web/src/components/site-chrome.tsx` (só o seletor, antes de "Entrar"), `apps/web/src/components/site-chrome.spec.tsx` (dois testes)
- `apps/web/package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`
- `docs/DEPENDENCIAS.md`, `docs/TELAS.md` (seção 10), `CLAUDE.md` (seção Telas)

Nenhum arquivo da T0b, das telas nem do `apps/api` foi editado.
