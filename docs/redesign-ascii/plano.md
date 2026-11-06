# Porte do design ascii-ui da v1 para a v2: o plano

Tarefa T0 (estudo, só leitura), 04/11/2026. O pedido do Artur: "Eu quero o design ASCII antigo, a landing antiga tava muito
bonita, principalmente Hero". Este plano diz o que volta, como volta sem quebrar as regras da v2 (LCP da home, mobile, alvo de
44 px, axe, API sem cotação bruta, prompt oculto) e quem faz o quê. Nada aqui foi implementado.

**De onde veio.** A v1 é o worktree `feat-redesign` da v1 (branch `zanelladev/feat-redesign`), commit `cddd320` ("Redesign
ascii-ui: as 14 telas no tema novo"). Todo arquivo da v1 foi lido do commit (`git show HEAD:<arquivo>`): o trabalho sem commit do
worktree (mudanças locais nas skills `ascii-ui` e `halftone`, no `package.json`, os laboratórios `/lab/*`) ficou de fora. Os pesos
foram medidos nos arquivos; as capturas da v1 são as de `docs/redesign-2026-10/qa/` e `depois/`. A v2 foi lida em 04/11/2026, com a
T1 (o elenco simulado) em andamento: os pontos que ela mexe (a etiqueta "simulado" e o aviso da home) estão na seção 4.5.

**As capturas do antes** estão em `docs/redesign-ascii/antes/`: home, ranking, modelo (`/modelos/fake-hold`), ciclo
(`/ciclos/2026-12-01`), notícias, entrar e carteira (com a conta da demo), em 390 × 844 e 1440 × 900, o quadro
(`<tela>-<largura>.png`) e a página inteira (`<tela>-<largura>-inteira.png`), no mesmo padrão de nomes da v1. Tiradas da demo
(http://127.0.0.1:4300) antes de a T1 mudar a home, pelo script `.data/orquestracao/estudo/capturar.mjs` (fora do git), com o
`@playwright/test` de `apps/web`.

## Resumo: o que o plano decide

1. **Volta o visual inteiro da v1**: canvas preto, cápsula de navegação centrada, pílula branca, moldura de linhas laterais, arte
   ASCII com brasa no hero e na 404, dado em caractere (a fita, o gráfico em blocos). **Fica o código da v2**: Server Components,
   nenhum JavaScript novo no celular e o mesmo contrato de DOM que os testes usam (regiões com nome, `dt` e `dd`, os `data-*`, e as
   classes `link`, `btn`, `field`, `check`, `radio`, `tbl`, `th`, `td`, `row` e `muted`, que mudam de cara e não de nome).
2. **Nenhuma dependência npm nova.** O Arc é MIT nos itens gratuitos, mas todo componente dele importa `motion` e roda no cliente, e
   o hero do Arc nasce com o título invisível até hidratar. As poucas peças que a v2 usa são refeitas em CSS com as medidas do Arc
   (seção 1.3). `ascii.rest`, `motion`, `lucide-react`, `@radix-ui/*`, `clsx`, `tailwind-merge`, `d3-*` e o dither-kit não entram.
3. **Fontes**: Geist só no peso 500 e Inter só no 400, estáticas, com preload (uns 38 KB, o peso de hoje); a mono é a do sistema e
   a JetBrains Mono fica fora (seção 1.2).
4. **O hero da v1 com o texto da v2** (seção 4). A escadaria sai no HTML: o quadro 0, com a brasa de um PNG pequeno em `preload`,
   pinta junto com o texto, sem JavaScript no celular; o laço só toca a partir de 1024 px, sem `prefers-reduced-motion` e sem
   Save-Data. Sem canvas e sem shader: a arte é arquivo e o código só troca o quadro.
5. **Menu**: a cápsula a partir de 1024 px; abaixo disso, um botão "Menu" com `popover` nativo, sem JavaScript. Muda testes de seis
   specs (seção 5).
6. **A fita** lê o universo da semana por uma rota interna nova da api (a `a0`, seção 4.4), com o mesmo segredo da rota das barras.
   Sem ela, a fita mostra o BOVA11 e o macro, com outra legenda.
7. **Artes**: a escadaria (hero) e o urso (404) vêm da v1, com a procedência registrada (imagem e vídeo gerados no Higgsfield, arte
   pelo gerador do Artur). **Pendência do Artur antes do merge**: conferir a versão vigente dos termos da API do Higgsfield, como a
   própria v1 deixou escrito. Nada do laboratório entra (seção 2).
8. **Ordem**: a T1 termina; (a) faz a fundação e a home (a `a0` pode ir para outro worker, em paralelo, porque não toca nos arquivos
   de (a)); depois (b) arena e (c) conta em paralelo; no fim, (a) fecha (seção 6).

## 1. Peças do sistema

### 1.1 Tokens

Na v1 os tokens moravam em `packages/config/tokens.css` (`@theme static`), conferidos contra o frontmatter do `DESIGN.md` por
`check-tokens.mjs`. Na v2 eles vão para o `@theme` de `apps/web/src/app/globals.css`, que vira a fonte única: o site é o único que
os usa e, sem o `DESIGN.md` como segunda cópia (seção 7), não há deriva para conferir. O `check-tokens.mjs` não vem.

| Grupo | Tokens (o nome vira utilitário do Tailwind) | Valores (os da v1) | Na v2 |
|---|---|---|---|
| Superfícies | `canvas`, `surface-card`, `surface-card-elevated`, `surface-strong` | `#000000`, `#0a0a0a`, `#141414`, `#1c1c1c` | `canvas` é o fundo de tudo: `body`, `themeColor` do `viewport` (hoje `#f2efe6`) e `color-scheme: dark` |
| Linhas | `hairline-soft`, `hairline`, `hairline-strong` | `#141414`, `#1f1f1f`, `#2e2e2e` | toda borda tem 1 px; as de 2 px da estética crua saem |
| Tinta | `ink`, `body`, `muted`, `muted-soft` | `#f5f5f5`, `#a3a3a3`, `#8a8a8a`, `#5c5c5c` | `muted-soft` (3,1:1) nunca em texto (seção 5.3) |
| Âmbar | `primary`, `primary-active`, `primary-glow`, `on-primary` | `#ffb000`, `#cc8c00`, `#ffc84d`, `#000000` | acento: item ativo, filtro escolhido, foco do teclado, a marca e a brasa. Nunca CTA nem dado |
| Dado | `data-up`, `data-down`, `data-flat`, `data-benchmark` | `#33d17a`, `#ff4d4d`, `#8a8a8a`, `#666666` | sempre com glifo `▲ ▼ ■` e sinal; `data-benchmark` só em linha de gráfico (3,7:1) |
| Séries | `series-1` a `series-5` | `#199e70`, `#3987e5`, `#d55181`, `#9085e9`, `#2494ad` | cinco tons em ordem fixa. A v2 tem seis modelos, o Sorteio e três referências: o gráfico continua distinguindo as linhas por tracejado e espessura (TELAS §3), agora em `ink` e `body`; a cor de série só entra onde houver até quatro linhas no mesmo plano |
| Sistema | `semantic-success`, `semantic-error` | `#33d17a`, `#ff4d4d` | erro de formulário e de operação. Não há cor de aviso: aviso é `[!]` em cinza |
| Pontos | `dot-on`, `dot-off`, `dot-off-card` | `#f5f5f5`, `#404040`, `#2a2a2a` | só a matriz do `DotSpinner`, decorativa |
| Arte | `cinza-0..3`, `brasa-0..5` | `#262626` a `#ffe6a6` | assadas no sprite; o CSS só usaria `cinza-1` (`#5c5c5c`), se o celular ficar sem a brasa (seção 4.6, saída 3) |
| Tipo | `text-hero` (52, linha 1,04, −0,035em), `display-lg` 36, `display-md` 28, `display-sm` 22, `lead` 18, `title` 16, `label` 12, `data-lg` 36, `data-md` 14, `data-sm` 12, `prose-md` 16, `prose-sm` 14, `ascii` 12 (linha 1) | os do `tokens.css` | pesos 400 e 500; número sempre `tabular-nums`; o que é 500 usa a Geist (seção 1.2) |
| Raios | `xs` 6, `control` 18, `panel` 26, `surface` 34, `pill` 9999 | px | concêntricos: o de dentro é o de fora menos o padding |
| Espaço | `xxs` 4, `xs` 8, `sm` 12, `base` 16, `md` 20, `lg` 24, `xl` 32, `xxl` 48, `band` 72, `section` 96 | px | o ritmo da moldura: 48 px, a linha, 48 px |
| Movimento | 120, 160, 240 e 480 ms; `ease-brand` `cubic-bezier(.22,1,.36,1)`; `steps(1, end)` | | e a regra global de `prefers-reduced-motion` do `tokens.css` (animação e transição a 0,001 ms, uma volta) |

Vêm junto do `tokens.css`: a classe `.ascii-block` (a mono do sistema, `line-height: 1`, sem ligadura, `white-space: pre`), a
`.tabular` e o bloco `@media (prefers-reduced-motion: reduce)`. O foco do teclado segue um contorno sólido de 2 px (hoje preto,
passa a âmbar), que é o que o `carteira.spec.ts` confere (`outline-style: solid` e `outline-width: 2px`).

**`@theme` ou `@theme static`.** O Tailwind 4 só emite a variável que aparece escrita no código; a v1 precisou do `static` porque
montava `var(--color-series-${n})` em texto. A v2 só usa o `static` se os gráficos SVG lerem cor por um `var()` montado. O resto fica
no `@theme` comum: por causa do `inlineCss`, o CSS vai três vezes no documento da home, e cada variável sem uso pesa três vezes.

**Migração sem tela quebrada no meio do caminho.** Hoje o código usa `paper`, `ink` (preto), `muted` (`#4a4a4a`) e `band` em
dezenas de arquivos das três donas. Na fase 1, (a) define os tokens novos, deixa `paper` e `band` como apelidos (`paper` =
`canvas`, `band` = `surface-strong`) e já põe `ink` e `muted` nos valores novos; (b) e (c) trocam os nomes nos arquivos delas; no
fechamento, (a) apaga os apelidos, com `git grep -n -E "(bg|text|border|fill|stroke)-(paper|band)\b" apps/web/src` vazio. Um
comentário `ponytail:` no `globals.css` marca os apelidos como provisórios.

**As classes que ficam com o mesmo nome** (e mudam de cara), porque os testes e o tamanho do documento dependem delas
(`globals.css`, `@layer components`, TELAS §5):

| Classe | Hoje | Na v2 ascii-ui |
|---|---|---|
| `link` | sublinhado, 44 × 44, inverte no hover | caixa de 44 × 44, texto `ink`; sublinhado quando está dentro de texto (regra `link-in-text-block` do axe); no hover, o sublinhado em `primary-glow` |
| `btn` | borda preta de 2 px, mono, caixa-alta | o `secondary` do Arc: altura 44, raio `control` (18), `padding: 0 20px`, 14 px, Geist 500, fundo `surface-card`, borda `hairline`, sem caixa-alta |
| `btn-primary` (nova) | | a pílula branca: fundo `ink`, texto `canvas`, seta de 16 px em SVG; uma por superfície |
| `btn-ghost` (nova) | | sem borda nem fundo; no hover, `surface-strong` |
| `field` | borda preta de 2 px, mono | altura 44, raio 12, fundo `surface-card`, borda `hairline-strong`, texto de 16 px (o Safari dá zoom abaixo disso; `carteira-layout.spec.ts` confere) |
| `check`, `radio` | 44 × 44, preto com `✕` e `●` | 44 × 44; marcado: fundo `ink` com o glifo em `canvas`; vazio: fundo `canvas` e borda `hairline-strong`. O glifo segue sendo texto: não depende da cor |
| `tbl`, `th`, `td`, `row` | mono, títulos em caixa-alta | a tabela do Arc: `th` de 12 px em `muted`, sem caixa-alta; `td` de 14 px tabular; linha `hairline-soft`; ticker na mono do sistema |
| `muted` | 14 px, `#4a4a4a` | 14 px, `muted` |

Classes novas, todas no `globals.css`: `pill` (a pílula do anúncio), `capsule` e `capsule-item` (a navegação), `badge` (e os tons),
`card` (a superfície de borda), `chip` (filtro em link), `tape` (a fita) e `rule` (a linha da moldura, se não virar componente).

### 1.2 Fontes

Hoje a v2 manda três arquivos com preload: Plex Sans 400 (17.604 B), Plex Mono 400 (10.052 B) e Plex Mono 600 (10.120 B), **37.776
B** (os `.woff2` com `.p.` em `apps/web/.next/static/media`, build de 04/11/2026). A v1 mandava a Geist, a Inter e a JetBrains Mono
variáveis, com todos os pesos: **118.200 B** (Geist 29.288, Inter 48.432 e JetBrains Mono 40.480, os `.p.` de
`apps/web/.next/static/media` da v1). O TELAS.md (§5) mediu que a margem do LCP da home é de uns 160 ms e "é de bytes": no Lantern (1,6
Mbps simulados), 160 ms são uns 32 KB. As três fontes como estavam na v1 somariam ~80 KB ao caminho crítico e reprovariam o
Lighthouse.

| Família | `next/font/google` | Uso | Preload | Peso esperado (a medir) |
|---|---|---|---|---|
| Geist | `weight: ['500']`, `subsets: ['latin']`, `display: 'swap'`, `variable: '--font-geist'` | h1 a h3, número grande, itens da cápsula, botões, nome do modelo: tudo que a v1 punha em peso 500 | sim | ~15 KB (estática; a variável tem 29 KB) |
| Inter | `weight: ['400']`, `subsets: ['latin']`, `display: 'swap'`, `variable: '--font-inter'` | texto, células e rótulos | sim | ~23 KB (estática; com dois pesos o Google serve a variável, com os eixos `opsz` e `wght`: 48 KB) |
| JetBrains Mono | não entra | | | |

**Um peso por família** foi o que tirou a home do valor ruim do LCP na etapa 9 (TELAS §5): com dois pesos o Google serve a fonte
variável, com o dobro do tamanho. A hierarquia da v1 já é 400 e 500; o 500 de interface (o `title` de 16 px, o `data-md` de 14 px,
os itens da cápsula) passa da Inter 500 para a Geist 500, do mesmo desenho neo-grotesco. `font-synthesis-weight: none` fica:
nenhum negrito falso.

**Por que sem JetBrains Mono.** A v1 a usava em hash, código, log, ticker e na arte. Na home da v2 há ticker no feed de decisões e a
arte no hero: um texto qualquer da página em JetBrains faz o navegador pedir a fonte no primeiro layout, e ela entra na conta do LCP
com ou sem preload (TELAS §5: desligar o preload piorou o resultado). A arte não precisa mais dela: a célula de 1 em sai de
`letter-spacing: calc(1em - 1ch)`, que vale para qualquer mono (seção 4.3). Fica a mono do sistema (`ui-monospace, SFMono-Regular,
Menlo, Consolas, "Liberation Mono", monospace`), a mesma do `.ascii-block` da v1. Se o Artur quiser a JetBrains nos hashes:
`weight: ['400']`, `preload: false`, `adjustFontFallback: false`, `fallback` com a pilha mono, e só em telas que não sejam a home.

**Efeito em LCP e CLS.** LCP: o mesmo peso de fonte de hoje (medir: a soma dos `.p.*.woff2` depois do `pnpm build` fica em até 40 KB).
CLS: o `adjustFontFallback` do `next/font` (ligado por padrão) ajusta a fonte reserva às medidas da Geist e da Inter, e o hero tem
altura mínima, então a troca de fonte não empurra o resto da página (meta: CLS 0, como hoje; o portão é 0,1).

**Versão e licença.** O `next/font` baixa a versão vigente no build; a linha do DEPENDENCIAS.md leva a que o build de (a) baixar. A
fonte da licença é o próprio arquivo: a tabela `name` dos `.woff2` que a v1 baixou (`apps/web/.next/static/media` da v1, lidos sem
rede por um script de Node com o `brotliDecompressSync`, `.data/orquestracao/estudo/woff2-name.mjs`):

| Família | Arquivo (v1) | `name` ID 0 (copyright) | ID 5 (versão) | ID 14 (URL da licença) | Google Fonts (cache da v1) |
|---|---|---|---|---|---|
| Geist | `caa3a2e1cccd8315-s.p.0wgildi0cnwt9.woff2` | "Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font)" | 1.800 | `https://openfontlicense.org` (OFL) | `geist/v5` |
| Inter | `83afe278b6a6bb3c-s.p.2bn3s6zvc0dyp.woff2` | "Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter)" | 4.001 | `https://openfontlicense.org` (OFL) | `inter/v20` |
| JetBrains Mono | `70bc3e132a0a741e-s.p.3t6q91iet4nsy.woff2` | "Copyright 2020 The JetBrains Mono Project Authors (https://github.com/JetBrains/JetBrainsMono)" | 2.211 | `https://scripts.sil.org/OFL` | `jetbrainsmono/v24` |
| IBM Plex Sans (a de hoje, para comparar) | `e1ed49162831a791-s.p.2ccnl8wncv_qb.woff2` (v2) | "Copyright 2019 IBM Corp. All rights reserved." | 3.201 | `http://scripts.sil.org/OFL` | `ibmplexsans/v23` |

As três são OFL-1.1, como as IBM Plex de hoje (as versões 1.1 da OFL são as que esses endereços publicam). (a) repete a leitura nos
arquivos que o build dela baixar e põe a versão na linha.

### 1.3 Componentes do Arc

**Licença.** O Arc (uiarc.dev) é MIT nos itens gratuitos: "The full MIT license applies to free components and blocks", "Copyright
(c) 2026 Elia Kuratli", com a condição de manter o aviso de copyright em toda cópia ou parte substancial (https://uiarc.dev/license,
"Last updated October 25, 2026", consultada em 04/11/2026 com a autorização do coordenador). Os itens Pro têm outra licença, que
proíbe redistribuir o código; a v1 não instalou nenhum (`DESIGN.md`, Known Gaps). O JSON de um item do registro
(`https://uiarc.dev/r/button.json`) não tem campo de licença: tem `meta.tier: "free"` e `dependencies: ["motion"]`. Os arquivos que
a v1 copiou para `apps/web/src/components/arc/` **não trazem o aviso de copyright**; se algum código do Arc vier para a v2, o aviso
vai junto (comentário no topo do arquivo e uma linha no DEPENDENCIAS.md).

**Decisão: o Arc é referência de medida, não código copiado.** Os 23 itens que a v1 instalou (19 componentes e 4 blocos) importam
`motion/react`, e 13 arquivos deles importam `lucide-react`; a cápsula, o hero, o botão, o badge e a faixa de números são componentes
de cliente. Na v2, em que a home leva
os ~118 KB de JavaScript do framework e quase mais nada (TELAS §5), cada um deles traria o `motion` para toda página. E o
`HeroContent` do Arc anima o título a partir de `initial="hidden"`: no HTML do servidor o h1 nasce invisível e só aparece depois de
hidratar, o pior caso para o LCP. As peças abaixo são refeitas como Server Components com CSS, nas medidas do Arc (lidas de
`site-header.module.css`, `hero-content.module.css`, `hero-section.module.css`, `button.module.css` e `foundation.css` da v1). Nenhum
arquivo do Arc é copiado; se (a) copiar uma regra de CSS literal, vale o aviso acima.

| Arc (v1) | Medidas que vêm | Na v2 | Telas | JavaScript |
|---|---|---|---|---|
| `site-header` (`centered`) | barra de 64 px; cápsula com `padding: 3px`, borda `hairline` e fundo `surface-strong`; itens de 32 px, raio pílula, `padding: 0 14px`, 14 px, peso 500, cor `body`; o ativo com fundo `surface-card` e borda | `SiteHeader` (`site-chrome.tsx`): a marca e uma `nav` "Principal" só, com os mesmos 7 links e na mesma ordem: a cápsula centrada (Início, Ranking, Notícias, Ações, Como funciona), a pílula branca "Carteira" e a ação quieta "Conta" à direita, como o "Admin" e o "Ver decisões" da v1. Abaixo de 1024 px a `nav` vira `popover`, aberto pelo botão "Menu" (44 × 44); sem suporte a `popover` (`@supports not selector(:popover-open)`), os links aparecem em linha, como hoje | todas | nenhum |
| `button` (`primary`, `secondary`, `ghost`) | altura 44, raio 18, `padding: 0 20px`, 14 px, peso 500, `:active` em `scale(.97)` | as classes `btn`, `btn-primary` e `btn-ghost`, em `Link` e em `<button>` | todas | nenhum |
| `hero-section` › `HeroContent` (`minimal`) | título `clamp(2.25rem, 1.1rem + 3.4vw, 3.5rem)` (a v1 tetou em 56 px), tracking −0,03em, linha 1,1; descrição de 18 px (16 px abaixo de 560 px), `body`; anúncio de 32 px; ações de 44 px com 12 px entre elas | `Hero` (componente novo, de servidor) | home | nenhum (sem a entrada animada) |
| `stats-band` (`divided`) | células divididas por `hairline`, rótulo de 12 px em `muted`, valor grande, detalhe de 12 px | a faixa "Cotações e macro" (o `Strip` de hoje, redesenhado) | home | nenhum (sem contador animado) |
| `badge` | 24 px, raio pílula, ícone à esquerda | `badge`, `Flag` (`[ok] [!] [x]`), `ActionBadge` (BUY, SELL e HOLD) e `SimulatedTag` (T1) | home, ranking, modelo, ciclo, ação | nenhum |
| `empty-state` | centrado, ícone, título e texto | `Empty`, com a grade fantasma `. : .` da v1 no lugar do ícone | todas | nenhum |
| `alert` (`danger`) | caixa de superfície com borda, título e texto | `ApiDown` (a api fora) e o erro de formulário | erro, api fora, conta, carteira, admin | nenhum |
| `site-footer` (`minimal`) | marca e frase, links, a linha de cima | `SiteFooter`: o aviso fixo e as atribuições de hoje, na coluna da moldura | todas | nenhum (a data das cotações já chega por streaming) |
| `countdown` | | fica a contagem da v2 (`countdown.tsx`, o texto refeito a cada 30 s) | home | a de hoje |

Não entram: `metric-card` e `animated-counter` (número que conta é movimento sem motivo, e o contador do Arc escreve o menos como
hífen), `sortable-data-table` (as tabelas da v2 são de servidor e o e2e confere cada célula por igualdade), `chip-group`,
`segmented-control` e `pagination` (o filtro e a paginação da v2 são links GET, e viram `chip` e `btn`), `code-block` e
`copy-button` (o prompt nunca aparece, regra 4; o hash sai inteiro, como texto), `tabs`, `tooltip`, `timeline`, `line-chart`,
`sparkline` e `avatar`.

### 1.4 Helpers e componentes ASCII

| Peça | De onde (v1) | Para onde (v2) | Observação |
|---|---|---|---|
| `GLYPH`, `RAMP`, `sparkline`, `areaChart`, `uptimeBars`, `allocationBar` | `packages/config/ascii.ts` (190 linhas) e `ascii.test.mjs` (98) | `apps/web/src/lib/ascii.ts` e `ascii.spec.ts` (vitest) | código do Artur, sem dependência; só o site usa, então não vira pacote |
| `AsciiChart` (as camadas na mesma grade, a fonte por `cqi` arredondada para pixel inteiro) | `ui.tsx` | `ui.tsx` | na faixa da home: a curva do BOVA11, com as 60 barras que a home já lê da rota interna |
| A arte (`AsciiBackground`, formato v2) | `components/ascii-background.tsx` | `components/arte.tsx` (servidor) e `components/arte-viva.tsx` (cliente, uns 1 a 2 KB) | reescrita: o quadro 0 no HTML, já com a brasa (o PNG pequeno em `preload`), o tamanho por CSS, e o laço só a partir de 1024 px, depois do `load` (seção 4.3) |
| A fita | `ascii/pieces/tape.ts`, `AsciiPlayer` e `lib/tape.ts` | `components/fita.tsx` (servidor) e o texto em `lib/fita.ts` | rolagem em CSS (`@keyframes` com `steps()`, um caractere por passo), sem o runtime da ascii.rest |
| `BrandMark` | `components/brand.tsx` (SVG de 18 px) | `site-chrome.tsx` | o ladrilho âmbar com o glifo de alta vazado |
| `icon.svg` | `app/icon.svg` (263 B) | `app/icon.svg` | `[*]` âmbar sobre `#0f0f0f`; o `home.spec.ts` só confere o tipo |
| `DotSpinner` (3 × 3) | `components/dot-spinner.tsx` | `form-kit.tsx` | no botão que envia, ao lado de "Enviando…", com `aria-hidden` (o nome do botão continua "Enviando…": o e2e confere) |
| `Rule` e a moldura | `ui.tsx` e `layout.tsx` | `ui.tsx` e `layout.tsx` | a linha de 100vw com losango de 11 px nos cruzamentos; as laterais a partir de 1202 px |
| `PageHead`, `SectionHead`, `Card`/`Frame`, `Dl` | `ui.tsx` | `ui.tsx` (o `Section` e o `Facts` de hoje ganham a cara deles) | o `Section` continua `<section aria-labelledby>`: o e2e acha a região pelo nome |
| `Delta`, `OrderBadge` | `ui.tsx` | glifo por CSS | o `▲ ▼ ■` entra por `::before` com `content: "▲ " / ""`: não muda o `textContent` nem o `innerText` que o e2e compara por igualdade, e o leitor de tela não o lê |

Não vêm: o `AsciiPlayer` e o runtime `mount` da ascii.rest (nada na v2 anima peça de dado); as peças `candles` (a v2 já tem as velas
em SVG, `g[data-candle]`, que o e2e confere), `cycle-log`, `cycle-bar`, `returns-heatmap` e `returns-spark` (dado que a v2 não
mostra, seção 3); o `LoadingSkeleton`; o dither-kit (canvas e d3); o `DitherFrames` (só se as peças de cabeçalho entrarem, seção 2);
o `Ridge` (a silhueta do Ibovespa antes do rodapé obrigaria o layout a ler a api em toda página); e o `ModelAvatar` (seção 2).

### 1.5 Dependências npm

Nenhuma entra (seções 1.3 e 1.4). A tabela registra o que a v1 tinha, para quem quiser mudar a decisão. A versão e a licença foram
lidas do `package.json` instalado em `apps/web/node_modules` da v1 (o campo `license`), e o peer do React, do mesmo arquivo. Se um
pacote entrar, a versão da v1 serve ao React 19.3 pelo peer; o Next 16.4.3, o TypeScript 6.0.3 e o ESLint 10 se conferem no
`typecheck` e no `lint` da v2, e a mais nova se confere com `npm view <pacote> version` na instalação, fixando a exata (CLAUDE.md).

| Pacote | Versão na v1 | Licença (fonte) | Peer do React | Entra? | Versão se entrar | Por quê |
|---|---|---|---|---|---|---|
| `ascii.rest` | 0.2.1 | MIT (`license` do `package.json`; o `LICENSE` diz "Copyright (c) 2026 bas3line") | `>=18` | não | 0.2.1 ou a mais nova | só servia o runtime das peças animadas; a fita vira CSS |
| `motion` | 13.1.1 (traz `framer-motion` 13.1.1, `motion-dom` 13.1.1 e `motion-utils` 13.0.0) | MIT (`license`) | `^18.0.0 \|\| ^19.0.0` | não | 13.1.1 | era dos componentes do Arc |
| `lucide-react` | 1.54.0 | ISC (`license`) | `^16.5.1 \|\| ^17 \|\| ^18 \|\| ^19.0.0` | não | 1.54.0 | dois ícones (a seta e o menu) viram SVG inline |
| `@radix-ui/react-tabs` | 1.1.22 | MIT (`license`) | `^16.8 \|\| … \|\| ^19.0` | não | 1.1.22 | o `tabs` do Arc, sem uso |
| `@radix-ui/react-tooltip` | 1.3.0 | MIT (`license`) | idem | não | 1.3.0 | o `tooltip` do Arc, sem uso |
| `clsx` | 2.1.1 | MIT (`license`) | | não | 2.1.1 | a v2 junta classes com template |
| `tailwind-merge` | 3.6.0 | MIT (`license`) | | não | 3.6.0 | idem |
| `d3-scale` e `d3-shape` | 4.0.2 e 3.2.0 | ISC (`license`) | | não | as mesmas | o dither-kit; a v2 tem a geometria própria em `lib/chart.ts` |
| `@types/d3-scale` e `@types/d3-shape` | 4.0.9 e 3.2.0 | MIT (`license`) | | não | as mesmas | idem |
| `next`, `react`, `react-dom`, `tailwindcss`, `typescript` | 16.3.2, 19.2.8, 19.2.8, 4.3.3, `^5.7` | | | já estão | 16.4.3, 19.3.1, 19.3.1, 4.3.3, 6.0.3 | os da v2 |

Linhas prontas para o `docs/DEPENDENCIAS.md`, **só se o pacote entrar** (troque `dd/mm` pelo dia da instalação e confira a versão):

```
| `ascii.rest` | pacote npm | 0.2.1 | MIT | Runtime `mount` e contrato `(t) => texto` das peças ASCII animadas (sistema ascii-ui, ADR 0034) | apps/web | dd/mm/2026 | https://www.npmjs.com/package/ascii.rest |
| `motion` | pacote npm | 13.1.1 | MIT | Animação dos componentes copiados do Arc (traz framer-motion, motion-dom e motion-utils) | apps/web | dd/mm/2026 | https://www.npmjs.com/package/motion |
| `lucide-react` | pacote npm | 1.54.0 | ISC | Ícones dos componentes copiados do Arc | apps/web | dd/mm/2026 | https://www.npmjs.com/package/lucide-react |
| `@radix-ui/react-tabs` | pacote npm | 1.1.22 | MIT | Abas (o tabs do Arc) | apps/web | dd/mm/2026 | https://www.npmjs.com/package/@radix-ui/react-tabs |
| `@radix-ui/react-tooltip` | pacote npm | 1.3.0 | MIT | Dica (o tooltip do Arc) | apps/web | dd/mm/2026 | https://www.npmjs.com/package/@radix-ui/react-tooltip |
| `clsx` | pacote npm | 2.1.1 | MIT | Junta classes condicionais | apps/web | dd/mm/2026 | https://www.npmjs.com/package/clsx |
| `tailwind-merge` | pacote npm | 3.6.0 | MIT | Resolve conflito de classes do Tailwind | apps/web | dd/mm/2026 | https://www.npmjs.com/package/tailwind-merge |
| `d3-scale` | pacote npm | 4.0.2 | ISC | Escalas do dither-kit | apps/web | dd/mm/2026 | https://www.npmjs.com/package/d3-scale |
| `d3-shape` | pacote npm | 3.2.0 | ISC | Curvas do dither-kit | apps/web | dd/mm/2026 | https://www.npmjs.com/package/d3-shape |
| `@types/d3-scale` | pacote npm (dev) | 4.0.9 | MIT | Tipos do d3-scale | apps/web | dd/mm/2026 | https://www.npmjs.com/package/@types/d3-scale |
| `@types/d3-shape` | pacote npm (dev) | 3.2.0 | MIT | Tipos do d3-shape | apps/web | dd/mm/2026 | https://www.npmjs.com/package/@types/d3-shape |
```

Linhas que **entram** (fora das tabelas de npm: o `docs:check` só cobra npm, Docker e Action, mas a regra 1 do CLAUDE.md vale para
fonte, arquivo e serviço):

```
Fontes tipográficas (no lugar das duas linhas da IBM Plex):
| Geist | fonte tipográfica | Google Fonts v5 (Geist 1.800, a do cache da v1; conferir no build), só o peso 500, subset latin (um peso só: o Google serve a estática, ~15 KB, e não a variável de 29 KB) | OFL-1.1 (tabela `name` do arquivo, ID 14: https://openfontlicense.org) | Títulos, números grandes e tudo que é peso 500 (sistema ascii-ui, ADR 0034) | apps/web/src/app/layout.tsx | dd/mm/2026 | https://fonts.google.com/specimen/Geist |
| Inter | fonte tipográfica | Google Fonts v20 (Inter 4.001, idem), só o peso 400, subset latin (com dois pesos o Google serve a variável, 48 KB) | OFL-1.1 (idem) | Texto, células e rótulos (sistema ascii-ui, ADR 0034) | apps/web/src/app/layout.tsx | dd/mm/2026 | https://fonts.google.com/specimen/Inter |

Serviços externos (a linha do Google Fonts passa a dizer "Origem das fontes Geist e Inter no next build"), e uma linha nova:
| Higgsfield | serviço externo (só na origem das artes) | n/a | termos da API do Higgsfield (uso comercial, segundo a central de ajuda, "What Is the Higgsfield API"; conferir a versão vigente) | Gerou, para a v1, a imagem (Soul 2) e o vídeo (Kling 3.0) de onde o gerador do Artur tirou as artes da escadaria e do urso. O repositório não fala com ele | apps/web/public/ascii/arte/ | dd/mm/2026 | https://higgsfield.ai |

Seção nova, "Desenho de terceiros":
| Arc (uiarc.dev) | referência de desenho (itens free do registro shadcn) | licença "Last updated October 25, 2026" | MIT, Copyright (c) 2026 Elia Kuratli | As medidas da casca (cápsula, pílula, botões, hero, faixa de números) vêm dos componentes do Arc que a v1 copiou; a v2 não copia código do Arc (nem shadcn add, nem motion). Se algum arquivo for copiado, o aviso de copyright vai no topo dele | apps/web/src/app/globals.css, apps/web/src/components/site-chrome.tsx, apps/web/src/components/hero.tsx | dd/mm/2026 | https://uiarc.dev/license |

Seção nova, "Artes" (uma linha por arquivo da seção 2 deste plano).
```

## 2. Artes

| Arquivo | Tamanho e formato | Procedência | Licença | Repositório público? | Decisão |
|---|---|---|---|---|---|
| `apps/web/public/ascii/arte/escadaria.json` | 2.908.994 B (58.094 B em gzip -6); `{v: 2, cols: 200, rows: 120, fps: 12, sprite, frames[120]}` (10 s em laço); glifos ` #%*+-.:?` (só latinos) | gerado por `packages/config/ascii-arte.py` da v1 (código do Artur; entrada `escadaria` de `ARTES`) a partir de `higgsfield/video/touro-escadaria.mp4`: Kling 3.0 standard, imagem para vídeo, request `57013ba6-52bd-45c2-9b6b-853ce2b62234`, 27/09/2026, primeiro quadro = último; a imagem é `higgsfield/conceitos/touro-escadaria.jpg`: Soul 2 standard, request `c2f915e3-f894-43cd-93a2-5eed2ffadfe3`, 27/09/2026, prompt "A single large nelore bull climbing a wide monumental stone staircase of a neoclassical building at night…". Nenhum prompt nomeia obra, marca, lugar ou pessoa (`CREDITOS.md` da v1, seção `higgsfield/`; os `.json` de registro ao lado de cada arquivo) | saída da API do Higgsfield: "Uso comercial permitido pelos termos da API (help center, 'What Is the Higgsfield API'); conferir a versão vigente antes de publicar" (`CREDITOS.md` da v1). A conversão em ASCII é do Artur | sim, **depois** de o Artur conferir os termos vigentes do Higgsfield | copiar (a, hero) |
| `apps/web/public/ascii/arte/escadaria.png` | 324.794 B; PNG de paleta de 8 bits, 400 × 14.400 (metade esquerda a tinta, a direita o ladrilho; um bloco de 120 linhas por quadro) | o mesmo gerador, a mesma fonte | a mesma | idem | copiar (a, hero, só a partir de 1024 px) |
| `escadaria-q0.json` e `escadaria-q0.png` (novos) | o quadro 0 no mesmo formato v2 (`frames` com um quadro: 24.119 caracteres, 1.626 B em gzip) e o recorte do sprite: 400 × 120, PNG de paleta de 8 bits, **3.856 B** (medido; pelo `sips` sai em RGBA, com 8.664 B) | derivados dos dois de cima pelos comandos do apêndice A (o `frames[0]` do JSON; as primeiras 120 linhas do sprite, recortadas com o `zlib` do Node: o filtro de cada linha do PNG só olha a de cima, então as linhas valem como estão) | a mesma | idem | criar (a). O JSON mora em `apps/web/src/` e o componente de servidor o importa (entra no build: nada de ler `public/` do disco, que no standalone muda de lugar); o PNG fica em `public/ascii/arte/` e é a brasa do primeiro paint, com `preload` |
| `apps/web/public/ascii/arte/urso.json` | 2.060.588 B (49.333 B em gzip -6); 200 × 85, 12 fps, 120 quadros | o mesmo gerador, entrada `urso`, de `higgsfield/video/urso-colunas.mp4` (Kling 3.0, request `0a54ba8c-45cd-4cb6-aa26-7843b6d0e691`), da imagem `higgsfield/conceitos/urso-colunas.jpg` (Soul 2, request `672c8016-542c-4f6e-bbde-3c0288d87ffd`), "A large bear standing on its hind legs, pushing over a row of tall neoclassical stone columns…" | a mesma do Higgsfield | idem | copiar (b, 404), com o seu `urso-q0` (o recorte de 85 linhas tem 4.816 B, medido) |
| `apps/web/public/ascii/arte/urso.png` | 428.596 B; paleta, 400 × 10.200 | idem | idem | idem | copiar (b) |
| `dither/cabecalho/{moeda,ampulheta,envelope,sino}/q-NNN.png` | 60, 72, 48 e 48 quadros; 41.678, 32.858, 19.295 e 18.062 B no total | render próprio no Blender 5.2.2 (scripts da v1 em `.claude/skills/halftone/references/fonte/blender/`); a moeda e o lacre do envelope usam `relevo-t2.png`, feito da imagem `higgsfield/t2-touro-still.jpg` (Soul 2); nenhum usa o relevo da estátua de Wall Street nem o modelo do Sketchfab (`CREDITOS.md` da v1, "blender/cabecalho (18/10/2026)") | próprias; moeda e envelope herdam a ressalva do Higgsfield | sim, com a mesma conferência | **fora desta onda**. Os motivos falam do "corte das 18h30", que a v2 não tem, e as peças pedem o `DitherFrames` (cliente) e 48 a 72 pedidos por página. Entram depois, se o Artur pedir, com os motivos reescritos |
| `apps/web/public/ascii/touro.json` | 448.159 B | `ascii-gerar.py` da v1, de `touro-wallstreet.mp4`: a estátua de Wall Street (escultura protegida, procedência não verificada) | | **não** | fora |
| `apps/web/public/modelos/*.svg` (anthropic, openai, google, deepseek, xai) | 751 a 2.836 B | LobeHub Icons (MIT para o desenho; a marca é de cada laboratório) | MIT, marcas de terceiros | não nesta onda | fora: com o elenco simulado, o logo de um laboratório ao lado de uma decisão que ele não tomou leria como endosso. No lugar, nada: o nome e a etiqueta "simulado" bastam. O ladrilho `>_` da v1 (provedor sem logo) fica para quando a integração chegar |
| `dither/bolsa/*`, `dither/touro-*`, `dither/cenas/*`, `ascii/lab/*`, `ascii/arte/simulacroom-*` e `video-*` | | estátua de Wall Street, modelo do Sketchfab sem licença, relevo derivado da estátua, ou laboratório | | **não** | fora |
| As imagens da skill (`waerk-quadro.jpg`, `waerk-brasa.jpg`, `x-2026-10/`) | | quadros do vídeo do WAERK (Basit A. Khan) e de posts do X | de terceiros | **não** | fora; a skill, se vier, sem elas (seção 7) |
| `alvesting-escadaria-1x1.jpg` (referência da skill) | 210.108 B | a prévia 1:1 do gerador | a da escadaria | sim | não precisa vir |

**Se os termos do Higgsfield não permitirem**, as duas artes não entram e não há substituta pronta sem procedência: o hero sai com a
composição da v1 sem a imagem (o vazio preto, a pílula, o título, os botões e a fita no pé) e a 404 sai só com o texto. Uma arte nova
de fonte própria (um render do Blender, como a colunata da v1, passado pelo `ascii-arte.py`) seria outra tarefa.

**O gerador não vem.** O `ascii-arte.py` grava num caminho fixo da v1 e pede ffmpeg, numpy e PIL; nesta onda nenhuma arte é gerada,
e os `-q0` saem dos arquivos prontos. A cadeia de procedência fica registrada no DEPENDENCIAS.md e no ADR 0034, com o commit
`cddd320` da v1. Se uma arte nova for necessária, o gerador vem com ela, e as ferramentas entram em "Instalado na máquina de
desenvolvimento".

## 3. Mapa das telas

O que vale para toda tela (as regras do `DESIGN.md` da v1 que atravessam): um h1; nada de sobretítulo, caixa-alta nem travessão em
texto visível; uma pílula branca por superfície; navegar é link, `<button>` é ação; número tabular; todo valor com direção leva
`▲ ▼ ■` e sinal; a arte nunca atrás de texto que precise ser lido; `PageHead` fecha com a linha da moldura e o `Section` seguinte abre
48 px abaixo (a faixa vazia); tabela larga rola dentro da caixa. **Carregando**: nenhuma tela ganha `loading.tsx` nesta onda (a v1
tinha um por rota); a página é de servidor e o Next segura a anterior até a nova chegar, como hoje. **Erro**: `error.tsx`. **Api fora
do ar**: `withApiDown` monta a tela de erro no servidor, com o cabeçalho e o rodapé.

| Rota | Padrão da v1 (ou regra) | Composição e componentes | Estados (além dos de toda tela) | Dona |
|---|---|---|---|---|
| layout | `app/layout.tsx` da v1 | Geist 500 e Inter 400; `color-scheme: dark`; o cabeçalho de 64 px, `sticky`, com a linha de baixo (a primeira da moldura): a marca, a `nav` "Principal" (a cápsula, a pílula "Carteira" e "Conta") e, abaixo de 1024 px, o botão "Menu"; as seções com `scroll-margin-top: 64px` (o `#feed`); o invólucro com `overflow-x: clip` e as laterais da moldura (`data-moldura`, `aria-hidden`, a partir de 1202 px); o `main` na coluna de 1200 px com a calha `clamp(16px, 4vw, 32px)` (hoje `max-w-5xl` e `px-4`); a `Rule` antes do rodapé; o rodapé. Sem o `Ridge` | a data do rodapé some se a leitura falhar (como hoje) | (a) |
| `/` | a home da v1 (`app/page.tsx`) | `Hero` (seção 4) → `Rule`, faixa vazia, `Rule` → a faixa "Cotações e macro" (o mesmo `dl`, com a curva ASCII das 60 barras na célula do BOVA11) → `Rule` → na coluna: "Ranking" (a tabela compacta e `btn` "Ranking completo"), "Ciclos" (o último ciclo e a contagem BUY, SELL e HOLD numa faixa de três; o próximo, com a contagem regressiva), "Patrimônio" (o `EquityChart` num `card`, a faixa do Monte Carlo em `surface-strong`), "Decisões" (o filtro em `chip`, o `DecisionCard` em `card`, "Mais antigas" em `btn`) e "Temporada" (os fatos). O ranking vem antes, como na v1 (quem está ganhando não fica na quarta dobra); os testes acham as regiões pelo nome, não pela ordem | sem temporada: o hero sem a pílula, só "Regras da arena" como pílula branca, a fita "sem cotações ainda" e o `Empty` de hoje; sem ciclo: `Empty` em Ciclos, Patrimônio e Ranking; filtro sem decisão: `Empty`; aviso de simulado (T1) dentro do hero | (a) |
| `/ranking` | o ranking de `/competicoes/<id>` | `PageHead` "Ranking" (a temporada e o pregão no `meta`) → as seções de hoje (Modelos, o Sorteio e as referências), cada uma com `TableScroll` e `tbl`; o retorno com o glifo por CSS; a etiqueta "simulado" | sem resultado: `Empty` | (b) |
| `/modelos/[slug]` | `/modelos/<id>` da v1 (sem o `ModelAvatar`) | `PageHead` (o nome, a `SimulatedTag`, o aviso "Decisões simuladas: o modelo ainda não está conectado." da T1, o provedor e o ID no `meta`) → "Resultado" (`Facts` num `card`) → "Carteira" (`Facts` e `PositionsTable`) → "Patrimônio" (`EquityChart`) → "Decisões" (`DecisionCard` pelo pregão). O Sorteio e as referências: só o patrimônio | slug que não existe: 404; sem carteira, sem decisão: `Empty` | (b) |
| `/ciclos/[data]` | `/competicoes/<id>/ciclos/<data>` | `PageHead` "Ciclo de dd/mm/aaaa" (o `Flag` da situação) → "Horários" (decisão às 08:00, prazo às 09:30, fechamento) → "Prompt e briefing" (a versão e os SHA-256 inteiros, na mono, num `card`; **nada de bloco de código**: o texto do prompt e o do briefing nunca saem) → "Decisões dos modelos" (`DecisionCard` pelo modelo, em duas colunas a partir de 1024 px; o HOLD forçado e os itens descartados com o motivo) | data inválida ou sem ciclo: 404; ciclo pulado ou sem decisão: `Empty` com o motivo | (b) |
| `/noticias` | `/noticias` da v1 (sem a peça de cabeçalho) | `PageHead` "Notícias" → o formulário GET do filtro (`field` e `btn` "Filtrar"; "Limpar filtro") → a lista (título como link externo de 44 px, fonte, hora, tickers como `chip`) → "Mais antigas" | sem notícia ou filtro sem resultado: `Empty`; ticker inválido: o aviso `role="alert"`; cursor torto: 404 | (b) |
| `/acoes` | `/acoes` da v1 (sem a tabela do universo) | `PageHead` "Ações" e a busca → a lista de resultados (ticker na mono e o nome) | sem busca: só o formulário; sem resultado: `Empty`; busca inválida: o aviso | (b) |
| `/acoes/[ticker]` | `/acoes/<ticker>` da v1 (as velas em SVG, não em ASCII) | `PageHead` (o ticker e o nome) → "Cotações recentes" (o `CandlesChart` redesenhado: alta vazada e baixa cheia em `ink` e `body`, e o crédito "Cotações: brapi.dev, pregão de…") → "Quem tem a ação" (`PositionsTable`, só modelos) → "Decisões" (`ActionBadge`) → "Notícias" (`NewsList` e "Todas as notícias de X") | ticker inválido: 404; sem barra, sem decisão, sem notícia: `Empty` | (b) |
| `/como-funciona` | sem par na v1; a regra das páginas de texto (`PageHead` e seções em prosa) | `PageHead` "Como funciona" → as seções de hoje (h2), em prosa (`prose-md`, até 64 caracteres por linha), os números em `Facts`, o hash do prompt inteiro num `card` na mono, referências e fontes como `link` | sem a api: o texto sem os números (como hoje) | (b) |
| `/rota-que-nao-existe` (not-found) | `not-found.tsx` da v1: o texto e a arte do urso num bloco abaixo | h1 "Página não encontrada" e o texto de hoje → "Voltar ao início" (`btn-primary`), "Ver o ranking" e "Buscar uma ação" (`btn`) → o urso num bloco abaixo, com o quadro 0 no HTML e o laço a partir de 1024 px | responde 404 (o e2e aceita o erro de console do próprio documento) | (b) |
| `error` | `error.tsx` da v1 (`Alert` e tentar de novo) | o `ApiDown` de hoje (texto fixo) num `alert` → "Tentar de novo" (`btn-primary`) e "Voltar ao início" (`btn`) | o código do erro (`digest`) na mono | (b), com o `ApiDown` de (a) |
| `/entrar` | sem par na v1; a regra dos formulários (Arc: campo de 44 px, uma pílula branca, `DotSpinner` no envio) | `PageHead` "Entrar" → o formulário num `card` (`field`; "Entrar" em `btn-primary`; "Entrar com o Google" em `btn`) → "Criar conta" e "Esqueci a senha" como `link` | enviando: "Enviando…" e o `DotSpinner`; erro: a mensagem do formulário num `alert`; com sessão: redireciona (como hoje) | (c) |
| `/cadastro` | idem | `PageHead` "Criar conta" → o formulário num `card`, as caixas de aceite (`check`) com os links dos termos | idem; aceite que falta: o erro no campo | (c) |
| `/verificar-email` | idem | `PageHead` → o estado da verificação (ok, expirado, inválido) num `card` → reenviar (`btn-primary`) | os estados de hoje | (c) |
| `/esqueci-senha` | idem | `PageHead` → o formulário de e-mail num `card` | enviado: a mensagem neutra de hoje | (c) |
| `/redefinir-senha` | idem | `PageHead` → nova senha num `card` | token inválido ou expirado: a mensagem de hoje | (c) |
| `/conta` | sem par; `PageHead` e seções de ajuste (o `Dl` da v1) | `PageHead` "Conta" → "Dados" (`Facts`), "Aceites" (o formulário de aceite), "Exportar" (`btn`), "Sair" (`btn`), "Excluir" (a confirmação e a senha num `card` com a borda `semantic-error`; o botão em `btn`, não em pílula branca) | sem sessão: `/entrar`; aceite pendente: o formulário em primeiro | (c) |
| `/carteira` | sem par (a carteira dos modelos da v1 tinha a `AllocationBar`) | `PageHead` "Minha carteira" → o aviso da carteira (`[!]` num `card`) → "Resumo" (a faixa, como a da home) → "Posições" (`tbl` em `TableScroll`, com o crédito da brapi) → "Lançamentos" (`card` por lançamento; editar e apagar em `btn`) → "Lançar uma compra" (`field`, `radio`, `btn-primary`) | vazia: `Empty` (o texto de hoje); sem cotação: a posição sem fechamento; os erros do formulário; enviando; sem sessão ou aceite pendente: redireciona | (c) |
| `/admin` | `/admin` da v1 | `PageHead` "Painel" → os painéis de hoje (temporadas, custos, jobs, filas) em `card` e `tbl`; os formulários de reprocesso e de evento societário com a confirmação | não admin: 404; confirmação; erros de cada ação | (c) |
| `/termos` | sem par; página de texto | `PageHead` (o título e a versão no `meta`) → o texto em prosa (`prose-md`, 64 caracteres) | | (c) |
| `/privacidade` | idem | idem | | (c) |

Os nomes de região que o e2e procura e que o redesenho mantém: Temporada, Cotações e macro, Ciclos, Patrimônio, Ranking, Decisões,
Modelos, Sorteio e Monte Carlo, Regras da temporada, O prompt oculto, Resultado, Horários, Prompt e briefing, Decisões dos modelos,
Cotações recentes, Quem tem a ação, Notícias e Aviso.

**O que a v1 mostrava e a v2 não tem** (e fica de fora): a lista e a página de competições (a v2 tem uma temporada atual e o
`/ranking`); a página de uma decisão com o prompt e a resposta (o prompt é oculto, regra 4, e o IO bruto nunca sai); o snapshot do
contexto em árvore e em bloco de código (o briefing sai só como SHA-256); "o papel mais disputado" em velas ASCII na home; o log do
ciclo, a barra de ciclos e o mapa de retornos diários; o patrimônio em small multiples com o Ibovespa; a silhueta do Ibovespa antes do
rodapé; o logo do laboratório; o link "Admin" e o status "Dados ao vivo" no cabeçalho e no rodapé; o custo de LLM na faixa de números
(a v2 o mostra por competidor no `/ranking`); e um `loading.tsx` por rota.

**O que a v2 tem e a v1 não tinha** (e ganha o desenho pela regra): as telas da conta, a carteira do usuário, os termos e a
privacidade; o Sorteio, a faixa do Monte Carlo e o percentil; as referências (igual-peso, CDI e BOVA11); o macro do BCB; o "Como
funciona"; o prompt oculto com o hash publicado; o horário da decisão (08:00) e do prazo (09:30), com a execução na abertura; o aviso
fixo e as atribuições no rodapé; o filtro BUY, SELL e HOLD do feed; e a etiqueta "simulado".

## 4. O hero

### 4.1 A composição da v1

Código: `apps/web/src/app/page.tsx` da v1, o primeiro `<section>`:

```tsx
<section className="relative isolate -mt-16 flex min-h-[max(720px,100svh)] flex-col overflow-hidden">
  <AsciiBackground src="/ascii/arte/escadaria.json" anchor="bottom" fade={{ x: "10%", y: "14%" }} className="-z-10" style={{ bottom: "5.5rem" }} />
  <HeroContent
    layout="minimal"
    className="bg-transparent! pt-16 [&_h1]:text-[clamp(2.25rem,1.1rem+3.4vw,3.5rem)]! [&>div]:px-[clamp(16px,4vw,32px)]!"
    announcement={{ label: `Ciclo ${comp.cycleCount} de ${comp.plannedCycles} · último pregão ${dateShort(last.cycleDate)}`, href: `/competicoes/${cid}/ciclos/${last.cycleDate}` }}
    title="Modelos de linguagem investindo na B3"
    description="A cada fechamento, todos recebem o mesmo contexto e emitem ordens fictícias a preços reais, com a justificativa aberta. Um degrau por pregão, com todo o histórico auditável."
    primaryAction={{ label: "Ver decisões", href: decisoes }}
    secondaryAction={{ label: "Regras da arena", href: `/competicoes/${cid}` }}
  />
  <div className="mt-auto flex flex-col items-center gap-sm pb-lg">
    <p className="m-0 text-label text-muted">Os mesmos {comp.universe.length} papéis da B3, lidos por todos os modelos</p>
    <div className="w-full [mask-image:linear-gradient(to_right,transparent,#000_15%,#000_85%,transparent)]">
      <Tape text={tapeText(instruments)} />
    </div>
  </div>
</section>
<Rule /><div className="h-xxl" /><Rule />
<StatsBand layout="divided" locale="pt-BR" stats={[…]} />
<Rule />
```

As medidas, de `docs/redesign-2026-10/qa/home-1440.png` e `home-390.png` da v1:

| | 1440 × 900 | 390 × 844 |
|---|---|---|
| Cabeçalho | 64 px; a marca a 152 px da esquerda (coluna de 1200 centrada, mais a calha de 32); a cápsula centrada (5 itens, 436 px); à direita "Admin" e a pílula branca "Ver decisões" (36 px) | 64 px; a marca, a pílula "Ver decisões" e o botão do menu |
| Moldura | as laterais em x = 120 e 1320, de 1 px, a partir da linha do cabeçalho | sem laterais |
| Pílula do anúncio | y ≈ 162 a 192 (32 px), à esquerda, na calha | y ≈ 130 a 160 |
| Título | Geist 500 de 56 px, duas linhas, y ≈ 215 a 335, ~560 px de largura | 36 px, três linhas, y ≈ 185 a 300 |
| Descrição | Inter 18 px em `body`, três linhas, até 560 px | 16 px, quatro linhas |
| Botões | 44 px; a pílula branca "Ver decisões →" e o "Regras da arena" escuro com borda | os dois lado a lado, cada um com metade da largura |
| Arte | da coluna x ≈ 480 até a borda direita (sangra pela lateral), de y ≈ 350 a 810; o touro aceso logo abaixo e à direita dos botões; dissolve à esquerda (10%) e embaixo (14%) | de y ≈ 480 a 760, recortada pelo `cover`, sangrando à direita |
| Pé | a legenda de 12 px em `muted`, centrada, em y ≈ 840; a fita de 13 px na mono, em `muted`, de ponta a ponta com o degradê nas pontas, em y ≈ 868 | a legenda em y ≈ 793, a fita em y ≈ 815 |
| Altura | `max(720px, 100svh)`, subindo por baixo do cabeçalho transparente (`-mt-16`) | idem |

### 4.2 O texto, adaptado à v2

| Peça | v1 | v2 |
|---|---|---|
| Pílula do anúncio | "Ciclo 14 de 62 · último pregão 14 out 2026" | "Temporada em andamento · pregão {X} de {Y}" ou "Temporada encerrada · pregão {Y} de {Y}", com a seta; leva a `/ciclos/{lastCycle.date}`. X é o número de pregões liquidados (`equity.dates.length`, que a home já lê: 20 na demo) e Y, `season.params.sessions`. Antes do primeiro ciclo: "Temporada em andamento · primeiro pregão em {dd/mm}" (`nextCycle.date`), levando a `/como-funciona`. Sem temporada: sem pílula. O nome da temporada fica na seção "Temporada" (pode ser longo: o da demo tem 45 caracteres) |
| Título (h1) | "Modelos de linguagem investindo na B3" | o mesmo |
| Descrição | a de cima, com "a cada fechamento" | "Às 08:00 de cada pregão, todos recebem o mesmo briefing e o mesmo prompt, oculto e com o hash publicado. As ordens fictícias executam na abertura, a preço real, com a justificativa aberta." (uns 190 caracteres; "Um degrau por pregão." pode fechar, se couber em quatro linhas a 390 px). Nada de "corte" nem de 18h30 |
| Aviso (T1) | | o parágrafo da T1, com o mesmo texto, logo abaixo da descrição: o `<strong>` "Decisões simuladas: os modelos ainda não estão conectados." e o resto da frase em `label`, com `[!]` em `muted` à esquerda (seção 4.5) |
| Botão principal (pílula branca) | "Ver decisões" → as decisões da competição | "Ver decisões" → `/ciclos/{lastCycle.date}` (o ciclo mostra a decisão de cada modelo, com os hashes). Sem ciclo, o botão some e "Regras da arena" vira a pílula branca |
| Botão secundário | "Regras da arena" → a competição | "Regras da arena" → `/como-funciona` |
| Legenda | "Os mesmos 19 papéis da B3, lidos por todos os modelos" | "Os mesmos {N} papéis da B3, lidos por todos os modelos. Cotações: brapi.dev, pregão de {dd/mm/aaaa}." (o crédito em texto, sem link: o link fica no rodapé, como o do BOVA11 hoje) |
| Fita | `PETR4 38,12 ▲ +1,20%   ·   VALE3 …` (fechamento e variação do universo) | a mesma forma, com o universo da semana (seção 4.4) |

Na faixa logo abaixo do hero, a "Cotações e macro" de hoje fica (o `smoke.spec.ts` e o `arena.spec.ts` a procuram pelo nome e pelo
`dt` "BOVA11"), com o desenho da `stats-band`.

### 4.3 O markup proposto

```tsx
// components/hero.tsx (servidor). Sem 'use client', sem motion, sem entrada animada.
<section className="hero relative isolate -mx-[calha] flex min-h-[max(656px,calc(100svh-64px))] flex-col overflow-hidden">
  <Arte nome="escadaria" anchor="bottom" fade={{ x: '10%', y: '14%' }} className="-z-10" style={{ bottom: '5.5rem' }} />
  <div className="coluna pt-24 max-[560px]:pt-16">
    {pill ? (
      <NavLink href={pill.href} className="pill-toque">      {/* a caixa do link tem 44 px; a pílula de 32 px fica dentro */}
        <span className="pill">{pill.text}<Seta /></span>
      </NavLink>
    ) : null}
    <h1 className="font-display text-[clamp(2.25rem,1.1rem+3.4vw,3.5rem)] …">Modelos de linguagem investindo na B3</h1>
    <p className="text-lead text-body max-w-[560px]">…</p>
    {simulated ? <AvisoSimulado /> : null}                       {/* o texto da T1, sem mudar uma vírgula */}
    <div className="acoes">
      {last ? <NavLink href={`/ciclos/${last.date}`} className="btn btn-primary">Ver decisões<Seta /></NavLink> : null}
      <NavLink href="/como-funciona" className={last ? 'btn' : 'btn btn-primary'}>Regras da arena</NavLink>
    </div>
  </div>
  <div className="mt-auto flex flex-col items-center gap-sm pb-lg">
    <p className="text-label text-muted">Os mesmos {n} papéis da B3, lidos por todos os modelos. Cotações: brapi.dev, pregão de {data}.</p>
    <Fita linhas={fita} />                                       {/* CSS, aria-hidden, com o texto para o leitor de tela em sr-only */}
  </div>
</section>
```

O cabeçalho da v2 é sólido (não lê a rolagem: sem JavaScript), então o hero não sobe por baixo dele: a altura passa a
`max(656px, 100svh - 64px)`, o que dá a mesma imagem. A seção sai da coluna do `main` por margem negativa (a mesma técnica da `Rule`),
para não obrigar toda página a ganhar o próprio contêiner.

**A arte (`arte.tsx` e `arte-viva.tsx`), sem canvas e sem shader:**

1. **No servidor, o quadro 0 inteiro, com a brasa**: o `<div>` hospedeiro (absoluto, `overflow: hidden`, `aria-hidden`,
   `pointer-events: none`, com a máscara do `fade`) com `container-type: size`; dentro, a grade com
   `font-size: max(100cqw / cols, 100cqh / rows)` (o `cover` da v1, em CSS, sem `ResizeObserver`: o tamanho certo já no HTML, nenhum
   salto de layout); a camada do ladrilho e o `<pre>` com o texto do quadro 0 (de `escadaria-q0.json`, que o componente importa), os
   dois com `escadaria-q0.png` de fundo, como na v1 (`background-clip: text` e `color: transparent` no `<pre>`; a máscara de quadrado
   arredondado no ladrilho). O PNG vai com `preload` e `fetchpriority="high"` (o `preload` do `react-dom`, no componente de servidor).
   O `<pre>` usa a mono do sistema com `letter-spacing: calc(1em - 1ch)` e `left: calc((1em - 1ch) / 2)`: a célula fica com 1 em
   exato em qualquer mono (a v1 dependia do avanço de 0,6 em da JetBrains). **No celular a arte não tem JavaScript nenhum.**
2. **Só a partir de 1024 px, sem `prefers-reduced-motion` e sem `navigator.connection.saveData`** (o `arte-viva.tsx`, uns 1 a 2 KB,
   sem dependência): depois do `load`, num `requestIdleCallback`, busca `escadaria.json` (58 KB) e `escadaria.png` (325 KB) e toca o
   laço a 12 fps, trocando o `textContent` e o `background-position` (a v1 media ~0,5 ms por quadro). Pausa fora da tela e na aba
   oculta, como a v1.

Por que a brasa já vem no primeiro paint, e não depois do `load`: uma imagem de fundo que chega depois, num elemento do tamanho da
arte, vira candidata nova ao LCP no instante em que pinta (o LCP só cresce), e o Lighthouse passaria a contar o JavaScript e o
`load` antes dela. Com o PNG pequeno em `preload`, tudo o que o hero pinta chega com o HTML.

### 4.4 A fita

**A fonte do dado.** A fita da v1 lia `api.instruments()` (fechamento e variação de cada papel). A v2 não tem isso público, e não
pode ter: a API pública não entrega cotação bruta (ADR 0033), e o site não conhece o universo da semana. **A `a0`**: uma rota interna
nova, `GET /api/v1/interno/fita`, irmã de `/interno/barras/:ticker` (o mesmo `QUOTES_SECRET` conferido em tempo constante, 404 igual
ao da rota que não existe sem ele, `no-store`, fora do Swagger, com `/interno/` no caminho para o WAF barrar na borda). Devolve o
universo da semana do último ciclo, o que o briefing deu a todos os modelos: `{ date, rows: [{ ticker, closeCents,
previousCloseCents | null }] }`, no máximo o tamanho do universo. O site a lê em `lib/quotes.ts` (o único módulo que lê o segredo),
pelo cache de dados com a tag `arena` e os 300 s das outras, em paralelo com as leituras da home. É **exibir** a cotação, o que a
licença da brapi permite; o crédito vai na legenda e no rodapé.

**O papel do Postgres.** Hoje o login `alvesting_api` **não lê** `universe_snapshot` nem `universe_member` (`table-policy.ts`:
"nenhuma rota da api lê o universo; o worker o congela"); lê `instrument` e `daily_bar`. A `a0` precisa de uma migration só com
`GRANT SELECT ON universe_snapshot, universe_member TO alvesting_api` (sem `ALTER DEFAULT PRIVILEGES`, sem mexer em dado) e da
linha nova das duas tabelas na matriz do `table-policy.ts` (`api: ['SELECT']`, com o porquê); o `table-policy.spec.ts` e o
`api-role.integration.spec.ts` conferem os dois.

Arquivos da `a0`: `apps/api/src/modules/quotes/presentation/quotes.controller.ts` e `quotes.integration.spec.ts`,
`apps/api/src/modules/quotes/infrastructure/quotes.repository.ts`; `apps/api/src/infrastructure/database/table-policy.ts`; a
migration nova em `apps/api/prisma/migrations/`; `packages/contracts/src/internal.ts` e `internal.spec.ts`;
`apps/web/src/lib/quotes.ts` e `quotes.spec.ts`; `infra/tests/check.mjs` (a rota entra no `NEVER_CACHED`, que o teste compara com o
controlador); `docs/API.md` (seção 6), `docs/INFRA.md` (2.2, se a matriz do papel estiver escrita lá) e a frase das rotas internas
no `CLAUDE.md`. O teste da legenda e da fita no `smoke.spec.ts` é de (a), dona da home. A `a0` é a maior peça de (a) e não toca em
nenhum arquivo da home: pode ir para outro worker em paralelo com (a), depois da T1. Enquanto ela não chega, a home usa a fita sem a
`a0` (abaixo) e troca a leitura quando ela entrar.

**Sem a `a0`**, a fita mostra o que a home já tem: "BOVA11 66,25 ▼ −0,97%   ·   CDI 0,050140% ao dia   ·   Selic 14,50% ao ano   ·
IPCA 0,59% no mês   ·   …", e a legenda vira "O mesmo briefing para todos os modelos: o BOVA11 e o macro do Banco Central.
Cotações: brapi.dev, pregão de {data}." (sem o "N papéis", que seria falso).

**A rolagem**: `@keyframes` com `transform: translateX(-50%)` e `steps(N)` (N = caracteres de uma volta; um caractere por passo, como
a peça da v1), a 8 caracteres por segundo, o texto duas vezes num trilho `w-max` dentro de uma caixa `overflow: hidden` com a máscara
das pontas. A caixa é `aria-hidden`; o mesmo dado vai uma vez em `sr-only` ("Fechamentos do pregão de…"). Sob movimento reduzido, a
regra global zera a animação e a fita fica parada no começo.

### 4.5 O aviso de decisões simuladas e a etiqueta "simulado"

A T1 acrescenta (em andamento, `apps/web/src/components/ui.tsx` e `src/app/page.tsx`): `isSimulated(competitor)` (MODEL com provider
`fake`), a `SimulatedTag` (um espaço e um `<span>` "simulado" de borda tracejada, logo depois do nome, onde o nome aparece: ranking,
home, modelo, decisões, ciclo) e, na home, o parágrafo "**Decisões simuladas: os modelos ainda não estão conectados.** Os nomes são
os do elenco, mas quem decide por cada modelo marcado como simulado é uma estratégia fixa e simples. O resultado não diz nada sobre os
modelos de verdade."; na página do modelo, "Decisões simuladas: o modelo ainda não está conectado.". O e2e dela procura essas frases
(`getByText`) e o texto "simulado" nas células e nos títulos.

O redesenho mantém as duas coisas, com o mesmo texto: a etiqueta vira um `badge` neutro com a borda tracejada em `hairline-strong` e o
texto em `muted` (a borda tracejada continua sendo o sinal sem cor, como o HOLD), e o aviso da home vai para dentro do hero, entre a
descrição e os botões, com `[!]` em `muted` (não há cor de aviso: o âmbar leria como "selecionado"). Quando o elenco passar ao provedor
de verdade, os dois somem sozinhos, como a T1 deixou.

### 4.6 O risco de LCP no celular

**O que a v1 fazia.** O `AsciiBackground` é de cliente: o `<pre>` chega vazio no HTML; depois de hidratar, o `fetch` traz o JSON (2,9
MB crus, 58 KB em gzip), o `JSON.parse` de 2,9 MB roda na thread principal (uma tarefa longa, que pesa no TBT), o tamanho da fonte é
calculado num efeito de layout (o primeiro quadro nasce com 10 px e salta: risco de CLS) e o sprite (325 KB) chega por `background`.
No celular, a arte é o maior bloco visível (uns 390 × 280 px, contra uns 360 × 120 do título), então vira o elemento do LCP, pintado
depois de tudo isso. E o título do `HeroContent` nasce com opacidade 0 até o `motion` hidratar. Somado às fontes da v1 (118 KB), o
hero da v1 na v2 reprovaria o portão de 2,5 s.

**O orçamento.** A home de hoje mede 2,34 s no valor ruim da simulação (TELAS §5), com 160 ms de margem, uns 32 KB no fio. Estimativa
do plano, a medir:

| Peça | Hoje | Com o plano | No fio |
|---|---|---|---|
| Fontes com preload | 37,8 KB | ~38 KB (Geist 500 e Inter 400) | ~0 |
| CSS dentro do HTML (vai três vezes) | ~5 KB comprimidos | ~7 a 9 KB comprimidos | +6 a +12 KB |
| Documento (sem o CSS) | 33 KB no fio, com o CSS | mais o hero, a fita (duas vezes) e o quadro 0 (no HTML e no payload do React: 2 × 1,6 KB) | +4 a +6 KB |
| `escadaria-q0.png` | | com `preload` (3.856 B, medido) | +4 KB |
| JavaScript | o do framework e a contagem | a `arte-viva` só entra a partir de 1024 px, mas o pedaço dela vai junto | +1 a +2 KB |
| Total | | | +15 a +24 KB, ou +75 a +120 ms: entre 2,42 e 2,46 s no valor ruim |

Dentro do portão, mas na borda: o TELAS (§5) já diz que acima de uns 2,45 s se investiga o peso antes de mexer no limite.

**Como medir.**

1. `pnpm lighthouse` (com a trava pesada, `df -g /` antes): 5 coletas, mediana; LCP ≤ 2,5 s (meta interna ≤ 2,45 s), CLS ≤ 0,1,
   TBT ≤ 200 ms. Em `.lighthouseci/lhr-*.json`: o audit `largest-contentful-paint-element` (qual nó é o LCP: o `<pre>` da arte, o h1
   ou a descrição), `network-requests` (só o `escadaria-q0.png`, nenhum pedido a `escadaria.json` nem a `escadaria.png`),
   `total-byte-weight` e o tamanho do documento.
2. Os bytes, sem o Lighthouse: `ls -l apps/web/.next/static/media/*.p.*.woff2` (soma ≤ 40 KB);
   `curl -s -o /dev/null -w '%{size_download}' -H 'Accept-Encoding: gzip' http://127.0.0.1:4302/` (hoje 33 KB) e o tamanho do
   `<style>` do `<head>`.
3. O elemento, em Chromium com a CPU 4 vezes mais lenta (CDP `Emulation.setCPUThrottlingRate`): um `PerformanceObserver` de
   `largest-contentful-paint` que registra `element` e `startTime`. Ferramenta de diagnóstico, não teste.
4. O e2e novo da seção 5.4: em 390 px nenhum pedido a `escadaria.json`; sem JavaScript, o `<pre>` já tem o texto do quadro 0.

**As saídas, da preferida à última** (todas com a arte como arquivo e o código só trocando o quadro):

1. **O desenho da seção 4.3**: o quadro 0 no HTML, com o tamanho em CSS e a brasa do PNG de 3,9 KB em `preload`; nenhum JavaScript
   da arte no celular; o laço só a partir de 1024 px. É o padrão do plano.
2. **Cortar o que pesa sem mexer na arte**: desligar o `inlineCss` se o CSS novo passar de uns 8 KB comprimidos (com o CSS em arquivo,
   ele deixa de ir três vezes no documento; refazer a medida das duas formas, como a etapa 9 fez); a fita com menos papéis no HTML; a
   Inter fora (a Geist variável, um arquivo de 29 KB, para tudo).
3. **O celular sem a brasa**: abaixo de 1024 px o quadro 0 só em texto, em `cinza-1`, sem o PNG (nenhuma imagem no caminho crítico).
   A brasa não pode acender depois do `load` no celular: a imagem que chega tarde vira candidata nova ao LCP (seção 4.3).
4. **Um recorte próprio para o celular**: `escadaria-celular.json`, só a região do touro (umas 90 × 70 células), pelo `ascii-arte.py`
   com outro `filtro`. Pede trazer o gerador ou rodá-lo numa cópia fora do repositório.
5. **Sem arte abaixo de 640 px**: o hero do celular fica com a pílula, o título, o texto, os botões e a fita.

## 5. Impacto nos testes

### 5.1 E2e que mudam

Os números de linha são de 04/11/2026, com a T1 ainda editando `arena.spec.ts`, `data.ts`, `quotes.spec.ts`, `public-api.spec.ts` e
`components.spec.tsx`: quem pegar a tabela procura pelo texto citado. `getByRole` não acha elemento escondido (o `popover` fechado é
`display: none`), então até um `toHaveAttribute` num link do menu precisa do menu aberto.

| Spec | O que depende | O que muda | Motivo | Quem |
|---|---|---|---|---|
| `home.spec.ts:10` | h1 "Alvesting" | h1 "Modelos de linguagem investindo na B3" | o título do hero | (a) |
| `smoke.spec.ts:34, 45` (o portão pós-deploy) | h1 "Alvesting" | o título novo; o teste da região "Cotações e macro" (`dt` BOVA11, linha 61) fica; teste novo: a legenda e a fita na home, sem depender de dado | o título; a rota interna nova | (a) |
| `arena.spec.ts:126, 959` | h1 "Alvesting" | o título novo | o título | (a) na fase 1, depois (b) |
| `arena.spec.ts:951, 956` | clica em "Ranking" e "Início" na navegação "Principal" | abre o menu antes, abaixo de 1024 px (o ajudante de `e2e/menu.ts`) | a navegação vira `popover` | (a) na fase 1, depois (b) |
| `fixture.spec.ts:20` | h1 "Alvesting" com a api falsa | o título novo (a linha 273, o link "Alvesting" no cabeçalho, fica: a marca é SVG `aria-hidden` mais o texto) | o título | (a) |
| `layout.spec.ts`, "a navegação principal lista as telas" | os 7 links visíveis em toda largura | abre o menu antes, no pixel-7 e no iphone-15 (no desktop a cápsula aparece) | o `popover` | (a) |
| `layout.spec.ts`, "em 360 px o menu cabe em no máximo duas linhas" | as linhas do menu | passa a: o botão "Menu" tem 44 × 44, abre a folha e o Esc a fecha; aberta, os 7 links têm 44 px de altura e ficam dentro dos 360 px (a regra das duas linhas some: a folha é uma lista) | o `popover` | (a) |
| `layout.spec.ts`, o laço de `ROUTES` | rolagem, 44 px, console, axe, rodapé | nada no teste; o risco está na tela (seção 5.3): o `public/` servido pelo `pnpm start` (sem ele, a arte dá 404 e o teste de console reprova), a fita, a moldura, o contraste | | (a) e (b) |
| `carteira-layout.spec.ts:154 a 168` | ≥ 7 links no `banner` e o menu em ≤ 2 linhas | abre o menu; confere os 7 links | o `popover` | (a) na fase 1, depois (c) |
| `conta-layout.spec.ts:198` e `carteira-layout.spec.ts:234` | o link "Conta" ou "Carteira" no `banner` | abre o menu antes | idem | (a) na fase 1, depois (c) |
| `conta.spec.ts:72` e `carteira.spec.ts:165` | clica em "Conta" ou "Carteira" no `banner` | abre o menu antes | idem | (a) na fase 1, depois (c) |
| `conta.spec.ts:724` | a caixa marcada pinta `rgb(0, 0, 0)` com `✕` | `rgb(245, 245, 245)` (`ink`) com `✕` | o tema escuro; a regra (não depende da cor: o `✕` é texto) fica | (a) |
| `carteira.spec.ts:1025, 1026` | o radio marcado `rgb(0, 0, 0)`; o vazio `rgb(242, 239, 230)` | marcado `rgb(245, 245, 245)` com `●`; vazio `rgb(0, 0, 0)`; os dois redondos | idem | (a) |
| `carteira.spec.ts:1138, 1139` | o foco com `outline` sólido de 2 px | nada (o contorno muda de cor, não de forma) | | |
| `arena.spec.ts` (o resto), `quotes.spec.ts`, `public-api.spec.ts`, `revalidate.spec.ts`, `origin-lock.spec.ts`, `admin.spec.ts`, `account-api.spec.ts` | regiões, `dt` e `dd`, tabelas, `data-*`, textos | nada, se o contrato de DOM ficar (resumo) | | (b) e (c) rodam |

`useInnerText` lê o texto **depois** do `text-transform`: os elementos que o e2e lê assim (a linha de baixo do cartão de decisão, os
itens) não podem ganhar `uppercase` nem `capitalize`.

### 5.2 Testes unitários que mudam

| Spec | O que depende | O que muda | Quem |
|---|---|---|---|
| `components/site-chrome.spec.tsx` | a lista dos 8 links (a marca e os 7), `<nav aria-label="Principal">` literal, 8 `class="link` | a lista fica igual ("Carteira" vira a pílula e "Conta" a ação quieta, dentro da mesma `nav` e na mesma ordem); muda o `<nav …>` literal (ganha `id` e `popover`) e a contagem de `class="link` (os itens da cápsula usam `capsule-item`); "não lê a sessão" fica | (a) |
| `components/components.spec.tsx:91, 206, 212` | classes literais (`space-y-3` da lista de notícias, `min-w-0 basis-full text-sm` do resumo, `font-mono text-base font-semibold` do título do cartão) | as classes novas (o resto do arquivo, que confere texto e atributos, fica) | (a) na fase 1, depois (b) |
| `lib/with-api-down.spec.tsx:30` | `<a href="" class="btn">Tentar de novo</a>` | `class="btn btn-primary"` | (a) |
| `components/admin-forms.spec.tsx:93, 98` | `<span class="min-w-0 pt-2.5">` da caixa de confirmação (vem do `CheckField` do `form-kit.tsx`) | a classe nova, se o `CheckField` mudar | (a) na fase 1, depois (c) |
| `components/wallet-lots.spec.tsx:83` | a classe da `legend` | a nova; as linhas 70 (`uppercase` no campo do ticker: é função, fica) e 93 (`class="radio"`: fica) não mudam | (c) |
| `account-forms.spec.tsx`, `wallet-panels.spec.tsx`, `legal-text.spec.tsx`, `app/*/page.spec.tsx` | `sr-only`, `role="status"`, textos e links | nada, se o markup ficar | (c) |
| `lib/*.spec.ts` (formatação, gráfico, api, cotações) | lógica | nada; o `quotes.spec.ts` ganha a rota da fita (a `a0`) | (a) |

### 5.3 Os riscos e como medir cada um

| Risco | O quê | Como medir |
|---|---|---|
| Contraste (axe, AA) | sobre o `canvas` (calculado pela fórmula da WCAG): `ink` 19,3:1, `body` 8,3:1, `muted` 6,1:1, `primary` 11,5:1, `data-up` 10,5:1, `data-down` 6,4:1, as cinco séries de 5,3 a 6,7:1; mas `muted-soft` 3,1:1 e `data-benchmark` 3,7:1 reprovam em texto (só linha e decoração), e `muted` sobre `surface-strong` fica em 4,9:1 (passa, raspando): o texto da cápsula é `body` (6,8:1 ali). O `placeholder` em `muted`. Texto sobre a arte: o axe dá "incomplete", e a regra de desenho já proíbe | os testes de axe que existem: `layout.spec.ts` (sério e crítico na largura do aparelho; qualquer impacto em 360 px) e os de `conta-layout`, `carteira-layout` e `admin-layout`. Cobrem todas as telas, inclusive a home em 1280 (desktop) |
| Link dentro de texto | sem sublinhado, o axe acusa `link-in-text-block` (sério) | os mesmos testes |
| Alvo de toque (44 px) | a pílula do anúncio do Arc tem 32 px, os itens da cápsula 32, as ações do cabeçalho 36 e o botão do menu 40; o plano §13 pede 44 em todo link e botão, em toda largura. Saída: a caixa do link tem 44 px e a pílula visível fica dentro dela, transparente em volta (o `getBoundingClientRect` mede a caixa); as linhas da folha do menu têm 52 px, como no Arc | o teste de 43,95 px dos quatro specs de layout, em 360 px; a cápsula só aparece a partir de 1024 px, onde nenhum teste mede: (a) acrescenta a medida dos links do cabeçalho em 1280 px ao `layout.spec.ts` |
| 360 px | a moldura (as laterais e os losangos só a partir de 1202 px; a `Rule` com 100vw dentro do `overflow-x: clip`); a fita (o trilho `w-max` dentro de caixa `overflow: hidden`); a arte (absoluta, com o hospedeiro `overflow: hidden`); o cabeçalho (com a `nav` fechada, só a marca, ~105 px, e o botão "Menu", 44 px); a folha aberta (lista vertical na largura da tela) | o laço de `ROUTES` do `layout.spec.ts` (`scrollWidth` e `body.scrollWidth` ≤ `clientWidth`, os links do `banner` dentro de 360) e os specs de layout da conta; e, à mão, a moldura em 1201, 1202 e 1441 px (o losango centrado nas duas linhas) |
| `prefers-reduced-motion` | a regra global do `tokens.css` (animação e transição a 0,001 ms); a arte parada no quadro 0, sem buscar o JSON; a fita parada; o `:active` sem escala | e2e novo com `page.emulateMedia({ reducedMotion: 'reduce' })`: nenhum pedido a `escadaria.json`, o texto do `<pre>` igual depois de 1 s, a fita com `animationName` efetivamente sem movimento |
| LCP, CLS e TBT | seção 4.6 | seção 4.6 |
| Arquivos de `public/` no e2e e no Lighthouse | o `pnpm start` copia só o `.next/static` para o standalone; sem copiar o `public/`, a arte dá 404 | trocar o `start` do `apps/web/package.json` para copiar também o `public/` (o `Dockerfile` já copia, linha 40); o teste de console do `layout.spec.ts` pega a falta |
| Glifo de direção nas células | um `▲` no texto quebraria as comparações por igualdade (`arena.spec.ts`) | o glifo por `::before` com texto alternativo vazio; o e2e não muda |

### 5.4 Testes novos

- `e2e/hero.spec.ts` (a): o h1, a pílula e os dois botões com os endereços; sem JavaScript (`javaScriptEnabled: false`), o `<pre>` da
  arte já tem o texto do quadro 0; em 390 px, nenhum pedido a `escadaria.json` nem a `escadaria.png`; em 1440 px, o texto do `<pre>`
  muda em 1 s; com `reducedMotion: 'reduce'`, não muda e o JSON não é pedido; a legenda tem "Cotações: brapi.dev".
- `e2e/menu.ts` (a): o ajudante `abrirMenu(page)`, que clica em "Menu" quando o botão está visível, usado por todo spec que navega
  pelo cabeçalho.
- `src/lib/ascii.spec.ts` (a): o porte do `ascii.test.mjs` da v1.
- `src/lib/fita.spec.ts` (a): o texto da fita (ticker, fechamento, glifo e sinal; a lista vazia).
- `src/components/hero.spec.tsx` (a): a pílula e os botões em cada estado (com ciclo, sem ciclo, sem temporada, encerrada).

## 6. Divisão do trabalho

**Ordem.** A T1 está mexendo em `apps/api`, em `apps/web/src` (`ui.tsx`, `tables.tsx`, `decisions.tsx`, `page.tsx` e as páginas de
modelo, ciclo e ação) e nos specs que citam os nomes fake. **(a) começa depois do `worker_done` da T1** e trabalha sozinha (fase 1).
Quando (a) termina, (b) e (c) rodam em paralelo (fase 2), cada uma dona só dos seus arquivos. No fim, (a) faz o fechamento (fase 3).
Arquivo de outra dona: pergunta ao coordenador pelo `ask`.

**(a) Fundação e home** (fase 1; e fase 3, o fechamento)

- Compartilhados: `apps/web/src/app/globals.css`, `app/layout.tsx`, `app/icon.svg`, `components/site-chrome.tsx` e
  `site-chrome.spec.tsx`, `components/ui.tsx`, `components/tables.tsx`, `components/api-down.tsx`, `lib/with-api-down.tsx` e
  `with-api-down.spec.tsx`, `apps/web/package.json` (o `start` que copia o `public/`).
- Só da fase 1 (passam para (b) ou (c) na fase 2): `components/charts.tsx`, `components/decisions.tsx`, `components/countdown.tsx` e
  `components/components.spec.tsx` (para (b)); `components/form-kit.tsx` (para (c)).
- Novos: `components/hero.tsx` e `hero.spec.tsx`, `components/arte.tsx`, `components/arte-viva.tsx`, `components/fita.tsx`,
  `lib/fita.ts` e `fita.spec.ts`, `lib/ascii.ts` e `ascii.spec.ts`, `src/arte/escadaria-q0.json`, e em `public/ascii/arte/` o
  `escadaria.json`, o `escadaria.png` e o `escadaria-q0.png`.
- A home: `app/page.tsx`.
- A `a0`: os arquivos da seção 4.4 (ou outro worker, em paralelo com (a) e dono só deles).
- E2e (fase 1): `home.spec.ts`, `smoke.spec.ts`, `layout.spec.ts`, `fixture.spec.ts`, `data.ts`, `menu.ts` (novo), `hero.spec.ts`
  (novo), e as linhas da tabela 5.1 em `arena.spec.ts`, `conta.spec.ts`, `conta-layout.spec.ts`, `carteira.spec.ts`,
  `carteira-layout.spec.ts`; e as unitárias da tabela 5.2 marcadas (a).
- Docs: o ADR 0034, `docs/TELAS.md`, `docs/PLANO.md`, `docs/DEPENDENCIAS.md`, `CLAUDE.md`, `docs/API.md` (seção 6, a `a0`) e, se o
  Artur aprovar, `.claude/skills/ascii-ui/` (seção 7).
- Fechamento (fase 3): apagar os apelidos de token; reler as telas de (b) e (c) contra o `TELAS.md`; `pnpm check`, `pnpm test:e2e`,
  `pnpm lighthouse`; as capturas do depois em `docs/redesign-ascii/depois/` (as mesmas telas e larguras do antes).

**(b) Telas da arena** (fase 2)

- `app/ranking/page.tsx`, `app/modelos/[slug]/page.tsx`, `app/ciclos/[data]/page.tsx`, `app/noticias/page.tsx`,
  `app/acoes/page.tsx`, `app/acoes/[ticker]/page.tsx`, `app/como-funciona/page.tsx`, `app/not-found.tsx`, `app/error.tsx`.
- `components/news-list.tsx`, e os que recebe de (a): `charts.tsx`, `decisions.tsx`, `countdown.tsx`, `components.spec.tsx`.
- `src/arte/urso-q0.json`, e em `public/ascii/arte/` o `urso.json`, o `urso.png` e o `urso-q0.png`.
- E2e: `arena.spec.ts`, `layout.spec.ts`, `quotes.spec.ts`, `fixture.spec.ts`, `fixture-api.ts`, `public-api.spec.ts`,
  `revalidate.spec.ts`, `origin-lock.spec.ts`.
- Docs: só o relatório; o que muda no `TELAS.md` vai no relatório para (a) escrever no fechamento.

**(c) Telas da conta** (fase 2)

- `app/entrar`, `app/cadastro`, `app/verificar-email`, `app/esqueci-senha`, `app/redefinir-senha`, `app/conta`, `app/carteira`,
  `app/admin`, `app/termos` e `app/privacidade` (cada `page.tsx` e o `page.spec.tsx`, quando houver).
- `components/account-forms.tsx` e o spec, `components/admin-forms.tsx` e o spec, `components/admin-panels.tsx`,
  `components/wallet-lots.tsx` e o spec, `components/wallet-panels.tsx` e o spec, `components/legal-document.tsx`,
  `components/legal-text.tsx` e o spec, e o que recebe de (a): `components/form-kit.tsx`.
- E2e: `conta.spec.ts`, `conta-layout.spec.ts`, `carteira.spec.ts`, `carteira-layout.spec.ts`, `admin.spec.ts`,
  `admin-layout.spec.ts`, `account-api.spec.ts`, `account-support.ts`, `admin-support.ts`, `carteira-support.ts`.
- Docs: `docs/CONTA.md` (seção 9; a linha 206 cita a "estética crua") e o relatório.

Ficam com (a) e congelados na fase 2 (mudança só pelo `ask`): `globals.css`, `layout.tsx`, `site-chrome.tsx`, `ui.tsx`,
`tables.tsx` (que a carteira também usa) e `api-down.tsx`. Os specs que (a) mexe na fase 1 só para a troca do cabeçalho e do título
(tabela 5.1) passam, na fase 2, para a dona da tela que eles cobrem, como nas listas acima.

**O aceite de cada dona** (as regras comuns da onda valem): `pnpm check` com exit 0; `pnpm test:e2e -- --workers=3` verde nos três
projetos; sem rolagem horizontal em 360 px, alvos de 44 px e axe sem violação nas telas dela; capturas do depois em 390 × 844 e 1440
× 900 das telas dela em `docs/redesign-ascii/depois/`; o relatório em `docs/redesign-ascii/relatorios/<tarefa>.md`, com cada teste
que mudou de expectativa e o motivo. Para (a), também `pnpm lighthouse` dentro das metas, com o elemento do LCP e o peso das fontes
no relatório.

## 7. Documentação

- **ADR 0034** (`docs/adr/0034-volta-ao-design-ascii-ui-da-v1.md`): Status aceita, Data 04/11/2026, Origem: o pedido do Artur e o
  `docs/PLANO.md`, §17, item 7 ("estética crua do Alpha Arena (recomendo) ou ascii-ui da v1"). Contexto: a estética crua e o porquê
  da troca. Decisão: o visual da v1 com o código da v2 (a seção "Resumo" deste plano). Consequências: as fontes e o orçamento do LCP;
  o Arc como referência (MIT) e nenhuma dependência nova; a arte como arquivo, com a cadeia de procedência e a pendência dos termos do
  Higgsfield; o menu em `popover`; os testes que mudaram e por quê; o que a v1 tinha e fica de fora.
- **`docs/TELAS.md`**: a seção 3 perde o "Estética crua" (linha 41) e o contraste do papel (linha 39) e ganha uma seção nova, "Sistema
  visual (ascii-ui)", com as regras deste plano que valem para toda tela (cores e o papel de cada uma, tipo, moldura, arte, ASCII do
  dado, alvos de 44 px com a pílula por dentro, menu); a seção 1 (a home e a fita); a seção 2 (o JavaScript além do Next: a contagem,
  a `arte-viva` e o botão de erro; o menu sem JavaScript); a seção 4 (a fita e o crédito na legenda); a seção 5 (as fontes novas e as
  medidas do Lighthouse com o hero); a seção 6 (os testes novos); as seções 8 e 9 (a "mesma estética crua" da linha 107).
