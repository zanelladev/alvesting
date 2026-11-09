import { describe, expect, it, vi } from 'vitest';
import { loadTradingCalendar } from '../../market-data/domain/trading-calendar.js';
import { seasonFile } from '../testing/arena.fixture.js';
import { SeasonFileError, SeasonRunningExistsError, SeasonService } from './season.service.js';

function setup(startResult: 'started' | 'not_found' | 'not_draft' | 'running_exists' = 'started') {
  const repo = {
    createSeason: vi.fn(() => Promise.resolve('01K0000000000000000000000A')),
    startSeason: vi.fn(() => Promise.resolve(startResult)),
    seasonById: vi.fn(() => Promise.resolve({ slug: 'temporada-teste' })),
  };
  return { repo, service: new SeasonService(repo as never, loadTradingCalendar()) };
}

describe('SeasonService.create (season:create <arquivo.json>)', () => {
  it('valida o arquivo inteiro, aplica os padrões e grava', async () => {
    const t = setup();
    const raw: unknown = JSON.parse(
      JSON.stringify({ ...seasonFile(), params: { randomSeed: 'a', monteCarloSeed: 'b' } }),
    );
    const created = await t.service.create(raw);
    expect(created).toEqual({
      id: '01K0000000000000000000000A',
      slug: 'temporada-teste',
      models: 3,
    });
    const saved = (
      t.repo.createSeason.mock.calls[0] as unknown as [
        { params: { capitalCents: number; sessions: number } },
      ]
    )[0];
    expect(saved.params).toMatchObject({ capitalCents: 10_000_000, sessions: 20 });
  });

  it('arquivo inválido: lista os campos errados e não grava nada', async () => {
    const t = setup();
    const bad = { ...seasonFile(), competitors: seasonFile().competitors.slice(0, 3) };
    const error = await t.service.create(bad).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SeasonFileError);
    expect((error as Error).message).toMatch(/Sorteio/);
    expect(t.repo.createSeason).not.toHaveBeenCalled();
  });

  it('não repete o valor de um campo que não devia estar ali (um segredo posto no arquivo por engano)', async () => {
    const t = setup();
    const withKey = { ...seasonFile(), openrouterApiKey: 'sk-or-chave-secreta-123' };
    const error = await t.service.create(withKey).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SeasonFileError);
    expect((error as Error).message).toContain('openrouterApiKey');
    expect((error as Error).message).not.toContain('sk-or-chave-secreta-123');
  });

  it('JSON que não é um objeto também é recusado', async () => {
    const t = setup();
    await expect(t.service.create('texto')).rejects.toBeInstanceOf(SeasonFileError);
    await expect(t.service.create(null)).rejects.toBeInstanceOf(SeasonFileError);
  });
});

describe('SeasonService.start (season:start <id>)', () => {
  it('fixa a data de início no próximo pregão: no domingo 01/11 é a terça 03/11 (02/11 é Finados)', async () => {
    const t = setup();
    const now = new Date('2026-11-01T20:00:00Z');
    await expect(t.service.start('01K0000000000000000000000A', now)).resolves.toEqual({
      id: '01K0000000000000000000000A',
      slug: 'temporada-teste',
      startDate: '2026-11-03',
    });
    // sem auditoria nem opção (o comando): o repositório recebe só o que o comando sempre mandou
    expect(t.repo.startSeason).toHaveBeenCalledWith(
      '01K0000000000000000000000A',
      '2026-11-03',
      now,
      undefined,
      undefined,
    );
  });

  it('a data de hoje nunca é a de início: numa terça, a temporada começa na quarta', async () => {
    const t = setup();
    await t.service.start('01K0000000000000000000000A', new Date('2026-11-03T09:00:00Z'));
    expect(t.repo.startSeason).toHaveBeenCalledWith(
      expect.anything(),
      '2026-11-04',
      expect.anything(),
      undefined,
      undefined,
    );
  });

  it('o dia é o de Brasília: 22h de segunda em Brasília já é terça em UTC, e o próximo pregão é a quarta', async () => {
    const t = setup();
    // 03/11 23:00 em Brasília = 04/11 02:00 UTC
    await t.service.start('01K0000000000000000000000A', new Date('2026-11-04T02:00:00Z'));
    expect(t.repo.startSeason).toHaveBeenCalledWith(
      expect.anything(),
      '2026-11-04',
      expect.anything(),
      undefined,
      undefined,
    );
  });

  it('temporada que não existe, ou que já saiu do rascunho, falha com a causa', async () => {
    await expect(
      setup('not_found').service.start('01K0000000000000000000000A', new Date()),
    ).rejects.toThrow(/não existe/);
    await expect(
      setup('not_draft').service.start('01K0000000000000000000000A', new Date()),
    ).rejects.toThrow(/rascunho/);
  });

  it('com outra temporada em andamento (só se o repositório recusou) falha com o tipo próprio', async () => {
    await expect(
      setup('running_exists').service.start('01K0000000000000000000000A', new Date()),
    ).rejects.toBeInstanceOf(SeasonRunningExistsError);
  });
});

