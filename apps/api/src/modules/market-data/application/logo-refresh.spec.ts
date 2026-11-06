import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Listing } from '../domain/instruments.js';
import { LOGO_MAX_BYTES } from '../domain/svg-check.js';
import type { LogoRow, LogoTarget } from '../infrastructure/market.repository.js';
import { LOGO_MAX_AGE_MS, LogoRefresh } from './logo-refresh.js';

// A passada dos logos sem rede e sem banco (ADR 0036): o fetch é falso, os SVG são escritos aqui e o repositório é um mapa. Nenhum pedido sai.
const NOW = Date.parse('2026-11-08T12:00:00Z');
const DAY = 86_400_000;
const urlOf = (ticker: string) => `https://icons.brapi.dev/icons/${ticker}.svg`;
const svgOf = (fill: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="${fill}"/></svg>`;
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const href = (input: Parameters<typeof fetch>[0]): string =>
  input instanceof URL ? input.href : typeof input === 'string' ? input : input.url;
const svgResponse = (body: string | Uint8Array, headers: Record<string, string> = {}) =>
  new Response(body, { status: 200, headers: { 'content-type': 'image/svg+xml', ...headers } });

interface Setup {
  // os papéis do banco e o logo guardado de cada um (ou nenhum); `svg` é o texto guardado (sem ele, um SVG bom)
  db: Record<string, { sourceUrl: string; sha256: string; fetchedAt: number; svg?: string } | null>;
  // a lista da brapi: papel -> logo (já conferido pelo cliente; nulo é sem logo)
  listed: Record<string, string | null>;
  respond?: (url: string, call: number) => Response | Error;
  budgetMs?: number;
  // quanto cada resposta demora no relógio de mentira
  latencyMs?: number;
}

function setup(options: Setup) {
  let now = NOW;
  const db = new Map(Object.entries(options.db));
  const saved: LogoRow[] = [];
  const touched: Array<[string, string, Date]> = [];
  const deleted: string[] = [];
  const market = {
    storedLogos: vi.fn(() =>
      Promise.resolve(
        [...db].flatMap(([ticker, stored]) =>
          stored
            ? [{ instrumentId: `id-${ticker}`, ticker, svg: stored.svg ?? svgOf('#000') }]
            : [],
        ),
      ),
    ),
    deleteLogo: vi.fn((id: string) => {
      deleted.push(id);
      db.set(id.slice(3), null);
      return Promise.resolve();
    }),
    logoTargets: vi.fn((tickers: readonly string[]) =>
      Promise.resolve(
        [...db]
          .filter(([ticker]) => tickers.includes(ticker))
          .map(([ticker, stored]): LogoTarget => ({
            instrumentId: `id-${ticker}`,
            ticker,
            stored: stored && {
              sourceUrl: stored.sourceUrl,
              sha256: stored.sha256,
              fetchedAt: new Date(stored.fetchedAt),
            },
          })),
      ),
    ),
    saveLogo: vi.fn((row: LogoRow) => {
      saved.push(row);
      return Promise.resolve();
    }),
    touchLogo: vi.fn((id: string, url: string, at: Date) => {
      touched.push([id, url, at]);
      return Promise.resolve();
    }),
  };
  let call = 0;
  const fetchFn = vi.fn<typeof fetch>((input) => {
    call += 1;
    now += options.latencyMs ?? 0;
    const url = href(input);
    const out = options.respond?.(url, call) ?? svgResponse(svgOf('#000'));
    return out instanceof Error ? Promise.reject(out) : Promise.resolve(out);
  });
  const listings: Listing[] = Object.entries(options.listed).map(([ticker, logo]) => ({
    ticker,
    subType: 'stock',
    logo,
  }));
  const refresh = new LogoRefresh(market, fetchFn, () => now);
  const run = () => refresh.run(listings, options.budgetMs ?? Infinity);
  const asked = () => fetchFn.mock.calls.map(([input]) => href(input));
  return { run, fetchFn, market, saved, touched, deleted, asked };
}

const silentWarn = () => vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
let warn: ReturnType<typeof silentWarn>;
beforeEach(() => {
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  warn = silentWarn();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('LogoRefresh: o que se baixa (só o que falta, o que mudou de endereço e o que tem mais de 30 dias)', () => {
  it('pede só o papel do banco com logo na lista que precisa: sem logo guardado, endereço trocado ou guardado há mais de 30 dias', async () => {
    const fresh = {
      sourceUrl: urlOf('FRES3'),
      sha256: sha(svgOf('#000')),
      fetchedAt: NOW - 29 * DAY,
    };
    const t = setup({
      db: {
        NOVO3: null,
        FRES3: fresh,
        MUDA3: { ...fresh, sourceUrl: urlOf('MUDA3-ANTIGO') },
        VELH3: { ...fresh, sourceUrl: urlOf('VELH3'), fetchedAt: NOW - LOGO_MAX_AGE_MS - 1 },
        SEML3: null,
      },
      listed: {
        NOVO3: urlOf('NOVO3'),
        FRES3: urlOf('FRES3'),
        MUDA3: urlOf('MUDA3'),
        VELH3: urlOf('VELH3'),
        // a lista diz que não tem logo (o ícone padrão ou o valor torto viram nulo no cliente)
        SEML3: null,
        // a lista traz, mas o banco não tem o papel (ETF, FII, papel que ainda não foi semeado)
        FORA11: urlOf('FORA11'),
      },
    });
    const summary = await t.run();
    expect(t.market.logoTargets).toHaveBeenCalledWith([
      'NOVO3',
      'FRES3',
      'MUDA3',
      'VELH3',
      'FORA11',
    ]);
    expect(t.asked()).toEqual([urlOf('NOVO3'), urlOf('MUDA3'), urlOf('VELH3')]);
    expect(summary).toMatchObject({ listed: 4, asked: 3, requests: 3, stopped: null });
  });

  it('exatamente 30 dias ainda não pede de novo', async () => {
    const t = setup({
      db: {
        PETR4: { sourceUrl: urlOf('PETR4'), sha256: sha('x'), fetchedAt: NOW - LOGO_MAX_AGE_MS },
      },
      listed: { PETR4: urlOf('PETR4') },
    });
    await t.run();
    expect(t.asked()).toEqual([]);
  });

  it('sem papel na lista com logo, nada é pedido', async () => {
    const t = setup({ db: { PETR4: null }, listed: { PETR4: null } });
    expect(await t.run()).toMatchObject({ listed: 0, asked: 0, requests: 0 });
    expect(t.market.logoTargets).not.toHaveBeenCalled();
    expect(t.fetchFn).not.toHaveBeenCalled();
  });
});

// A tabela só guarda o que passa no validador de HOJE (ADR 0036): antes de baixar, a passada reconfere cada SVG guardado e apaga o que uma
// regra nova passou a recusar. É por isso que as rotas leem o banco como está.
describe('LogoRefresh: a reconferência dos guardados', () => {
  // um logo que entrou antes de o validador recusar <animate> (a regra é de hoje; o SVG, de antes dela)
  const OLD_RULE_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"><animate attributeName="x" values="0;1"/></rect></svg>';
  const fresh = { sourceUrl: urlOf('PETR4'), sha256: sha(OLD_RULE_SVG), fetchedAt: NOW - DAY };

  it('apaga o SVG guardado que o validador de hoje recusa, com o ticker e o motivo no log (nunca o conteúdo), antes de baixar', async () => {
    const t = setup({
      db: {
        PETR4: { ...fresh, svg: OLD_RULE_SVG },
        VALE3: { ...fresh, sourceUrl: urlOf('VALE3') },
      },
      listed: { PETR4: urlOf('PETR4'), VALE3: urlOf('VALE3') },
    });
    const summary = await t.run();
    expect(t.deleted).toEqual(['id-PETR4']);
    expect(summary.purged).toEqual([{ ticker: 'PETR4', reason: 'elemento <animate>' }]);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('PETR4');
    expect(logged).toContain('elemento <animate>');
    expect(logged).not.toContain('attributeName');
    // apagado, ele é "sem logo guardado": a mesma passada o pede de novo (o VALE3, fresco e bom, não)
    expect(t.market.deleteLogo.mock.invocationCallOrder[0]).toBeLessThan(
      t.fetchFn.mock.invocationCallOrder[0]!,
    );
    expect(t.asked()).toEqual([urlOf('PETR4')]);
    expect(t.saved.map((row) => row.instrumentId)).toEqual(['id-PETR4']);
  });

  it('reconfere também o guardado de papel que a lista de hoje não traz com logo', async () => {
    const t = setup({ db: { PETR4: { ...fresh, svg: OLD_RULE_SVG } }, listed: { PETR4: null } });
    const summary = await t.run();
    expect(t.deleted).toEqual(['id-PETR4']);
    expect(summary.purged).toHaveLength(1);
    expect(t.fetchFn).not.toHaveBeenCalled();
  });

  it('o guardado que passa não é tocado', async () => {
    const t = setup({ db: { PETR4: fresh }, listed: { PETR4: urlOf('PETR4') } });
    expect((await t.run()).purged).toEqual([]);
    expect(t.deleted).toEqual([]);
  });
});

describe('LogoRefresh: o pedido', () => {
  it('um por vez, no endereço da lista, sem token nem cookie, sem seguir redirecionamento e com prazo', async () => {
    let inFlight = 0;
    let most = 0;
    const t = setup({
      db: { PETR4: null, VALE3: null },
      listed: { PETR4: urlOf('PETR4'), VALE3: urlOf('VALE3') },
    });
    t.fetchFn.mockImplementation(async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await Promise.resolve();
      inFlight -= 1;
      return svgResponse(svgOf('#000'));
    });
    await t.run();
    expect(most).toBe(1);
    for (const [, init] of t.fetchFn.mock.calls) {
      expect(init?.redirect).toBe('error');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      const headers = new Headers(init?.headers);
      expect(headers.has('authorization')).toBe(false);
      expect(headers.has('cookie')).toBe(false);
      expect(init?.credentials).not.toBe('include');
    }
  });
});

describe('LogoRefresh: a gravação', () => {
  it('o SVG novo é gravado com o endereço, o SHA-256 dos bytes, o tamanho e a hora da busca', async () => {
    const body = svgOf('#0a0');
    const t = setup({
      db: { PETR4: null },
      listed: { PETR4: urlOf('PETR4') },
      respond: () => svgResponse(body, { 'content-type': 'image/svg+xml; charset=utf-8' }),
    });
    const summary = await t.run();
    expect(t.saved).toEqual([
      {
        instrumentId: 'id-PETR4',
        sourceUrl: urlOf('PETR4'),
        svg: body,
        sha256: sha(body),
        bytes: Buffer.byteLength(body),
        fetchedAt: new Date(NOW),
      },
    ]);
    expect(summary).toMatchObject({ stored: 1, unchanged: 0, bytes: Buffer.byteLength(body) });
  });

  it('o mesmo SHA-256 não regrava o SVG: só o endereço e a data andam; o SHA-256 diferente troca tudo', async () => {
    const same = svgOf('#111');
    const t = setup({
      db: {
        IGUA3: { sourceUrl: urlOf('IGUA3'), sha256: sha(same), fetchedAt: NOW - 40 * DAY },
        OUTR3: { sourceUrl: urlOf('OUTR3'), sha256: sha(same), fetchedAt: NOW - 40 * DAY },
      },
      listed: { IGUA3: urlOf('IGUA3'), OUTR3: urlOf('OUTR3') },
      respond: (url) => svgResponse(url.includes('IGUA3') ? same : svgOf('#222')),
    });
    const summary = await t.run();
    expect(t.touched).toEqual([['id-IGUA3', urlOf('IGUA3'), new Date(NOW)]]);
    expect(t.saved.map((row) => [row.instrumentId, row.sha256])).toEqual([
      ['id-OUTR3', sha(svgOf('#222'))],
    ]);
    expect(summary).toMatchObject({ stored: 1, unchanged: 1 });
  });

  it('o BOM do UTF-8 fica no texto guardado: o SHA-256 e o tamanho são os dos bytes baixados', async () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(svgOf('#000'))]);
    const t = setup({
      db: { PETR4: null },
      listed: { PETR4: urlOf('PETR4') },
      respond: () => svgResponse(bytes),
    });
    await t.run();
    expect(Buffer.byteLength(t.saved[0]!.svg)).toBe(bytes.length);
    expect(t.saved[0]).toMatchObject({
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  });
});

describe('LogoRefresh: o recusado vira "sem logo", com o motivo e o ticker no log, nunca o SVG', () => {
  const refusedBy = async (respond: Setup['respond']) => {
    const t = setup({ db: { PETR4: null }, listed: { PETR4: urlOf('PETR4') }, respond });
    const summary = await t.run();
    expect(t.saved).toEqual([]);
    expect(t.touched).toEqual([]);
    return summary;
  };

  it('o SVG com script é recusado; o log tem o ticker e o motivo, e nada do conteúdo', async () => {
    const summary = await refusedBy(() =>
      svgResponse(
        '<svg xmlns="http://www.w3.org/2000/svg"><script>conteudo-secreto()</script></svg>',
      ),
    );
    expect(summary.refused).toEqual([{ ticker: 'PETR4', reason: 'elemento <script>' }]);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain('PETR4');
    expect(logged).toContain('elemento <script>');
    expect(logged).not.toContain('conteudo-secreto');
  });

  it('o Content-Length acima do teto é recusado sem ler o corpo', async () => {
    const cancel = vi.fn(() => Promise.resolve());
    const response = svgResponse(svgOf('#000'), { 'content-length': String(LOGO_MAX_BYTES + 1) });
    vi.spyOn(response.body!, 'cancel').mockImplementation(cancel);
    const summary = await refusedBy(() => response);
    expect(summary.refused).toEqual([{ ticker: 'PETR4', reason: 'passa do teto de 200 KB' }]);
    expect(cancel).toHaveBeenCalled();
  });

  it('o corpo que passa do teto sem dizer o tamanho é cortado no teto, e recusado', async () => {
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 64 * 1024;
        controller.enqueue(new Uint8Array(64 * 1024).fill(0x20));
        if (sent > 10 * LOGO_MAX_BYTES) controller.close();
      },
    });
    const summary = await refusedBy(() => svgResponse(stream as unknown as Uint8Array));
    expect(summary.refused).toEqual([{ ticker: 'PETR4', reason: 'passa do teto de 200 KB' }]);
    // parou logo depois do teto, e não leu os 2 MB
    expect(sent).toBeLessThan(LOGO_MAX_BYTES + 3 * 64 * 1024);
  });

  it('o que não é UTF-8 é recusado', async () => {
    const latin1 = Buffer.from(svgOf('#000').replace('rect', 'rect data-x="é"'), 'latin1');
    const summary = await refusedBy(() => svgResponse(latin1));
    expect(summary.refused).toEqual([{ ticker: 'PETR4', reason: 'não é UTF-8' }]);
  });

  it('o recusado não apaga o logo guardado antes (que passa no validador de hoje); a próxima passada tenta de novo', async () => {
    const t = setup({
      db: { PETR4: { sourceUrl: urlOf('PETR4'), sha256: sha('x'), fetchedAt: NOW - 40 * DAY } },
      listed: { PETR4: urlOf('PETR4') },
      respond: () => svgResponse('<svg xmlns="http://www.w3.org/2000/svg" onload="x()"/>'),
    });
    expect((await t.run()).refused).toHaveLength(1);
    expect(t.saved).toEqual([]);
    expect(t.touched).toEqual([]);
  });
});

describe('LogoRefresh: as falhas', () => {
  it.each([
    ['o 404', () => new Response('nada', { status: 404 }), 'HTTP 404'],
    ['o 500', () => new Response('erro', { status: 500 }), 'HTTP 500'],
    [
      'o redirecionamento (o fetch recusa com redirect: error)',
      () => new TypeError('fetch failed'),
      'sem resposta (TypeError)',
    ],
    [
      'o tipo de conteúdo que não é SVG',
      () => svgResponse(svgOf('#000'), { 'content-type': 'text/html' }),
      'tipo de conteúdo diferente de image/svg+xml',
    ],
    [
      'o tempo esgotado',
      () => new DOMException('timeout', 'TimeoutError'),
      'sem resposta (TimeoutError)',
    ],
  ])('%s: o papel fica sem logo nesta passada, com o motivo', async (_name, respond, reason) => {
    const t = setup({ db: { PETR4: null }, listed: { PETR4: urlOf('PETR4') }, respond });
    const summary = await t.run();
    expect(summary.failed).toEqual([{ ticker: 'PETR4', reason }]);
    expect(t.saved).toEqual([]);
  });

  it('5 falhas seguidas param a passada (o host fora do ar): o sexto nem é pedido', async () => {
    const tickers = ['AAAA3', 'BBBB3', 'CCCC3', 'DDDD3', 'EEEE3', 'FFFF3', 'GGGG3'];
    const t = setup({
      db: Object.fromEntries(tickers.map((ticker) => [ticker, null])),
      listed: Object.fromEntries(tickers.map((ticker) => [ticker, urlOf(ticker)])),
      respond: () => new Response('', { status: 503 }),
    });
    const summary = await t.run();
    expect(t.asked()).toHaveLength(5);
    expect(summary).toMatchObject({ requests: 5, stopped: 'outage' });
    expect(summary.failed).toHaveLength(5);
  });

  it('uma resposta boa (até a recusada pelo validador) zera a conta das falhas', async () => {
    const tickers = [
      'AAAA3',
      'BBBB3',
      'CCCC3',
      'DDDD3',
      'EEEE3',
      'FFFF3',
      'GGGG3',
      'HHHH3',
      'IIII3',
      'JJJJ3',
    ];
    const t = setup({
      db: Object.fromEntries(tickers.map((ticker) => [ticker, null])),
      listed: Object.fromEntries(tickers.map((ticker) => [ticker, urlOf(ticker)])),
      // 4 falhas, uma recusada, 4 falhas, uma boa: nunca 5 seguidas
      respond: (_url, call) =>
        call === 5
          ? svgResponse('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>')
          : call === 10
            ? svgResponse(svgOf('#000'))
            : new Response('', { status: 503 }),
    });
    const summary = await t.run();
    expect(t.asked()).toHaveLength(10);
    expect(summary).toMatchObject({ stopped: null, stored: 1 });
    expect(summary.failed).toHaveLength(8);
    expect(summary.refused).toHaveLength(1);
  });

  it('o orçamento de tempo para a passada; o que faltou fica para a próxima', async () => {
    const tickers = ['AAAA3', 'BBBB3', 'CCCC3', 'DDDD3'];
    const t = setup({
      db: Object.fromEntries(tickers.map((ticker) => [ticker, null])),
      listed: Object.fromEntries(tickers.map((ticker) => [ticker, urlOf(ticker)])),
      budgetMs: 25_000,
      latencyMs: 10_000,
    });
    const summary = await t.run();
    // começam aos 0, 10 e 20 s; o quarto começaria aos 30 s, depois do prazo
    expect(t.asked()).toHaveLength(3);
    expect(summary).toMatchObject({ requests: 3, stored: 3, stopped: 'time' });
  });
});
