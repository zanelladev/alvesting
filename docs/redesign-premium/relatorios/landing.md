# Relatório da T1b (a landing e o site no design premium)

Tarefa `task_edefd00d1fe8` (dispatch `ctx_4d2961cccda3`), onda "design premium", 05/11/2026. Rodou em paralelo com a T1a (as telas da
arena). Até a T0b soltar a trava (14:00) fiz só a leitura, o estudo e o script da paleta com o teste dele; as edições vieram depois. A T1a
ainda não tinha editado nenhum arquivo quando o build da prova final saiu (14:14): o e2e e o Lighthouse daqui medem a landing com as peças
compartilhadas (a faixa dos modelos, a tabela do ranking, o cartão de decisão e o `ui.tsx`) como a T1a as recebeu. Nada foi commitado nem
posto no índice: o trabalho está só no working tree (`git diff`). Nada no `apps/api`. A demo (4300 e 4310) não foi tocada, e nenhum servidor
meu ficou de pé.

## Resumo

- **A escadaria e o urso no azul da marca, e a arte continua arquivo.** Um script pequeno, `scripts/arte-azul.mjs` (só o Node; o `zlib.crc32`
  refaz o CRC), troca as cores da paleta (o pedaço `PLTE`) dos quatro sprites PNG pela escala da primária do `globals.css`, cada cor no tom de
  luminância mais próxima. Os índices de cada pixel, a transparência, os glifos e o tamanho de cada arquivo são os da v1; o contraste de cada
  cor com o preto da moldura muda no máximo 1,22%; a ordem de claro e escuro não se inverte nem empata. O teste,
  `scripts/arte-azul.test.mjs` (18 casos), prova isso contra o SHA-256 medido nos arquivos âmbar e foi visto falhar (4 casos vermelhos)
  antes da troca.
- **A landing mais limpa**: a sans em tudo o que é dela (o `[!]` do aviso, a fita, a versão e o hash do prompt saíram da mono solta; a mono
  ficou só na grade da arte e no `.hash`), a faixa dos laboratórios com o "simulado" uma vez (no cabeçalho, no lugar de seis etiquetas) e os
  nomes sem o sufixo de versão, o recorte sem o fio por cima da sombra larga (a Regra Plana) e nenhum âmbar sobrando. A primária pinta só os
  dois "Abrir a arena" (um teste prova, nos dois temas).
- **O movimento é CSS**: a seta dos CTAs, da pílula da temporada e do "Saiba mais ›" anda 2 px no hover (150 ms, a saída quart; parada no
  toque e com movimento reduzido), a fita rola contínua, e o laço da arte e a revelação do tema ficam como estavam. Nenhuma ilha de cliente
  entrou: o JavaScript da landing é o mesmo, byte a byte.
- **O Como funciona e a 404** no mesmo sistema (a versão e o SHA-256 no `.hash`, a sans no resto; o urso azul), e a casca do site sem as
  sobras (os comentários da Geist); o seletor de tema ficou como a fundação o deixou.
- **A prova**: o e2e inteiro nos seis projetos, um por vez e com 1 worker, **sem nenhuma falha** (desktop 479 e 1 pulado; pixel-7 e iphone-15
  472 e 8; desktop-escuro 156; pixel-7-escuro e iphone-15-escuro 155 e 1); o Lighthouse com **LCP 2.413 ms** (antes 2.417), CLS 0 e TBT 18 ms,
  sem JavaScript novo; o ensaio com o SHA-256 de sempre; o `az` falso sem chamada e a guarda de rede sem registro. O primeiro `pnpm check` (14:33)
  reprovou só no `prettier --check .`, em 8 arquivos da T1a, que começou a editar no meio da minha prova; o resto, por partes, passou (fora
  os tipos, também só em arquivos dela), e o **`pnpm check` repetido inteiro às 14:42 saiu com exit 0**.

## 1. A escadaria e o urso no azul da marca

**O pedido**: a mesma escadaria animada, refeita no azul da marca, com a tinta só nos sprites e os glifos intactos; o mesmo no urso, para não
sobrar âmbar; a moldura escura nos dois temas.

**Como** (`scripts/arte-azul.mjs`, sem dependência):

1. Lê a escala da primária do `apps/web/src/app/globals.css` (os 11 `--color-primary-*` em OKLCH, a matiz 275,49): os tokens moram lá e só
   lá, e trocar a escala é rodar o script de novo.
2. Monta a rampa: a escala amostrada de mil em mil passos entre um tom e o seguinte (L e C em linha reta), convertida para sRGB de 8 bits
   (o OKLab de Björn Ottosson), só com os tons que sobem a luminância: 612 tons, do 950 `#14144c` ao 50 `#f2f5fe` (o teste confere as duas
   pontas, as mesmas do `docs/DESIGN.md`).
3. Para cada cor visível da paleta (alfa maior que 0, fora o preto), da mais escura à mais clara: o tom de luminância relativa (a da WCAG)
   mais próxima, nunca abaixo do tom da cor anterior (a mesma luminância dá o mesmo tom; uma luminância maior, um tom acima). O desempate
   subiu um ou dois tons em 11 cores da escadaria e 7 do urso (os aglomerados de laranjas e de vermelhos escuros de luminância quase igual).
4. Escreve o PNG com só os dados do `PLTE` trocados (do mesmo tamanho) e o CRC dele refeito; o resto, byte a byte.

**O resultado**: 65 cores trocadas em cada arquivo (as 67 que os pixels usam, menos o preto transparente do fundo e o preto opaco); as
outras 189 entradas (o preto transparente, que nenhum pixel usa) ficaram. Os tamanhos não mudaram; os blobs, sim:

| Arquivo | Tamanho | Blob antes (âmbar, a v1) | Blob depois |
|---|---|---|---|
| `escadaria.png` | 324.794 B | `0e6d3a8b` | `696f6af7` |
| `escadaria-q0.png` | 3.856 B | `44c09526` | `68c5cdbe` |
| `urso.png` | 428.596 B | `16669e20` | `a1c2938d` |
| `urso-q0.png` | 4.816 B | `4f32633e` | `cb6ee414` |

