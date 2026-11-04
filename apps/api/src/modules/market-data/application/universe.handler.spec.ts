import { Logger } from '@nestjs/common';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { JobBusyError, type ClaimResult } from '../../messaging/infrastructure/job-run.store.js';
import { loadTradingCalendar } from '../domain/trading-calendar.js';
import type { VolumeStat } from '../domain/universe.js';
import { UniverseHandler } from './universe.handler.js';

beforeAll(() => {
  Logger.overrideLogger(false);
});

// A semana 2026-W45 abre na segunda 02/11/2026 (Finados, sem pregão): a janela são os 60 pregões até 30/10.
const WEEK = '2026-W45';
const calendar = loadTradingCalendar();
const WINDOW = calendar.tradingDaysBefore('2026-11-02', 60);
const CLAIM: ClaimResult = { status: 'claimed', claim: { id: 'job-u', attempt: 1 } };

const stat = (ticker: string, avgReais: number, presenceDays = 60): VolumeStat => ({
  instrumentId: `id-${ticker}`,
  ticker,
  totalVolumeCents: BigInt(avgReais) * 100n * 60n,
  presenceDays,
});

function setup(
  options: {
    claim?: ClaimResult;
    confirmed?: string[];
    stats?: VolumeStat[];
    saved?: 'created' | 'exists';
    weekly?: { run: (monday: string, today: string) => Promise<never> };
  } = {},
) {
  const jobs = {
    claim: vi.fn(() => Promise.resolve(options.claim ?? CLAIM)),
    succeed: vi.fn(() => Promise.resolve()),
    fail: vi.fn(() => Promise.resolve()),
  };
  const market = { seedCalendar: vi.fn(() => Promise.resolve(0)) };
  const universe = {
    // os pregões confirmados em [from, before): o que o banco devolve para o intervalo pedido
    confirmedDaysBetween: vi.fn((from: string, before: string) =>
      Promise.resolve((options.confirmed ?? WINDOW).filter((day) => day >= from && day < before)),
    ),
    volumeStats: vi.fn((_days: string[]) =>
      Promise.resolve(
        options.stats ?? [
          stat('PETR4', 3_000_000_000),
          stat('VALE3', 2_000_000_000),
          stat('RARA3', 1_000, 10),
        ],
      ),
    ),
    saveSnapshot: vi.fn((_input: unknown) =>
      Promise.resolve(options.saved ?? ('created' as const)),
    ),
  };
  return {
    handler: new UniverseHandler(jobs, calendar, market, universe, options.weekly),
    jobs,
    market,
    universe,
  };
}

