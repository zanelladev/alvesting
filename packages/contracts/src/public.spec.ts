import { describe, expect, it } from 'vitest';
import {
  PAGE_DEFAULT_LIMIT,
  PAGE_MAX_LIMIT,
  PUBLIC_CACHE_CONTROL,
  PUBLIC_CACHE_TTL_SECONDS,
  STOCK_SEARCH_LIMIT,
  arenaCurrentSchema,
  cycleRefSchema,
  decisionsQuerySchema,
  equitySchema,
  feedDecisionSchema,
  lastCycleSchema,
  leaderboardRowSchema,
  leaderboardSchema,
  newsItemSchema,
  newsQuerySchema,
  nextCycleSchema,
  noQuerySchema,
  queryDateSchema,
  queryDateTimeSchema,
  seasonRefSchema,
  seasonsQuerySchema,
  stockDetailSchema,
  stockSearchSchema,
  stocksQuerySchema,
  tickerParamSchema,
} from './public.js';

const ULID = '01M6D0RFWKKZJBPTWNWN76J316';

describe('o tempo de vida do cache público', () => {
  it('é uma constante só, e o Cache-Control sai dela: público, s-maxage e stale-while-revalidate', () => {
    expect(PUBLIC_CACHE_TTL_SECONDS).toBe(300);
    expect(PUBLIC_CACHE_CONTROL).toBe('public, s-maxage=300, stale-while-revalidate=300');
  });
});

