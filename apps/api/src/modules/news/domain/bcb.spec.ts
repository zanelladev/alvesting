import { describe, expect, it } from 'vitest';
import {
  MACRO_SERIES,
  isNoValuesResponse,
  missingWindow,
  parseSgs,
  sgsUrl,
  type MacroSeries,
} from './bcb.js';

// Respostas do SGS no formato de verdade (conferido em 01/11/2026): lista de { data: "dd/MM/aaaa", valor: "texto" }.
const series = (id: string): MacroSeries => MACRO_SERIES.find((s) => s.id === id)!;
const cdi = series('cdi_daily_pct');
const selic = series('selic_target_pct_year');
const ipca = series('ipca_month_pct');
const ptax = series('usd_brl_ptax_sell');

describe('MACRO_SERIES', () => {
  it('tem CDI (SGS 12), Selic, IPCA e dólar PTAX de venda (SGS 1)', () => {
    expect(MACRO_SERIES.map((s) => [s.id, s.code])).toEqual([
      ['cdi_daily_pct', 12],
      ['selic_target_pct_year', 432],
      ['ipca_month_pct', 433],
      ['ipca_12m_pct', 13522],
      ['usd_brl_ptax_sell', 1],
    ]);
  });

  it('os ids valem como série no banco e os códigos e as casas decimais são inteiros', () => {
    for (const s of MACRO_SERIES) {
      expect(s.id).toMatch(/^[a-z0-9_]+$/);
      expect(s.id.length).toBeLessThanOrEqual(32);
      expect(Number.isInteger(s.code) && s.code > 0).toBe(true);
      expect(Number.isInteger(s.scale) && s.scale >= 0 && s.scale <= 8).toBe(true);
    }
    expect(new Set(MACRO_SERIES.map((s) => s.id)).size).toBe(MACRO_SERIES.length);
  });
});

describe('sgsUrl', () => {
  it('pede a série do SGS pelo código, em JSON, com a janela em dd/MM/aaaa', () => {
    const url = new URL(sgsUrl(cdi, '2026-10-26', '2026-11-01'));
    expect(url.origin).toBe('https://api.bcb.gov.br');
    expect(url.pathname).toBe('/dados/serie/bcdata.sgs.12/dados');
    expect(url.searchParams.get('formato')).toBe('json');
    expect(url.searchParams.get('dataInicial')).toBe('26/10/2026');
    expect(url.searchParams.get('dataFinal')).toBe('01/11/2026');
  });
});

describe('parseSgs', () => {
  it('lê as datas e normaliza o valor para texto decimal com as casas da série', () => {
    expect(
      parseSgs(cdi, [
        { data: '26/10/2026', valor: '0.050788' },
        { data: '27/10/2026', valor: '0.050788' },
      ]),
    ).toEqual([
      { date: '2026-10-26', value: '0.050788' },
      { date: '2026-10-27', value: '0.050788' },
    ]);
    expect(parseSgs(selic, [{ data: '01/11/2026', valor: '13.7' }])).toEqual([
      { date: '2026-11-01', value: '13.70' },
    ]);
    expect(parseSgs(selic, [{ data: '01/11/2026', valor: '14' }])[0]?.value).toBe('14.00');
    expect(parseSgs(ptax, [{ data: '30/10/2026', valor: '5.4212' }])[0]?.value).toBe('5.4212');
  });

  it('aceita negativo (deflação) e não deixa "-0.00"', () => {
    expect(parseSgs(ipca, [{ data: '01/08/2026', valor: '-0.32' }])[0]?.value).toBe('-0.32');
    expect(parseSgs(ipca, [{ data: '01/08/2026', valor: '-0.00' }])[0]?.value).toBe('0.00');
  });

  it('zeros além das casas da série são aceitos; dígito além delas, não (a fonte mudou)', () => {
    expect(parseSgs(ptax, [{ data: '30/10/2026', valor: '5.42120' }])[0]?.value).toBe('5.4212');
    expect(() => parseSgs(ptax, [{ data: '30/10/2026', valor: '5.42129' }])).toThrow(/casas/);
  });

  it('ordena por data e, na data repetida, vale o último', () => {
    expect(
      parseSgs(ipca, [
        { data: '01/09/2026', valor: '0.82' },
        { data: '01/08/2026', valor: '-0.32' },
        { data: '01/09/2026', valor: '0.83' },
      ]),
    ).toEqual([
      { date: '2026-08-01', value: '-0.32' },
      { date: '2026-09-01', value: '0.83' },
    ]);
  });

  it('valor vazio é ponto sem dado e é pulado', () => {
    expect(parseSgs(cdi, [{ data: '26/10/2026', valor: '' }])).toEqual([]);
    expect(parseSgs(cdi, [])).toEqual([]);
  });

  it('formato inesperado falha em vez de gravar lixo', () => {
    for (const body of [
      null,
      {},
      'texto',
      { error: 'x' },
      [{ data: '2026-10-26', valor: '0.05' }],
      [{ data: '31/02/2026', valor: '0.05' }],
      [{ data: '26/10/2026', valor: 'abc' }],
      [{ data: '26/10/2026', valor: '1e3' }],
      [{ data: '26/10/2026', valor: '0,05' }],
      [{ data: '26/10/2026', valor: 0.05 }],
      [{ data: '26/10/2026' }],
      [null],
      ['x'],
    ]) {
      expect(() => parseSgs(cdi, body), JSON.stringify(body)).toThrow();
    }
  });

  it('lista absurdamente grande falha', () => {
    const body = Array.from({ length: 6000 }, () => ({ data: '26/10/2026', valor: '0.05' }));
    expect(() => parseSgs(cdi, body)).toThrow(/pontos/);
  });

  // Um ponto datado de 2099 faria lastDates() devolver 2099, e missingWindow() daria null para sempre: a série nunca mais
  // seria buscada, sem erro (revisão de segurança). O SGS respeita dataFinal; ponto fora da janela pedida é resposta errada.
  describe('com a janela pedida', () => {
    const window = { from: '2026-10-26', to: '2026-11-01' } as const;

    it('os pontos dentro dela, inclusive nas pontas, passam', () => {
      expect(
        parseSgs(
          cdi,
          [
            { data: '26/10/2026', valor: '0.05' },
            { data: '29/10/2026', valor: '0.06' },
            { data: '01/11/2026', valor: '0.07' },
          ],
          window,
        ).map((p) => p.date),
      ).toEqual(['2026-10-26', '2026-10-29', '2026-11-01']);
    });

    for (const data of ['25/10/2026', '02/11/2026', '01/01/2099', '01/01/1900']) {
      it(`ponto de ${data} falha, mesmo com os outros em ordem`, () => {
        expect(() =>
          parseSgs(
            cdi,
            [
              { data: '29/10/2026', valor: '0.05' },
              { data, valor: '0.05' },
            ],
            window,
          ),
        ).toThrow(/fora da janela/);
      });
    }

    it('ponto sem dado (valor vazio) fora da janela não conta: não vira nada', () => {
      expect(parseSgs(cdi, [{ data: '01/01/2099', valor: '' }], window)).toEqual([]);
    });

    // O SGS data o valor mensal no dia 1 e devolve o mês que contém a dataInicial (conferido em 06/11/2026: o 433 e o 13522
    // pedidos a partir de 02/10/2025 começam em 01/10/2025). Sem a exceção, a primeira carga do IPCA (400 dias para trás) falhava
    // em todo dia que não fosse dia 1. O CDI acima continua estrito: o ponto de 25/10, um dia antes do início, falha.
    it('na série mensal, o dia 1 do mês em que a janela começa passa; o mês anterior e o futuro, não', () => {
      const pedida = { from: '2025-10-02', to: '2026-11-06' } as const;
      expect(
        parseSgs(
          ipca,
          [
            { data: '01/10/2025', valor: '0.09' },
            { data: '01/09/2026', valor: '0.82' },
          ],
          pedida,
        ).map((p) => p.date),
      ).toEqual(['2025-10-01', '2026-09-01']);
      for (const data of ['01/09/2025', '01/12/2026']) {
        expect(() => parseSgs(ipca, [{ data, valor: '0.09' }], pedida)).toThrow(/fora da janela/);
      }
    });

    it('as séries mensais são as duas do IPCA', () => {
      expect(MACRO_SERIES.filter((s) => s.monthly).map((s) => s.id)).toEqual([
        'ipca_month_pct',
        'ipca_12m_pct',
      ]);
    });
  });
});

