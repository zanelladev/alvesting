# Relatório da tarefa T2 (fundação e home): o sistema visual ascii-ui na v2 e o hero da escadaria

Tarefa `task_e64ce559f718`, onda "design ASCII + elenco" (Run `run_ee238b5b17cc`), 04/11/2026. É a tarefa (a), fase 1, do plano
(`docs/redesign-ascii/plano.md`). Nada foi commitado nem posto no índice: o trabalho está só no working tree (`git diff` e os `??`).

O pedido do Artur: "Eu quero o design ASCII antigo, a landing antiga tava muito bonita, principalmente Hero". A referência foram as capturas
da v1 (`feat-redesign`, commit `cddd320`, `docs/redesign-2026-10/depois/home-1440.png` e `home-390.png`).

## 1. O que foi feito

**O sistema visual** (`apps/web/src/app/globals.css`, ADR 0034):

- os tokens da v1 no `@theme` (o canvas `#000` e as superfícies em degraus, as linhas de 1 px, a tinta `#f5f5f5`, `#a3a3a3` e `#8a8a8a`, o
  âmbar só como acento, as cores de dado, de série e de sistema, a matriz do `DotSpinner`, a escala tipográfica do Arc e os raios), com os
  apelidos provisórios `paper` e `band` marcados com `ponytail:`, e `ink` e `muted` já nos valores novos;
- as classes de mesmo nome com a cara nova (`link`, `btn`, `field`, `check`, `radio`, `tbl`, `th`, `td`, `row`, `muted`) e as novas
  (`btn-primary`, `btn-ghost`, `pill`, `chip`, `badge`, `card`, `vazio`, `ascii-block`, `rule`, `capsule`, `capsule-item`, `acao`, `menu`,
  `tape`, `arte`);
- o foco do teclado âmbar (o contorno sólido de 2 px de antes) e a regra global de movimento reduzido.

**As fontes** (`app/layout.tsx`): a Geist só no 500 pelo `next/font`, com preload (o arquivo que o build baixou: Geist Medium 1.800, Google
Fonts `geist/v5`, 13.336 B, OFL-1.1 pela tabela `name`); o texto e a mono são as fontes do sistema. **A Inter 400 do plano saiu** pela medida
do Lighthouse (seção 3, desvio 1): com ela, a home reprovava. Antes de sair, o build a baixou como Inter 4.001 (`inter/v20`, 23.804 B, OFL-1.1).

**A casca**, sem componente de cliente:

- o cabeçalho de 64 px, preso no topo, com a marca (o ladrilho âmbar em SVG) e uma `nav` "Principal" com os sete links na ordem: a cápsula
  centrada a partir de 1024 px, a pílula branca "Carteira" e a ação quieta "Conta"; abaixo de 1024 px, uma folha `popover` nativa aberta
  pelo botão "Menu" (44 × 44), com o Esc e o toque fora fechando, e uma reserva para navegador sem `popover`;
- a moldura (as laterais a partir de 1202 px, a `Rule` com o losango), o `main` na coluna de 1200 com a calha `clamp(16px, 4vw, 32px)`, a
  linha antes do rodapé e o rodapé na coluna;
- o `icon.svg` da v1 (`[*]` âmbar sobre `#0f0f0f`).

