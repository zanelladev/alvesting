import { seasonParamsSchema, type QueueMessage } from '@alvesting/contracts';
import { Logger } from '@nestjs/common';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { newId } from '../../../common/id.js';
import type { SeasonRow } from '../../arena/infrastructure/arena.repository.js';
import { loadTradingCalendar } from '../../market-data/domain/trading-calendar.js';
import { SettlementPublishError, SettlementPublisher } from './settlement-publisher.js';

beforeAll(() => {
  Logger.overrideLogger(false);
});

// Quem recebe o aviso do eod (os pregões cujas barras acabaram de mudar) e publica a liquidação das temporadas que os têm. Tudo
// falso: a idempotência do job_run e a fila de verdade ficam em settle.handler.integration.spec.ts e messaging.
const calendar = loadTradingCalendar();

function season(
  slug: string,
  status: SeasonRow['status'],
  startDate: string | null,
  sessions = 5,
): SeasonRow {
  return {
    id: newId(),
    slug,
    name: slug,
    status,
    startDate,
    params: seasonParamsSchema.parse({ sessions, randomSeed: 'a', monteCarloSeed: 'b' }),
    promptSha256: null,
  };
}

function setup(seasons: SeasonRow[]) {
  const calls: string[] = [];
  const published: QueueMessage[] = [];
  const reopened: QueueMessage[] = [];
  const deps = {
    seasons: { seasonsInPlay: vi.fn(() => Promise.resolve(seasons)) },
    jobs: {
      reopen: vi.fn((message: QueueMessage, _reason: string) => {
        calls.push(`reopen:${message.type === 'settle' ? message.date : '?'}`);
        reopened.push(message);
        return Promise.resolve(true);
      }),
    },
    messaging: {
      publish: vi.fn((message: QueueMessage) => {
        calls.push(`publish:${message.type === 'settle' ? message.date : '?'}`);
        published.push(message);
        return Promise.resolve();
      }),
    },
    calendar,
  };
  return { publisher: new SettlementPublisher(deps), deps, calls, published, reopened };
}

const settle = (seasonId: string, date: string): QueueMessage => ({
  type: 'settle',
  seasonId,
  date,
});

describe('SettlementPublisher.afterEod', () => {
  it('publica um settle para cada temporada em andamento que tem o pregão, com a data dele', async () => {
    const a = season('a', 'RUNNING', '2026-11-03');
    const b = season('b', 'RUNNING', '2026-11-04');
    const t = setup([a, b]);
    await expect(t.publisher.afterEod(['2026-11-05'])).resolves.toEqual([
      settle(a.id, '2026-11-05'),
      settle(b.id, '2026-11-05'),
    ]);
    expect(t.published).toEqual([settle(a.id, '2026-11-05'), settle(b.id, '2026-11-05')]);
    expect(t.deps.jobs.reopen).not.toHaveBeenCalled();
  });

  it('não publica para a temporada que ainda não começou, para o rascunho nem para a que já passou do último pregão', async () => {
    const early = season('comeca-depois', 'RUNNING', '2026-11-09');
    const draft = season('rascunho', 'DRAFT', null);
    // 5 pregões a partir de 01/10: 01, 02, 05, 06 e 07 (o 12/10 é feriado). 05/11 já é bem depois do último
    const over = season('acabou', 'FINISHED', '2026-10-01');
    const t = setup([early, draft, over]);
    await expect(t.publisher.afterEod(['2026-11-05'])).resolves.toEqual([]);
    expect(t.deps.messaging.publish).not.toHaveBeenCalled();
  });

  it('o último pregão da temporada ainda é dela; o seguinte não', async () => {
    const s = season('s', 'RUNNING', '2026-11-03');
    const t = setup([s]);
    expect(await t.publisher.afterEod(['2026-11-09'])).toEqual([settle(s.id, '2026-11-09')]);
    expect(await t.publisher.afterEod(['2026-11-10'])).toEqual([]);
  });

  it('com um pregão anterior que a brapi só entregou agora, pede uma liquidação por temporada, pela data mais nova dela', async () => {
    const running = season('em-andamento', 'RUNNING', '2026-11-03');
    const finished = season('encerrada', 'FINISHED', '2026-10-01', 5); // 01, 02, 05, 06 e 07/10
    const t = setup([running, finished]);
    // o eod de 05/11 confirmou o dia e, junto, o de 04/11 (a noite em que a brapi esteve fora) e o de 06/10 (da encerrada)
    const messages = await t.publisher.afterEod(['2026-10-06', '2026-11-04', '2026-11-05']);
    expect(messages).toEqual([settle(running.id, '2026-11-05'), settle(finished.id, '2026-10-06')]);
  });

  it('nunca reabre a liquidação já feita: o eod não muda resultado liquidado sozinho (reprocessar é decisão do admin)', async () => {
    const a = season('a', 'RUNNING', '2026-11-03');
    const b = season('b', 'RUNNING', '2026-11-03');
    const t = setup([a, b]);
    await t.publisher.afterEod(['2026-11-05']);
    expect(t.calls).toEqual(['publish:2026-11-05', 'publish:2026-11-05']);
    expect(t.deps.jobs.reopen).not.toHaveBeenCalled();
  });

  it('sem nenhuma temporada, nada a publicar', async () => {
    const t = setup([]);
    await expect(t.publisher.afterEod(['2026-11-05'])).resolves.toEqual([]);
    expect(t.deps.messaging.publish).not.toHaveBeenCalled();
  });

  it('uma publicação que falha não impede as outras, e o erro sobe no fim para o eod tentar de novo', async () => {
    const a = season('a', 'RUNNING', '2026-11-03');
    const b = season('b', 'RUNNING', '2026-11-03');
    const t = setup([a, b]);
    t.deps.messaging.publish.mockImplementationOnce(() =>
      Promise.reject(new Error('Service Bus fora')),
    );
    await expect(t.publisher.afterEod(['2026-11-05'])).rejects.toThrow(/1 de 2.*Service Bus fora/s);
    expect(t.published).toEqual([settle(b.id, '2026-11-05')]);
  });

  it('o eod também sobe SettlementPublishError quando uma publicação falha (é o mesmo caminho)', async () => {
    const a = season('a', 'RUNNING', '2026-11-03');
    const t = setup([a]);
    t.deps.messaging.publish.mockImplementationOnce(() => Promise.reject(new Error('fora')));
    await expect(t.publisher.afterEod(['2026-11-05'])).rejects.toBeInstanceOf(
      SettlementPublishError,
    );
  });
});

