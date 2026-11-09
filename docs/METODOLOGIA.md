# Metodologia da arena

**Status:** regras da Temporada 1 (o experimento), conferidas com o plano em 31/10/2026. A Temporada 1 de verdade (06/11/2026, decisão do Artur): de 13/10 a 30/12/2026, com os pregões que já passaram rodados como retroativos e os seguintes ao vivo; seção "Temporada 1: o trecho retroativo e o ao vivo". A liquidação, as referências, a política aleatória, o Monte Carlo e as métricas foram definidas na etapa 7 (01/11/2026) e estão na seção "Liquidação, referências e métricas". Os resultados vão para `docs/RESULTADOS.md` na etapa 14.

## Pergunta de pesquisa

Com as mesmas notícias, os mesmos dados e o mesmo prompt, LLMs de ponta tomam decisões de compra e venda na B3 melhores do que o acaso e do que o CDI numa temporada de algumas dezenas de pregões (a Temporada 1 tem 53, de 13/10 a 30/12/2026)?

## Hipóteses

- **H1:** pelo menos um modelo termina acima do percentil 95 das 1.000 carteiras aleatórias com as mesmas regras.
- **H2:** a média dos modelos supera o CDI e a carteira igual-peso do universo no período.

## Métricas

| Métrica                                                  | Papel                                                       |
| -------------------------------------------------------- | ----------------------------------------------------------- |
| Percentil no Monte Carlo (1.000 carteiras aleatórias)    | Principal. Mede se o resultado foge do acaso, com as mesmas regras |
| Excesso de retorno sobre o CDI e sobre a carteira igual-peso | Comparação com as referências                           |
| Drawdown máximo                                          | Risco ao longo da temporada                                 |
| Retorno, acerto e número de operações                    | Ranking e descrição                                         |
| Sharpe                                                   | Só descrição: com 20 pontos, pouco diz                      |

Se o orçamento permitir, 2 a 3 amostras por modelo e por pregão medem a variância do próprio modelo.

## Regras da arena

Parâmetros da temporada, conforme o plano (§2).

| Regra        | Valor                                                                                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capital      | R$ 100.000,00 por competidor                                                                                                                                                           |
| Duração      | 53 pregões na Temporada 1 (de 13/10 a 30/12/2026, o último pregão de 2026; o plano previa 20). A Temporada 0 é ensaio com provedores fake e não entra no resultado                     |
| Universo     | Até 500 ações ON, PN e UNIT, com volume financeiro médio de 60 pregões e presença em pelo menos 90% deles. Sem FII, ETF, BDR e opções. Refeito todo domingo e congelado na semana     |
| Ordem        | Embaralhada com semente do pregão; igual para todos os modelos                                                                                                                         |
| Ações        | BUY: 5% a 25% do patrimônio. SELL: 1% a 100% da posição. HOLD: com motivo. Só posição comprada, sem alavancagem e sem day trade                                                       |
| Limites      | Até 10 posições e 5 ordens por ciclo. HOLD não conta                                                                                                                                   |
| Decisão      | 08:00 (Brasília), com dados até o fechamento anterior. Prazo às 09:30; sem resposta, HOLD                                                                                              |
| Execução     | Preço de abertura do mesmo pregão (brapi). Vendas antes das compras. Ações inteiras                                                                                                    |
| Custo        | 0,03% por operação                                                                                                                                                                     |
| Caixa        | Rende o CDI diário (BCB, SGS 12)                                                                                                                                                       |
| Proventos    | Não creditados na v2.0                                                                                                                                                                 |
| Validação    | JSON estrito, validado por schema. Item inválido é descartado, e os outros valem. Ordens além da quinta, na ordem em que o modelo as listou, também são descartadas (HOLD não conta). JSON inválido ou fora do formato do envelope ganha um reparo. Se falhar, HOLD |
| Igualdade    | Mesmo prompt e briefing, com SHA-256 públicos; mesma hora; mesmos limites; sem ferramentas nem busca na web                                                                            |

## Competidores e referências

- **Modelos:** roster sugerido com o topo de cada laboratório (Anthropic, OpenAI, Google, xAI, DeepSeek e Alibaba). A lista final e os IDs são fixados na criação da temporada. O que o provedor aplicou fica gravado em cada decisão.
- **Sorteio:** controle obrigatório no ranking, com as mesmas regras. É uma carteira da política aleatória, com a semente própria da temporada (seção "Política aleatória").
- **Igual-peso do universo, só preço:** referência principal, com as mesmas regras e custos.
- **CDI:** o que o caixa renderia sem decisão nenhuma.
- **BOVA11:** contexto. Inclui proventos, que os modelos não recebem; por isso não é a referência principal.

As três referências e o Sorteio são calculados pelo mesmo motor de execução que os modelos, com o mesmo custo e o mesmo CDI no caixa. A definição de cada uma está na seção "Liquidação, referências e métricas".

## Entrada e saída dos modelos

- **Entrada:** igual para todos, exceto a própria carteira. Regras e data; macro (CDI, Selic, IPCA, dólar e BOVA11), cada valor com a sua data; tabela do universo, em ordem embaralhada com a semente do pregão (a ordem é a do SHA-256 de "pregão:ticker", igual para todos); barras de 30 pregões das posições, das ações citadas nas notícias e das 15 da triagem (as que mais se mexeram no último pregão entre as 100 mais líquidas do universo); notícias desde o congelamento anterior (título, fonte, hora e tickers, mais o trecho de até 300 caracteres só quando os termos da fonte autorizam, hoje a Agência Brasil e a CVM; tudo texto limpo e delimitado: notícia é dado, nunca instrução); e a carteira.
- **Saída:** JSON com `summary` (até 600 caracteres, vai para o feed), `market_view` (otimista, pessimista ou neutro) e as `decisions`. O schema vive em `packages/contracts`. Cada `rationale` tem até 280 caracteres.
- **Parâmetros iguais:** limite de tokens de saída, esforço de raciocínio médio quando o provedor tem esse ajuste, sem ferramentas e JSON Schema quando aceito. O que o provedor aplicou é gravado.
- **Teto de itens:** `decisions` tem no máximo 50 itens. Acima disso a resposta inteira é inválida (um reparo e, se falhar, HOLD); nada é cortado em silêncio.
- **Texto do modelo é texto de terceiro:** `summary` e `rationale` passam por limpeza antes de qualquer uso (saem HTML, caracteres de controle, invisíveis e de direção de texto), e link com esquema ou `www.` vira `[link removido]`. A página da arena (etapa 9) os mostra como texto, nunca como link.

## Prompt e briefing

- O prompt fica oculto durante a temporada. A cada ciclo, o público vê o SHA-256 do prompt e do briefing, com os parâmetros e os horários.
- O briefing é congelado às 07:30 em JSON canônico (chaves em ordem, só inteiros, sem float) e gravado no Blob; o SHA-256 público é o dos bytes exatos gravados. A mesma entrada dá o mesmo hash, e congelar de novo o mesmo pregão não muda nada (`docs/DADOS.md`, seção 18).
- Padrão adotado: o texto é revelado no fim da temporada, e o hash publicado confere (plano, §17.4). A decisão final é do Artur.
- Filtro de vazamento: canário e n-gramas de 8 palavras nos textos públicos.
- O texto nunca fica no repositório, na imagem, em log nem em resposta da API.

## Dados

