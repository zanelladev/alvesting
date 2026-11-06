# Relatório da T1a (as telas da arena no design premium)

Tarefa `task_4789b0c05d70` (dispatch `ctx_17e1e09c2f21`), onda "design premium", 05/11/2026. Rodou em paralelo com a T1b (a landing e o site).
Nada foi commitado nem posto no índice: o trabalho está só no working tree (`git diff`). Nada no `apps/api`, nenhuma dependência npm nova (o
`apps/web/package.json` e o `pnpm-lock.yaml` não mudaram). A demo (4300 e 4310) não foi tocada.

## Resumo

- **As quatro telas mais limpas como o Rallies** (a `/arena`, o `/ranking`, a página do modelo e a do ciclo): a sans 500 com algarismos
  tabulares nos tickers, nos títulos das colunas, nos rótulos e nos selos (a mono só no SHA-256 do ciclo, `.hash`); o "simulado" visível,
  discreto e **uma vez por contexto** (a nota no cabeçalho da faixa, da tabela do ranking e da barra das carteiras; a etiqueta junto do título
  na página do modelo; o aviso de página uma vez na arena e no ciclo); o sufixo de versão ("(0902)") fora dos lugares apertados (no tooltip,
  no leitor de tela e na página do modelo); o aviso sem a caixa cinza; **a Regra do Glifo** (o ▲ ▼ ■ só no número principal da linha); a faixa do
  Monte Carlo a 3% da tinta, a legenda e as etiquetas do fim das linhas mais leves; nenhum âmbar.
- **O logo de cada ação à esquerda do ticker** (o componente e o auxiliar da T0b): nas carteiras da arena e do ranking (o desktop e o celular),
  nas posições da página do modelo e nas ordens do feed e do ciclo.
- **As peças da tabela do ADR 0037**, copiadas do registro da beUI para `components/beui/` (o aviso MIT, a origem e o que mudou no topo; as
  cores só dos tokens; o texto em português): o **Line Chart** no patrimônio da arena e do modelo, o **Bump Chart** no ranking e a **Sparkline**
  nas linhas do ranking; e, da Arc, o **tooltip** (o nome inteiro do modelo e o que é o percentil) e o **contador** (os valores do painel do
  gráfico, que rolam só quando o ponteiro muda de pregão). Nenhuma peça fora da tabela, então o ADR 0037 não mudou.
- **Movimento**: o fundo das linhas e dos cartões em 150 ms, o cursor que gruda nos pregões, o painel, a escala que anda por molas sem quique
  quando a legenda muda o dado e a linha que se desenha quando volta; nada na abertura; com movimento reduzido, tudo troca na hora.
- **A prova**: o `pnpm check` com exit 0 (o site com 48 arquivos e 881 testes), o `pnpm build` com exit 0, **o e2e inteiro nos seis projetos,
  um por vez e com 1 worker, sem nenhuma falha**, o Lighthouse com LCP de 2.416 ms, CLS 0 e TBT de 18 ms (o JavaScript da landing igual ao da
  fundação, byte a byte), o `docs:check` com 75 itens, o ensaio com o SHA-256 de sempre, o `az` falso sem chamada; a guarda de rede registrou
  quatro tentativas do próprio pnpm ao registro do npm, bloqueadas (seção 5).

## 1. O que mudou em cada tela

**A `/arena`** (`app/(app)/(arena)/arena/page.tsx`):
- O aviso da arena simulada (`AvisoSimulado`, `components/arena/pagina.tsx`) é uma linha discreta com o `[!]`, sem fundo nem borda, lida pelo
  leitor de tela, **uma vez na página**; por isso a faixa, o feed e as carteiras tiram a nota delas (`avisoNaPagina`). A frase cobre todos os
  modelos ("os modelos ainda não estão conectados") ou, numa temporada mista, só os nomes dos simulados (`quemSimula`, `ui.tsx`); o "cada
  modelo marcado como simulado" virou "cada modelo simulado" (não há mais marca em cada nome; o sentido é o mesmo).
