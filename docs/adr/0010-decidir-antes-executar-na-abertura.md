# ADR 0010: Decidir antes, executar na abertura

- **Status:** aceita
- **Data:** 31/10/2026
- **Origem:** `docs/PLANO.md`, §5.14 (decisão deliberada)

## Contexto

As decisões são tomadas às 08:00 (Brasília), com dados até o fechamento anterior. A execução é ao preço oficial de abertura do mesmo pregão, às 10:00 (plano, §2 e §7). Se o modelo visse o preço em que a ordem executa, a arena mediria a leitura desse preço, e não a decisão.

## Decisão

Nenhum modelo recebe o preço de execução. O prazo da decisão é 09:30; sem resposta, vale HOLD.

## Consequências

- A execução é sempre posterior à decisão. A etapa 7 testa isso: nenhuma ordem usa preço anterior à decisão.
- O briefing congelado às 07:30 é a entrada da decisão (plano, §7).
- Quem acompanha a arena vê a decisão às 08:00 e a execução só depois do COTAHIST, à noite.

## Alternativas consideradas

- **Executar no fechamento de D-1:** descartado. É um preço anterior à decisão, e a etapa 7 proíbe isso. Além disso, ele já aparece no briefing.
