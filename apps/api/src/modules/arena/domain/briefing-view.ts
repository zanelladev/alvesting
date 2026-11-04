import { z } from 'zod';
import type { IsoDate } from '../../market-data/domain/dates.js';
import { BRIEFING_FORMAT } from '../../briefing/domain/briefing.js';

// O pedaço do briefing congelado que a decisão lê. A decisão valida contra a tabela do universo que o MODELO RECEBEU (as
// linhas do próprio briefing, conferidas pelo SHA-256), não contra o banco de agora: o universo da semana é congelado, mas
// a regra "o modelo só compra o que viu" não deve depender de uma segunda leitura.
const briefingDocSchema = z.object({
  format: z.literal(BRIEFING_FORMAT),
  date: z.iso.date(),
  data_through: z.iso.date(),
  universe: z.object({
    week: z.string(),
    // colunas: ticker, name, close_cents, change_bps, avg_volume_cents (a ordem é a do SHA-256 do pregão)
    rows: z.array(z.tuple([z.string()], z.unknown())),
  }),
});

export interface BriefingView {
  date: IsoDate;
  dataThrough: IsoDate;
  week: string;
  tickers: Set<string>;
}

export function readBriefing(bytes: Uint8Array): BriefingView {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    // sem o texto do erro nem do conteúdo
    throw new Error('Briefing congelado ilegível: não é JSON');
  }
  const parsed = briefingDocSchema.safeParse(json);
  if (!parsed.success) throw new Error('Briefing congelado com formato inesperado');
  const { date, data_through, universe } = parsed.data;
  return {
    date,
    dataThrough: data_through,
    week: universe.week,
    tickers: new Set(universe.rows.map((row) => row[0])),
  };
}
