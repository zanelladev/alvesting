import { Logger } from '@nestjs/common';
import { WINDOW_SESSIONS, historyStart, quoteTargets } from '../domain/bar-plan.js';
import { isoWeek, type IsoDate } from '../domain/dates.js';
import { seedOf, type InstrumentSeed } from '../domain/instruments.js';
import type { TradingCalendar } from '../domain/trading-calendar.js';
import {
  FETCH_BUDGET_MS,
  describeError,
  type BrapiClient,
} from '../infrastructure/brapi.client.js';
import type { MarketRepository } from '../infrastructure/market.repository.js';
import type { UniverseRepository } from '../infrastructure/universe.repository.js';
import type { BarLoader } from './bar-loader.js';
import type { LogoRefresh } from './logo-refresh.js';

export interface WeeklySummary {
  // quantos papéis a lista da brapi trouxe (ações à vista do lote padrão), ou nulo se a lista não veio
  listed: number | null;
  created: number;
  // os candidatos fora do conjunto diário que receberam pedido, e as requisições gastas (a lista inclusive)
  asked: number;
  requests: number;
}

// A atualização semanal (domingo, dentro do `universe` e antes de ele escolher): sem ela um papel fora do conjunto diário nunca teria barra,
// e o universo (volume médio de 60 pregões) nunca o veria entrar. Docs/DADOS.md, seção 8.
//  1. Busca a lista de ações da brapi e semeia o papel novo em `instrument` (ISIN nulo; a classe sai do sufixo do código, instruments.ts).
//  2. O candidato fora do conjunto diário (universo da semana que acabou, BOVA11, posições e carteiras) que não tem nenhuma barra nos 3
//     meses (o histórico do plano gratuito) recebe os 3 meses: é o papel novo, ou o que a carga da semana anterior não trouxe. Quem decide é
//     o banco, e não "foi criado agora": se a carga de um papel novo falhou, na semana seguinte ele não é mais novo e ainda precisa do histórico.
//  3. O que tem barra mas nenhuma dos 5 últimos pregões antes da segunda-feira recebe a semana. O banco é o cache: o conjunto diário não muda
//     dentro da semana ISO, então ou o papel foi buscado a semana toda, ou nenhum dia; o buraco de um papel sem negócio não o pede de novo.
//  4. No fim, os logos das ações (logo-refresh.ts, ADR 0036): a passada recebe a lista e o orçamento que sobrou, e baixa do icons.brapi.dev
//     só o SVG que falta, que mudou de endereço ou que tem mais de 30 dias, dos papéis que o banco tem. Opcional (o 6º argumento): o ensaio
//     e os testes que não a passam não pedem nada a ninguém.
// A falha aqui nunca derruba o universo: a lista que não veio, a cota baixa, o tempo ou um papel sem resposta deixam candidatos com menos
// presença na janela, e o universo sai do que o banco tem; a passada dos logos que falha vira um aviso. Só o erro de configuração (401, 402,
// 403) sobe. A lista, as barras e os logos dividem UM orçamento de tempo (FETCH_BUDGET_MS), porque o `universe` roda dentro da trava da
// fila market.
// ponytail: o papel listado sem nenhuma barra nos 3 meses (suspenso, por exemplo) pede os 3 meses toda semana: no máximo uma requisição por
// papel por semana. Se passar de umas dezenas, guardar a última tentativa.
export class WeeklyRefresh {
  private readonly logger = new Logger(WeeklyRefresh.name);

  constructor(
    private readonly brapi: Pick<BrapiClient, 'listStocks'>,
    private readonly loader: Pick<BarLoader, 'load'>,
    private readonly market: Pick<
      MarketRepository,
      'insertInstruments' | 'barDates' | 'heldTickers' | 'portfolioTickers'
    >,
    private readonly universe: Pick<UniverseRepository, 'tickersOf'>,
    private readonly calendar: Pick<TradingCalendar, 'tradingDaysBefore'>,
    private readonly logos?: Pick<LogoRefresh, 'run'>,
  ) {}

  // `today`: o dia da execução, a base de `historyStart` (o pedido de 3 meses fica em 86 a 89 dias, abaixo dos 90 que a brapi aceita).
  async run(monday: IsoDate, today: IsoDate): Promise<WeeklySummary> {
    const startedAt = Date.now();
    const list = await this.brapi.listStocks();
    if (list.listings === null) {
      this.logger.warn('lista de ações da brapi indisponível: o universo sai das barras do banco');
      return { listed: null, created: 0, asked: 0, requests: list.requests };
    }
    const seeds = new Map<string, InstrumentSeed>();
    for (const listing of list.listings) {
      const seed = seedOf(listing);
      if (seed) seeds.set(seed.ticker, seed);
    }

    const sessions = this.calendar.tradingDaysBefore(monday, WINDOW_SESSIONS);
    const [first, last] = [sessions[0]!, sessions.at(-1)!];
    const created = new Set(await this.market.insertInstruments([...seeds.values()], last));

    const { required, optional } = quoteTargets({
      universe: await this.universe.tickersOf(isoWeek(last)),
      held: await this.market.heldTickers(),
      portfolio: await this.market.portfolioTickers(),
    });
    const daily = new Set([...required, ...optional]);
    const candidates = [...seeds.keys()].filter((ticker) => !daily.has(ticker));
    const history = historyStart(today);
    const have = await this.market.barDates(candidates, history, last);
    const hasWeek = (ticker: string) => [...(have.get(ticker) ?? [])].some((day) => day >= first);
    const report = await this.loader.load(
      [
        ...candidates
          .filter((ticker) => !have.has(ticker))
          .map((ticker) => ({ ticker, from: history, to: last })),
        ...candidates
          .filter((ticker) => have.has(ticker) && !hasWeek(ticker))
          .map((ticker) => ({ ticker, from: first, to: last })),
      ],
      { budgetMs: Math.max(0, FETCH_BUDGET_MS - (Date.now() - startedAt)) },
    );
    if (this.logos) {
      try {
        await this.logos.run(
          list.listings,
          Math.max(0, FETCH_BUDGET_MS - (Date.now() - startedAt)),
        );
      } catch (error) {
        // o banco, por exemplo: os logos são enfeite, e o universo vem depois
        this.logger.warn(
          describeError(error),
          'logos das ações: a passada falhou; a atualização segue',
        );
      }
    }

    const summary = {
      listed: seeds.size,
      created: created.size,
      asked: report.asked,
      requests: list.requests + report.requests,
    };
    this.logger.log(
      {
        ...summary,
        candidates: candidates.length,
        failed: report.failed.length,
        stopped: report.stopped,
      },
      'atualização semanal da brapi',
    );
    return summary;
  }
}
