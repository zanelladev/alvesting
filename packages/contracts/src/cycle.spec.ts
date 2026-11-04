import { describe, expect, it } from 'vitest';
import { cycleViewSchema, HOLD_REASONS } from './cycle.js';

const ulid = (suffix: string) => `01K000000000000000000000${suffix}`;
// o que o provedor aplicou, no formato que o DecideHandler grava (docs/ARENA.md, seção 3)
const applied = (overrides: Record<string, unknown> = {}) => ({
  provider: 'fake',
  requestedModel: 'fake/a',
  model: 'fake/a',
  upstreamProvider: null,
  finishReason: 'stop',
  costSource: 'provider',
  params: {
    maxOutputTokens: 16_000,
    reasoningEffort: null,
    jsonSchema: false,
    tools: false,
    requireParameters: false,
    dataCollection: null,
  },
  calls: 1,
  ...overrides,
});
const view = (overrides: Record<string, unknown> = {}) => ({
  id: ulid('01'),
  seasonId: ulid('02'),
  date: '2026-11-03',
  status: 'CLOSED',
  skipReason: null,
  decisionAt: '2026-11-03T11:00:00.000Z',
  deadlineAt: '2026-11-03T12:30:00.000Z',
  closedAt: '2026-11-03T11:01:00.000Z',
  prompt: { version: '0123456789abcdef0123456789abcdef', sha256: 'a'.repeat(64) },
  briefing: { sha256: 'b'.repeat(64) },
  decisions: [
    {
      competitor: { id: ulid('03'), slug: 'fake-a', name: 'Fake A' },
      status: 'DECIDED',
      holdReason: null,
      marketView: 'neutro',
      summary: 'Dia calmo.',
      inputSha256: 'c'.repeat(64),
      outputSha256: 'd'.repeat(64),
      costMicroUsd: 0,
      usage: {
        calls: 1,
        promptTokens: 10,
        completionTokens: 5,
        reasoningTokens: 0,
        totalTokens: 15,
      },
      applied: applied(),
      items: [
        {
          position: 0,
          action: 'BUY',
          ticker: 'WEGE3',
          percent: 10,
          confidence: 0.7,
          rationale: 'Resultado forte.',
        },
      ],
      dropped: [{ position: 1, reason: 'not_in_universe' }],
    },
  ],
  ...overrides,
});

describe('cycleViewSchema: a resposta pública do ciclo', () => {
  it('aceita um ciclo fechado com decisão normal', () => {
    expect(cycleViewSchema.safeParse(view()).success).toBe(true);
  });

  it('aceita o ciclo pulado, sem briefing, sem prompt e sem decisões', () => {
    const skipped = view({
      status: 'SKIPPED',
      skipReason: 'sem_briefing',
      closedAt: null,
      prompt: null,
      briefing: null,
      decisions: [],
    });
    expect(cycleViewSchema.safeParse(skipped).success).toBe(true);
  });

  it('o HOLD forçado leva o motivo, e os motivos conhecidos são fechados', () => {
    expect(HOLD_REASONS).toEqual([
      'prazo',
      'prompt_divergente',
      'resposta_invalida',
      'falha',
      'sem_resposta',
    ]);
  });

  it('o que o provedor aplicou também é estrito: campo a mais ou texto livre no lugar de um identificador não passam', () => {
    const withApplied = (value: unknown) => {
      const out = view();
      (out.decisions[0] as Record<string, unknown>).applied = value;
      return cycleViewSchema.safeParse(out).success;
    };
    expect(withApplied(applied())).toBe(true);
    expect(withApplied(null)).toBe(true);
    expect(withApplied(applied({ extra: 'x' }))).toBe(false);
    expect(withApplied({ model: 'fake/a', provider: 'fake' })).toBe(false); // faltam campos
    expect(withApplied(applied({ model: 'texto livre com espaços' }))).toBe(false);
    expect(withApplied(applied({ upstreamProvider: 'x'.repeat(121) }))).toBe(false);
    expect(withApplied(applied({ costSource: 'adivinhado' }))).toBe(false);
    expect(
      withApplied(applied({ params: { ...applied().params, tools: true } })),
      'ferramentas nunca',
    ).toBe(false);
  });

  it('é estrito: URI do Blob, IO bruto e o texto do prompt não cabem no formato', () => {
    expect(
      cycleViewSchema.safeParse(view({ briefing: { sha256: 'b'.repeat(64), uri: 'http://x' } }))
        .success,
    ).toBe(false);
    const withIo = view();
    (withIo.decisions[0] as Record<string, unknown>).ioUris = { request: 'http://blob' };
    expect(cycleViewSchema.safeParse(withIo).success).toBe(false);
    expect(
      cycleViewSchema.safeParse(view({ prompt: { version: 'x', text: 'segredo' } })).success,
    ).toBe(false);
  });
});
