import { seasonFileSchema, type CompetitorSpec, type SeasonFile } from '@alvesting/contracts';
import { z } from 'zod';
import { SeasonFileError } from '../modules/arena/application/season.service.js';
import { pricedCostMicro } from '../modules/arena/domain/cost.js';
import type { IsoDate } from '../modules/market-data/domain/dates.js';
import type { TradingCalendar } from '../modules/market-data/domain/trading-calendar.js';

// O plano da Temporada 1 (ADR 0038): o arquivo da temporada com a data do primeiro pregão, os pregões que ele cobre e o custo estimado das LLMs.

// O arquivo da temporada que começa numa data fixa (apps/api/seasons/temporada-1.json): o arquivo comum do season:create mais `startDate`.
// O season:create e o painel não o aceitam (o schema deles é estrito, e o início deles é o próximo pregão); quem o cria e o inicia é o
// arena:retroativo. As mensagens de erro dizem o caminho e a regra, nunca o valor (como as do season:create).
export interface DatedSeasonFile {
  startDate: IsoDate;
  file: SeasonFile;
}

export function parseDatedSeasonFile(raw: unknown): DatedSeasonFile {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SeasonFileError(['(arquivo): esperava um objeto JSON']);
  }
  const { startDate, ...rest } = raw as Record<string, unknown>;
  const date = z.iso.date().safeParse(startDate);
  const file = seasonFileSchema.safeParse(rest);
  const problems = [
    ...(date.success ? [] : ['startDate: a data do primeiro pregão, AAAA-MM-DD']),
    ...(file.success
      ? []
      : file.error.issues.map(
          (issue) => `${issue.path.join('.') || '(arquivo)'}: ${issue.message}`,
        )),
  ];
  if (!date.success || !file.success) throw new SeasonFileError(problems);
  return { startDate: date.data, file: file.data };
}

// Os pregões da temporada: `params.sessions` pregões a partir da data do arquivo, que tem de ser pregão.
export function seasonSessions(
  dated: DatedSeasonFile,
  calendar: Pick<TradingCalendar, 'isTradingDay' | 'nextTradingDay'>,
): IsoDate[] {
  if (!calendar.isTradingDay(dated.startDate)) {
    throw new SeasonFileError([`startDate: ${dated.startDate} não é pregão da B3`]);
  }
  const days = [dated.startDate];
  while (days.length < dated.file.params.sessions) days.push(calendar.nextTradingDay(days.at(-1)!));
  return days;
}

// Os tokens de uma decisão, nos dois cenários do docs/ARENA.md (seção 8): o típico (20 mil de entrada e 6 mil de saída, uma chamada) e o pior
// caso, com o reparo (a primeira chamada no teto, 27 mil e os 16 mil de saída do gateway, e a segunda com a resposta de volta na entrada).
// ponytail: tokens estimados a 3 bytes por token sobre o tamanho do briefing de dev; o tokenizer de cada modelo difere. O custo de verdade é
// o `usage.cost` do OpenRouter, gravado em cada decisão; a estimativa só decide se vale abrir o pregão.
export const COST_SCENARIOS = {
  typical: [{ promptTokens: 20_000, completionTokens: 6_000 }],
  worst: [
    { promptTokens: 27_000, completionTokens: 16_000 },
    { promptTokens: 43_000, completionTokens: 16_000 },
  ],
} as const;
export type CostScenario = keyof typeof COST_SCENARIOS;

// O custo de um pregão (uma decisão de cada modelo), em micro-dólares, pelos preços do arquivo. O fake custa zero. O modelo pago sem a tabela
// de preços é recusado: sem ela a estimativa seria zero e o teto da execução nunca pararia nada (falharia para o lado aberto).
export function sessionCostMicro(
  competitors: readonly CompetitorSpec[],
  scenario: CostScenario,
): bigint {
  let total = 0n;
  for (const competitor of competitors) {
    if (competitor.kind !== 'MODEL' || competitor.provider === 'fake') continue;
    const pricing = competitor.pricingUsdPerMTok;
    if (!pricing) {
      throw new SeasonFileError([
        `competitors.${competitor.slug}.pricingUsdPerMTok: o retroativo exige os preços para estimar o custo`,
      ]);
    }
    for (const call of COST_SCENARIOS[scenario]) total += pricedCostMicro(call, pricing);
  }
  return total;
}
