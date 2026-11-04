import { describe, expect, it } from 'vitest';
import type { BarRow } from '../../briefing/domain/briefing.js';
import { sha256Hex } from '../../briefing/domain/canonical-json.js';
import { buildOwnPart, initialPortfolio, type Portfolio } from './own-part.js';

const SESSIONS = ['2026-10-28', '2026-10-29', '2026-10-30'];
const bar = (date: string, close: bigint): BarRow => ({
  date,
  openCents: close - 10n,
  highCents: close + 20n,
  lowCents: close - 30n,
  closeCents: close,
  volumeCents: 5_000_000n,
});
const doc = (part: ReturnType<typeof buildOwnPart>) =>
  JSON.parse(part.bytes.toString('utf8')) as Record<string, unknown>;

describe('initialPortfolio: a carteira inicial (caixa = capital, sem posições)', () => {
  it('devolve o capital em caixa e nenhuma posição', () => {
    expect(initialPortfolio(10_000_000)).toEqual({ cashCents: 10_000_000n, positions: [] });
  });
});

describe('buildOwnPart: a parte própria do competidor', () => {
  it('carteira inicial: caixa, patrimônio igual ao caixa, sem posições nem barras', () => {
    const part = buildOwnPart({
      date: '2026-11-03',
      sessions: SESSIONS,
      portfolio: initialPortfolio(10_000_000),
      bars: new Map(),
    });
    expect(doc(part)).toEqual({
      format: 'alvesting-own/1',
      date: '2026-11-03',
      data_through: '2026-10-30',
      cash_cents: 10_000_000,
      equity_cents: 10_000_000,
      positions: [],
      bars: {
        columns: ['date', 'open_cents', 'high_cents', 'low_cents', 'close_cents', 'volume_cents'],
        by_ticker: {},
      },
    });
    expect(part.holdings.size).toBe(0);
  });

  const portfolio: Portfolio = {
    cashCents: 4_000_000n,
    positions: [
      { ticker: 'WEGE3', quantity: 100n, avgPriceCents: 4_000n },
      { ticker: 'VALE3', quantity: 200n, avgPriceCents: 6_500n },
    ],
  };
  const bars = new Map<string, BarRow[]>([
    ['VALE3', [bar('2026-10-30', 6_600n), bar('2026-10-28', 6_400n), bar('2026-10-29', 6_500n)]],
    ['WEGE3', [bar('2026-10-29', 4_100n), bar('2026-10-01', 9_999n)]],
    ['PETR4', [bar('2026-10-30', 3_800n)]],
  ]);

  it('posições em ordem de ticker, com o último fechamento; o patrimônio marca a mercado', () => {
    const body = doc(buildOwnPart({ date: '2026-11-03', sessions: SESSIONS, portfolio, bars }));
    expect(body.positions).toEqual([
      { ticker: 'VALE3', quantity: 200, avg_price_cents: 6_500, last_close_cents: 6_600 },
      { ticker: 'WEGE3', quantity: 100, avg_price_cents: 4_000, last_close_cents: 4_100 },
    ]);
    // 4.000.000 + 200 x 6.600 + 100 x 4.100
    expect(body.equity_cents).toBe(4_000_000 + 1_320_000 + 410_000);
  });

  it('só as barras das posições, só dos pregões da janela, em ordem de data', () => {
    const body = doc(buildOwnPart({ date: '2026-11-03', sessions: SESSIONS, portfolio, bars }));
    const byTicker = (body.bars as { by_ticker: Record<string, unknown[][]> }).by_ticker;
    expect(Object.keys(byTicker)).toEqual(['VALE3', 'WEGE3']); // PETR4 não é posição
    expect(byTicker.VALE3!.map((row) => row[0])).toEqual([
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
    ]);
    expect(byTicker.WEGE3!.map((row) => row[0])).toEqual(['2026-10-29']); // a de 01/10 está fora da janela
  });

  it('posição sem barra na janela marca pelo preço médio e não inventa fechamento', () => {
    const body = doc(
      buildOwnPart({
        date: '2026-11-03',
        sessions: SESSIONS,
        portfolio: {
          cashCents: 0n,
          positions: [{ ticker: 'ABEV3', quantity: 10n, avgPriceCents: 1_200n }],
        },
        bars: new Map(),
      }),
    );
    expect(body.positions).toEqual([
      { ticker: 'ABEV3', quantity: 10, avg_price_cents: 1_200, last_close_cents: null },
    ]);
    expect(body.equity_cents).toBe(12_000);
  });

  it('devolve as posições como mapa ticker -> quantidade, para o validador', () => {
    const part = buildOwnPart({ date: '2026-11-03', sessions: SESSIONS, portfolio, bars });
    expect(part.holdings).toEqual(
      new Map([
        ['VALE3', 200n],
        ['WEGE3', 100n],
      ]),
    );
  });

  it('é determinístico: a mesma entrada dá os mesmos bytes e o mesmo SHA-256, em qualquer ordem', () => {
    const a = buildOwnPart({ date: '2026-11-03', sessions: SESSIONS, portfolio, bars });
    const b = buildOwnPart({
      date: '2026-11-03',
      sessions: SESSIONS,
      portfolio: { ...portfolio, positions: [...portfolio.positions].reverse() },
      bars: new Map([...bars].reverse()),
    });
    expect(a.bytes.equals(b.bytes)).toBe(true);
    expect(a.sha256).toBe(sha256Hex(a.bytes));
    expect(b.sha256).toBe(a.sha256);
  });

  it('sem pregões de dados não há como montar', () => {
    expect(() => buildOwnPart({ date: '2026-11-03', sessions: [], portfolio, bars })).toThrow(
      /pregões/,
    );
  });
});
