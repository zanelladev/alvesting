# Relatório da tarefa T4b (QA mobile ao vivo): o site de verdade, no celular e no computador

Tarefa `task_1c17c777e433`, onda "design ASCII + elenco" (Run `run_ee238b5b17cc`), 04/11/2026. Só leitura: nenhum arquivo do código foi
tocado; o que entrou no repositório é este relatório e as capturas dos achados em `docs/redesign-ascii/qa/`. Nada foi commitado nem posto no
índice. A lista é para a tarefa de fechamento consertar.

O alvo foi a demo (http://127.0.0.1:4300, o `next dev` deste checkout, com a api em 4310 e o banco do ensaio: a temporada encerrada de 20
pregões, os seis modelos simulados, o último ciclo em 01/12/2026). A conta da demo serviu para `/conta`, `/carteira` e `/admin`.

## 1. Resumo

- **Nenhum achado que bloqueia.** Em todas as telas e larguras: nenhuma rolagem horizontal, nenhum texto cortado ou por cima de outro, todo
  alvo de toque com 44 × 44, o axe sem violação (todas as gravidades, 53 execuções), todo campo com 16 px (sem zoom no iPhone), a arte
  nunca atrás de texto, o movimento reduzido parando a arte e a fita, e o menu, o teclado e os formulários funcionando.
- **5 importantes**: o toque fora da folha do menu atravessa e segue o link de baixo (A1); pelo teclado, o foco sai da folha aberta e
  some embaixo dela (A2); a caixa de marcar e o radio desmarcados quase não aparecem (A3); entre 768 e ~880 px a legenda dos gráficos fica
  espremida numa coluna de ~120 px (A4); e a caixa da moldura por cima do conteúdo deixa o axe cego para o contraste no desktop, inclusive
  no e2e em 1280 px (A5).
- **13 menores**, de acabamento: "visão neutro" (A6), o nome sem a etiqueta "simulado" na legenda do patrimônio (A7), o BOVA11 sem o glifo
  (A8), o ranking no desktop (A9), as listas sem recuo (A10), o ritmo dos cartões de notícia (A11), o rodapé (A12), a grade da
  "Temporada" (A13), o tamanho dos rótulos dos gráficos (A14), o erro da DLQ no painel (A15), o `:active` sob movimento reduzido (A16), o
  ícone do botão "Menu" (A17) e a caixa de marcar inválida sem a borda vermelha (A18).
- O conserto de A1 e A2 sem JavaScript foi provado no navegador do teste (seção 4, A1): a folha até o fim da tela com um botão "Fechar o
  menu" e uma regra de CSS.

## 2. Como foi feito

**Ferramentas.** O `@playwright/test` 1.64.1 do `apps/web` (Chromium 1248 headless e WebKit 2370) e o `@axe-core/playwright` 4.14.0, com
os scripts em `.data/orquestracao/qa/` (fora do git), a partir do `capturar.mjs` do estudo. Um navegador por vez, fechado ao fim de cada
script. O indicador do `next dev` escondido (`nextjs-portal{display:none!important}`) nas capturas e excluído do axe. Medida em
`deviceScaleFactor` 1; as capturas dos achados de celular em 2x.

**Telas** (20): `/`, `/ranking`, `/modelos/deepseek-v4-pro`, `/modelos/qwen3-8-max`, `/ciclos/2026-12-01`, `/noticias`,
`/noticias?ticker=DOBR4`, `/acoes`, `/acoes?q=SIM`, `/acoes/DOBR4`, `/como-funciona`, `/termos`, `/privacidade`, `/entrar`, `/cadastro`,
`/esqueci-senha`, `/rota-que-nao-existe` e, com a conta da demo, `/conta`, `/carteira` e `/admin`. **Larguras**: 360 × 800, 390 × 844,
412 × 915 e 768 × 1024 (com toque) e 1024 × 768, 1280 × 800 e 1440 × 900, no Chromium; e o iPhone 15 do Playwright (393 × 659, WebKit) nas
13 telas principais.

**O que cada carga mediu** (`medir.mjs`): `scrollWidth` e `body.scrollWidth` contra `clientWidth`; cada linha de texto visível (pelos
retângulos do `Range`) contra o ancestral que corta (`overflow` escondido) e contra a tela; texto que sai da caixa visível que o contém
(cartão, pílula, etiqueta, botão); texto por cima de texto; todo `a[href]`, `button`, `input`, `select`, `textarea`, `summary` e
`[role=button]` visível com menos de 43,95 px (o seletor e a folga do `layout.spec.ts`) e alvos que se cobrem; a fonte de cada h1, h2 e
h3; o corpo de cada campo; cada nome de modelo com ou sem a etiqueta "simulado" ao lado; os dois avisos; os erros de console, as exceções
e os pedidos que falham; e o axe em 360 e 1440 (Chromium) e no iPhone 15. Mais: a arte sob o texto (uma captura só com a arte visível e os
pixels acesos dentro de cada linha de texto), o menu (abrir, Esc, toque fora, cada link), o Tab com o anel de foco, o movimento reduzido
(os pedidos de arquivo, o quadro e a fita) e os formulários (erros, "Enviando…", zoom do iPhone).

