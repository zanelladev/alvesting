import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Portfolio } from '@alvesting/contracts';
import { ApiError } from '../../../../lib/api';

// A página /carteira (etapa 12, parte 2): o que ela faz com o que a api diz sobre a sessão, o aceite e a carteira. Os e2e conferem o caminho de
// verdade (cookie, api, navegador, Front Door imitado); aqui entram os estados que a api do e2e não produz: o aceite vencido, o ticker sem barra, o
// percentual nulo e a api fora do ar.
const readPortfolio = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { digest: `NEXT_REDIRECT;${path}` });
  }),
);
const cookieHeader = vi.hoisted(() => ({
  value: 'alvesting.session_token=a.b%2Bc; _ga=rastreador',
}));

vi.mock('next/headers', () => ({
  headers: () => Promise.resolve(new Headers({ cookie: cookieHeader.value })),
}));
vi.mock('next/navigation', () => ({ redirect, useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../../../../lib/wallet', () => ({ readPortfolio }));
// os logos das ações (lib/logos.ts, só do servidor): o índice vazio, só monogramas
vi.mock('../../../../lib/logos', () => ({ versoesDosLogos: () => Promise.resolve(new Map()) }));

const { default: WalletPage, metadata } = await import('./page');

// Corta cada elemento aria-hidden com tudo o que ele tem dentro (as rodas do contador da Arc, o logo).
function semEscondido(markup: string): string {
  let out = markup;
  for (
    let start = out.search(/<\w+[^>]*aria-hidden="true"/);
    start >= 0;
    start = out.search(/<\w+[^>]*aria-hidden="true"/)
  ) {
    const tag = /^<(\w+)/.exec(out.slice(start))![1]!;
    const re = new RegExp(`<${tag}\\b[^>]*?(/?)>|</${tag}>`, 'g');
    re.lastIndex = start;
    let depth = 0;
    for (let m = re.exec(out); m; m = re.exec(out)) {
      if (m[0].startsWith('</')) depth -= 1;
      else if (m[1] !== '/') depth += 1;
      if (depth === 0) {
        out = out.slice(0, start) + out.slice(re.lastIndex);
        break;
      }
    }
  }
  return out;
}

const SEM_FECHAMENTO = {
  closeCents: null,
  closeDate: null,
  valueCents: null,
  pnlCents: null,
  pnlBps: null,
} as const;

const lot = (id: string, ticker: string, over: Partial<Portfolio['lots'][number]> = {}) => ({
  id,
  ticker,
  quantity: 100,
  costCents: 355_000,
  boughtOn: '2026-10-15',
  createdAt: '2026-11-03T12:00:00.000Z',
  updatedAt: '2026-11-03T12:00:00.000Z',
  ...over,
});

const EMPTY: Portfolio = {
  lots: [],
  positions: [],
  totals: {
    costCents: 0,
    pricedCostCents: 0,
    valueCents: null,
    pnlCents: null,
    pnlBps: null,
    unpriced: 0,
  },
};

const WITH_LOTS: Portfolio = {
  lots: [
    lot('01JABCDEFGHJKMNPQRSTVWXYZ0', 'MOVE3'),
    lot('01JABCDEFGHJKMNPQRSTVWXYZ1', 'SEMN3', { quantity: 10, costCents: 20_000 }),
  ],
  positions: [
    {
      ticker: 'MOVE3',
      quantity: 100,
      costCents: 355_000,
      avgPriceCents: 3_550,
      closeCents: 4_000,
      closeDate: '2026-11-09',
      valueCents: 400_000,
      pnlCents: 45_000,
      pnlBps: 1_268,
    },
    {
      ticker: 'SEMN3',
      quantity: 10,
      costCents: 20_000,
      avgPriceCents: 2_000,
      ...SEM_FECHAMENTO,
    },
  ],
  totals: {
    costCents: 375_000,
    pricedCostCents: 355_000,
    valueCents: 400_000,
    pnlCents: 45_000,
    pnlBps: 1_268,
    unpriced: 1,
  },
};

const plain = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const render = async () => renderToStaticMarkup(await WalletPage({}));

beforeEach(() => {
  readPortfolio.mockReset();
  redirect.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('a página /carteira', () => {
  it('lê a api só com o cookie da sessão: o de um rastreador não vai', async () => {
    readPortfolio.mockResolvedValue(EMPTY);
    await render();
    expect(readPortfolio).toHaveBeenCalledTimes(1);
    expect(readPortfolio).toHaveBeenCalledWith('alvesting.session_token=a.b%2Bc');
  });

  it('sem cookie nenhum manda para a entrada, com o caminho de volta, e nem chama a api', async () => {
    cookieHeader.value = '_ga=so-rastreador';
    await expect(render()).rejects.toMatchObject({
      digest: 'NEXT_REDIRECT;/entrar?proximo=%2Fcarteira',
    });
    expect(redirect).toHaveBeenCalledWith('/entrar?proximo=%2Fcarteira');
    expect(readPortfolio).not.toHaveBeenCalled();
    cookieHeader.value = 'alvesting.session_token=a.b%2Bc; _ga=rastreador';
  });

  it('com a sessão que a api não reconhece (401) também manda para a entrada, com a volta', async () => {
    readPortfolio.mockRejectedValue(new ApiError(401, 'UNAUTHORIZED'));
    await expect(render()).rejects.toMatchObject({
      digest: 'NEXT_REDIRECT;/entrar?proximo=%2Fcarteira',
    });
  });

  it('com o aceite dos termos vencido (403 CONSENT_REQUIRED) vai para a conta, que mostra o texto novo e pede o aceite', async () => {
    readPortfolio.mockRejectedValue(new ApiError(403, 'CONSENT_REQUIRED'));
    await expect(render()).rejects.toMatchObject({ digest: 'NEXT_REDIRECT;/conta' });
  });

  it('a api fora do ar (ou fora do contrato, ou qualquer 403 que não é o do aceite) vira a tela de erro montada no servidor, e não um redirecionamento', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    for (const error of [
      new ApiError(503, 'UNAVAILABLE'),
      new ApiError(502, 'INVALID_RESPONSE'),
      new ApiError(500, 'INTERNAL_ERROR'),
      new ApiError(403, 'FORBIDDEN'),
    ]) {
      readPortfolio.mockRejectedValue(error);
      const out = await render();
      expect(out, String(error)).toContain('Não foi possível carregar os dados');
    }
    expect(redirect).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it('um erro que não é da api (um bug) sobe: não é "a arena não respondeu"', async () => {
    readPortfolio.mockRejectedValue(new TypeError('bug'));
    await expect(render()).rejects.toThrow('bug');
  });

  it('a carteira vazia: o título, os dois avisos, o empty state e o formulário; sem resumo nem posições', async () => {
    readPortfolio.mockResolvedValue(EMPTY);
    const out = await render();
    expect(out).toContain('>Minha carteira</h1>');
    expect(plain(out)).toContain(
      'Valores estimados pelo último fechamento disponível; não é recomendação de investimento.',
    );
    expect(plain(out)).toContain(
      'Ela não compra nem vende nada, não fala com a sua corretora e não confere os lançamentos',
    );
    expect(plain(out)).toContain('Você ainda não lançou nenhuma compra.');
    expect(out).toContain('>Lançar uma compra</h2>');
    expect(out).not.toContain('id="resumo"');
    expect(out).not.toContain('id="posicoes"');
    expect(out).not.toContain('Posições da carteira');
  });

  it('o aviso de JavaScript: lançar, editar e apagar precisam dele, e o resto da página se lê sem ele', async () => {
    readPortfolio.mockResolvedValue(WITH_LOTS);
    const out = await render();
    expect(out).toMatch(
      /<noscript><p[^>]*>Lançar, editar e apagar compras precisam de JavaScript\./,
    );
    // o que é só leitura está no HTML do servidor
    expect(out).toContain('id="resumo"');
    expect(out).toContain('id="posicoes"');
  });

  it('com lançamentos: o resumo, a tabela de posições (com o ticker sem cotação) e os cartões, nesta ordem', async () => {
    readPortfolio.mockResolvedValue(WITH_LOTS);
    const out = await render();
    const order = ['id="resumo"', 'id="posicoes"', 'id="lancamentos"', 'id="lancar"'].map((id) =>
      out.indexOf(id),
    );
    expect(order.every((i) => i > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // o texto que o leitor de tela lê: sem as rodas dos algarismos do contador (aria-hidden), que levam o número inteiro num sr-only
    const text = plain(semEscondido(out));
    expect(text).toContain('Custo total R$ 3.750,00');
    expect(text).toContain('Valor estimado R$ 4.000,00');
    expect(text).toContain('Resultado +R$ 450,00 (+12,68%, ganho)');
    expect(text).toContain('1 posição está sem cotação');
    // o crédito das cotações aparece onde a tela mostra o fechamento (a brapi, fonte única; docs/API.md, seção 6)
    expect(text).toContain('Cotações: brapi.dev.');
    expect(text).toContain(
      'MOVE3 R$ 4.000,00 +R$ 450,00 +12,68% · ganho 100 R$ 35,50 R$ 40,00 em 09/11/2026',
    );
    expect(text).toContain('SEMN3 sem cotação — 10 R$ 20,00 —');
    // um cartão por lançamento
    expect(out.match(/data-lot="/g)).toHaveLength(2);
  });

  it('o seletor de data para no dia de hoje em BRASÍLIA, e não no do servidor (UTC)', async () => {
    readPortfolio.mockResolvedValue(EMPTY);
    // 09/11/2026 02:00 em UTC ainda é 08/11, 23:00 em Brasília
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-09T02:00:00.000Z'));
    const night = await render();
    expect(night).toMatch(/<input[^>]*type="date"[^>]*max="2026-11-08"/);
    vi.setSystemTime(new Date('2026-11-09T13:00:00.000Z'));
    const noon = await render();
    expect(noon).toMatch(/<input[^>]*type="date"[^>]*max="2026-11-09"/);
  });

  it('a página não é indexada (a carteira de ninguém é conteúdo público) e tem título próprio', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.title).toBe('Minha carteira');
  });
});
