import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SeasonFileError } from '../modules/arena/application/season.service.js';
import { loadTradingCalendar } from '../modules/market-data/domain/trading-calendar.js';
import { parseDatedSeasonFile, seasonSessions, sessionCostMicro } from './plan.js';

const file = JSON.parse(
  readFileSync(new URL('../../seasons/temporada-1.json', import.meta.url), 'utf8'),
) as Record<string, unknown>;

describe('parseDatedSeasonFile: o arquivo da temporada com a data do primeiro pregão', () => {
  it('lê a data e valida o resto com o schema do season:create', () => {
    const dated = parseDatedSeasonFile(file);
    expect(dated.startDate).toBe('2026-10-13');
    expect(dated.file.slug).toBe('temporada-1');
  });

  it('sem a data, ou com chave a mais, recusa dizendo o campo e nunca o valor', () => {
    const { startDate: _startDate, ...withoutDate } = file;
    expect(() => parseDatedSeasonFile(withoutDate)).toThrow(/startDate: a data do primeiro pregão/);
    const withSecret = { ...file, apiKey: 'sk-or-segredo-de-teste' };
    expect(() => parseDatedSeasonFile(withSecret)).toThrow(SeasonFileError);
    expect(() => parseDatedSeasonFile(withSecret)).not.toThrow(/sk-or-segredo/);
    expect(() => parseDatedSeasonFile([file])).toThrow(/esperava um objeto/);
  });

  it('o primeiro pregão tem de ser pregão (12/10/2026 foi feriado)', () => {
    const dated = parseDatedSeasonFile({ ...file, startDate: '2026-10-12' });
    expect(() => seasonSessions(dated, loadTradingCalendar())).toThrow(/não é pregão/);
  });
});

// As contas à mão, com os preços do arquivo (US$ por milhão de tokens = micro-dólares por token):
//  - típico, 20 mil de entrada e 6 mil de saída: Opus 20.000 x 4 + 6.000 x 20 = 80.000 + 120.000 = 200.000; GPT e Gemini 40.000 + 60.000 =
//    100.000 cada; Grok e Qwen 40.000 + 36.000 = 76.000 cada; DeepSeek 20.000 x 0,1165 + 6.000 x 4,66 = 2.330 + 27.960 = 30.290. Soma 582.290
//    micro-dólares, US$ 0,58 por pregão;
//  - pior caso, as duas chamadas (27 mil + 43 mil de entrada, 16 mil + 16 mil de saída): Opus 70.000 x 4 + 32.000 x 20 = 920.000; GPT e Gemini
//    140.000 + 320.000 = 460.000 cada; Grok e Qwen 140.000 + 192.000 = 332.000 cada; DeepSeek 27.000 x 0,1165 = 3.145,5, que sobe para 3.146 (cada
//    chamada arredonda para cima, pricedCostMicro), mais 43.000 x 0,1165 = 5.009,5, que sobe para 5.010, e 32.000 x 4,66 = 149.120: 157.276. Soma
//    2.661.276, US$ 2,66 por pregão.
describe('sessionCostMicro: o custo de um pregão pelos preços do arquivo', () => {
  const competitors = parseDatedSeasonFile(file).file.competitors;

  it('o típico e o pior caso batem com a conta à mão', () => {
    expect(sessionCostMicro(competitors, 'typical')).toBe(582_290n);
    expect(sessionCostMicro(competitors, 'worst')).toBe(2_661_276n);
  });

  it('o fake custa zero, e o modelo pago sem a tabela de preços é recusado (a estimativa não pode ser zero por esquecimento)', () => {
    const fake = {
      kind: 'MODEL',
      slug: 'f',
      name: 'F',
      provider: 'fake',
      modelId: 'fake/x',
    } as const;
    expect(
      sessionCostMicro(
        [{ ...fake, capabilities: { jsonSchema: false, reasoningEffort: false } }],
        'worst',
      ),
    ).toBe(0n);
    const paid = {
      kind: 'MODEL',
      slug: 'sem-preco',
      name: 'Sem preço',
      provider: 'openrouter',
      modelId: 'lab/modelo',
      capabilities: { jsonSchema: true, reasoningEffort: true },
    } as const;
    expect(() => sessionCostMicro([paid], 'typical')).toThrow(/sem-preco.pricingUsdPerMTok/);
  });
});