| Fonte        | Uso                                                              | Entra na etapa |
| ------------ | ---------------------------------------------------------------- | -------------- |
| brapi        | Preço de abertura (execução) e de fechamento (marcação), fonte única; o banco é o cache e a barra gravada nunca muda | 4              |
| BCB SGS      | CDI (série 12) e macro do briefing                               | 4 e 5          |
| CVM IPE e FCA | Fatos relevantes e comunicados, no ticker pelo CNPJ da companhia | 5              |
| Feeds RSS    | Notícias: InfoMoney, Money Times, Seu Dinheiro e Agência Brasil  | 5              |

Cada fonte entra no `docs/DEPENDENCIAS.md` no PR que a usar. O COTAHIST da B3 foi a fonte das cotações até 03/11/2026 e saiu (ADR 0032): a página dele veda a coleta automatizada, inclusive por IA.

## Controle contra a sorte

- Sorteio obrigatório no ranking.
- Monte Carlo de 1.000 carteiras aleatórias, com as mesmas regras e semente fixa. O percentil de cada modelo é o resultado principal, e o cálculo é reproduzível: a mesma semente dá exatamente o mesmo resultado, e outra semente dá outro.
- Com poucas dezenas de pregões, o ranking diz pouco sozinho. Por isso as hipóteses são sobre o percentil, e não sobre a posição no ranking.
- Como o percentil é calculado e como a política aleatória sorteia as ordens: seções "Política aleatória" e "Monte Carlo".

## Liquidação, referências e métricas

**Status:** definições da etapa 7, de 01/11/2026. O código é o domínio puro `apps/api/src/modules/settlement/domain/`: funções sem banco, fila nem relógio, que a fila `settlement` liga ao banco (seção "Da fila ao banco", abaixo). Dinheiro é centavo inteiro (`bigint`), nunca float.

### Um pregão, na ordem

Para cada competidor, do primeiro pregão da temporada até D, a conta é refeita do zero a cada liquidação, e cada pregão faz, nesta ordem:

1. **Juros do CDI** sobre o caixa (todos os pregões, menos o primeiro).
2. **Eventos corporativos** que valem em D.
3. **Ordens de D**, ao preço de abertura de D.
4. **Marcação** no fechamento de D, que vira o snapshot do pregão (caixa, posições, patrimônio, juros e a data do CDI usado).

Refazer do zero é proposital. Um evento registrado depois e uma barra que chega atrasada saem certos sem lógica de correção, porque o resultado do pregão k só depende de dados até k (a barra gravada nunca muda, e a liquidação de um pregão já liquidado não é reaberta sozinha: `docs/DADOS.md`, seção 6). O teste confere as duas coisas: cortar a temporada em k pregões dá os mesmos k primeiros snapshots, e trocar as barras de um dia só muda a conta dali em diante.

### Execução das ordens

Entram os itens BUY e SELL da decisão de D já validados. HOLD não vira ordem.

| Regra                   | Definição                                                                                                                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preço                   | Abertura de D (brapi). Nunca o fechamento, nunca o preço de D-1                                                                                                                                                            |
| Ordem de execução       | Todas as vendas, depois todas as compras. Em cada grupo, na ordem em que o modelo listou                                                                                                                                  |
| Ações inteiras          | SELL: ⌊quantidade da posição × percentual⌋. BUY: ⌊valor-alvo ÷ preço⌋. Menos de 1 ação não executa                                                                                                                         |
| Patrimônio do BUY       | Caixa + posições a preço de abertura de D (posição sem barra: último fechamento conhecido). É medido antes de qualquer ordem do pregão, inclusive antes das vendas, e vale para todas as compras de D                      |
| Valor-alvo do BUY       | ⌊patrimônio × percentual⌋. Paga o valor das ações; o custo de 0,03% sai do caixa por cima                                                                                                                                  |
| Sem alavancagem         | O valor mais o custo da compra cabe no caixa naquele momento (depois das vendas e das compras anteriores). Se não couber, reduz para a maior quantidade que cabe (`REDUCED`). Se não couber nenhuma ação, não executa       |
| Até 10 posições         | BUY de ação nova com 10 posições não executa. A conta é feita na hora da execução, depois das vendas do pregão: a venda total libera a vaga, a parcial não, e BUY de ação que já está na carteira vale                      |
| Ação sem barra em D     | A ordem não executa e fica registrada com o motivo. Não há preço de substituição. A posição continua na carteira, marcada pelo último fechamento conhecido                                                                  |
| Última barreira         | Mais de 5 ordens num pregão ou percentual fora da faixa do contrato (BUY 5% a 25%, SELL 1% a 100%) é erro de programa. O validador da decisão descarta esses casos antes                                                   |

Cada ordem sai com um estado e, quando não executa, um motivo:

| Estado         | Quando                                                                          |
| -------------- | ------------------------------------------------------------------------------- |
| `FILLED`       | Executou a quantidade que o percentual pedia                                    |
| `REDUCED`      | O caixa só deixou comprar menos; executou a quantidade que coube                |
| `NOT_EXECUTED` | Não executou. O motivo diz por quê                                              |

| Motivo (`reason`)   | Quando                                                                                          | Ordem da checagem |
| ------------------- | ----------------------------------------------------------------------------------------------- | ----------------- |
| `no_position`       | SELL de ação que a carteira não tem                                                             | 1 (SELL)          |
| `max_positions`     | BUY de ação nova com 10 posições na hora da execução                                            | 1 (BUY)           |
| `no_bar`            | Ação sem barra em D. Abertura ou fechamento zero também conta como sem barra                    | 2                 |
| `below_one_share`   | O percentual não paga 1 ação inteira (BUY) ou a fração da posição é menos de 1 ação (SELL)      | 3                 |
| `insufficient_cash` | O percentual pagaria 1 ação ou mais, mas o caixa não paga nenhuma                               | 4 (BUY)           |

A regra é checar primeiro a carteira, depois o mercado, depois o tamanho. Cada ordem registra também a quantidade que o percentual pedia (`requested_quantity`), a executada e o preço de abertura usado, que é vazio quando não há barra.

### Custo e arredondamento

- **Custo:** 0,03% do valor negociado em cada operação, compra ou venda. Na compra soma ao valor pago; na venda sai do valor recebido. Sem custo mínimo e sem slippage. A taxa (3 pontos-base) e o limite de 10 posições são parâmetros da temporada (`tradeCostBps` e `maxPositions`, em `season.params`): a liquidação os recebe sem valor padrão, para uma temporada com outros valores não ser liquidada com os do plano por esquecimento.
- **Arredondamento:** uma regra só, em toda divisão que não é exata (custo, juros, custo médio, fração de evento, métricas): **o centavo mais próximo, e o meio vai para longe do zero** (para cima nos valores positivos). É a mesma regra que o briefing usa nas variações em pontos-base.
  - R$ 150,00 × 0,03% = 4,5 centavos, que viram 5. R$ 1.550,00 → 46,5 → 47. R$ 1.978,00 → 59,34 → 59. R$ 3.955,20 → 118,656 → 119.
- **Percentual:** o JSON do modelo traz um número (`12.5`). Ele vira ponto-base (centésimo de ponto percentual) a partir da grafia mais curta do número, sem passar pelo float: 12,5 vira 1250, 15,5 vira 1550 e 12,345 vira 1235 (o terceiro decimal decide, e o 5 sobe).
- **Custo da posição:** soma do que foi pago nas compras (valor mais custo). Na venda parcial, sai a parte proporcional (custo × vendidas ÷ quantidade), arredondada; a venda total leva tudo, sem resto. O custo da posição só serve ao acerto.

### Caixa e CDI