describe('os parâmetros das listas', () => {
  it('o limite chega como texto da query, vira inteiro e tem teto', () => {
    expect(seasonsQuerySchema.parse({ limit: '10' })).toEqual({ limit: 10 });
    expect(seasonsQuerySchema.parse({})).toEqual({});
    expect(seasonsQuerySchema.parse({ limit: String(PAGE_MAX_LIMIT) }).limit).toBe(PAGE_MAX_LIMIT);
    expect(PAGE_DEFAULT_LIMIT).toBeLessThanOrEqual(PAGE_MAX_LIMIT);
    for (const bad of ['0', '-1', String(PAGE_MAX_LIMIT + 1), '1.5', 'dez', '', ' ', '1e2']) {
      expect(seasonsQuerySchema.safeParse({ limit: bad }).success, `limit=${bad}`).toBe(false);
    }
  });

  it('o cursor é opaco, curto e só de base64url', () => {
    expect(seasonsQuerySchema.safeParse({ cursor: 'eyJ2IjoxfQ' }).success).toBe(true);
    for (const bad of ['', 'a b', 'a/b', 'a+b', "'; DROP TABLE", 'x'.repeat(257)]) {
      expect(seasonsQuerySchema.safeParse({ cursor: bad }).success, `cursor=${bad}`).toBe(false);
    }
  });

  it('parâmetro desconhecido é erro: a chave do cache da borda não pode ser inflada à toa', () => {
    expect(seasonsQuerySchema.safeParse({ utm_source: 'x' }).success).toBe(false);
    expect(decisionsQuerySchema.safeParse({ action: 'BUY', extra: '1' }).success).toBe(false);
    expect(newsQuerySchema.safeParse({ snippet: '1' }).success).toBe(false);
  });

  it('o parâmetro repetido (?limit=1&limit=2 vira lista) é erro', () => {
    expect(seasonsQuerySchema.safeParse({ limit: ['1', '2'] }).success).toBe(false);
  });

  it('a temporada é o ULID ou o slug', () => {
    expect(seasonRefSchema.parse(ULID)).toBe(ULID);
    expect(seasonRefSchema.parse('temporada-1')).toBe('temporada-1');
    for (const bad of ['', 'Temporada-1', 'a_b', '../x', 'x'.repeat(65), 'a b']) {
      expect(seasonRefSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('o feed filtra por ação (BUY, SELL ou HOLD, em maiúsculas), por competidor e por temporada', () => {
    expect(
      decisionsQuerySchema.parse({ action: 'SELL', competitor: 'claude-opus', season: 'ensaio' }),
    ).toEqual({ action: 'SELL', competitor: 'claude-opus', season: 'ensaio' });
    for (const action of ['buy', 'COMPRA', '', 'BUY,SELL']) {
      expect(decisionsQuerySchema.safeParse({ action }).success, action).toBe(false);
    }
    expect(decisionsQuerySchema.safeParse({ competitor: 'Com Espaço' }).success).toBe(false);
  });

  it('as notícias filtram por ticker no formato da B3', () => {
    expect(newsQuerySchema.parse({ ticker: 'PETR4' })).toEqual({ ticker: 'PETR4' });
    expect(newsQuerySchema.safeParse({ ticker: 'petr4' }).success).toBe(false);
    expect(newsQuerySchema.safeParse({ ticker: "PETR4'; --" }).success).toBe(false);
  });

  it('a busca de ações exige q, sem espaços nas pontas, de 1 a 40 caracteres', () => {
    expect(stocksQuerySchema.parse({ q: '  petr ' })).toEqual({ q: 'petr' });
    expect(STOCK_SEARCH_LIMIT).toBe(20);
    for (const bad of [{}, { q: '' }, { q: '   ' }, { q: 'x'.repeat(41) }, { q: ['a', 'b'] }]) {
      expect(stocksQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  it('a busca recusa caractere de controle: o NUL (U+0000) o Postgres não aceita em texto e viraria 500', () => {
    for (const q of ['\u0000', 'a\u0000b', '\u0001', 'a\nb', 'a\tb', '\u007f', '\u0085']) {
      expect(stocksQuerySchema.safeParse({ q }).success, JSON.stringify(q)).toBe(false);
    }
    // texto de gente de verdade passa: acento, espaço, pontuação e emoji
    for (const q of ['ação', 'São Paulo', 'PETR4', 'b3', 'Vale S.A.', '😀']) {
      expect(stocksQuerySchema.safeParse({ q }).success, q).toBe(true);
    }
  });

  it('a rota sem parâmetros recusa qualquer um: ?x=<aleatório> seria uma chave nova no cache da borda', () => {
    expect(noQuerySchema.safeParse({}).success).toBe(true);
    for (const bad of [{ x: '1' }, { a: ['1', '2'] }, { a: { b: '1' } }, { utm_source: 'x' }]) {
      expect(noQuerySchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });

  // z.iso.date() e z.iso.datetime() aceitam o ano 0000, e o Postgres não tem ano zero (22008): a data entraria na consulta e sairia 500.
  it('a data que vira parâmetro de consulta não aceita o ano 0000 (o Postgres recusa)', () => {
    for (const bad of ['0000-01-01', '0000-12-31', '0000-02-29']) {
      expect(queryDateSchema.safeParse(bad).success, bad).toBe(false);
      expect(cycleRefSchema.safeParse(bad).success, bad).toBe(false);
    }
    for (const bad of ['0000-01-01T00:00:00.000Z', '0000-12-31T23:59:59.999Z']) {
      expect(queryDateTimeSchema.safeParse(bad).success, bad).toBe(false);
    }
    // o resto continua valendo: data de verdade, o menor ano que o Postgres tem e o formato torto
    for (const good of ['2026-11-04', '0001-01-01', '9999-12-31']) {
      expect(queryDateSchema.safeParse(good).success, good).toBe(true);
    }
    expect(cycleRefSchema.safeParse('2026-11-04').success).toBe(true);
    expect(cycleRefSchema.safeParse(ULID).success).toBe(true);
    expect(queryDateTimeSchema.safeParse('2026-11-04T11:00:00.000Z').success).toBe(true);
    expect(queryDateTimeSchema.safeParse('0001-01-01T00:00:00.000Z').success).toBe(true);
    for (const bad of ['2026-02-30', '2026-13-01', '04-11-2026', '', 'abc']) {
      expect(queryDateSchema.safeParse(bad).success, bad).toBe(false);
    }
    for (const bad of ['2026-11-04', '2026-11-04T11:00:00', '2026-11-04T11:00:00+02:00', '']) {
      expect(queryDateTimeSchema.safeParse(bad).success, bad).toBe(false);
    }
  });

  it('o ticker da rota aceita minúsculas e devolve em maiúsculas', () => {
    expect(tickerParamSchema.parse('petr4')).toBe('PETR4');
    expect(tickerParamSchema.parse('B3SA3')).toBe('B3SA3');
    for (const bad of ['', 'PETR', 'PETR444', '1ETR4', 'PE TR4', "PETR4'--", '../etc']) {
      expect(tickerParamSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe('a notícia pública: dado de terceiro', () => {
  const item = {
    title: 'Ibovespa fecha em alta',
    source: 'agencia-brasil',
    sourceName: 'Agência Brasil',
    publishedAt: '2026-11-03T12:00:00.000Z',
    tickers: ['PETR4'],
    url: 'https://agenciabrasil.ebc.com.br/economia/noticia/2026-11/ibovespa',
  };

  it('tem título, fonte, hora, tickers e link', () => {
    expect(newsItemSchema.parse(item)).toEqual(item);
  });

  it('o link só pode ser http ou https', () => {
    expect(newsItemSchema.safeParse({ ...item, url: 'http://exemplo.com.br/a' }).success).toBe(
      true,
    );
    for (const url of [
      'javascript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD4=',
      'file:///etc/passwd',
      'ftp://exemplo.com/a',
      '//exemplo.com/a',
      'exemplo.com/a',
      'https://',
      ' https://exemplo.com',
    ]) {
      expect(newsItemSchema.safeParse({ ...item, url }).success, url).toBe(false);
    }
  });

  it('o link não leva usuário nem senha: https://site-conhecido@outro.site/ é link enganoso', () => {
    for (const url of [
      'https://infomoney.com.br@outro.site/a',
      'https://usuario:senha@exemplo.com/a',
      'http://:senha@exemplo.com/a',
    ]) {
      expect(newsItemSchema.safeParse({ ...item, url }).success, url).toBe(false);
    }
    // o "@" no caminho ou na query é texto comum
    expect(
      newsItemSchema.safeParse({ ...item, url: 'https://exemplo.com/a@b?c=d@e' }).success,
    ).toBe(true);
  });

  it('o título não carrega HTML', () => {
    for (const title of [
      '<script>alert(1)</script>',
      'Lucro <b>recorde</b>',
      '<!-- x -->',
      '<?php',
    ]) {
      expect(newsItemSchema.safeParse({ ...item, title }).success, title).toBe(false);
    }
    // "<" e ">" soltos são texto, não tag
    expect(newsItemSchema.safeParse({ ...item, title: 'Lucro < 5% e dólar > R$ 5' }).success).toBe(
      true,
    );
  });

  it('o trecho (snippet) nunca sai: campo a mais é erro', () => {
    expect(newsItemSchema.safeParse({ ...item, snippet: 'trecho do feed' }).success).toBe(false);
  });
});

describe('as respostas são estritas: o que não está no contrato não sai', () => {
  const competitor = {
    slug: 'claude-opus-5-5',
    name: 'Claude Opus 5.5',
    type: 'MODEL',
    provider: 'openrouter',
    modelId: 'anthropic/claude-opus-5.5',
  };
  const row = {
    rank: 1,
    competitor,
    equityCents: 10_050_000,
    returnBps: 50,
    percentileBps: 9_650,
    excessEqualWeightBps: 10,
    excessCdiBps: null,
    maxDrawdownBps: 120,
    winRateBps: null,
    sells: 0,
    winningSells: 0,
    trades: 3,
    llmCostMicroUsd: 123_456,
  };

  it('uma linha do ranking tem os campos pedidos e rejeita o que sobra', () => {
    expect(leaderboardRowSchema.parse(row)).toEqual(row);
    expect(leaderboardRowSchema.safeParse({ ...row, config: { pricing: 1 } }).success).toBe(false);
    expect(
      leaderboardRowSchema.safeParse({ ...row, competitor: { ...competitor, config: {} } }).success,
    ).toBe(false);
  });

  // O retroativo (ADR 0038): onde o ciclo aparece (a decisão do feed, o último ciclo da home), o modo e a hora real vêm junto, e o ranking diz
  // quantos pregões foram de cada modo. Sem eles o site apresentaria um pregão retroativo como se fosse ao vivo.
  it('a decisão do feed e o último ciclo da home levam o modo e a hora real; o ranking conta os pregões de cada modo', () => {
    const decision = {
      date: '2026-10-13',
      mode: 'RETROATIVO',
      executedAt: '2026-11-07T14:02:11.000Z',
      competitor,
      status: 'DECIDED',
      holdReason: null,
      marketView: 'neutro',
      summary: 'Dia calmo.',
      items: [],
      dropped: [],
    };
    expect(feedDecisionSchema.parse(decision)).toEqual(decision);
    const { mode: _mode, ...withoutMode } = decision;
    expect(feedDecisionSchema.safeParse(withoutMode).success).toBe(false);
    expect(feedDecisionSchema.safeParse({ ...decision, mode: 'ATRASADO' }).success).toBe(false);
    const last = {
      date: '2026-10-13',
      status: 'CLOSED',
      skipReason: null,
      decisionAt: '2026-10-13T11:00:00.000Z',
      deadlineAt: '2026-10-13T12:30:00.000Z',
      closedAt: '2026-10-13T11:01:00.000Z',
      mode: 'RETROATIVO',
      executedAt: '2026-11-07T14:02:11.000Z',
      prompt: null,
      briefingSha256: null,
      counts: { BUY: 0, SELL: 0, HOLD: 0 },
    };
    expect(lastCycleSchema.parse(last)).toEqual(last);
    const { executedAt: _executedAt, ...withoutExecutedAt } = last;
    expect(lastCycleSchema.safeParse(withoutExecutedAt).success).toBe(false);
    const counts = leaderboardSchema.shape.cyclesByMode;
    expect(counts.parse({ RETROATIVO: 17, AO_VIVO: 3 })).toEqual({ RETROATIVO: 17, AO_VIVO: 3 });
    expect(counts.safeParse({ RETROATIVO: 17 }).success).toBe(false);
    expect(counts.safeParse({ RETROATIVO: -1, AO_VIVO: 0 }).success).toBe(false);
  });

  it('o tipo do competidor é um dos cinco: modelo, Sorteio, igual-peso, CDI e BOVA11', () => {
    for (const type of ['MODEL', 'RANDOM', 'EQUAL_WEIGHT', 'CDI', 'BOVA11']) {
      const parsed = leaderboardRowSchema.safeParse({
        ...row,
        competitor: { ...competitor, type },
      });
      expect(parsed.success, type).toBe(true);
    }
    expect(
      leaderboardRowSchema.safeParse({ ...row, competitor: { ...competitor, type: 'BENCHMARK' } })
        .success,
    ).toBe(false);
  });

  it('dinheiro é centavo inteiro e seguro: nada de float nem de inteiro que perde precisão', () => {
    expect(leaderboardRowSchema.safeParse({ ...row, equityCents: 100.5 }).success).toBe(false);
    expect(
      leaderboardRowSchema.safeParse({ ...row, equityCents: Number.MAX_SAFE_INTEGER + 1 }).success,
    ).toBe(false);
    expect(leaderboardRowSchema.safeParse({ ...row, equityCents: '10050000' }).success).toBe(false);
  });

  it('a série de patrimônio tem uma data por ponto, para todos os competidores', () => {
    const season = {
      id: ULID,
      slug: 'ensaio',
      name: 'Ensaio',
      status: 'FINISHED',
      startDate: '2026-11-03',
      startedAt: '2026-11-02T18:00:00.000Z',
      finishedAt: '2026-11-09T23:00:00.000Z',
      settledThrough: '2026-11-09',
      params: { randomSeed: 'a', monteCarloSeed: 'b' },
    };
    const ok = {
      season,
      dates: ['2026-11-03', '2026-11-04'],
      series: [{ competitor, equityCents: [10_000_000, 10_010_000] }],
    };
    expect(equitySchema.safeParse(ok).success).toBe(true);
    const misaligned = { ...ok, series: [{ competitor, equityCents: [10_000_000] }] };
    expect(equitySchema.safeParse(misaligned).success).toBe(false);
  });

  it('a busca de ações devolve no máximo 20 resultados', () => {
    const rows = Array.from({ length: STOCK_SEARCH_LIMIT + 1 }, (_, i) => ({
      ticker: `SIM${i % 10}3`,
      name: `Simulada ${i}`,
    }));
    expect(stockSearchSchema.safeParse({ rows: rows.slice(0, STOCK_SEARCH_LIMIT) }).success).toBe(
      true,
    );
    expect(stockSearchSchema.safeParse({ rows }).success).toBe(false);
  });

  it('os esquemas grandes existem e são estritos (a home, a ação)', () => {
    expect(arenaCurrentSchema.safeParse({ extra: true }).success).toBe(false);
    expect(stockDetailSchema.safeParse({ extra: true }).success).toBe(false);
  });

  it('a home traz o próximo ciclo (a contagem): o pregão e o instante da decisão, ou nulo', () => {
    const next = { date: '2026-11-23', decisionAt: '2026-11-23T11:00:00.000Z' };
    expect(nextCycleSchema.parse(next)).toEqual(next);
    expect(nextCycleSchema.safeParse({ ...next, extra: 1 }).success).toBe(false);
    expect(nextCycleSchema.safeParse({ date: '2026-11-23' }).success).toBe(false);
    expect(nextCycleSchema.safeParse({ ...next, decisionAt: '08:00' }).success).toBe(false);
    const empty = {
      season: null,
      lastCycle: null,
      macro: { cdi: null, selic: null, ipcaMonth: null, ipca12m: null, usd: null },
      top: [],
    };
    expect(arenaCurrentSchema.safeParse({ ...empty, nextCycle: null }).success).toBe(true);
    expect(arenaCurrentSchema.safeParse({ ...empty, nextCycle: next }).success).toBe(true);
    // o campo é obrigatório: o nulo é uma resposta ("não há próximo ciclo"), e a falta dele, um defeito
    expect(arenaCurrentSchema.safeParse(empty).success).toBe(false);
  });
});
