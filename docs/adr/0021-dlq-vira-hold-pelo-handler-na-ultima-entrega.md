# ADR 0021: A DLQ vira HOLD pelo handler na última entrega, com uma varredura de apoio

- **Status:** aceita
- **Data:** 01/11/2026
- **Origem:** `docs/PLANO.md`, §5.5 ("Mensagem na DLQ vira HOLD registrado") e §16, etapa 6; ADR 0015; `docs/ARENA.md`, seção 5

## Contexto

A fila `decisions` tem 3 entregas. A mensagem que falha nas três vai para a DLQ, e o competidor ficaria sem decisão: o ciclo nunca
fecharia e a liquidação não saberia se o modelo respondeu HOLD ou sumiu. O plano manda que a mensagem na DLQ vire um HOLD registrado.
O tratamento por nova tentativa é do `MessagingService` (ADR 0015), que conta as tentativas na propriedade `attempt` da mensagem; o handler
não via nem o número da tentativa.

## Decisão

1. **O handler na última entrega.** `handleDelivery` e `MessagingService` passam ao handler a entrega `{ attempt, lastAttempt }` (segundo
   argumento, opcional: os handlers das outras filas o ignoram). O `DecideHandler`, quando a última entrega falha, grava a decisão
   como HOLD com o motivo `falha` e **não lança**: a mensagem é concluída e não vai para a DLQ. O `job_run` fica `FAILED` com o erro,
   para o painel e o alerta da etapa 10. Se nem o HOLD dá para gravar (banco fora), o erro sobe e a mensagem vai para a DLQ.
2. **A varredura de apoio.** Para o que nenhum handler vê (trava expirada três vezes e o broker manda a mensagem para a DLQ; mensagem nunca
   publicada), `CycleCloser.closeOverdue` fecha o ciclo `OPEN` com o prazo vencido há mais de 15 minutos: cada MODEL sem decisão ganha HOLD
   `sem_resposta`. Roda no `sched-cycle`, antes de abrir o ciclo do dia, e tem de rodar no início do `settle` da etapa 7.
3. **O ciclo fecha** quando todos os competidores MODEL têm decisão, normal ou HOLD forçado (um `UPDATE` condicional, sem corrida entre
   execuções que terminam juntas).
4. Mensagem inválida (corpo torto, fila errada) continua indo para a DLQ na hora: não há competidor a registrar.

## Consequências

- O HOLD por falha aparece na hora (na terceira entrega, uns 30 minutos depois das 08:00, dentro do prazo das 09:30), e não só no
  dia seguinte. Nenhum alerta de DLQ dispara para um modelo que apenas falhou; a falha fica em `job_run` e em `decision.hold_reason`.
  O alerta de DLQ passa a significar "algo que o handler não conseguiu tratar".
- A última entrega só ganha o HOLD se o erro foi do processamento. `JobBusyError` (outra entrega ainda é a dona da linha) vem antes do
  tratamento e vai para a DLQ de propósito: escrever um HOLD por cima de uma execução que ainda trabalha criaria uma corrida.
- O custo de uma chamada paga cuja gravação falha depois (Blob fora) se perde: a decisão não é gravada, a fila repete e o modelo é
  chamado de novo. Fica declarado como limitação.
- O handler passou a receber um segundo argumento; o `MessagingService.receiveOne` (uma mensagem por execução) devolve o que de fato
  aconteceu com a mensagem (`complete`, `retry`, `deadletter`, `abandon` ou `empty`).

## Alternativas consideradas

- **Só a varredura.** Mais simples, e cobre tudo, mas o HOLD só apareceria depois do prazo mais a folga, e a liquidação das 21:30 dependeria
  dela. Com o handler na última entrega o caminho comum é imediato e a varredura fica para a exceção.
- **Ler a DLQ e gravar o HOLD a partir dela.** Um consumidor da DLQ é um processo a mais (infra, identidade e alerta próprios) e o
  `deadLetterErrorDescription` não carrega o competidor se a mensagem estiver torta.
- **Contar as tentativas em `job_run.attempts`.** O ADR 0015 já recusou: acopla a camada de mensagens ao banco.
