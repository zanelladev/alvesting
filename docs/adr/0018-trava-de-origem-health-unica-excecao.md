# ADR 0018: Trava de origem, com o /health como única exceção

- **Status:** aceita
- **Data:** 01/11/2026
- **Origem:** `docs/PLANO.md`, §5.4 e §5.6; `docs/INFRA.md`, 3.3 (contrato fail closed); etapa 3 do §16

## Contexto

O Container Apps tem ingress externo e nada na rede o fecha ao Front Door: Private Link só existe no Premium (ADR 0003). Quem sabe o endereço do app pode chamá-lo direto e contornar o WAF e o rate limit. A trava é por cabeçalho: o app recusa quem não traz o `X-Azure-FDID` do nosso perfil.

O `/health` precisa de atenção, e foi conferido na documentação do Front Door (Microsoft Learn, lida em 01/11/2026):

- "Secure traffic to Azure Front Door origins" (25/09/2025): o Front Door "attaches" o `X-Azure-FDID` "to all requests to the origin".
- "Health probes" (30/04/2026): lista o que a sonda manda (`User-Agent: Edge Health Probe`, método GET ou HEAD) e diz que só 200 vale como saudável. **Não cita o `X-Azure-FDID`.**

Ou seja, a documentação não garante o cabeçalho na sonda. E duas outras chamadas ao `/health` nunca o trazem, porque não passam pelo Front Door: os probes de startup, readiness e liveness do Container Apps, que batem na porta do contêiner, e o smoke do deploy na URL da revisão nova.

## Decisão

1. **Com `FRONT_DOOR_ID` no ambiente, 403 para tudo que não traz o `X-Azure-FDID` igual** (sem distinguir maiúsculas). Na API é um middleware Express antes de qualquer rota, inclusive o Swagger e o 404 (rota inexistente também é 403, para não revelar quais existem). No site é o `proxy.ts` do Next 16 sem `matcher`, que cobre também `/_next/static`, `/_next/image` e `public/`. O corpo do 403 é o envelope `{ success: false, error: { code: "FORBIDDEN" } }` e não repete nenhum ID.
2. **A exceção das sondas é `GET` ou `HEAD` no caminho exato `/health`** (site e API) e `/api/v1/health` (API). Nada de prefixo (`/health/x`), outra caixa, barra no fim, `//`, outro método ou o `/api/v1/health/stream`. A resposta é um JSON fixo, que o Front Door já torna público.
3. **Fail closed.** `ORIGIN_LOCK=front-door`, que o Bicep injeta nos apps atrás do Front Door, torna `FRONT_DOOR_ID` obrigatório. Sem ele, com um valor que não é GUID, ou com um `ORIGIN_LOCK` desconhecido, o app **recusa subir**: a API pela validação do ambiente (`env.ts`), o site pelo `instrumentation.ts`, que sai com código 1 (se apenas lançasse o erro, o Next 16 ficaria de pé respondendo 500). O contêiner nunca fica saudável e o deploy reprova a revisão.
4. **Sem `FRONT_DOOR_ID`** (dev, testes e perfil econômico, que não tem Front Door) não há trava.
5. **A segunda exceção, entrada na etapa 9: a revalidação do worker.** `POST` no caminho exato `/interno/revalidar` do **site** com o `REVALIDATE_SECRET` válido em `Authorization: Bearer`. O worker chama o ingress do site direto (não passa pelo Front Door) e não recebe o `FRONT_DOOR_ID`, então não traz o cabeçalho. O segredo é conferido em tempo constante no `proxy.ts` e de novo na rota, vale só para esse caminho e esse método, e sem `REVALIDATE_SECRET` no ambiente a rota responde 503. A API não tem exceção nova.

## Consequências

- O `/health` isento só diz que o processo responde, o que já é público. Os 3 probes do Container Apps, o smoke do deploy e a sonda do Front Door passam, com ou sem o cabeçalho.
- O Next normaliza a URL antes do proxy: `/health.rsc` chega lá como `/health`, passa pela exceção e dá 404, porque nenhuma rota responde a esse nome. A exceção só alcança o handler do health.
- A trava é fraca em um ponto: o `X-Azure-FDID` é um GUID fixo do perfil, não um segredo. Protege contra outro Front Door apontando para a nossa origem, não contra quem conhece o ID. O remédio é o Private Link do Premium.
- A requisição que a trava barra na API não chega ao `pino-http`, então cada recusa vira uma linha `warn` própria, com método e caminho, sem query nem cabeçalho. Um scanner na origem enche o log; se virar ruído, amostrar.
- Chamadas internas pedem o cabeçalho: o SSR da web para a API (etapa 9) manda o `X-Azure-FDID` com o próprio `FRONT_DOOR_ID`. A exceção da revalidação do worker com `REVALIDATE_SECRET` (item 5; INFRA.md, 3.3) entrou na etapa 9, com a rota `/interno/revalidar` e o teste dela nos três projetos do Playwright (`apps/web/e2e/revalidate.spec.ts`).
- Testes: `apps/api/src/common/origin-lock.spec.ts` e `env.spec.ts`; `apps/web/e2e/origin-lock.spec.ts`, contra o build de produção de verdade, nos três projetos do Playwright; e a imagem Docker, subida com e sem o par.

## Alternativas consideradas

- **Isentar pelo `User-Agent: Edge Health Probe`.** É trivial de forjar e não cobre as sondas do Container Apps nem o smoke.
- **Exigir o cabeçalho também no `/health`.** O Container Apps não manda cabeçalho próprio nas sondas, então a revisão nunca ficaria saudável.
- **Isentar por IP (`AzureFrontDoor.Backend`).** O ingress externo daqui não filtra por IP, e as sondas internas não vêm do Front Door.
- **Reconhecer a sonda interna pela falta dos cabeçalhos do Envoy.** Depende de um detalhe da plataforma que não dá para verificar aqui.
