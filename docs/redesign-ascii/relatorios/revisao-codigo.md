# Revisão de código da onda "design ASCII + elenco" (T4a)

Tarefa `task_a72c06f32d0c`, Run `run_ee238b5b17cc`, 04/11/2026. Só leitura: nenhum arquivo do repositório mudou além deste relatório.
O alvo foi o que está fora do índice (`git diff` e os `??` do `git status --porcelain`), lido inteiro, com os relatórios das tarefas
(`elenco.md`, `fita.md`, `fundacao.md`, `conta.md` e `arena.md`) e o plano (`plano.md`). A arena foi lida por último; os arquivos da T3a
não mudaram entre a leitura (18:48) e a última conferência antes de escrever (18:59, por hash), então as linhas citadas são as atuais. A
`arena.md` ainda está com as seções 2 e 4 "(a preencher)".

## Resumo

**0 bloqueia, 4 importantes, 11 menores.** Nenhum achado quebra o contrato dos testes, a segurança ou a LGPD. Os quatro importantes são
erros com cenário concreto: dois de dado na home (a fita no meio da carga do fim do dia e a pílula "pregão 0 de 20"), um de robustez (a
fita, que é enfeite, derruba a home) e um de navegador sem `popover`.

| # | Gravidade | Onde | O quê |
|---|---|---|---|
| 1 | importante | `apps/api/src/modules/quotes/infrastructure/quotes.repository.ts:72-80` | a fita e a legenda leem um pregão pela metade enquanto o `eod` grava as barras |
| 2 | importante | `apps/web/src/components/hero.tsx:44-52` | "Temporada em andamento · pregão 0 de 20" no primeiro dia, até a liquidação |
| 3 | importante | `apps/web/src/app/page.tsx:149-156` | a falha da rota da fita vira a tela de erro da home inteira |
| 4 | importante | `apps/web/src/app/globals.css:347-355` | sem `popover`, o menu abre como lista de uns 340 px presa no topo |
| 5 | menor | `apps/web/src/app/globals.css:168-170` | `.btn-ghost` sem uso |
| 6 | menor | `apps/web/src/lib/fita.ts:71` | o texto da fita para o leitor de tela lê o glifo de cada papel |
| 7 | menor | `docs/adr/0034-volta-ao-design-ascii-ui-da-v1.md:21` | a decisão 5 descreve a fita sem a rota interna |
| 8 | menor | `docs/DEPLOY.md:91-108` e `:368` | a tabela do smoke não acompanhou o h1 nem o teste novo |
| 9 | menor | `hero.tsx:73`, `not-found.tsx:17` e outros | valores arbitrários repetidos e tokens sem uso |
| 10 | menor | seis arquivos (o `[!]`) e cinco (a caixa de erro) | a caixa de aviso e a de erro copiadas em vez de reusadas |
| 11 | menor | `docs/redesign-ascii/plano.md:7` e `:707` | caminhos da máquina do Artur num doc do repositório público |
| 12 | menor | `apps/web/e2e/hero.spec.ts:120-124` | "a fita rola" passa sem a fita andar |
| 13 | menor | `apps/web/src/components/wallet-panels.tsx:54` e `:103` | a carteira sem o glifo que o resto do site já tem |
| 14 | menor | `apps/web/src/components/arte-viva.tsx:65-78` | o laço baixa o arquivo inteiro depois que a página saiu |
| 15 | menor | `apps/web/Dockerfile:26` | comentário velho ("hoje não existe") |

## Achados

### 1. A fita mostra um pregão pela metade durante a carga do fim do dia (importante)

- **Onde.** `apps/api/src/modules/quotes/infrastructure/quotes.repository.ts:72-80`: o `date` da fita é o pregão mais recente com barra de
  **qualquer** papel do universo até o do ciclo, e `:99` tira o papel sem barra nesse pregão. A legenda conta as linhas
  (`apps/web/src/lib/fita.ts:72`, `universe.rows.length`).
