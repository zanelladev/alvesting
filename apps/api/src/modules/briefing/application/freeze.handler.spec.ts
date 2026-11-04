import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { seasonParamsSchema, type QueueMessage, type SeasonParams } from '@alvesting/contracts';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { brasiliaInstant } from '../../market-data/domain/dates.js';
import { loadTradingCalendar } from '../../market-data/domain/trading-calendar.js';
import { JobBusyError, type ClaimResult } from '../../messaging/infrastructure/job-run.store.js';
import {
  IncompleteMarketDataError,
  LIMITS,
  type BarRow,
  type NewsRow,
} from '../domain/briefing.js';
import { FreezeHandler } from './freeze.handler.js';

beforeAll(() => {
  Logger.overrideLogger(false);
});

const calendar = loadTradingCalendar();
const DATE = '2026-10-30';
const SESSIONS = calendar.tradingDaysBefore(DATE, LIMITS.sessions);
const AFTER_CUTOFF = new Date('2026-10-30T10:30:05Z'); // 07:30:05 em Brasília
const CLAIM: ClaimResult = { status: 'claimed', claim: { id: 'job-f', attempt: 1 } };

const UNIVERSE = [
  { ticker: 'PETR4', name: 'PETROBRAS', position: 1, avgVolumeCents: 300n },
  { ticker: 'VALE3', name: 'VALE', position: 2, avgVolumeCents: 200n },
];
// barras de todos os pregões entre as duas datas, como o banco devolveria; o último fecha em alta (PETR4) ou em baixa
const bars = (ticker: string, from = SESSIONS[0]!, to = '2026-10-29'): BarRow[] =>
  calendar.tradingDaysBetween(from, to).map((date) => ({
    date,
    openCents: 1000n,
    highCents: 1100n,
    lowCents: 900n,
    closeCents: 1000n + BigInt(date === to ? (ticker === 'PETR4' ? 50 : -20) : 0),
    volumeCents: 1_000_000n,
  }));

function setup(
  options: {
    claim?: ClaimResult;
    existing?: { date: string; sha256: string; uri: string } | null;
    previous?: string | null;
    // o primeiro briefing já congelado depois do pregão (freeze fora de ordem)
    later?: string | null;
    universe?: typeof UNIVERSE | null;
    save?: 'created' | 'exists';
    // os parâmetros das temporadas RUNNING que já começaram no pregão (de onde saem as regras do briefing)
    seasons?: SeasonParams[];
    // o relógio da função da fila (handle); sem ele vale o da máquina
    clock?: () => Date;
  } = {},
) {
  const jobs = {
    claim: vi.fn((_message: QueueMessage) => Promise.resolve(options.claim ?? CLAIM)),
    succeed: vi.fn(() => Promise.resolve()),
    fail: vi.fn((_claim: unknown, _error: unknown) => Promise.resolve()),
  };
  let stored = options.existing ?? null;
  const repo = {
    find: vi.fn((_date: string) => Promise.resolve(stored)),
    latestBefore: vi.fn((_date: string) => Promise.resolve(options.previous ?? null)),
    firstAfter: vi.fn((_date: string) => Promise.resolve(options.later ?? null)),
    universe: vi.fn((_week: string) =>
      Promise.resolve(options.universe === undefined ? UNIVERSE : options.universe),
    ),
    bars: vi.fn((tickers: readonly string[], from: string, to: string) =>
      Promise.resolve(new Map(tickers.map((ticker) => [ticker, bars(ticker, from, to)]))),
    ),
    macro: vi.fn((_asOf: string) =>
      Promise.resolve([{ series: 'cdi_daily_pct', date: '2026-10-29', value: '0.050788' }]),
    ),
    news: vi.fn((_after: Date, _until: Date) => Promise.resolve([] as NewsRow[])),
    runningSeasons: vi.fn((_date: string) => Promise.resolve(options.seasons ?? [])),
    save: vi.fn((input: { date: string; sha256: string; uri: string; bytes: number }) => {
      const result = options.save ?? 'created';
      if (result === 'created') stored = { date: input.date, sha256: input.sha256, uri: input.uri };
      return Promise.resolve(result);
    }),
  };
  const archive = {
    save: vi.fn((date: string, _bytes: Buffer, sha256: string) =>
      Promise.resolve(`https://stalvesting.blob.core.windows.net/briefings/${date}/${sha256}.json`),
    ),
  };
  // a espera da folga é falsa: o teste vê quanto o handler pediu para esperar, sem esperar de verdade
  const sleep = vi.fn((_ms: number) => Promise.resolve());
  return {
    handler: new FreezeHandler(jobs, calendar, repo, archive, sleep, options.clock),
    jobs,
    repo,
    archive,
    sleep,
  };
}

