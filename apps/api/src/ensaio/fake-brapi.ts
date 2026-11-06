import { brasiliaInstant, type IsoDate } from '../modules/market-data/domain/dates.js';
import type { SimClock } from './bus.js';
import type { DayBar, SyntheticMarket } from './market.js';

// A brapi do ensaio (arena:ensaio, docs/ENSAIO.md): um `fetch` que responde no formato dos docs da brapi (docs/DADOS.md, seção 6) com as
// barras do mercado sintético, no lugar da rede. O BrapiClient é o de verdade; só o fetch é este. Atende os dois endpoints que o código usa:
//   GET /api/v2/stocks/historical?symbols=&startDate=&endDate=&interval=1d   as barras de um papel
//   GET /api/quote/list?type=stock&limit=&page=                              a lista de ações
// Fiel ao que importa para o código (e ao que a prova controlada de 04/11/2026 mediu na brapi de verdade, docs/DADOS.md, seção 9):
// Authorization obrigatório, uma ação por requisição, no máximo 90 dias entre startDate e endDate (400 DATE_WINDOW_EXCEEDED; a idade do
// início não conta), cabeçalhos de cota nas respostas do histórico e o limitador próprio da lista (20 por minuto, que não é a cota),
// quantidade e não volume financeiro. A barra de um pregão só "sai" na hora em que a B3 a publicaria (20:45, ou a do pregão atrasado do
// ensaio), pelo relógio simulado: antes disso a resposta vem sem ela, e o eod se reagenda como na produção.
// ponytail: a cota aqui cai a cada requisição, a da lista e as recusadas inclusive; a de verdade só cobra o 200 do histórico. Conta
// conservadora, e o cliente só lê o cabeçalho do histórico.

export const FAKE_TOKEN = 'ensaio-sem-segredo';
const DEFAULT_PUBLISH_AT = '20:45';
const DEFAULT_QUOTA = 15_000;
// o maior período aceito entre startDate e endDate (a mensagem da brapi: "no máximo 90 dias"); 88 dias passaram e 274 não na prova, e o limite
// exato (90 ou 89) não foi medido: o cliente pede no máximo 89
const MAX_WINDOW_DAYS = 90;
const DAY_MS = 86_400_000;

export interface FakeBrapiRequest {
  at: Date;
  kind: 'historical' | 'list';
  symbol?: string;
  from?: IsoDate;
  to?: IsoDate;
}

export interface FakeBrapi {
  fetch: typeof fetch;
  requests: readonly FakeBrapiRequest[];
}