A cor vai de `#272975` (entre o 800 e o 900: as sombras mais fundas, que eram os vermelhos quase pretos) a `#dfe4fd` (perto do 100: o creme
mais claro do touro). As cores mais usadas (a pedra e os degraus, que eram os cinzas) caem entre o 700 e o 300; o brilho do touro e do urso,
do 300 ao 100. Na moldura preta o desenho é o de antes, em azul: a mesma estrutura de claro e escuro, porque a luminância de cada célula é a
de antes. **O que se perde**, e fica para o Artur dizer se incomoda: a figura (o touro, o urso) se separava da pedra também pela matiz (âmbar
sobre cinza); no azul de uma matiz só, ela se separa só pela luminância. O pedido era a escala da primária, e ficou nela.

**O teste** (`scripts/arte-azul.test.mjs`, no `node --test "scripts/*.test.mjs"` do `pnpm test`), escrito antes do script:

| Caso | O que prova |
|---|---|
| a rampa | é a escala do `globals.css`: do 950 (`#14144c`) ao 50 (`#f2f5fe`), com a luminância sempre subindo |
| só a paleta mudou (× 4 arquivos) | o SHA-256 do PNG inteiro menos os dados do `PLTE` é o dos arquivos âmbar, medido antes da troca (o cabeçalho, o `tRNS`, os índices de cada pixel no `IDAT` e a ordem dos pedaços); todo pedaço tem o CRC certo |
| a paleta é a de antes no azul (× 4) | o `PLTE` é o do script aplicado à paleta âmbar (as 67 cores estão no teste); cada cor visível é um tom da rampa, ou o preto; rodar o script de novo não muda nada |
| a mesma ordem de luminância (× 4) | nenhum par de cores visíveis se inverte nem empata; o preto e as entradas transparentes ficam como eram |
| o contraste com o preto (× 4) | fica a menos de 3% do de antes (o maior desvio é de 1,22%) |
| o quadro 0 e o arquivo inteiro | têm a mesma paleta (o laço troca o sprite pequeno pelo grande no meio da animação, `arte-viva.tsx`) |

