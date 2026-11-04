import { describe, expect, it } from 'vitest';
import {
  BUY_PERCENT_OF_EQUITY,
  MAX_ORDERS_PER_CYCLE,
  SELL_PERCENT_OF_POSITION,
} from './llm-decision.js';
import {
  competitorSpecSchema,
  isValidModelId,
  seasonFileSchema,
  seasonParamsSchema,
} from './season.js';

const seeds = { randomSeed: 'sorteio-t0', monteCarloSeed: 'monte-carlo-t0' };

const fakeModel = (slug: string, overrides: Record<string, unknown> = {}) => ({
  kind: 'MODEL',
  slug,
  name: `Modelo ${slug}`,
  provider: 'fake',
  modelId: `fake/${slug}`,
  ...overrides,
});
const roster = (models: unknown[] = [fakeModel('a'), fakeModel('b')]) => [
  ...models,
  { kind: 'RANDOM', slug: 'sorteio', name: 'Sorteio' },
  { kind: 'BENCHMARK', slug: 'igual-peso', name: 'Igual-peso', benchmark: 'EQUAL_WEIGHT' },
  { kind: 'BENCHMARK', slug: 'cdi', name: 'CDI', benchmark: 'CDI' },
  { kind: 'BENCHMARK', slug: 'bova11', name: 'BOVA11', benchmark: 'BOVA11' },
];
const file = (overrides: Record<string, unknown> = {}) => ({
  slug: 'temporada-x',
  name: 'Temporada X',
  params: seeds,
  competitors: roster(),
  ...overrides,
});
const issues = (value: unknown) => {
  const result = seasonFileSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
};

describe('seasonParamsSchema: o plano (2) como padrão', () => {
  it('só as sementes são obrigatórias; o resto vem dos padrões do plano', () => {
    expect(seasonParamsSchema.parse(seeds)).toEqual({
      capitalCents: 10_000_000, // R$ 100.000,00 em centavos
      sessions: 20,
      maxPositions: 10,
      maxOrdersPerCycle: 5,
      buyPercentOfEquity: [5, 25],
      sellPercentOfPosition: [1, 100],
      tradeCostBps: 3, // 0,03%
      decisionTimeBrt: '08:00',
      deadlineTimeBrt: '09:30',
      randomSeed: 'sorteio-t0',
      monteCarloSeed: 'monte-carlo-t0',
      monteCarloRuns: 1000,
    });
  });

  it('o limite de ordens e as faixas de BUY e SELL são os do contrato da decisão', () => {
    const params = seasonParamsSchema.parse(seeds);
    expect(params.maxOrdersPerCycle).toBe(MAX_ORDERS_PER_CYCLE);
    expect(params.buyPercentOfEquity).toEqual([...BUY_PERCENT_OF_EQUITY]);
    expect(params.sellPercentOfPosition).toEqual([...SELL_PERCENT_OF_POSITION]);
  });

  it.each([
    ['maxOrdersPerCycle', 7],
    ['buyPercentOfEquity', [1, 50]],
    ['sellPercentOfPosition', [10, 100]],
  ])(
    '%s diferente do contrato é recusado (o validador da resposta usa o contrato)',
    (key, value) => {
      expect(seasonParamsSchema.safeParse({ ...seeds, [key]: value }).success).toBe(false);
    },
  );

  it('exige as duas sementes e recusa semente vazia ou enorme', () => {
    expect(seasonParamsSchema.safeParse({ randomSeed: 'x' }).success).toBe(false);
    expect(seasonParamsSchema.safeParse({ ...seeds, randomSeed: '  ' }).success).toBe(false);
    expect(seasonParamsSchema.safeParse({ ...seeds, monteCarloSeed: 'x'.repeat(65) }).success).toBe(
      false,
    );
  });

  it.each([
    ['capitalCents', 10_000.5],
    ['capitalCents', 0],
    ['capitalCents', 2 ** 53],
    ['sessions', 0],
    ['sessions', 61],
    ['tradeCostBps', -1],
    ['tradeCostBps', 0.5],
    ['monteCarloRuns', 0],
    ['maxPositions', 0],
    ['decisionTimeBrt', '8:00'],
    ['deadlineTimeBrt', '24:00'],
  ])('recusa %s = %s (dinheiro só em centavos inteiros, horas HH:MM)', (key, value) => {
    expect(seasonParamsSchema.safeParse({ ...seeds, [key]: value }).success).toBe(false);
  });

  it('o prazo vem depois da hora da decisão', () => {
    const result = seasonParamsSchema.safeParse({
      ...seeds,
      decisionTimeBrt: '09:30',
      deadlineTimeBrt: '08:00',
    });
    expect(result.success).toBe(false);
  });

  it('recusa chave desconhecida', () => {
    expect(seasonParamsSchema.safeParse({ ...seeds, leverage: 2 }).success).toBe(false);
  });
});