- O capital entra na abertura do primeiro pregão e **o primeiro pregão não rende**.
- **Cada intervalo entre dois pregões seguidos rende uma taxa diária**, a do pregão anterior. O CDI é a taxa de um dia útil; o fim de semana ou o feriado no meio do intervalo não rende a mais. Segunda-feira rende a taxa de sexta, uma vez.
- O SGS publica o CDI de um dia no dia útil seguinte. Se a taxa do pregão anterior ainda não saiu quando a conta roda, **vale a última publicada antes dela**, e a data usada fica gravada no snapshot (`cdi_date`). A conta nunca olha para a frente: taxa de data posterior ao pregão anterior não entra, nem quando já existe na hora da conta.
- Como a temporada é refeita do zero, quando a taxa atrasada sair a próxima liquidação já usa a certa.
- **Sem nenhuma taxa publicada até o pregão anterior, a liquidação falha** (`MissingCdiError`). Render zero em silêncio daria um patrimônio errado e com cara de certo.
- Juros = caixa × taxa% ÷ 100, no centavo mais próximo. A taxa vem de `macro_daily` (série 12, texto decimal de até 8 casas) e vira inteiro; valor com mais casas ou fora do formato derruba a conta. Só o caixa rende, e os juros entram antes das ordens do pregão (o caixa que rende é o do fim do pregão anterior).

### Marcação

O patrimônio no fechamento de D é o caixa mais cada posição pelo fechamento de D. A posição sem barra em D é marcada pelo último fechamento conhecido e aparece como `stale` no snapshot. A marcação não é preço de execução: só serve para o patrimônio.

### Evento corporativo

Desdobramento, grupamento e bonificação em ações são a mesma conta: cada `from` ações antigas viram `to` ações novas. Desdobramento de 1 para 2 é `from` 1 e `to` 2; grupamento de 10 para 1 é `from` 10 e `to` 1; bonificação de 10% é `from` 10 e `to` 11.

- **Quando vale:** no começo do primeiro pregão em ou depois da data ex em que a ação tem barra, antes das ordens. A barra gravada do pregão é a capturada na noite do pregão e nunca muda depois (a brapi pode ajustar o histórico que ela devolve depois; a prova controlada mediu que o OHLC não vem ajustado por provento, e desdobramento e grupamento não foram medidos: `docs/DADOS.md`, seção 4), então na data ex a cotação cai (ou sobe) pelo fator, e sem o ajuste o patrimônio mostraria uma perda ou um ganho que não existiu. Se a ação não negocia na data ex, o preço novo só aparece depois, e a posição fica no estado velho (quantidade e último fechamento velhos), que é coerente até lá.
- **Quantidade e custo:** a quantidade vira ⌊quantidade × `to` ÷ `from`⌋. O custo total da posição não muda: o preço médio por ação é que muda, na proporção inversa.
- **Fração de ação:** o que sobra da conta acima (só em grupamento e bonificação) é pago em dinheiro **ao preço de abertura do dia em que o evento vale**, no centavo mais próximo, e leva o custo na proporção (o custo da posição fica com as ações inteiras: custo × inteiras ÷ quantidade exata). Se não sobra nenhuma ação inteira, a posição some e só o dinheiro da fração fica. É uma simplificação: sem atraso e sem custo.
- **Fora desta etapa:** proventos em dinheiro (dividendos, juros sobre capital próprio) não são creditados. É a limitação declarada da v2.0 e a razão de a referência principal ser só preço.

### Referências

O igual-peso e o BOVA11 pagam o mesmo custo de 0,03% dos modelos e deixam o caixa rendendo o mesmo CDI, na mesma conta de cada pregão.

- **Igual-peso do universo, só preço:** na abertura do primeiro pregão, compra todas as ações do universo da semana de início, com pesos iguais, e segura até o fim. A fatia de cada ação é o caixa dividido pelo número de ações do universo que têm barra nesse dia (inteiro, para baixo), e a compra é a maior quantidade cujo valor mais custo cabe na fatia. Assim a soma nunca passa do caixa e o custo é o mesmo dos modelos. Detalhes que mudam o resultado, todos registrados nas ordens:
  - ação do universo sem barra no primeiro pregão fica de fora (`no_bar`) e o peso se divide entre as que têm, porque não existe preço de substituição;
  - ação cujo preço passa da fatia não é comprada (`below_one_share`), e a fatia fica no caixa rendendo CDI;
  - **o limite de 10 posições e a faixa de 5% a 25% não se aplicam a ela, por construção**: é uma referência de carteira inteira do universo, e não uma carteira que decide. Ela não passa pela checagem dos modelos.
- **CDI:** o capital inteiro no caixa, rendendo a regra de data acima. Não tem ordem nem posição.
- **BOVA11:** compra na abertura do primeiro pregão com o capital todo (a maior quantidade cujo valor mais custo cabe nele) e segura. É só contexto. O plano o rotula como referência que inclui proventos; aqui a conta é só de preço, como a das ações (compra, segura, marca pelo fechamento, mesmo custo, mesmo CDI no caixa), e nenhum provento em dinheiro é creditado a ele. Se não houver barra do BOVA11 no primeiro pregão, a ordem fica registrada como não executada e o capital segue no CDI.

### Política aleatória (Sorteio e Monte Carlo)

A política é a mesma para o Sorteio e para as carteiras do Monte Carlo, e cumpre as regras de ações do plano (§2). A cada pregão sorteia de 0 a 5 ordens. Cada ordem é **SELL** de uma posição da carteira, de 1% a 100% dela, ou **BUY** de uma ação do universo da semana, de 5% a 25% do patrimônio, sempre com percentuais inteiros e com tickers distintos no pregão. As ordens saem no mesmo formato das decisões dos modelos, passam pelo mesmo schema e pelo mesmo motor de execução: caixa, ação inteira, 10 posições, barra e custo valem igual.

**Todo o acaso vem do SHA-256**, sem gerador pseudoaleatório caseiro, sem `Math.random` e sem estado. O sorteio de número `n` é o SHA-256 de `semente:pregão:carteira:n`, com os 6 primeiros bytes lidos como inteiro de 48 bits (`pregão` é `AAAA-MM-DD`, `n` começa em 0 e sobe a cada sorteio). O viés do módulo sobre n itens é da ordem de n ÷ 2^48, cerca de 2 em cada trilhão para 500 ações. Quem tem a semente refaz qualquer sorteio, em qualquer ordem. A sequência de cada carteira em cada pregão é fixa:

1. Quantas ordens: `sorteio % 6`.
2. Para cada ordem, o tipo: sorteio par é SELL, ímpar é BUY. Se for SELL e a carteira não tem posição livre (ainda não sorteada no pregão), a ordem vira BUY.
3. O ticker, entre os que ainda não saíram no pregão: no SELL, as posições da carteira em ordem alfabética; no BUY, o universo da semana de D em ordem alfabética.
4. O percentual: `1 + sorteio % 100` no SELL e `5 + sorteio % 21` no BUY.

A ordem sorteada que não cabe (carteira com 10 posições, caixa curto, ação sem barra) não executa e fica registrada, exatamente como a de um modelo. Por isso uma carteira aleatória que enche as 10 posições passa a operar menos: a maior parte dos BUY sorteados é de ação nova. É uma escolha do desenho, e vale para o Sorteio e para as 1.000 carteiras.

O **Sorteio** é a carteira de chave `sorteio` dessa política, com a semente própria da temporada. As carteiras do Monte Carlo têm chaves `mc:0` a `mc:999` e a semente fixa da temporada, então nenhuma repete a do Sorteio.

