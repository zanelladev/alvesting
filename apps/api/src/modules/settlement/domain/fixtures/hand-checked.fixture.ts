// O cenário da planilha conferida à mão (docs/METODOLOGIA.md, "A planilha conferida à mão"): 3 ações, 5 pregões,
// compras, vendas, custo, CDI, um dia sem barra, um desdobramento e uma taxa de CDI que ainda não saiu.
// Tudo inventado: nenhum preço, notícia ou decisão aqui vem de fonte real. Os valores esperados estão nos CSVs ao lado,
// derivados à mão, passo a passo, sem rodar o código da liquidação. Só os testes importam este arquivo (fica fora do
// build, ver tsconfig.build.json).
import { readFileSync } from 'node:fs';
import type { DecisionItem } from '@alvesting/contracts';
import type { CdiPoint } from '../cdi.js';
import type { CorporateEvent } from '../corporate-events.js';
import type { Bar } from '../portfolio.js';
import type { Competitor, Market } from '../simulation.js';

export type CsvRow = Record<string, string>;

// Um dos CSVs da planilha (hand-checked-*.csv, ao lado deste arquivo) como linhas de texto, na ordem do arquivo. A simulação em
// memória (hand-checked.spec.ts) e a liquidação pelo banco (settle.handler.integration.spec.ts) comparam com os mesmos arquivos.
export function readHandCheckedCsv(name: string): CsvRow[] {
  const text = readFileSync(new URL(name, import.meta.url), 'utf8');
  const [header = '', ...lines] = text.trim().split('\n');
  const columns = header.split(',');
  return lines.map((line) =>
    Object.fromEntries(
      line.split(',').map((value, i): [string, string] => [columns[i] ?? '', value]),
    ),
  );
}

// R$ 10.000,00: pequeno para as contas caberem à mão. A mecânica é a mesma do capital de R$ 100.000,00 da temporada.
export const HAND_CHECKED_CAPITAL_CENTS = 1_000_000n;

export const HAND_CHECKED_DATES = [
  '2026-11-03', // terça (o 02/11 é Finados)
  '2026-11-04',
  '2026-11-05', // data ex do desdobramento de BBB4 e dia sem barra de AAA3
  '2026-11-06', // sexta: o CDI deste dia ainda não saiu quando a liquidação do dia 09 roda
  '2026-11-09', // segunda
] as const;

// [abertura, fechamento] em centavos por ação; null = sem barra no pregão
type Day = readonly [open: number, close: number] | null;
const PRICES: Record<string, readonly [Day, Day, Day, Day, Day]> = {
  AAA3: [[2300, 2400], [2420, 2500], null, [2480, 2550], [2560, 2500]],
  // desdobramento de 1 para 2 na data ex (05/11): os preços de 05/11 em diante já são os pós-desdobramento
  BBB4: [
    [2500, 2600],
    [2620, 2700],
    [1300, 1250],
    [1280, 1400],
    [1390, 1350],
  ],
  CCC3: [
    [1000, 990],
    [1010, 1050],
    [1040, 1020],
    [1000, 980],
    [990, 1010],
  ],
  // referência de contexto: fora do universo
  BOVA11: [
    [13000, 13100],
    [13050, 13200],
    [13200, 13150],
    [13100, 13300],
    [13250, 13400],
  ],
};

const UNIVERSE = ['AAA3', 'BBB4', 'CCC3'];

export const HAND_CHECKED_MARKET: Market = {
  sessions: HAND_CHECKED_DATES.map((date, index) => ({
    date,
    bars: new Map(
      Object.entries(PRICES).flatMap(([ticker, days]): [string, Bar][] => {
        const day = days[index];
        return day ? [[ticker, { openCents: BigInt(day[0]), closeCents: BigInt(day[1]) }]] : [];
      }),
    ),
    universe: UNIVERSE,
  })),
  // % ao dia, como o SGS 12 entrega. Falta o de 06/11 (sai no dia útil seguinte) e sobra o de 09/11 (sai depois da
  // liquidação de 09/11 e não pode entrar nela); o de 30/10 é antigo demais para ser escolhido
  cdi: [
    { date: '2026-10-30', pct: '0.050001' },
    { date: '2026-11-03', pct: '0.050788' },
    { date: '2026-11-04', pct: '0.050812' },
    { date: '2026-11-05', pct: '0.050640' },
    { date: '2026-11-09', pct: '0.050700' },
  ] satisfies CdiPoint[],
  events: [
    { id: '01JCZ6S8Y0000000000000001', ticker: 'BBB4', exDate: '2026-11-05', from: 1n, to: 2n },
  ] satisfies CorporateEvent[],
};

const buy = (ticker: string, percent: number): DecisionItem => ({
  ticker,
  action: 'BUY',
  percent_of_equity: percent,
  rationale: 'fixture',
});
const sell = (ticker: string, percent: number): DecisionItem => ({
  ticker,
  action: 'SELL',
  percent_of_position: percent,
  rationale: 'fixture',
});
const hold = (ticker: string): DecisionItem => ({ ticker, action: 'HOLD', rationale: 'fixture' });

export const HAND_CHECKED_COMPETITORS: Competitor[] = [
  {
    id: 'model-a',
    kind: 'MODEL',
    decisions: new Map<string, DecisionItem[]>([
      ['2026-11-03', [buy('AAA3', 20), buy('BBB4', 15.5), hold('CCC3')]],
      ['2026-11-04', [sell('AAA3', 51), buy('CCC3', 25)]],
      // AAA3 sem barra: a venda não executa. A segunda compra não cabe no caixa e sai reduzida
      ['2026-11-05', [sell('AAA3', 100), buy('CCC3', 25), buy('BBB4', 25)]],
      // a compra vem listada antes da venda que a paga: as vendas executam primeiro
      ['2026-11-06', [buy('AAA3', 25), sell('BBB4', 100)]],
      ['2026-11-09', [sell('CCC3', 100), buy('BBB4', 25)]],
    ]),
  },
  { id: 'equal-weight', kind: 'EQUAL_WEIGHT' },
  { id: 'cdi', kind: 'CDI' },
  { id: 'bova11', kind: 'BOVA11' },
];
