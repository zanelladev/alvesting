import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { ArenaWorld } from '../ensaio/world.js';
import type { PrismaService } from '../infrastructure/database/prisma.service.js';
import { loadTradingCalendar } from '../modules/market-data/domain/trading-calendar.js';
import type { LoadedPrompt } from './pieces.js';
import { parseDatedSeasonFile } from './plan.js';
import { runRetro } from './retro.js';

// A trava do --ate (RUNBOOK, 13.2), sem banco e sem rede: o retroativo de hoje gravaria a barra parcial do dia na daily_bar, que é só inserção.
// O banco, o motor e o prompt são armadilhas: o primeiro toque em qualquer um deles diz que a execução passou da trava. O fluxo inteiro, com o
// Postgres e o Azurite, está em retro.integration.spec.ts.
const dated = parseDatedSeasonFile(
  JSON.parse(readFileSync(new URL('../../seasons/temporada-1.json', import.meta.url), 'utf8')),
);
const calendar = loadTradingCalendar();

const trap = <T extends object>(name: string): T =>
  new Proxy({} as T, {
    get: (_target, key) => {
      throw new Error(`${name}.${String(key)}: passou da trava`);
    },
  });

function attempt(until: string, now: string) {
  const sources = { bars: vi.fn(), bcb: { run: vi.fn() }, cvm: { backfill: vi.fn() } };
  const run = runRetro({
    prisma: trap<PrismaService>('prisma'),
    world: trap<ArenaWorld>('world'),
    calendar,
    dated,
    prompt: trap<LoadedPrompt>('prompt'),
    until,
    capUsd: '30',
    sources,
    wallClock: () => new Date(now),
    log: () => undefined,
  });
  return { run, sources };
}

const refused = (until: string, today: string) =>
  `--ate ${until} recusado: o último dia tem de ser de antes de hoje (${today}, no fuso de São Paulo)`;

describe('runRetro: o --ate é de antes de hoje, no fuso de São Paulo', () => {
  const NOON = '2026-11-18T15:00:00Z'; // 12:00 de 18/11/2026 em Brasília

  it.each([
    ['hoje', '2026-11-18'],
    ['amanhã', '2026-11-19'],
  ])('%s é recusado antes do banco, do motor e das fontes', async (_label, until) => {
    const { run, sources } = attempt(until, NOON);
    await expect(run).rejects.toThrow(refused(until, '2026-11-18'));
    expect(sources.bars).not.toHaveBeenCalled();
    expect(sources.bcb.run).not.toHaveBeenCalled();
    expect(sources.cvm.backfill).not.toHaveBeenCalled();
  });

  it('ontem passa da trava', async () => {
    await expect(attempt('2026-11-17', NOON).run).rejects.toThrow(/passou da trava/);
  });

  it('o dia vira à meia-noite de Brasília (03:00 UTC), e não à de UTC', async () => {
    // 23:59:59 de 17/11 em Brasília, já 18/11 em UTC: hoje ainda é 17/11
    await expect(attempt('2026-11-17', '2026-11-18T02:59:59Z').run).rejects.toThrow(
      refused('2026-11-17', '2026-11-17'),
    );
    // a meia-noite de 18/11 em Brasília: 17/11 virou ontem
    await expect(attempt('2026-11-17', '2026-11-18T03:00:00Z').run).rejects.toThrow(
      /passou da trava/,
    );
  });
});