### Monte Carlo

- **Carteiras:** 1.000, da política acima, simuladas do primeiro pregão até D pela mesma rotina dos modelos, com o mesmo capital, custo, CDI e eventos.
- **Distribuição por pregão:** o patrimônio de fechamento e o retorno sobre o capital (em pontos-base) nos percentis 5, 25, 50, 75 e 95. O percentil é o do **posto mais próximo, sem interpolação**: o valor de posto ⌈p × N ÷ 100⌉ da lista ordenada. Com N = 1.000, o percentil 5 é o 50º menor valor e o 95 é o 950º. É sempre o patrimônio de uma carteira de verdade.
- **Percentil de cada competidor, em cada pregão e no fim:** a parcela das 1.000 carteiras que ficou abaixo do competidor, mais metade das empatadas, em pontos-base (0 a 10.000, no ponto-base mais próximo; 9.650 é o percentil 96,5). "No fim" é o último pregão simulado. A leitura de H1 ("acima do percentil 95") é percentil do modelo de 9.500 para cima.
- **Reprodutível:** a mesma semente dá exatamente o mesmo resultado, até o último percentil de cada competidor; outra semente dá outro (os dois casos estão nos testes).
- **Desempenho:** 1.000 carteiras × 20 pregões × 500 ações rodam em 0,2 a 0,3 s, e a liquidação inteira de um elenco com o igual-peso de 500 ações, o Sorteio, o Monte Carlo e as métricas leva o mesmo tempo (medido no teste, num Mac arm64 com Node 26).

### Métricas da temporada

Todas em pontos-base inteiros (1 bp = 0,01%) e arredondadas uma vez só, pela regra de arredondamento acima.

| Métrica                | Definição                                                                                                                                                                   |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retorno                | (patrimônio final − capital) ÷ capital                                                                                                                                      |
| Percentil              | O do Monte Carlo no último pregão (acima). Vazio se a temporada ainda não rodou o Monte Carlo                                                                               |
| Excesso                | (patrimônio final do competidor − o da referência) ÷ capital, sobre o igual-peso e sobre o CDI. Calculado uma vez sobre os patrimônios, não pela diferença dos retornos arredondados |
| Drawdown máximo        | A maior queda, em % do pico, entre o patrimônio de fechamento e o maior patrimônio visto até ali. O capital inicial conta como o primeiro pico. Positivo; 0 se nunca cai. Medido nos fechamentos, não dentro do dia |
| Acerto                 | Vendas executadas com resultado realizado positivo ÷ vendas executadas. Resultado = valor recebido (valor menos custo) − custo médio das ações vendidas. Resultado zero não é acerto. Vazio se não houve venda |
| Número de operações    | Execuções (compras e vendas). Ordem que não executou não conta                                                                                                              |

O acerto é por venda executada, e não por ação: uma posição que o modelo nunca vendeu não entra, ganhando ou perdendo, porque ainda não foi realizada. O Sharpe, que o plano manda só descrever, fica fora da `season_stat`.

### Da fila ao banco (a fila `settlement`)

A mensagem `settle {temporada, pregão}` liga o domínio ao banco (`apps/api/src/modules/settlement/`; operação em `docs/JOBS.md`, seção 4.1). O
que a metodologia precisa saber dela:

- **Fontes.** A liquidação lê só: as decisões (o item que valeu; o descartado pelo validador nunca vira ordem, e o percentual é o do banco, com
  até 4 casas), as barras (brapi, só inserção), o universo congelado de cada semana, o CDI e os eventos
  corporativos. Nada mais entra na conta.
- **HOLD por omissão.** Pregão sem ciclo, ciclo pulado (`SKIPPED`), decisão com HOLD forçado (prazo, prompt divergente, resposta inválida,
  falha) e modelo sem decisão contam como HOLD. O modelo que não decidiu num ciclo vencido ganha o HOLD `sem_resposta` da varredura antes da
  conta, e o ciclo fecha.
- **Dados incompletos.** A liquidação não chuta: não grava nada, deixa o resultado anterior como está e falha para a fila tentar de novo
  quando (a) um pregão da temporada não tem barra de **nenhuma** ação do universo (as barras do dia não foram carregadas), (b) uma semana da
  temporada não tem universo congelado, ou (c) não há CDI publicado até o pregão anterior. **Não** é incompleto, e a conta segue pelas regras
  da seção "Um pregão, na ordem", a ação que não tem barra num dia que tem as outras (a ordem não executa, a posição é marcada pelo último
  fechamento) e o CDI do dia que ainda não saiu (vale o último publicado, com a data no snapshot).
- **Até onde a conta vai.** Até o maior entre o pregão da mensagem e o último já liquidado, e sempre do primeiro pregão. Assim a liquidação
  de um dia antigo (uma cópia que chega tarde, ou o dia cujas barras mudaram) também refaz os dias seguintes, e a temporada nunca encolhe.
  O resultado de cada pregão só depende dos dados até ele, então liquidar pregão a pregão dá, em cada um, o mesmo resultado de liquidar a
  temporada inteira de uma vez (está nos testes).
- **Reproduzível.** Os mesmos dados e as mesmas sementes dão as mesmas linhas, até o último percentil (só os ULIDs das linhas mudam; por isso o `id` de uma
  linha derivada não é identificador público, e link e citação usam as chaves naturais: competidor, pregão e ticker). O
  Sorteio usa a `randomSeed` da temporada e o Monte Carlo, a `monteCarloSeed` e o `monteCarloRuns`, todos públicos.
- **Encerramento.** Quando o pregão liquidado é o último da temporada (`sessions`), ela vira `FINISHED` na mesma transação da última liquidação.
- **Desempenho pelo banco.** Com 500 ações, 20 pregões e 1.000 carteiras aleatórias, o `settle` do último pregão leva cerca de 1,2 s de ponta a
  ponta (lê ~9,5 mil barras, simula, roda o Monte Carlo e grava ~10 mil linhas de posição), num Mac arm64 com Node 26 e Postgres 17 local.

### A planilha conferida à mão

Os testes comparam a simulação com quatro CSVs derivados à mão, centavo a centavo: `fixtures/hand-checked-orders.csv` (ordens e execuções), `-positions.csv` (posições de cada fechamento), `-snapshots.csv` (caixa, juros, CDI usado e patrimônio) e `-stats.csv` (métricas), em `apps/api/src/modules/settlement/domain/`. Os números abaixo foram derivados à mão, passo a passo, antes de rodar o código da liquidação sobre o cenário, e escritos nos CSVs antes de a simulação da temporada existir. Cada conta está escrita por extenso (alvo, ações inteiras, custo e arredondamento), para o leitor refazê-la numa calculadora e comparar com os CSVs versionados. Quando o teste discorda do CSV, a conta que se refaz é a da mão: o CSV só muda se a derivação estiver errada, e nunca para acompanhar o código. Os mesmos CSVs conferem também o caminho pelo banco: o `settle` sobre a planilha gravada no `alvesting_test` (barras, universo, CDI, evento, ciclos e decisões) devolve os mesmos centavos (`application/settle.handler.integration.spec.ts`).

**O cenário.** Capital de R$ 10.000,00 (1.000.000 centavos; menor que o da temporada para as contas caberem à mão, com a mesma mecânica). Três ações, cinco pregões: terça 03/11 (o 02/11 é Finados), quarta 04/11, quinta 05/11, sexta 06/11 e segunda 09/11. O universo é AAA3, BBB4 e CCC3, e o BOVA11 fica fora dele.