- **Cenário.** Todo pregão, a partir das 21:30, o `eod` grava as barras papel a papel (`bar-loader.ts:55`, um `insertBars` por resposta,
  num orçamento de 4 minutos por passada, `FETCH_BUDGET_MS`) e, se falta papel do conjunto obrigatório, se reagenda de hora em hora
  (`market-schedulers.ts`; `docs/JOBS.md`, `eod`), com o que já gravou no banco. Assim que o primeiro papel do universo ganha a barra do dia, `last.date` vira o dia do ciclo e a fita passa a ter só
  os papéis já gravados: com 3 de 300, a home diz "Os mesmos 3 papéis da B3, lidos por todos os modelos. Cotações: brapi.dev, pregão de
  …" e a fita repete esses 3. O cache de dados do site (300 s, tag `arena`) guarda o estado parcial até a liquidação vencer a tag.
- **Evidência.** `const last = await latestUntil({ lte: cycle.date });`, sem conferir a cobertura; o `quotes.integration.spec.ts` testa o
  pregão do ciclo sem nenhuma barra ("antes da barra do pregão do ciclo") e nunca o pregão com parte das barras.
- **Conserto.** Escolher como `date` o pregão mais recente até o do ciclo com a cobertura mínima do briefing
  (`LIMITS.coverageMinPercent`, 80%, `apps/api/src/modules/briefing/domain/briefing.ts:30`), senão o anterior, com um caso no
  integration spec (o pregão do ciclo com barra de só parte do universo). A legenda pode contar o universo, e não as linhas (o contrato
  ganharia o tamanho do universo, mudança aditiva).

### 2. "Temporada em andamento · pregão 0 de 20" no primeiro dia (importante)

- **Onde.** `apps/web/src/components/hero.tsx:44-52` e `apps/web/src/app/page.tsx:189` (`heroPill(current, equity?.dates.length ?? 0)`).
- **Cenário.** No primeiro pregão de toda temporada, o `sched-cycle` cria o ciclo às 08:00 (o `lastCycle` deixa de ser nulo), mas a
  primeira liquidação só sai à noite: até lá `equity.dates` é vazio e a pílula do hero diz "pregão 0 de 20", levando a `/ciclos/<dia 1>`.
  Nos dias seguintes, das 08:00 à liquidação, ela diz o número do pregão anterior e leva ao ciclo do dia.
- **Evidência.** `settled` é o número de datas de `equity_snapshot`, que só a liquidação grava; o `hero.spec.tsx` testa "em andamento"
  só com `settled` = 4. O e2e semeia uma temporada encerrada e não passa por esse estado.
- **Conserto.** Contar o pregão do último ciclo antes de ele ser liquidado, por exemplo
  `settled + (equity.dates.at(-1) === lastCycle.date ? 0 : 1)` ("pregão 1 de 20" no primeiro dia), com um caso no `hero.spec.tsx`
  (ciclo aberto, nada liquidado).

### 3. A fita, que é enfeite, derruba a home inteira quando falha (importante)

- **Onde.** `apps/web/src/app/page.tsx:149-156`: `readTape()` está no mesmo `orNotFound(Promise.all(...))` das leituras da home.
- **Cenário.** Qualquer falha só da rota da fita troca a home inteira pela tela "Não foi possível carregar os dados", com o ranking, os
  ciclos e o feed que leram bem: o 500 `permission denied for table universe_snapshot` num banco sem a migration `20261104120000` lido
  com o login da api (o caso que a `fita.md` aponta para o `alvesting_ensaio`), um 5xx ou o prazo dessa consulta de seis leituras, ou uma
  api sem a rota. O `e2e/fixture-api.ts` precisou ganhar a `/interno/fita` só para a home da api falsa não cair.
- **Evidência.** O trecho citado; o caminho sem a fita (BOVA11 e macro) já existe em `heroTape`, para a resposta vazia.
- **Conserto.** `readTape().catch((error) => { console.error('[web] home sem a fita:', error); return { date: null, rows: [] }; })`,
  como o `QuotesDate` do rodapé já faz. O portão do segredo continua no `readBars` do BOVA11, na mesma leitura: o smoke segue
  reprovando o segredo errado.

