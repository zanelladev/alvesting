# ADR 0022: A liquidação é refeita do zero, numa transação com a trava da temporada, e o dado que muda reabre o job

- **Status:** aceita
- **Data:** 01/11/2026
- **Origem:** `docs/PLANO.md`, §5.5, §7 e §16, etapa 7; ADR 0015; `docs/METODOLOGIA.md` ("Da fila ao banco"); `docs/JOBS.md`, seção 4.1

## Contexto

A liquidação executa as decisões a preço de abertura, rende o caixa no CDI, marca as carteiras, roda o Monte Carlo e calcula as métricas. O
resultado de um pregão só depende dos dados até ele, mas os dados mudam depois: as barras provisórias da brapi são trocadas pelas do
COTAHIST, e um evento corporativo é registrado quando alguém o percebe. A fila `settlement` tem até 3 réplicas do worker (KEDA), e a
mensagem `settle {temporada, pregão}` é repetida pelo Service Bus (o Basic não detecta duplicata). O `job_run` barra a repetição, mas
também barraria uma refeita legítima, porque a chave (`settle` + `temporada:pregão`) é a mesma.

## Decisão

1. **Do zero, até o último pregão conhecido.** Toda liquidação recalcula a temporada do primeiro pregão até o maior entre o pregão da
   mensagem e o último já liquidado, e **substitui** as linhas derivadas (ordens, execuções, posições, patrimônio, métricas e Monte Carlo)
   da temporada numa transação. Chaves naturais únicas (competidor, pregão, ticker) impedem duplicata mesmo se a substituição errar.
2. **A trava dentro da transação.** A transação abre com `pg_advisory_xact_lock(hashtextextended('settle:<temporada>', 0))` e só então lê
   decisões, barras, universo, CDI e eventos, simula e grava. Duas liquidações da mesma temporada se enfileiram e a segunda lê o que a
   primeira gravou; temporadas diferentes seguem em paralelo. Tudo lá dentro usa o cliente da transação (o pool tem 4 conexões por processo).
   O Monte Carlo é CPU síncrona entre duas consultas, com a conexão "ociosa em transação", e o pool (`PrismaService`) derruba quem passa de
   30 s assim; por isso a transação da trava sobe o `idle_in_transaction_session_timeout` local para os 120 s do próprio `$transaction`
   (`set_config(..., true)`, que vale só até o commit). Sem isso, o teto do contrato (10.000 carteiras) num worker de 0,5 vCPU falharia a cada
   entrega, com o erro enganoso de conexão, até a DLQ.
3. **Refazer reabre o job.** Quem sabe que o dado mudou (o `eod` que trocou barras, o comando `settle:event`) chama `JobRunStore.reopen`
   **antes** de publicar: marca a linha `FAILED`, em qualquer estado, e a próxima entrega a reassume. O contrato da mensagem não muda.
4. **O encadeamento antes da conclusão.** O `EodHandler` pede ao `SettlementPublisher` a publicação **antes** de concluir a própria linha, e o
   `eod` repetido republica. Uma `settle` por temporada em andamento ou encerrada que tem o pregão, com o mais novo entre os que ganharam
   barras.
5. **Dado incompleto não liquida.** Pregão da temporada sem barra de nenhuma ação do universo, semana sem universo e CDI ausente falham
   sem gravar nada; a fila tenta de novo e a DLQ avisa. O resultado anterior continua inteiro. O banco também barra o BUY que vale fora de 5%
   a 25% do patrimônio (`decision_item_buy_range_check`): o erro aparece na gravação da decisão, onde só aquele modelo vira HOLD, e não na
   liquidação, onde o `RangeError` do domínio interromperia a temporada de todos a cada entrega.
6. **O último pregão encerra a temporada** (`FINISHED` e `finished_at`) na mesma transação, com um `CHECK` no banco.
7. **O evento corporativo é registrado sob trava e deixa rastro.** Corrigir o fator de um evento muda, retroativamente, o resultado publicado,
   e `corporate_event` não guarda o valor antigo. Registrar ou corrigir abre uma transação com a trava consultiva do evento (dois registros
   simultâneos do mesmo evento se enfileiram, em vez de um estourar a chave duplicada) e grava uma linha em `audit_log` (ator, fator antigo e
   fator novo). Repetir o comando não grava nada.

## Consequências

- Corrigir um dia passado não tem lógica de correção: refaz-se tudo, e o resultado de qualquer pregão é o mesmo quer a temporada tenha sido
  liquidada dia a dia, quer de uma vez (está nos testes). Uma mensagem de pregão antigo que chega tarde nunca encolhe a temporada.
- O custo é a conta inteira a cada liquidação: cerca de 1,2 s para 500 ações, 20 pregões e 1.000 carteiras aleatórias, pelo banco.
- O resultado de ontem pode mudar hoje. A decisão de um modelo foi tomada sobre a carteira daquele dia; depois de reliquidar, a carteira
  pode ser outra, e a ordem que deixa de caber é recusada e registrada (limitação declarada na metodologia).
- Uma `settle` que falha nas cinco entregas vai para a DLQ e a temporada não encerra: o `freeze` e o `sched-cycle` continuam a tratá-la como
  em andamento. O alerta de DLQ da etapa 10 tem de cobrir a fila `settlement`. Reenviar qualquer `settle` mais novo da temporada, depois de
  corrigido o dado, refaz tudo.
- O `decide` lê a carteira da última liquidação antes do pregão; se a de ontem atrasou (ou nenhuma rodou, fora do primeiro pregão), decide com
  a que existe e o log avisa.
- **O `id` das linhas derivadas não é identificador público.** Como a substituição dá um ULID novo a toda ordem, execução, posição,
  patrimônio, métrica e linha do Monte Carlo a cada liquidação (e cada `eod` reliquida), um link, uma chave de cache do Front Door ou uma
  citação do chat que guardasse esse `id` quebraria na liquidação seguinte. A API pública (etapa 9) e o chat (etapa 13) identificam essas
  linhas pelas chaves naturais, que a unicidade do banco já garante: slug do competidor, pregão, ticker (e o índice da ordem no pregão).
  Só `fill.order_id` referencia essas linhas, e a execução sai junto com a ordem (cascade), então a troca não deixa referência solta.

## Alternativas consideradas

- **Correção incremental** (recalcular só a partir do dia que mudou): mais rápida, mas pede lógica de correção para cada tipo de mudança
  (barra, evento, CDI) e estados intermediários. A conta inteira custa pouco e é a que a planilha conferida à mão prova.
- **Revisão na chave da mensagem** (`settle {temporada, pregão, revisão}`): mudaria o contrato, o `MessageId` e a chave do `job_run`.
  Reabrir a linha dá o mesmo efeito sem tocar no contrato.
- **Trava de sessão** (`pg_advisory_lock`) numa conexão dedicada: pede uma conexão fora do pool e cuidado para soltá-la em toda saída. A de
  transação se solta sozinha no commit, no rollback e quando a conexão cai.
- **Serializar só pela concorrência 1 da fila:** vale por processo, e o KEDA sobe até 3 réplicas.
- **Publicar o `settle` depois de concluir o `eod`:** um processo que cai entre as duas coisas perde o encadeamento até o dia seguinte.
