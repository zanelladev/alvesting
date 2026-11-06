import 'server-only';
import type { z } from 'zod';
import {
  LOGO_NOT_FOUND,
  PUBLIC_CACHE_TTL_SECONDS,
  QUOTES_SECRET_MIN_LENGTH,
  QUOTES_SECRET_SHAPE,
  internalBarsSchema,
  internalLogosSchema,
  internalTapeSchema,
  tickerParamSchema,
  type InternalBars,
  type InternalLogos,
  type InternalTape,
} from '@alvesting/contracts';
import { API_TIMEOUT_MS, ApiError, call, segment, type ApiDeps } from './api';
import type { CacheTag } from './cache';

// A leitura das cotações pelas rotas INTERNAS da api (docs/API.md, seção 6; ADR 0033): as barras de um papel e a fita da home. Nenhuma rota
// pública entrega cotação bruta (a licença da brapi proíbe entregar os Dados como feed, API ou base bruta), então o SSR as lê daqui, com um
// segredo que só o servidor tem.
//
// Este é o ÚNICO módulo que lê QUOTES_SECRET, e ele é só do servidor: `import 'server-only'` faz o build quebrar se um componente de cliente o
// importar (direta ou indiretamente), e a variável não tem NEXT_PUBLIC_, então o Next nunca a copia para o JavaScript do navegador.
// quotes-boundary.spec.ts confere as duas coisas sem depender do bundler. O segredo vai só no `Authorization: Bearer` (nunca na URL, que vai
// para log), e nenhuma mensagem de erro, nem a causa dela, o repete: o valor só chega ao `fetch` depois de aparado e de conferido contra a forma
// (ASCII visível), porque um valor com quebra de linha no meio faria o `fetch` do Node recusar o cabeçalho com o valor INTEIRO na mensagem.
//
// A leitura passa pelo mesmo cache de dados do Next que as da API pública, com a mesma tag (`arena`) e o mesmo tempo de vida: o worker vence a
// tag depois de cada liquidação (POST /interno/revalidar) e a primeira leitura depois dela busca a barra nova.

// O BOVA11, a referência: a home tira dele o último fechamento e o anterior, e o rodapé, a data do último pregão.
export const REFERENCE_TICKER = 'BOVA11';

// As tags da leitura são do tipo de lib/cache.ts: se a lista de tags mudar, o compilador acusa aqui, e as barras não deixam de ser vencidas
// pelo worker em silêncio.
const TAGS: readonly CacheTag[] = ['arena'];

export type QuotesDeps = Omit<ApiDeps, 'env'> & {
  // injetável nos testes; por padrão, o ambiente do processo
  env?: NonNullable<ApiDeps['env']> & {
    QUOTES_SECRET?: string | undefined;
    NODE_ENV?: string | undefined;
  };
};

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

// Defeito de configuração do site (o segredo ausente, curto ou torto, ou o endereço da api sem TLS em produção). Não é "a arena não respondeu",
// mas para quem lê é o mesmo: a página mostra a tela de erro montada no servidor, com o aviso fixo (withApiDown), em vez de um 500 em branco
// (o React não renderiza o error.tsx no servidor), e o smoke do deploy reprova, porque a tela de erro não tem a faixa de cotações. O log diz o
// QUE falta, nunca o valor.
function unconfigured(problem: string): never {
  console.error(`[web] cotações desligadas: ${problem} (docs/INFRA.md, 2.7)`);
  throw new ApiError(503, 'QUOTES_UNCONFIGURED');
}

// As 60 barras mais recentes do papel, da mais antiga à mais nova (lista vazia se o papel não existe ou ainda não tem barra).
export async function readBars(
  ticker: string,
  deps: QuotesDeps = {},
): Promise<InternalBars['bars']> {
  // O ticker vem da URL da página: o torto é 404 antes de qualquer outra conferência, e a configuração com defeito não o transforma em tela de erro.
  const path = `/interno/barras/${segment(tickerParamSchema, ticker)}`;
  return (await readInternal(path, internalBarsSchema, deps)).bars;
}

// A fita da home: o universo da semana do último ciclo (os papéis que o briefing deu a todos os modelos), na ordem do universo, com o
// fechamento do pregão `date` e o do pregão anterior (nulo para o papel sem barra nele). Sem ciclo, sem universo ou sem barra, a resposta
// vazia: `{ date: null, rows: [] }` (a home mostra a fita sem a rota, com o BOVA11 e o macro).
export function readTape(deps: QuotesDeps = {}): Promise<InternalTape> {
  return readInternal('/interno/fita', internalTapeSchema, deps);
}