- **`docs/PLANO.md`**: o §17, item 7, registra a decisão (ascii-ui, 04/11/2026, ADR 0034); a tabela de bibliotecas (linha 650: IBM
  Plex vira Geist e Inter); a etapa 9 (linha 728) cita a estética crua: nota de que o visual mudou.
- **`docs/DEPENDENCIAS.md`**: as linhas da seção 1.5 (as fontes no lugar das IBM Plex, o Google Fonts, o Higgsfield, o Arc) e uma
  linha por arte da seção 2.
- **`CLAUDE.md`**: na convenção "Telas", uma frase sobre o sistema visual (os tokens no `globals.css`; a arte é arquivo e o código só
  troca o quadro; nada de `motion` nem de componente de cliente para a casca; a pílula visual dentro da caixa de 44 px) apontando para
  o `TELAS.md`; na convenção da API pública, a segunda rota interna (`GET /api/v1/interno/fita`), se a `a0` entrar.
- **`docs/CONTA.md`** (c): a linha 206.
- **`DESIGN.md` e a skill `ascii-ui`.** O `DESIGN.md` da v1 não vem como está: descreve rotas, componentes do Arc, o dither-kit e
  peças que a v2 não tem, e seria uma segunda fonte de token para conferir. O que dele vale para a v2 vai para a seção nova do
  `TELAS.md`. A skill **vale trazer adaptada** para `.claude/skills/ascii-ui/` (a v2 ainda não versiona `.claude/`): o `SKILL.md` (o
  fluxo e as decisões, apontando para o `TELAS.md` e o `globals.css`), e de `references/` o `arte.md`, o `checklist.md` (adaptado: sem
  `pnpm --filter @alvesting/config check` nem `shadcn add`) e o `waerk.md` só com o texto, **sem as imagens** (`waerk-quadro.jpg` e
  `waerk-brasa.jpg` são quadros do vídeo de terceiro; a prévia `alvesting-escadaria-1x1.jpg` é nossa, mas não faz falta) e sem
  `x-2026-10.md`, `x-2026-10/`, `catalogo-padroes.md` e `tokens-13px.md`, que descrevem posts e telas de terceiros. Serve à próxima
  tela no estilo (o chat da etapa 13). Decisão do Artur (seção 8).