| Pregão | AAA3 abertura / fechamento | BBB4 | CCC3 | BOVA11 |
| ------ | -------------------------- | ---- | ---- | ------ |
| 03/11  | 2.300 / 2.400              | 2.500 / 2.600 | 1.000 / 990   | 13.000 / 13.100 |
| 04/11  | 2.420 / 2.500              | 2.620 / 2.700 | 1.010 / 1.050 | 13.050 / 13.200 |
| 05/11  | **sem barra**              | 1.300 / 1.250 | 1.040 / 1.020 | 13.200 / 13.150 |
| 06/11  | 2.480 / 2.550              | 1.280 / 1.400 | 1.000 / 980   | 13.100 / 13.300 |
| 09/11  | 2.560 / 2.500              | 1.390 / 1.350 | 990 / 1.010   | 13.250 / 13.400 |

Preços em centavos por ação. Eventos e CDI:

- **Desdobramento de BBB4, 1 para 2, data ex 05/11:** os preços de BBB4 de 05/11 em diante já são os pós-desdobramento.
- **CDI (% ao dia):** 30/10 0,050001; 03/11 0,050788; 04/11 0,050812; 05/11 0,050640; **06/11 ainda não publicado**; 09/11 0,050700, que só sai depois da liquidação de 09/11 e não pode entrar nela.
- **Decisões do modelo `model-a`:** 03/11 BUY AAA3 20%, BUY BBB4 15,5%, HOLD CCC3. 04/11 SELL AAA3 51%, BUY CCC3 25%. 05/11 SELL AAA3 100%, BUY CCC3 25%, BUY BBB4 25%. 06/11 BUY AAA3 25%, SELL BBB4 100%. 09/11 SELL CCC3 100%, BUY BBB4 25%.

**Derivação do `model-a`.** Custo = valor × 0,03%, arredondado como acima. Cada fechamento lista caixa + posições = patrimônio.

- **03/11** (primeiro pregão: sem juros). Patrimônio na abertura 1.000.000.
  - BUY AAA3 20%: alvo 200.000; ⌊200.000 ÷ 2.300⌋ = 86 (87 custariam 200.100). Valor 197.800, custo 59,34 → 59. Sai 197.859; caixa 802.141. Posição: 86 ações, custo 197.859.
  - BUY BBB4 15,5%: alvo 155.000; 155.000 ÷ 2.500 = 62 exatas. Custo 46,5 → **47** (o meio sobe). Sai 155.047; caixa 647.094. Posição: 62 ações, custo 155.047.
  - Fechamento: AAA3 86 × 2.400 = 206.400; BBB4 62 × 2.600 = 161.200; posições 367.600. **Patrimônio 647.094 + 367.600 = 1.014.694.**
- **04/11.** Juros pela taxa de 03/11: 647.094 × 0,050788% = 328,646 → **329**; caixa 647.423. Patrimônio na abertura: 647.423 + AAA3 86 × 2.420 (208.120) + BBB4 62 × 2.620 (162.440) = 1.017.983.
  - SELL AAA3 51%: ⌊86 × 51%⌋ = ⌊43,86⌋ = 43 ações a 2.420 = 104.060; custo 31,218 → 31; recebe 104.029. Custo das 43 vendidas: 197.859 × 43 ÷ 86 = 98.929,5 → **98.930**; resultado realizado 104.029 − 98.930 = **+5.099**. Posição: 43 ações, custo 98.929. Caixa 751.452.
  - BUY CCC3 25%: alvo 1.017.983 × 25% = 254.495,75; ⌊254.495,75 ÷ 1.010⌋ = 251 (252 custariam 254.520). Valor 253.510, custo 76,053 → 76; sai 253.586. Caixa 497.866. Posição: 251 ações, custo 253.586.
  - Fechamento: AAA3 43 × 2.500 = 107.500; BBB4 62 × 2.700 = 167.400; CCC3 251 × 1.050 = 263.550; posições 538.450. **Patrimônio 497.866 + 538.450 = 1.036.316.**
- **05/11** (data ex de BBB4; AAA3 sem barra). Juros pela taxa de 04/11: 497.866 × 0,050812% = 252,976 → **253**; caixa 498.119.
  - Desdobramento 1 para 2: BBB4 vai de 62 para 124 ações; o custo total, 155.047, não muda; sem fração.
  - Patrimônio na abertura: AAA3 43 × 2.500 (último fechamento, sem barra) = 107.500; BBB4 124 × 1.300 = 161.200; CCC3 251 × 1.040 = 261.040; caixa 498.119; total 1.027.859.
  - SELL AAA3 100%: **sem barra, não executa** (`no_bar`). O fechamento de ontem, 2.500, não vira preço de execução.
  - BUY CCC3 25%: alvo 1.027.859 × 25% = 256.964,75; ⌊256.964,75 ÷ 1.040⌋ = 247. Valor 256.880, custo 77,064 → 77; sai 256.957. Caixa 241.162. CCC3: 498 ações, custo 253.586 + 256.957 = 510.543.
  - BUY BBB4 25%: alvo 256.964,75; ⌊256.964,75 ÷ 1.300⌋ = 197. O caixa é 241.162: 185 ações custam 185 × 1.300 = 240.500 + 72,15 → 72 = 240.572, que cabe; 186 custariam 241.800, que não cabe. **Reduz de 197 para 185** (`REDUCED`). Caixa 241.162 − 240.572 = 590. BBB4: 124 + 185 = 309 ações, custo 155.047 + 240.572 = 395.619.
  - Fechamento: AAA3 43 × 2.500 = 107.500 (marcada pelo último fechamento); BBB4 309 × 1.250 = 386.250; CCC3 498 × 1.020 = 507.960; posições 1.001.710. **Patrimônio 590 + 1.001.710 = 1.002.300.**
- **06/11.** Juros pela taxa de 05/11: 590 × 0,050640% = 0,299 → **0**; caixa 590. Patrimônio na abertura: AAA3 43 × 2.480 = 106.640; BBB4 309 × 1.280 = 395.520; CCC3 498 × 1.000 = 498.000; caixa 590; total 1.000.750.
  - A compra foi listada antes da venda, mas **as vendas executam primeiro**. SELL BBB4 100%: 309 × 1.280 = 395.520; custo 118,656 → 119; recebe 395.401; resultado realizado 395.401 − 395.619 = **−218**. A posição some. Caixa 395.991.
  - BUY AAA3 25%: alvo 1.000.750 × 25% = 250.187,5; ⌊250.187,5 ÷ 2.480⌋ = 100 (101 custariam 250.480). Valor 248.000, custo 74,4 → 74; sai 248.074. Caixa 147.917. AAA3: 43 + 100 = 143 ações, custo 98.929 + 248.074 = 347.003. (Com a compra antes da venda, o caixa de 590 não pagaria nem 1 ação.)
  - Fechamento: AAA3 143 × 2.550 = 364.650; CCC3 498 × 980 = 488.040; posições 852.690. **Patrimônio 147.917 + 852.690 = 1.000.607.**
