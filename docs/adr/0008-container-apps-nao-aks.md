# ADR 0008: Container Apps, não AKS

- **Status:** aceita
- **Data:** 31/10/2026
- **Origem:** `docs/PLANO.md`, §5.14 (decisão deliberada)

## Contexto

O sistema precisa de HTTP, cron, consumo de fila com escala pela profundidade, jobs por evento e revisões para blue/green. Um cluster Kubernetes daria tudo isso, com operação própria (plano, §5.3).

## Decisão

Azure Container Apps, no ambiente Consumption, dentro da VNet. Os recursos são `ca-web`, `ca-api`, `worker-data`, `job-worker-decisions` e os sete agendadores (plano, §5.3).

## Consequências

- Não há cluster, nodes nem atualização de Kubernetes para operar.
- Cron, escala por HTTP e por fila (KEDA) e revisões já vêm no Container Apps.
- O blue/green por label `green` é da etapa 10 (plano, §5.4).
- Quem precisar de controle fino de Kubernetes não o terá aqui. A fase 1 não precisa dele.

## Alternativas consideradas

- **AKS:** descartado. É operação de cluster para um sistema que cabe em revisões, jobs e filas gerenciadas.