**O que foi enviado à api**: só o login da conta da demo, uma vez (com o envio segurado 1,5 s no navegador, para ver o "Enviando…"); a
sessão foi reaproveitada em todo o resto. Os formulários levaram só erro proposital (vazio, e-mail inválido), barrado no navegador, e o
caso do servidor fora foi um pedido cortado pelo `page.route` antes de sair. Nada lançado, editado, apagado, aceito ou exportado, nenhuma
ação do `/admin`, nenhuma sessão encerrada. Sem build, e2e, Lighthouse, `pnpm check`, `az` nem rede externa.

Para refazer (Node 26.13; a sessão fica num arquivo fora do repositório):

```sh
cd .data/orquestracao/qa
QA_STATE=<sessao.json> node qa.mjs login                    # o login da demo, uma vez
QA_STATE=<sessao.json> node qa.mjs matriz chromium          # 20 telas × 7 larguras; "webkit" para o iPhone 15
node qa.mjs arte chromium                                   # a arte sob o texto
QA_STATE=<sessao.json> node qa2.mjs menu|teclado|movimento|forms chromium|webkit
QA_STATE=<sessao.json> node qa3.mjs                         # as capturas dos achados (em evid/), e o :active do A16
python3 marcar.py                                           # o tracejado vermelho do A1 e do A2, por cima da folha
QA_STATE=<sessao.json> node axe-moldura.mjs                 # A5: o axe em 1440 com e sem a moldura
node conserto-menu.mjs; node conserto-menu2.mjs             # A1 e A2: o conserto sugerido, injetado só no navegador do teste
node linhas.mjs; node rotulos.mjs; node ritmo.mjs           # A9, A14 e A11: as medidas e o recorte
node moldura.mjs; node expandido2.mjs                       # a moldura com a barra clássica; o estado "expandido" do botão
node analisar.mjs out/matriz-chromium.json                  # o resumo da matriz
```

## 3. A matriz

`ok` é tela sem achado naquela largura; o número é o achado (seção 4); `—` é tela fora da lista do iPhone. A primeira linha é a casca
(cabeçalho, menu e rodapé), que vale para toda tela.

| Tela | 360 | 390 | 412 | 768 | 1024 | 1280 | 1440 | iPhone 15 (WebKit) |
|---|---|---|---|---|---|---|---|---|
| casca (toda tela) | 1, 2, 12, 16, 17 | 1, 2, 12, 16, 17 | 1, 2, 12, 16, 17 | 1, 2, 16, 17 | 16 | 5, 16 | 5, 16 | 1, 12, 16, 17 |
| `/` | 6, 7, 8, 14 | 6, 7, 8, 14 | 6, 7, 8 | 4, 6, 7, 8, 13, 14 | 6, 7, 8, 13, 14 | 6, 7, 8, 13, 14 | 6, 7, 8, 13, 14 | 6, 7, 8, 14 |
| `/ranking` | 10 | 10 | 10 | 10 | 10 | 9, 10 | 9, 10 | 10 |
| `/modelos/deepseek-v4-pro` | 7, 14 | 7, 14 | 7 | 4, 7, 14 | 7, 14 | 7, 14 | 7, 14 | 7, 14 |
| `/modelos/qwen3-8-max` | 7, 14 | 7, 14 | 7 | 4, 7, 14 | 7, 14 | 7, 14 | 7, 14 | — |
| `/ciclos/2026-12-01` | 6 | 6 | 6 | 6 | 6 | 6 | 6 | 6 |
| `/noticias` | 11 | 11 | 11 | ok | ok | ok | ok | 11 |
| `/noticias?ticker=DOBR4` | ok | ok | ok | ok | ok | ok | ok | — |
| `/acoes` | ok | ok | ok | ok | ok | ok | ok | — |
| `/acoes?q=SIM` | ok | ok | ok | ok | ok | ok | ok | — |
| `/acoes/DOBR4` | 14 | 14 | ok | 4, 14 | 14 | 14 | 14 | 14 |
| `/como-funciona` | 10 | 10 | 10 | 10 | 10 | 10 | 10 | 10 |
| `/termos` | ok | ok | ok | ok | ok | ok | ok | — |
| `/privacidade` | ok | ok | ok | ok | ok | ok | ok | — |
| `/entrar` | ok | ok | ok | ok | ok | ok | ok | ok |
| `/cadastro` | 3, 18 | 3, 18 | 3, 18 | 3, 18 | 3, 18 | 3, 18 | 3, 18 | 3, 18 |
| `/esqueci-senha` | ok | ok | ok | ok | ok | ok | ok | — |
| 404 (`/rota-que-nao-existe`) | ok | ok | ok | ok | ok | ok | ok | ok |
| `/conta` | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 3 |
| `/carteira` | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 3 |
| `/admin` | 3, 7, 15 | 3, 7, 15 | 3, 7, 15 | 3, 7, 15 | 3, 7, 15 | 3, 7, 15 | 3, 7, 15 | 3, 7, 15 |

