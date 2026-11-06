# Revisão de código da onda "design premium" (T3a)

Tarefa `task_a139effd635c` (dispatch `ctx_48f65fbcc642`), 05/11/2026. Revisão **só de leitura** de tudo o que a onda mudou no working tree
(T0, T0b, T1a, T1b, T2a e T2b), para a tarefa de fechamento consertar. Nada foi editado no repositório além deste relatório; sem commit,
`git add`, build, e2e nem Lighthouse.

**Como foi feita.** Li os relatórios das seis tarefas, o CLAUDE.md, o `docs/PRODUCT.md`, o `docs/DESIGN.md` e os ADR 0033, 0035, 0036 e 0037,
e depois o `git diff` e os arquivos novos inteiros. A T1a (as telas da arena) e a T2a (o Explorar e o terminal) foram lidas também por duas
revisões paralelas, só de leitura; **cada achado delas foi conferido de novo no código** antes de entrar aqui. A T2b foi revista por último,
depois de ela soltar a trava, e as linhas citadas são as do working tree no fim desta revisão.

**Fora do alvo.** O working tree também guarda o trabalho de duas tarefas da onda anterior que ainda não foi para o índice
(`docs/redesign-rallies/relatorios/logos-api.md`: a api dos logos, o contrato `internal.ts` e o `infra/tests/check.mjs`; e
`linhas-barras.md`: a moldura de 1.550 px, as barras de rolagem e o "›" da faixa). Não revi esse trabalho, só o que a onda premium mudou por
cima dele.

## Resumo

| Gravidade | Quantos |
|---|---|
| Bloqueia | **0** |
| Importante | **6** |
| Menor | **19** |

Nenhum achado fere a regra das cotações (ADR 0033), a segurança, a LGPD ou um dos temas. Os seis importantes são erros reais com cenário:
dois da carteira (a rosca com seis ações e o aviso que para de sumir), três dos gráficos (o tamanho de fonte do navegador desalinha o eixo, o
gráfico de posições abre nos pregões antigos, a legenda que apaga as linhas) e um teste com corrida (`tema.spec.ts:75`). Os menores são
documentação desatualizada, código e CSS sem uso, cor fora dos tokens, buracos de teste e dois detalhes do terminal e do Explorar que a T2a
apontou (M18 e M19). A decisão que a T2b deixou para a revisão (o radio de lançar) tem resposta numa seção própria, no fim.

## Importantes

### I1. A rosca da carteira com exatamente seis ações: a sexta fatia não aparece

- **Onde:** `apps/web/src/lib/wallet-client.ts:212`, `:222` e `:228`; `apps/web/src/app/globals.css:1283-1290`. Da T2b.
- **Cenário:** a pessoa tem seis posições com cotação. `FATIAS = 6` deixa as seis como fatias próprias, e a sexta recebe
  `cor: var(--fatia-6)`. O `globals.css` só define `--fatia-1` a `--fatia-5` e `--fatia-outras`. Com a variável indefinida, o `stroke` da
  fatia (o `style` do `motion.path` em `beui/donut-chart.tsx:230`) cai no valor herdado, `none`: a menor fatia some do anel, deixa um buraco, e
  a barra dela na legenda fica vazia (`backgroundColor` transparente). Com sete ou mais ações não acontece, porque entra o "Outras".
- **Evidência:** `const own = priced.length > FATIAS ? priced.slice(0, FATIAS - 1) : priced;` e `` cor: `var(--fatia-${i + 1})` ``; no CSS,
  `.rosca { --fatia-1 … --fatia-5; --fatia-outras }`. O teste `wallet-client.spec.ts:353` ("seis ações cabem uma a uma") confere só os ids,
  não a cor.
- **Conserto:** acrescentar `--fatia-6` na `.rosca` (um tom da escala que ainda não está nela, com o par do escuro), ou ficar com cinco
  fatias mais "Outras" a partir da sexta ação; e conferir a `cor` no teste das seis.

### I2. O aviso (toast) fechado pelo mouse ou pelo arraste prende a pilha: os avisos seguintes não somem mais sozinhos

- **Onde:** `apps/web/src/components/beui/animated-toast-stack.tsx:176-181` (o `close`), `:205-209` (o arraste e o `onPointerEnter`/
  `onPointerLeave`) e `:75-84` (o `hold`). Da T2b.
- **Cenário:** na carteira, no desktop, a pessoa lança uma compra, o aviso chega, ela passa o ponteiro nele e clica em "Fechar aviso" (ou o
  arrasta para o lado). O `pointerenter` pôs o motivo `hover` no conjunto que segura o prazo; o aviso sai do DOM com o ponteiro em cima, o
  `pointerleave` nunca chega, e o `close` só solta o motivo `focus`. O conjunto fica com `hover`, `held` fica verdadeiro, e o efeito do prazo
  (`if (held) return;`) não arma timer nenhum. O próximo aviso (editar, apagar) fica na tela até alguém fechá-lo ou passar o ponteiro por ele
  e sair. No Safari o clique nem foca o botão, então nem o `focus` é solto por ali.
- **Evidência:** `const close = (keyboard) => { … onDismiss(toast.id); if (hadFocus) onHold?.('focus', false); … }`; nenhum caminho solta o
  `hover` quando o item sai.
