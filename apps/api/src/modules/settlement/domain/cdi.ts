import { isIsoDate, type IsoDate } from '../../market-data/domain/dates.js';
import { divRound } from './money.js';

// O CDI que rende o caixa: série 12 do SGS, % ao dia, texto decimal com até 8 casas (macro_daily.value é
// NUMERIC(18,8); a série tem 6). A regra de data está em docs/METODOLOGIA.md: o caixa rende uma taxa por intervalo
// entre pregões, a do pregão anterior, e se ela ainda não saiu vale a última publicada.

export interface CdiPoint {
  date: IsoDate;
  // % ao dia como texto decimal, ex.: "0.050788"
  pct: string;
}

export interface CdiRate {
  date: IsoDate;
  // % ao dia x 1e8, inteiro
  scaled: bigint;
}

// Não há taxa publicada até a data do intervalo: render zero em silêncio daria um patrimônio errado e bonito.
export class MissingCdiError extends Error {
  constructor(date: IsoDate) {
    super(`Nenhum CDI publicado até ${date}: o caixa não tem taxa para render`);
    this.name = 'MissingCdiError';
  }
}

const DECIMALS = 8;
const PCT = /^(\d+)(?:\.(\d{1,8}))?$/;

// Valida a fronteira (o banco devolve Decimal, o chamador o escreve com toFixed) e ordena por data.
export function parseCdi(points: readonly CdiPoint[]): CdiRate[] {
  return points
    .map(({ date, pct }) => {
      if (!isIsoDate(date)) throw new RangeError(`Data de CDI inválida: ${date}`);
      const match = PCT.exec(pct);
      if (!match) throw new RangeError(`CDI de ${date} inválido: ${JSON.stringify(pct)}`);
      const [, whole = '0', fraction = ''] = match;
      return { date, scaled: BigInt(whole + fraction.padEnd(DECIMALS, '0')) };
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// A taxa de data mais recente que não passa de `date`. `rates` vem de parseCdi (ordenada). Nunca olha o futuro: um
// CDI publicado depois não muda o que a liquidação de hoje usou, e refazer a temporada do zero pega o certo.
export function rateOnOrBefore(rates: readonly CdiRate[], date: IsoDate): CdiRate | null {
  // ponytail: varredura linear. Com um ano de série (cerca de 250 pontos) e 20 pregões não pesa; com a história inteira,
  // trocar por busca binária.
  let found: CdiRate | null = null;
  for (const rate of rates) {
    if (rate.date > date) break;
    found = rate;
  }
  return found;
}

// Juros de um dia útil sobre o caixa: caixa x taxa% / 100, arredondado ao centavo (o meio sobe).
export const interest = (cashCents: bigint, rate: CdiRate): bigint =>
  divRound(cashCents * rate.scaled, 10n ** BigInt(DECIMALS + 2));
