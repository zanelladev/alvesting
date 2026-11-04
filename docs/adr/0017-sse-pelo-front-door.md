# ADR 0017: SSE pelo Front Door

- **Status:** aceita para o procedimento e para a medição local. **Pendente: medir pelo Front Door após o primeiro deploy.**
- **Data:** 01/11/2026
- **Origem:** `docs/PLANO.md`, §5.4 ("A validar na etapa 3"), §5.15 (risco "SSE bufferizado no Front Door") e etapa 3 do §16

## Contexto

O chat da etapa 13 responde por SSE: o texto precisa aparecer aos poucos, não de uma vez no fim. O Front Door Standard fica entre o navegador e a API, e o plano guardou isto como risco médio: se ele bufferizar a resposta, o chat usa um subdomínio que vai direto ao ingress da api (§5.4).

A documentação do Front Door (Microsoft Learn, "Caching", "FAQ" e "Health probes", lidas em 01/11/2026) não afirma nem nega suporte a SSE. Só diz que a resposta que a origem manda em `Transfer-Encoding: chunked` não é comprimida pela borda, o que é bom para o stream. Por isso a decisão não sai de leitura: sai de medição.

## Decisão

1. **Endpoint de teste.** `GET /api/v1/health/stream` manda 5 eventos, um por segundo, o primeiro na hora. Cada evento carrega `seq`, `of` e `at`, a hora em que o servidor o gerou. Responde `text/event-stream` com `Cache-Control: private, no-cache, no-store, must-revalidate, max-age=0, no-transform`, `X-Accel-Buffering: no` e `Transfer-Encoding: chunked` (cabeçalhos do `@Sse` do Nest). Ao contrário do `/health`, fica sob a trava de origem.
2. **Probe.** `node scripts/sse-probe.mjs <url> [--header "Nome: valor"]` abre o stream, anota a hora de chegada de cada evento e compara com a hora que o servidor informou. Agrupa as chegadas em levas (duas chegadas a menos de 30% do intervalo do servidor são a mesma leva) e dá o veredito:
   - **ESPAÇADOS:** cada evento chegou na sua própria leva. Código de saída 0.
   - **PARCIAL:** algumas chegadas juntas, em mais de uma leva. Código 1.
   - **BUFFERIZADO:** tudo numa leva só. Código 1.
   - Código 2 é erro de medição (rede, status diferente de 200, tipo que não é `text/event-stream`, menos de 5 eventos, tempo esgotado).
3. **Procedimento.**
   - Local: com a API de pé, `node scripts/sse-probe.mjs http://127.0.0.1:4310/api/v1/health/stream`.
   - Pelo Front Door: `node scripts/sse-probe.mjs https://<site>/api/v1/health/stream`. A rota `/api/*` do Front Door leva ao grupo da api, e ele acrescenta o `X-Azure-FDID`. O `deploy.yml` roda este passo depois de virar o tráfego e escreve o resultado no resumo do job. É medição, não portão: um resultado ruim não derruba o deploy.
   - Direto na origem, para comparar: `node scripts/sse-probe.mjs https://<ca-api>.<domínio do ambiente>/api/v1/health/stream --header "X-Azure-FDID: <id do perfil>"`.
   - Para fechar a decisão, repita em três horários diferentes e anote aqui.
4. **Critério.** ESPAÇADOS nas três medições pelo Front Door: o chat usa o mesmo domínio, sem CORS e com o cookie de sessão primário. PARCIAL ou BUFFERIZADO em qualquer uma: o chat usa o subdomínio direto ao ingress da api (§5.4), com CORS e cookie no domínio pai, e esta decisão ganha um ADR novo.

## Resultado

### Local, medido em 01/11/2026

Eventos 1 a 5, tempo de chegada em ms desde o pedido:

| Caminho | Chegadas | 1º ao 5º | Veredito |
|---|---|---|---|
| API compilada (`node dist/main.js`), `127.0.0.1` | 20 · 1019 · 2021 · 3022 · 4022 | 4002 ms (o servidor gerou em 4004 ms) | ESPAÇADOS |
| Contêiner `alvesting-api` (Docker Desktop, porta publicada) | 60 · 1063 · 2070 · 3081 · 4087 | 4027 ms (o servidor gerou em 4029 ms) | ESPAÇADOS |

A API e a imagem entregam o stream como esperado. Isso não diz nada sobre o Front Door.

### Pelo Front Door

**Pendente: medir pelo Front Door após o primeiro deploy.** Preencher esta tabela depois do primeiro `deploy.yml` completo (o resumo do job traz a saída do probe):

| Data | URL | Chegadas (ms) | Veredito |
|---|---|---|---|
| a medir | | | |

## Consequências

- A API ganha uma rota de teste, atrás da trava de origem e documentada no Swagger. Serve para repetir a medição sempre que o Front Door, o WAF ou as regras de cache mudarem.
- O `EnvelopeInterceptor` passou a deixar de fora as rotas `@Sse`: embrulhar cada evento no envelope `{ success, data, error }` quebraria o stream. O chat da etapa 13 herda isso.
- O timeout de origem do Front Door está em 60 s (`originResponseTimeoutSeconds`, `infra/modules/frontdoor.bicep`). Uma resposta de chat mais longa que isso, sem nenhum byte no meio, pode ser cortada. Isto também fica para a medição: se o probe passar mas um stream de 60 s não, o chat precisa mandar um comentário SSE de tempos em tempos.
- O teste local não substitui a medição pelo Front Door, e é por isso que o status continua pendente.

## Alternativas consideradas

- **Medir só com o chat real, na etapa 13.** Descobriria o problema tarde, com a decisão de domínio, CORS e cookie já tomada.
- **Conferir à mão com `curl -N`.** Mostra o stream, mas não dá um veredito que se repita nem um número para registrar.
