import { Logger } from '@nestjs/common';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { MacroPoint } from '../domain/bcb.js';
import { BcbFetcher } from './bcb-fetcher.js';
import { urlOf } from '../testing/http.fixture.js';

beforeAll(() => {
  Logger.overrideLogger(false);
});

// 01/11/2026 14:00 em Brasília. O SGS é falso: responde pelo código da série na URL.
const NOW = new Date('2026-11-01T17:00:00Z');

type Reply = Response | Error;
function sgs(replies: Record<number, Reply | undefined> = {}) {
  const calls: URL[] = [];
  const fn = vi.fn((input: string | URL | Request, _init?: RequestInit) => {
    const url = new URL(urlOf(input));
    calls.push(url);
    const code = Number(/bcdata\.sgs\.(\d+)/.exec(url.pathname)?.[1]);
    // o SGS devolve o ponto do primeiro dia da janela (o último guardado), que é dentro dela
    const reply =
      replies[code] ??
      new Response(JSON.stringify([{ data: url.searchParams.get('dataInicial'), valor: '1.00' }]));
    return reply instanceof Error ? Promise.reject(reply) : Promise.resolve(reply);
  });
  return { fetchFn: fn as unknown as typeof fetch, calls };
}

function memory(last: Record<string, string> = {}) {
  const saved = new Map<string, MacroPoint[]>();
  return {
    saved,
    repo: {
      lastDates: vi.fn(() => Promise.resolve(new Map(Object.entries(last)))),
      savePoints: vi.fn((series: string, points: readonly MacroPoint[]) => {
        saved.set(series, [...points]);
        return Promise.resolve(points.length);
      }),
    },
  };
}

const window = (url: URL) => [
  url.searchParams.get('dataInicial'),
  url.searchParams.get('dataFinal'),
];