export interface FakeBrapiOptions {
  market: SyntheticMarket;
  clock: SimClock;
  // quando a barra de cada pregão "sai"; o que não está aqui sai às 20:45 do próprio pregão
  publishedAt?: ReadonlyMap<IsoDate, Date>;
  // a cota do ciclo no começo (os testes da reserva a aproximam do limite)
  quota?: number;
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

// quantidade = round(volume financeiro / fechamento): quantidade x fechamento volta (quase) ao volume do mercado sintético, como o volume
// estimado do BrapiClient faz com a quantidade que a brapi de verdade informa
const quantityOf = (bar: DayBar): number =>
  Number((2n * bar.volume + bar.close) / (2n * bar.close));
const price = (cents: bigint): number => Number(cents) / 100;

export function createFakeBrapi(options: FakeBrapiOptions): FakeBrapi {
  const { market, clock } = options;
  const requests: FakeBrapiRequest[] = [];
  const byTicker = new Map<string, Map<IsoDate, DayBar>>();
  for (const [day, bars] of market.bars) {
    for (const bar of bars) {
      const days = byTicker.get(bar.ticker) ?? new Map<IsoDate, DayBar>();
      days.set(day, bar);
      byTicker.set(bar.ticker, days);
    }
  }
  const publishedAt = (day: IsoDate): Date =>
    options.publishedAt?.get(day) ?? brasiliaInstant(day, DEFAULT_PUBLISH_AT);

  const handler = (input: URL | string | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const now = clock.now();
    const authorization = new Headers(init?.headers).get('authorization');
    // a cota cai a cada requisição e vem em toda resposta do histórico, nos dois pares de cabeçalho, como na brapi de verdade
    // (o cliente só lê o X-RateLimit-Remaining)
    const quota = options.quota ?? DEFAULT_QUOTA;
    const remaining = Math.max(0, quota - requests.length - 1);
    const rate = {
      'ratelimit-limit': String(quota),
      'ratelimit-remaining': String(remaining),
      'x-ratelimit-limit': String(quota),
      'x-ratelimit-remaining': String(remaining),
      'x-ratelimit-window': 'rolling-30d',
    };
    if (authorization !== `Bearer ${FAKE_TOKEN}`) {
      return Promise.resolve(json(401, { error: true, code: 'INVALID_TOKEN' }, rate));
    }

    if (url.pathname === '/api/quote/list') {
      requests.push({ at: now, kind: 'list' });
      // os cabeçalhos da lista de verdade: outro limitador (20 por minuto), que não tem nada com a cota do histórico
      const listRate = {
        'ratelimit-limit': '20',
        'ratelimit-remaining': '20',
        'ratelimit-reset': '60',
      };
      return Promise.resolve(
        json(
          200,
          {
            indexes: [],
            stocks: market.stocks.map((stock) => ({
              stock: stock.ticker,
              name: stock.name,
              close: 10,
              type: 'stock',
              subType: stock.spec.startsWith('UNT') ? 'unit' : 'stock',
            })),
            hasNextPage: false,
            requestedAt: now.toISOString(),
            took: 1,
          },
          listRate,
        ),
      );
    }

    if (url.pathname === '/api/v2/stocks/historical') {
      const symbol = url.searchParams.get('symbols') ?? '';
      const from = url.searchParams.get('startDate') ?? '';
      const to = url.searchParams.get('endDate') ?? '';
      requests.push({ at: now, kind: 'historical', symbol, from, to });
      // o plano gratuito: uma ação por requisição e, no máximo, 90 dias entre startDate e endDate. A janela longa é 400 DATE_WINDOW_EXCEEDED, e
      // a idade do início não conta (um pedido de um dia, 93 dias atrás, passou na prova)
      if (symbol.includes(',') || !from || !to || from > to) {
        return Promise.resolve(json(400, { error: true, code: 'BAD_REQUEST' }, rate));
      }
      const span = Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);
      if (span > MAX_WINDOW_DAYS) {
        return Promise.resolve(
          json(
            400,
            {
              error: true,
              code: 'DATE_WINDOW_EXCEEDED',
              message: `Seu plano permite no máximo ${MAX_WINDOW_DAYS} dias de dados históricos. O período solicitado é de ${span} dias.`,
            },
            rate,
          ),
        );
      }
      const days = byTicker.get(symbol);
      if (!days) {
        return Promise.resolve(
          json(
            404,
            {
              error: true,
              code: 'NOT_FOUND',
              message: 'Nenhum histórico encontrado para os símbolos informados',
            },
            rate,
          ),
        );
      }
      const historicalDataPrice = [...days]
        .filter(([day]) => day >= from && day <= to && publishedAt(day) <= now)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([day, bar]) => ({
          date: brasiliaInstant(day).getTime() / 1000,
          open: price(bar.open),
          high: price(bar.high),
          low: price(bar.low),
          close: price(bar.close),
          volume: quantityOf(bar),
          adjustedClose: price(bar.close),
        }));
      return Promise.resolve(
        json(
          200,
          {
            results: [
              {
                requestedSymbol: symbol,
                symbol,
                changed: false,
                data: { usedInterval: '1d', usedRange: '1mo', historicalDataPrice },
              },
            ],
            requestedAt: now.toISOString(),
            took: 1,
          },
          rate,
        ),
      );
    }
    return Promise.resolve(json(404, { error: true, code: 'NOT_FOUND' }, rate));
  };

  return { fetch: handler, requests };
}