// A trilha de auditoria das rotas /admin (etapa 10, parte 2): o ator vai junto até o repositório, que a grava na mesma transação.
describe('a auditoria acompanha o create e o start', () => {
  const audit = { actor: 'admin:01JABCDEFGHJKMNPQRSTVWXYZ0', action: 'admin.season.create' };

  it('create entrega a auditoria ao repositório; sem ela (o comando) o repositório não recebe nada a mais', async () => {
    const t = setup();
    await t.service.create(seasonFile(), audit);
    expect(t.repo.createSeason.mock.calls[0]).toEqual([expect.anything(), audit]);
    await t.service.create(seasonFile());
    expect(t.repo.createSeason.mock.calls[1]).toEqual([expect.anything(), undefined]);
  });

  it('o arquivo inválido não grava nem audita', async () => {
    const t = setup();
    await expect(t.service.create({ ...seasonFile(), competitors: [] }, audit)).rejects.toThrow();
    expect(t.repo.createSeason).not.toHaveBeenCalled();
  });

  it('start entrega a auditoria e a opção exclusiva ao repositório', async () => {
    const t = setup();
    const now = new Date('2026-11-01T20:00:00Z');
    await t.service.start(
      '01K0000000000000000000000A',
      now,
      { ...audit, action: 'admin.season.start' },
      { exclusive: true },
    );
    expect(t.repo.startSeason).toHaveBeenCalledWith(
      '01K0000000000000000000000A',
      '2026-11-03',
      now,
      { ...audit, action: 'admin.season.start' },
      { exclusive: true },
    );
  });

  it('o arquivo com data fixa (temporada-1.json) não é do season:create: o erro diz para usar o arena:retroativo', async () => {
    const t = setup();
    await expect(t.service.create({ slug: 'x', startDate: '2026-10-13' })).rejects.toThrow(
      /arena:retroativo/,
    );
  });

  // O arena:retroativo (ADR 0038): a Temporada 1 começa na data do arquivo (13/10/2026, que já passou) e fixa o SHA-256 do prompt.
  it('a data fixa do arquivo vence o próximo pregão, e o SHA-256 do prompt segue para a gravação', async () => {
    const t = setup();
    const now = new Date('2026-11-06T15:00:00Z');
    const started = await t.service.start('01K0000000000000000000000A', now, undefined, {
      startDate: '2026-10-13',
      promptSha256: 'f'.repeat(64),
    });
    expect(started.startDate).toBe('2026-10-13');
    expect(t.repo.startSeason).toHaveBeenCalledWith(
      '01K0000000000000000000000A',
      '2026-10-13',
      now,
      undefined,
      { promptSha256: 'f'.repeat(64) },
    );
  });

  it('a data fixa tem de ser pregão: o feriado de 12/10 e o sábado são recusados antes de gravar', async () => {
    const t = setup();
    for (const day of ['2026-10-12', '2026-10-17']) {
      await expect(
        t.service.start('01K0000000000000000000000A', new Date(), undefined, { startDate: day }),
      ).rejects.toThrow(`startDate: ${day} não é pregão da B3`);
    }
    expect(t.repo.startSeason).not.toHaveBeenCalled();
  });
});