describe('BcbFetcher', () => {
  it('primeira busca: as cinco séries, com cerca de um ano de histórico até hoje', async () => {
    const bcb = sgs();
    const db = memory();
    const result = await new BcbFetcher(db.repo, bcb.fetchFn).run(NOW);

    expect(bcb.calls.map((u) => /sgs\.(\d+)/.exec(u.pathname)?.[1])).toEqual([
      '12',
      '432',
      '433',
      '13522',
      '1',
    ]);
    expect(bcb.calls.every((u) => u.origin === 'https://api.bcb.gov.br')).toBe(true);
    expect(window(bcb.calls[0]!)).toEqual(['27/09/2025', '01/11/2026']);
    expect(result).toEqual({
      cdi_daily_pct: 1,
      selic_target_pct_year: 1,
      ipca_month_pct: 1,
      ipca_12m_pct: 1,
      usd_brl_ptax_sell: 1,
    });
  });

  it('busca só o que falta: do último valor guardado até hoje, e nada para quem já tem até hoje', async () => {
    const bcb = sgs();
    const db = memory({
      cdi_daily_pct: '2026-10-29',
      selic_target_pct_year: '2026-11-04', // a meta Selic vem projetada para os dias seguintes
      ipca_month_pct: '2026-09-01',
      ipca_12m_pct: '2026-11-01',
      usd_brl_ptax_sell: '2026-10-30',
    });
    await new BcbFetcher(db.repo, bcb.fetchFn).run(NOW);

    const asked: Record<string, Array<string | null>> = {};
    for (const u of bcb.calls) asked[/sgs\.(\d+)/.exec(u.pathname)![1]!] = window(u);
    expect(asked).toEqual({
      '12': ['29/10/2026', '01/11/2026'],
      '433': ['01/09/2026', '01/11/2026'],
      '1': ['30/10/2026', '01/11/2026'],
    });
  });

  it('tudo em dia: não pede nada ao BCB', async () => {
    const bcb = sgs();
    const db = memory({
      cdi_daily_pct: '2026-11-01',
      selic_target_pct_year: '2026-11-01',
      ipca_month_pct: '2026-11-01',
      ipca_12m_pct: '2026-11-01',
      usd_brl_ptax_sell: '2026-11-01',
    });
    await expect(new BcbFetcher(db.repo, bcb.fetchFn).run(NOW)).resolves.toEqual({});
    expect(bcb.fetchFn).not.toHaveBeenCalled();
  });

  it('grava os pontos já normalizados, na série certa', async () => {
    const bcb = sgs({
      12: new Response(
        JSON.stringify([
          { data: '29/10/2026', valor: '0.050788' },
          { data: '28/10/2026', valor: '0.050788' },
        ]),
      ),
      1: new Response(JSON.stringify([{ data: '30/10/2026', valor: '5.4212' }])),
    });
    const db = memory();
    await new BcbFetcher(db.repo, bcb.fetchFn).run(NOW);
    expect(db.saved.get('cdi_daily_pct')).toEqual([
      { date: '2026-10-28', value: '0.050788' },
      { date: '2026-10-29', value: '0.050788' },
    ]);
    expect(db.saved.get('usd_brl_ptax_sell')).toEqual([{ date: '2026-10-30', value: '5.4212' }]);
  });

  it('uma série que falha não impede as outras de gravar; a busca falha no fim, dizendo quais', async () => {
    const bcb = sgs({
      433: new Response('SEGREDO-NO-CORPO', { status: 503 }),
      1: new TypeError('fetch failed'),
    });
    const db = memory();
    const error = await new BcbFetcher(db.repo, bcb.fetchFn).run(NOW).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toMatch(/2 série/);
    expect(message).toContain('ipca_month_pct');
    expect(message).toContain('usd_brl_ptax_sell');
    expect(message).not.toContain('SEGREDO');
    expect([...db.saved.keys()].sort()).toEqual([
      'cdi_daily_pct',
      'ipca_12m_pct',
      'selic_target_pct_year',
    ]);
  });

  it('resposta que não é JSON ou fora do formato falha sem repetir o corpo', async () => {
    for (const body of [
      '<html>SEGREDO-NA-PAGINA</html>',
      '{"error":"x"}',
      '[{"data":"29/10/2026","valor":"abc"}]',
    ]) {
      const bcb = sgs({ 12: new Response(body) });
      const db = memory({
        selic_target_pct_year: '2026-11-04',
        ipca_month_pct: '2026-11-01',
        ipca_12m_pct: '2026-11-01',
        usd_brl_ptax_sell: '2026-11-01',
      });
      const error = await new BcbFetcher(db.repo, bcb.fetchFn).run(NOW).catch((e: unknown) => e);
      expect((error as Error).message, body).toContain('cdi_daily_pct');
      expect((error as Error).message, body).not.toContain('SEGREDO');
      expect(db.repo.savePoints).not.toHaveBeenCalled();
    }
  });

  it('ponto datado fora da janela pedida (2099) falha a série, sem gravar nada dela; as outras gravam', async () => {
    const bcb = sgs({
      432: new Response(
        JSON.stringify([
          { data: '29/10/2026', valor: '13.75' },
          { data: '01/01/2099', valor: '13.75' },
        ]),
      ),
    });
    const db = memory();
    const error = await new BcbFetcher(db.repo, bcb.fetchFn).run(NOW).catch((e: unknown) => e);
    expect((error as Error).message).toContain('selic_target_pct_year');
    expect(db.saved.has('selic_target_pct_year')).toBe(false); // nem o ponto bom: a resposta toda é suspeita
    expect([...db.saved.keys()].sort()).toEqual([
      'cdi_daily_pct',
      'ipca_12m_pct',
      'ipca_month_pct',
      'usd_brl_ptax_sell',
    ]);
  });

  it('o 404 "Value(s) not found" do SGS é janela sem dado novo, não falha', async () => {
    const empty = new Response(
      JSON.stringify({
        erro: {
          statusCode: 404,
          detail: 'br.gov.bcb.pec.sgs.comum.excecoes.SGSNegocioException: Value(s) not found',
        },
      }),
      { status: 404 },
    );
    const bcb = sgs({ 12: empty });
    const db = memory({ cdi_daily_pct: '2026-10-29' });
    const result = await new BcbFetcher(db.repo, bcb.fetchFn).run(NOW);
    expect(result.cdi_daily_pct).toBe(0);
    expect(db.saved.get('cdi_daily_pct')).toEqual([]);
  });

  it('o 400 do SGS (janela torta) também é falha', async () => {
    const bcb = sgs({
      12: new Response('{"erro":"DataFinal deve ser maior que dataInicial."}', { status: 400 }),
    });
    await expect(new BcbFetcher(memory().repo, bcb.fetchFn).run(NOW)).rejects.toThrow(
      /cdi_daily_pct/,
    );
  });

  it('o 404 do SGS (série inexistente) também é falha', async () => {
    const bcb = sgs({ 12: new Response('{}', { status: 404 }) });
    await expect(new BcbFetcher(memory().repo, bcb.fetchFn).run(NOW)).rejects.toThrow(
      /cdi_daily_pct/,
    );
  });
});
