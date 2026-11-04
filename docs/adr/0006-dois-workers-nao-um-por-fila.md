# ADR 0006: Dois workers, não um por fila

- **Status:** aceita
- **Data:** 31/10/2026
- **Origem:** `docs/PLANO.md`, §5.14 (decisão deliberada)

## Contexto

São seis filas com perfis diferentes. Cinco são leves (mercado, notícias, briefing, liquidação e manutenção). A fila `decisions` chama um LLM por modelo, com latência de dezenas de segundos e timeout de 25 min (plano, §5.3).

## Decisão

Dois workers:

- `worker-data` (`apps/api/src/worker.ts`): consome `market`, `news`, `briefing`, `settlement` e `maintenance`. De 0 a 3 réplicas pela profundidade das filas.
- `job-worker-decisions` (`apps/api/src/decide.ts`): um job do Container Apps por mensagem da fila `decisions`, com até 10 execuções simultâneas.

## Consequências

- Um modelo lento ou com erro não atrasa os outros: cada execução tem o seu timeout (plano, §5.5).
- A mesma imagem serve aos quatro papéis (HTTP, worker, decide e schedule). Só muda a entrada.
- Na fila `decisions` a concorrência é 1 por processo (`QUEUES` em `packages/contracts`). O paralelismo vem das execuções do job.

## Alternativas consideradas

- **Um worker por fila:** seis serviços com configuração própria, para um volume que cabe em um.
- **Um worker só para tudo:** uma chamada lenta de LLM ocuparia o mesmo processo que ingere dados e liquida.
