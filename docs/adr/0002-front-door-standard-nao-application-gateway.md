# ADR 0002: Azure Front Door Standard, não Application Gateway

- **Status:** aceita
- **Data:** 31/10/2026
- **Origem:** `docs/PLANO.md`, §5.14 (decisão deliberada)

## Contexto

A borda precisa de TLS, WAF, cache das páginas públicas e roteamento por caminho: `/api/*` vai para a api e `/*` para o web. Os usuários estão sobretudo no celular, então o cache de borda com POP no Brasil corta a latência dos estáticos.

## Decisão

Azure Front Door Standard na frente de dois grupos de origem (api e web), com probe em `GET /health` a cada 30 s e cache de `/_next/static/*` e das páginas públicas.

## Consequências

- Borda global com POP no Brasil por cerca de US$ 35/mês de taxa base (plano, §5.12).
- O streaming SSE do chat ainda não foi validado pelo Front Door. A etapa 3 registra o resultado em ADR. Se a resposta vier bufferizada, o chat usa um subdomínio que vai direto ao ingress da api (plano, §5.4).
- No perfil econômico o Front Door sai da conta. O ingress do Container Apps faz o balanceamento, e a api vai para um subdomínio com CORS (plano, §5.4).

## Alternativas consideradas

- **Application Gateway v2:** descartado. É regional e custa várias vezes mais que o Front Door Standard para o mesmo papel.