### 4. Sem `popover`, o menu abre como uma lista de uns 340 px presa no topo (importante)

- **Onde.** `apps/web/src/app/globals.css:347-355`: a reserva para navegador sem `popover` só tira a altura fixa do cabeçalho e esconde
  o botão; as regras de baixo de 1024 px (`:334-345`) seguem valendo, com o `capsule-item` numa linha de 52 px com borda e as ações numa
  grade de duas colunas. O cabeçalho é `sticky top-0` (`apps/web/src/components/site-chrome.tsx:37`).
- **Cenário.** No Safari de um iPhone 8 ou X (o último iOS deles é o 16.7; o `popover` chegou no Safari 17) e no Firefox antes do 125, a
  `nav` não tem o `display: none` do navegador e aparece aberta dentro do cabeçalho: cinco linhas de 52 px e os dois botões, uns 340 px
  presos no topo de uma tela de 667 px, em toda página. O comentário (`globals.css:347`) e o `docs/TELAS.md` (seção 10, "O menu") dizem
  que os links ficam "em linha, como antes".
- **Evidência.** Nesses navegadores a regra `.menu:popover-open` é inválida e cai, e o `@supports not selector(:popover-open)` não mexe
  em `.capsule`, `.capsule-item` nem `.menu-acoes`.
- **Conserto.** No mesmo `@supports not`, repor a linha (`.capsule` e `.menu-acoes` em `flex flex-wrap`, `.capsule-item` e `.acao` em
  `inline-flex min-h-11`, sem a borda de baixo nem o `w-full`) e deixar o cabeçalho sem `sticky` nesse caso. Se a lista for aceita,
  corrigir o comentário e o TELAS.md.

### 5. `.btn-ghost` sem uso (menor)

- **Onde.** `apps/web/src/app/globals.css:168-170`. Nenhum arquivo de `apps/web/src` usa `btn-ghost`; o ADR 0034 (decisão 1) e o
  `docs/TELAS.md` (seção 10, linhas 226 e 237) o oferecem.
- **Cenário.** CSS morto no arquivo único que a home baixa.
- **Conserto.** Apagar a regra e as duas menções (volta com a primeira tela que precisar dela).

### 6. O texto da fita para o leitor de tela lê o glifo de cada papel (menor)

- **Onde.** `apps/web/src/lib/fita.ts:71` (o `label` junta as mesmas `parts` da fita, com `▲ ▼ ■`) e `:82`; vai para o `sr-only` de
  `apps/web/src/components/fita.tsx:25`.
- **Cenário.** Com o universo, o leitor de tela lê "PETR4 38,12 triângulo preto para cima +1,19%" para cada um dos 40 papéis; o sinal já
  diz a direção, e nas tabelas o glifo é decoração (CSS com o texto alternativo vazio).
- **Conserto.** Montar o `label` sem o glifo e ajustar `fita.spec.ts:107-108` e `hero.spec.ts:74-75`.

### 7. O ADR 0034 descreve a fita sem a rota interna (menor)

- **Onde.** `docs/adr/0034-volta-ao-design-ascii-ui-da-v1.md:21` (decisão 5): "Enquanto a rota interna do universo (a `a0`…) não chega,
  ela mostra … o BOVA11 e o macro".
- **Cenário.** A rota entrou nesta onda (`fita.md`) e a home lê `readTape` (`page.tsx:154`), até 40 papéis (`TAPE_LIMIT`,
  `fita.ts:58`); o BOVA11 e o macro só aparecem com a resposta vazia. Quem lê o ADR entende o estado provisório como o final.
- **Conserto.** Reescrever a decisão 5 com o estado final, o teto de 40 e o caminho sem a rota.

### 8. A tabela do smoke no DEPLOY.md não acompanhou a mudança (menor)

