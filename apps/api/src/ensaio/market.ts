import { createHash } from 'node:crypto';
import { isoWeek, isoWeekMonday, type IsoDate } from '../modules/market-data/domain/dates.js';
import { REFERENCE_TICKER } from '../modules/market-data/domain/instruments.js';
import type { TradingCalendar } from '../modules/market-data/domain/trading-calendar.js';

// O mercado sintético do ensaio (arena:ensaio, docs/ENSAIO.md): umas 40 ações ON, PN e UNIT e o BOVA11, com 60 pregões de histórico
// (a janela do universo) e os pregões do ensaio, nas datas do calendário real de 2026. Nada vem de fonte real: tickers fictícios, preços
// e volumes saem do SHA-256 de "semente:ticker:pregão" (inteiros, sem float e sem gerador caseiro), então a mesma semente dá o mesmo
// mercado em qualquer máquina. A brapi falsa (fake-brapi.ts) serve estas barras no formato dos docs da brapi.
//
// Quatro ações existem para os casos difíceis, na ordem do que cada modelo faz com elas (as estratégias de fake-llm.ts):
//   MOVE3  movimento grande: +18% no último pregão do histórico (o momentum a compra no 1º dia) e -5% no 1º dia (ele a vende no 2º)
//   DOBR4  desdobramento 1:2 com data ex no 3º pregão: a cotação cai pela metade no arquivo, que a B3 não ajusta (o contrário a compra
//          no 1º dia, depois da queda de 11% do histórico, e a segura até lá)
//   SECA3  sem negócio no 2º pregão, depois de subir 9% no 1º (o momentum a compra no 2º dia, e a ordem não executa)
//   PAUS3  suspensa do 3º pregão em diante, depois de subir 5% no 2º (o contrário a vende, e a ordem não executa)
// As demais são "fillers" que variam até 3,7% ao dia e, de vez em quando, ficam sem negócio.

export type StockRole = 'filler' | 'move' | 'split' | 'no-trade' | 'suspended';

export interface StockSpec {
  ticker: string;
  name: string;
  // classe da espécie, depois o nível de governança (10 posições): ON, PN, UNT
  spec: string;
  role: StockRole;
}

export interface DayBar {
  ticker: string;
  open: bigint;
  high: bigint;
  low: bigint;
  close: bigint;
  // volume financeiro do dia, em centavos
  volume: bigint;
  trades: number;
}

export interface SplitEvent {
  ticker: string;
  exDate: IsoDate;
  kind: 'split';
  factor: '1:2';
}

export interface SyntheticMarket {
  stocks: StockSpec[];
  // os 60 pregões da janela do universo, até o pregão antes do primeiro dia do ensaio
  historyDays: IsoDate[];
  sessionDays: IsoDate[];
  // as barras de cada pregão (ações que negociaram e o BOVA11), em ordem de ticker. Dia sem negócio não tem barra
  bars: Map<IsoDate, DayBar[]>;
  split: SplitEvent;
}

export interface MarketOptions {
  seed: number;
  stocks: number;
  firstDay: IsoDate;
  sessions: number;
  calendar: Pick<
    TradingCalendar,
    | 'tradingDaysBefore'
    | 'tradingDaysBetween'
    | 'previousTradingDay'
    | 'nextTradingDay'
    | 'isTradingDay'
  >;
}

export const REFERENCE = REFERENCE_TICKER;
const HISTORY_DAYS = 60;
export const MIN_STOCKS = 5;
export const MAX_STOCKS = 56;
export const MIN_SESSIONS = 3;
export const MAX_SESSIONS = 20;

const PLANTED: Array<Pick<StockSpec, 'ticker' | 'name' | 'spec' | 'role'>> = [
  { ticker: 'MOVE3', name: 'MOVIMENTO', spec: 'ON      NM', role: 'move' },
  { ticker: 'DOBR4', name: 'DOBRA', spec: 'PN      N1', role: 'split' },
  { ticker: 'SECA3', name: 'SECA', spec: 'ON      N2', role: 'no-trade' },
  { ticker: 'PAUS3', name: 'PAUSA', spec: 'ON      NM', role: 'suspended' },
];

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const SUFFIXES = [
  { digits: '3', spec: 'ON      NM' },
  { digits: '4', spec: 'PN      N1' },
  { digits: '11', spec: 'UNT     N2' },
] as const;

// S, I, N, A... SINA3 (ON), SINB4 (PN), SINC11 (UNIT)...: a letra pega a sigla e o sufixo rodiza ON, PN e UNIT. Passadas as 26 letras,
// SIMA3...: simuladas. Nenhuma é de empresa real.
function fillerStock(index: number): StockSpec {
  const suffix = SUFFIXES[index % SUFFIXES.length]!;
  const letter = LETTERS[index % 26]!;
  const first = index < 26;
  const ticker = `${first ? 'SIN' : 'SIM'}${letter}${suffix.digits}`;
  return {
    ticker,
    name: `${first ? 'SINTETICA' : 'SIMULADA'} ${letter}`,
    spec: suffix.spec,
    role: 'filler',
  };
}

const digest = (...parts: Array<string | number>): Buffer =>
  createHash('sha256').update(parts.join(':')).digest();

// preço x (1 + pontos-base / 10.000), no centavo mais próximo (o meio sobe), só com inteiros
const step = (cents: number, bps: number): number =>
  Math.floor((cents * (10_000 + bps) + 5_000) / 10_000);

