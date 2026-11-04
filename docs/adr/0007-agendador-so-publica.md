# ADR 0007: Agendador só publica, não executa o trabalho

- **Status:** aceita
- **Data:** 31/10/2026
- **Origem:** `docs/PLANO.md`, §5.14 (decisão deliberada)

## Contexto

Um cron que executa o trabalho perde a retentativa, a DLQ e a escala se o processo cair no meio da execução. O plano (§6) põe o trabalho na fila e deixa o agendador com uma única tarefa.

## Decisão

Os sete agendadores (`apps/api/src/schedule.ts`) só publicam uma mensagem com `MessageId` determinístico (ex.: `eod:2026-10-30`). Quem faz o trabalho são os workers.

## Consequências

- O agendador é trivial e tem pouco o que quebrar.
- Publicar duas vezes a mesma mensagem não duplica trabalho, porque a chave natural é única no banco (ADR 0005).
- O reagendamento do COTAHIST fica com o worker, que publica a mesma mensagem com entrega em +60 min (plano, §6). O cron não participa disso.
- O estado de um pregão está na fila e na tabela `job_run`, não no log do cron.

## Alternativas consideradas

- **Cron que executa o trabalho:** cai junto com o processo e perde a retentativa. A DLQ e o alerta só existem na fila.
