# ADR 0004: Service Bus, não Storage Queue nem BullMQ

- **Status:** aceita
- **Data:** 31/10/2026
- **Origem:** `docs/PLANO.md`, §5.14 (decisão deliberada)

## Contexto

O trabalho da arena é assíncrono e precisa de retentativa, de uma fila para as mensagens que não passam (DLQ) e de mensagem agendada, porque o COTAHIST pode sair mais tarde (plano, §5.5). O worker também precisa escalar pela profundidade da fila.

## Decisão

Azure Service Bus, com uma fila por tipo de trabalho (`market`, `news`, `briefing`, `decisions`, `settlement`, `maintenance`) e uma DLQ em cada uma. As entregas máximas de cada fila estão na tabela do plano, §5.5.

## Consequências

- A DLQ é nativa: depois das entregas máximas a mensagem vai para lá, e um alerta dispara (plano, §5.9).
- Mensagem agendada: o worker reagenda o `eod` em +60 min quando o arquivo ainda não saiu (`publishScheduled` em `messaging.service.ts`).
- A escala do worker vem da profundidade da fila, pela regra KEDA `azure-servicebus` (plano, §5.5).
- Sem Redis: a fase 1 não tem mais um serviço para operar.
- Custo por operação, abaixo de US$ 1/mês (plano, §5.12).

## Alternativas consideradas

- **Storage Queue:** descartado. Não tem DLQ nativa: a mensagem envenenada teria de ir para uma fila escrita à mão.
- **BullMQ:** descartado. Exige Redis, e o plano não quer um Redis gerenciado para isso (o Azure Cache for Redis está em aposentadoria, §5.1).
