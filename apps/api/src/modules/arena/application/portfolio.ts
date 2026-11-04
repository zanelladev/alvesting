import { Logger } from '@nestjs/common';
import type { IsoDate } from '../../market-data/domain/dates.js';
import type { TradingCalendar } from '../../market-data/domain/trading-calendar.js';
import { divRound } from '../../settlement/domain/money.js';
import { initialPortfolio, type Portfolio } from '../domain/own-part.js';
import type { ArenaRepository } from '../infrastructure/arena.repository.js';

export interface PortfolioQuery {
  seasonId: string;
  competitorId: string;
  // o pregão da decisão: a carteira vale até o fechamento anterior
  date: IsoDate;
  // o primeiro pregão da temporada (nulo no rascunho): só nele a carteira inicial é a carteira certa
  startDate: IsoDate | null;
  capitalCents: number;
}

// A leitura da carteira de um competidor (caixa e posições) no momento da decisão. O DecideHandler a recebe pelo construtor
// (o ArenaModule monta a do banco, abaixo; os testes passam a que o caso pede).
export type ReadPortfolio = (query: PortfolioQuery) => Promise<Portfolio>;

// A carteira de quem ainda não operou: caixa igual ao capital, sem posições. Vale no primeiro pregão da temporada, quando não
// há liquidação anterior.
export const readInitialPortfolio: ReadPortfolio = (query) =>
  Promise.resolve(initialPortfolio(query.capitalCents));

// A carteira da última liquidação antes do pregão da decisão (etapa 7): o caixa e as posições do fechamento do pregão anterior,
// com o preço médio (custo / quantidade, no centavo mais próximo, a mesma regra de arredondamento da liquidação). Sem liquidação
// anterior, a carteira inicial.
//
// Se a última liquidação não é a do pregão anterior (o eod ou o settle de ontem atrasou ou falhou), o modelo decide com a
// carteira que existe, e o log avisa: a liquidação de depois executa a decisão sobre a carteira certa, e a ordem que deixou de
// caber é recusada e registrada. O ciclo não é pulado por isso (isso pediria um motivo novo de pulo, com migration e contrato).
// Sem nenhuma liquidação, o caso é o mesmo, e só o primeiro pregão da temporada decide com a carteira inicial sem aviso.
export function settledPortfolioReader(deps: {
  repo: Pick<ArenaRepository, 'lastPortfolio'>;
  calendar: Pick<TradingCalendar, 'previousTradingDay'>;
}): ReadPortfolio {
  const logger = new Logger('SettledPortfolio');
  return async (query) => {
    const last = await deps.repo.lastPortfolio(query.seasonId, query.competitorId, query.date);
    const expected = deps.calendar.previousTradingDay(query.date);
    if (last ? last.date !== expected : query.date !== query.startDate) {
      logger.warn(
        {
          date: query.date,
          settledThrough: last?.date ?? null,
          expected,
          competitorId: query.competitorId,
        },
        'a carteira da decisão não é a do pregão anterior: a última liquidação está atrasada',
      );
    }
    if (!last) return readInitialPortfolio(query);
    return {
      cashCents: last.cashCents,
      positions: last.positions.map((position) => ({
        ticker: position.ticker,
        quantity: position.quantity,
        avgPriceCents: divRound(position.costCents, position.quantity),
      })),
    };
  };
}
