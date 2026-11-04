import {
  PUBLIC_CACHE_TTL_SECONDS,
  arenaCurrentSchema,
  competitorDetailSchema,
  cycleRefSchema,
  cycleViewSchema,
  decisionsPageSchema,
  envelopeSchema,
  equitySchema,
  leaderboardSchema,
  newsPageSchema,
  randomBaselineSchema,
  seasonRefSchema,
  seasonsPageSchema,
  slugSchema,
  stockDetailSchema,
  stockSearchSchema,
  tickerParamSchema,
  type Envelope,
  type decisionsQuerySchema,
  type newsQuerySchema,
  type seasonsQuerySchema,
} from '@alvesting/contracts';
import type { z } from 'zod';
import type { CacheTag } from './cache';

// O cliente de dados do site (plano §5.4 e §9; docs/API.md). O SSR lê a API pública pelo endereço interno do ingress
// (API_INTERNAL_URL), sem passar pelo Front Door, e por isso manda o X-Azure-FDID com o próprio FRONT_DOOR_ID: a trava de origem
// da API o exige de toda chamada (docs/INFRA.md, 3.3). Cada resposta é validada pelo schema do contrato (o mesmo que a API usa
// para montá-la) e cada leitura leva as tags de cache do Next, com o mesmo tempo de vida do Cache-Control público
// (PUBLIC_CACHE_TTL_SECONDS): a rota POST /interno/revalidar vence as tags depois de cada liquidação.
//
// A cotação bruta (a barra de preço de um papel) NÃO vem daqui: a API pública não a entrega (a licença da brapi proíbe), e o site a lê da rota
// interna da api, com um segredo que só o servidor tem, em src/lib/quotes.ts (que usa o `call` e o `segment` abaixo; docs/API.md, seção 6).
//
// O cache é o de dados do Next (`fetch` com `next.revalidate` e `next.tags`; node_modules/next/dist/docs, fetch.md e
// revalidateTag.md, Next 16.4.3), o que dispensa o `cacheComponents` e o `'use cache'`: o site não muda o modelo de renderização.
// Páginas que leem a API: `export const dynamic = 'force-dynamic'` (ou `await connection()`), para o `next build` não chamar a API
// (o build da imagem não tem API). Verificado no build de produção com uma API falsa: com `force-dynamic` ou `connection()` as leituras
// seguintes saem do cache de dados sem tocar a API, e depois do POST /interno/revalidar a primeira leitura busca o dado novo. O
// que desliga o cache é `cache: 'no-store'` ou `revalidate: 0` no fetch, e este cliente nunca os usa (docs/API.md, "Como o site lê").
//
// ponytail: a revalidação vence o cache só do processo que a recebeu. Com 1 a 5 réplicas do ca-web, a chamada do worker (pelo
// ingress) cai numa só; as outras servem o dado velho até o tempo de vida acabar (300 s) e, passados eles, ainda para a primeira
// requisição: o cache de dados do Next serve a entrada vencida e a renova em segundo plano (stale-while-revalidate; patch-fetch.js e
// how-revalidation-works.md). Então o atraso é de até 300 s mais uma requisição (a de depois de uma madrugada parada, por exemplo,
// vê o ranking de antes da liquidação). Se esse atraso pesar: um cache handler compartilhado (o Redis do plano, fase 7) ou revalidar
// réplica a réplica.
//
// Mudança de contrato (docs/API.md, "Limites conhecidos"): o site valida a resposta com os mesmos schemas ESTRITOS que a API usa para
// montá-la, e o deploy vira a API antes do site. Um campo novo na resposta faz o site antigo responder INVALID_RESPONSE até ele
// também virar. Por isso o campo novo entra em duas releases: primeiro o site e a API aceitam o campo (opcional, a API ainda não o
// manda), depois a API passa a mandá-lo.

export const API_TIMEOUT_MS = 10_000;

export interface ApiDeps {
  // injetáveis nos testes
  fetch?: typeof fetch;
  env?: { API_INTERNAL_URL?: string | undefined; FRONT_DOOR_ID?: string | undefined };
}

// A leitura da API não deu certo: ela respondeu com erro (status e código do envelope), respondeu algo fora do contrato ou nem
// respondeu (503 UNAVAILABLE: conexão recusada, DNS, prazo). Nunca carrega o corpo da resposta; `cause` é só do log do servidor.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    options?: { cause?: unknown },
  ) {
    super(`API respondeu ${status} (${code})`, options);
    this.name = 'ApiError';
  }
}

export const isNotFound = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 404;

type Query = Record<string, string | number | undefined>;

// A leitura da API pública da arena, com o cache de dados do Next (tags e o mesmo tempo de vida do Cache-Control público).
export function apiGet<S extends z.ZodType>(
  path: string,
  schema: S,
  options: { tags: readonly CacheTag[]; query?: Query },
  deps: ApiDeps = {},
): Promise<z.output<S>> {
  return call(
    path,
    schema,
    {
      query: options.query,
      init: { next: { revalidate: PUBLIC_CACHE_TTL_SECONDS, tags: [...options.tags] } },
    },
    deps,
  );
}

// A leitura que NUNCA entra no cache de dados do Next (etapa 11; docs/CONTA.md, seção 9): o dado do usuário (GET /api/v1/me), que
// é de uma pessoa só, e o que não pode ficar velho (os textos legais, porque o aceite grava a versão que a pessoa viu, e quais
// logins existem). `cache: 'no-store'` e nada de `next.revalidate` nem tags: a revalidação que o worker pede depois da liquidação
// nem as vê, e nenhuma resposta de uma pessoa serve a outra. O cookie da sessão vai só para a api (o `cookie` que a página passa), e
// nunca nas leituras públicas.
export function apiGetFresh<S extends z.ZodType>(
  path: string,
  schema: S,
  options: { cookie?: string | undefined; query?: Query },
  deps: ApiDeps = {},
): Promise<z.output<S>> {
  return call(
    path,
    schema,
    {
      query: options.query,
      init: { cache: 'no-store' },
      headers: options.cookie ? { cookie: options.cookie } : {},
    },
    deps,
  );
}