describe('UniverseHandler', () => {
  it('monta o universo da semana: janela de 60 pregões antes da segunda, regra de presença e volume', async () => {
    const t = setup();
    await expect(t.handler.execute(WEEK)).resolves.toBe('created');

    expect(t.jobs.claim).toHaveBeenCalledWith({ type: 'universe', week: WEEK });
    expect(t.universe.confirmedDaysBetween).toHaveBeenCalledWith(WINDOW[0], '2026-11-02');
    expect(t.universe.volumeStats).toHaveBeenCalledWith(WINDOW);
    expect(t.universe.saveSnapshot).toHaveBeenCalledWith({
      week: WEEK,
      windowStart: WINDOW[0],
      windowEnd: '2026-10-30',
      windowDays: 60,
      selection: {
        candidates: 3,
        eligible: 2, // RARA3 negociou 10 de 60 pregões
        members: [
          expect.objectContaining({ ticker: 'PETR4', position: 1, presenceDays: 60 }),
          expect.objectContaining({ ticker: 'VALE3', position: 2 }),
        ],
      },
    });
    expect(t.jobs.succeed).toHaveBeenCalledTimes(1);
  });

  it('mantém o calendário dos dias futuros semeado', async () => {
    const t = setup();
    await t.handler.execute(WEEK);
    const [days] = t.market.seedCalendar.mock.calls[0] as unknown as [string[]];
    expect(days[0]).toBe('2026-11-03'); // 02/11 é feriado
    expect(days.at(-1)).toBe('2027-12-30');
  });

  // A atualização semanal da brapi (weekly-refresh.ts) roda ANTES de a janela ser lida e de o universo ser escolhido.
  it('roda a atualização semanal da brapi depois de semear o calendário e antes de ler a janela, com a segunda-feira e o dia da execução', async () => {
    const order: string[] = [];
    const weekly = {
      run: vi.fn((_monday: string, _today: string) => {
        order.push('semanal');
        return Promise.resolve({} as never);
      }),
    };
    const t = setup({ weekly });
    t.market.seedCalendar.mockImplementation(() => {
      order.push('calendário');
      return Promise.resolve(0);
    });
    t.universe.confirmedDaysBetween.mockImplementation((from: string, before: string) => {
      order.push('janela');
      return Promise.resolve(WINDOW.filter((day) => day >= from && day < before));
    });
    await t.handler.execute(WEEK, new Date('2026-11-01T12:00:10Z')); // domingo 09:00 em Brasília
    expect(weekly.run).toHaveBeenCalledWith('2026-11-02', '2026-11-01');
    expect(order).toEqual(['calendário', 'semanal', 'janela']);
  });

  it('erro da atualização semanal (token recusado) marca o job como falho e não congela universo', async () => {
    const weekly = {
      run: vi.fn((_monday: string, _today: string) => Promise.reject(new Error('brapi: HTTP 401'))),
    };
    const t = setup({ weekly });
    await expect(t.handler.execute(WEEK)).rejects.toThrow('HTTP 401');
    expect(t.jobs.fail).toHaveBeenCalledTimes(1);
    expect(t.universe.saveSnapshot).not.toHaveBeenCalled();
  });

  it('mensagem repetida depois de concluída não faz a atualização semanal de novo', async () => {
    const weekly = {
      run: vi.fn((_monday: string, _today: string) => Promise.resolve({} as never)),
    };
    const t = setup({ claim: { status: 'done' }, weekly });
    await t.handler.execute(WEEK);
    expect(weekly.run).not.toHaveBeenCalled();
  });

  it('semana que já tem universo congelado: reconhece e conclui', async () => {
    const t = setup({ saved: 'exists' });
    await expect(t.handler.execute(WEEK)).resolves.toBe('exists');
    expect(t.jobs.succeed).toHaveBeenCalledTimes(1);
  });

  it('mensagem repetida depois de concluída não faz nada', async () => {
    const t = setup({ claim: { status: 'done' } });
    await expect(t.handler.execute(WEEK)).resolves.toBe('already_done');
    expect(t.universe.volumeStats).not.toHaveBeenCalled();
    expect(t.universe.saveSnapshot).not.toHaveBeenCalled();
  });

  it('mensagem em processamento por outra entrega falha com JobBusyError', async () => {
    const t = setup({ claim: { status: 'busy' } });
    await expect(t.handler.execute(WEEK)).rejects.toThrow(JobBusyError);
    expect(t.jobs.fail).not.toHaveBeenCalled();
  });

  it('histórico curto: falha dizendo quantos pregões faltam, sem congelar universo nenhum', async () => {
    const t = setup({ confirmed: WINDOW.slice(-40) });
    await expect(t.handler.execute(WEEK)).rejects.toThrow(/faltam 20 pregões.*market:backfill/s);
    expect(t.universe.saveSnapshot).not.toHaveBeenCalled();
    expect(t.jobs.fail).toHaveBeenCalledTimes(1);
    expect(t.jobs.succeed).not.toHaveBeenCalled();
  });

  // O banco tem todos os pregões de antes da janela também. Com um buraco no meio dela, o 60º confirmado mais
  // recente seria um dia mais velho, e a mensagem culparia o calendário por um dia que é pregão normal.
  it('buraco no meio da janela (um dia sem barras confirmado) falha citando só o dia que falta', async () => {
    const hole = WINDOW.filter((day) => day !== '2026-09-15');
    const older = calendar.previousTradingDay(WINDOW[0]!);
    const t = setup({ confirmed: [older, ...hole] });
    const error = await t.handler.execute(WEEK).then(
      () => undefined,
      (e: unknown) => (e as Error).message,
    );
    expect(error).toMatch(/faltam 1 pregões.*2026-09-15.*market:backfill/s);
    expect(error).not.toContain(older); // o dia anterior à janela não é "cotação fora do calendário"
    expect(error).not.toMatch(/não conta como pregão/);
    expect(t.universe.saveSnapshot).not.toHaveBeenCalled();
  });

  it('dia confirmado que o calendário diz ser feriado é apontado, sem dizer que falta pregão', async () => {
    const odd = [...WINDOW, '2026-10-31'].sort(); // um sábado com "cotação"
    const t = setup({ confirmed: odd });
    const error = await t.handler.execute(WEEK).then(
      () => undefined,
      (e: unknown) => (e as Error).message,
    );
    expect(error).toMatch(/2026-10-31.*b3-holidays\.json/s);
    expect(error).not.toMatch(/faltam/);
  });

  it('nenhuma ação passou nos filtros: falha em vez de congelar um universo vazio na semana', async () => {
    const t = setup({ stats: [stat('RARA3', 1_000, 10)] });
    await expect(t.handler.execute(WEEK)).rejects.toThrow(/nenhuma ação/i);
    expect(t.universe.saveSnapshot).not.toHaveBeenCalled();
  });

  it('semana que não existe falha e marca o job', async () => {
    const t = setup();
    await expect(t.handler.execute('2027-W53')).rejects.toThrow(RangeError);
    expect(t.jobs.fail).toHaveBeenCalledTimes(1);
  });
});