## 8. Pendências e decisões para o Artur

1. **Os termos da API do Higgsfield**: conferir a versão vigente (a v1 deixou "conferir antes de publicar") antes do merge de (a). Sem
   isso, o hero vai sem a arte (seção 2).
2. **A JetBrains Mono**: fora (recomendado, seção 1.2) ou só nos hashes fora da home, sem preload.
3. **A rota interna da fita (`a0`)**: sim (recomendado, seção 4.4; pede uma migration que dá `SELECT` nas duas tabelas do universo
   ao login da api) ou a fita do BOVA11 e do macro.
4. **O menu em `popover`** abaixo de 1024 px (recomendado) ou os links em duas linhas, como hoje (o cabeçalho do celular fica com uns
   160 px e a arte sai da primeira dobra).
5. **As peças de cabeçalho** (moeda, ampulheta, envelope, sino): fora desta onda (recomendado) ou já com os motivos reescritos.
6. **O logo dos laboratórios**: fora enquanto os modelos forem simulados (recomendado).
7. **A skill `ascii-ui` no repositório**, adaptada e sem imagens de terceiros: sim (recomendado) ou não.

## Apêndice A. Como derivar os arquivos do quadro 0

Rodados no estudo contra os arquivos da v1 (o PNG de saída foi conferido: 400 × 120, paleta de 8 bits, 3.856 B; o do urso, 400 × 85,
4.816 B). O script também está em `.data/orquestracao/estudo/q0.mjs`, fora do git; (a) registra o comando no DEPENDENCIAS.md junto da
linha da arte.

