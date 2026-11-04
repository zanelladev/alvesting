import { Logger } from '@nestjs/common';
import { JobBusyError, type JobRunStore } from '../../messaging/infrastructure/job-run.store.js';
import { brasiliaDate, isoWeekMonday } from '../domain/dates.js';
import type { TradingCalendar } from '../domain/trading-calendar.js';
import { UNIVERSE_RULES, selectUniverse } from '../domain/universe.js';
import type { MarketRepository } from '../infrastructure/market.repository.js';
import type { UniverseRepository } from '../infrastructure/universe.repository.js';
import type { WeeklyRefresh } from './weekly-refresh.js';

export type UniverseOutcome = 'created' | 'exists' | 'already_done';

// A mensagem `universe {semana}` (plano 2 e 5.5): até 500 ações por volume financeiro médio dos últimos 60
// pregões, com presença em pelo menos 90% deles, congelado na semana ISO. A janela são os 60 pregões antes da
// segunda-feira da semana, e eles têm de estar todos confirmados: um universo calculado com buraco ficaria
// congelado errado. O volume é o das barras da brapi, estimado (quantidade x fechamento; docs/DADOS.md, seção 8). Antes de escolher, a
// atualização semanal (weekly-refresh.ts) semeia papel novo e dá a semana aos candidatos fora do conjunto diário; o 5º argumento é opcional
// porque o comando market:universe escolhe sobre o que o banco já tem, sem rede.
export class UniverseHandler {
  private readonly logger = new Logger(UniverseHandler.name);

  constructor(
    private readonly jobs: Pick<JobRunStore, 'claim' | 'succeed' | 'fail'>,
    private readonly calendar: Pick<
      TradingCalendar,
      'tradingDaysBefore' | 'tradingDaysBetween' | 'lastDay'
    >,
    private readonly market: Pick<MarketRepository, 'seedCalendar'>,
    private readonly universe: Pick<
      UniverseRepository,
      'confirmedDaysBetween' | 'volumeStats' | 'saveSnapshot'
    >,
    private readonly weekly?: Pick<WeeklyRefresh, 'run'>,
  ) {}

  async execute(week: string, now: Date = new Date()): Promise<UniverseOutcome> {
    const message = { type: 'universe', week } as const;
    const claimed = await this.jobs.claim(message);
    if (claimed.status === 'done') return 'already_done';
    if (claimed.status === 'busy') throw new JobBusyError(message);

    try {
      const monday = isoWeekMonday(week);
      await this.market.seedCalendar(
        this.calendar.tradingDaysBetween(monday, this.calendar.lastDay),
      );
      await this.weekly?.run(monday, brasiliaDate(now));

      const { windowDays } = UNIVERSE_RULES;
      const expected = this.calendar.tradingDaysBefore(monday, windowDays);
      const confirmed = await this.universe.confirmedDaysBetween(expected[0]!, monday);
      this.assertWindow(week, expected, confirmed);

      const stats = await this.universe.volumeStats(confirmed);
      const selection = selectUniverse(stats, confirmed.length);
      if (selection.members.length === 0) {
        throw new Error(
          `Nenhuma ação passou nos filtros para a semana ${week}; o universo não é congelado vazio`,
        );
      }
      const saved = await this.universe.saveSnapshot({
        week,
        windowStart: confirmed[0]!,
        windowEnd: confirmed[confirmed.length - 1]!,
        windowDays: confirmed.length,
        selection,
      });
      this.logger.log(
        {
          week,
          saved,
          window: [confirmed[0], confirmed[confirmed.length - 1]],
          candidates: selection.candidates,
          eligible: selection.eligible,
          members: selection.members.length,
        },
        'universo da semana',
      );
      await this.jobs.succeed(claimed.claim);
      return saved;
    } catch (error) {
      await this.jobs.fail(claimed.claim, error);
      throw error;
    }
  }

  // O calendário diz quais são os 60 pregões; o banco tem de ter todos confirmados.
  private assertWindow(week: string, expected: string[], confirmed: string[]): void {
    const have = new Set(confirmed);
    const want = new Set(expected);
    const missing = expected.filter((day) => !have.has(day));
    const unexpected = confirmed.filter((day) => !want.has(day));
    if (missing.length === 0 && unexpected.length === 0) return;
    const parts: string[] = [];
    if (missing.length > 0) {
      parts.push(
        `faltam ${missing.length} pregões confirmados (${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', ...' : ''}); rode a carga inicial da brapi: pnpm --filter @alvesting/api market:backfill (docs/RUNBOOK.md)`,
      );
    }
    if (unexpected.length > 0) {
      parts.push(
        `há pregão confirmado em dia que o calendário não conta como pregão (${unexpected.join(', ')}); confira b3-holidays.json`,
      );
    }
    throw new Error(`Janela do universo de ${week} incompleta: ${parts.join('; ')}`);
  }
}
