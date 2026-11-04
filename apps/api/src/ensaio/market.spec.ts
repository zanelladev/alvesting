import { describe, expect, it } from 'vitest';
import { loadTradingCalendar } from '../modules/market-data/domain/trading-calendar.js';
import { isTickerShape } from '../modules/news/domain/tickers.js';
import { buildMarket, type SyntheticMarket } from './market.js';

const calendar = loadTradingCalendar();
const FIRST_DAY = '2026-11-03';
const options = { seed: 1, stocks: 40, firstDay: FIRST_DAY, sessions: 5, calendar };

const barOf = (market: SyntheticMarket, ticker: string, date: string) =>
  market.bars.get(date)?.find((bar) => bar.ticker === ticker);
const bps = (close: bigint, previous: bigint): number =>
  Math.round((Number(close - previous) * 10_000) / Number(previous));
// o fechamento é arredondado ao centavo: com preço de R$ 20 ou mais o erro é de no máximo 2,5 pontos-base
const expectBps = (actual: number, expected: number) =>
  expect(Math.abs(actual - expected), `${actual} bps contra ${expected}`).toBeLessThanOrEqual(3);

describe('buildMarket: o mercado sintético do ensaio', () => {
  const market = buildMarket(options);

  it('é determinístico pela semente: a mesma dá o mesmo mercado, outra dá outro', () => {
    const again = buildMarket(options);
    expect(
      JSON.stringify([...again.bars], (_k, v: unknown) => (typeof v === 'bigint' ? `${v}n` : v)),
    ).toBe(
      JSON.stringify([...market.bars], (_k, v: unknown) => (typeof v === 'bigint' ? `${v}n` : v)),
    );
    const other = buildMarket({ ...options, seed: 2 });
    expect(barOf(other, 'SINA3', FIRST_DAY)?.close).not.toBe(
      barOf(market, 'SINA3', FIRST_DAY)?.close,
    );
  });

  it('tem 40 ações ON, PN e UNIT com ticker no formato da B3, mais o BOVA11 de referência', () => {
    expect(market.stocks).toHaveLength(40);
    for (const stock of market.stocks) {
      expect(isTickerShape(stock.ticker), stock.ticker).toBe(true);
      expect(stock.name.length).toBeLessThanOrEqual(12);
      expect(stock.spec.length).toBe(10);
    }
    expect(new Set(market.stocks.map((s) => s.ticker)).size).toBe(40);
    const classes = new Set(market.stocks.map((s) => s.spec.trim().split(/\s+/)[0]));
    expect(classes).toEqual(new Set(['ON', 'PN', 'UNT']));
    expect(barOf(market, 'BOVA11', FIRST_DAY)).toBeDefined();
  });

  it('o histórico são os 60 pregões da janela do universo e acaba no pregão antes do primeiro dia; a semana de 02/11 (Finados) não conta', () => {
    expect(market.historyDays).toHaveLength(60);
    expect(market.historyDays.at(-1)).toBe('2026-10-30');
    expect(market.sessionDays).toEqual([
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-09',
    ]);
    for (const day of [...market.historyDays, ...market.sessionDays]) {
      expect(calendar.isTradingDay(day), day).toBe(true);
    }
    expect(market.historyDays.at(0)).toBe(calendar.tradingDaysBefore('2026-11-02', 60)[0]);
  });

  it('toda barra é coerente: máxima e mínima contêm a abertura e o fechamento, preço e volume positivos', () => {
    for (const [, bars] of market.bars) {
      for (const bar of bars) {
        expect(bar.low, bar.ticker).toBeGreaterThan(0n);
        expect(bar.high >= bar.open && bar.high >= bar.close, bar.ticker).toBe(true);
        expect(bar.low <= bar.open && bar.low <= bar.close, bar.ticker).toBe(true);
        expect(bar.volume, bar.ticker).toBeGreaterThan(0n);
      }
    }
  });

  describe('os casos difíceis, de propósito', () => {
    const [d1, d2, d3, d4, d5] = market.sessionDays as [string, string, string, string, string];
    const last = market.historyDays.at(-1)!;
    const before = market.historyDays.at(-2)!;

    it('movimento grande: MOVE3 sobe 18% no último pregão do histórico e cai 5% no primeiro dia', () => {
      expectBps(
        bps(barOf(market, 'MOVE3', last)!.close, barOf(market, 'MOVE3', before)!.close),
        1800,
      );
      expectBps(bps(barOf(market, 'MOVE3', d1)!.close, barOf(market, 'MOVE3', last)!.close), -500);
    });

    it('ação sem negócio num dia: SECA3 negocia sempre, menos no segundo pregão (e antes disso sobe 9%)', () => {
      expect(barOf(market, 'SECA3', d1)).toBeDefined();
      expect(barOf(market, 'SECA3', d2)).toBeUndefined();
      for (const day of [d3, d4, d5]) expect(barOf(market, 'SECA3', day), day).toBeDefined();
      expectBps(bps(barOf(market, 'SECA3', d1)!.close, barOf(market, 'SECA3', last)!.close), 900);
      // a ação continua no universo: presença em todo o histórico
      for (const day of market.historyDays) expect(barOf(market, 'SECA3', day), day).toBeDefined();
    });

    it('ação suspensa: PAUS3 negocia até o segundo pregão e some do terceiro em diante', () => {
      expect(barOf(market, 'PAUS3', d1)).toBeDefined();
      expect(barOf(market, 'PAUS3', d2)).toBeDefined();
      for (const day of [d3, d4, d5]) expect(barOf(market, 'PAUS3', day), day).toBeUndefined();
      expectBps(bps(barOf(market, 'PAUS3', d2)!.close, barOf(market, 'PAUS3', d1)!.close), 500);
    });

    it('desdobramento 1:2 em DOBR4: a cotação do terceiro pregão (data ex) é a metade da do dia anterior, sem ajuste na barra gravada', () => {
      expect(market.split).toEqual({ ticker: 'DOBR4', exDate: d3, kind: 'split', factor: '1:2' });
      const ratio =
        Number(barOf(market, 'DOBR4', d3)!.close) / Number(barOf(market, 'DOBR4', d2)!.close);
      // metade, mais o movimento do dia (os fillers variam até 3,7%; o desdobramento é o que domina)
      expect(ratio).toBeGreaterThan(0.47);
      expect(ratio).toBeLessThan(0.53);
      // antes da data ex o preço não é ajustado
      expectBps(bps(barOf(market, 'DOBR4', d1)!.close, barOf(market, 'DOBR4', last)!.close), 100);
    });

    it('as seis ações dos casos difíceis têm presença total no histórico, para ficar no universo', () => {
      for (const ticker of ['MOVE3', 'DOBR4', 'SECA3', 'PAUS3']) {
        for (const day of market.historyDays)
          expect(barOf(market, ticker, day), `${ticker} ${day}`).toBeDefined();
      }
    });
  });

  it('com menos ações o elenco dos casos difíceis continua inteiro', () => {
    const small = buildMarket({ ...options, stocks: 8, sessions: 3 });
    expect(small.stocks).toHaveLength(8);
    expect(small.stocks.map((s) => s.ticker)).toEqual(
      expect.arrayContaining(['MOVE3', 'DOBR4', 'SECA3', 'PAUS3']),
    );
    expect(small.sessionDays).toHaveLength(3);
    expect(barOf(small, 'SECA3', small.sessionDays[1]!)).toBeUndefined();
  });

  it('recusa o que não cabe nos casos difíceis: menos de 5 ações ou de 3 pregões', () => {
    expect(() => buildMarket({ ...options, stocks: 4 })).toThrow(RangeError);
    expect(() => buildMarket({ ...options, sessions: 2 })).toThrow(RangeError);
    expect(() => buildMarket({ ...options, stocks: 57 })).toThrow(RangeError);
  });
});
