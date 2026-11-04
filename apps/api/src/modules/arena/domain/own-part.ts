import type { BarRow } from '../../briefing/domain/briefing.js';
import { canonicalBytes, sha256Hex } from '../../briefing/domain/canonical-json.js';
import type { IsoDate } from '../../market-data/domain/dates.js';

// A parte própria de cada competidor (plano 10): o que o briefing, igual para todos, não leva. Caixa, posições com
// quantidade e preço médio, e as barras dos 30 pregões dessas ações. Mesma serialização canônica do briefing (só inteiros):
// a mesma carteira dá os mesmos bytes e o mesmo SHA-256, e o modelo recebe o bloco com o hash no marcador.

export interface Position {
  ticker: string;
  quantity: bigint;
  avgPriceCents: bigint;
}

export interface Portfolio {
  cashCents: bigint;
  positions: Position[];
}

export const OWN_FORMAT = 'alvesting-own/1';

export const initialPortfolio = (capitalCents: number): Portfolio => ({
  cashCents: BigInt(capitalCents),
  positions: [],
});

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function buildOwnPart(input: {
  date: IsoDate;
  // os pregões da janela (até o fechamento anterior), em ordem crescente
  sessions: readonly IsoDate[];
  portfolio: Portfolio;
  bars: ReadonlyMap<string, readonly BarRow[]>;
}): { bytes: Buffer; sha256: string; holdings: Map<string, bigint> } {
  const last = input.sessions[input.sessions.length - 1];
  if (last === undefined) throw new Error('Sem pregões de dados para a parte própria');
  const inWindow = new Set(input.sessions);
  const positions = [...input.portfolio.positions].sort((a, b) => compare(a.ticker, b.ticker));

  // Patrimônio = caixa + posições marcadas pelo último fechamento da janela. Posição sem barra marca pelo preço médio (a
  // liquidação da etapa 7 tem a regra oficial; aqui é só a base para o modelo dimensionar o BUY em % do patrimônio).
  let equity = input.portfolio.cashCents;
  const byTicker: Record<string, Array<Array<string | bigint>>> = {};
  const rows = positions.map((position) => {
    const window = (input.bars.get(position.ticker) ?? [])
      .filter((bar) => inWindow.has(bar.date))
      .sort((a, b) => compare(a.date, b.date));
    byTicker[position.ticker] = window.map((bar) => [
      bar.date,
      bar.openCents,
      bar.highCents,
      bar.lowCents,
      bar.closeCents,
      bar.volumeCents,
    ]);
    const lastClose = window[window.length - 1]?.closeCents ?? null;
    equity += position.quantity * (lastClose ?? position.avgPriceCents);
    return {
      ticker: position.ticker,
      quantity: position.quantity,
      avg_price_cents: position.avgPriceCents,
      last_close_cents: lastClose,
    };
  });

  const bytes = canonicalBytes({
    format: OWN_FORMAT,
    date: input.date,
    data_through: last,
    cash_cents: input.portfolio.cashCents,
    equity_cents: equity,
    positions: rows,
    bars: {
      columns: ['date', 'open_cents', 'high_cents', 'low_cents', 'close_cents', 'volume_cents'],
      by_ticker: byTicker,
    },
  });
  return {
    bytes,
    sha256: sha256Hex(bytes),
    holdings: new Map(positions.map((p) => [p.ticker, p.quantity])),
  };
}