// O retorno do dia que o enredo fixa no lugar do sorteio, em pontos-base. `offset`: -1 é o último pregão do histórico, 0 o primeiro
// do ensaio, 1 o segundo...
function planted(role: StockRole, offset: number): number | undefined {
  switch (role) {
    case 'move':
      return offset === -1 ? 1800 : offset === 0 ? -500 : undefined;
    case 'split':
      return offset === -1 ? -1100 : offset === 0 ? 100 : undefined;
    case 'no-trade':
      return offset === 0 ? 900 : undefined;
    case 'suspended':
      return offset === -1 ? -700 : offset === 0 ? 0 : offset === 1 ? 500 : undefined;
    case 'filler':
      return undefined;
  }
}

// Sem negócio no dia: a ação não aparece no arquivo.
function absent(stock: StockSpec, offset: number, digestOfDay: Buffer): boolean {
  switch (stock.role) {
    case 'no-trade':
      return offset === 1;
    case 'suspended':
      return offset >= 2;
    case 'filler':
      // 1,5% dos pregões do histórico e 1% dos do ensaio
      return digestOfDay.readUInt16BE(12) % 1000 < (offset < 0 ? 15 : 10);
    default:
      return false;
  }
}

export function buildMarket(options: MarketOptions): SyntheticMarket {
  const { seed, stocks: count, firstDay, sessions, calendar } = options;
  if (!Number.isInteger(count) || count < MIN_STOCKS || count > MAX_STOCKS) {
    throw new RangeError(
      `O ensaio precisa de ${MIN_STOCKS} a ${MAX_STOCKS} ações (as quatro dos casos difíceis e ao menos uma de enchimento); veio ${count}`,
    );
  }
  if (!Number.isInteger(sessions) || sessions < MIN_SESSIONS || sessions > MAX_SESSIONS) {
    throw new RangeError(
      `O ensaio precisa de ${MIN_SESSIONS} a ${MAX_SESSIONS} pregões (o desdobramento é no 3º); veio ${sessions}`,
    );
  }
  if (!calendar.isTradingDay(firstDay)) throw new RangeError(`${firstDay} não é pregão`);

  const stocks: StockSpec[] = [
    ...PLANTED,
    ...Array.from({ length: count - PLANTED.length }, (_, i) => fillerStock(i)),
  ];

  // a janela do universo da semana do primeiro dia (os 60 pregões antes da segunda-feira) até o pregão anterior ao primeiro dia
  const monday = isoWeekMonday(isoWeek(firstDay));
  const window = calendar.tradingDaysBefore(monday, HISTORY_DAYS);
  const lastHistory = calendar.previousTradingDay(firstDay);
  const historyDays = calendar.tradingDaysBetween(window[0]!, lastHistory);
  const sessionDays: IsoDate[] = [firstDay];
  while (sessionDays.length < sessions) {
    sessionDays.push(calendar.nextTradingDay(sessionDays.at(-1)!));
  }
  const allDays = [...historyDays, ...sessionDays];
  const split: SplitEvent = {
    ticker: 'DOBR4',
    exDate: sessionDays[2]!,
    kind: 'split',
    factor: '1:2',
  };

  const bars = new Map<IsoDate, DayBar[]>(allDays.map((day) => [day, []]));
  // o movimento do mercado no dia, o mesmo para todas as ações (e a base do BOVA11), em pontos-base
  const marketFactor = new Map(
    allDays.map((day) => [day, (digest(seed, 'mercado', day).readUInt16BE(0) % 241) - 120]),
  );

  const walk = (
    ticker: string,
    baseVolume: bigint,
    pick: (offset: number, d: Buffer, factor: number) => { bps: number | undefined; skip: boolean },
    halveAtOffset?: number,
  ): void => {
    let previous = 6_000 + (digest(seed, ticker, 'preço inicial').readUInt16BE(0) % 6_001);
    allDays.forEach((day, index) => {
      const offset = index - historyDays.length;
      const d = digest(seed, ticker, day);
      // desdobramento: na data ex a cotação do arquivo já vem pela metade (a B3 não ajusta o histórico)
      if (offset === halveAtOffset) previous = Math.max(100, Math.round(previous / 2));
      const { bps, skip } = pick(offset, d, marketFactor.get(day)!);
      if (skip) return;
      const close = Math.max(100, step(previous, bps ?? 0));
      const open = Math.max(100, step(previous, (d.readUInt16BE(2) % 161) - 80));
      const high = step(Math.max(open, close), d.readUInt16BE(4) % 121);
      const low = Math.max(1, step(Math.min(open, close), -(d.readUInt16BE(6) % 121)));
      bars.get(day)!.push({
        ticker,
        open: BigInt(open),
        high: BigInt(high),
        low: BigInt(low),
        close: BigInt(close),
        volume: (baseVolume * BigInt(80 + (d.readUInt16BE(8) % 41))) / 100n,
        trades: 200 + (d.readUInt16BE(10) % 3_000),
      });
      previous = close;
    });
  };

  stocks.forEach((stock, index) => {
    // o volume cai com a posição na lista: as quatro dos casos difíceis são as mais líquidas
    const baseVolume = (20_000_000_000n * 100n) / BigInt(100 + 6 * index);
    walk(
      stock.ticker,
      baseVolume,
      (offset, d, factor) => ({
        bps: planted(stock.role, offset) ?? factor + ((d.readUInt16BE(0) % 501) - 250),
        skip: absent(stock, offset, d),
      }),
      stock.role === 'split' ? 2 : undefined,
    );
  });
  // o BOVA11 acompanha o mercado, com um ruído pequeno, e negocia todo dia
  walk(REFERENCE, 50_000_000_000n, (_offset, d, factor) => ({
    bps: factor + ((d.readUInt16BE(0) % 61) - 30),
    skip: false,
  }));

  for (const list of bars.values()) list.sort((a, b) => (a.ticker < b.ticker ? -1 : 1));
  return { stocks, historyDays, sessionDays, bars, split };
}