O A2 (teclado) não foi medido no WebKit (o Tab do WebKit do Playwright não percorre links como o do Safari com teclado); o A5 vale a partir
de 1202 px, onde a moldura aparece.

## 4. Os achados

### Importantes

#### A1. O toque fora da folha do menu atravessa e segue o link de baixo

- **Onde**: toda tela abaixo de 1024 px (medido em `/ranking` em 360, 390, 412 e 768 no Chromium e no iPhone 15, WebKit).
- **O que está errado**: com a folha aberta, a página por baixo aparece escurecida (o `::backdrop`), como se estivesse inativa. Tocar
  nela para fechar a folha fecha, **e** o toque segue para o que está embaixo: em cima de "Gemini 4 Argon", a tela vai para
  `/modelos/gemini-4-argon`. Quem só queria fechar o menu sai da página.
- **Como ver**: `/ranking` em 390, tocar em "Menu", tocar no nome "Gemini 4 Argon" que aparece escurecido abaixo da folha.
- **Captura**: `docs/redesign-ascii/qa/a1-ranking-390.png` (o círculo é o ponto tocado; o tracejado, o link que recebe o toque).
- **Conserto sugerido** (sem JavaScript; provado no navegador do teste, nos dois motores): a folha vai até o fim da tela
  (`.menu:popover-open`, em `globals.css`, linha 327: `bottom-0`, `h-auto`, `max-h-none`, em coluna) e, como último filho da `nav`
  (`site-chrome.tsx`, linha 56), um `<button type="button" popovertarget="menu" popovertargetaction="hide" aria-label="Fechar o menu">`
  ocupando o resto (`flex-1`, fundo transparente ou o escuro de hoje). O toque cai dentro da folha, no botão que a fecha, e não chega à
  página. Só o `popover` com toque fora não basta: no WebKit o fechamento acontece no `pointerdown` e o clique cai na página que voltou a
  aparecer.

#### A2. Pelo teclado, o foco sai da folha aberta e some embaixo dela

- **Onde**: toda tela abaixo de 1024 px (medido no Chromium em 390 e 768, na home e na `/entrar`). Vale também para o desktop com zoom de
  200%, que cai na mesma largura.
- **O que está errado**: Enter no "Menu" abre a folha e o Tab percorre os sete links; depois de "Conta", o próximo Tab sai da folha, que
  continua aberta, e o foco vai para o primeiro elemento da página, que está **coberto** por ela: a pílula "Temporada encerrada" na home,
  o campo "E-mail" na `/entrar`. O anel âmbar fica escondido (WCAG 2.4.11, foco não encoberto). O Esc fecha, mas quem não sabe disso fica
  digitando num campo que não vê.
- **Como ver**: `/entrar` em 390 sem toque: Tab, Tab (o "Menu"), Enter, e oito Tabs.
- **Capturas**: `a2-entrar-390.png` e `a2-home-390.png` (o tracejado é onde está o foco, embaixo da folha).
- **Conserto sugerido**: junto com o A1, uma regra no `globals.css`: `body:has(#menu:popover-open) > div { visibility: hidden }` (o
  invólucro do `main` e do rodapé, no `layout.tsx`). O que está escondido sai da ordem do Tab: depois de "Conta" (e do "Fechar o menu" do
  A1) o foco volta ao cabeçalho, e nada atrás da folha recebe toque. Provado no Chromium. O custo é visual: a página some atrás da folha
  em vez de ficar escurecida.

#### A3. A caixa de marcar e o radio desmarcados quase não aparecem

- **Onde**: `/cadastro` (os dois aceites), `/carteira` ("Valor total pago"), `/conta` (a confirmação da exclusão) e `/admin` (as
  confirmações), em todas as larguras e nos dois navegadores.