- **Onde.** `docs/DEPLOY.md:96` e `:368` dizem que o smoke confere o h1 "Alvesting" (agora é "Modelos de linguagem investindo na B3",
  `apps/web/e2e/smoke.spec.ts:23`, `:37` e `:48`); a tabela (`:94-108`) não tem o teste novo do pé do hero (`smoke.spec.ts:78`); e
  `:91-92` dizem "onze testes" (o arquivo tem 14 `test(`; eram 13 no índice, então a contagem já estava velha).
- **Conserto.** Atualizar a linha da home, acrescentar a do pé do hero e corrigir a contagem.

### 9. Valores arbitrários repetidos e tokens sem uso (menor)

- **Onde e cenário.**
  - `apps/web/src/components/hero.tsx:73` e `apps/web/src/app/not-found.tsx:17` repetem a mesma string do h1
    (`text-[clamp(2.25rem,1.1rem+3.4vw,3.5rem)] leading-[1.1] font-medium tracking-[-0.03em]`), enquanto o `--text-hero`
    (`globals.css:58-61`) está definido e ninguém o usa.
  - `max-w-[64ch]` aparece 26 vezes ao lado de `max-w-prose` (65ch), 20 vezes: duas medidas de texto quase iguais, às vezes na mesma tela
    (`legal-document.tsx`).
  - `max-w-[1200px]` 5 vezes (`layout.tsx:53`, `site-chrome.tsx:38` e `:122`, `hero.tsx:65` e `:104`) e `h-[min(75vw,420px)]` 3 vezes
    (`hero.tsx:102` e `:118`, `not-found.tsx:42`).
  - Tokens que nada usa (não pesam, porque o `@theme` comum não os emite, mas são configuração "para depois"): `surface-card-elevated`,
    `hairline-soft`, `primary-active`, `on-primary`, `data-benchmark`, `series-1` a `series-5`, `text-data-lg`, `text-data-md`,
    `text-data-sm` e `text-prose-sm` (`globals.css:12, 15, 25, 27, 32, 34-38, 83-91, 94-95`).
- **Conserto.** O `--text-hero` passa a ser o clamp (com a linha de 1,1 e o −0,03em) e os dois h1 usam `text-hero`; uma medida de texto só
  (`max-w-prose`, ou um `--container-texto` de 64ch); um `--container-coluna` de 1200 px; apagar os tokens sem uso e as menções deles no
  TELAS.md (seção 10).

### 10. A caixa de aviso e a de erro copiadas em vez de reusadas (menor)

- **Onde.** O aviso com `[!]` (o `<p>` flex, o `<span aria-hidden>` e o texto) está escrito à mão em `app/carteira/page.tsx:84`,
  `app/conta/page.tsx:40`, `components/admin-panels.tsx:221`, `components/legal-text.tsx:89`, `components/hero.tsx:84` e
  `app/modelos/[slug]/page.tsx:147` (as duas últimas com outras classes). A caixa de erro
  (`rounded-control border border-semantic-error/60 bg-surface-card p-4 text-ink`) está em `form-kit.tsx:157`, `wallet-lots.tsx:395`,
  `entrar/page.tsx:64`, `noticias/page.tsx:63` e `acoes/page.tsx:44`, e a caixa neutra (a mesma com `border-hairline-strong`) em 11
  lugares, os avisos com `[!]` inclusive.
- **Cenário.** Mudar o tom ou o sinal do aviso pede achar seis cópias, de três donas; cada cópia é mais texto no HTML e no payload do React.
- **Conserto.** Um `Aviso` em `ui.tsx` (ou as classes `aviso` e `erro` no `@layer components`, como o `card`).

### 11. Caminhos da máquina do Artur num doc do repositório público (menor)

- **Onde.** `docs/redesign-ascii/plano.md:7` e `:707` (o caminho absoluto do worktree `feat-redesign` na máquina do Artur).
- **Cenário.** O repositório vai ser público e nenhum doc rastreado tem caminho de `/Users/` hoje (`git grep -c "/Users/" --
  docs` sai vazio); o plano, que vai junto com o commit da onda, levaria o usuário e a pasta da máquina.
