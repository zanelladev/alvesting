import { seasonParamsSchema } from '@alvesting/contracts';
import { describe, expect, it } from 'vitest';
import { ARENA_RULES, rulesFromSeason, rulesOfSeasons } from './rules.js';

// valores sintéticos: só as sementes não têm padrão
const params = (over: Record<string, unknown> = {}) =>
  seasonParamsSchema.parse({ randomSeed: 'semente-a', monteCarloSeed: 'semente-b', ...over });

describe('regras do briefing vindas da temporada (etapa 6)', () => {
  it('os padrões da temporada são exatamente as regras que o briefing anunciava: uma mudança de um lado sem o outro quebra aqui', () => {
    expect(rulesFromSeason(params())).toEqual(ARENA_RULES);
  });

  it('capital, duração, posições, custo e horários vêm da temporada; o resto continua constante', () => {
    const rules = rulesFromSeason(
      params({
        capitalCents: 5_000_000,
        sessions: 5,
        maxPositions: 8,
        tradeCostBps: 5,
        decisionTimeBrt: '08:10',
        deadlineTimeBrt: '09:00',
      }),
    );
    expect(rules).toEqual({
      ...ARENA_RULES,
      starting_capital_cents: 5_000_000,
      season_sessions: 5,
      max_positions: 8,
      trade_cost_bps: 5,
      decision_time_brt: '08:10',
      decision_deadline_brt: '09:00',
    });
  });

  it('sem temporada RUNNING valem as regras da Temporada 1', () => {
    expect(rulesOfSeasons([])).toEqual(ARENA_RULES);
  });

  it('uma temporada, ou várias com os mesmos números, dão as regras dela', () => {
    expect(rulesOfSeasons([params({ sessions: 5 })]).season_sessions).toBe(5);
    expect(rulesOfSeasons([params({ sessions: 5 }), params({ sessions: 5 })]).season_sessions).toBe(
      5,
    );
  });

  it('duas temporadas RUNNING com regras diferentes: erro, porque o briefing do pregão é um só', () => {
    expect(() => rulesOfSeasons([params({ sessions: 5 }), params({ sessions: 20 })])).toThrow(
      /regras diferentes/,
    );
  });
});