describe('competidor', () => {
  it('MODEL fake com o ID fixado; os recursos do provedor começam desligados', () => {
    const parsed = competitorSpecSchema.parse(fakeModel('a'));
    expect(parsed).toMatchObject({
      kind: 'MODEL',
      provider: 'fake',
      modelId: 'fake/a',
      capabilities: { jsonSchema: false, reasoningEffort: false },
    });
  });

  it('MODEL do OpenRouter com o ID da lista pública e os preços', () => {
    const parsed = competitorSpecSchema.parse(
      fakeModel('claude', {
        provider: 'openrouter',
        modelId: 'anthropic/claude-opus-5.5',
        capabilities: { jsonSchema: true, reasoningEffort: true },
        pricingUsdPerMTok: { input: '4', output: '20' },
      }),
    );
    expect(parsed).toMatchObject({ pricingUsdPerMTok: { input: '4', output: '20' } });
  });

  it.each([
    ['roteador do OpenRouter, que escolhe o modelo por conta própria', 'openrouter/auto'],
    ['ID sem laboratório', 'claude-opus'],
    ['ID com espaço', 'anthropic/claude opus'],
    ['ID vazio', ''],
    // o sufixo de variante muda o que é chamado: busca na web, roteamento, serviço gratuito ou em lote
    ['variante que liga a busca na web', 'x-ai/grok-4.7:online'],
    ['variante que muda o roteamento (:nitro)', 'anthropic/claude-opus-5.5:nitro'],
    ['variante que muda o roteamento (:floor)', 'anthropic/claude-opus-5.5:floor'],
    ['variante gratuita', 'recursive/flint-v1.0:free'],
    ['variante em lote', 'openai/gpt-6.1-sol:batch'],
  ])('OpenRouter recusa %s', (_nome, modelId) => {
    const result = competitorSpecSchema.safeParse(
      fakeModel('x', { provider: 'openrouter', modelId }),
    );
    expect(result.success).toBe(false);
    // a mesma regra, como função: o job de decisões a reaplica ao ler o competidor do banco (arena.repository.ts, competitorById)
    expect(isValidModelId('openrouter', modelId)).toBe(false);
  });

  it('isValidModelId aceita o que o arquivo aceita, por provedor, e nunca um ID de roteador nem acima de 128 caracteres', () => {
    expect(isValidModelId('openrouter', 'anthropic/claude-opus-5.5')).toBe(true);
    expect(isValidModelId('azure-openai', 'gpt-4.1-mini')).toBe(true);
    expect(isValidModelId('fake', 'fake/deterministic-a')).toBe(true);
    // o ID de um provedor não vale em outro
    expect(isValidModelId('fake', 'anthropic/claude-opus-5.5')).toBe(false);
    expect(isValidModelId('openrouter', 'gpt-4.1-mini')).toBe(false);
    expect(isValidModelId('azure-openai', 'openrouter/auto')).toBe(false);
    expect(isValidModelId('openrouter', `a/${'b'.repeat(126)}`)).toBe(true); // 128 caracteres
    expect(isValidModelId('openrouter', `a/${'b'.repeat(127)}`)).toBe(false); // 129
  });

  it('fake só aceita ID fake/..., e o Azure aceita o nome da implantação (com os preços)', () => {
    expect(competitorSpecSchema.safeParse(fakeModel('x', { modelId: 'gpt-4.1' })).success).toBe(
      false,
    );
    expect(
      competitorSpecSchema.safeParse(
        fakeModel('x', {
          provider: 'azure-openai',
          modelId: 'gpt-4.1-mini',
          pricingUsdPerMTok: { input: '0.4', output: '1.6' },
        }),
      ).success,
    ).toBe(true);
  });

  it('o Azure OpenAI não devolve o custo: sem a tabela de preços o competidor é recusado', () => {
    const result = competitorSpecSchema.safeParse(
      fakeModel('x', { provider: 'azure-openai', modelId: 'gpt-4.1-mini' }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path)).toEqual([['pricingUsdPerMTok']]);
    }
    // no OpenRouter a tabela é só reserva (o usage.cost vale mais), e o fake custa zero
    expect(
      competitorSpecSchema.safeParse(
        fakeModel('x', { provider: 'openrouter', modelId: 'anthropic/claude-opus-5.5' }),
      ).success,
    ).toBe(true);
  });

  it('provedor desconhecido, preço em float de texto torto e campo sobrando são recusados', () => {
    expect(competitorSpecSchema.safeParse(fakeModel('x', { provider: 'openai' })).success).toBe(
      false,
    );
    expect(
      competitorSpecSchema.safeParse(
        fakeModel('x', { pricingUsdPerMTok: { input: '1e3', output: '2' } }),
      ).success,
    ).toBe(false);
    expect(competitorSpecSchema.safeParse(fakeModel('x', { apiKey: 'segredo' })).success).toBe(
      false,
    );
  });

  it('slug em kebab-case', () => {
    expect(competitorSpecSchema.safeParse(fakeModel('Claude Opus')).success).toBe(false);
  });
});