- **Conserto.** Trocar por "o worktree `feat-redesign` da v1" e um `V1=<caminho do worktree da v1>` no comando do apêndice.

### 12. "a fita rola" passa sem a fita andar (menor)

- **Onde.** `apps/web/e2e/hero.spec.ts:120-124`: espera `getComputedStyle(trilho).transform` diferente de `none`.
- **Cenário.** Isso vale para qualquer animação aplicada, até parada no passo 0 (a matriz identidade): o teste prova que a animação
  existe, não que o trilho anda, como o nome diz.
- **Conserto.** Ler `new DOMMatrix(transform).m41` e esperar que fique negativo (ou que mude entre duas leituras).

### 13. A carteira ficou sem o glifo que o resto do site já tem (menor)

- **Onde.** `apps/web/src/components/wallet-panels.tsx:54` e `:103` (o resultado em `formatBRLSigned`, sem `data-dir`); o comentário de
  `:7-10` e a `conta.md` (desvio 2) dizem que o glifo "mudaria o texto que o e2e compara", o que deixou de valer com o
  `[data-dir]::before` da T3a (`globals.css:207-221`, fora do `textContent`).
- **Cenário.** O mesmo número, o resultado de uma posição, aparece com `▲ ▼ ■` em `/modelos` e `/acoes` (`PositionsTable`) e sem ele em
  `/carteira`.
- **Conserto.** `data-dir={direction(...)}` nas duas células (o e2e não muda) e o comentário atualizado; ou registrar a exceção no TELAS.md.

### 14. O laço da arte baixa o arquivo inteiro depois que a página saiu (menor)

- **Onde.** `apps/web/src/components/arte-viva.tsx:65-78`: a limpeza do efeito não cancela o `requestIdleCallback` (ou o `setTimeout`)
  já agendado, e o `play()` só confere `stopped` depois do `fetch` e do `decode`.
- **Cenário.** No desktop, quem sai da home por navegação suave (o "Ranking completo", um `NavLink`) entre o `load` e o ócio do navegador
  ainda baixa o `escadaria.json` e o `escadaria.png` (uns 380 KB no fio) para uma página que não está mais na tela; o mesmo na 404, com o
  urso.
- **Conserto.** Guardar o id do agendamento e cancelá-lo na limpeza, e conferir `stopped` no começo do `run`.

### 15. Comentário velho no Dockerfile do site (menor)

- **Onde.** `apps/web/Dockerfile:26`: "Garante a pasta public/ (hoje não existe)". Agora ela existe e leva as artes para a imagem (a T2
  deixou anotado, `fundacao.md`, desvio 10).
- **Conserto.** Tirar o "(hoje não existe)".

## Os tokens provisórios `paper` e `band`

`git grep -n -E "(bg|text|border|fill|stroke)-(paper|band)\b" apps/web/src` sai vazio (exit 1), e o mesmo `grep` com os arquivos novos
também. Sobram só as definições, com o `ponytail:`, em `apps/web/src/app/globals.css:45-48`: o fechamento as apaga.

## O que conferi e não achei problema

- **Servidor e cliente.** Os componentes de cliente são os que já existiam (`app/error.tsx`, `account-forms.tsx`, `admin-forms.tsx`,
  `form-kit.tsx`, `wallet-lots.tsx`, `countdown.tsx`) mais o `arte-viva.tsx`. A casca (`layout.tsx`, `site-chrome.tsx`), o hero, a arte, a
  fita, `ui.tsx`, `tables.tsx` e as telas não têm `'use client'`. O `Arte` só é importado por componentes de servidor (`hero.tsx`,
  `not-found.tsx`), e o `ArteViva` devolve `null` e só mexe no DOM depois de hidratar (sem risco de hidratação). O `error.tsx` chega ao
  `ui.tsx` pelo `ApiDown`, que só importa tipos do contrato.
