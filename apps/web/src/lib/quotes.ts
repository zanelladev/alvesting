import 'server-only';
import type { z } from 'zod';
import {
  PUBLIC_CACHE_TTL_SECONDS,
  QUOTES_SECRET_MIN_LENGTH,
  QUOTES_SECRET_SHAPE,
  internalBarsSchema,
  internalTapeSchema,
  tickerParamSchema,
  type InternalBars,
  type InternalTape,
} from '@alvesting/contracts';
import { ApiError, call, segment, type ApiDeps } from './api';
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

// O que as duas leituras têm em comum: o segredo e o endereço conferidos antes do `fetch`, o cache de dados com a tag `arena`, e o 404 da
// rota (o segredo que a api não reconhece) como defeito de configuração.
async function readInternal<S extends z.ZodType>(
  path: string,
  schema: S,
  deps: QuotesDeps,
): Promise<z.output<S>> {
  const env = deps.env ?? process.env;
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
  try {
    return await call(
      path,
      schema,
      {
        query: undefined,
        init: { next: { revalidate: PUBLIC_CACHE_TTL_SECONDS, tags: [...TAGS] } },
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
