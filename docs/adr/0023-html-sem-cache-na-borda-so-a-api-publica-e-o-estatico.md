# ADR 0023: O Front Door guarda o estático e a API pública, não o HTML das páginas

- **Status:** aceita
- **Data:** 01/11/2026
- **Origem:** `docs/PLANO.md`, §5.4 e §16 (etapa 9); `docs/API.md`, seções 2 e 6; `docs/INFRA.md`, 2.5; ADR 0022

## Contexto

O plano (§5.4) diz que o Front Door faz cache "de `/_next/static/*` (imutável) e das páginas públicas (`s-maxage` curto + purge após a
liquidação)". A etapa 9 implementou o cache do estático e o das GET públicas da API (a rota `api-public` do Bicep, com o purge de
`/api/v1/*` depois de cada liquidação). O HTML, a rota `/*`, ficou sem cache. A revisão da etapa notou que isso era um desvio do plano que
ninguém tinha declarado.

## Decisão

O Front Door guarda `/_next/static/*` e as GET públicas de `/api/v1/*`. **O HTML das páginas não é guardado na borda.** O que a página mostra
vem do cache de dados do Next (`fetch` com `next.revalidate` e `next.tags`, `apps/web/src/lib/api.ts`), que o worker vence com
`POST /interno/revalidar` depois de cada liquidação. O purge limpa só `/api/v1/*`.

## Por quê

1. **O cache de HTML na borda não se invalida sozinho.** A documentação do Next ("Using a CDN with Next.js", `cdn-caching.md`, e
   `how-revalidation-works.md`, lidas em 01/11/2026) diz que `revalidateTag()` invalida o cache do servidor Next e que o CDN continua servindo a
   cópia dele até o `s-maxage` acabar; propagar exige um purge junto, "incluindo as variantes HTML e RSC". O purge do Front Door leva até 10
   minutos para chegar a todos os pontos de presença (`docs/API.md`, seção 2): a página guardada na borda mostraria o ranking de antes da
   liquidação por esse tempo, mesmo com o dado novo já no site.
2. **HTML e RSC variam por cabeçalho.** Segundo a mesma documentação, a resposta do App Router varia por `rsc`, `next-router-state-tree`,
   `next-router-prefetch` e outros (o Next manda `Vary` e o parâmetro `_rsc`), e servir HTML de um render com RSC de outro mostra conteúdo
   incompatível na navegação. A mitigação documentada é guardar os dois juntos, com o mesmo tempo de vida e a mesma invalidação. A rota `/*` do
   Front Door também serve `/health` e `/interno/revalidar`: cache nela exigiria uma lista de caminhos, como a da API.
3. **Sem ganho medido.** O SSR lê o cache de dados do Next, então a página não chama a API a cada visita. Ninguém mediu que o render pese; a
   meta de LCP (≤ 2,5 s no Lighthouse mobile da home) é do aceite da etapa 9 e mede isso.

## Consequências

- O `ca-web` renderiza a página em cada visita, lendo o cache de dados. Se o LCP ou a CPU do `ca-web` (etapa 10) mostrarem que pesa, a
  saída é uma rota de cache só para as páginas públicas, com `s-maxage` curto, `/*` no purge do worker (`PURGE_PATHS` em `cache-refresher.ts`)
  e o cuidado do item 2.
- `docs/PLANO.md`, §5.4, ganha a nota de desvio (como a do ADR 0020).
- `infra/tests/check.mjs` afirma que `/*` e `/api/*` não têm `cacheConfiguration`.