// O segredo e o endereço da api conferidos antes de qualquer `fetch` das rotas internas: o segredo aparado, ou o defeito de configuração.
function checkedSecret(env: NonNullable<QuotesDeps['env']>): string {
  // Aparado nas pontas, como a api apara o dela (segredo colado à mão no Key Vault costuma levar a quebra de linha do `echo`), senão os dois
  // valores nunca bateriam. O PENDENTE do Key Vault tem menos de 32 caracteres e cai aqui também.
  const secret = env.QUOTES_SECRET?.trim() ?? '';
  if (secret.length < QUOTES_SECRET_MIN_LENGTH || !QUOTES_SECRET_SHAPE.test(secret)) {
    unconfigured(
      `QUOTES_SECRET ausente, com menos de ${QUOTES_SECRET_MIN_LENGTH} caracteres ou fora do formato (ASCII visível, sem espaço)`,
    );
  }
  // O segredo vai em cabeçalho para o endereço da api: em produção, só por TLS (o loopback não sai da máquina), como a api exige do endereço do
  // site (WEB_INTERNAL_URL). Endereço ausente ou torto o `call` recusa com a própria mensagem.
  const base = env.API_INTERNAL_URL;
  if (env.NODE_ENV === 'production' && base !== undefined && URL.canParse(base)) {
    const { protocol, hostname } = new URL(base);
    if (protocol !== 'https:' && !LOOPBACK_HOSTS.has(hostname)) {
      unconfigured('API_INTERNAL_URL sem https em produção: o segredo das cotações iria em claro');
    }
  }
  return secret;
}

// O que as leituras em JSON têm em comum: o segredo e o endereço conferidos antes do `fetch`, o cache de dados (por padrão, o da tag `arena`
// e o tempo de vida da API pública), e o 404 da rota (o segredo que a api não reconhece) como defeito de configuração.
async function readInternal<S extends z.ZodType>(
  path: string,
  schema: S,
  deps: QuotesDeps,
  next: RequestInit['next'] = { revalidate: PUBLIC_CACHE_TTL_SECONDS, tags: [...TAGS] },
): Promise<z.output<S>> {
  const secret = checkedSecret(deps.env ?? process.env);
  try {
    return await call(
      path,
      schema,
      {
        query: undefined,
        init: { next },
        headers: { authorization: `Bearer ${secret}` },
      },
      deps,
    );
  } catch (error) {
    // Papel desconhecido é lista vazia (200), e a fita sem ciclo é a resposta vazia: o 404 destas rotas quer dizer só "não é para você", isto
    // é, o segredo que o site manda não é o da api (ou a api está sem ele). Vira 502 para a página mostrar "a arena não respondeu" (e o smoke
    // do deploy reprovar), e nunca "ação não encontrada" (404 e 400 viram a tela de 404 em orNotFound).
    if (error instanceof ApiError && error.status === 404) {
      throw new ApiError(502, 'QUOTES_REFUSED', { cause: error });
    }
    throw error;
  }
}

// --- os logos das ações (ADR 0036, "Como o site mostra"; docs/API.md, seção 6) -----------------------------------------------------------
// O logo é enfeite ao lado do ticker: nenhuma falha daqui derruba uma tela. Quem não tem logo (ou quando a leitura falha) fica com o
// monograma do components/logo-do-papel.tsx.

// O tempo de vida do índice no cache de dados do Next. ponytail: o logo novo ou trocado (a atualização semanal, no domingo) aparece em até
// uma hora (e mais uma requisição: o Next serve a entrada vencida e a renova por trás). Se pesar, a saída é uma tag `logos` em lib/cache.ts,
// vencida pelo worker no fim da atualização semanal (o POST /interno/revalidar que ele já faz depois da liquidação).
export const LOGOS_TTL_SECONDS = 3600;

// O teto do SVG que a rota do site repassa: o da T1 (LOGO_MAX_BYTES do svg-check.ts da api e o CHECK de instrument_logo, 200 KB).
export const LOGO_MAX_BYTES = 200 * 1024;

// A falha que não é "sem logo": uma linha de log com o papel e o motivo, nunca o segredo nem o corpo.
function logoFailure(subject: string, reason: string): void {
  console.error(`[web] logos: ${subject}: ${reason}; a tela mostra o monograma`);
}