**As peças compartilhadas**, redesenhadas sem mudar o contrato de DOM: `ui.tsx` (`Rule`, `PageHead`, `Section` com a cara do `SectionHead`,
`Facts` com a do `Dl`, a faixa de números, `AsciiChart`, `Empty` com a grade fantasma, a etiqueta "simulado" como `badge` tracejado,
`TableScroll` no cartão), `tables.tsx`, `decisions.tsx` (o cartão e o `ActionBadge`), `charts.tsx` (as cores do SVG no escuro), `form-kit.tsx`
(os rótulos, o erro em `semantic-error` e o `DotSpinner` 3 × 3 ao lado de "Enviando…"), `api-down.tsx` e `with-api-down.tsx` ("Tentar de
novo" na pílula branca). As telas de (b) e (c) ficam usáveis no tema escuro, ainda com o h1 delas na mono.

**O hero e a home** (`app/page.tsx`, na ordem da seção 3 do plano):

- `components/hero.tsx` (servidor, sem entrada animada): a pílula do anúncio (`heroPill`: "Temporada em andamento · pregão X de Y", "Temporada
  encerrada · pregão Y de Y" ou "primeiro pregão em dd/mm"), o título, a descrição da v2, o aviso da arena simulada da T1 com o mesmo texto
  (o `<strong>` e o `[!]` em cinza), "Ver decisões" na pílula branca e "Regras da arena" (sem ciclo, este vira a pílula branca), e no pé a
  legenda e a fita;
- `components/arte.tsx` (servidor): o quadro 0 inteiro no HTML, a brasa no `escadaria-q0.png` que o CSS pede (sem `preload`: seção 3,
  desvio 1), o tamanho em CSS; `components/arte-viva.tsx` (cliente): o laço só a partir de 1024 px, sem movimento reduzido e sem Save-Data, depois do
  `load`;
- `components/fita.tsx` e `lib/fita.ts`: a fita em CSS (um caractere por passo, 8 por segundo), decorativa, com o texto para o leitor de tela;
  com a rota interna da T2b (`readTape`), o universo da semana do último ciclo, até os 40 de maior volume, e a legenda "Os mesmos N papéis da
  B3, lidos por todos os modelos. Cotações: brapi.dev, pregão de …"; sem ela (resposta vazia), o BOVA11 e o macro, com a outra legenda;
- `lib/ascii.ts`: o `areaChart` e os glifos da v1, para a curva em blocos do BOVA11 na faixa de cotações;
- as artes: `escadaria.json` e `escadaria.png` copiados do commit `cddd320` (o `git hash-object` bate com o blob), e os `-q0` derivados pelo
  apêndice A do plano (400 × 120, 3.856 B; o quadro de 24.119 caracteres).

**O `start` do `apps/web`** copia também o `public/` para o standalone (sem isso a arte dava 404 no e2e e no Lighthouse).
O `next.config.ts` perdeu o `experimental.inlineCss`: o CSS vai em arquivo (seção 3, desvio 1).

**Os testes**: as linhas (a) das tabelas 5.1 e 5.2 do plano, os novos da 5.4 (`e2e/hero.spec.ts`, `e2e/menu.ts`, `lib/ascii.spec.ts`,
`lib/fita.spec.ts`, `components/hero.spec.tsx`), a medida dos links do cabeçalho em 1280 px no `layout.spec.ts`, o teste da legenda e da fita
no `smoke.spec.ts` e o `/interno/fita` na api falsa do `fixture-api.ts`.

**Os docs**: o ADR 0034 (com o apêndice da derivação dos `-q0`), o `docs/TELAS.md` (a seção 10 nova, "Sistema visual (ascii-ui)", e as
seções 1 a 6, 8 e 9), o `docs/PLANO.md` (§15, a etapa 9 e o §17, item 7), o `docs/DEPENDENCIAS.md` (as fontes, o Google Fonts, o Higgsfield,
a seção "Desenho de terceiros" com o Arc e a seção "Artes", uma linha por arquivo), a convenção "Telas" do `CLAUDE.md` e a skill `ascii-ui`
adaptada em `.claude/skills/ascii-ui/` (o `SKILL.md` e, de `references/`, o `arte.md`, o `checklist.md` e o `waerk.md`, só com texto, sem
nenhuma imagem de terceiros).

## 2. Critérios de aceite, com a evidência

Ambiente: Node 26.13 (`nvm use`); o `pnpm check` e os dois e2e com o az falso no `PATH` e a guarda de rede (`NODE_OPTIONS=--import
.data/guardas/net-guard.mjs`, `NET_GUARD_LOG=.data/guardas/fundacao-rede.log`); o `pnpm check` com o banco `alvesting_fundacao_test` e o
Azurite do compose. Cada execução pesada tomou a trava `.data/trava-pesada` (dono `T2-fundacao 16:49`), com o disco conferido antes de cada
uma (o coordenador liberou a partir de 5 GB livres; ficou entre 6 e 9 GB) e um vigia de disco durante o e2e.

1. **Capturas do depois** da home em 390 × 844 e 1440 × 900, o quadro e a página inteira, em `docs/redesign-ascii/depois/` (`home-390.png`,
   `home-390-inteira.png`, `home-1440.png`, `home-1440-inteira.png`), tiradas da demo (http://127.0.0.1:4300), no padrão de nomes do
   "antes". A comparação com a v1 (`feat-redesign/docs/redesign-2026-10/depois/home-1440.png` e `home-390.png`):
   - **Igual**: o canvas preto; o cabeçalho de 64 px com a marca âmbar a 152 px da esquerda, a cápsula centrada e a pílula branca à direita;
     a moldura (as laterais em x = 120 e 1320 a partir da linha do cabeçalho, e o losango onde a linha cruza); a pílula do anúncio em
     y ≈ 162 a 192; o título em Geist 500 de 56 px, em duas linhas ("Modelos de linguagem / investindo na B3"), em y ≈ 215 a 335; a
     descrição de 18 px em `body`; a pílula branca "Ver decisões →" e o botão escuro com borda, de 44 px; a escadaria em ASCII com a brasa
     âmbar sangrando à direita e embaixo, dissolvendo nas bordas e terminando acima do pé; a legenda de 12 px em `muted`, centrada, e a fita
     de 13 px na mono, com o degradê nas pontas, em y ≈ 842 e 870; depois, a linha, a faixa vazia de 48 px, a linha e a faixa de números
     dividida por fios.
   - **Mudou de propósito**: os links do cabeçalho são os da v2 ("Carteira" na pílula branca, "Conta" quieta) e a cápsula não acende o item
     atual (seção 3); o cabeçalho é sólido e preso no topo (na v1 era transparente sobre o hero, com JavaScript); a pílula diz "Temporada
     encerrada · pregão 20 de 20", a descrição é a da v2 (08:00, o briefing e o prompt oculto com o hash) e o aviso da arena simulada da T1
     fica entre a descrição e os botões; a arte anda uns 87 px para a direita em 1440 (o touro começa depois da coluna de texto, que ficou
     mais alta com o aviso), e o último degrau da escada fica cortado na borda; no celular a arte vai para um palco sob os botões, em vez de
     subir atrás deles, e a legenda e a fita ficam logo abaixo da primeira dobra; a legenda leva o crédito e o pregão ("Os mesmos 38 papéis
     da B3, lidos por todos os modelos. Cotações: brapi.dev, pregão de 01/12/2026.") e a fita, a vírgula decimal e o sinal ("SINA3 80,03 ▲
     +1,48%"); a faixa de números é a "Cotações e macro" da v2 (o BOVA11 com a curva em blocos, o CDI, a Selic, o IPCA e o dólar), e não os
     quatro números da v1; o resto da home é o conteúdo da v2 (ranking, ciclos, patrimônio, decisões e temporada); o texto está na fonte do
     sistema. O "N" flutuante das capturas da v1 era o indicador do `next dev`.
2. **`pnpm check` com exit 0**, em 5 min 19 s: lint (com o `prettier --check .`), tipos, testes (web: 35 arquivos, 594 testes; contratos: 13
   arquivos, 497 testes; api: 151 arquivos verdes e 2 pulados por desenho, o emulador do Service Bus e os arquivos reais da CVM, 3.007 testes verdes e 9
   pulados; `scripts/*.test.mjs`: 113) e o `docs:check` ("73 itens documentados").
3. **`pnpm build` com exit 0**: o completo às 16:49 (4 tarefas, 21 s) e o do site depois de cada mudança de fonte e CSS. As fontes com preload
   que o build final baixou: só `3679ff5ff22c890b-s.p.2lk8wg8jr2q6w.woff2`, Geist Medium 1.800, 13.336 B.
4. **`pnpm test:e2e -- --workers=2`** (o coordenador pediu 2 workers) verde em pixel-7, iphone-15 e desktop, a suíte inteira, duas vezes:
   - na versão do plano (Geist e Inter, CSS em linha): **1.135 passaram, 5 pulados, 0 falha**, em 9,6 min;
   - na **versão final**: **1.135 passaram, 5 pulados, 0 falha**, em 7,9 min.
   Os 5 pulados são os de sempre: o teclado da carteira no pixel-7 e no iphone-15 e o login do smoke (`@api`, só com `BASE_URL`) nos três
   projetos. Os testes da T1 passaram nos três projetos: `arena simulada › a home avisa que as decisões são simuladas, e o ranking traz os
   seis do elenco, cada um com a etiqueta`, `arena simulada › o ranking completo marca só os modelos` e `modelo › mostra o provedor e o ID...`
   (a "Estratégia simulada" e o aviso). Os novos (`e2e/hero.spec.ts`, as medidas do cabeçalho do `layout.spec.ts` e o teste do pé do hero no
   `smoke.spec.ts`) também.
5. **`pnpm lighthouse`** (5 coletas, mediana): **LCP 2.394 ms** (2.377 a 2.482; meta de 2,45 s), **CLS 0**, **TBT 93 ms** (66 a 162), FCP
   915 ms, performance 0,95 a 0,98; 14 pedidos e 205 KB. **O elemento do LCP** é o parágrafo da descrição do hero (`section.relative >
   div.mx-auto > div.grid > p.max-w-[560px]`, texto). **As fontes**: a Geist 500, 13.869 B no fio (antes: 37.776 B, três arquivos da Plex).
   **O documento**: 30,5 KB no fio. Nenhum pedido ao `escadaria.json` nem ao `escadaria.png` (só o `escadaria-q0.png`, 4.368 B). A primeira
   medida, com o plano como estava, reprovou (2.608 ms): o caminho até passar está na seção 3, desvio 1, e no `docs/TELAS.md`, seção 5.
6. **Nenhuma dependência npm nova**: nos `package.json` só mudou o `start` do `apps/web`; o `pnpm-lock.yaml` e o `pnpm-workspace.yaml` estão
   intocados. `pnpm docs:check` ok.
7. **As guardas**: o `.data/guardas/az-stub/calls.log` continua com 0 linhas, e o `fundacao-rede.log` nunca foi criado (a guarda só o cria
   ao barrar). Ressalva medida: o turbo roda em modo estrito (`envMode: strict`) e repassa o `NODE_OPTIONS` (conferido com um módulo marcador
   num `turbo run lint`), mas **não** o `NET_GUARD_LOG`: dentro do turbo a guarda bloqueia, mas não teria onde escrever o log. Nenhum teste
   do site depende de rede. O `pnpm build` e o `pnpm lighthouse` rodaram sem a guarda (o build baixa a fonte do Google).
8. **Relatório**: este arquivo; o `worker_done` vai com `--report-path` para ele.

## 3. Desvios e decisões

1. **O LCP: a Inter saiu, o sprite perdeu o `preload` e o CSS foi para arquivo.** Com o plano como estava, o `pnpm lighthouse` reprovou com
   2.608 ms. O documento tinha 57,8 KB no fio, porque o CSS novo (41,8 KB crus, 8,9 KB comprimidos) ia três vezes nele com o
   `experimental.inlineCss`; tirá-lo do HTML (30,8 KB) não mudou o LCP. Medi variante por variante, com um proxy que mudava o HTML e o
   Lighthouse direto contra ele: o conteúdo novo da home não era o que pesava (só o hero dava o mesmo), e sim os pedidos de alta prioridade
   que o Lantern conta como bloqueantes no valor ruim da simulação, as fontes com preload e o sprite com `fetchpriority="high"` (sem as
   fontes, 1,97 s). A saída 2 do plano previa tirar a Inter (pela Geist variável); a Geist variável (29 KB) não daria a margem, então o texto
   foi para a fonte do sistema (`system-ui`: SF no Apple, Roboto no Android, Segoe no Windows) e a Geist 500 ficou nos títulos e no que é
   500. O sprite do quadro 0 passou a vir pelo CSS. A brasa continua no celular (a saída 3, o celular sem a brasa, também passava, mas
   oscilava mais). Resultado: 2.394 ms. A tabela e as variantes estão no `docs/TELAS.md`, seção 5, e no ADR 0034. **A margem é de uns 55 ms
   até a meta de 2,45 s**, medida com a máquina sob carga alta (load de uns 7, swap em 19,5 de 20 GB e um jogo usando 160% de CPU). **O
   Artur pode querer a Inter de volta**: custa uns 200 ms no LCP simulado do celular.
2. **A arte nunca atrás do texto.** O aviso da arena simulada (o texto da T1) deixou o texto do hero uns 90 px mais alto que o da v1, e a
   escadaria da v1 subia atrás dele: em 390 px o touro cobria o aviso, e em 1280 × 720 (o projeto `desktop` do e2e) e 1024 × 768, a
   descrição. A partir de 1024 px a grade anda para a direita o bastante para o touro (as colunas 89 a 133 de 200) começar depois da coluna
   de texto (`--deslocar: max(5.5vw + 8px, 608px − 44.5vw)`); abaixo de 1024 px a arte vai para um palco logo abaixo dos botões, que mostra
   só as 56 linhas de baixo da grade (`--linhas`). Conferido em 390, 768, 1024, 1280, 1440 e 1920 px.
3. **Os links do menu são `<a>` comuns, e a cápsula não marca a tela atual.** Com o `Link` do Next, a navegação suave mantinha a folha
   `popover` aberta sobre a página nova (o cabeçalho é do layout, que não remonta), e fechá-la pediria JavaScript na casca; a navegação
   inteira a fecha. O item ativo da v1 vinha de um componente de cliente que lia o caminho; sem ele, a cápsula só tem o estado de hover.
4. **Espaço sem nomes no `@theme`.** No Tailwind 4.3 o `max-w-*` lê `--spacing-*` antes de `--container-*` (`"max-w",["--max-width",
   "--spacing","--container"]` no `lib.js`): o `--spacing-md: 20px` da v1 faria o `max-w-md` dos formulários virar 20 px. Os valores são os
   da escala numérica (base de 4 px), documentados no `globals.css` e no `TELAS.md`, seção 10.
5. **Tokens que não entraram**: as rampas da arte (`cinza-0..3`, `brasa-0..5`), que estão assadas no sprite e o CSS não usa, e o `dot-off`
   (só o `dot-off-card` é usado). O `lib/ascii.ts` trouxe da v1 só o `areaChart` e os glifos (o `sparkline`, o `uptimeBars` e o
   `allocationBar` ficam para a tela que os usar, com um `ponytail:`). O `PageHead` entrou porque o `ApiDown` o usa.
6. **A fita** lê a rota interna da T2b (`readTape`) e leva até os 40 papéis de maior volume do universo (`TAPE_LIMIT`, com `ponytail:`: o
   universo inteiro, até 500, somaria uns 20 KB ao documento); a legenda conta todos. Sem a rota (a resposta vazia: antes do primeiro ciclo,
   sem universo ou sem barra) ela mostra o BOVA11 e o macro, com a outra legenda. O `fixture-api.ts` responde a `/interno/fita` com a
   resposta vazia.
7. **Arquivos de outras donas que não toquei**: o `wallet-lots.spec.tsx` (de (c)) confere a classe da `legend` do `RadioField`, então essa
   `legend` ficou com as classes antigas (o resto do `form-kit.tsx` mudou); o `news-list.tsx` (de (b)) ficou como estava, e por isso a linha
   91 do `components.spec.tsx` não mudou (só a 212 mudou, o título do cartão).
8. **`.prettierignore`**: entrou `apps/web/public/ascii` (as artes são dado copiado byte a byte; o `prettier --check .` reformataria o
   `escadaria.json` de 2,9 MB). O `escadaria-q0.json`, que o build importa, foi formatado pelo prettier (só a indentação mudou).
9. **"Cotações e macro"** tem o título `h2` só para o leitor de tela (`sr-only`): a faixa fica entre duas linhas da moldura, sem título
   visível, como a faixa de números da v1; a região continua com o nome que o e2e e o smoke procuram. A seção "Temporada" passou a existir
   sempre (sem temporada, com o `Empty` de antes).
10. **O comentário do `apps/web/Dockerfile`** ("Garante a pasta public/ (hoje não existe)") ficou velho: agora ela existe, e o `COPY` da
    linha 40 a leva para a imagem. Não mexi (o Dockerfile não é desta tarefa, e `docker build` está fora das regras desta onda).

## 4. O que ficou para depois

- **Fechamento (fase 3, (a))**: apagar os apelidos `paper` e `band` (com `git grep -n -E "(bg|text|border|fill|stroke)-(paper|band)\b"
  apps/web/src` vazio), reler as telas de (b) e (c) contra o `TELAS.md`, seção 10, e, se a margem do LCP apertar, cortar o CSS da casca
  (a camada `components` foi de uns 3 KB a 15 KB crus).
- **(b) e (c)**: as telas delas ainda têm o h1 na mono, as bordas `border-ink` (agora claras) e o resto da estética crua, usáveis no tema
  escuro. O urso da 404 é de (b).
- **Pendências do Artur**: conferir a versão vigente dos termos da API do Higgsfield antes de publicar o repositório (ADR 0034,
  `DEPENDENCIAS.md`); decidir se a Inter volta (seção 3, desvio 1).
- **Não verificado**: iPhone e Android físicos (só o WebKit e o Chromium do Playwright), leitor de tela de verdade, e o Lighthouse num runner
  de CI.

## 5. Arquivos tocados

Só no working tree; nada no índice.

- Raiz: `.prettierignore`, `CLAUDE.md` (a convenção "Telas"; a T2b mexeu na frase das rotas internas).
- `.claude/skills/ascii-ui/`: `SKILL.md`, `references/arte.md`, `references/checklist.md`, `references/waerk.md` (novos).
- `apps/web`: `package.json` (o `start`), `next.config.ts` (sem o `inlineCss`).
- `apps/web/public/ascii/arte/`: `escadaria.json`, `escadaria.png`, `escadaria-q0.png` (novos).
- `apps/web/src/app/`: `globals.css`, `layout.tsx`, `page.tsx`, `icon.svg`.
- `apps/web/src/arte/escadaria-q0.json` (novo).
- `apps/web/src/components/`: `ui.tsx`, `site-chrome.tsx`, `site-chrome.spec.tsx`, `tables.tsx`, `decisions.tsx`, `charts.tsx`,
  `form-kit.tsx`, `api-down.tsx`, `components.spec.tsx`; novos: `hero.tsx`, `hero.spec.tsx`, `arte.tsx`, `arte-viva.tsx`, `fita.tsx`.
- `apps/web/src/lib/`: `with-api-down.tsx`, `with-api-down.spec.tsx`; novos: `ascii.ts`, `ascii.spec.ts`, `fita.ts`, `fita.spec.ts`.
- `apps/web/e2e/`: `arena.spec.ts`, `carteira-layout.spec.ts`, `carteira.spec.ts`, `conta-layout.spec.ts`, `conta.spec.ts`, `data.ts` (o
  `fetchTape`), `fixture-api.ts` (o `/interno/fita`), `fixture.spec.ts`, `home.spec.ts`, `layout.spec.ts`, `smoke.spec.ts`; novos:
  `hero.spec.ts`, `menu.ts`.
- `docs/`: `adr/0034-volta-ao-design-ascii-ui-da-v1.md` (novo), `TELAS.md`, `PLANO.md`, `DEPENDENCIAS.md`,
  `redesign-ascii/depois/` (as quatro capturas) e `redesign-ascii/relatorios/fundacao.md` (este).

Fora do git: os scripts de diagnóstico e os relatórios do Lighthouse ficaram na pasta de trabalho do agente; o `apps/web/.lighthouseci`
(ignorado pelo git) guarda a última medida. Limpeza: o banco `alvesting_fundacao_test` apagado, a trava solta, nenhum servidor meu de pé
(a demo da 4300 e 4310 não foi tocada).