```sh
V1=<caminho do worktree da v1>/apps/web/public/ascii/arte
# o quadro 0 no formato v2, com o sprite do recorte
node -e "const fs=require('fs');const a=JSON.parse(fs.readFileSync(process.argv[1]));fs.writeFileSync(process.argv[2],JSON.stringify({v:a.v,cols:a.cols,rows:a.rows,fps:a.fps,sprite:process.argv[3],frames:[a.frames[0]]}))" "$V1/escadaria.json" apps/web/src/arte/escadaria-q0.json escadaria-q0.png
# as primeiras 120 linhas do sprite (as 85 do urso), em paleta
node .data/orquestracao/estudo/q0.mjs "$V1/escadaria.png" apps/web/public/ascii/arte/escadaria-q0.png 120
```

```js
// q0.mjs: recorta as primeiras `rows` linhas de um PNG de paleta de 8 bits, mantendo o PLTE e o tRNS. Cada linha do PNG começa com o
// byte do filtro, e o filtro só olha a linha de cima: as primeiras linhas do IDAT descomprimido valem como estão.
import { readFileSync, writeFileSync } from 'node:fs';
import zlib from 'node:zlib';
const [src, dst, rowsArg] = process.argv.slice(2);
const buf = readFileSync(src);
let off = 8, ihdr, plte, trns; const idat = [];
while (off < buf.length) {
  const len = buf.readUInt32BE(off), type = buf.toString('latin1', off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
  if (type === 'IHDR') ihdr = Buffer.from(data); else if (type === 'PLTE') plte = data; else if (type === 'tRNS') trns = data; else if (type === 'IDAT') idat.push(data);
  off += 12 + len;
}
const width = ihdr.readUInt32BE(0), depth = ihdr[8], color = ihdr[9];
if (depth !== 8 || color !== 3) throw new Error(`esperava paleta de 8 bits, veio depth ${depth} color ${color}`);
const rows = Number(rowsArg);
const raw = zlib.inflateSync(Buffer.concat(idat)).subarray(0, rows * (1 + width));
ihdr.writeUInt32BE(rows, 4);
const chunk = (type, data) => { const t = Buffer.from(type, 'latin1'); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
const out = Buffer.concat([buf.subarray(0, 8), chunk('IHDR', ihdr), chunk('PLTE', plte), ...(trns ? [chunk('tRNS', trns)] : []), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
writeFileSync(dst, out);
```