describe('FreezeHandler: congela a entrada comum às 07:30', () => {
  it('monta o retrato do pregão, guarda os bytes no Blob e registra pregão, SHA-256 e URI', async () => {
    const t = setup();
    const result = await t.handler.execute(DATE, AFTER_CUTOFF);

    expect(result.outcome).toBe('frozen');
    expect(result.outcome === 'frozen' && /^[0-9a-f]{64}$/.test(result.sha256)).toBe(true);
    expect(t.jobs.claim).toHaveBeenCalledWith({ type: 'freeze', date: DATE });

    // o que foi lido: o universo da semana ISO do pregão, as barras dos 30 pregões até o fechamento anterior
    expect(t.repo.universe).toHaveBeenCalledWith('2026-W44');
    expect(t.repo.bars).toHaveBeenCalledWith(
      ['PETR4', 'VALE3', 'BOVA11'],
      SESSIONS[0],
      '2026-10-29',
    );
    expect(t.repo.macro).toHaveBeenCalledWith('2026-10-29');

    // o que foi guardado: os bytes e o SHA-256 dos bytes
    const [archivedDate, bytes, archivedSha] = t.archive.save.mock.calls[0]!;
    expect(archivedDate).toBe(DATE);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(archivedSha);
    expect(JSON.parse(bytes.toString('utf8'))).toMatchObject({
      date: DATE,
      data_through: '2026-10-29',
    });

    // o que foi registrado
    const [saved] = t.repo.save.mock.calls[0]!;
    expect(saved).toEqual({
      date: DATE,
      sha256: archivedSha,
      uri: `https://stalvesting.blob.core.windows.net/briefings/${DATE}/${archivedSha}.json`,
      bytes: bytes.length,
    });
    expect(t.jobs.succeed).toHaveBeenCalledTimes(1);
  });

  // valores sintéticos: só as sementes não têm padrão
  const seasonParams = (over: Record<string, unknown> = {}) =>
    seasonParamsSchema.parse({ randomSeed: 'semente-a', monteCarloSeed: 'semente-b', ...over });
  const rulesOf = (t: ReturnType<typeof setup>) =>
    (JSON.parse(t.archive.save.mock.calls[0]![1].toString('utf8')) as { rules: unknown }).rules;

  it('as regras do briefing vêm da temporada RUNNING que já começou no pregão', async () => {
    const t = setup({ seasons: [seasonParams({ sessions: 5, capitalCents: 5_000_000 })] });
    await t.handler.execute(DATE, AFTER_CUTOFF);
    expect(t.repo.runningSeasons).toHaveBeenCalledWith(DATE);
    expect(rulesOf(t)).toMatchObject({
      season_sessions: 5,
      starting_capital_cents: 5_000_000,
      max_orders_per_cycle: 5,
    });
  });

  it('sem temporada RUNNING o briefing leva as regras da Temporada 1 (o mesmo documento de antes)', async () => {
    const t = setup();
    await t.handler.execute(DATE, AFTER_CUTOFF);
    expect(rulesOf(t)).toMatchObject({ season_sessions: 20, starting_capital_cents: 10_000_000 });
  });

  it('duas temporadas RUNNING com regras diferentes: o freeze falha sem gravar nada (o briefing é um só)', async () => {
    const t = setup({ seasons: [seasonParams({ sessions: 5 }), seasonParams({ sessions: 20 })] });
    await expect(t.handler.execute(DATE, AFTER_CUTOFF)).rejects.toThrow(/regras diferentes/);
    expect(t.archive.save).not.toHaveBeenCalled();
    expect(t.repo.save).not.toHaveBeenCalled();
    expect(t.jobs.fail).toHaveBeenCalledTimes(1);
  });

  it('sem briefing anterior, as notícias vão do congelamento do pregão anterior (07:30) até o deste', async () => {
    const t = setup();
    await t.handler.execute(DATE, AFTER_CUTOFF);
    const [after, until] = t.repo.news.mock.calls[0]!;
    expect(after).toEqual(brasiliaInstant('2026-10-29', '07:30'));
    expect(until).toEqual(brasiliaInstant(DATE, '07:30'));
    expect(until.toISOString()).toBe('2026-10-30T10:30:00.000Z');
  });

  it('com briefing anterior, as notícias começam no congelamento dele (feriado e fim de semana no meio)', async () => {
    // segunda 02/11 é feriado: o briefing de terça 03/11 vem depois do de sexta 30/10
    const t = setup({ previous: '2026-10-30' });
    await t.handler.execute('2026-11-03', new Date('2026-11-03T10:31:00Z'));
    const [after, until] = t.repo.news.mock.calls[0]!;
    expect(after).toEqual(brasiliaInstant('2026-10-30', '07:30'));
    expect(until).toEqual(brasiliaInstant('2026-11-03', '07:30'));
  });

  it('um buraco longo entre briefings não puxa notícia de mais de 7 dias', async () => {
    const t = setup({ previous: '2026-09-01' });
    await t.handler.execute(DATE, AFTER_CUTOFF);
    const [after] = t.repo.news.mock.calls[0]!;
    expect(after).toEqual(new Date(brasiliaInstant(DATE, '07:30').getTime() - 7 * 86_400_000));
  });

  it('a mesma entrada dá o mesmo SHA-256 em duas montagens (reproduzível)', async () => {
    const a = setup();
    const b = setup();
    const first = await a.handler.execute(DATE, AFTER_CUTOFF);
    const second = await b.handler.execute(DATE, new Date('2026-10-30T11:45:00Z'));
    expect(
      first.outcome === 'frozen' && second.outcome === 'frozen' && first.sha256 === second.sha256,
    ).toBe(true);
  });
});

