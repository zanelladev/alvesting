import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  integrationTitle,
  openTestDatabase,
  testDatabaseUrl,
} from '../../../infrastructure/database/test-database.fixture.js';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import { MacroRepository } from './macro.repository.js';

describe.skipIf(!testDatabaseUrl)(integrationTitle('MacroRepository'), () => {
  let prisma: PrismaService;
  let repo: MacroRepository;

  beforeAll(async () => {
    prisma = await openTestDatabase(testDatabaseUrl!);
    repo = new MacroRepository(prisma);
  }, 120_000);

  beforeEach(async () => {
    await prisma.macroDaily.deleteMany();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  const points = [
    { date: '2026-10-28', value: '0.050788' },
    { date: '2026-10-29', value: '0.050788' },
  ];

  it('grava os pontos da série com a data do valor, sem perder casa decimal', async () => {
    await expect(repo.savePoints('cdi_daily_pct', points)).resolves.toBe(2);
    const rows = await prisma.macroDaily.findMany({ orderBy: { date: 'asc' } });
    expect(
      rows.map((r) => [r.series, r.date.toISOString().slice(0, 10), r.value.toFixed(6)]),
    ).toEqual([
      ['cdi_daily_pct', '2026-10-28', '0.050788'],
      ['cdi_daily_pct', '2026-10-29', '0.050788'],
    ]);
  });

  it('o mesmo ponto de novo não escreve nada; valor revisado pela fonte atualiza', async () => {
    await repo.savePoints('cdi_daily_pct', points);
    await expect(repo.savePoints('cdi_daily_pct', points)).resolves.toBe(0);
    await expect(
      repo.savePoints('cdi_daily_pct', [{ date: '2026-10-29', value: '0.050789' }]),
    ).resolves.toBe(1);
    expect(await prisma.macroDaily.count()).toBe(2);
  });

  it('séries diferentes na mesma data não se misturam', async () => {
    await repo.savePoints('cdi_daily_pct', [{ date: '2026-10-29', value: '0.050788' }]);
    await repo.savePoints('usd_brl_ptax_sell', [{ date: '2026-10-29', value: '5.3744' }]);
    expect(await prisma.macroDaily.count()).toBe(2);
  });

  it('valor negativo (deflação) é guardado', async () => {
    await repo.savePoints('ipca_month_pct', [{ date: '2026-08-01', value: '-0.32' }]);
    expect((await prisma.macroDaily.findFirstOrThrow()).value.toFixed(2)).toBe('-0.32');
  });

  it('lista vazia não faz nada', async () => {
    await expect(repo.savePoints('cdi_daily_pct', [])).resolves.toBe(0);
  });

  it('lastDates devolve a última data guardada de cada série', async () => {
    await repo.savePoints('cdi_daily_pct', points);
    await repo.savePoints('ipca_month_pct', [{ date: '2026-09-01', value: '0.82' }]);
    const last = await repo.lastDates();
    expect(last.get('cdi_daily_pct')).toBe('2026-10-29');
    expect(last.get('ipca_month_pct')).toBe('2026-09-01');
    expect(last.has('selic_target_pct_year')).toBe(false);
  });

  it('o banco recusa nome de série fora do padrão', async () => {
    await expect(repo.savePoints('CDI Diário', points)).rejects.toThrow();
  });
});
