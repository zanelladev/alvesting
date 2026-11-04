# ADR 0005: Service Bus Basic, não Standard

- **Status:** aceita
- **Data:** 31/10/2026
- **Origem:** `docs/PLANO.md`, §5.14 (decisão deliberada)

## Contexto

O Standard acrescenta tópicos, sessões, transações e detecção de duplicata (plano, §18: documentação da Microsoft, out/2026). A fase 1 usa só filas.

## Decisão

Tier Basic. Quem impede o processamento em dobro é o banco: `job_run` tem chave única `(type, idempotency_key)` (`apps/api/prisma/migrations/20261031000000_init`).

## Consequências

- Sem detecção de duplicata. O `MessageId` determinístico (ex.: `eod:2026-10-30`) identifica a mensagem e a reenvia igual da DLQ, mas a repetição é barrada pelo banco.
- Sem tópicos. A fase 5 (várias competições em paralelo) vai precisar do Standard; esse é o gatilho para trocar (plano, §5.13).
- O emulador local imita o Basic, sem sessão e sem detecção de duplicata (`docker/servicebus/Config.json`, ADR 0001).
- Custo abaixo de US$ 1/mês em operações (plano, §5.12).

## Alternativas consideradas

- **Standard:** descartado agora. Compra detecção de duplicata, tópicos e sessões que nenhuma etapa da fase 1 usa.
