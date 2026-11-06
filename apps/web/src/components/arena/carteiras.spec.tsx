import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CompetitorDetail } from '@alvesting/contracts';
import { BarraCarteiras, ratioBps } from './carteiras';

// A barra "Carteiras" da arena (plano do redesenho, e.2): a alocação é o valor da posição sobre o patrimônio, e o resultado % é o resultado
// sobre o custo, os dois em pontos-base inteiros, com o meio para longe do zero (a regra do projeto, docs/METODOLOGIA.md). O e2e confere os
// números contra a api; aqui entram os casos que o banco sintético não tem.
describe('ratioBps', () => {
  it('a parte sobre o todo em pontos-base, o meio para longe do zero', () => {
    expect(ratioBps(1, 3)).toBe(3_333);
    expect(ratioBps(2, 3)).toBe(6_667);
    expect(ratioBps(1, 20_000)).toBe(1);
    expect(ratioBps(-1, 20_000)).toBe(-1);
    expect(ratioBps(-6_520, 492_916)).toBe(-132);
    expect(ratioBps(0, 100)).toBe(0);
  });

  it('o todo que não é positivo não tem razão: nulo, e a tela mostra o traço', () => {
    expect(ratioBps(5, 0)).toBeNull();
    expect(ratioBps(5, -1)).toBeNull();
  });

  it('valores no teto do inteiro seguro não perdem precisão', () => {
    expect(ratioBps(Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toBe(10_000);
  });
});

const detail = (over: Partial<CompetitorDetail> = {}): CompetitorDetail => ({
  season: {} as CompetitorDetail['season'],
  competitor: {
    slug: 'claude-opus-5-5',
    name: 'Claude Opus 5.5',
    type: 'MODEL',
    provider: 'fake',
    modelId: 'fake/momentum',
  },
  stat: null,
  portfolio: {
    date: '2026-11-09',
    equityCents: 10_000_000,
    holdings: {
      cashCents: 9_000_000,
      positionsValueCents: 1_000_000,
      positions: [
        {
          ticker: 'MOVE3',
          quantity: 10,
          costCents: 800_000,
          avgPriceCents: 80_000,
          markCents: 100_000,
          valueCents: 1_000_000,
          pnlCents: 200_000,
          stale: false,
        },
      ],
    },
  },
  series: { dates: [], equityCents: [] },
  decisions: [],
  ...over,
});

describe('BarraCarteiras', () => {
  const html = (carteiras: CompetitorDetail[]) =>
    renderToStaticMarkup(<BarraCarteiras carteiras={carteiras} capitalCents={10_000_000} />);

  it('uma tabela por modelo: o ticker, a alocação com o anel, o resultado e o resultado %, com a direção', () => {
    const out = html([detail()]);
    expect(out).toContain(
      '<caption class="sr-only">Carteira de Claude Opus 5.5 em 09/11/2026</caption>',
    );
    expect(out).toContain('href="/acoes/MOVE3"');
    // 1.000.000 / 10.000.000 = 10%; 200.000 / 800.000 = 25%
    expect(out).toContain('10,00%');
    expect(out).toMatch(/data-dir="up"[^>]*>\+R\$\u00a02\.000,00</);
    expect(out).toMatch(/data-dir="up"[^>]*>\+25,00%</);
    // o anel é decorativo: o número está ao lado, em texto
    expect(out).toMatch(/<svg[^>]*aria-hidden="true"/);
    // o pé: o resultado da temporada (patrimônio menos o capital) e o caixa
    expect(out).toMatch(/<dt[^>]*>Resultado<\/dt><dd[^>]*data-dir="flat"[^>]*>R\$\u00a00,00<\/dd>/);
    expect(out).toMatch(/<dt[^>]*>Caixa<\/dt><dd[^>]*>R\$\u00a090\.000,00<\/dd>/);
  });

  it('a carteira sem posição e a de antes da primeira liquidação dizem o que há, sem tabela', () => {
    const empty = html([
      detail({
        portfolio: {
          date: '2026-11-09',
          equityCents: 10_000_000,
          holdings: { cashCents: 10_000_000, positionsValueCents: 0, positions: [] },
        },
      }),
    ]);
    expect(empty).toContain('Nenhuma posição: o patrimônio está todo em caixa.');
    expect(empty).not.toContain('<table');
    const before = html([detail({ portfolio: null })]);
    expect(before).toContain('A carteira aparece depois da primeira liquidação.');
    expect(before).not.toContain('<table');
    expect(html([])).toContain('As carteiras aparecem depois da primeira liquidação.');
  });

  it('o custo zero (o resultado % sem razão) é um traço, e não uma conta com zero', () => {
    const out = html([
      detail({
        portfolio: {
          date: '2026-11-09',
          equityCents: 10_000_000,
          holdings: {
            cashCents: 9_000_000,
            positionsValueCents: 1_000_000,
            positions: [
              {
                ticker: 'MOVE3',
                quantity: 10,
                costCents: 0,
                avgPriceCents: 0,
                markCents: 100_000,
                valueCents: 1_000_000,
                pnlCents: 1_000_000,
                stale: false,
              },
            ],
          },
        },
      }),
    ]);
    expect(out).toMatch(/<td[^>]*>—<\/td>/);
    expect(out).not.toMatch(/NaN|Infinity/);
  });
});
