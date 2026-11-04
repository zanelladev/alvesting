import { afterEach, describe, expect, it, vi } from 'vitest';

// A liquidação lê o CDI da série 12 do SGS pelo nome que a lista fixa do macro lhe dá (MACRO_SERIES). Se a série sair da lista, ler outra
// em silêncio daria um patrimônio errado e com cara de certo: o módulo não carrega, e o worker nem sobe (o erro aparece no boot).
afterEach(() => {
  vi.doUnmock('../../news/domain/bcb.js');
  vi.resetModules();
});

describe('a série do CDI da liquidação', () => {
  it('com a lista real do macro, o repositório carrega', async () => {
    vi.resetModules();
    await expect(import('./settlement.repository.js')).resolves.toHaveProperty(
      'SettlementRepository',
    );
  });

  it('sem a série 12 na lista do macro, o repositório não carrega e diz por quê', async () => {
    vi.resetModules();
    vi.doMock('../../news/domain/bcb.js', async (importOriginal) => {
      const original = await importOriginal<typeof import('../../news/domain/bcb.js')>();
      return {
        ...original,
        MACRO_SERIES: original.MACRO_SERIES.filter((series) => series.code !== 12),
      };
    });
    await expect(import('./settlement.repository.js')).rejects.toThrow(/série 12 do SGS/);
  });
});