// O evento corporativo da api (POST /admin/corporate-events): a api não liquida (o papel do Postgres dela não escreve nas tabelas de
// resultado), então enfileira. Cada temporada que já liquidou até a data ex é liquidada de novo até o pregão que ela tinha liquidado.
describe('SettlementPublisher.resettle', () => {
  const reason = 'evento corporativo BBB4 (2026-11-05): liquidar de novo';

  it('reabre o job de cada temporada ANTES de publicar a settle dela, com o motivo e o pregão que ela tinha liquidado', async () => {
    const a = season('a', 'RUNNING', '2026-11-03');
    const b = season('b', 'FINISHED', '2026-10-01');
    const t = setup([]);
    await expect(
      t.publisher.resettle(
        [
          { seasonId: a.id, date: '2026-11-09' },
          { seasonId: b.id, date: '2026-10-07' },
        ],
        reason,
      ),
    ).resolves.toEqual([settle(a.id, '2026-11-09'), settle(b.id, '2026-10-07')]);
    expect(t.calls).toEqual([
      'reopen:2026-11-09',
      'publish:2026-11-09',
      'reopen:2026-10-07',
      'publish:2026-10-07',
    ]);
    expect(t.reopened).toEqual([settle(a.id, '2026-11-09'), settle(b.id, '2026-10-07')]);
    expect(t.deps.jobs.reopen.mock.calls.map((call) => call[1])).toEqual([reason, reason]);
    // não consulta temporada nem calendário: quem chama já decidiu quais e até quando
    expect(t.deps.seasons.seasonsInPlay).not.toHaveBeenCalled();
  });

  it('sem temporada para refazer, nada é publicado', async () => {
    const t = setup([]);
    await expect(t.publisher.resettle([], reason)).resolves.toEqual([]);
    expect(t.deps.jobs.reopen).not.toHaveBeenCalled();
    expect(t.deps.messaging.publish).not.toHaveBeenCalled();
  });

  it('uma publicação que falha não impede as outras, e o erro (SettlementPublishError) sobe no fim: repetir é seguro', async () => {
    const a = season('a', 'RUNNING', '2026-11-03');
    const b = season('b', 'RUNNING', '2026-11-03');
    const t = setup([]);
    t.deps.messaging.publish.mockImplementationOnce(() =>
      Promise.reject(new Error('Service Bus fora')),
    );
    const failure = await t.publisher
      .resettle(
        [
          { seasonId: a.id, date: '2026-11-09' },
          { seasonId: b.id, date: '2026-11-09' },
        ],
        reason,
      )
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SettlementPublishError);
    expect((failure as Error).message).toMatch(/1 de 2.*Service Bus fora/s);
    expect(t.published).toEqual([settle(b.id, '2026-11-09')]);
  });

  it('se não dá para reabrir o job, a settle daquela temporada não sai', async () => {
    const a = season('a', 'RUNNING', '2026-11-03');
    const t = setup([]);
    t.deps.jobs.reopen.mockImplementationOnce(() => Promise.reject(new Error('banco fora')));
    await expect(
      t.publisher.resettle([{ seasonId: a.id, date: '2026-11-09' }], reason),
    ).rejects.toThrow(/banco fora/);
    expect(t.deps.messaging.publish).not.toHaveBeenCalled();
  });
});
