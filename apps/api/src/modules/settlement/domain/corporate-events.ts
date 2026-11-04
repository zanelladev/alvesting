import { isIsoDate, type IsoDate } from '../../market-data/domain/dates.js';
import { divRound } from './money.js';
import type { Portfolio } from './portfolio.js';

// Desdobramento, grupamento e bonificação em ações (plano, 16, etapa 7). Os três são a mesma operação: cada `from`
// ações antigas viram `to` ações novas. Proventos em dinheiro estão fora da v2.0 (limitação declarada).
//   desdobramento 1 para 2  -> from 1, to 2
//   grupamento 10 para 1    -> from 10, to 1
//   bonificação de 10%      -> from 10, to 11
// A barra gravada é a capturada na noite do pregão (e nunca muda depois): na data ex a cotação cai (ou sobe) pelo
// fator. Sem ajustar a quantidade, o patrimônio mostraria uma perda (ou um ganho) que não existiu. A brapi não ajusta o
// OHLC por provento (medido na prova controlada de 04/11/2026), mas desdobramento e grupamento não foram medidos
// (docs/DADOS.md, seção 4): a carga de 3 meses de um papel novo, depois do evento, pode vir ajustada por ele, e o
// RUNBOOK manda conferir a série antes de registrar o evento.
export interface CorporateEvent {
  // ULID do evento: desempata dois eventos do mesmo ticker aplicados no mesmo pregão (ordem da data ex, depois do id)
  id: string;
  ticker: string;
  exDate: IsoDate;
  from: bigint;
  to: bigint;
}

export function validateEvent(event: CorporateEvent): void {
  if (!event.ticker) throw new RangeError(`Evento ${event.id}: ticker vazio`);
  if (!isIsoDate(event.exDate)) {
    throw new RangeError(`Evento ${event.id}: data ex inválida: ${event.exDate}`);
  }
  if (event.from <= 0n || event.to <= 0n) {
    throw new RangeError(`Evento ${event.id}: fator ${event.from}:${event.to} sem sentido`);
  }
  if (event.from === event.to) throw new RangeError(`Evento ${event.id}: o fator não muda nada`);
}

// Aplica o evento à posição do ticker, ao preço de abertura (`openCents`) do pregão em que ele vale.
// - A quantidade vira quantidade x to / from, em ações inteiras.
// - A fração que sobra (só em grupamento e bonificação) é paga em dinheiro ao preço de abertura, arredondada ao
//   centavo, e leva o custo na proporção: o custo da posição fica com as ações inteiras.
// - Se não sobra nenhuma ação inteira, a posição some e só o dinheiro da fração fica.
// A marcação da posição passa a ser a abertura, no preço novo: o fechamento antigo estava no preço velho.
export function applyCorporateEvent(
  portfolio: Portfolio,
  event: Pick<CorporateEvent, 'ticker' | 'from' | 'to'>,
  openCents: bigint,
): Portfolio {
  const { from, to } = event;
  if (from <= 0n || to <= 0n) throw new RangeError(`Fator ${from}:${to} sem sentido`);
  const position = portfolio.positions.get(event.ticker);
  if (!position) return portfolio;

  const scaled = position.quantity * to; // a quantidade nova, em unidades de 1/from ação
  const whole = scaled / from;
  const remainder = scaled % from;
  const fractionCash = divRound(remainder * openCents, from);

  const positions = new Map(portfolio.positions);
  if (whole === 0n) positions.delete(event.ticker);
  else {
    positions.set(event.ticker, {
      quantity: whole,
      // sem fração, o custo não muda; com fração, fica a parte das ações inteiras (whole de scaled / from)
      costCents:
        remainder === 0n ? position.costCents : divRound(position.costCents * whole * from, scaled),
      markCents: openCents,
    });
  }
  return { cashCents: portfolio.cashCents + fractionCash, positions };
}
