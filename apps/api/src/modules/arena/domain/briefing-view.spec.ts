import { describe, expect, it } from 'vitest';
import { syntheticBriefing, UNIVERSE } from '../testing/arena.fixture.js';
import { readBriefing } from './briefing-view.js';

describe('readBriefing: o que a decisão precisa do briefing congelado', () => {
  it('lê o pregão, o último dia de dados e a tabela do universo que o modelo recebeu', () => {
    const view = readBriefing(syntheticBriefing().bytes);
    expect(view.date).toBe('2026-11-03');
    expect(view.dataThrough).toBe('2026-10-30');
    expect(view.week).toBe('2026-W45');
    expect([...view.tickers].sort()).toEqual(UNIVERSE.map((row) => row.ticker).sort());
  });

  it.each([
    ['não é JSON', Buffer.from('não é json')],
    ['JSON de outro formato', Buffer.from(JSON.stringify({ format: 'outro/1' }))],
    [
      'tabela do universo sem ticker',
      Buffer.from(
        JSON.stringify({
          format: 'alvesting-briefing/1',
          date: '2026-11-03',
          data_through: '2026-10-30',
          universe: { week: '2026-W45', rows: [[42]] },
        }),
      ),
    ],
  ])('recusa briefing que %s, sem repetir o conteúdo na mensagem', (_nome, bytes) => {
    expect(() => readBriefing(bytes)).toThrow(/briefing/i);
    try {
      readBriefing(bytes);
    } catch (error) {
      expect((error as Error).message).not.toContain('não é json');
    }
  });
});
