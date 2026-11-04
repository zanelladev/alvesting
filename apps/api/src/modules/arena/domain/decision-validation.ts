import type { DecisionItem, DropReason } from '@alvesting/contracts';

// Validação semântica da resposta do modelo (plano 2; ADR 0016). Roda DEPOIS do schema (parseLlmDecision, que já descartou
// o item malformado): aqui entram as regras que dependem do universo da semana e da carteira de quem decidiu. Item
// descartado leva o motivo; os outros valem. Função pura, a mesma regra para todos os modelos.
//
// Quatro passadas, cada uma só vê o que as anteriores deixaram, sempre na ordem em que o modelo listou:
//   1. por item: ticker repetido (o primeiro vale), BUY fora do universo da semana, SELL de ação que não está na carteira.
//      HOLD não passa por universo nem carteira (não há ordem a executar).
//   2. até `maxPositions` posições: uma compra de ação nova que passaria do teto cai. As vendas rodam antes das compras na
//      execução (plano 2), então vender 100% de uma posição libera a vaga, mesmo que o SELL venha depois do BUY na lista.
//   3. até `maxOrders` ordens (BUY e SELL; HOLD não conta): da quinta em diante, na ordem listada.
//   4. de novo as posições, só com o que sobrou do corte: a passada 2 contou a vaga de uma venda total que a passada 3 pode
//      ter cortado (o SELL listado depois da 5ª ordem), e a compra que dependia dela não cabe mais. Sem esta passada a decisão
//      mostraria a compra como válida e a liquidação a recusaria (`max_positions`); a liquidação continua sendo a última barreira.
// A ordem das passadas é a que mantém a regra do ADR 0016: ordem descartada por outro motivo não gasta o limite. A ordem
// descartada na passada 4 já gastou uma vaga das 5, e a ordem cortada na 3 não volta: a conta é a da lista como o modelo a deu.

export interface IndexedItem {
  // posição do item na lista `decisions` que o modelo devolveu
  index: number;
  item: DecisionItem;
}

export interface DroppedByRule extends IndexedItem {
  reason: Exclude<DropReason, 'invalid_item'>;
}

export interface SemanticContext {
  // tickers da tabela do universo da semana, a que o modelo recebeu no briefing
  universe: ReadonlySet<string>;
  // ações da carteira de quem decidiu, com a quantidade
  holdings: ReadonlyMap<string, bigint>;
  maxPositions: number;
  maxOrders: number;
}

export function validateSemantics(
  items: readonly IndexedItem[],
  context: SemanticContext,
): { kept: IndexedItem[]; dropped: DroppedByRule[] } {
  const dropped: DroppedByRule[] = [];
  const drop = (entry: IndexedItem, reason: DroppedByRule['reason']) =>
    dropped.push({ ...entry, reason });
  const held = (ticker: string): boolean => (context.holdings.get(ticker) ?? 0n) > 0n;

  // 1. repetido, universo e carteira
  const seen = new Set<string>();
  const afterRules: IndexedItem[] = [];
  for (const entry of items) {
    const { ticker, action } = entry.item;
    if (seen.has(ticker)) {
      drop(entry, 'duplicate_ticker');
    } else if (action === 'BUY' && !context.universe.has(ticker)) {
      drop(entry, 'not_in_universe');
    } else if (action === 'SELL' && !held(ticker)) {
      drop(entry, 'not_in_portfolio');
    } else {
      seen.add(ticker);
      afterRules.push(entry);
    }
  }

  // 2 e 4. posições: as que a carteira tem, menos as vendidas por inteiro, mais as compras de ação nova que couberam. Só
  // vale o que está em `entries`: na passada 4, as vendas que o corte derrubou não liberam mais a vaga.
  const fitPositions = (entries: readonly IndexedItem[]): IndexedItem[] => {
    const closed = new Set(
      entries.flatMap(({ item }) =>
        item.action === 'SELL' && item.percent_of_position === 100 ? [item.ticker] : [],
      ),
    );
    let positions = [...context.holdings.keys()].filter((t) => held(t) && !closed.has(t)).length;
    const fitting: IndexedItem[] = [];
    for (const entry of entries) {
      const { ticker, action } = entry.item;
      if (action === 'BUY' && !held(ticker)) {
        if (positions >= context.maxPositions) {
          drop(entry, 'max_positions');
          continue;
        }
        positions += 1;
      }
      fitting.push(entry);
    }
    return fitting;
  };
  const afterPositions = fitPositions(afterRules);

  // 3. o corte das ordens
  let orders = 0;
  const afterCut: IndexedItem[] = [];
  for (const entry of afterPositions) {
    if (entry.item.action !== 'HOLD') {
      if (orders >= context.maxOrders) {
        drop(entry, 'over_order_limit');
        continue;
      }
      orders += 1;
    }
    afterCut.push(entry);
  }

  // 4. as posições de novo, só com o que o corte deixou
  const kept = fitPositions(afterCut);

  return { kept, dropped: dropped.sort((a, b) => a.index - b.index) };
}
