// Mercado sintético para testes de propriedade e de desempenho da liquidação. Nada daqui vem de fonte real: tickers,
// preços e buracos saem do SHA-256 de "sal:ticker:pregão", sem gerador caseiro, então o mesmo sal dá o mesmo mercado.
// Só os testes importam este arquivo (fica fora do build, ver tsconfig.build.json).
import { createHash } from 'node:crypto';
import { addDays, isWeekday, type IsoDate } from '../../../market-data/domain/dates.js';
import type { CorporateEvent } from '../corporate-events.js';
import type { Bar } from '../portfolio.js';
import type { Market } from '../simulation.js';

const digest = (text: string) => createHash('sha256').update(text).digest();

// S0003, S0013... (4 caracteres, 1ª letra, mais 1 dígito: o formato de ticker do contrato)
export const syntheticTickers = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => `S${String(i).padStart(3, '0')}3`);

// dias úteis seguidos a partir de `from` (sem feriados: o calendário real não importa aqui)
export function syntheticDates(count: number, from: IsoDate = '2026-11-03'): IsoDate[] {
  const dates: IsoDate[] = [];
  for (let day = from; dates.length < count; day = addDays(day, 1)) {
    if (isWeekday(day)) dates.push(day);
  }
  return dates;
}

export interface SyntheticOptions {
  tickers: number;
  sessions: number;
  salt?: string;
  // 1 pregão em cada `gapEvery` fica sem barra, por papel (o daily_bar nunca é denso: papel sem negócio não tem barra)
  gapEvery?: number;
  events?: CorporateEvent[];
}

export function syntheticMarket({
  tickers,
  sessions,
  salt = 'mercado',
  gapEvery = 20,
  events = [],
}: SyntheticOptions): Market {
  const names = syntheticTickers(tickers);
  const dates = syntheticDates(sessions);
  // preço de partida de R$ 5,00 a R$ 205,00
  const last = new Map(
    names.map((ticker) => [
      ticker,
      500 + (digest(`${salt}:${ticker}:base`).readUInt16BE(0) % 20_000),
    ]),
  );
  const market: Market = {
    sessions: dates.map((date) => {
      const bars = new Map<string, Bar>();
      for (const ticker of names) {
        const bytes = digest(`${salt}:${ticker}:${date}`);
        const previous = last.get(ticker) ?? 500;
        // abertura até 1% longe do último fechamento, fechamento até 3% longe da abertura
        const open = Math.max(
          100,
          previous + Math.trunc((previous * ((bytes.readUInt16BE(0) % 201) - 100)) / 10_000),
        );
        const close = Math.max(
          100,
          open + Math.trunc((open * ((bytes.readUInt16BE(2) % 601) - 300)) / 10_000),
        );
        last.set(ticker, close);
        if (bytes.readUInt16BE(4) % gapEvery === 0) continue;
        bars.set(ticker, { openCents: BigInt(open), closeCents: BigInt(close) });
      }
      return { date, bars, universe: names };
    }),
    cdi: dates.map((date, index) => ({ date, pct: `0.05${String(700 + index).padStart(4, '0')}` })),
    events,
  };
  return market;
}
