# ADR 0009: COTAHIST como preço oficial de execução

- **Status:** superada pela [ADR 0032](0032-brapi-fonte-unica-das-cotacoes-e-banco-como-cache.md) em 03/11/2026 (os termos da B3 vedam a coleta automatizada, inclusive por IA; a brapi virou a fonte única e o COTAHIST saiu; em 04/11/2026 o que sobrava dele no banco, no schema e no código também saiu, nota no fim da ADR 0032). O texto abaixo é o histórico.
- **Data:** 31/10/2026
- **Origem:** `docs/PLANO.md`, §5.14 (decisão deliberada)

## Contexto

A execução precisa de um preço oficial, público e reprocessável. A v2.0 não precisa de cotação intraday, que fica para a fase 6 (plano, §5.13).

## Decisão

O preço de execução é o preço de abertura do pregão no arquivo COTAHIST da B3, que sai por volta de 20:45 (plano, §7). O `eod` roda às 21:30 e se reagenda em +60 min, até 00:30, se o arquivo ainda não saiu. Na última tentativa, a brapi entra como reserva (plano, §5.5).

## Consequências

- Gratuito e oficial. O arquivo fica no Blob, então qualquer ciclo pode ser reprocessado (plano, §5.8).
- A execução só se confirma depois do pregão. O resultado de um dia sai à noite, não às 10:00.
- Quantidades fracionárias usam o preço do lote padrão: limitação declarada (plano, §2).
- A brapi entra em `docs/DEPENDENCIAS.md` no PR que a usar (etapa 4).

## Alternativas consideradas

- **brapi como fonte principal:** descartado. Os planos com intraday ou proventos são pagos (Startup, R$ 99,99/mês, plano §5.12), e a v2.0 não usa nenhum dos dois. Fica como reserva.