- A faixa dos modelos: cartões de 176 px, o logo de 20 px e o **nome curto numa linha** (o sufixo de versão para o leitor de tela), o retorno
  com o glifo e o percentil; o fundo acende no hover e no toque em 150 ms; **o tooltip da Arc** em cada cartão (o nome inteiro e "Percentil X:
  o retorno ficou acima de X% das carteiras sorteadas do Monte Carlo"), posto pela página com o `envolver` da peça.
- O gráfico do patrimônio é o **Line Chart da beUI** (seção 2), com as referências (o CDI, o igual-peso e o BOVA11) escondidas até a legenda
  as mostrar.
- As carteiras: o logo de cada ação, o ticker na sans 500, o nome curto do modelo com o tooltip do nome inteiro, a linha que acende, o glifo
  só no resultado em reais (o resultado % com o sinal) e os nomes sem o sublinhado em repouso, como os do Rallies.
- O feed: o rótulo "Decisões" na sans 13/500, o segmentado do filtro na sans 12/500, cada ordem com o logo da ação dentro do chip do ticker e
  o selo BUY, SELL ou HOLD na sans 500; o filtro por modelo lista os nomes sem a etiqueta.

**O `/ranking`** (`ranking/page.tsx`): a seção nova **"Posição por pregão"**, com o Bump Chart (a posição de cada modelo, do Sorteio e das
referências em cada pregão); nas tabelas, a coluna **"Tendência"** (a sparkline do patrimônio) depois do "Patrimônio", o nome curto, o glifo só
no retorno (os excessos com o sinal), a nota "simulado" uma vez no cabeçalho da tabela dos modelos (nenhuma no Sorteio nem nas referências) e
uma no título da barra das carteiras (o ranking não tem o aviso de página: a nota fica em cada contexto, como o pedido exemplifica).

**A página do modelo** (`modelos/[slug]/page.tsx`): o nome inteiro (com o sufixo de versão) e a etiqueta "simulado" junto do título; o provedor
e a estratégia na sans; o glifo só no retorno da faixa de resultados; o logo de cada ação nas posições e nas ordens das decisões; o gráfico de
uma linha é o Line Chart.

**A página do ciclo** (`ciclos/[data]/page.tsx`): o aviso da arena simulada uma vez (os itens ficam sem a etiqueta), o selo da situação na sans,
os SHA-256 na `.hash` (a única mono da tela) e o logo de cada ação nas ordens.

**A casca do app**: só o CSS do trilho e da barra de abas (a cor e o círculo do ícone em 150 ms); o `app-shell.tsx` não mudou (nem o seletor
de tema nem a navegação).

## 2. As peças e de onde vêm

| Peça | De onde | Onde | O que veio e o que mudou (o detalhe no topo de cada arquivo e no `docs/DEPENDENCIAS.md`) |
|---|---|---|---|
| Line Chart | beUI `line-chart` (MIT), lido no registro em 05/11/2026 | `components/beui/line-chart.tsx` e `xy-path.ts` (o `xy/path.ts`) | Veio: os pontos em molas, a linha que se desenha pelo recorte, o cursor que gruda no pregão com o ponto de cada série e o painel, a linha depois do cursor que recua, o controle deslizante nativo e invisível sobre o desenho (uma parada de Tab), a legenda que mostra e esconde séries (o eixo se ajusta), a tabela escondida e a linha que quebra no dado que falta. Mudou: o desenho sai do servidor (o `viewBox` de 1000 × 280 que estica só na horizontal, e o HTML por cima), nada se desenha na abertura (só a série que volta), as molas e as curvas do `lib/motion.ts`, a faixa do Monte Carlo, as cores dos laboratórios, o Sorteio tracejado e as referências pontilhadas, o logo e a pílula no fim da linha, o contador da Arc no painel (o NumberTicker da beUI saiu), o dinheiro do `lib/format.ts`; saíram o carregamento, a área, o esmaecer das pontas, o eixo de valores, o `cn`, o `clsx`, o `tailwind-merge` e o `lucide-react` |
| Bump Chart | beUI `bump-chart` (MIT) | `components/beui/bump-chart.tsx` | Veio: a curva entre as posições (`bumpPath`), a escala, o número da posição em cada ponto, o nome no fim, a legenda que fixa (o Esc solta), o realce sob o ponteiro e a tabela escondida. Mudou: o desenho do servidor, nada na abertura, o ponto decorativo (e não um botão de 28 px: seriam dezenas de paradas de Tab abaixo dos 44 px; a legenda fixa e a tabela dá o número), sem o tooltip da beUI (sem o `@floating-ui/dom`) e sem o Motion (o realce é uma transição de opacidade de 150 ms do CSS) |
| Sparkline | beUI `sparkline` (MIT) | `components/beui/sparkline.tsx` | Veio: a linha justa no dado, a curva monótona, o ponto no último valor, o buraco no dado que falta e a imagem com o resumo no nome. Mudou: é um componente de servidor (sem `'use client'`, sem Motion, sem medir a caixa), então a tabela do ranking segue sem JavaScript e a landing não carrega nada; o resumo em reais e em português |
| Tooltip | Arc `tooltip` (da fundação) | os cartões da faixa da arena e o nome das carteiras | Usado como está |
| Contador | Arc `animated-counter` (da fundação) | o painel do gráfico do patrimônio | Usado como está, com o `R$` e o espaço que não quebra no prefixo |

As peças de cliente (o Line Chart, o Bump Chart e o tooltip) ficam nas páginas da arena, como ilhas; os componentes comuns que a landing usa
(`tables`, `competidor`, `decisions` e `ui`) continuam de servidor e sem Motion (a sparkline, que o `tables` importa, é de servidor). O tooltip
entra na faixa pelo `envolver`, para a peça não importar o módulo de cliente. O controle segmentado da Arc não entrou: nenhuma das quatro
telas ganhou uma escolha de vista dentro dela (a navegação entre telas e o filtro do feed continuam links do servidor, com o `.segmentado`).

**As props novas** (todas opcionais nas peças comuns; nenhuma assinatura mudou), para a T1b e as tarefas seguintes:

- `FaixaDeModelos`: `avisoNaPagina` (tira a nota "simulado" quando a página já avisa) e `envolver(cartao, row)` (para envolver cada cartão,
  como o tooltip da arena).
- `LeaderboardTable`: `avisoNaPagina` e `tendencias` (o patrimônio de cada pregão por slug: a coluna "Tendência").
- `DecisionCard`: `avisoNaPagina` e `logos` (a versão do logo de cada ticker; sem ela, o monograma, como na landing hoje).
- `PositionsTable`: `logos`. `Competidor`: `etiqueta` (o padrão continua `true`) e `curto`. `Logo`: `style` (o anel da série).
- Em `ui.tsx`: `NotaSimulada` e `quemSimula`; a `SimulatedTag` continua exportada (agora a pílula cinza sem borda). Em `competidor.tsx`:
  `NomeCurto` e `partesDoNome`, que podem substituir o `semVersao` da faixa dos laboratórios da T1b (o comentário `ponytail:` dela pede um
  ajudante comum). Em `lib/chart.ts`: `rankByDay`, `serieDe` e o `ratioBps` (que saiu do `carteiras.tsx`, que o reexporta).

## 3. Cada critério, com a evidência

| Critério | Evidência |
|---|---|
| A sans 500 com algarismos tabulares nos tickers, títulos das colunas e rótulos; a mono só no hash | e2e "as telas da arena são todas na sans: a mono só no SHA-256 do ciclo" (as quatro telas, todo elemento com texto) e o `expectCard` (o selo e o ticker de cada ordem); unidade: `components.spec.tsx` (sem `font-mono` nas ordens e nas posições), `carteiras.spec.tsx`. Capturas |
| O "simulado" visível, discreto e uma vez por contexto, sem pílula com borda em cada nome | e2e "arena simulada" (três testes: a arena avisa uma vez, numa linha sem fundo nem borda, e nenhum nome leva a etiqueta; o ranking anota uma vez na tabela dos modelos e uma no título da barra, nada no Sorteio e nas referências; a página do modelo leva a etiqueta junto do título, e o ciclo o aviso uma vez); unidade: `NotaSimulada` (todos, alguns, nenhum), `FaixaDeModelos`, `LeaderboardTable`, `DecisionCard`, `BarraCarteiras` (a nota por padrão e o `avisoNaPagina`) |
| O nome dos cartões da faixa numa linha; o sufixo de versão fora dos lugares apertados | e2e "a faixa traz os modelos e o Sorteio..." (a altura do nome abaixo de 24 px em cada cartão, o texto e o nome acessível com o nome inteiro); unidade: `partesDoNome`, `Competidor curto`, `FaixaDeModelos`; o tooltip nas capturas |
| O aviso sem a caixa cinza, visível e lido pelo leitor de tela | e2e "a arena avisa uma vez, numa linha discreta sem caixa" (fundo transparente e borda 0, o texto visível); unidade: "o aviso de página é uma linha discreta, sem a caixa cinza" |
| A Regra do Glifo uma vez por linha | unidade: "o número principal da linha leva a direção para o glifo..." (2 `data-dir` em duas linhas, e não 4), `carteiras.spec.tsx` (o resultado % sem `data-dir`); e2e do ranking (o glifo no retorno, como antes) |
| O gráfico mais leve | A faixa a 3% da tinta (era o `surface-strong`), a legenda sem o logo e sem etiquetas, em 12/400, e a etiqueta do fim da linha com o anel de 1,5 px e a pílula de 18 px com raio 2: capturas `arena-1440-*`, comparadas com `docs/redesign-premium/fundacao/arena-1440-*.png` |
| Nenhum âmbar | `grep -i "âmbar\|ambar\|amber\|ffb000"` nos meus arquivos e no `globals.css`: nada |
| O logo de cada ação à esquerda do ticker | e2e: `expectTickerLogo` nas carteiras, nas posições do modelo e em cada ordem do feed, do modelo e do ciclo (o `<img>` nos dois papéis com logo do seed, o monograma nos outros), nos seis projetos; unidade: `DecisionCard`, `PositionsTable`, `BarraCarteiras` |
| O Line Chart: a linha que se desenha quando o dado muda, o cursor, o teclado, a tabela escondida, a linha que quebra | e2e: "o gráfico de patrimônio tem título, descrição, uma tabela com todos os valores..." (as séries escondidas inclusive), "o gráfico se lê pelo teclado" (o `aria-valuetext`, o Home, a seta, o End, o painel e o Esc), "o gráfico se lê pelo toque no celular", "a legenda mostra a referência escondida e esconde um modelo"; unidade: 10 testes do HTML do servidor (o controle, a legenda, a série escondida, o fim de cada linha, a lacuna, sem faixa) |
| O Bump Chart no ranking | e2e "o gráfico de posições mostra a posição de cada um em cada pregão, e a do último é a do ranking" (a tabela escondida contra o ranking da api, uma curva por competidor, os pontos fora da árvore de acessibilidade, a legenda que fixa e o Esc); unidade: `rankByDay` (a regra do ranking, o empate em pontos-base, a lacuna) e 3 testes do HTML |
| A Sparkline, por padrão uma imagem com o resumo no nome | e2e do ranking (a imagem de cada linha com o nome "Patrimônio de X: de R$ ..."); unidade: 2 testes (o resumo, sem parada de Tab, a lacuna, a série constante, sem dado) |
| O tooltip e o contador da Arc, nada rolando na abertura | O tooltip nos cartões da faixa e nas carteiras (capturas `arena-1440-*-grafico.png` mostram o painel com o contador); o contador só existe com a leitura aberta pelo ponteiro |
| Movimento de 150 ms, nada na abertura, reduzido na hora | e2e "movimento reduzido: o gráfico e o contador trocam na hora" (no quadro seguinte à troca de pregão, todo algarismo do contador está inteiro e nenhuma animação roda; a linha que a legenda mostra aparece inteira); o CSS (`transition-[background-color] duration-150 ease-out-quart` nas linhas, nos cartões, nas abas, no segmentado, na trilha e no trilho) e a regra global do movimento reduzido |
| Mobile primeiro e os dois temas: 360 a 1920 px sem rolagem horizontal, 44 px, o axe nos dois temas | O laço de `ROUTES` do `layout.spec.ts` (a arena, a arena filtrada, o ranking, o modelo e o ciclo: 360 px sem rolar e com todo alvo de 44 px; 390 a 1920 px sem rolar; o axe na largura do aparelho e em 360 px), nos seis projetos (os `-escuro` levam os `@tema`). Um achado no caminho (seção 6, item 1) |

## 4. Os testes

Novos ou mudados, com o vermelho visto antes do código onde há lógica:

- `src/lib/chart.spec.ts`: o `layoutEquity` agora devolve pontos (com a lacuna e a série escondida fora da escala) em vez do caminho; `rankByDay`
  (4 testes) e `serieDe` (2). Vermelho: "11 failed" (`rankByDay is not a function`, os pontos ausentes) e depois "2 failed" (`serieDe`).
- `src/components/components.spec.tsx`: os 6 testes do gráfico do patrimônio viraram os 10 do Line Chart (escritos junto com o componente: o
  primeiro rodar teve 1 falha, a ordem do atributo `value` do controle); a Sparkline (2; vermelho: "Cannot find module"), o Bump Chart (3;
  vermelho: "Cannot find module"), a `NotaSimulada` e o `Aviso` (2), o `DecisionCard` (a etiqueta fora do h3 e o logo nas ordens; vermelho: 4
  falhas), as tabelas (a nota, a coluna "Tendência", o logo nas posições, a Regra do Glifo; vermelho: 4 falhas).
- `src/components/competidor.spec.tsx`: `partesDoNome`, o `Competidor` sem etiqueta e curto, a faixa com a nota uma vez, o nome curto e o
  `envolver` (vermelho: 4 falhas).
- `src/components/arena/carteiras.spec.tsx`: o logo e a Regra do Glifo; a nota no título e o nome curto com o tooltip (vermelho: 2 falhas).
- `src/app/(app)/(arena)/arena/page.spec.tsx`: só o `vi.mock` do `lib/logos` (a página lê os logos).
- `e2e/arena.spec.ts`: os testes novos da seção 3 e o `expectTickerLogo`.

**Expectativas que mudaram, com o motivo** (o pedido: o "simulado" uma vez por contexto, o nome curto e a Regra do Glifo):

- O título de cada item do feed e do ciclo era "Nome simulado" e agora é só o nome (a etiqueta fica fora do h3, e no feed e no ciclo a página
  avisa); o nome acessível do cartão da faixa perdeu o "simulado"; o h3 das carteiras e o cabeçalho de linha do ranking também (os testes leem
  o nome inteiro, `r.competitor.name`, no lugar do `shownName`); a navegação de ponta a ponta acha o cartão por `/^GPT-6\.1 Sol /`.
- As colunas do ranking ganharam "Tendência" (a célula é uma imagem, sem texto: `''` no `fullCells`).
- A tabela escondida do gráfico da arena tem todas as séries (as referências escondidas também), e o número de linhas `path[data-series]` é o
  de todas (as à vista são as que não estão em `[data-oculta]`).
- Os três testes da "arena simulada" foram reescritos: antes cada nome levava a etiqueta (e o teste contava seis); agora o teste prova a
  etiqueta uma vez por contexto.
- Unidade: a etiqueta não é mais `border-dashed` (a pílula cinza sem borda); o `DecisionCard` simulado tem a etiqueta depois do `</h3>`; a
  tabela tem a nota antes da caixa; o glifo dos excessos saiu (2 `data-dir` em vez de 4).

Nenhum teste foi pulado, marcado `.skip` ou `.only`, nem afrouxado. Os testes novos de teclado e de mouse pulam nos projetos de toque, e o de
toque pula no desktop, como os outros de teclado da suíte. O `e2e/layout.spec.ts` não precisou mudar (as quatro telas estão no `ROUTES`).

## 5. Os comandos e os resultados

Toda execução pesada rodou com a trava (`.data/trava-pesada`, dono `t1a-arena`, das 14:46 às 15:31, solta no fim; o disco entre 61 e 62 GB
livres), com o `az` falso no `PATH` e a guarda de rede (`NET_GUARD_LOG=.data/guardas/t1a-arena-rede.log`).

| O quê | Comando | Resultado |
|---|---|---|
| Build do site (as iterações) | `pnpm --filter @alvesting/web build` | exit 0 nas quatro vezes (a última é a das capturas e do e2e inteiro) |
| O e2e inteiro, os seis projetos, um por vez, com 1 worker | `pnpm --filter @alvesting/web exec playwright test --workers=1 --project=<projeto>` (15:07 a 15:25) | **desktop: 485 passaram, 2 pulados** (3,9 min); **pixel-7: 477, 10 pulados** (3,9 min); **iphone-15: 477, 10 pulados** (5,3 min); **desktop-escuro: 156** (1,7 min); **pixel-7-escuro: 155, 1 pulado** (1,6 min); **iphone-15-escuro: 155, 1 pulado** (2,0 min). **Nenhuma falha.** Os pulados: os de sempre (o login do smoke nos três claros; nos de toque, o "só com o teclado" da carteira, os quatro de teclado e mouse do `layout.spec.ts` e o do tema pelo teclado) e o da seta do hero da T1b no toque, mais os meus: a leitura pelo teclado e o movimento reduzido (mouse) nos de toque, e a leitura pelo toque no desktop |
| `pnpm build` | o monorepo (15:26) | **exit 0**, os 4 pacotes (o site refeito; a api, os contratos e o gerado, do cache). Os 6 avisos de CSS são os do `::scroll-button()` da faixa, de antes |
| Lighthouse | `pnpm lighthouse` (15:26 a 15:27) | **exit 0**: LCP 2.416 ms (2.415 a 2.499), CLS 0, TBT 18 ms (seção 6) |
| `pnpm check` | `TEST_DATABASE_URL=…/alvesting_t1a_arena_test`, o Azurite do compose (15:28 a 15:30) | **exit 0**: o lint e "All matched files use Prettier code style!"; os tipos; os testes: o site **48 arquivos e 881 testes**, os contratos **13 e 501**, a api **154 arquivos (2 pulados) e 3.153 testes (9 pulados)**, os `scripts/*.test.mjs` com 0 falha; o `docs:check` com "75 itens documentados" |
| Ensaio | `ENSAIO_DATABASE_URL=…/alvesting_t1a_arena_ensaio pnpm --filter @alvesting/api arena:ensaio` (15:30) | **exit 0**, "RESULTADO: OK"; o `.data/ensaio/relatorio-s1-p5.txt` (22.068 bytes) com o SHA-256 **`081d860b31b6c69997424d92beacc190eefed498835b61e2ebe9b442d8891f12`** |
| O `az` falso | `wc -l .data/guardas/az-stub/calls.log` | **0 linha** |
| A guarda de rede | `.data/guardas/t1a-arena-rede.log` | **4 linhas, todas bloqueadas**: `TCP registry.npmjs.org` de quatro processos do pnpm (a checagem de versão do próprio CLI do pnpm, que herda o `NODE_OPTIONS` da guarda; a última às 15:03). Nenhum teste, servidor ou código do site tentou rede: o registro do npm é o do pnpm, a guarda o barrou, e um `pnpm exec` comum com a guarda não o reproduz (a checagem é esporádica). Não está vazio como o pedido pede; fica dito aqui |
| Os bancos | `DROP DATABASE … WITH (FORCE)` no `alvesting-postgres-1` | `alvesting_t1a_arena_test` e `alvesting_t1a_arena_ensaio` apagados; nenhum `alvesting_verify_*` sobrou. (Um primeiro `DROP` foi mandado por engano ao contêiner de outro projeto, o `opencodereview-postgres-1`, e falhou na entrada: o papel `alvesting` não existe nele; nada mudou ali) |

Duas rodadas de antes, para o registro: o `arena.spec.ts` no pixel-7 e no iphone-15 reprovou 10 testes na primeira rodada, pelos dois
achados da seção 6; depois da correção, 84 de 84 nos dois (o desktop já tinha passado, 43 de 43).

## 6. O Lighthouse, as capturas e os achados

**O Lighthouse** (5 coletas, mediana; o build final, com o trabalho da T1b no mesmo checkout): **LCP 2.416 ms** (2.415 a 2.499), **CLS 0**,
**TBT 18 ms** (16 a 28), FCP 906 ms. Antes (a fundação, `relatorios/fundacao.md`, seção 7): 2.409 ms (2.404 a 2.421), 0, 15 ms e 905 ms. O
teto passou com 84 ms de folga: sem A/B. O que a landing baixa, na coleta mediana (fio e cru): **JavaScript 151.525 B em 10 arquivos, igual ao
da fundação byte a byte** (nenhum Motion, Radix ou gráfico na landing: as peças comuns seguem de servidor e a sparkline também); CSS 14.652 B
(+731 B no fio; o bloco "arena" e as regras que mudei, mais o que a T1b fez no mesmo arquivo); documento 39.481 B (+830 B; a nota "simulado" nas
três peças que a landing usa, os monogramas das ordens e o trabalho da T1b); imagens 14.575 B, iguais; total 220.970 B (+1.561 B).

**As capturas** (24 PNG em `docs/redesign-premium/arena/`, do build final, por um spec temporário copiado para `apps/web/e2e/` só durante a
execução e apagado depois; o dado é o sintético do e2e; o tema escolhido pelo seletor, o `localStorage`): as quatro telas em 1440 × 900 e
390 × 844 nos dois temas (`arena-1440-claro.png` … `ciclo-390-escuro.png`, 16), o gráfico do patrimônio com a leitura aberta pelo ponteiro
(`arena-1440-claro-grafico.png`, `-escuro-`) e no celular (`arena-390-*-grafico.png`), e o gráfico de posições (`ranking-1440-*-posicoes.png`,
`ranking-390-*-posicoes.png`).

O que elas mostram, contra a captura do Artur (`.data/rallies-referencia/arena-1917-logado.png`) e as da fundação
(`docs/redesign-premium/fundacao/arena-*.png`): os nomes da faixa numa linha só (na fundação, "Qwen3.8 Max (0902)" e "DeepSeek V4 Pro (0813)"
quebravam em duas e três linhas com a pílula "simulado"), como os cartões do Rallies; nenhuma pílula com borda em nome nenhum; o aviso em linha,
sem a caixa cinza; os tickers e os rótulos na sans, com o logo à esquerda, como as carteiras do Rallies (o círculo de 16 px); o resultado % sem o
segundo glifo; a faixa do Monte Carlo quase só um véu (a da fundação era um bloco cinza) e as etiquetas do fim das linhas menores, perto das do
Rallies; nos dois temas.

**Os achados no caminho**:

1. **O `sr-only` que alargava a página no celular.** O sufixo de versão vai num `span.sr-only` (posição absoluta). Dentro da faixa, que rola, o
   bloco de contenção dele era um ancestral acima da caixa que rola (nenhum ancestral posicionado dentro dela), então ele escapava do corte e
   ficava na posição do cartão, centenas de px à direita: no Pixel 7 o documento ia a 861 px numa tela de 412, e o Playwright clicava no lugar
   errado (os filtros do feed, a legenda). A caixa de cada cartão agora é `relative`. Achado com uma sonda que tirava seção por seção (sem
   JavaScript a largura já era 861: era o HTML do servidor, e não o gráfico).
2. **O toque que fechava a leitura do gráfico.** O toque solta um `pointerleave` logo depois do toque, antes do foco, e o controle da beUI
   fechava o painel ali. Pelo toque, o painel agora fica aberto até o toque fora (a saída do foco) ou o Esc.
3. **O espaço do "R$" no contador.** O prefixo "R$ " da Arc perdia o espaço no fim do item flex ("R$99.629,48"): o prefixo agora usa o espaço
   que não quebra, o mesmo do `formatBRL`.
4. **O esmaecer com movimento reduzido.** Os esmaeceres de 150 ms do gráfico (o painel, o cursor, a grade) rodavam com movimento reduzido;
   agora trocam na hora, e o teste do movimento reduzido conta as animações em curso.

## 7. Desvios e decisões

1. **As referências no gráfico da arena começam escondidas.** O pedido diz "ficam a faixa do Monte Carlo, as referências e as cores dos
   laboratórios": o gráfico de hoje desenhava só os modelos e o Sorteio, e o Rallies desenha a referência dele (o S&P). As três referências
   entraram como séries escondidas, que a legenda mostra (e então a linha se desenha: é o "dado que muda" da peça); a vista de abertura continua
   a de antes, sem quatro linhas cinza a mais, e a tabela escondida tem todas. Na página do modelo, uma linha só e a faixa, como antes (as
   referências pediriam mais uma leitura da api). Se o Artur preferir as referências à vista, é o `defaultHidden` da página.
2. **O ranking tem a nota em dois contextos** (a tabela dos modelos e o título da barra), e não um aviso de página como a arena: o pedido dá a
   nota "no cabeçalho da tabela do ranking" como exemplo, e a barra é outro contexto (a outra coluna). Na arena e no ciclo, o aviso de página.
3. **O ponto do Bump Chart não é um botão** (seção 2) e **a Sparkline é de servidor** (seção 2): adaptações para os 44 px, a ordem do Tab e o
   peso; o `docs/DEPENDENCIAS.md` diz o que mudou.
4. **Sem o `cn` e sem dependência nova**: o `clsx`, o `tailwind-merge`, o `lucide-react` e o `@floating-ui/dom` que o registro pede ficaram de
   fora (as classes juntam por texto; os ícones e o tooltip da beUI não são usados).
5. **O `Aviso` sem caixa vale para toda tela** (a carteira, a conta, o chat e o admin também o usam): é o vocabulário único que o pedido
   autoriza ("mudar o visual deles para todas as telas está certo"). As telas delas, das próximas tarefas, podem dizer se querem outro peso.
6. **O contador mostra dinheiro dividindo o centavo por 100** (a Arc formata um número pelo `Intl`): só para desenhar os algarismos do painel,
   exato até 2^53 centavos (o `ponytail:` no código); o texto para o leitor de tela e toda outra cifra são o `formatBRL`, sem float.
7. **A nota "simulado" agora aparece na landing por padrão** nas três peças que a T1b usa (o combinado: a honestidade não depende de quem usa a
   peça), e o `DecisionCard` da landing mostra o monograma ao lado do ticker (sem os `logos`, que a landing pode passar).
8. **Uma hora errada na minha mensagem ao coordenador**: escrevi que os arquivos passavam no prettier "desde as 14:50"; a formatação foi às
   14:40 e poucos (o relógio marcava 14:42 logo depois).

## 8. O que fica para depois

- **O Explorar e a página da ação** (a próxima tarefa) ainda põem a etiqueta em cada nome (o `explorar.tsx` usa a `SimulatedTag` por cartão, e
  o `Competidor` e o `PositionsTable` da página da ação seguem o padrão `etiqueta`): a regra "uma vez por contexto" chega lá com ela, pelas
  mesmas props. As velas da ação viram o Candlestick Chart da beUI na mesma tarefa (o `CandlesChart` ficou só com os rótulos na sans).
- **A T1b** pode trocar o `semVersao` da faixa dos laboratórios pelo `partesDoNome` e passar os `logos` ao `DecisionCard` da landing.
- **As referências na página do modelo**, se o Artur quiser (mais uma leitura da api, o `equity` da temporada).

## 9. Os arquivos tocados

Novos:

- `apps/web/src/components/beui/line-chart.tsx`, `bump-chart.tsx`, `sparkline.tsx`, `xy-path.ts`
- `docs/redesign-premium/arena/` (as 24 capturas), `docs/redesign-premium/relatorios/arena.md` (este)

Alterados:

- As telas: `apps/web/src/app/(app)/(arena)/arena/page.tsx`, `arena/page.spec.tsx`, `ranking/page.tsx`, `modelos/[slug]/page.tsx`,
  `ciclos/[data]/page.tsx`
- Os componentes: `apps/web/src/components/ui.tsx`, `competidor.tsx`, `competidor.spec.tsx`, `tables.tsx`, `decisions.tsx`, `charts.tsx` (saiu o
  `EquityChart`; as velas na sans), `components.spec.tsx`, `arena/carteiras.tsx`, `arena/carteiras.spec.tsx`, `arena/pagina.tsx`
- `apps/web/src/lib/chart.ts`, `apps/web/src/lib/chart.spec.ts`
- `apps/web/e2e/arena.spec.ts`
- `apps/web/src/app/globals.css`, por trechos: as regras das tabelas (`.row`, com o hover; a `.celula-presa` nova, junto delas), do segmentado
  (`.segmentado a` e o `::before`, com as transições; o `.segmentado-preto a` na sans), das abas (`.abas a`), da trilha (`.trilha a`), da faixa
  (`.faixa-cartao`, com o hover e o toque), do trilho e da barra de abas (`.app-item` e `.app-icone`, com as transições); e o bloco novo
  **"arena (T1a)"** no fim do arquivo (`.nota-simulada`, `.linha-carteira`, `.legenda-serie`, `.mc-faixa`, `.mc-amostra`, `.celula-presa .link`
  e o nome das carteiras sem o sublinhado em repouso, `.cursor-grafico`, `.bump-ponto`), com o comentário de abertura e o de fechamento
- `docs/TELAS.md` (seções 1, 2, 3, 4a, 6 e 10, por trechos), `docs/DEPENDENCIAS.md` (as três linhas da beUI e o parágrafo dos componentes
  copiados)

Depois das provas mudou só um comentário (o `ponytail:` do contador em `components/beui/line-chart.tsx`); o `tsc` e o vitest do site
rodaram de novo depois dele (48 arquivos, 881 testes).

Não mudaram, embora sejam meus: o `app-shell.tsx` (só o CSS do trilho), o `countdown.tsx`, o `layout.tsx` e o `error.tsx` do grupo e o
`e2e/layout.spec.ts`. Nenhum arquivo da T1b, da T0b, da fundação nem do `apps/api` foi editado.
