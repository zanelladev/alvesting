# ADR 0003: Azure Front Door Standard, não Premium

- **Status:** aceita
- **Data:** 31/10/2026
- **Origem:** `docs/PLANO.md`, §5.14 (decisão deliberada)

## Contexto

O Premium custa US$ 330/mês (plano, §5.12). A diferença para o Standard é o Private Link, que tiraria a origem da internet, e as regras gerenciadas de WAF. Para o TCC, nenhum dos dois compensa o custo.

## Decisão

Standard. A origem se protege com uma trava de cabeçalho: web e api recusam requisição sem o `X-Azure-FDID` do nosso perfil (plano, §5.4).

## Consequências

- Cerca de US$ 295/mês a menos que o Premium.
- A trava é de aplicação, não de rede. O ingress do Container Apps continua público, e só o conhecimento do ID do perfil (guardado no Key Vault, plano §5.7) separa uma chamada direta de uma legítima. Serve de barreira, não de isolamento.
- O WAF usa regras próprias, com rate limit por IP (plano, §5.4).
- O isolamento real é a fase 4 (plano, §5.13): Premium com Private Link. O gatilho é uma demo pública longa ou um SLA.

## Alternativas consideradas

- **Front Door Premium:** descartado para o TCC. Traz Private Link e regras gerenciadas de WAF, que o orçamento não cobre.
