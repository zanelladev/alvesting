import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadTradingCalendar } from '../../market-data/domain/trading-calendar.js';
import { initialPortfolio } from '../domain/own-part.js';
import { settledPortfolioReader, type PortfolioQuery } from './portfolio.js';

// A carteira que o decide lê (etapa 7): a da última liquidação antes do pregão. O banco de verdade está em
// arena.repository.integration.spec.ts (a consulta) e em decide.handler.integration.spec.ts (o caminho todo).
afterEach(() => {
  vi.restoreAllMocks();
});

const calendar = loadTradingCalendar();
// o terceiro pregão da temporada (começou em 03/11)
const query: PortfolioQuery = {
  seasonId: 'S',
  competitorId: 'C',
  date: '2026-11-05',
  startDate: '2026-11-03',
  capitalCents: 10_000_000,
};

function reader(
  last: Awaited<ReturnType<Parameters<typeof settledPortfolioReader>[0]['repo']['lastPortfolio']>>,
) {
  const repo = { lastPortfolio: vi.fn(() => Promise.resolve(last)) };
  return { read: settledPortfolioReader({ repo, calendar }), repo };
}

describe('settledPortfolioReader', () => {
  it('sem nenhuma liquidação antes do pregão (o primeiro da temporada), a carteira inicial: caixa igual ao capital, sem aviso', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { read, repo } = reader(null);
    const first = { ...query, date: '2026-11-03' };
    await expect(read(first)).resolves.toEqual(initialPortfolio(10_000_000));
    expect(repo.lastPortfolio).toHaveBeenCalledWith('S', 'C', '2026-11-03');
    expect(warn).not.toHaveBeenCalled();
  });

  // A liquidação do dia 1 falhou (ou nunca rodou): o modelo decide com o caixa igual ao capital num pregão que não é o primeiro. O
  // aviso é o mesmo da liquidação atrasada que existe, e o ciclo não é pulado (docs/METODOLOGIA.md, "Carteira da decisão atrasada").
  it('sem nenhuma liquidação num pregão que não é o primeiro da temporada: decide com a carteira inicial, mas avisa', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { read } = reader(null);
    await expect(read(query)).resolves.toEqual(initialPortfolio(10_000_000));
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        settledThrough: null,
        expected: '2026-11-04',
        date: '2026-11-05',
        competitorId: 'C',
      }),
      expect.stringContaining('carteira'),
    );
  });

  it('com liquidação, o caixa e as posições dela; o preço médio é o custo dividido pela quantidade, no centavo mais próximo', async () => {
    const { read } = reader({
      date: '2026-11-04',
      cashCents: 497_866n,
      positions: [
        { ticker: 'AAA3', quantity: 43n, costCents: 98_929n }, // 2.300,69... -> 2.301
        { ticker: 'CCC3', quantity: 251n, costCents: 253_586n }, // 1.010,30... -> 1.010
        { ticker: 'BBB4', quantity: 2n, costCents: 5n }, // 2,5 -> 3 (o meio sobe)
      ],
    });
    await expect(read(query)).resolves.toEqual({
      cashCents: 497_866n,
      positions: [
        { ticker: 'AAA3', quantity: 43n, avgPriceCents: 2_301n },
        { ticker: 'CCC3', quantity: 251n, avgPriceCents: 1_010n },
        { ticker: 'BBB4', quantity: 2n, avgPriceCents: 3n },
      ],
    });
  });

  it('a liquidação do pregão anterior não avisa nada', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { read } = reader({ date: '2026-11-04', cashCents: 1n, positions: [] });
    await read(query);
    expect(warn).not.toHaveBeenCalled();
  });

  it('a liquidação mais nova é mais velha que o pregão anterior: decide com ela mesmo assim, mas avisa quais datas', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { read } = reader({ date: '2026-11-03', cashCents: 1n, positions: [] });
    await expect(read(query)).resolves.toEqual({ cashCents: 1n, positions: [] });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        settledThrough: '2026-11-03',
        expected: '2026-11-04',
        date: '2026-11-05',
      }),
      expect.stringContaining('carteira'),
    );
  });
});