- **09/11** (segunda; o CDI de 06/11 ainda não saiu). A taxa do pregão anterior não existe, então vale a última publicada, a de 05/11 (0,050640), e `cdi_date` fica 2026-11-05. A de 09/11 não entra. Juros 147.917 × 0,050640% = 74,905 → **75**; caixa 147.992. Patrimônio na abertura: AAA3 143 × 2.560 = 366.080; CCC3 498 × 990 = 493.020; caixa 147.992; total 1.007.092.
  - SELL CCC3 100%: 498 × 990 = 493.020; custo 147,906 → 148; recebe 492.872; resultado realizado 492.872 − 510.543 = **−17.671**. Caixa 640.864.
  - BUY BBB4 25%: BBB4 saiu da carteira, então é ação nova (a carteira só tem 1 posição, longe do limite). Alvo 1.007.092 × 25% = 251.773; ⌊251.773 ÷ 1.390⌋ = 181 (182 custariam 252.980). Valor 251.590, custo 75,477 → 75; sai 251.665. Caixa 389.199. BBB4: 181 ações, custo 251.665.
  - Fechamento: AAA3 143 × 2.500 = 357.500; BBB4 181 × 1.350 = 244.350; posições 601.850. **Patrimônio 389.199 + 601.850 = 991.049.**

**Derivação das referências.**

- **Igual-peso:** as três ações têm barra em 03/11, então a fatia é ⌊1.000.000 ÷ 3⌋ = 333.333. AAA3: 144 ações (144 × 2.300 = 331.200, custo 99,36 → 99, total 331.299; 145 custariam 333.500 e não cabem). BBB4: 133 ações (332.500 + 99,75 → 100 = 332.600). CCC3: 333 ações (333.000 + 99,9 → 100 = 333.100). Caixa 1.000.000 − 331.299 − 332.600 − 333.100 = 3.001. Em 05/11, o desdobramento leva BBB4 de 133 para 266 ações, com o custo de 332.600 intacto.

  | Pregão | Juros (caixa × taxa)      | Caixa  | Posições (quantidade × fechamento)                            | Patrimônio |
  | ------ | ------------------------- | ------ | ------------------------------------------------------------- | ---------- |
  | 03/11  | 0                         | 3.001  | 144 × 2.400 + 133 × 2.600 + 333 × 990 = 1.021.070             | 1.024.071  |
  | 04/11  | 3.001 × 0,050788% = 1,52 → 2 | 3.003  | 144 × 2.500 + 133 × 2.700 + 333 × 1.050 = 1.068.750           | 1.071.753  |
  | 05/11  | 3.003 × 0,050812% = 1,53 → 2 | 3.005  | 144 × 2.500 (sem barra) + 266 × 1.250 + 333 × 1.020 = 1.032.160 | 1.035.165  |
  | 06/11  | 3.005 × 0,050640% = 1,52 → 2 | 3.007  | 144 × 2.550 + 266 × 1.400 + 333 × 980 = 1.065.940             | 1.068.947  |
  | 09/11  | 3.007 × 0,050640% = 1,52 → 2 | 3.009  | 144 × 2.500 + 266 × 1.350 + 333 × 1.010 = 1.055.430           | 1.058.439  |

- **CDI:** 03/11 1.000.000. 04/11: 1.000.000 × 0,050788% = 507,88 → 508, total 1.000.508. 05/11: 1.000.508 × 0,050812% = 508,378 → 508, total 1.001.016. 06/11: 1.001.016 × 0,050640% = 506,915 → 507, total 1.001.523. 09/11: 1.001.523 × 0,050640% = 507,171 → 507 (a taxa de 05/11 de novo), total **1.002.030**.
- **BOVA11:** compra em 03/11 com o capital todo: 76 ações (76 × 13.000 = 988.000, custo 296,4 → 296, total 988.296; 77 passariam de 1.000.000). Caixa 11.704. Patrimônios: 03/11 76 × 13.100 (995.600) + 11.704 = 1.007.304; 04/11 juros 5,94 → 6, caixa 11.710, 76 × 13.200 (1.003.200), total 1.014.910; 05/11 juros 5,95 → 6, caixa 11.716, 76 × 13.150 (999.400), total 1.011.116; 06/11 juros 5,93 → 6, caixa 11.722, 76 × 13.300 (1.010.800), total 1.022.522; 09/11 juros 5,94 → 6, caixa 11.728, 76 × 13.400 (1.018.400), total **1.030.128**.

**Derivação das métricas** (capital 1.000.000):

| Competidor     | Retorno          | Excesso sobre o igual-peso     | Excesso sobre o CDI           | Drawdown máximo                                          | Acerto            | Operações |
| -------------- | ---------------- | ------------------------------ | ----------------------------- | -------------------------------------------------------- | ----------------- | --------- |
| `model-a`      | −8.951 → −89,51 → **−90** | −67.390 → −673,9 → **−674**  | −10.981 → −109,81 → **−110** | pico 1.036.316 (04/11), fundo 991.049 (09/11): 45.267 ÷ 1.036.316 = 4,368% → **437** (05/11 3,28%, 06/11 3,45%) | 1 de 3 vendas (+5.099, −218, −17.671) = 33,33% → **3.333** | 10 (a venda sem barra não conta) |
| `equal-weight` | +58.439 → **584** | 0                             | +56.409 → 564,09 → **564**    | pico 1.071.753 (04/11), fundo 1.035.165 (05/11): 36.588 ÷ 1.071.753 = 3,414% → **341** | sem vendas        | 3         |
| `cdi`          | +2.030 → **20**   | −56.409 → **−564**            | 0                             | **0**                                                    | sem vendas        | 0         |
| `bova11`       | +30.128 → **301** | −28.311 → −283,11 → **−283**  | +28.098 → 280,98 → **281**    | pico 1.014.910 (04/11), fundo 1.011.116 (05/11): 3.794 ÷ 1.014.910 = 0,374% → **37** | sem vendas        | 1         |

**O que a planilha prova.** O `model-a` cobre compra com piso em ação inteira, venda parcial com custo médio, o meio do centavo subindo (46,5 → 47 e 98.929,5 → 98.930), compra reduzida pelo caixa, compra listada antes da venda que a paga, dia sem barra com a venda recusada e a posição marcada pelo último fechamento, desdobramento (a quantidade dobra, o custo fica), juros com o CDI de uma taxa que ainda não saiu e juros que arredondam a zero. As referências cobrem a fatia igual com custo, o desdobramento sem ordem e o caixa que sobra rendendo. O teto de 10 posições, a fração de ação de um evento, o BOVA11 sem barra e a ação cara demais para a fatia não cabem em 3 ações e são cobertos pelos testes de unidade, com contas feitas à mão nos próprios testes.

## Temporada 1: o trecho retroativo e o ao vivo

**Decisão do Artur (06/11/2026; ADR 0038).** A Temporada 1 tem os seis modelos do OpenRouter (Anthropic, OpenAI, Google, xAI, DeepSeek e
Alibaba; `docs/ARENA.md`, seção 8), o Sorteio e as três referências, e vai de **13/10/2026 ao último pregão de 2026 (30/12/2026)**: 53 pregões
pelo calendário da B3 (`apps/api/seasons/temporada-1.json`; um teste refaz a conta). **13/10 é o primeiro pregão em que os seis modelos já
existiam no OpenRouter**: o Gemini 4 Argon entrou na lista nesse dia, e os outros cinco antes. Começar antes deixaria um modelo sem decidir, e
trocar o elenco no meio quebraria "mesmas regras para todos".

**Dois trechos.** Os pregões que já tinham passado quando a temporada começou de verdade (de 13/10 até a véspera da virada) entram como
**retroativos**: rodados depois, pelo `arena:retroativo`, com o mesmo motor da arena (os mesmos agendadores, handlers, validação, filtro de
vazamento e liquidação) e com o relógio do pregão simulado. A partir da virada, cada pregão é **ao vivo**: decidido na janela das 08:00 às 09:30
do próprio pregão, pelo operador local (o Mac, até a Azure existir). Cada ciclo guarda o modo (`RETROATIVO` ou `AO_VIVO`) e a hora real em que
rodou, e o site os mostra.

