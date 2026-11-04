import { QUEUES } from '@alvesting/contracts';
import { describe, expect, it } from 'vitest';
import { loadTradingCalendar } from '../modules/market-data/domain/trading-calendar.js';
import { buildMarket } from './market.js';
import { createWorld } from './world.js';

// A montagem do ensaio repete a dos módulos Nest (market-data, news, briefing, arena, settlement e maintenance). Se uma fila ou um agendador novo entrar
// em src/role.ts e não entrar aqui, o ensaio deixaria de cobri-lo em silêncio: este teste cai antes.
describe('createWorld: o que o ensaio liga', () => {
  const calendar = loadTradingCalendar();
  // só a montagem: nenhum repositório consulta nada até alguém entregar uma mensagem
  const world = createWorld({
    prisma: {} as never,
    blob: {} as never,
    seed: 1,
    market: buildMarket({ seed: 1, stocks: 8, firstDay: '2026-11-03', sessions: 3, calendar }),
    calendar,
    start: new Date('2026-11-01T12:00:00Z'),
  });

  it('liga todas as filas que têm handler em produção: as seis, a maintenance inclusive (retention e backup-verify, etapa 10)', () => {
    expect([...world.queues].sort()).toEqual(Object.keys(QUEUES).sort());
  });

  it('tem os sete agendadores que os jobs rodam, retention e backup inclusive', () => {
    expect(Object.keys(world.schedulers).sort()).toEqual([
      'backup',
      'briefing',
      'cycle',
      'eod',
      'news',
      'retention',
      'universe',
    ]);
  });
});