- **Conserto:** soltar o `hover` no `close` (e no fim do arraste), ou no desmontar do item que o tinha posto; e um teste de unidade do
  gancho (fechar com o motivo `hover` ativo e conferir que o aviso seguinte some no prazo).

### I3. Com outra fonte padrão no navegador, o eixo de preços das velas e o fim das linhas do patrimônio saem do lugar

- **Onde:** `apps/web/src/components/velas.tsx:128` (a caixa `h-70`) com `:211` e `:218` (`style={{ top: tick.y }}` e
  `top: layout.ultimo.y`), da T2a; `apps/web/src/components/beui/line-chart.tsx:217` (`h-70`) com `:310` e `:326` (`animate={{ y: … }}` em
  px), da T1a. O `bump-chart.tsx:109` usa `style={{ height }}` em px e não tem o problema.
- **Cenário:** quem usa a fonte "Grande" do Chrome (20 px) ou outra fonte padrão no Firefox: o `h-70` do Tailwind 4 é `17.5rem`, e a caixa
  vai a 350 px; o SVG estica junto (`preserveAspectRatio="none"`), mas os marcos do eixo, a etiqueta do último fechamento e os pontos e
  pílulas do fim das linhas continuam nas posições em px da escala de 280. Cada marco fica até uns 70 px acima da linha da grade dele, a
  etiqueta sai da linha tracejada do último preço, e o ponto do fim da linha fica longe do fim do traço. Quem lê o eixo tira o preço errado.
  O zoom do navegador não causa isso (ele escala px e rem juntos); só a fonte padrão.
- **Evidência:** `<div className="relative h-70 …">` nos dois arquivos; a escala vem de `ALTURA_VELAS = 280` e `VIEW = { …, height: 280 }`.
- **Conserto:** a altura da caixa em px, a mesma da escala (`style={{ height: ALTURA_VELAS }}` e `style={{ height: VIEW.height }}`), ou as
  posições em % da altura.

### I4. O gráfico de posições do ranking abre nos pregões mais antigos, e o nome da região diz o contrário

- **Onde:** `apps/web/src/components/beui/bump-chart.tsx:101-108` (o rótulo em `:103`). Da T1a.
- **Cenário:** a Temporada 1 tem 20 pregões (`seasons/temporada-1.rascunho.json`); o desenho pede `minWidth` de n × 40 px mais as calhas,
  uns 930 px. No Pixel 7 (412 px) a caixa abre no começo da rolagem: a posição de hoje e os nomes no fim das linhas ficam uns 560 px à
  direita, fora de vista; em 1280 px faltam uns 180 px. O nome da região, "role para os pregões mais antigos", diz que a vista começa nos
  recentes. O e2e roda com 5 pregões e não pega.
- **Evidência:** `` aria-label={`${label}: role para os pregões mais antigos`} `` e `` style={{ minWidth: `${Math.max(0, n * 40)}px` }} ``,
  sem nada que leve a rolagem ao fim; as datas vêm em ordem crescente.
- **Conserto:** abrir pelo fim só com CSS (`dir="rtl"` na caixa que rola e `dir="ltr"` no conteúdo) e um teste com mais pregões do que a
  largura comporta.

### I5. Esconder uma série pela legenda do gráfico do patrimônio deixa todas as outras apagadas

- **Onde:** `apps/web/src/components/beui/line-chart.tsx:294` (o `apagada`), com `:186-189` (o `toggle`) e `:489-492` (o realce da
  legenda). Da T1a.
- **Cenário:** o foco ou o ponteiro no botão "GPT-6.1 Sol" da legenda põe a série em `hovered`; o clique a esconde, mas não limpa o
  `hovered`. Daí `apagada = hovered !== null && hovered !== l.key` vale para todas as linhas à vista, que ficam a 25% de opacidade. Pelo
  teclado dura até o Tab sair do botão; no Pixel 7 o toque foca o botão e dura até tocar fora; no mouse, até o ponteiro sair.
- **Evidência:** `onFocus={() => !l.oculta && setHovered(l.key)}`, avaliado antes do clique, e `apagada={hovered !== null && hovered !== l.key}`.
- **Conserto:** limpar o `hovered` no `toggle` quando a série some, ou não apagar por uma série escondida
  (`hovered !== null && !hidden.includes(hovered) && hovered !== l.key`).

### I6. `e2e/tema.spec.ts:75` tem uma corrida: lê o tema na hora, antes de a troca acontecer

- **Onde:** `apps/web/e2e/tema.spec.ts:87-90`; a troca é assíncrona em `apps/web/src/components/beui/theme-selector.tsx:189-195`. Da T0
  (a T2a o viu falhar uma vez no e2e inteiro do desktop).
- **Cenário:** o sistema emulado está escuro e o `check()` em "Claro" é um clique (`pointerdown` dentro do `.tema`), então o script troca o
  tema por `document.startViewTransition(…)`, cujo callback (`swap('claro')`) roda num quadro seguinte. O teste chama `emulateMedia` duas vezes
  e faz `expect(await look(page))` sem esperar: se o callback ainda não rodou, ele vê `data-tema="sistema"` e reprova. Os outros passos do
  arquivo usam `expect.poll`; este não. O código do tema termina certo (a escolha guardada vence), o defeito é do teste.