describe('seasonFileSchema: o elenco', () => {
  it('aceita o elenco completo: modelos, Sorteio e as três referências', () => {
    const parsed = seasonFileSchema.parse(file());
    expect(parsed.competitors).toHaveLength(6);
    expect(parsed.params.capitalCents).toBe(10_000_000);
  });

  it('exige ao menos um MODEL, e não passa de 30', () => {
    expect(issues(file({ competitors: roster([]) })).join()).toMatch(/pelo menos um modelo/);
    const many = Array.from({ length: 31 }, (_, i) => fakeModel(`m${i}`));
    expect(issues(file({ competitors: roster(many) })).join()).toMatch(/no máximo 30/);
  });

  it('exige exatamente um Sorteio e as três referências, cada uma uma vez', () => {
    const without = (slug: string) => roster().filter((c) => (c as { slug: string }).slug !== slug);
    expect(issues(file({ competitors: without('sorteio') })).join()).toMatch(/Sorteio/);
    expect(issues(file({ competitors: without('cdi') })).join()).toMatch(/CDI/);
    expect(issues(file({ competitors: without('bova11') })).join()).toMatch(/BOVA11/);
    expect(
      issues(
        file({ competitors: [...roster(), { kind: 'RANDOM', slug: 'sorteio-2', name: 'Outro' }] }),
      ).join(),
    ).toMatch(/Sorteio/);
    expect(
      issues(
        file({
          competitors: [
            ...roster(),
            { kind: 'BENCHMARK', slug: 'cdi-2', name: 'CDI 2', benchmark: 'CDI' },
          ],
        }),
      ).join(),
    ).toMatch(/CDI/);
  });

  it('o slug de cada competidor é único', () => {
    expect(issues(file({ competitors: roster([fakeModel('a'), fakeModel('a')]) })).join()).toMatch(
      /repetido/,
    );
  });

  it('recusa competidor BENCHMARK sem referência e MODEL com campo de benchmark', () => {
    expect(
      competitorSpecSchema.safeParse({ kind: 'BENCHMARK', slug: 'x', name: 'X' }).success,
    ).toBe(false);
    expect(competitorSpecSchema.safeParse(fakeModel('x', { benchmark: 'CDI' })).success).toBe(
      false,
    );
  });

  it('o arquivo inteiro é estrito: chave a mais (segredo inclusive) é recusada', () => {
    expect(seasonFileSchema.safeParse(file({ openrouterApiKey: 'sk-or-x' })).success).toBe(false);
  });
});
