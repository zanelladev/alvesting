import { historyStart, missingTooMuch, planRequests } from '../domain/bar-plan.js';
import type { IsoDate } from '../domain/dates.js';
import {
  REFERENCE_SEED,
  REFERENCE_TICKER,
  seedOf,
  type InstrumentSeed,
} from '../domain/instruments.js';
import type { TradingCalendar } from '../domain/trading-calendar.js';
import type { BrapiClient, StopReason } from '../infrastructure/brapi.client.js';
import type { MarketRepository } from '../infrastructure/market.repository.js';
import type { BarLoader } from './bar-loader.js';

export interface BackfillInput {
  // sem lista: todo papel conhecido do banco mais os da lista da brapi (a carga inicial)
  tickers?: readonly string[];
  // o padrão é o histórico do plano gratuito: 3 meses antes de `today`
  from?: IsoDate;
  to: IsoDate;
  // o dia da execução, a base de `historyStart` (o pedido de 3 meses fica em 86 a 89 dias, abaixo dos 90 que a brapi aceita entre
  // startDate e endDate)
  today: IsoDate;
  // falso: só a conta, sem rede e sem escrever nada
  fetch: boolean;
}

export interface BackfillPlan {
  from: IsoDate;
  to: IsoDate;
  sessions: number;
  // papéis com barra faltando na janela
  papers: number;
  // requisições previstas: uma por papel, mais a da lista da brapi quando a carga não recebeu os papéis
  requests: number;
}

export interface BackfillSummary extends BackfillPlan {
  // o que de fato foi feito
  requestsMade: number;
  remaining: number | null;
  stopped: StopReason | null;
  inserted: number;
  failed: string[];
  divergent: number;
  // a carga foi completa: foi ela que confirmou os pregões (veja `run`)
  complete: boolean;
  confirmedDays: number;
}

// A carga inicial e a recuperação à mão (market:backfill; docs/DADOS.md, seção 6): 3 meses de barras da brapi para todo papel da lista mais
// o BOVA11 (de uns 380 pedidos num banco novo a uns 440 no dev), ou só para os papéis e a janela pedidos. Só inserção e retomável: o banco é o cache, e uma segunda
// passada pede só o que falta. Não publica settle: o dado de antes da temporada não liquida nada, e liquidar é do eod.
// O pregão só é confirmado por uma carga COMPLETA (sem --papeis, sem parada por cota, tempo ou queda, com o BOVA11 e no máximo
// MISSING_ALERT_PERCENT dos papéis sem resposta): confirmar com a barra de um papel só deixaria o universo, que exige os 60 pregões
// confirmados, passar a conferência e congelar-se com buraco, e universo congelado não se refaz. A carga parcial grava as barras e deixa os
// pregões como estão; a seguinte, que pede só a falta, confirma.
// ponytail: o papel com pregão sem negócio dentro da janela (buraco legítimo) volta a ser pedido a cada passada, porque o banco não tem como
// saber que o buraco é legítimo. O teto é uma carga inteira (380 a 480 pedidos, 3% da cota mensal).
export class BrapiBackfill {
  constructor(
    private readonly brapi: Pick<BrapiClient, 'listStocks'>,
    private readonly loader: Pick<BarLoader, 'load'>,
    private readonly market: Pick<
      MarketRepository,
      'stockTickers' | 'insertInstruments' | 'barDates' | 'confirmTradingDays'
    >,
    private readonly calendar: Pick<TradingCalendar, 'tradingDaysBetween'>,
  ) {}

  async plan(input: BackfillInput): Promise<BackfillPlan> {
    return (await this.prepare({ ...input, fetch: false })).plan;
  }

  async run(input: BackfillInput): Promise<BackfillSummary> {
    const { plan, requests, sessions, seeds, listRequests, total } = await this.prepare(input);
    await this.market.insertInstruments([...seeds.values()], plan.to);
    const report = await this.loader.load(requests, { budgetMs: Infinity });
    const complete =
      input.tickers === undefined &&
      report.stopped === null &&
      !missingTooMuch(report.failed, total);
    // o dia só é confirmado se ganhou barra (o repositório confere); os pregões da janela que já estavam confirmados ficam como estão
    const confirmed = complete ? await this.market.confirmTradingDays(sessions) : [];
    return {
      ...plan,
      requestsMade: listRequests + report.requests,
      remaining: report.remaining,
      stopped: report.stopped,
      inserted: report.inserted,
      failed: report.failed,
      divergent: report.divergent.length,
      complete,
      confirmedDays: confirmed.length,
    };
  }

  private async prepare(input: BackfillInput) {
    const to = input.to;
    const sessions = this.calendar.tradingDaysBetween(input.from ?? historyStart(input.today), to);
    if (sessions.length === 0) throw new RangeError('A janela não tem nenhum pregão');

    const seeds = new Map<string, InstrumentSeed>();
    let tickers: string[];
    let listRequests = 0;
    if (input.tickers) {
      tickers = [...new Set(input.tickers.map((ticker) => ticker.trim().toUpperCase()))];
      for (const ticker of tickers) {
        const seed = ticker === REFERENCE_TICKER ? REFERENCE_SEED : seedOf({ ticker }, true);
        if (!seed) throw new RangeError(`${ticker} não é um código de ação à vista`);
        seeds.set(ticker, seed);
      }
    } else {
      tickers = [REFERENCE_TICKER, ...(await this.market.stockTickers())];
      seeds.set(REFERENCE_TICKER, REFERENCE_SEED);
      if (input.fetch) {
        const list = await this.brapi.listStocks();
        listRequests = list.requests;
        for (const listing of list.listings ?? []) {
          const seed = seedOf(listing);
          if (seed) seeds.set(seed.ticker, seed);
        }
        tickers = [...new Set([...tickers, ...seeds.keys()])];
      }
    }

    const have = await this.market.barDates(tickers, sessions[0]!, to);
    const requests = planRequests(tickers, sessions, have);
    const plan: BackfillPlan = {
      from: sessions[0]!,
      to,
      sessions: sessions.length,
      papers: requests.length,
      requests: requests.length + (input.tickers ? 0 : 1),
    };
    // `total`: todos os papéis da carga, os que já estavam completos também (a base da conta de quantos ficaram sem resposta)
    return { plan, requests, sessions, seeds, listRequests, total: tickers.length };
  }
}