// O índice dos logos (GET /api/v1/interno/logos): os papéis com logo guardado e a versão de cada SVG, em ordem de ticker. A falha (a api fora,
// o segredo ausente ou recusado, a resposta fora do contrato) vira a lista vazia, com uma linha de log: nenhum logo, só monogramas.
export async function readLogos(deps: QuotesDeps = {}): Promise<InternalLogos['logos']> {
  try {
    return (
      await readInternal('/interno/logos', internalLogosSchema, deps, {
        revalidate: LOGOS_TTL_SECONDS,
      })
    ).logos;
  } catch (error) {
    // o segredo ausente já tem a linha dele (unconfigured)
    if (!(error instanceof ApiError && error.code === 'QUOTES_UNCONFIGURED')) {
      logoFailure(
        'o índice não veio',
        error instanceof ApiError ? `${error.status} ${error.code}` : 'erro inesperado',
      );
    }
    return [];
  }
}

// O SVG guardado de um papel (GET /api/v1/interno/logos/:ticker, fora do envelope), para a rota do site que o serve (app/logos). Nulo quando não
// há o que servir: o ticker fora da forma da B3 e o papel sem logo (404 LOGO_NOT_FOUND), sem log; e a falha, com uma linha de log: a api
// fora, o segredo ausente ou recusado, outro tipo de conteúdo que não image/svg+xml, o corpo acima de LOGO_MAX_BYTES ou fora do UTF-8.
// Sem o cache de dados do Next: o navegador guarda o SVG pela URL com a versão, e o cache de dados guardaria o SVG velho sob a versão nova.
export async function readLogoSvg(ticker: string, deps: QuotesDeps = {}): Promise<string | null> {
  const parsed = tickerParamSchema.safeParse(ticker);
  if (!parsed.success || parsed.data !== ticker) return null;
  const env = deps.env ?? process.env;
  let response: Response;
  try {
    const secret = checkedSecret(env);
    const base = env.API_INTERNAL_URL;
    if (!base || !URL.canParse(base) || !/^https?:$/.test(new URL(base).protocol)) {
      logoFailure(ticker, 'API_INTERNAL_URL ausente ou inválida');
      return null;
    }
    response = await (deps.fetch ?? fetch)(new URL(`/api/v1/interno/logos/${ticker}`, base), {
      cache: 'no-store',
      headers: {
        accept: 'image/svg+xml',
        ...(env.FRONT_DOOR_ID ? { 'x-azure-fdid': env.FRONT_DOOR_ID } : {}),
        authorization: `Bearer ${secret}`,
      },
      // o segredo e o X-Azure-FDID vão só para o endereço da api
      redirect: 'error',
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch (error) {
    if (!(error instanceof ApiError && error.code === 'QUOTES_UNCONFIGURED')) {
      logoFailure(ticker, 'a api não respondeu');
    }
    return null;
  }
  try {
    return await svgOf(ticker, response);
  } catch {
    // a conexão que cai no meio do corpo, o prazo de 10 s (que vale também para a leitura dele) ou o corpo fora do UTF-8
    logoFailure(ticker, 'o corpo do SVG não veio inteiro, ou não é UTF-8');
    return null;
  }
}

// A resposta da rota interna do SVG, conferida (readLogoSvg): o texto do SVG, ou nulo.
async function svgOf(ticker: string, response: Response): Promise<string | null> {
  if (response.status === 404) {
    const body = (await response.json().catch(() => null)) as { error?: { code?: unknown } } | null;
    if (body?.error?.code === LOGO_NOT_FOUND) return null;
    logoFailure(ticker, 'a api recusou o segredo (o 404 da rota)');
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel();
    logoFailure(ticker, `a api respondeu ${response.status}`);
    return null;
  }
  const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (type !== 'image/svg+xml') {
    await response.body?.cancel();
    logoFailure(ticker, 'a api não respondeu image/svg+xml');
    return null;
  }
  const bytes = await readAtMost(response, LOGO_MAX_BYTES);
  if (bytes === null) {
    logoFailure(ticker, `o SVG passa de ${LOGO_MAX_BYTES} bytes`);
    return null;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

// O corpo inteiro, ou nulo se passa de `max` bytes: o Content-Length acima do teto é recusado sem ler, e sem ele a leitura para no teto.
async function readAtMost(response: Response, max: number): Promise<Uint8Array | null> {
  if (Number(response.headers.get('content-length')) > max) {
    await response.body?.cancel();
    return null;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  // sair do `for await` no meio cancela o corpo (o `return` do iterador do ReadableStream)
  for await (const chunk of response.body ?? []) {
    size += chunk.byteLength;
    if (size > max) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