- **Evidência:** a linha 90, `expect(await look(page)).toEqual(expected('claro', false));`, logo depois do `check()` da linha 87.
- **Conserto:** `await expect.poll(() => look(page)).toEqual(expected('claro', false))` logo depois do `check()`, e o mesmo no fim.

## Menores

### M1. Peças da Arc instaladas e sem uso, e o que veio junto com elas

- **Onde:** `apps/web/src/components/arc/segmented-control/` e `arc/skeleton/` (nenhuma tela as importa: só o `arc/arc.spec.tsx`);
  `arc/lib/motion-tokens.ts:9-35` (sem leitor: `duration.exit`, `ease.exit`, `ease.inOut`, `spring.responsive`, `spring.gentle`,
  `spring.snappy`, `stagger.char`, `stagger.word`, `stagger.line` e `blur.text`); o `export default` repetido ao lado do nome em
  `tooltip.tsx:169`, `skeleton.tsx:173` e `animated-counter.tsx:261`, e as props `label` e `animateOnView` do contador, que ninguém passa.
- **Cenário:** são 491 linhas (o `.tsx` e o `.module.css` das duas peças) que nenhuma tela usa depois das seis tarefas (a T1a, a T2a e a T2b
  disseram que não precisaram delas). O CLAUDE.md proíbe a "pasta para depois".
- **Conserto:** tirar as duas peças, o teste delas e as chaves sem leitor (e a linha "Instalada agora: sim" do ADR 0037 e as duas linhas do
  `docs/DEPENDENCIAS.md`), ou registrar no ADR que esperam a primeira tela.

### M2. O ADR 0037 e os docs do sistema não batem com o que foi feito