**Visto falhar**: com o script escrito e os PNG ainda âmbar (13:50), 18 casos, **14 passaram e 4 falharam** (o "a paleta é a de antes no azul
da marca", um por arquivo); antes do script, o arquivo nem carregava (o módulo não existia). O teste ficou fora do repositório das 13:52 às
14:00, a pedido do coordenador, para não reprovar o `pnpm check` da T0b (os 4 vermelhos eram esperados até a troca, que só podia vir com a
trava livre). Depois da troca (14:01), **18 de 18**; rodar o script de novo não mudou nenhum byte (os blobs são os calculados antes, no
scratchpad).

**A paleta antes e depois** (o quadro 0 de cada arte; o arquivo inteiro tem a mesma):

**escadaria** (do mais escuro ao mais claro; o contraste é com o preto da moldura)

| Índice | Antes | Depois | Contraste antes → depois |
|---|---|---|---|
| 0 | `#000000` (transparente: o fundo) | `#000000` | 1,00 → 1,00 |
| 2 | `#000000` (o preto) | `#000000` | 1,00 → 1,00 |
| 22 | `#58221a` | `#272975` | 1,66 → 1,66 |
| 38 | `#5d1e15` | `#272976` | 1,66 → 1,67 |
| 17 | `#502b26` | `#292b79` | 1,71 → 1,72 |
| 14 | `#463634` | `#2c2f81` | 1,84 → 1,83 |
| 6 | `#3f3f3f` | `#31348a` | 1,99 → 1,99 |
| 10 | `#6e362e` | `#373b96` | 2,23 → 2,23 |
| 19 | `#7e2a1c` | `#373b97` | 2,24 → 2,23 |
| 20 | `#7a2e21` | `#373c97` | 2,24 → 2,26 |
| 32 | `#832516` | `#373c98` | 2,24 → 2,26 |
| 26 | `#63413b` | `#393e9c` | 2,35 → 2,34 |
| 13 | `#594946` | `#3c41a0` | 2,47 → 2,46 |
| 1 | `#505050` | `#3f45a5` | 2,60 → 2,61 |
| 46 | `#8d4438` | `#474fb2` | 3,02 → 3,03 |
| 63 | `#9b3c2b` | `#4850b4` | 3,07 → 3,08 |
| 58 | `#a13724` | `#4850b5` | 3,09 → 3,09 |
| 61 | `#824d44` | `#4950b5` | 3,09 → 3,10 |
| 52 | `#a7331e` | `#4951b6` | 3,14 → 3,14 |
| 65 | `#ad2e18` | `#4a52b7` | 3,18 → 3,18 |
| 62 | `#715954` | `#4b54b9` | 3,26 → 3,27 |
| 3 | `#646464` | `#5059c1` | 3,55 → 3,54 |
| 41 | `#a75c46` | `#5c67cc` | 4,26 → 4,27 |
| 55 | `#b45438` | `#5c67cd` | 4,27 → 4,28 |
| 56 | `#bf4d2b` | `#5c68cd` | 4,31 → 4,32 |
| 53 | `#c64823` | `#5d68ce` | 4,35 → 4,34 |
| 57 | `#9b6554` | `#5e69ce` | 4,38 → 4,39 |
| 66 | `#cd441c` | `#5e6acf` | 4,44 → 4,44 |
| 64 | `#906d63` | `#606cd0` | 4,55 → 4,55 |
| 34 | `#837671` | `#6470d4` | 4,79 → 4,81 |
| 5 | `#7b7b7b` | `#6672d7` | 4,96 → 4,95 |
| 40 | `#d96735` | `#7381e0` | 5,94 → 5,95 |
| 47 | `#c6734f` | `#7481e1` | 5,97 → 5,97 |
| 49 | `#ce6f45` | `#7482e1` | 5,98 → 6,02 |
| 39 | `#e46128` | `#7582e1` | 6,04 → 6,04 |
| 51 | `#bf7858` | `#7582e2` | 6,04 → 6,05 |
| 54 | `#eb5c1e` | `#7583e2` | 6,08 → 6,10 |
| 60 | `#b87c62` | `#7683e2` | 6,10 → 6,12 |
| 25 | `#a3887b` | `#7986e4` | 6,36 → 6,34 |
| 16 | `#9a8e89` | `#7c89e6` | 6,60 → 6,58 |
| 7 | `#939393` | `#7e8de7` | 6,84 → 6,85 |
| 31 | `#d7964e` | `#909ef1` | 8,36 → 8,35 |
| 30 | `#f28916` | `#909ff1` | 8,37 → 8,42 |
| 48 | `#e39136` | `#919ff1` | 8,37 → 8,43 |
| 44 | `#ea8e29` | `#91a0f1` | 8,40 → 8,50 |
| 18 | `#c59e72` | `#92a0f1` | 8,51 → 8,52 |
| 4 | `#b5a694` | `#95a4f2` | 8,85 → 8,87 |
| 9 | `#aaaaaa` | `#98a5f3` | 9,04 → 9,01 |
| 43 | `#c3ae7f` | `#9eacf5` | 9,68 → 9,67 |
| 27 | `#bab7b1` | `#a6b4f8` | 10,50 → 10,51 |
| 42 | `#c5baa0` | `#abb7f9` | 10,91 → 10,87 |
| 12 | `#d8b972` | `#adb9fa` | 11,10 → 11,10 |
| 50 | `#cbbd9b` | `#aebbfa` | 11,29 → 11,29 |
| 24 | `#e8ba52` | `#b1befa` | 11,58 → 11,62 |
| 37 | `#fbb415` | `#b2befa` | 11,64 → 11,64 |
| 28 | `#e2bd69` | `#b2bffa` | 11,72 → 11,73 |
| 11 | `#d6c190` | `#b5c0fa` | 11,89 → 11,89 |
| 35 | `#f4ba36` | `#b5c1fa` | 11,92 → 11,97 |
| 8 | `#cdc5b1` | `#b7c3fb` | 12,22 → 12,21 |
| 23 | `#c6c6c6` | `#b8c4fb` | 12,29 → 12,33 |
| 59 | `#ffc032` | `#bec8fb` | 12,84 → 12,84 |
| 45 | `#e5c883` | `#bec9fb` | 12,92 → 12,94 |
| 36 | `#efcc79` | `#c5cefb` | 13,58 → 13,60 |
| 33 | `#ded2b2` | `#c8d1fb` | 13,97 → 13,97 |
| 29 | `#fbd16f` | `#ccd5fb` | 14,45 → 14,48 |
| 15 | `#ecdaac` | `#d3dafc` | 15,19 → 15,20 |
| 21 | `#fbe3a7` | `#dfe4fd` | 16,65 → 16,65 |

**urso** (do mais escuro ao mais claro; o contraste é com o preto da moldura)

| Índice | Antes | Depois | Contraste antes → depois |
|---|---|---|---|
| 0 | `#000000` (transparente: o fundo) | `#000000` | 1,00 → 1,00 |
| 1 | `#000000` (o preto) | `#000000` | 1,00 → 1,00 |
| 66 | `#5d1e15` | `#272975` | 1,66 → 1,66 |
| 50 | `#58231b` | `#272976` | 1,67 → 1,67 |
| 28 | `#502c26` | `#292c7a` | 1,73 → 1,74 |
| 15 | `#463734` | `#2d3082` | 1,86 → 1,86 |
| 4 | `#3f3f3f` | `#31348a` | 1,99 → 1,99 |
| 12 | `#6e362e` | `#373b96` | 2,23 → 2,23 |
| 27 | `#7e2a1c` | `#373b97` | 2,24 → 2,23 |
| 22 | `#7a2e21` | `#373c97` | 2,24 → 2,26 |
| 31 | `#832516` | `#373c98` | 2,24 → 2,26 |
| 17 | `#63413b` | `#393e9c` | 2,35 → 2,34 |
| 10 | `#584946` | `#3c41a0` | 2,46 → 2,46 |
| 2 | `#505050` | `#3f45a5` | 2,60 → 2,61 |
| 48 | `#8e4437` | `#474fb2` | 3,03 → 3,03 |
| 58 | `#9b3c2b` | `#4850b4` | 3,07 → 3,08 |
| 63 | `#a13724` | `#4850b5` | 3,09 → 3,09 |
| 56 | `#824d44` | `#4950b5` | 3,09 → 3,10 |
| 62 | `#a7331e` | `#4951b6` | 3,14 → 3,14 |
| 64 | `#ad2e18` | `#4a52b7` | 3,18 → 3,18 |
| 25 | `#715955` | `#4b54b9` | 3,26 → 3,27 |
| 9 | `#646464` | `#5059c1` | 3,55 → 3,54 |
| 34 | `#a75c46` | `#5c67cc` | 4,26 → 4,27 |
| 45 | `#b45438` | `#5c67cd` | 4,27 → 4,28 |
| 61 | `#bf4d2b` | `#5c68cd` | 4,31 → 4,32 |
| 59 | `#c64823` | `#5d68ce` | 4,35 → 4,34 |
| 33 | `#9a6656` | `#5e69cf` | 4,41 → 4,40 |
| 65 | `#cd441c` | `#5e6acf` | 4,44 → 4,44 |
| 46 | `#906d63` | `#606cd0` | 4,55 → 4,55 |
| 30 | `#85746f` | `#636fd3` | 4,73 → 4,74 |
| 7 | `#7b7b7b` | `#6672d7` | 4,96 → 4,95 |
| 32 | `#d76837` | `#7381e0` | 5,92 → 5,95 |
| 43 | `#c6734f` | `#7481e1` | 5,97 → 5,97 |
| 36 | `#ce6f45` | `#7482e1` | 5,98 → 6,02 |
| 52 | `#e46128` | `#7582e1` | 6,04 → 6,04 |
| 44 | `#bf7858` | `#7582e2` | 6,04 → 6,05 |
| 60 | `#eb5c1e` | `#7583e2` | 6,08 → 6,10 |
| 49 | `#b87c62` | `#7683e2` | 6,10 → 6,12 |
| 26 | `#a88575` | `#7885e3` | 6,28 → 6,26 |
| 39 | `#9a8e89` | `#7c89e6` | 6,60 → 6,58 |
| 8 | `#939393` | `#7e8de7` | 6,84 → 6,85 |
| 20 | `#d69650` | `#909ef0` | 8,34 → 8,33 |
| 42 | `#e39136` | `#909ef1` | 8,37 → 8,35 |
| 40 | `#f18a18` | `#909ff1` | 8,39 → 8,42 |
| 47 | `#ea8e29` | `#919ff1` | 8,40 → 8,43 |
| 24 | `#c79d70` | `#91a0f1` | 8,49 → 8,50 |
| 14 | `#b3a695` | `#95a3f2` | 8,81 → 8,80 |
| 5 | `#a9a9a9` | `#96a4f3` | 8,94 → 8,90 |
| 55 | `#c3ae7f` | `#9eacf5` | 9,68 → 9,67 |
| 3 | `#babab8` | `#aab6f9` | 10,80 → 10,77 |
| 51 | `#c5baa0` | `#abb7f9` | 10,91 → 10,87 |
| 29 | `#d7b872` | `#acb8fa` | 10,99 → 10,99 |
| 53 | `#cbbd9b` | `#aebbfa` | 11,29 → 11,29 |
| 19 | `#e9ba4f` | `#b1befa` | 11,60 → 11,62 |
| 41 | `#fcb414` | `#b2befa` | 11,68 → 11,64 |
| 21 | `#f2b835` | `#b2bffa` | 11,68 → 11,73 |
| 38 | `#e2bd69` | `#b3bffa` | 11,72 → 11,75 |
| 23 | `#d7c18f` | `#b5c0fa` | 11,91 → 11,89 |
| 6 | `#cbc5b8` | `#b7c3fb` | 12,22 → 12,21 |
| 11 | `#c6c6c6` | `#b8c4fb` | 12,29 → 12,33 |
| 57 | `#ffc032` | `#bec8fb` | 12,84 → 12,84 |
| 54 | `#e5c883` | `#bec9fb` | 12,92 → 12,94 |
| 35 | `#eecc7a` | `#c4cefb` | 13,55 → 13,57 |
| 18 | `#ded2b2` | `#c8d1fb` | 13,97 → 13,97 |
| 37 | `#fad16f` | `#ccd4fb` | 14,41 → 14,38 |
| 13 | `#ebdaac` | `#d2dafc` | 15,16 → 15,17 |
| 16 | `#fbe3a7` | `#dfe4fd` | 16,65 → 16,65 |

## 2. A landing mais limpa, como o Rallies

Medido na referência (`.data/rallies-referencia/landing-1440-light*.jpeg` e `landing-390-light*.jpeg`, com as árvores), no ponto de partida
(`docs/redesign-premium/fundacao/landing-*.png`) e nas capturas novas (seção 10). A estrutura já era a do Rallies (o hero de texto em duas
colunas, a moldura grande com o recorte por cima, a faixa de marcas, os quatro painéis alternados, o FAQ em três colunas, o CTA e o rodapé com
o nome gigante); o que pesava eram os detalhes.

| O quê | Rallies | Antes (a fundação) | Agora |
|---|---|---|---|
| A fonte no que é da landing | uma sans só, com algarismos tabulares | a mono em 5 lugares do principal: o `[!]` do aviso, as duas voltas da fita, a versão e o SHA-256 do prompt (o e2e novo os listou no build das 14:02) | **a sans em tudo**; a mono só na grade da arte (a célula do ASCII) e no `.hash` (a versão e o SHA-256, identificadores em hexadecimal) |
| A faixa de marcas | 8 ladrilhos cinza com o logo e o nome | 6 ladrilhos com o logo, o nome e a etiqueta "simulado" com borda em cada um; "DeepSeek V4 Pro (0813)" e "Qwen3.8 Max (0902)" em duas e três linhas no celular | **uma etiqueta**, no cabeçalho da faixa (fora do título: o nome da região não muda), e o nome sem o sufixo de versão: uma linha em 1440 px, até duas em 390 |
| O recorte de UI | a captura com a borda clara e a sombra larga | o fio de 1 px (`border-hairline`) e a sombra larga juntos (a Regra Plana do `DESIGN.md`: um dos dois sobra) | a sombra só: o anel de 1 px é a primeira camada dela (preto a 6% no claro, branco a 8% no escuro, a receita "shadow as border" do better-ui), que serve no preto da moldura e no cinza do painel, mais a sombra do recorte de antes |
| A arte | a pintura deles | âmbar sobre preto | **o azul da marca** sobre preto |
| A fita | não tem | a mono, um caractere por passo (`steps()`) | a sans tabular, contínua, a uns 8 caracteres por segundo |
| A primária | o preto deles, só no CTA | já só nos dois "Abrir a arena" (a pílula do seletor de tema é a escolha atual, no cabeçalho) | a mesma, agora presa por teste nos dois temas |
| O âmbar | — | a arte, e os comentários da `.moldura` e do hero | **nenhum** (o `grep` de `âmbar`, `amber` e `ffb000` nos meus arquivos e no `globals.css` sai vazio; só o teste da paleta fala do âmbar, que é o "antes" dele) |

As medidas do hero, da moldura e do rodapé batem com as do Rallies e não mudaram: o título de 30 px em duas linhas a partir de x = 112 em
1440 px, a moldura de 1.216 px na mesma coluna, os CTAs de 44 px (os do Rallies têm 40: o alvo de toque do projeto), a pílula de contorno do
anúncio, o parágrafo de 15 px no secundário, e o nome gigante cortado no pé. A diferença que fica é o aviso da arena simulada na coluna da
direita (quatro linhas de 12 px), que o Rallies não tem e a honestidade pede: ele empurra a moldura uns 65 px para baixo.

**O cartão "Arena agora", o painel "A justificativa" e o "Sorte ou habilidade?"** mostram as peças da T1a (a `FaixaDeModelos`, o
`DecisionCard` e a `LeaderboardTable`), com a etiqueta em cada nome, o sufixo "(0902)" e a mono nos tickers, como estavam. Decisão do
coordenador (o `ask` respondido às 13:48): a nota única do "simulado" mora dentro dessas peças, desenhada pela T1a, e aparece por padrão; a landing não
acrescenta nada nesses três recortes, e eles mudam sozinhos quando a T1a entregar. O e2e novo da sans pula esses três recortes de propósito
(eles têm o teste da tela deles).

## 3. O movimento

- **Acima da dobra, só CSS** (nada de Motion nem de biblioteca de gráfico): o toque nos botões (`scale(0.96)` em 150 ms, da fundação), a
  **seta que anda 2 px no hover** nos dois CTAs, na pílula da temporada e no "Saiba mais ›" (`.seta`, no bloco novo "landing (T1b)" do
  `globals.css`: `transition: translate 150ms var(--ease-out-quart)`, só o `translate`, interrompível, dentro de `@media (hover: hover) and
  (prefers-reduced-motion: no-preference)`) e a revelação da troca de tema, da fundação. Um e2e novo prova a ida, a volta e o ramo de
  movimento reduzido (só no desktop: o toque não tem hover).
- **A fita** rola contínua em linha reta (só o `transform` anima, na composição do navegador) e para no começo com movimento reduzido (o e2e
  de sempre).
- **A escadaria** continua o laço de sempre: a partir de 1024 px, depois do `load`, no ócio do navegador, parada com movimento reduzido e com
  economia de dados (os e2e do `hero.spec.ts`, sem mudança).
- **Abaixo da dobra, nenhuma ilha de cliente**: nada ali muda depois do carregamento (os números são do servidor, e o contador da Arc só gira
  quando o número muda), e um gráfico pediria o patrimônio, que a landing deixou de ler pelo LCP. Sem candidata que valesse o JavaScript, ele
  ficou o de antes (seção 9).

## 4. O Como funciona e a 404

- **O Como funciona**: a versão e o SHA-256 do prompt no `.hash` (a mono que quebra em qualquer ponto; antes, a `font-mono` solta); o resto é
  a sans das peças do `ui.tsx` (o `PageHead`, as `Section` e os `Fact`, da T1a). A primária não aparece no principal (não há ação nele).
- **A 404**: o urso azul (a paleta), na moldura escura nos dois temas; a primária só no "Voltar ao início". Nenhuma mudança de código: o
  texto, os caminhos e o quadro de espera são os de antes (o `nao-encontrada.spec.ts` passou sem mudança, nos seis projetos).

## 5. A casca do site

O cabeçalho e o rodapé já eram os do Rallies; o que sobrava eram os comentários da Geist (o `site-chrome.tsx` e a `.nome-gigante` falavam da
"Geist 600": agora "a sans 600"). O seletor de tema ficou como a fundação o deixou, antes de "Entrar". O `.menu`, o `error.tsx` e o
`layout.tsx` do grupo `(site)` não precisaram mudar.

## 6. Mobile e os dois temas

O `layout.spec.ts` (da T1a; não mexi nele) percorre a `/`, o `/como-funciona` e a `/rota-que-nao-existe` nos três aparelhos e nos dois temas:
em 360 px sem rolagem horizontal, o cabeçalho cabendo e todo alvo com pelo menos 44 px (medida crua); de 390 a 1920 px sem rolagem; nenhum
erro no console; o axe sem violação séria nem crítica na largura do aparelho e sem violação nenhuma em 360 px, os dois nos dois temas. Verde nos seis projetos (seção 8). A etiqueta única no cabeçalho da faixa quebra para a linha de baixo, centrada,
quando não cabe ao lado do título (`flex-wrap`), e os nomes sem sufixo cabem em uma linha no desktop e em até duas no celular. Nenhuma barra
de rolagem à vista: a fita e a arte cortam com `overflow: hidden`, sem barra.

## 7. Os testes novos e os que mudaram

**Novos**:

| Teste | O que prova | Visto falhar |
|---|---|---|
| `scripts/arte-azul.test.mjs` (18 casos) | seção 1 | sim: 14 e 4 com os PNG âmbar (13:50) |
| `e2e/landing.spec.ts`, "a landing é toda na sans: a mono só na grade da arte e no SHA-256" | nenhum elemento do principal com texto próprio na mono, fora da grade da arte, do `.hash` e dos três recortes da T1a | sim: no build das 14:02, a lista com os 5 elementos (o `[!]`, as duas voltas da fita, a versão e o SHA-256) |
| `e2e/landing.spec.ts`, "a primária só nos dois botões 'Abrir a arena', nos dois temas" (`@tema`) | no principal, só os dois CTAs têm a primária no fundo, na cor ou na borda | não: a regra já valia; é a guarda dela |
| `e2e/hero.spec.ts`, "no hover a seta do 'Abrir a arena' anda 2 px e volta; com movimento reduzido, fica parada" (pulado nos projetos de toque, pelo nome, com o motivo) | o `translate` da seta vai a 2 px no hover, volta a `none` fora dele, e fica `none` com movimento reduzido | não: escrito depois do CSS (uma regra de estilo, sem lógica); é a guarda dele |

**Mudaram** (o contrato de DOM mudou junto com o teste):

| Teste | Antes | Depois | Motivo |
|---|---|---|---|
| `e2e/landing.spec.ts`, a faixa dos laboratórios | a etiqueta visível em cada ladrilho e o nome inteiro (`toContainText(model.name)`) | uma etiqueta na faixa (`toHaveCount(1)`), o ladrilho com o nome sem o sufixo (`toHaveText`) e a prova de que o banco sintético tem nome com sufixo | o "simulado" uma vez por contexto e nada de sufixo em lugar apertado (`docs/DESIGN.md`). Visto falhar: "Expected 1, Received 6" |
| `src/app/(site)/page.spec.tsx`, "antes da primeira liquidação" | a etiqueta depois do nome em cada ladrilho | o nome fechando o ladrilho e um `>simulado<` só, no cabeçalho da faixa | o mesmo. Visto falhar |
| `src/components/hero.spec.tsx`, a fita | `--tape-passos` com o tamanho da volta | `--tape-duracao` com um oitavo de segundo por caractere, e nada de `--tape-passos` | a fita contínua na sans. Visto falhar |
| `src/components/hero.spec.tsx`, o aviso da arena simulada | só o texto | o texto, e nenhuma `font-mono` no hero fora da grade da arte | a Regra da Sans Única. Visto falhar |

Os de antes continuam e passaram, sem mudança: o resto do `landing.spec.ts` (o cartão por cima da moldura, os painéis com o dado da api, o
FAQ, o rodapé grande, a moldura escura nos dois temas), o `hero.spec.ts` inteiro (o quadro 0 no HTML sem JavaScript, nenhum pedido do
arquivo inteiro em 390 px, o laço em 1440 px, a saída antes do ócio, o movimento reduzido), o `home.spec.ts` e o `nao-encontrada.spec.ts`.

## 8. Os comandos e os resultados

Toda execução pesada rodou com a trava (`.data/trava-pesada`, dono `t1b-landing`: das 14:00 às 14:04, das 14:08 às 14:09, das 14:13 às
14:38 e das 14:42 às 14:46, solta no fim de cada uma), com o `az` falso no `PATH` e a guarda de rede (`NODE_OPTIONS=--import .data/guardas/net-guard.mjs`,
`NET_GUARD_LOG=.data/guardas/t1b-landing-rede.log`). O disco nunca ficou abaixo de 8 GB livres (9 no começo; 58 a 62 depois que alguém
liberou espaço).

| O quê | Comando | Resultado |
|---|---|---|
| A troca da paleta | `node scripts/arte-azul.mjs` (14:01), e de novo para conferir | "65 cores trocadas" em cada um dos quatro arquivos, o mesmo tamanho; a segunda vez não mudou nenhum byte |
| O teste da paleta | `node --test scripts/arte-azul.test.mjs` | antes da troca: 18 casos, 14 e **4 falhas**; depois: **18 de 18** |
| O "antes" (14:00 a 14:04) | `pnpm build`, `pnpm lighthouse`, `playwright test --workers=1 --project=desktop landing.spec hero.spec` | build exit 0; Lighthouse exit 0 (seção 9); e2e com os 2 testes novos **vermelhos**, como deviam (os outros 13 verdes) |
| Unidade, tipos, lint e Prettier dos meus arquivos (sem a trava, a cada gravação) | `pnpm --filter @alvesting/web test`, `typecheck`, `eslint`, `prettier --check` | os 3 casos mudados vistos falhar antes do código; depois, **48 arquivos e 855 testes** verdes, os tipos e o lint com exit 0 |
| A rodada 1 (14:08 a 14:09) | `pnpm build`; as capturas e o `landing.spec` e o `hero.spec` no desktop | exit 0; **27 passaram** |
| A prova final, o build (14:14) | `pnpm build` | **exit 0** (do cache do turbo: nenhum arquivo do site mudou desde a rodada 1) |
| As capturas (14:14) | o spec temporário, `playwright test --workers=1 --project=desktop zz-capturas-t1b` (copiado para `e2e/` só durante a execução e apagado logo depois) | as 16 PNG da seção 10 |
| O e2e inteiro, os seis projetos, um por vez, com 1 worker (14:14 a 14:32) | `pnpm exec playwright test --workers=1 --project=<projeto>` em `apps/web` | **desktop: 479 passaram, 1 pulado** (3,8 min); **pixel-7: 472, 8 pulados** (3,6 min); **iphone-15: 472, 8 pulados** (4,9 min); **desktop-escuro: 156** (1,9 min); **pixel-7-escuro: 155, 1 pulado** (1,8 min); **iphone-15-escuro: 155, 1 pulado** (2,0 min). **Nenhuma falha.** Contra a fundação (476 e 1; 470 e 7; 155; 154 e 1): +3 no desktop (a sans, a primária e o hover), +2 e +1 pulado nos de toque (o hover é pulado), +1 nos escuros (a primária, `@tema`). Os pulados são os de antes (o login do smoke nos três claros; nos de toque, o teclado da carteira, as três folhas do `layout.spec.ts`, a rolagem da faixa e o teclado do tema) e o do hover |
| Lighthouse (14:32 a 14:33) | `pnpm lighthouse` | **exit 0**: LCP 2.413 ms, CLS 0, TBT 18 ms (seção 9) |
| `pnpm check` (14:33) | `TEST_DATABASE_URL=…/alvesting_t1blanding_test`, o Azurite do compose, `pnpm check` | **exit 1, só no `prettier --check .`**, em 8 arquivos da T1a que ela começou a editar no meio da minha prova: `components/arena/carteiras.spec.tsx`, `components/beui/bump-chart.tsx`, `components/beui/line-chart.tsx`, `components/beui/sparkline.tsx`, `components/competidor.spec.tsx`, `components/competidor.tsx`, `components/components.spec.tsx`, `lib/chart.ts`. Os meus passam. Avisei o coordenador (`msg_a4af55a3c976`) e rodei o resto por partes, pela regra comum |
| O check por partes (14:34 a 14:38) | `pnpm exec turbo run lint`; `pnpm typecheck`; `pnpm test` (o mesmo banco e o Azurite); `pnpm docs:check` | o **ESLint de todos os pacotes com exit 0**; os **tipos com exit 2, 23 erros, todos em arquivos da T1a em andamento** (`app/(app)/(arena)/arena/page.tsx` e `modelos/[slug]/page.tsx` importam o `EquityChart` que saiu do `charts.tsx`; 21 no `components.spec.tsx`), nenhum nos meus; o **`pnpm test` com exit 0**: os contratos 13 arquivos e 501 testes, o site **48 arquivos e 881 testes** (com os testes novos da T1a), a api **154 arquivos e 2 pulados, 3.153 testes e 9 pulados**, os `scripts/*.test.mjs` **131, 0 falha** (os 113 de antes e os 18 da paleta); o **`docs:check` com "75 itens documentados"** |
| O `pnpm check` repetido (14:42 a 14:45) | o mesmo comando, com a trava, o mesmo banco, o Azurite e as mesmas guardas | **exit 0**: o Prettier ("All matched files use Prettier code style!"), o ESLint e os tipos de todos os pacotes; os contratos 13 arquivos e 501 testes, o site **48 arquivos e 881 testes**, a api 154 arquivos (2 pulados) e 3.153 testes (9 pulados), os `scripts/*.test.mjs` **131, 0 falha**; o `docs:check` com 75 itens. A T1a já tinha formatado e fechado os tipos dela: o check mede o working tree das 14:42, com o que ela tinha em andamento |
| Ensaio (14:34) | `ENSAIO_DATABASE_URL=…/alvesting_t1blanding_ensaio pnpm --filter @alvesting/api arena:ensaio` | **exit 0**; o `.data/ensaio/relatorio-s1-p5.txt` (escrito às 14:34:08) com o SHA-256 `081d860b31b6c69997424d92beacc190eefed498835b61e2ebe9b442d8891f12`, o de sempre |
| O `az` falso | `wc -l .data/guardas/az-stub/calls.log` | **0 linha**: nenhuma chamada |
| A guarda de rede | `.data/guardas/t1b-landing-rede.log` | **não existe**: nada tentou sair da máquina (a guarda só escreve quando barra). Ela estava ativa: a isca `fetch('http://203.0.113.1/isca')`, num log à parte, foi barrada ("fetch failed", `TCP 203.0.113.1`) |
| Os bancos | `DROP DATABASE` do `alvesting_t1blanding_test` (depois de cada `pnpm check`) e do `alvesting_t1blanding_ensaio` no `alvesting-postgres-1` | apagados; nenhum `alvesting_verify_*` sobrou; os outros bancos não são meus e ficaram |

## 9. O Lighthouse e o peso da landing

`pnpm lighthouse` (5 coletas, mediana; o Lighthouse 12.6.1 no celular simulado: tela pequena, CPU 4x mais lenta e 4G lenta), no mesmo Mac,
com outros programas abertos (carga média de 5 a 7). O "antes" é o build das 14:02: o código da fundação com a arte já azul (o mesmo tamanho
de PNG) e os testes novos; o "depois", o build final das 14:14.

| | A fundação (13:16, o relatório dela) | Antes da T1b (14:02) | **Depois (14:33)** |
|---|---|---|---|
| LCP, mediana (coletas) | 2.409 ms (2.404 a 2.421) | 2.417 ms (2.035 a 2.469) | **2.413 ms** (2.398 a 2.418) |
| CLS | 0 | 0 | **0** |
| TBT, mediana | 15 ms | 20 ms | **18 ms** |
| FCP, mediana | 905 ms | 908 ms | 905 ms |
| exit do `lhci` | 0 | 0 | **0** |

- **O elemento do LCP** é o mesmo nas 5 coletas e nos três: o parágrafo do hero (`main.mx-auto > section.grid > div.grid > p.text-15`). As
  fases: o TTFB de uns 452 ms e o resto atraso de renderização (a CPU simulada). A margem até o teto de 2,5 s é de uns 87 ms. **Sem A/B**: a
  regra comum pede o A/B só para a reprovação por menos de 50 ms.

O que a landing baixa (a coleta representativa, no fio e cru; 22 pedidos nos dois):

| Recurso | Antes | Depois | No fio |
|---|---|---|---|
| Documento (o HTML e o payload do React) | 38.652 B / 167.529 B | 38.688 B / 167.088 B | +36 B |
| CSS (um arquivo) | 13.921 B / 71.356 B | 13.761 B / 69.876 B | −160 B |
| JavaScript (10 arquivos) | 151.525 B / 478.363 B | 151.525 B / 478.363 B | 0 |
| Imagens (9: a marca, o sprite do quadro 0, a máscara do ladrilho e os seis logos) | 14.575 B | 14.575 B | 0 (o sprite azul tem os 3.856 B do âmbar) |
| **Total** | 219.410 B | **219.286 B** | **−124 B** |

- **O JavaScript** não mudou nem um byte: o movimento novo é CSS, e nenhuma ilha de cliente entrou.
- **O CSS** caiu 1.480 B crus: a sombra do recorte era o único utilitário de sombra do Tailwind no arquivo (`shadow-[…]`), e com ela iam as
  variáveis `--tw-shadow`, `--tw-inset-*` e `--tw-ring-*` que ele registra e põe em todo elemento; o `box-shadow` direto as tirou (o CSS final
  não tem nenhuma). Saíram também as regras da etiqueta no ladrilho e os passos da fita; entraram a `.seta` e o anel do recorte.
- **O documento** subiu 36 B no fio (as classes `seta` e `hash`; a etiqueta única no cabeçalho da faixa no lugar das seis) e caiu 441 B crus.

## 10. As capturas

**16 PNG** em `docs/redesign-premium/landing/`, tiradas do build final (14:14) por um spec temporário (copiado para `apps/web/e2e/` só durante
a execução e apagado logo depois; o dado é o sintético do e2e), com o tema escolhido pelo seletor (o `localStorage`), o movimento reduzido (a
arte no quadro 0 e a fita parada no começo, para a imagem ser estável) e as fontes carregadas; as de 390 px com o toque ligado:

| Tela | 1440 × 900 | 390 × 844 | A página inteira |
|---|---|---|---|
| Landing (`/`) | `landing-1440-claro.png`, `landing-1440-escuro.png` | `landing-390-claro.png`, `landing-390-escuro.png` | `landing-1440-claro-inteira.png`, `landing-1440-escuro-inteira.png`, `landing-390-claro-inteira.png`, `landing-390-escuro-inteira.png` |
| Como funciona | `como-funciona-1440-claro.png`, `como-funciona-1440-escuro.png` | `como-funciona-390-claro.png`, `como-funciona-390-escuro.png` | — |
| A 404 (`/rota-que-nao-existe`) | `nao-encontrada-1440-claro.png`, `nao-encontrada-1440-escuro.png` | `nao-encontrada-390-claro.png`, `nao-encontrada-390-escuro.png` | — |

**Comparadas com as do Rallies** (as `landing-1440-light*.jpeg` e `landing-390-light*.jpeg`, fora do git) e **com as da fundação**
(`docs/redesign-premium/fundacao/landing-*.png`): a escadaria azul clara no lugar da âmbar, na mesma moldura preta, nos dois temas (no
escuro, a moldura continua mais escura que a página, e o recorte ganha o anel branco a 8%, que o fio cinza fazia antes); o `[!]` do aviso na
sans; a fita na sans; a faixa dos laboratórios com o nome numa linha e uma etiqueta só, como a faixa de marcas do Rallies (que não tem
etiqueta nenhuma); o resto do hero, dos painéis, do FAQ, do CTA e do rodapé na mesma posição da fundação e do Rallies. O cartão "Arena
agora" e os recortes dos painéis 2 e 3 ainda têm as etiquetas em cada nome e a mono nos tickers: são as peças da T1a (seção 2). Nas de 390 px
(o desktop do Playwright com o toque emulado), o botão "›" da faixa do cartão aparece, porque essa emulação ainda responde `pointer: fine`;
num celular de verdade ele não aparece (é a faixa da onda anterior, e o `layout.spec.ts` o confere no desktop).

## 11. Desvios e o que fica

**Desvios do pedido**, cada um com o motivo:

1. **O `pnpm check` saiu com exit 0 só na segunda vez**: o primeiro (14:33) reprovou no `prettier --check .` de 8 arquivos da T1a, editados
   no meio da minha prova, e os tipos também reprovavam só em arquivos dela (seção 8). Avisei o coordenador, rodei o resto por partes e
   repeti o check inteiro às 14:42, com exit 0. O build, o e2e e o Lighthouse são do build das 14:14, que não tem nenhuma edição da T1a.
2. **Os três recortes com peças da T1a** (a faixa do cartão "Arena agora", o cartão de decisão e a tabela do ranking) ainda têm a etiqueta em
   cada nome, o sufixo de versão e a mono nos tickers: a decisão do coordenador põe a nota única dentro dessas peças, e elas mudam quando a
   T1a entregar. O Lighthouse da landing com as peças novas fica na prova da T1a (a especificação dela pede).
3. **A versão do prompt foi para o `.hash`** (a mono): ela é um identificador em hexadecimal (`8b778a00…`, 32 caracteres), como o SHA-256, e
   não um rótulo nem um número; o pedido tirava a mono "dos rótulos, da fita e dos números".
4. **A fita mudou de mecânica**, não só de fonte: a decisão 5 do ADR 0034 dizia "um caractere por passo" (`steps()`), que só faz sentido com a
   célula fixa da mono; na sans ela rola contínua. A nota no ADR 0034 registra.
5. **Nenhuma ilha de cliente abaixo da dobra**: o pedido a permitia "só se pesar pouco"; nenhuma candidata pagava o JavaScript (seção 3).
6. **O ajudante que tira o sufixo de versão** (`semVersao`, uma linha) mora no `landing/laboratorios.tsx`, com o comentário `ponytail:`: a T1a
   vai precisar do mesmo corte na faixa e no ranking, e, se ela der às peças da arena um ajudante comum, este sai.
7. **Dois testes novos não foram vistos falhar** (a primária e o hover): a regra da primária já valia, e o hover é uma regra de estilo escrita
   antes do teste; os dois ficam como guarda. Os que têm lógica (a paleta, a sans, a faixa, a fita) foram vistos falhar antes do código.
8. **As skills `better-typography` e `better-accessibility`** não estão na lista de skills do Claude Code desta máquina; estão em
   `~/.agents/skills/` e foram lidas de lá (a medida do texto, o peso abaixo de 18 px, o alvo de 44 px, o movimento reduzido como opção).

**O que fica para depois**:

- **Quando a T1a entregar**: os três recortes da landing mudam sozinhos (a nota única do "simulado", a sans nos tickers, sem o sufixo). Vale
  uma olhada nas capturas da landing depois disso.
- **O Artur**: dizer se o azul de uma matiz só, sem o contraste de matiz entre a figura e a pedra, está como ele quer (seção 1); o script
  refaz a arte em segundos se a escala ou a regra mudarem.
- **O Como funciona** em 1440 px tem a coluna de leitura de 768 px à esquerda e o lado direito vazio, como os textos legais; um sumário "Nesta
  página" preso à direita (só HTML e CSS) aproveitaria o espaço para a banca. Fora do pedido desta tarefa.
- **A pendência dos termos do Higgsfield** continua a do ADR 0034 (antes de publicar o repositório).

## 12. Os arquivos tocados

Novos:

- `scripts/arte-azul.mjs`, `scripts/arte-azul.test.mjs`
- `docs/redesign-premium/landing/` (as 16 capturas), `docs/redesign-premium/relatorios/landing.md`

Alterados:

- `apps/web/public/ascii/arte/escadaria.png`, `escadaria-q0.png`, `urso.png` e `urso-q0.png` (só o `PLTE`; os `.json` e o
  `src/arte/escadaria-q0.json` não mudaram)
- `apps/web/src/components/hero.tsx` (o `[!]` na sans, a `.seta`, os comentários), `apps/web/src/components/fita.tsx` (a fita contínua),
  `apps/web/src/lib/fita.ts` (o comentário do mínimo da volta), `apps/web/src/components/landing/laboratorios.tsx` (a etiqueta única e o nome
  sem o sufixo), `apps/web/src/components/landing/paineis.tsx` (o `.hash` e a `.seta`), `apps/web/src/components/site-chrome.tsx` (o
  comentário da Geist), `apps/web/src/app/(site)/como-funciona/page.tsx` (o `.hash`)
- `apps/web/src/app/globals.css`, por trechos: o comentário da `.moldura`; a `.tape` e a `.tape-trilho` (a sans e a rolagem contínua); no bloco
  da landing de antes, o `.ladrilho` (sem as regras da etiqueta), o `.recorte` (a sombra com o anel, sem o fio) e o comentário da
  `.nome-gigante`; e o bloco novo **"landing (T1b, design premium)"**, com a abertura e o fechamento, só com a `.seta`
- Os testes: `apps/web/e2e/landing.spec.ts`, `apps/web/e2e/hero.spec.ts`, `apps/web/src/components/hero.spec.tsx`,
  `apps/web/src/app/(site)/page.spec.tsx`
- Os docs: `docs/TELAS.md` (a seção 5, com o Lighthouse do design premium, e a seção 10, nos trechos da landing, da arte, da fita e do
  movimento), `docs/DEPENDENCIAS.md` ("Artes": a introdução e as quatro linhas dos PNG, com os blobs novos), `docs/adr/0034-volta-ao-design-ascii-ui-da-v1.md`
  (a nota de 05/11/2026)

Sem mudança, embora meus: `app/(site)/page.tsx`, `layout.tsx` e `error.tsx`, `app/not-found.tsx`, `components/arte.tsx`, `arte-viva.tsx`,
`landing/faq.tsx`, `rodape.tsx`, `e2e/home.spec.ts` e `e2e/nao-encontrada.spec.ts`. Nenhum arquivo da T1a, da T0b, da fundação nem do
`apps/api` foi editado.