**O que o pregão retroativo vê.** Só o que o pipeline ao vivo teria visto às 07:30 do pregão, fonte por fonte (`docs/DADOS.md`, seção 22): as
barras até o pregão anterior; o documento da CVM a partir da hora em que a busca ao vivo o veria (o primeiro pregão depois do dia seguinte ao
da entrega); cada valor do BCB só depois de público, pela regra mais conservadora (o CDI e o dólar um dia útil mais velhos que no ao vivo, o
IPCA um mês mais velho); e a notícia de portal só se o operador a viu de verdade. O teste de visibilidade confere cada fonte.

**O que o pregão retroativo não tem.** As notícias dos portais (InfoMoney, Money Times, Seu Dinheiro e Agência Brasil): o RSS só mostra os
últimos itens e não guarda histórico, então o pregão retroativo fica sem elas até o operador local começar a coletá-las (o `--so-dados`, antes
da virada). O fato relevante da CVM e o macro do BCB ele tem, pela regra acima. O modelo do pregão retroativo decide, portanto, com menos
notícia que o do ao vivo: é uma diferença entre os dois trechos, igual para todos os modelos do mesmo pregão.

**As datas reais.** Num ciclo retroativo, a hora da decisão, o prazo, o fechamento, a liquidação e a hora em que o documento da CVM foi "visto"
seguem o relógio do pregão simulado. A hora real em que o ciclo rodou está em `executed_at` (a API pública a devolve como `executedAt`), e a de
cada chamada à LLM, nas horas do pedido e da resposta HTTP do IO bruto. Nenhuma rota pública apresenta um valor do retroativo como coletado ou
decidido na hora: o ciclo, o feed, a página do modelo, a da ação e a home levam o modo, e o ranking diz quantos pregões foram de cada modo.

**As regras do ao vivo.** O operador nunca abre um ciclo "ao vivo" atrasado: passada a janela da decisão (09:30, menos 5 minutos de margem), o
pregão não ganha ciclo ao vivo e só pode ser coberto pelo retroativo, como retroativo. Ele também só abre o ciclo ao vivo quando todos os
pregões anteriores da temporada já têm ciclo, e nunca para um pregão que já tem um.

**O mesmo prompt nos dois trechos.** A temporada fixa o SHA-256 do prompt ao começar, e nenhum ciclo abre com outro, retroativo ou ao vivo.
O texto continua oculto (seção "Prompt e briefing").

**A prova descartada (06/11/2026).** Antes do lote, o pregão de 13/10 rodou uma vez como prova do caminho real (das 12:29 às 12:33). Ela achou
um erro da arena, e não dos modelos: o formato de resposta (JSON Schema) mandado aos seis usava `oneOf`, que a Anthropic e o Google recusam
(HTTP 400), e por isso o Claude Opus 5.5 e o Gemini 4 Argon ficaram com HOLD forçado (`falha`) por um defeito nosso; o GPT-6.1 Sol, o Grok
4.7, o DeepSeek V4 Pro e o Qwen3.8 Max decidiram. A mesma prova mostrou o DeepSeek em laço de espaços quando o OpenRouter o mandava para a
Wafer, e a tentativa anterior tinha parado antes de abrir o ciclo, na janela do IPCA (`docs/DADOS.md`, seção 15). As correções: um schema só,
no dialeto que os seis aceitam, com as regras completas ainda conferidas pelo validador (`docs/ARENA.md`, seção 5; ADR 0016), a Wafer fora
do roteamento e a janela mensal do IPCA. **Decisão do Artur:** descartar a prova e refazer o 13/10 com os seis e o mesmo prompt (o mesmo
SHA-256), inclusive as quatro decisões válidas, para que todo pregão da temporada tenha o mesmo pedido para todos os modelos. Nada foi
escondido: a prova está guardada fora do git em `.data/temporada/prova-2026-11-06/` (o log, o relatório do pregão, as decisões e a cópia
inteira do banco, `alvesting_temporada.dump`, SHA-256 `69bd27ca5bd8f80a1b93f32702c3cd6a44847aec7c69c65c336bbe9614743be7`), e o IO bruto dela
continua no Blob. Ela custou US$ 0,437786, e os testes de roteamento e de formato, mais US$ 0,10; nenhum dos dois entra na temporada. O banco
da temporada foi recriado do zero, e o 13/10 refeito rodou das 13:37 às 13:41 (Brasília) do mesmo 06/11: os seis decidiram, por US$ 0,910464,
o mesmo valor que o OpenRouter cobrou da chave.

## Limitações declaradas