export async function call<S extends z.ZodType>(
  path: string,
  schema: S,
  options: { query: Query | undefined; init: RequestInit; headers?: Record<string, string> },
  deps: ApiDeps,
): Promise<z.output<S>> {
  const env = deps.env ?? process.env;
  const base = env.API_INTERNAL_URL;
  if (!base || !URL.canParse(base) || !/^https?:$/.test(new URL(base).protocol)) {
    throw new Error('API_INTERNAL_URL ausente ou inválida: o site não sabe onde está a API');
  }
  const url = new URL(`/api/v1${path}`, base);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let response: Response;
  try {
    response = await (deps.fetch ?? fetch)(url, {
      ...options.init,
      headers: {
        accept: 'application/json',
        ...(env.FRONT_DOOR_ID ? { 'x-azure-fdid': env.FRONT_DOOR_ID } : {}),
        ...options.headers,
      },
      // o cabeçalho X-Azure-FDID (e o cookie, na leitura do usuário) vai nesta requisição: um redirecionamento (undici só tira
      // authorization, cookie e host na troca de origem) levaria o X-Azure-FDID a outro endereço
      redirect: 'error',
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch (cause) {
    // A API nem respondeu (conexão recusada, DNS, prazo de 10 s): para a página é uma API fora do ar, como um 503. A página de
    // erro (components/api-down.tsx) trata todo ApiError do mesmo jeito; o erro de baixo fica só no log do servidor.
    throw new ApiError(503, 'UNAVAILABLE', { cause });
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(
      response.ok ? 502 : response.status,
      response.ok ? 'INVALID_RESPONSE' : 'HTTP_ERROR',
    );
  }
  const parsed = envelopeSchema(schema).safeParse(body);
  if (!parsed.success) {
    throw new ApiError(
      response.ok ? 502 : response.status,
      response.ok ? 'INVALID_RESPONSE' : 'HTTP_ERROR',
    );
  }
  // o narrowing por `success` não atravessa o genérico S: o schema acima é exatamente o envelope de S
  const envelope = parsed.data as Envelope<z.output<S>>;
  if (!envelope.success) throw new ApiError(response.status, envelope.error.code);
  if (!response.ok) throw new ApiError(response.status, 'HTTP_ERROR');
  return envelope.data;
}

// O segmento do caminho vem da URL da página, ou seja, de quem a digitou. `encodeURIComponent` deixa o `..` passar e o `new URL` o
// resolve (`stock('..')` pediria /api/v1/), então só passa o que tem a forma do contrato (slug, ULID, data, ticker). Fora dela o
// recurso não pode existir: 404, sem chamar a API.
export function segment(schema: z.ZodType<string>, value: string): string {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(404, 'NOT_FOUND');
  return encodeURIComponent(parsed.data);
}

// As leituras que as telas usam, uma por rota do §9, com as tags de cada uma. Async: o segmento inválido vira uma promessa recusada
// (ApiError 404), nunca uma exceção síncrona.
export function reader(deps: ApiDeps = {}) {
  const arena = ['arena'] as const;
  return {
    arenaCurrent: () => apiGet('/arena/current', arenaCurrentSchema, { tags: arena }, deps),
    seasons: (query: z.output<typeof seasonsQuerySchema> = {}) =>
      apiGet('/seasons', seasonsPageSchema, { tags: arena, query }, deps),
    leaderboard: async (season: string) =>
      apiGet(
        `/seasons/${segment(seasonRefSchema, season)}/leaderboard`,
        leaderboardSchema,
        { tags: arena },
        deps,
      ),
    equity: async (season: string) =>
      apiGet(
        `/seasons/${segment(seasonRefSchema, season)}/equity`,
        equitySchema,
        { tags: arena },
        deps,
      ),
    randomBaseline: async (season: string) =>
      apiGet(
        `/seasons/${segment(seasonRefSchema, season)}/random-baseline`,
        randomBaselineSchema,
        { tags: arena },
        deps,
      ),
    competitor: async (slug: string, season?: string) =>
      apiGet(
        `/competitors/${segment(slugSchema, slug)}`,
        competitorDetailSchema,
        { tags: arena, query: { season } },
        deps,
      ),
    cycle: async (date: string, season?: string) =>
      apiGet(
        `/cycles/${segment(cycleRefSchema, date)}`,
        cycleViewSchema,
        { tags: arena, query: { season } },
        deps,
      ),
    decisions: (query: z.output<typeof decisionsQuerySchema> = {}) =>
      apiGet('/decisions', decisionsPageSchema, { tags: arena, query }, deps),
    news: (query: z.output<typeof newsQuerySchema> = {}) =>
      apiGet('/news', newsPageSchema, { tags: ['news'], query }, deps),
    searchStocks: (q: string) =>
      apiGet('/stocks', stockSearchSchema, { tags: arena, query: { q } }, deps),
    stock: async (ticker: string) =>
      apiGet(
        `/stocks/${segment(tickerParamSchema, ticker)}`,
        stockDetailSchema,
        { tags: ['arena', 'news'] },
        deps,
      ),
  };
}

// O cliente do processo: lê o ambiente (API_INTERNAL_URL e FRONT_DOOR_ID) a cada chamada.
export const api = reader();