- **Onde:** `docs/adr/0037-bibliotecas-de-design.md:38-56` (a coluna "Instalada agora" ainda diz "não" para a sparkline, a linha, a rosca,
  as velas, o ranking no tempo, o toast e o select, e "sim" para o segmentado e o esqueleto, sem uso); `:48` (as velas justificadas pelo
  cursor com as quatro cotações, as setas e o volume, que a T2a tirou por causa do ADR 0033: hoje são só o desenho, de servidor, em
  `components/velas.tsx`, fora da pasta da beUI); `:52` (o toast "com movimento reduzido só esmaece"; o código troca na hora); `:58` ("três
  peças … ainda não têm tela": o tooltip e o contador têm). `docs/DESIGN.md:310` cita as pastas `arc` e `beui` e esquece a `reui`;
  `:368-369` dá "a leitura pelo teclado" a todos os gráficos (as velas e a sparkline não têm). `docs/TELAS.md:43` diz que cada gráfico traz "a
  tabela equivalente" (as velas não podem: a mesma página, `:59`, e o ADR 0033).
- **Cenário:** quem segue o ADR para a próxima tela instala o Candlestick de cliente com o cursor das quatro cotações, que o ADR 0033 veda.
- **Conserto:** uma frase em cada lugar; na linha das velas, "só o visual, de servidor, sem o código da peça (ADR 0033)".

### M3. A regra nova do "simulado" (uma vez por contexto) não chegou ao CLAUDE.md nem ao começo do TELAS.md

- **Onde:** `CLAUDE.md:31` ("O logo do laboratório é máscara … com o nome e a etiqueta "simulado" sempre ao lado"); `docs/TELAS.md:50` (o
  mesmo); `docs/adr/0035-design-do-rallies-ai-nos-dois-temas.md:69-70` (a decisão 5), que o ADR 0037 não lista entre o que "Muda".
- **Cenário:** a tarefa seguinte lê a regra do CLAUDE.md e põe a etiqueta em cada nome de novo, contra o `docs/DESIGN.md` e o
  `TELAS.md:305`.
- **Conserto:** trocar a frase do CLAUDE.md e da linha 50 pela regra nova e pôr a mudança na lista "Muda" do ADR 0037.

### M4. O `docs/DEPENDENCIAS.md` cita um `components.json` que não existe

- **Onde:** `docs/DEPENDENCIAS.md:274-275` ("o `components.json` fica só como o mapa dos registros").
- **Cenário:** não há `apps/web/components.json` (`ls` falha), e o ADR 0037 (`:157`) diz que ele ficou de fora.
- **Conserto:** tirar a frase.

### M5. O `pnpm docs:check` não vê os componentes copiados

- **Onde:** `scripts/docs-check.mjs:1-10` (confere só os pacotes dos `package.json`, as imagens Docker e as actions).
- **Cenário:** um arquivo novo copiado de registro em `components/arc`, `beui` ou `reui`, sem a linha em "Componentes copiados de registros"
  nem o `LICENSE` na pasta, passa no `docs:check`. Hoje as 15 linhas existem e batem com os arquivos (conferido); a falta é da trava.
- **Conserto:** o `docs-check.mjs` percorre as três pastas e exige o caminho de cada arquivo (fora os `.spec`) na coluna "Onde" da tabela e o
  `LICENSE` em cada pasta.

### M6. Nomes das bibliotecas e variantes de tema que nada lê, no CSS que a landing baixa

- **Onde:** `apps/web/src/app/globals.css:159-222` (o `:root` com os nomes do shadcn e da Arc); `:130-150` (o `@theme inline`); `:153`
  (o `@custom-variant dark`); e o `data-theme` que o script põe (`components/beui/theme-selector.tsx:110`).
- **Cenário:** nenhum arquivo do site lê `--card`, `--card-foreground`, `--popover`, `--popover-foreground`, `--primary`,
  `--primary-foreground`, `--secondary-foreground`, `--muted`, `--muted-foreground`, `--destructive`, `--border`, `--input`, `--ring`,
  `--radius`, `--surface`, `--surface-raised`, `--surface-muted`, `--text-secondary`, `--border-subtle`, `--border-strong`, `--accent`,
  `--accent-strong`, `--accent-subtle`, `--accent-foreground`, `--success`, `--warning`, `--danger`, `--info` nem `--duration-standard`
  (busca por `var(--nome)` em `src`, fora do próprio `globals.css`); nenhum utilitário do `@theme inline` é usado; não há nenhum `dark:` no
  código; e nenhuma peça lê `[data-theme]`. O `:root` vai inteiro no CSS único, que a landing baixa com a margem do LCP curta. O próprio
  comentário (`:156-158`) diz que entram "os que as peças copiadas leem".
- **Conserto:** deixar só os nomes que algum arquivo lê (e ajustar o `tokens.spec.ts`), ou dizer no ADR 0037 que eles ficam de propósito.

### M7. Cor fora dos tokens do `globals.css`

- **Onde:** `apps/web/src/components/logo-do-papel.tsx:19-20` (`bg-white` e
  `outline-[color:light-dark(rgb(0_0_0/0.1),rgb(255_255_255/0.1))]`), da T0b; `apps/web/src/components/reui/native-select.tsx:30`
  (`bg-[Canvas] text-[CanvasText]`, as cores do sistema), da T2b; `apps/web/src/components/beui/theme-selector.tsx:103-104` (`'#ffffff'` e
  `'#171717'` do `theme-color`), repetidos de `apps/web/src/app/layout.tsx:28-31`, da T0.
- **Cenário:** a Regra do Token (`docs/DESIGN.md`) e o CLAUDE.md põem toda cor no `@theme`. Se o canvas mudar, a barra do navegador fica na
  cor velha em três lugares (o layout, o script e os testes que comparam os literais); o círculo do logo e o contorno não seguem a paleta. As
  cores do sistema do `<option>` seguem o `color-scheme` e funcionam; ficam aqui só por estarem fora da regra.
- **Conserto:** tokens para o fundo e o contorno do logo (`--color-logo-fundo`, `--color-logo-contorno`); para o `theme-color`, um teste
  que compare os literais com o `--color-canvas` do `globals.css`.

### M8. Três desenhos para o mesmo "termo com explicação"

- **Onde:** `.dica` (`globals.css:1180-1182`; usada por `explorar/page.tsx:147` e `acoes/[ticker]/page.tsx:213`), da T2a; `.termo`
  (`globals.css:1306-1308`; `components/wallet-charts.tsx:41-49`), da T2b; e o rótulo do radio com explicação, em classes no
  `components/form-kit.tsx:424`, da T2b.
- **Cenário:** o mesmo gatilho do tooltip da Arc é um `<span tabIndex={0}>` sem papel, sem a caixa de 44 px e com o sublinhado no `control`
  (3:1) no Explorar, e um `<button>` de 44 px com o sublinhado no `hairline-strong` (cerca de 1,5:1, fraco como única pista) na carteira. O
  ADR 0037 pede uma peça por tipo.
- **Conserto:** uma peça só (o `Termo` com `<button>` é o mais correto), com o sublinhado no `control`.

### M9. As explicações do Explorar e do terminal só existem no balão, e o balão não abre no toque

- **Onde:** `apps/web/src/app/(app)/(explorar)/explorar/page.tsx:31-32` e `:145-150` (as regras do universo); `apps/web/src/app/(app)/(explorar)/acoes/[ticker]/page.tsx:44-45`
  e `:211-216` (o que é a confiança). Da T2a.
- **Cenário:** no celular o tooltip da Radix não abre pelo toque. As regras do universo (até 500 ações, 90% dos pregões, sem FII, ETF nem BDR,
  refeito no domingo) e a explicação da confiança ficam sem caminho para quem só toca. A T2b resolveu o mesmo caso pondo a frase também em
  texto na tela.
- **Conserto:** a frase também à vista (ou um link para a `docs/METODOLOGIA.md` no Como funciona).

### M10. O teste da regra das cotações só procura os fechamentos, e só em dois formatos

- **Onde:** `apps/web/e2e/quotes.spec.ts:261-290` (as chaves contra a `RAW_FIELD`, a `hidden`, a `written` e a `leaked`). Da T2a.
- **Cenário:** um componente de cliente que receba `data={bars.map((b) => ({ x: b.date, y: b.closeCents / 100 }))}` passa: a chave `y` não
  está na `RAW_FIELD` e "66.17", com ponto, não casa com "66,17" nem com "6617". A abertura, a máxima e a mínima do meio da série com chave
  curta (`o`, `h`, `l`) também passam, porque só os fechamentos são procurados.
- **Conserto:** procurar também os reais com ponto (`66.17`, e `66.1` para o zero final) e os valores de abertura, máxima e mínima.

### M11. O teste do movimento reduzido do gráfico do patrimônio não vê as molas da escala

- **Onde:** `apps/web/e2e/arena.spec.ts:955-1012`; a mola em `apps/web/src/components/beui/line-chart.tsx:115-125`. Da T1a.
- **Cenário:** o comentário do teste promete "sem a mola da escala", mas o `document.getAnimations()` só vê animações do CSS e da WAAPI; as
  molas do Motion sobre os `MotionValue` (o `animate(value, …)` que move o `d` das linhas) rodam em JavaScript. Se alguém tirar o
  `if (reduce) value.jump(target)`, a escala anda com movimento reduzido e o teste continua verde.
- **Conserto:** depois do clique na legenda, ler o `d` de uma linha à vista em dois quadros seguidos e exigir que sejam iguais.

### M12. No toque, a legenda do gráfico de posições deixa o realce depois de soltar a série

- **Onde:** `apps/web/src/components/beui/bump-chart.tsx:247-253`. Da T1a.
- **Cenário:** no Android o toque foca o botão do nome, e o `onFocus` põe o realce; tocar de novo tira o `pinned`, mas as outras linhas
  continuam a 25% até tocar fora. A legenda manda soltar com "o Esc", que o celular não tem.
- **Conserto:** o realce pelo foco só no teclado (`:focus-visible`) ou só com `hover: hover`; o toque fica com o `pinned`.

### M13. O aviso da arena simulada com o feed filtrado, numa temporada mista, fala de todos os modelos

- **Onde:** `apps/web/src/app/(app)/(arena)/arena/page.tsx:296-300`, com `components/ui.tsx:138-148` (`quemSimula`). Da T1a.
- **Cenário:** antes da primeira liquidação o elenco sai do feed, e o feed vem filtrado: em `/arena?modelo=<um simulado>`, numa temporada com
  modelos de verdade e simulados, o `quemSimula` recebe um nome só e responde "Os modelos ainda não estão conectados.", embora os outros
  estejam.
- **Conserto:** com o filtro, nomear os simulados (ou ler o elenco da temporada) em vez de concluir "todos".

### M14. Código e CSS sem uso ou repetidos

- `apps/web/src/components/ui.tsx:97-100`: o `CAIXA` ficou sem nenhum uso depois da T2b (fica o `CAIXA_ERRO`), e o comentário dele também.
- `apps/web/src/components/landing/laboratorios.tsx:25`: o `semVersao` faz o mesmo que o `partesDoNome` de `components/competidor.tsx:42` (o
  mesmo `\s+\(\d+\)$`); o `ponytail:` dele pede para sair quando houvesse o ajudante comum, e ele existe.
- `apps/web/src/components/beui/xy-path.ts:6`, `:48-63` e `:74`: o `curve` (`'linear'` e `'step'`) e o `XYCurve` exportado nunca são usados
  (as três chamadas usam o monótono).
- `apps/web/src/lib/chart.ts:19-23` e `:115-120`: o `MARGIN` padrão do `layoutEquity` e o comentário dele ("os rótulos dentro do SVG") só
  servem ao `chart.spec.ts`; o único chamador de produção passa a margem dele.
- `apps/web/src/components/velas.tsx:21` e `:32` (`ALTURA_VELAS` e `VelasLayout` exportados sem uso de fora), `:50` e `:113` (o
  `layoutVelas(bars, altura)` sempre com 280), `:126` (a classe `velas`, que nem o CSS nem os testes leem); `globals.css:1188` (`.painel-velas`
  repete o `.card` mudando só o respiro).
- `apps/web/src/components/arena/carteiras.tsx:39-40`: o `export { ratioBps }` só existe para o `carteiras.spec.tsx` importar dali.
- `apps/web/src/app/globals.css:654-659`: o seletor `.menu-acoes .pill` duas vezes seguidas (a T0 pôs o `mt-5` num bloco novo ao lado do
  `w-full`).
- **Conserto:** apagar ou juntar cada um.

### M15. Comentários e nomes de teste velhos

- O que saiu e ainda é citado: a Geist em `apps/web/src/app/globals.css:487` e em `components/ui.tsx:21`, `:29` e `:241`; a "pílula preta"
  em `globals.css:418`, `components/ui.tsx:240`, `components/error-page.tsx:9`, `app/(app)/(conta)/conta/page.tsx:148` e no nome do teste
  `components/hero.spec.tsx:72`; o filtro "mono" em `components/ui.tsx:240`; o link na primária em `globals.css:30` (o link é a tinta,
  `:46-48`); e os "rótulos dentro do SVG" em `lib/chart.ts:19-20`.
- `apps/web/src/components/beui/line-chart.tsx:647-649` diz que "pelo teclado e pelo dedo, troca na hora", mas `:383`
  (`contador={via !== 'teclado'}`) faz o contador rolar no toque. Um dos dois está errado.
- `docs/redesign-premium/relatorios/explorar.md:217` diz que a primária está "no item ativo do trilho"; ela não está
  (`globals.css:679-681`, `bg-surface-strong`); no trilho, a primária é a `.marca`.
- **Conserto:** reescrever cada um.

### M16. O aviso da exportação diz que o download começou mesmo quando a api recusa

- **Onde:** `apps/web/src/components/account-forms.tsx:370-381` (o `ExportLink`). Da T2b.
- **Cenário:** a sessão venceu noutra aba e a pessoa clica em "Baixar meus dados (JSON)": o aviso sai no clique, "Download dos seus dados
  começou: o arquivo … vai para a pasta de downloads", e a api responde 401 (o navegador mostra a falha do download, ou baixa o JSON do erro).
- **Conserto:** uma frase que não prometa o resultado ("Pedimos o arquivo ao servidor; ele aparece na pasta de downloads do navegador"), ou
  tirar o aviso desse link.

### M17. O `pnpm add` mudou mais do que as duas dependências no lockfile

- **Onde:** `pnpm-lock.yaml` (o `importers` do `apps/web` e as entradas do `next` e do `vitest`). Da T0.
- **Cenário:** além do `motion`, do `@radix-ui/react-tooltip` e das dependências deles, o `next@16.4.3` do site passou a resolver o par
  opcional `@opentelemetry/api@1.10.0` (a variante `next@16.4.3(…)(@opentelemetry/api@1.10.0)…`, que antes só a api usava), e o `vitest` e o
  `vite` também (`yaml@2.9.1`). O Next carrega o `@opentelemetry/api` de fora no lugar da cópia compilada dele, e o pacote passa a ir no
  standalone da imagem do site; a linha dele no `docs/DEPENDENCIAS.md` diz só `apps/api`. Sem efeito funcional visto (sem o SDK é tudo
  vazio), mas não é o que foi autorizado nem está no relatório da T0.
- **Conserto:** registrar no `DEPENDENCIAS.md` (o "Onde" do `@opentelemetry/api` com o site, como par opcional do Next) e conferir no
  `docker build` da imagem do site.

### M18. A etiqueta do último preço encosta no marco do eixo mais perto dela

- **Onde:** `apps/web/src/components/velas.tsx:26` (`PERTO_DA_ETIQUETA = 14`) e `:118-121` (o filtro dos marcos). Da T2a; apontado pelo
  coordenador na captura `docs/redesign-premium/explorar/acao-1440-claro.png`.
- **Cenário:** no MOVE3 do e2e o último fechamento é R$ 71,47 e o marco de R$ 70,00 fica uns 18 px abaixo dele: passa no filtro (18 ≥ 14) e
  aparece colado na etiqueta (na captura os dois se tocam). A etiqueta tem uns 20 px de altura (o texto de 11 px com 1,45 de entrelinha e o
  `py-0.5`) e o marco uns 16, centrados na mesma coluna: para não encostar, a distância entre os centros precisa ser de uns 20 px ou mais.
- **Conserto:** `PERTO_DA_ETIQUETA` de 20 (ou a soma das meias-alturas mais 2 px de folga), com um caso no teste do desenho.

### M19. A descrição do cartão do Explorar mostra o id interno da estratégia

- **Onde:** `apps/web/src/components/arena/explorar.tsx:108` (`` `Decisões simuladas, pela estratégia ${competitor.modelId …}.` ``). A frase é de
  antes desta onda (está no índice), mas o cartão novo da T2a a pôs em destaque; apontado pelo coordenador.
- **Cenário:** cada cartão de modelo simulado diz "Decisões simuladas, pela estratégia fake/hold-only.": um identificador técnico do provedor
  fake no texto de produto (a página do modelo, `modelos/[slug]/page.tsx:165`, mostra o mesmo id, mas num par "Estratégia simulada", onde ele
  é o dado). O `docs/PRODUCT.md` pede português simples, sem jargão.
- **Conserto:** no cartão, "Decisões simuladas por uma estratégia fixa." (a página do modelo continua com o id); ou uma frase por estratégia,
  tirada da lista de `apps/api/src/modules/arena/infrastructure/fake-llm.ts:18`.

## A decisão que a T2b deixou: o radio de lançar

A T2b perguntou se vale desenhar o radio do formulário de lançar menor dentro do alvo de 44 px, sem perder o alto contraste do sistema. **Vale,
e dá para fazer sem pseudo-elemento:**

- **Hoje** (`globals.css:346-364`): o `<input type="radio">` tem 44 × 44 px; marcado, o círculo inteiro fica cheio na tinta, com o `●` do
  `::before` no canvas. É o controle mais pesado da tela (um disco preto de 44 px) e foge da regra da pílula visível de 28 a 36 px dentro da
  caixa de 44. E o `::before` num `<input>` o Firefox não desenha (a própria T2b anotou): no Firefox com cores forçadas (o alto contraste do Windows) o fundo
  `bg-ink` é trocado pela cor do sistema e o glifo não existe, então marcado e desmarcado ficam iguais.
- **A proposta:** o radio visível de 20 px (`size-5`, `appearance-none`, `rounded-full`), desmarcado com a borda de 2 px no `control` (3:1) e
  marcado com a borda de 6 px na tinta (`checked:border-[6px] checked:border-ink`, o miolo no canvas: o desenho do radio nativo). O estado é a
  **espessura da borda**, e a borda sobrevive às cores forçadas (vira a cor do sistema, com a mesma espessura) em todo navegador, o Firefox
  inclusive; nada de `::before` nem de fundo. O alvo de 44 px passa a ser o `<label>` inteiro da opção (`min-h-11`, o radio e o texto: o
  clique no rótulo marca o radio, e é ele a área que recebe o ponteiro), e o anel de foco fica no radio (`outline-offset-2`). A caixa de marcar
  (`.check`) continua como está, porque o `✕` precisa do glifo.
- **O que muda junto:** a medida de 44 px do `carteira-layout.spec.ts` (e do `layout.spec.ts`, se ele mede o `input`) passa a medir o rótulo
  do radio, com o motivo no relatório de quem fizer.

## O que conferi e não achei problema

- **A regra das cotações (ADR 0033).** Nenhum componente de cliente recebe barra, abertura, máxima, mínima, fechamento, volume nem lista de
  fechamentos: as ilhas da T1a (o Line Chart, o Bump Chart, o tooltip e o contador) recebem o patrimônio, a faixa do Monte Carlo, as posições
  no ranking e os nomes, que o `/seasons/:id/equity` público já entrega; as velas (`components/velas.tsx`) são de servidor, sem
  `'use client'`, e nada as importa de um cliente; o realce (`data-data`) leva só a data; o `desc` e o resumo trazem só o primeiro e o último
  fechamento, a mínima e a máxima; o tooltip da Arc recebe só texto (o nome inteiro, o percentil e as explicações). A rosca e o contador da carteira recebem a carteira do
  próprio dono (permitido; a página manda o `Position` inteiro, com o `closeCents`, quando a rosca só precisaria do ticker e do valor). O
  `QUOTES_SECRET` continua só em `lib/quotes.ts` (`import 'server-only'`), e o `quotes-boundary.spec.ts` percorre as subpastas novas. O
  `public.ts`, o `cycle.ts` e o `public-quotes.spec.ts` não mudaram; nenhuma rota pública nova.
- **A arte.** Os quatro PNG (`escadaria`, `escadaria-q0`, `urso`, `urso-q0`) só mudaram no pedaço `PLTE`: conferido à parte, comparando pedaço
  a pedaço o do índice com o do working tree (o mesmo tamanho, a mesma assinatura e a mesma ordem; só o `PLTE` difere). O
  `scripts/arte-azul.test.mjs` existe, roda no `pnpm test` (`node --test "scripts/*.test.mjs"`) e passa (18 de 18).
- **O tema.** O script do `<head>` roda antes da pintura e só usa o que vai como texto (sem helper de fora); `data-tema`, `data-theme` e a
  classe `dark` no `<html>`; o `suppressHydrationWarning` só no `<html>` (`layout.tsx:44`); os radios nascem desmarcados e a pílula sai do
  `data-tema`, então nada pula; o "sistema" segue o `matchMedia` e a outra aba (o evento `storage`); a troca sem o borrão das transições; sem
  JavaScript o seletor some. O CSP do site não restringe `script-src`, então o script em linha roda. Sobre o teste, só a corrida do I6.
- **A fronteira de servidor e cliente.** As cascas (o `app-shell`, o `site-chrome`) e a landing seguem de servidor; o Motion e o Radix só nas
  ilhas das telas do app; os componentes comuns que a landing usa não importam módulo de cliente (o tooltip entra pelo `envolver`). Os
  `'use client'` novos são as peças da Arc e da beUI de cliente, o `avisos.tsx` e o `wallet-charts.tsx`.
- **O contador da Arc.** Nada gira na abertura (`initial={false}` e a posição inicial no próprio algarismo); o leitor de tela lê o texto
  inteiro do `formatBRL` (em `sr-only`), com as rodas em `aria-hidden`; o `cents / 100` serve só para desenhar os algarismos.
- **Os gráficos nos casos de borda** (T1a e T2a): série vazia, uma data só, valores iguais (a escala tem o piso), a série escondida, o dado
  que falta (a lacuna) e esconder todas as séries, sem `NaN`; nas velas, a série vazia, um pregão só ("1 pregão") e barras iguais.
- **O toast fora do I2.** A pilha existe vazia desde o começo (`aria-live="polite"`), o fechar tem nome, o Esc fecha, o prazo para com o
  ponteiro ou o foco (WCAG 2.2.1), o movimento reduzido troca na hora, e o envio que falha não vira aviso: o erro fica no formulário
  (`role="alert"`), como antes. Nenhum aviso leva dado pessoal (só ticker, quantidade, custo, versões dos termos).
- **Erro, vazio e "api fora".** Toda página que mudou e lê a api está no `withApiDown` (o Como funciona tolera a falha com o `try` de sempre);
  a falha do índice dos logos vira o monograma; a falha só da fita vai para o log.
- **Segurança e privacidade.** O texto do prompt não aparece em lugar nenhum (só a versão e o SHA-256, no `.hash`); os logos só em `<img>`
  pela rota do site (`/logos/<TICKER>.svg`), com a CSP dos logos, `nosniff` e o 404 `no-store`, e o único `dangerouslySetInnerHTML` é o
  script do tema; nenhum segredo, token nem e-mail real em arquivo novo (os logos sintéticos são de `example.test`); os textos dos termos e da
  política não mudaram no working tree (só o `h2` ganha um `id`), e os testes congelados do SHA-256 passam; nenhum `console` novo com dado
  pessoal (o único novo é o `[web] logos: …`, com o ticker e o motivo); o chat continua desligado (só ganhou uma classe de CSS).
- **As dependências e as licenças.** O `apps/web/package.json` ganhou só o `motion` 14.9.1 e o `@radix-ui/react-tooltip` 1.4.1, com a versão
  exata; o `pnpm-workspace.yaml`, só o `packageExtensions` do `rxjs`, com o `ponytail:` (fora do M17, nada mais no lockfile). Cada arquivo
  copiado tem o aviso MIT, a URL do item e do registro, a data e o que mudou no topo; há `LICENSE` nas três pastas; as 15 linhas de
  "Componentes copiados de registros" batem com os arquivos; nada vem de item Pro (o market terminal não foi lido).
- **Os arquivos fora do dono que o coordenador autorizou** ficaram só no autorizado: o `pnpm-workspace.yaml` (o `packageExtensions`), as
  props opcionais das peças comuns (nenhuma assinatura mudou), o `CandlesChart` que saiu do `charts.tsx` com o que só ele usava do
  `lib/chart.ts`, o seletor do logo do MOVE3 dentro do `h1` no `e2e/logos.spec.ts`, o "1 pregão" do `e2e/fixture.spec.ts` e as props `describe`
  e `wrap` do `RadioField` no `form-kit.tsx`.
- **Os testes.** Nenhum `.only` nem `.skip` novo além dos pulos por projeto, com motivo, como os de sempre (o teclado e o mouse nos projetos de
  toque, o toque no desktop, o `BASE_URL` do smoke). Cada expectativa que mudou tem o motivo no relatório da tarefa. O e2e da carteira passou a
  ler o aviso pela pilha e o texto do leitor (`readText`), sem afrouxar. O teste do movimento reduzido do Explorar e o da carteira contam as
  animações em curso (fora a lacuna do M11, no da arena).
- **O âmbar.** Nenhum `âmbar`, `amber` nem `ffb000` sobrou no código, no CSS nem nos comentários do site (a "brasa" é o nome da camada de cor
  da arte, não a cor).
- **Os comandos desta revisão** (sem a trava, como as regras permitem): `pnpm --filter @alvesting/web test`, 50 arquivos e **914 testes**
  verdes; `pnpm --filter @alvesting/web typecheck`, **exit 0**; `pnpm exec eslint src e2e next.config.ts playwright.config.ts` no
  `apps/web`, **exit 0**; `node --test scripts/arte-azul.test.mjs`, **18 de 18**. O `pnpm --filter @alvesting/web lint` (o `eslint .`)
  reprovou uma vez com `ENOENT` em `apps/web/test-results/.playwright-artifacts-0/traces/…`, porque outra tarefa rodava o Playwright e
  apagava a pasta durante a varredura: o `packages/config/eslint.mjs:7` não ignora o `test-results/**` (de antes desta onda; fica como
  observação para o fechamento, que roda o `pnpm check` com o e2e por perto).

## Para conferir ao vivo (a T3b)

- No iPhone, a leitura do gráfico do patrimônio pelo toque fecha "na saída do foco", o que depende de o Safari focar o `input type="range"`
  no toque: não dá para confirmar lendo.
- O I3 (a fonte "Grande" do Chrome nas velas e no patrimônio) e o I4 (o gráfico de posições no Pixel 7 com mais pregões) aparecem a olho.

## O que as tarefas deixaram para o fechamento (não conta como achado)

- **T0 (a fundação):** trocar o `public/marca.svg` e o `app/icon.svg` quando o Artur mandar o logo; o `packageExtensions` do `rxjs` sai quando
  o `@nestjs/platform-express` declarar o `rxjs`.
- **T0b (os logos):** a tag `logos` vencida pelo worker, se uma hora de atraso pesar; o teto `LOGO_MAX_BYTES` no contrato (hoje repetido no
  site); a seção 6 do `docs/TELAS.md` ainda não cita o `e2e/logos.spec.ts` (a 4a cita).
- **T1a (a arena):** passar os `logos` ao `DecisionCard` da landing (o painel "A justificativa" mostra o monograma) e trocar o `semVersao`
  pelo `partesDoNome` (M14); as referências na página do modelo, se o Artur quiser.
- **T1b (a landing):** olhar as capturas da landing com as peças da T1a já entregues (os três recortes mudaram sozinhos); o Artur dizer se o
  azul de uma matiz só, sem o contraste de matiz entre a figura e a pedra, está como ele quer; a pendência dos termos do Higgsfield (ADR 0034).
- **T2a (o Explorar):** o volume embaixo das velas (pede um campo na rota interna e decidir se o volume estimado serve); a leitura das quatro
  cotações pelo cursor, que depende da decisão do Artur e do orientador sobre o ADR 0033; o `tema.spec.ts:75` (o I6).
- **T2b (a conta):** o radio de lançar, se o desenho menor for pedido; o chat de verdade (a etapa 13, depois do aval do orientador); o
  `loading.tsx` com o esqueleto, se a navegação esperar na Azure.
