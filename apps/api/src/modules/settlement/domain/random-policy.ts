import { createHash } from 'node:crypto';
import { MAX_ORDERS_PER_CYCLE, type DecisionItem } from '@alvesting/contracts';
import type { IsoDate } from '../../market-data/domain/dates.js';

// A política aleatória, a mesma para o Sorteio e para o Monte Carlo (plano, 2; docs/METODOLOGIA.md). Cada pregão sorteia
// de 0 a 5 ordens. Cada ordem é SELL de uma posição da carteira (1% a 100% dela) ou BUY de uma ação do universo da
// semana (5% a 25% do patrimônio), com tickers distintos no pregão. Sai no mesmo formato das decisões dos modelos e
// passa pelo mesmo motor de execução: as regras de caixa, de 10 posições, de ação inteira e de barra valem igual.
//
// Todo o acaso vem de draw(): o SHA-256 de "semente:pregão:carteira:contador". Sem gerador pseudoaleatório caseiro, sem
// Math.random e sem estado: quem tem a semente refaz qualquer sorteio, em qualquer ordem.

// A carteira do Sorteio. As do Monte Carlo são "mc:0" a "mc:999" (monte-carlo.ts): nenhuma repete a do Sorteio.
export const SORTEIO_PORTFOLIO = 'sorteio';

// Os 6 primeiros bytes do resumo, como inteiro de 48 bits (cabe exato num number). O módulo sobre n itens tem viés
// de n / 2^48 (menos de 1e-11 para 500 ações), que é desprezível.
export function draw(seed: string, date: IsoDate, portfolio: string, counter: number): number {
  return createHash('sha256')
    .update(`${seed}:${date}:${portfolio}:${counter}`)
    .digest()
    .readUIntBE(0, 6);
}

export interface RandomPolicyInput {
  seed: string;
  date: IsoDate;
  portfolio: string;
  // tickers que a carteira tem ao começar o pregão
  held: readonly string[];
  // universo da semana de D, em ordem alfabética e sem repetição (a ordem entra no sorteio)
  universe: readonly string[];
}

// A ordem dos sorteios é fixa, e o contador sobe a cada um:
//   1. quantas ordens: draw % 6 (0 a 5);
//   2. para cada ordem: o tipo (par = SELL, ímpar = BUY; sem posição livre, é BUY) e o ticker, entre os que ainda não
//      saíram no pregão (posições em ordem alfabética para SELL, o universo para BUY), e o percentual inteiro:
//      1 + draw % 100 no SELL, 5 + draw % 21 no BUY.
export function randomDecisions({
  seed,
  date,
  portfolio,
  held,
  universe,
}: RandomPolicyInput): DecisionItem[] {
  let counter = 0;
  const next = () => draw(seed, date, portfolio, counter++);
  const pick = <T>(list: readonly T[]): T => list[next() % list.length] as T;

  const sellable = [...held].sort();
  const used = new Set<string>();
  const items: DecisionItem[] = [];
  const count = next() % (MAX_ORDERS_PER_CYCLE + 1);
  for (let i = 0; i < count; i += 1) {
    const wantSell = next() % 2 === 0;
    const freeToSell = sellable.filter((ticker) => !used.has(ticker));
    if (wantSell && freeToSell.length > 0) {
      const ticker = pick(freeToSell);
      items.push({
        ticker,
        action: 'SELL',
        percent_of_position: 1 + (next() % 100),
        rationale: 'sorteio',
      });
      used.add(ticker);
    } else {
      // ponytail: refiltra o universo a cada ordem (até 5 x 500 itens por carteira e pregão, uns 15 milhões de
      // comparações num Monte Carlo inteiro). Se o universo passar de alguns milhares, sortear o índice e pular os
      // já usados, em vez de copiar a lista.
      const pool = used.size === 0 ? universe : universe.filter((ticker) => !used.has(ticker));
      if (pool.length === 0) break;
      const ticker = pick(pool);
      items.push({
        ticker,
        action: 'BUY',
        percent_of_equity: 5 + (next() % 21),
        rationale: 'sorteio',
      });
      used.add(ticker);
    }
  }
  return items;
}
