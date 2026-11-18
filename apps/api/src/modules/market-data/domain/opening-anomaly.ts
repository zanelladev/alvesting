import type { IsoDate } from './dates.js';

// A abertura anômala (docs/DADOS.md, seção 6; o sinal `abertura-anomala`): a barra nova de um papel abre acima de 3 vezes ou abaixo de 1/3
// do fechamento anterior, e não há evento corporativo dele com data ex no dia. É o desdobramento, o grupamento ou a troca do fator de
// cotação que ninguém registrou: em 03/11/2026 o RAIZ4 passou a ser cotado por lote de 100 e, sem o evento, o igual-peso ficou uns
// R$ 17 mil acima do certo até 15/11 (docs/METODOLOGIA.md, "O RAIZ4 cotado por lote"). Queda de mercado não chega lá: no circuit breaker de
// 26/10/2026 as aberturas ficaram perto da metade. Os limites são estritos (3 vezes em ponto não dispara), e a conta é só com inteiros.
export const OPENING_FACTOR = 3n;

export interface Opening {
  ticker: string;
  date: IsoDate;
  openCents: bigint;
  // o fechamento da barra gravada antes desta; nulo na primeira barra do papel
  previousCloseCents: bigint | null;
  // há evento corporativo do papel, de qualquer tipo, com data ex no dia
  exEvent: boolean;
}

export interface AnomalousOpening {
  ticker: string;
  date: IsoDate;
  // abertura ÷ fechamento anterior com 3 algarismos significativos: é o que vai ao log, no lugar dos preços
  ratio: number;
}

export function anomalousOpenings(openings: readonly Opening[]): AnomalousOpening[] {
  return openings.flatMap(({ ticker, date, openCents, previousCloseCents: previous, exEvent }) =>
    previous !== null &&
    previous > 0n &&
    !exEvent &&
    (openCents > OPENING_FACTOR * previous || OPENING_FACTOR * openCents < previous)
      ? [{ ticker, date, ratio: Number((Number(openCents) / Number(previous)).toPrecision(3)) }]
      : [],
  );
}