- **A lógica.** `lib/ascii.ts` (o `areaChart` com um ponto, série constante e vazia; o glifo das três direções) e o porte dos testes;
  `lib/fita.ts` (sem anterior, anterior zero, o corte em 40 e a legenda sem a rota); `heroPill` encerrada, antes do primeiro ciclo e sem
  temporada (o caso aberto está no achado 2).
- **Erro e vazio.** `withApiDown` em toda tela que lê a api; `Empty` nos vazios de cada tela; em notícias e ações o comportamento é o
  de antes (a página nula só com o ticker ou a busca inválidos); a 404 não lê a api.
- **A rota interna da fita.** O `QuotesSecretGuard` na classe (SHA-256 dos dois lados e `timingSafeEqual`; o 404 com a frase do
  roteador; sem `QUOTES_SECRET`, 404 para todos); `no-store`; `@ApiExcludeController`; `noQuerySchema` depois do guard; o schema estrito
  com o `refine` (data se e só se há linha); a ordem pela posição do universo; o teto de 500 igual ao `UNIVERSE_RULES.maxMembers`
  (testado); a migration só com o `GRANT SELECT` no grupo; a matriz do `table-policy.ts` e o teste dela; o `NEVER_CACHED` do
  `check.mjs`. No site, o `readTape` passa pelo mesmo `readInternal` do `readBars` (o segredo e o `https` conferidos antes do `fetch`, o
  404 virando 502).
- **O elenco.** O `ensaio.json` com os seis nomes e slugs do rascunho (o `season-files.spec.ts` compara) e só estratégias que não falham;
  a falha passageira do ensaio e o `fake/flaky-json` saíram, e as falhas simuladas ficam com IDs de teste (a api falsa do e2e usa "Modelo
  atrasado"; o HOLD forçado em `gemini-4-argon` do `public-api.integration.spec.ts` é escrito no banco descartável do teste e não aparece
  em tela nenhuma). `isSimulated` vale só para `MODEL` com provedor `fake`, e o ciclo marca pelo `applied.provider`: a etiqueta e o
  aviso somem sozinhos com outro provedor (o `components.spec.tsx` confere `openrouter` e `azure-openai`).
- **O contrato dos testes.** As regiões com nome (a "Cotações e macro" com o h2 em `sr-only`), `dt` e `dd` (`Strip`, `Facts`, o `Hash`
  do ciclo), os `data-*` (`data-action`, `data-candle`, `data-band`, `data-lot`, `data-form-*`) e as classes de mesmo nome. Nenhum
  `uppercase` nem `capitalize` no que o e2e lê: o único é o do campo de ticker (`form-kit.tsx:255`, um `input`, a função que o plano
  manteve). O glifo das células vai por `::before` com o texto alternativo vazio, e o `components.spec.tsx` confere que nenhum `▲ ▼ ■`
  vai no HTML.
- **Segurança e privacidade.** O `QUOTES_SECRET` só em `lib/quotes.ts` (`server-only`); o prompt só com a versão e o SHA-256 (ciclo e
  Como funciona; o e2e procura o canário); a API pública sem mudança (`public.ts`, `cycle.ts` e `public-quotes.spec.ts` fora do diff);
  nenhum segredo, token ou e-mail real nos arquivos novos (só o `demo@example.test` da `estudo.md`); os textos dos termos e da política
  fora do diff (`apps/api/src/modules/account/legal`).
- **Acessibilidade no código.** A arte e a fita com `aria-hidden` e a fita em `sr-only`; o foco de 2 px em âmbar em toda tela; o `.link`
  sempre sublinhado; a caixa de 44 px com a pílula por dentro (`pill`, `chip`, `capsule-item`, `acao`), medida pelo `layout.spec.ts` em
  360 e em 1280 px; o menu com o botão "Menu" com nome, o `popover="auto"` (o Esc e o toque fora fecham) e os links em `<a>`.