describe('missingWindow: busca só o que falta', () => {
  it('série vazia: pede cerca de um ano até hoje', () => {
    expect(missingWindow(null, '2026-11-01')).toEqual({ from: '2025-09-27', to: '2026-11-01' });
  });

  // O SGS recusa janela de um dia só (HTTP 400, "DataFinal deve ser maior que dataInicial") e responde 404 a janela sem
  // dado. Por isso a janela começa no último dia guardado, e não no seguinte: sempre tem mais de um dia, traz de
  // volta o último ponto (que não muda nada) e ainda pega uma revisão dele.
  it('série com histórico: pede do último dia guardado até hoje, nunca uma janela de um dia só', () => {
    expect(missingWindow('2026-10-29', '2026-11-01')).toEqual({
      from: '2026-10-29',
      to: '2026-11-01',
    });
    expect(missingWindow('2026-10-31', '2026-11-01')).toEqual({
      from: '2026-10-31',
      to: '2026-11-01',
    });
    for (const [last, today] of [
      ['2026-10-31', '2026-11-01'],
      ['2026-09-01', '2026-11-01'],
      ['2025-09-29', '2026-11-01'],
    ] as const) {
      const window = missingWindow(last, today)!;
      expect(window.from < window.to).toBe(true);
    }
  });

  it('já tem até hoje (ou além, como a meta Selic projetada): não pede nada', () => {
    expect(missingWindow('2026-11-01', '2026-11-01')).toBeNull();
    expect(missingWindow('2026-11-04', '2026-11-01')).toBeNull();
  });
});

describe('isNoValuesResponse: o 404 do SGS para janela sem dado', () => {
  it('reconhece o corpo de "valor não encontrado" e nada mais', () => {
    const body = (detail: string) =>
      Buffer.from(JSON.stringify({ erro: { statusCode: 404, detail } }));
    expect(
      isNoValuesResponse(
        body('br.gov.bcb.pec.sgs.comum.excecoes.SGSNegocioException: Value(s) not found'),
      ),
    ).toBe(true);
    expect(isNoValuesResponse(body('Valor(es) não encontrado(s)'))).toBe(true);
    expect(isNoValuesResponse(body('Série inexistente'))).toBe(false);
    expect(isNoValuesResponse(Buffer.from('<html>404</html>'))).toBe(false);
    expect(isNoValuesResponse(Buffer.from('{"erro":"outra coisa"}'))).toBe(false);
    expect(isNoValuesResponse(Buffer.from('null'))).toBe(false);
    expect(isNoValuesResponse(Buffer.alloc(0))).toBe(false);
  });
});