- **Amostra pequena.** Vinte pregões têm pouco poder estatístico. O sorteio e o Monte Carlo existem por isso.
- **Sem slippage.** A execução é ao preço de abertura, sem impacto de mercado. Entra só o custo de 0,03%.
- **Sem proventos.** A referência principal é só preço. O BOVA11 aparece como contexto, com o aviso de que inclui proventos.
- **Fracionário.** Quantidades que não são lote padrão usam o preço do lote padrão.
- **Uma decisão por pregão.** Não há repetição do mesmo modelo no mesmo dia, salvo as amostras extras, se o orçamento permitir.
- **Universo filtrado.** O filtro de presença e volume exclui ações ilíquidas, que inflariam o resultado. Na semana de 02/11/2026 (2026-W45) o filtro deixou **306 ações**, de 404 que negociaram nos 60 pregões anteriores (o teto de 500 não pesa; medido em 03/11/2026 sobre o arquivo da B3, que era a fonte: o universo de hoje sai das barras da brapi, com o volume estimado, e o de 2026-W45 saiu do banco quando o dev foi recriado, em 04/11/2026). Entram também as ações de empresas em recuperação judicial ou extrajudicial ou sob regime especial, que seguem negociando o mesmo ticker (o universo é definido por espécie, volume e presença, não pelo código de negociação da B3); o modelo pode comprar uma delas. A brapi cota tudo por unidade, então não há papel cotado por lote (o arquivo antigo da B3 trazia assim o GOLL54 e o AZUL53, cujo preço não cabia em centavos, e eles ficavam de fora; saíram com o dev recriado). Detalhes em `docs/DADOS.md`.
- **Sem web e sem ferramentas.** O modelo conhece só o briefing congelado às 07:30.
- **Corte por posição.** Quando o modelo pede mais de 5 ordens, ficam as 5 primeiras que ele listou e o resto é descartado, sem critério de qualidade (ADR 0016). O descarte é registrado em cada decisão. A conferência do limite de 10 posições conta as vendas antes das compras e roda de novo depois do corte: a venda total cortada não libera a vaga, e a compra que dependia dela cai com `max_positions`. A liquidação é a última barreira.
- **Falha vira HOLD.** Resposta inválida, sem resposta no prazo ou mensagem na DLQ contam como HOLD. Um modelo que falha fica parado naquele pregão, e o registro mostra quando isso acontece. O reparo (uma segunda chamada, com o erro) só começa com 3 minutos de folga, no prazo e no limite do job; sem eles, a primeira resposta, já paga, é gravada como HOLD, com o custo.
- **Custo.** Se o teto de custo for atingido, o ciclo inteiro vira HOLD (plano, §5.15).
- **Provedores.** Um provedor pode trocar o modelo por trás do mesmo nome. Por isso o que ele aplicou é gravado em cada decisão.
- **Esforço de raciocínio.** Os parâmetros são iguais "onde existirem". O DeepSeek V4 Pro 0813, do elenco proposto da Temporada 1, não tem o nível médio (só `max`, `high`, `low` e `none`, na lista pública do OpenRouter de 01/11/2026): o parâmetro não é enviado e ele usa o padrão dele (`high`), uma assimetria em relação aos outros cinco, que rodam em `medium` (`docs/ARENA.md`, seção 8).
- **Notícias.** Os modelos recebem o título, a fonte, a hora e os tickers de cada notícia, e o trecho de RSS de arquivo privado (truncado e delimitado) só quando os termos da fonte autorizam: hoje, a Agência Brasil e a CVM. O site mostra só título, fonte e link. A notícia entra no primeiro briefing depois da hora em que o worker a gravou: a que sai entre 07:00 e 07:30 entra no dia seguinte. Os fatos relevantes da CVM vêm dos dados abertos, que não são tempo real: o arquivo é refeito uma vez por dia, às 07:00, e o corte do briefing é às 07:30, então o fato relevante entra no briefing dois pregões depois de entregue (um, se entregue na sexta), igual para todos os modelos. Esse atraso pode pesar na pergunta de pesquisa. Do documento da CVM o modelo vê o título e o assunto, não o texto. Sete ações pequenas do universo ficam sem ligação ao CNPJ e, por isso, sem fato relevante. Três dos quatro sites de notícia não autorizam reproduzir o conteúdo a terceiros; por isso o trecho deles não vai às LLMs, só o título e a fonte, até haver autorização por escrito (`docs/DADOS.md`, seção 13).
- **Ação sem barra.** O `daily_bar` nunca é denso: uma ação com presença de 54 em 60 pregões fica sem barra em até 10% deles. Nesses dias a ordem sobre ela não executa, e a posição é marcada pelo último fechamento conhecido, que pode ficar velho se a ação passar vários pregões sem negociar. Nunca se usa um preço anterior para executar.
- **CDI.** Uma taxa por intervalo entre pregões, a do pregão anterior, e a última publicada quando ela ainda não saiu (a data usada fica no snapshot). O SGS publica o CDI de um dia no dia útil seguinte, então a liquidação das 21:30 pode rodar com uma taxa um dia velha; a próxima liquidação refaz a conta com a certa.
- **Evento corporativo.** Só desdobramento, grupamento e bonificação em ações, informados pelo admin. A fração de ação é paga em dinheiro ao preço de abertura do dia do evento, sem atraso e sem custo. Se a ação não negocia na data ex, o evento vale no primeiro pregão em que ela negocia.
- **Referência igual-peso.** Ação do universo sem barra no primeiro pregão, ou com preço acima da fatia, fica de fora, e o peso se divide entre as que entram (a fatia que sobra rende CDI). O limite de 10 posições não vale para ela.
- **Carteiras aleatórias.** Ordem sorteada que não cabe (10 posições, caixa curto, ação sem barra) não executa, como a de um modelo. A carteira que enche as 10 posições passa a operar menos. **Elas não ficam inteiras em ações, e um modelo pode ficar.** Medido no mercado sintético do repositório (`domain/fixtures/synthetic-market.fixture.ts`: 300 ações, 20 pregões, capital de R$ 100.000,00, 400 carteiras), a fatia do patrimônio em ações é, em média, de 38% no 1º pregão, chega a 83% no 8º e cai para uns 51% no 20º; a carteira média tem 10 posições a partir do 14º pregão, e das cerca de 50 ordens sorteadas por carteira só 31 executam (15 são recusadas pelo limite de posições). Por isso o percentil de um modelo contra elas mede em parte a exposição ao mercado, e não só a escolha das ações, o que pesa na leitura de H1. É a regra do plano (as mesmas regras para todos), e não um defeito do código. Se pesar, reportar também o retorno ajustado à exposição, ou um Monte Carlo com política de exposição parecida, é decisão do Artur e do orientador. Os números são de um mercado inventado, só para a ordem de grandeza: a medida do ensaio (a Temporada 0) pode substituí-los.
- **Acerto e drawdown.** O acerto conta só vendas executadas (resultado realizado), e o drawdown é medido nos fechamentos dos pregões, não dentro do dia. Com 20 pregões, os dois dizem pouco.
- **Reliquidação.** A temporada é recalculada do zero a cada liquidação, e o resultado de um dia pode mudar depois: quando um evento corporativo é registrado depois, ou quando uma barra atrasada entra (a barra gravada nunca muda, e o `eod` não reabre a liquidação de um pregão já liquidado; a barra atrasada entra na próxima liquidação regular, e o admin decide se reprocessa antes: RUNBOOK). A decisão de um modelo foi tomada sobre a carteira que ele tinha naquele dia; depois de refazer a conta a carteira pode ser outra, e a ordem que deixa de caber é recusada e registrada (`no_position`, `insufficient_cash`, `max_positions`), exatamente como na primeira conta. A decisão em si não é refeita.
- **Carteira da decisão atrasada.** O modelo decide com a carteira da última liquidação antes do pregão. Se a do pregão anterior atrasou (o `eod` ou o `settle` de ontem falhou; ou nenhuma rodou ainda e o pregão não é o primeiro da temporada, e então vale a carteira inicial), ele decide com a que existe, o log avisa, e a liquidação de depois executa a decisão sobre a carteira certa. O ciclo não é pulado por isso.
- **Resultado do dia incompleto.** Há uma fonte só (a brapi), então não existe barra provisória a trocar. Um papel que a brapi não entregou até o prazo das 00:30 fica sem a barra do dia (o `eod` registra a contagem e os 20 primeiros, e o alerta `eod-barras-ausentes` avisa se faltar o BOVA11 ou mais de 10% do conjunto obrigatório), e nesse dia a ordem sobre ele não executa (`no_bar`) e a posição é marcada pelo último fechamento conhecido (`stale`). A barra que chega depois é gravada, mas o dia já liquidado só a vê na próxima liquidação regular. O volume que o universo usa é estimado (quantidade × fechamento) e o preço do histórico de um papel carregado depois de um provento pode vir ajustado (`docs/DADOS.md`, seção 4).
- **Dois trechos na Temporada 1.** Os pregões retroativos não têm as notícias dos portais e veem o macro do BCB pela regra conservadora; os ao
  vivo têm tudo. A diferença é igual para todos os modelos do mesmo pregão, mas pode pesar na comparação entre os trechos (seção "Temporada 1").
  E o corte de conhecimento de cada modelo não é controlado pela arena: no pregão retroativo o modelo é chamado depois do pregão, e não há
  como provar que o treino dele não viu nada do período (a arena só garante que o briefing e a carteira não trazem nada de depois do corte).
- **Um período.** O resultado vale para essa temporada e essas condições. Não generaliza para outros períodos nem outros mercados.
- **Não é recomendação.** A arena é acadêmica, e as decisões dos modelos não são recomendação de investimento. O chat (etapa 13) não é competidor e não entra nos resultados.

## Cronograma

Contado da entrega (D), conforme o plano (§0.2): Temporada 0 (ensaio, 5 pregões) em D − 12 semanas; Temporada 1 entre D − 11 e D − 6 semanas. A data de entrega ainda não foi definida (plano, §17.1). Em 06/11/2026 o Artur fixou a Temporada 1 de 13/10 a 30/12/2026 (seção "Temporada 1"), e o prazo do Playbook é 30/11/2026: o trabalho entregue nessa data tem a temporada em andamento, com o trecho retroativo e o começo do ao vivo.