// O ensaio (arena:ensaio) entrega a mensagem pela função da fila com o relógio simulado: sem o relógio injetado, o handle usaria o da
// máquina, que no ensaio não é o do pregão simulado.
describe('FreezeHandler: a função da fila usa o relógio injetado', () => {
  it('depois do corte congela, como o worker faria às 07:30', async () => {
    const t = setup({ clock: () => AFTER_CUTOFF });
    await t.handler.handle({ type: 'freeze', date: DATE });
    expect(t.repo.save).toHaveBeenCalledOnce();
  });

  it('antes do corte a mesma mensagem falha (cedo demais): quem manda é o relógio injetado', async () => {
    const t = setup({ clock: () => new Date('2026-10-30T10:29:59Z') });
    await expect(t.handler.handle({ type: 'freeze', date: DATE })).rejects.toThrow(/cedo demais/i);
    expect(t.repo.save).not.toHaveBeenCalled();
  });
});

// A notícia é carimbada na hora da gravação, então uma carimbada até 07:30:00 já terminou de gravar quando a leitura
// começa, a não ser que a confirmação demore mais que a folga (10 s). O cron das 07:30 chega aqui segundos depois do corte.
describe('FreezeHandler: folga entre o corte e a leitura do banco', () => {
  it('chegou 5 s depois do corte: espera os 5 s que faltam para os 10 s, e só depois lê as notícias', async () => {
    const t = setup();
    await t.handler.execute(DATE, AFTER_CUTOFF); // 07:30:05
    expect(t.sleep).toHaveBeenCalledTimes(1);
    expect(t.sleep).toHaveBeenCalledWith(5000);
    expect(t.sleep.mock.invocationCallOrder[0]).toBeLessThan(
      t.repo.news.mock.invocationCallOrder[0]!,
    );
  });

  it('chegou exatamente no corte: espera a folga inteira', async () => {
    const t = setup();
    await t.handler.execute(DATE, new Date('2026-10-30T10:30:00Z'));
    expect(t.sleep).toHaveBeenCalledWith(10_000);
  });

  it('passada a folga (reenvio, retry, execução manual mais tarde), não espera', async () => {
    const t = setup();
    await t.handler.execute(DATE, new Date('2026-10-30T10:30:10Z'));
    expect(t.sleep).not.toHaveBeenCalled();
    const later = setup();
    await later.handler.execute(DATE, new Date('2026-10-30T12:00:00Z'));
    expect(later.sleep).not.toHaveBeenCalled();
  });

  it('antes do corte nem espera: falha, como antes', async () => {
    const t = setup();
    await expect(t.handler.execute(DATE, new Date('2026-10-30T10:29:59Z'))).rejects.toThrow(
      /cedo demais/i,
    );
    expect(t.sleep).not.toHaveBeenCalled();
  });
});

