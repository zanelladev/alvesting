import {
  BUY_PERCENT_OF_EQUITY,
  MAX_ORDERS_PER_CYCLE,
  SELL_PERCENT_OF_POSITION,
  type SeasonParams,
} from '@alvesting/contracts';

// As regras da arena que vão no briefing (plano 2, docs/METODOLOGIA.md): números e flags, nunca texto de instrução. O
// prompt (a instrução ao modelo) é outra coisa, fica no Key Vault e nunca entra no repositório. Estas regras são
// públicas e iguais às da página "Como funciona".
// Os limites de ordens e de percentual vêm do contrato da decisão (packages/contracts/llm-decision.ts), o mesmo que valida a
// resposta do modelo: o briefing não anuncia uma regra diferente da que é aplicada.
// Estas são as da Temporada 1 e valem quando nenhuma temporada está RUNNING; com uma, capital, duração, posições, custo e
// horários vêm dela (rulesOfSeasons), e os padrões do schema da temporada têm de continuar iguais a estes (rules.spec.ts).
export const ARENA_RULES = {
  starting_capital_cents: 10_000_000, // R$ 100.000,00
  season_sessions: 20,
  max_positions: 10,
  max_orders_per_cycle: MAX_ORDERS_PER_CYCLE,
  buy_percent_of_equity: BUY_PERCENT_OF_EQUITY,
  sell_percent_of_position: SELL_PERCENT_OF_POSITION,
  trade_cost_bps: 3, // 0,03% por operação
  long_only: true, // sem alavancagem, sem vendido, sem day trade
  whole_shares_only: true,
  execution: 'official_open_same_session', // preço de abertura do pregão (a barra da brapi)
  sells_before_buys: true,
  decision_time_brt: '08:00',
  decision_deadline_brt: '09:30',
} as const;

export const rulesFromSeason = (params: SeasonParams) => ({
  ...ARENA_RULES,
  starting_capital_cents: params.capitalCents,
  season_sessions: params.sessions,
  max_positions: params.maxPositions,
  trade_cost_bps: params.tradeCostBps,
  decision_time_brt: params.decisionTimeBrt,
  decision_deadline_brt: params.deadlineTimeBrt,
});
export type ArenaRules = ReturnType<typeof rulesFromSeason>;

// O briefing é um só por pregão e vale para todas as temporadas RUNNING: sem nenhuma, as da Temporada 1; com mais de uma,
// elas têm de anunciar os mesmos números (senão o freeze falha em vez de dar a um modelo uma regra que não é a dele).
// ponytail: uma temporada de cada vez, que é o plano. Duas ao mesmo tempo com regras diferentes pedem um briefing por temporada.
export function rulesOfSeasons(seasons: readonly SeasonParams[]): ArenaRules {
  const [first, ...rest] = seasons.map(rulesFromSeason);
  if (first === undefined) return ARENA_RULES;
  const same = JSON.stringify(first);
  if (rest.some((rules) => JSON.stringify(rules) !== same)) {
    throw new Error(
      'Há mais de uma temporada RUNNING com regras diferentes: o briefing do pregão é um só',
    );
  }
  return first;
}