- **As mudanças autorizadas nos congelados.** `arte.tsx`: só o `import` do urso e o mapa `ARTES`; `ui.tsx`: só o `title: ReactNode` do
  `PageHead`; `globals.css`: só o `[data-dir]::before` (`:204-221`); `tables.tsx`: o `direction` e o `data-dir` nas células com sinal. Na
  home isso muda só o `data-dir` nas células de retorno da tabela compacta (o quadro do urso fica no servidor; o hero e o quadro da
  escadaria são os mesmos).
- **Dependências e artes.** Nenhuma dependência nova: nos `package.json` só mudou o `start` do `apps/web`, e o `pnpm-lock.yaml` e o
  `pnpm-workspace.yaml` estão fora do diff. O DEPENDENCIAS.md tem a Geist (versão, tamanho e licença pela tabela `name`), o Google Fonts,
  o Higgsfield (com a pendência do Artur), o Arc e uma linha por arte. Conferi as oito: os tamanhos batem; o `git hash-object` dos quatro
  arquivos copiados é o blob do `cddd320` da v1 (`7a3688c8`, `0e6d3a8b`, `35f70e32`, `16669e20`); os `-q0.json` são o `frames[0]` com o
  mesmo `v`, `cols`, `rows` e `fps`; os `-q0.png` são as 120 e as 85 primeiras linhas do sprite, com a mesma paleta e o mesmo `tRNS`
  (descomprimidos e comparados byte a byte por um script de Node fora do repositório).
- **Testes.** Nenhum `.skip` nem `.only` novo (o `test.skip(Boolean(process.env.BASE_URL), …)` do `hero.spec.ts` é o padrão dos outros
  specs). As expectativas que mudaram têm o motivo nos relatórios (`fundacao.md` e as tabelas 5.1 e 5.2 do plano, `conta.md` seção 3,
  `elenco.md`); os testes novos testam o que dizem, fora o achado 12. A `arena.md` ainda não preencheu a lista dela (seção 4), e por isso
  as mudanças de teste da T3a (o glifo no ranking, o urso da 404, o `data-dir` no `components.spec.tsx`) ficam para conferir quando ela
  chegar; no diff de hoje elas são só acréscimos.
- **Docs.** O `CLAUDE.md` (as telas e as duas rotas internas), o `API.md` (seção 6), o `INFRA.md`, o `TELAS.md` (seções 1 a 6 e 10), o
  `PLANO.md`, o `CONTA.md`, o `ARENA.md` e o `ENSAIO.md` batem com o código, fora os achados 4, 5, 7 e 8.

## O que as tarefas deixaram para o fechamento (não contei como achado)

O que a `conta.md` (seção 5) e a `arena.md` (seção 5) pedem no `TELAS.md`, inclusive o pedaço repetido da linha 25 dele; a introdução
da seção "Artes" e a linha do Higgsfield do DEPENDENCIAS.md, que citam só a escadaria; o Lighthouse da home de novo; e apagar `paper` e
`band`.

## Comandos rodados

Node 26.13 (`nvm use`), com o az falso no `PATH` e a guarda de rede (`NET_GUARD_LOG=.data/guardas/t4a-revisao-rede.log`) nos da raiz:

- `pnpm --filter @alvesting/web test`: 35 arquivos, 595 testes, exit 0.
- `pnpm --filter @alvesting/web typecheck` e `pnpm --filter @alvesting/web lint`: exit 0.
- `pnpm typecheck` (5 de 5, do cache do turbo) e `pnpm lint` (turbo e `prettier --check .`): exit 0.
- `pnpm --filter @alvesting/contracts test`: 13 arquivos, 497 testes, exit 0.
- `pnpm docs:check`: "73 itens documentados".
- As guardas: o `t4a-revisao-rede.log` não foi criado (a guarda só o cria ao barrar) e o `.data/guardas/az-stub/calls.log` segue com 0
  linhas.

Não rodei build, e2e, Lighthouse nem `pnpm check` (são do fechamento e do coordenador), e não toquei na demo nem nos bancos.
