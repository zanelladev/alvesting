import type { MacroValue } from '../modules/briefing/domain/briefing.js';
import type { BriefingRepository } from '../modules/briefing/infrastructure/briefing.repository.js';
import {
  addDays,
  addMonths,
  brasiliaInstant,
  type IsoDate,
} from '../modules/market-data/domain/dates.js';
import type { TradingCalendar } from '../modules/market-data/domain/trading-calendar.js';
import type { FreezeReads } from '../ensaio/world.js';

// O que o pipeline ao vivo teria visto às 07:30 de um pregão que já passou (ADR 0038; docs/DADOS.md, "O retroativo"). O arena:retroativo
// roda o pregão D dias depois, num banco que já tem o que saiu depois de D; cada fonte tem uma regra para o briefing de D ver só o que já
// existia no corte das 07:30:
//  - barras: só até D-1. É o próprio freeze que pede assim (as 30 sessões antes de D), ao vivo e no retroativo; nada aqui;
//  - notícia de RSS: pela hora real em que foi vista (`first_seen_at`), na janela do freeze; o retroativo não inventa notícia;
//  - documento da CVM: a hora em que o pipeline ao vivo o veria, `cvmSeenAt` (abaixo), gravada como `first_seen_at`;
//  - macro do BCB: a data em que cada valor fica público, `macroPublicFrom` (abaixo), no lugar da "data do valor até D-1" do ao vivo.

const CUTOFF_BRT = '07:30';
// A busca da CVM das 07:30 roda poucos segundos depois do corte (o cron chega alguns segundos depois da hora cheia)
const CVM_FETCH_DELAY_MS = 45_000;

// A CVM refaz o IPE uma vez por dia, por volta das 07:00 de Brasília, e a busca das 07:00 corre antes disso (docs/DADOS.md, seção 14, "Limite
// da fonte"): o documento entregue no dia X está no arquivo de X+1 e é visto pela primeira vez pela busca das 07:30 de X+1, depois do corte.
// Por isso ele entra no briefing do primeiro pregão depois de X+1: o da quinta para o entregue na terça, o da segunda para o entregue na sexta,
// no sábado ou no domingo... a não ser o do domingo, que é visto na segunda depois do corte e vai para a terça.
export const cvmSeenAt = (deliveredOn: IsoDate): Date =>
  new Date(brasiliaInstant(addDays(deliveredOn, 1), CUTOFF_BRT).getTime() + CVM_FETCH_DELAY_MS);

// A partir de quando um valor do SGS (série e data do valor) é público. O repositório não documenta a hora de publicação de nenhuma série, então
// vale a regra mais conservadora que o que se sabe permite (docs/DADOS.md, "O retroativo"):
//  - CDI (12) e dólar PTAX (1): o valor do dia V sai no dia útil seguinte, sem hora conhecida. Público só depois desse dia inteiro: o
//    briefing de quinta vê o de terça, e não o de quarta;
//  - meta Selic (432): a meta do dia V é a que o Copom decidiu antes de V (o SGS a projeta para os dias seguintes). Pública no fim de V,
//    o mesmo que o ao vivo faz (valor até D-1);
//  - IPCA do mês e de 12 meses (433 e 13522): o IBGE divulga o do mês M no começo de M+1, num dia que o repositório não guarda. Público só
//    no dia 1 de M+2: o briefing de outubro vê o IPCA de agosto.
export function macroPublicFrom(
  value: Pick<MacroValue, 'series' | 'date'>,
  calendar: Pick<TradingCalendar, 'nextTradingDay'>,
): Date {
  switch (value.series) {
    case 'cdi_daily_pct':
    case 'usd_brl_ptax_sell':
      return brasiliaInstant(addDays(calendar.nextTradingDay(value.date), 1));
    case 'ipca_month_pct':
    case 'ipca_12m_pct':
      return brasiliaInstant(addMonths(`${value.date.slice(0, 7)}-01`, 2));
    default:
      // a meta Selic e qualquer série nova: o fim do dia do valor (a regra do ao vivo)
      return brasiliaInstant(addDays(value.date, 1));
  }
}

// O valor mais recente de cada série que já era público no instante (as linhas vêm do mais novo ao mais antigo de cada série).
export function latestPublic(
  rows: readonly MacroValue[],
  at: Date,
  calendar: Pick<TradingCalendar, 'nextTradingDay'>,
): MacroValue[] {
  const picked = new Map<string, MacroValue>();
  for (const row of rows) {
    if (!picked.has(row.series) && macroPublicFrom(row, calendar) <= at)
      picked.set(row.series, row);
  }
  return [...picked.values()];
}

// As leituras do freeze no retroativo: as mesmas do BriefingRepository, com o macro trocado pela regra acima. O freeze pede o macro até o
// último pregão antes de D (`last`), e o corte de D sai dele: D é o pregão seguinte a `last` (FreezeHandler: as 30 sessões antes de D).
export function retroBriefingReads(
  repo: BriefingRepository,
  calendar: Pick<TradingCalendar, 'nextTradingDay'>,
): FreezeReads {
  return {
    find: (date) => repo.find(date),
    latestBefore: (date) => repo.latestBefore(date),
    firstAfter: (date) => repo.firstAfter(date),
    universe: (week) => repo.universe(week),
    bars: (tickers, from, to) => repo.bars(tickers, from, to),
    news: (after, until) => repo.news(after, until),
    runningSeasons: (date) => repo.runningSeasons(date),
    save: (input) => repo.save(input),
    macro: async (last) => {
      const cutoff = brasiliaInstant(calendar.nextTradingDay(last), CUTOFF_BRT);
      return latestPublic(await repo.macroHistory(last), cutoff, calendar);
    },
  };
}