// Um briefing enorme aperta o contexto dos modelos e vira HOLD sem ninguém ver. O freeze não corta (é decisão da etapa 6),
// mas avisa no log, só com números.
describe('FreezeHandler: aviso de briefing grande', () => {
  const big = () => {
    const universe = Array.from({ length: 500 }, (_, i) => ({
      ticker: `Z${String(i).padStart(3, '0')}3`,
      name: `EMPRESA ${i}`,
      position: i + 1,
      avgVolumeCents: BigInt(1_000_000 - i),
    }));
    const t = setup({ universe });
    const sources = ['agencia-brasil', 'cvm-ipe', 'infomoney', 'money-times', 'seu-dinheiro'];
    t.repo.news.mockResolvedValue(
      Array.from({ length: 500 }, (_, i) => ({
        source: sources[i % 5]!,
        publishedAt: new Date(`2026-10-29T${String(12 + (i % 10)).padStart(2, '0')}:00:00Z`),
        title: `${String(i)} ${'ã'.repeat(290)}`,
        snippet: 'ã'.repeat(290),
        tickers: [],
        urlHash: i.toString(16).padStart(64, '0'),
      })),
    );
    return t;
  };

  it('acima de 300 KB avisa com o tamanho e a contagem, sem conteúdo de notícia', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      const result = await big().handler.execute(DATE, AFTER_CUTOFF);
      expect(result.outcome === 'frozen' && result.stats.bytes).toBeGreaterThan(300_000);
      const [fields, message] = warn.mock.calls[0]! as unknown as [Record<string, unknown>, string];
      expect(message).toMatch(/briefing grande/);
      expect(Object.keys(fields).sort()).toEqual(['bytes', 'date', 'newsItems']);
    } finally {
      warn.mockRestore();
    }
  });

  it('o briefing normal não avisa', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      await setup().handler.execute(DATE, AFTER_CUTOFF);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('FreezeHandler: idempotência (aceite do plano)', () => {
  it('freeze repetido do mesmo pregão não muda nada nem regrava o Blob', async () => {
    const t = setup();
    // o falso de claim devolve "claimed" sempre; o que barra a segunda é a linha de briefing, que é do pregão
    const first = await t.handler.execute(DATE, AFTER_CUTOFF);
    expect(first.outcome).toBe('frozen');
    t.archive.save.mockClear();
    t.repo.save.mockClear();
    t.repo.bars.mockClear();

    const second = await t.handler.execute(DATE, new Date('2026-10-30T12:00:00Z'));
    expect(second.outcome).toBe('already_done');
    expect(t.archive.save).not.toHaveBeenCalled();
    expect(t.repo.save).not.toHaveBeenCalled();
    expect(t.repo.bars).not.toHaveBeenCalled(); // nem remonta
    expect(t.jobs.succeed).toHaveBeenCalledTimes(2);
  });

  it('mensagem já concluída (job_run) não faz nada', async () => {
    const t = setup({ claim: { status: 'done' } });
    await expect(t.handler.execute(DATE, AFTER_CUTOFF)).resolves.toEqual({
      outcome: 'already_done',
    });
    expect(t.repo.find).not.toHaveBeenCalled();
    expect(t.archive.save).not.toHaveBeenCalled();
  });

  it('outra entrega em andamento: falha com JobBusyError, para a fila repetir', async () => {
    const t = setup({ claim: { status: 'busy' } });
    await expect(t.handler.execute(DATE, AFTER_CUTOFF)).rejects.toBeInstanceOf(JobBusyError);
    expect(t.archive.save).not.toHaveBeenCalled();
  });

  it('o processo caiu depois de gravar a linha: a repetição só conclui o job, sem regravar o Blob', async () => {
    const existing = { date: DATE, sha256: 'a'.repeat(64), uri: 'https://x/briefings/a.json' };
    const t = setup({ existing });
    await expect(t.handler.execute(DATE, AFTER_CUTOFF)).resolves.toEqual({
      outcome: 'already_done',
    });
    expect(t.archive.save).not.toHaveBeenCalled();
    expect(t.repo.save).not.toHaveBeenCalled();
    expect(t.jobs.succeed).toHaveBeenCalledTimes(1);
  });

  it('se outra entrega gravou a linha no meio (corrida), reconhece sem falhar', async () => {
    const t = setup({ save: 'exists' });
    await expect(t.handler.execute(DATE, AFTER_CUTOFF)).resolves.toEqual({
      outcome: 'already_done',
    });
    expect(t.jobs.succeed).toHaveBeenCalledTimes(1);
  });
});

describe('FreezeHandler: o que impede de congelar', () => {
  it('dia sem pregão: ignora, sem assumir a mensagem', async () => {
    const t = setup();
    await expect(t.handler.execute('2026-11-02', AFTER_CUTOFF)).resolves.toEqual({
      outcome: 'not_trading_day',
    });
    expect(t.jobs.claim).not.toHaveBeenCalled();
  });

  it('antes das 07:30 não congela: um congelamento precoce travaria dado velho para o dia todo', async () => {
    const t = setup();
    await expect(t.handler.execute(DATE, new Date('2026-10-30T10:29:59Z'))).rejects.toThrow(
      /cedo demais/i,
    );
    expect(t.archive.save).not.toHaveBeenCalled();
    expect(t.repo.save).not.toHaveBeenCalled();
    expect(t.jobs.fail).toHaveBeenCalledTimes(1);
  });

  // O briefing de um pregão posterior abre a janela de notícias no corte anterior a ele: congelar este depois repetiria as
  // notícias nos dois (revisão de banco). Reenvio da DLQ dias depois e `briefing:freeze <data passada>` caem aqui.
  it('briefing de um pregão posterior já congelado: falha dizendo qual, sem gravar nada', async () => {
    const t = setup({ later: '2026-11-03' });
    await expect(t.handler.execute(DATE, AFTER_CUTOFF)).rejects.toThrow(/2026-11-03.*em ordem/);
    expect(t.repo.news).not.toHaveBeenCalled();
    expect(t.archive.save).not.toHaveBeenCalled();
    expect(t.repo.save).not.toHaveBeenCalled();
    expect(t.jobs.fail).toHaveBeenCalledTimes(1);
  });

  it('o próprio pregão já congelado continua sendo "já feito", mesmo havendo um posterior', async () => {
    const existing = { date: DATE, sha256: 'a'.repeat(64), uri: 'https://x/b.json' };
    const t = setup({ existing, later: '2026-11-03' });
    await expect(t.handler.execute(DATE, AFTER_CUTOFF)).resolves.toEqual({
      outcome: 'already_done',
    });
  });

  it('sem universo congelado da semana, falha dizendo qual semana (não usa o de outra)', async () => {
    const t = setup({ universe: null });
    await expect(t.handler.execute(DATE, AFTER_CUTOFF)).rejects.toThrow(/2026-W44/);
    expect(t.archive.save).not.toHaveBeenCalled();
    expect(t.jobs.fail).toHaveBeenCalledTimes(1);
  });

  it('dados de mercado incompletos falham sem guardar nada', async () => {
    const t = setup();
    t.repo.bars.mockResolvedValue(new Map([['BOVA11', bars('BOVA11')]])); // nenhuma ação com barras
    await expect(t.handler.execute(DATE, AFTER_CUTOFF)).rejects.toBeInstanceOf(
      IncompleteMarketDataError,
    );
    expect(t.archive.save).not.toHaveBeenCalled();
    expect(t.repo.save).not.toHaveBeenCalled();
  });

  it('Blob fora: falha, e nenhuma linha é gravada (a linha só existe se o arquivo existe)', async () => {
    const t = setup();
    t.archive.save.mockRejectedValue(new Error('Blob fora'));
    await expect(t.handler.execute(DATE, AFTER_CUTOFF)).rejects.toThrow(/Blob fora/);
    expect(t.repo.save).not.toHaveBeenCalled();
    expect(t.jobs.fail).toHaveBeenCalledTimes(1);
    expect(t.jobs.succeed).not.toHaveBeenCalled();
  });

  it('banco fora na leitura: falha e registra no job', async () => {
    const t = setup();
    t.repo.news.mockRejectedValue(new Error('banco fora'));
    await expect(t.handler.execute(DATE, AFTER_CUTOFF)).rejects.toThrow(/banco fora/);
    expect(t.jobs.fail).toHaveBeenCalledTimes(1);
  });

  it('handle trata só mensagens freeze, com a hora do relógio', async () => {
    vi.useFakeTimers({ now: AFTER_CUTOFF, toFake: ['Date'] });
    try {
      const t = setup();
      await t.handler.handle({ type: 'freeze', date: DATE });
      expect(t.archive.save).toHaveBeenCalledTimes(1);
      await expect(t.handler.handle({ type: 'eod', date: DATE })).rejects.toThrow(/fila briefing/);
    } finally {
      vi.useRealTimers();
    }
  });
});