- **O que está errado**: desmarcados, `.check` e `.radio` são um quadrado ou um círculo preto com a borda `hairline-strong` (#2e2e2e)
  sobre o cartão (#0a0a0a): 1,5:1. A WCAG 1.4.11 pede 3:1 para o contorno que identifica o controle. No celular, o radio "Valor total
  pago" e as caixas do aceite parecem um buraco preto; a pessoa não vê onde tocar. O axe não mede contraste de borda. O mesmo fio está nos
  campos de texto (`.field`), menos grave porque o rótulo marca o lugar.
- **Como ver**: `/carteira` com a conta da demo, o formulário "Lançar uma compra"; ou `/cadastro`.
- **Capturas**: `a3-carteira-390.png` (o radio de baixo, desmarcado) e `a18-cadastro-390.png` (as duas caixas).
- **Conserto sugerido**: em `globals.css` (linha 177, `.check, .radio`), a borda desmarcada em `border-muted` (#8a8a8a, 5,7:1 sobre o
  cartão). O `muted-soft` (#5c5c5c) dá 3,0:1 sobre o cartão e 3,1:1 sobre o canvas, no limite. Se quiser, o mesmo nos `.field`.

#### A4. Entre 768 e ~880 px, a legenda dos gráficos fica espremida numa coluna de ~120 px

- **Onde**: o patrimônio da home e das páginas de modelo, e as velas da `/acoes/DOBR4`, em 768 (Chromium).
- **O que está errado**: a partir de `md` (768) o gráfico fica com 32rem (512 px) e a legenda (ou o resumo das velas) vai para o lado, com
  o que sobra do cartão: 121 px em 768. A legenda quebra cada nome em duas linhas ("Claude Opus / 5.5", "Faixa p5 a p95 / do Monte
  Carlo") e o resumo das velas vira uma coluna de 13 linhas curtas. Em 1024 a coluna já tem 374 px e fica bem.
- **Como ver**: `/` ou `/acoes/DOBR4` em 768 × 1024, as seções "Patrimônio" e "Cotações recentes".
- **Capturas**: `a4-home-768.png` e `a4-acao-768.png`.
- **Conserto sugerido**: em `charts.tsx` (linhas 66 e 232), a grade lado a lado só a partir de `lg`: `lg:grid lg:grid-cols-[32rem_1fr]
  lg:items-start lg:gap-6 lg:space-y-0`, e a lista da legenda em coluna também a partir de `lg` (linha 175, `lg:flex-col`). Abaixo disso,
  a legenda fica embaixo, como no celular.

#### A5. A caixa da moldura deixa o axe cego para o contraste no desktop

- **Onde**: toda tela a partir de 1202 px (medido em 1440 no Chromium; o projeto `desktop` do e2e roda em 1280, também acima).
- **O que está errado**: as laterais da moldura são as bordas de um `div` de 1202 px de largura (`data-moldura`, `layout.tsx`, linha 50),
  posto por cima de todo o conteúdo (`z-20`). O axe não consegue achar o fundo de nenhum texto embaixo dele ("overlapped by another
  element") e marca o contraste como "incompleto", nunca como violação: de 21 (`/acoes`) a 321 (`/modelos/qwen3-8-max`) nós por tela em
  1440. Sem a moldura (escondida só no teste), o incompleto cai para 1 a 26 por tela (o que sobra é o texto perto da arte e da fita e as
  células fora da parte visível das tabelas) e continua sem violação: **o contraste de hoje está certo**, mas o axe do desktop do
  `layout.spec.ts` não pegaria uma regressão de cor. Não é visível para quem lê.
- **Como ver**: `node axe-moldura.mjs` (seção 2), ou o axe em 1440 em qualquer tela, olhando o `incomplete` de `color-contrast`.
- **Captura**: `a5-entrar-1440.png` (a área que a caixa da moldura cobre, pintada de vermelho só para a captura).
- **Conserto sugerido**: as laterais como duas linhas de 1 px, e não uma caixa por cima de tudo: dois `div` de `w-px` (ou o `::before` e o
  `::after` de um só, cada um com 1 px de largura), nas mesmas posições (`left-[calc(50%-601px)]` e `left-[calc(50%+600px)]`). Assim só
  o que encosta nas laterais fica embaixo delas, e lá não há texto. Alternativa só no teste: esconder `[data-moldura]` antes do axe.

### Menores

#### A6. "visão neutro" nos cartões de decisão

- **Onde**: o cartão de decisão (home, `/ciclos/2026-12-01` e a página de cada modelo), em toda largura; nos modelos que ficam neutros
  (Gemini 4 Argon e Grok 4.7 no último ciclo).
- **O que está errado**: `decisions.tsx`, linha 97, escreve `visão {marketView}`, e o valor `neutro` dá "visão neutro" (o certo é "visão
  neutra"; "otimista" e "pessimista" servem aos dois gêneros).
- **Captura**: `a6-ciclo-390.png`.
- **Conserto sugerido**: um mapa do valor para o texto (`neutro` → "visão neutra"). O `e2e/arena.spec.ts`, linha 111, monta o texto
  esperado do mesmo jeito e muda junto.

#### A7. O nome do modelo sem a etiqueta "simulado" na legenda do patrimônio (e no painel)

- **Onde**: a legenda do gráfico da home (os seis nomes) e a da página do modelo (o nome dele), em toda largura; e a tabela "Custo por
  competidor no mês" do `/admin` ("ensaio / Claude Opus 5.5"...).
- **O que está errado**: a etiqueta deveria seguir o nome onde ele aparece (plano, seção 4.5). Ela está no ranking, nos cartões, no h1 do
  modelo e em "Quem tem a ação", mas não na legenda (`charts.tsx`, linhas 173 a 195, que só recebe `name` e `slug` da série).
- **Captura**: `a7-home-390.png`.
- **Conserto sugerido**: levar `simulated` na série (como o `holders` da ação faz) e pôr a `SimulatedTag` depois de `{s.name}` na
  legenda. No painel, que só recebe o rótulo pronto, é opcional (o admin sabe); se entrar, a api do painel manda o provedor. Conferir o
  `arena.spec.ts`, que lê o texto da seção.

#### A8. O BOVA11 da faixa "Cotações e macro" sem o glifo de direção

- **Onde**: a home, em toda largura.
- **O que está errado**: "R$ 66,25 (-0,97%)" tem sinal mas não tem o ▲ ▼ ■, e a regra do sistema é "todo valor com direção leva o glifo e
  o sinal" (plano, seção 3; `docs/TELAS.md`, seção 10). As tabelas já fazem isso pelo `data-dir`.
- **Captura**: `a8-home-390.png`.
- **Conserto sugerido**: em `app/page.tsx` (linhas 114 a 117), a variação num `<span data-dir={direction(...)}>`: o `::before` das
  tabelas desenha o glifo sem mudar o texto que o e2e lê.

#### A9. O ranking no desktop: o nome que quebra e as colunas desalinhadas

- **Onde**: `/ranking` em 1280 e 1440 (Chromium).
- **O que está errado**: (1) "DeepSeek V4 Pro (0813)" quebra e a etiqueta desce para a segunda linha: a linha dele tem 77 px e as outras,
  53 (de 360 a 1024 todas quebram e ficam iguais, com 77). (2) As três tabelas (Modelos, Sorteio e Referências) dimensionam as colunas
  cada uma por si: o "Retorno" começa em x = 436, 334 e 452 em 1440 (356, 254 e 372 em 1280); empilhadas, as colunas não se alinham.
- **Captura**: `a9-ranking-1440.png`.
- **Conserto sugerido**: em `tables.tsx` (linhas 71 a 76), o nome e a etiqueta sem quebra a partir de `lg` (`lg:whitespace-nowrap` na
  célula presa); e o mesmo `<colgroup>` com larguras fixas nas três tabelas (ou `table-fixed` com a largura de cada coluna), para elas
  baterem uma embaixo da outra.

#### A10. Listas com o marcador por dentro: a segunda linha volta para baixo dele

- **Onde**: "Como ler a tabela" (`/ranking`), "De onde vêm os dados" e "Limitações" (`/como-funciona`), em toda largura; mais visível no
  celular, onde cada item quebra.
- **O que está errado**: `list-inside` (`ranking/page.tsx`, linha 50; `como-funciona/page.tsx`, linhas 197 e 217): o texto da segunda
  linha começa embaixo do marcador, sem o recuo. A lista da exclusão na `/conta` e a do texto legal usam `list-disc pl-6`, com o recuo
  certo: dois desenhos de lista no mesmo site.
- **Captura**: `a10-ranking-390.png`.
- **Conserto sugerido**: trocar `list-inside` por `pl-6` (o marcador fora), como na `/conta`. O "Itens descartados" do cartão de decisão
  (`decisions.tsx`, linha 134) tem a mesma classe, mas os itens são de uma linha.

#### A11. Os cartões de notícia com dois ritmos

- **Onde**: `/noticias` em 360, 390, 412 e no iPhone 15, onde uns títulos têm uma linha e outros duas.
- **O que está errado**: o título é um `.link` com 44 px de altura mínima e a linha centralizada (`news-list.tsx`, linha 22). Com duas
  linhas, o texto enche os 44 px; com uma, sobram 11 px em cima e 11 embaixo: o cartão de título curto fica mais solto, e a lista alterna
  dois espaçamentos.
- **Captura**: `a11-noticias-390.png` (o cartão do meio).
- **Conserto sugerido**: no título do cartão, o alvo de 44 px por padding compensado, e não por altura mínima centralizada:
  `min-h-0 py-[11px] -my-[11px]` (a caixa continua com 44 px numa linha só, e o texto não ganha vão). O `layout.spec.ts` mede a caixa, que
  não muda.

#### A12. Rodapé: a segunda linha das fontes de notícia começa 8 px para dentro

- **Onde**: o rodapé de toda tela em 360, 390, 412 e no iPhone 15 (onde a lista quebra).
- **O que está errado**: cada fonte vem num `<span className="ml-2">` (`site-chrome.tsx`, linha 160); quando a linha quebra, "Money Times"
  começa 8 px à direita da margem do resto do rodapé.
- **Captura**: `a12-home-360.png`.
- **Conserto sugerido**: `mr-2` no lugar de `ml-2`, com o espaço comum depois dos dois-pontos: a margem fica no fim da linha, onde não
  aparece.

#### A13. Home, "Temporada": a grade de pares com um buraco

- **Onde**: a home a partir de 640 px (os `Facts dense`, duas colunas a partir de `sm`).
- **O que está errado**: depois do "Nome" (que ocupa a linha), sobram três pares; o "Liquidado até" fica sozinho na esquerda, a direita
  fica vazia e o fio de baixo para no meio.
- **Captura**: `a13-home-1440.png`.
- **Conserto sugerido**: em `app/page.tsx` (linha 353), `<Fact term="Liquidado até" wide>`, ou outro par para fechar a linha.

#### A14. Os rótulos dos eixos mudam de tamanho com a largura: 9,3 px no celular, 17,1 px do tablet em diante

- **Onde**: o patrimônio (home e modelos) e as velas (ação), em toda largura.
- **O que está errado**: o SVG escala o viewBox de 360 (`charts.tsx`, linhas 16 e 19: `w-full max-w-lg`, rótulo de 12): dentro do
  cartão, em 360 px ele tem 278 px, e o rótulo sai com 9,3 px (o comentário do código esperava uns 11); de 768 em diante ele tem 512 px, e
  o rótulo sai com 17,1 px, maior que o texto ao lado (os rótulos de 12 a 14 px).
- **Capturas**: `a14-acao-360.png` e `a14-acao-1440.png`.
- **Conserto sugerido**: segurar a escala: `max-w-sm` (384 px) no SVG e o rótulo de 13 no viewBox dão uns 10 px no celular e 13,9 no
  desktop; ou tirar o padding do cartão em volta do gráfico no celular.

#### A15. /admin: o erro de leitura da DLQ desenhado como vazio, seis vezes

- **Onde**: `/admin`, seção "Filas e DLQ", em toda largura (a demo não tem Service Bus).
- **O que está errado**: "Não deu para ler a DLQ desta fila agora…" vem no `Empty` (o contorno tracejado com a grade fantasma `. : .`, o
  desenho de "ainda não há nada") e se repete igual para as seis filas (`admin-panels.tsx`, linha 117). Erro com cara de vazio confunde, e
  a repetição empurra o resto do painel para baixo.
- **Captura**: `a15-admin-390.png`.
- **Conserto sugerido**: o erro na caixa de erro do sistema (a borda `semantic-error/60`, como o erro de formulário) e, quando todas as
  filas falham pelo mesmo motivo, uma mensagem só para a seção.

#### A16. Sob movimento reduzido, o botão ainda encolhe ao ser pressionado

- **Onde**: todo `.btn`, em toda largura (medido no Chromium).
- **O que está errado**: o plano (seção 5.3) pede o `:active` sem escala sob `prefers-reduced-motion`. A regra global zera a transição,
  mas o `active:scale-97` continua: com `reducedMotion: 'reduce'`, o botão pressionado fica com `scale: 0.97` (igual ao normal), um salto
  sem transição.
- **Captura**: nenhuma (é um estado durante o toque); a medida está em `.data/orquestracao/qa/out/evid.json`.
- **Conserto sugerido**: no `.btn` (`globals.css`, linha 161), `motion-reduce:active:scale-100`.

#### A17. O botão "Menu" não muda com a folha aberta

- **Onde**: o cabeçalho abaixo de 1024 px, nos dois navegadores.
- **O que está errado**: com a folha aberta, o botão continua com os três traços; nada diz que o mesmo botão a fecha. (O leitor de tela
  ouve o estado: o Chromium expõe `expanded=true`.)
- **Captura**: `a17-ranking-390.png`.
- **Conserto sugerido**: os dois ícones no botão (os traços e um ✕) e a troca por CSS, sem JavaScript:
  `.btn-menu:has(+ .menu:popover-open) .icone-abrir { display: none }` e o contrário para o ✕.

#### A18. A caixa de marcar inválida não ganha a borda vermelha

- **Onde**: `/cadastro`, os dois aceites, quando o envio volta com erro (todas as larguras).
- **O que está errado**: o campo de texto inválido ganha a borda `semantic-error` (`.field`, `aria-[invalid=true]:border-semantic-error`);
  a caixa de marcar inválida (`aria-invalid="true"`, conferido) continua com a borda de sempre, e o erro só aparece no texto embaixo.
- **Captura**: `a18-cadastro-390.png`.
- **Conserto sugerido**: o mesmo `aria-[invalid=true]:border-semantic-error` no `.check` (`globals.css`, linha 177).

## 5. O que foi conferido e passou

1. **Rolagem e corte**: 140 cargas no Chromium (20 telas × 7 larguras) e 13 no iPhone 15, todas com `scrollWidth` igual ao `clientWidth` e
   `body.scrollWidth` dentro dele. Nenhum texto cortado (por ancestral ou pela tela), nenhum por cima de outro. "DeepSeek V4 Pro (0813)" e
   "Qwen3.8 Max (0902)" quebram nos espaços dentro da célula e do cartão em 360 px, com a etiqueta embaixo; os SHA-256 quebram; os tickers
   não quebram. As tabelas largas rolam dentro da própria caixa (as três do ranking, as posições dos modelos, "Quem tem a ação" e os jobs
   do painel), como o desenho manda.
2. **Alvos de toque**: nenhum link, botão ou campo visível abaixo de 43,95 × 43,95 em nenhuma tela ou largura, nos dois navegadores, e
   nenhum par de alvos se cobrindo.
3. **Menu**: abaixo de 1024 o botão "Menu" tem 44 × 44, abre a folha (360 × 353 px em 360, dentro da tela), as linhas têm 52 px e as
   ações 44, o Esc fecha (no Chromium o foco volta ao botão), o toque fora num ponto vazio fecha, e os sete links levam à tela certa
   (Carteira e Conta, sem sessão, à `/entrar`), com a folha fechada na tela nova. A partir de 1024, sem o botão: a cápsula centrada (0 a
   0,1 px do centro), os oito links do cabeçalho dentro da barra de 64 px, com 44 px de alvo, e vãos de 169 px (1024) e 257 px (1280 e
   1440) entre a marca e a cápsula. Exceções: A1, A2 e A17.
4. **Teclado**: no desktop, a marca, a cápsula, Carteira, Conta e o conteúdo; no celular, a marca, o "Menu" e o conteúdo; nos formulários,
   na ordem visual (no cadastro: nome, e-mail, senha, o aceite dos termos, "Ler os termos", o aceite da política, "Ler a política",
   "Criar conta", "Já tenho conta"). Todo foco com o contorno âmbar sólido de 2 px e `:focus-visible`, nenhum embaixo do cabeçalho preso,
   nenhum anel cortado por `overflow`. (O `.btn` e o `.link` fazem a transição da cor do contorno em 150 ms, do branco ao âmbar; medido
   depois dela.) Exceção: A2.
5. **Movimento reduzido**: em 1440 com `reduce`, só o `escadaria-q0.png` e o `urso-q0.png` pedidos, o `<pre>` igual depois de 1,5 s e a
   fita parada (`transform: none`). Sem `reduce` em 1440 o laço toca (o quadro muda, o JSON é pedido). Em 390 e 768, com e sem `reduce`, e
   no iPhone 15: nenhum pedido a `escadaria.json`, `escadaria.png`, `urso.json` nem `urso.png`. Exceção: A16.
6. **Arte e texto**: nenhum pixel da arte (> 24 de 255) dentro de nenhuma linha de texto do hero nem da 404, nas sete larguras (a
   captura só com a arte, `qa.mjs arte`). O touro aparece inteiro de 768 em diante; entre 360 e 412 a ponta do chifre entra no esfumado
   da borda direita (o desenho que a T2 aprovou). O urso fica inteiro na coluna em 1280 e 1440 (em 1024 perde só 21 caracteres das
   pontas); abaixo disso, o recorte do meio (as colunas e o urso), legível.
7. **axe** (todas as regras, todas as gravidades): 0 violações nas 20 telas em 360 e em 1440 (Chromium) e nas 13 do iPhone 15. O
   "incompleto" de contraste do desktop é o A5.
8. **Campos**: os 21 campos (contados por tela) com 16 px; no iPhone 15, tocar em cada campo de sete telas deixa a escala da tela em 1,00 (sem zoom). Os erros
   (o `/entrar` vazio e com "nao-e-email", o `/cadastro` com e-mail inválido e o resto vazio, o `/esqueci-senha`): cada campo inválido com
   `aria-invalid="true"`, o erro ligado por `aria-describedby` e o foco no primeiro inválido; o erro do formulário (o servidor fora) num
   `role="alert"` que recebe o foco; os filtros com valor que não vale (`/noticias?ticker=!!`, `/acoes?q=` com 41 caracteres) com
   `role="alert"` e o campo inválido. "Enviando…": o login da demo segurado 1,5 s mostra "Enviando…" com o DotSpinner animado, o
   `fieldset` desativado e `aria-busy="true"`.
9. **"simulado"**: a etiqueta ao lado do nome nas três tabelas do ranking e na compacta da home, nos cartões de decisão (home, ciclo,
   ação), no h1 do modelo e em "Quem tem a ação". Os dois avisos (o da home, no hero, e o da página do modelo) em todas as larguras e no
   iPhone. Exceção: A7.
10. **A cara** (contra as capturas da v1, `feat-redesign/docs/redesign-2026-10/depois/`, e o depois desta onda): o canvas, a pílula do
    anúncio, o título do hero e o da 404 na Geist 500, a faixa vazia entre o cabeçalho de página e a primeira seção, os cartões, as
    tabelas no painel e a moldura. A Geist carregou em todas as telas, e todo h1, h2 e h3 está nela, menos os nomes das filas no `/admin`,
    na mono de propósito. A moldura confere: os losangos caem no centro das laterais, inclusive com a barra de rolagem clássica do Windows
    (medido sem o `--hide-scrollbars` do Playwright em 1202, 1280 e 1440: desvio de 0 px). Os desvios estão em A4 e de A9 a A14.

## 6. O que não é achado (e por quê)

- **O JSON da arte pedido duas vezes em 1440**: é o `next dev` (o modo estrito do React roda o efeito duas vezes, e o `arte-viva.tsx`
  desfaz o primeiro); em produção, uma vez.
- **O campo de data com "mm/dd/yyyy"**: o navegador do teste está em inglês; num navegador em português, "dd/mm/aaaa".
- **As decisões da home numa coluna só no desktop** (o ciclo, o modelo e a ação usam duas a partir de 1024): é o que o plano pede para a
  home.
- **A ponta do chifre do touro no esfumado em 360 a 412** e **o urso recortado dos lados no celular**: o desenho aprovado pela T2 e pela
  T3a; o bicho fica legível.
- **Os nomes das filas do painel na mono**: de propósito (relatório da T3b).
- **A página do modelo mostra as últimas decisões, sem "Mais antigas"**: é o que a api manda; fora do escopo deste QA.
- **O disabled do "Entrar" com a borda branca da pílula durante o envio**: a decisão 6 do relatório da T3b; ficou legível.

## 7. Não verificado

iPhone e Android físicos, leitor de tela de verdade (VoiceOver e TalkBack), o Firefox, o celular deitado, as larguras entre as da lista
(por exemplo, 1100 px), o Tab no WebKit, a carteira com lançamentos (a conta da demo não tem nenhum, e nada foi lançado) e o painel com
mensagens na DLQ e rascunhos de temporada (só existem no banco do e2e).

## 8. Arquivos

- `docs/redesign-ascii/relatorios/qa-mobile.md` (este).
- `docs/redesign-ascii/qa/`, as capturas dos achados (20): `a1-ranking-390.png`, `a2-entrar-390.png`, `a2-home-390.png`,
  `a3-carteira-390.png`, `a4-home-768.png`, `a4-acao-768.png`, `a5-entrar-1440.png`, `a6-ciclo-390.png`, `a7-home-390.png`,
  `a8-home-390.png`, `a9-ranking-1440.png`, `a10-ranking-390.png`, `a11-noticias-390.png`, `a12-home-360.png`, `a13-home-1440.png`,
  `a14-acao-360.png`, `a14-acao-1440.png`, `a15-admin-390.png`, `a17-ranking-390.png` e `a18-cadastro-390.png`. As de celular estão em 2x.
- Fora do git, em `.data/orquestracao/qa/`: os scripts (`qa.mjs`, `qa2.mjs`, `qa3.mjs`, `medir.mjs` e as provas avulsas) e as medidas em
  `out/` (os JSON da matriz, do menu, do teclado, do movimento, dos formulários e da arte). As capturas de trabalho e a sessão da demo
  foram apagadas.
