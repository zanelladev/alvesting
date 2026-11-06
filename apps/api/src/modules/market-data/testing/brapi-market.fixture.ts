// Mercado sintético mínimo para os testes do eod, da atualização semanal e da carga: o que a brapi falsa do ensaio (ensaio/fake-brapi.ts)
// serve, montado à mão. Os tickers são só formato de ticker e os preços são inventados. Só os testes importam este arquivo (fica fora do
// build, ver tsconfig.build.json).
import { brasiliaInstant, type IsoDate } from '../domain/dates.js';
import { createSimClock, type SimClock } from '../../../ensaio/bus.js';
import { FAKE_TOKEN, createFakeBrapi, type FakeBrapi } from '../../../ensaio/fake-brapi.js';
import type { DayBar, StockSpec, SyntheticMarket } from '../../../ensaio/market.js';
import { BrapiClient, type BrapiOptions } from '../infrastructure/brapi.client.js';

export { FAKE_TOKEN };

export interface MarketSpec {
  days: IsoDate[];
  tickers: string[];
  // o fechamento em centavos (padrão: 3000 + 10 por posição na lista + o dia do mês); a abertura, a máxima e a mínima saem dele
  close?: (ticker: string, day: IsoDate) => bigint;
  // o papel não negociou no dia: não tem barra
  absent?: (ticker: string, day: IsoDate) => boolean;
}

export function marketOf(spec: MarketSpec): SyntheticMarket {
  const stocks: StockSpec[] = spec.tickers
    .filter((ticker) => ticker !== 'BOVA11')
    .map((ticker) => ({
      ticker,
      name: `${ticker} SA`,
      spec: ticker.endsWith('11') ? 'UNT     N2' : 'ON      NM',
      role: 'filler',
    }));
  const closeOf =
    spec.close ??
    ((ticker: string, day: IsoDate) =>
      BigInt(3000 + 10 * spec.tickers.indexOf(ticker) + Number(day.slice(8, 10))));
  const bars = new Map<IsoDate, DayBar[]>();
  for (const day of spec.days) {
    bars.set(
      day,
      spec.tickers
        .filter((ticker) => !spec.absent?.(ticker, day))
        .map((ticker) => {
          const close = closeOf(ticker, day);
          return {
            ticker,
            open: close - 5n,
            high: close + 20n,
            low: close - 20n,
            close,
            volume: close * 1_000n,
          };
        }),
    );
  }
  return {
    stocks,
    historyDays: [],
    sessionDays: spec.days,
    bars,
    split: { ticker: 'X', exDate: spec.days[0]!, kind: 'split', factor: '1:2' },
  };
}

export interface BrapiTestWorld {
  // o mercado que a brapi falsa serve (o teste lê dele o que gravar como histórico)
  marketData: SyntheticMarket;
  clock: SimClock;
  brapi: FakeBrapi;
  client: BrapiClient;
  sleeps: number[];
  // TODAS as requisições que o cliente fez, as que o teste interceptou também (a brapi falsa só vê as que ela respondeu)
  calls: Array<{ kind: 'historical' | 'list'; symbol?: string; from?: string; to?: string }>;
}

// A brapi falsa do ensaio com o BrapiClient de verdade em cima. `intercept` devolve uma resposta no lugar da brapi falsa (a falha que o
// teste quer: 429, 5xx, timeout, 401) ou nada, para a brapi falsa responder. Nenhum teste fala com a rede.
export function brapiWorld(options: {
  market: SyntheticMarket;
  start: Date;
  publishedAt?: ReadonlyMap<IsoDate, Date>;
  quota?: number;
  // o campo `logo` da lista da brapi falsa, por papel (ADR 0036)
  logos?: ReadonlyMap<string, unknown>;
  intercept?: (url: URL, call: number) => Response | Error | undefined;
  client?: BrapiOptions;
}): BrapiTestWorld {
  const clock = createSimClock(options.start);
  const brapi = createFakeBrapi({
    market: options.market,
    clock,
    publishedAt: options.publishedAt,
    quota: options.quota,
    logos: options.logos,
  });
  let call = 0;
  const sleeps: number[] = [];
  const calls: BrapiTestWorld['calls'] = [];
  const fetchFn = ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    call += 1;
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push(
      url.pathname === '/api/quote/list'
        ? { kind: 'list' }
        : {
            kind: 'historical',
            symbol: url.searchParams.get('symbols') ?? undefined,
            from: url.searchParams.get('startDate') ?? undefined,
            to: url.searchParams.get('endDate') ?? undefined,
          },
    );
    const injected = options.intercept?.(url, call);
    if (injected instanceof Error) return Promise.reject(injected);
    if (injected) return Promise.resolve(injected);
    return brapi.fetch(input, init);
  }) as typeof fetch;
  const client = new BrapiClient(FAKE_TOKEN, fetchFn, {
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    ...options.client,
  });
  return { marketData: options.market, clock, brapi, client, sleeps, calls };
}

// 21:30 de Brasília do pregão (a primeira tentativa do eod), e as seguintes de hora em hora
export const at = (day: IsoDate, hhmm: string, seconds = 5): Date =>
  new Date(brasiliaInstant(day, hhmm).getTime() + seconds * 1000);
