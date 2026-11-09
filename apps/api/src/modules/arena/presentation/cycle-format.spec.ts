import type { CycleView } from '@alvesting/contracts';
import { describe, expect, it } from 'vitest';
import { formatCycle } from './cycle-format.js';

const ulid = (suffix: string) => `01K000000000000000000000${suffix}`;
const view = (overrides: Partial<CycleView> = {}): CycleView => ({
  id: ulid('01'),
  seasonId: ulid('02'),
  date: '2026-11-03',
  status: 'CLOSED',
  skipReason: null,
  decisionAt: '2026-11-03T11:00:00.000Z',
  deadlineAt: '2026-11-03T12:30:00.000Z',
  closedAt: '2026-11-03T11:02:00.000Z',
  mode: 'AO_VIVO',
  executedAt: '2026-11-03T11:00:00.120Z',
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
      costMicroUsd: 232_000,
      usage: {
        calls: 2,
        promptTokens: 100,
        completionTokens: 50,
        reasoningTokens: 0,
        totalTokens: 150,
      },
      applied: null,
      items: [
        {
          position: 0,
          action: 'BUY',
          ticker: 'WEGE3',
          percent: 10,
          confidence: null,
          rationale: 'a',
        },
        {
          position: 1,
          action: 'BUY',
          ticker: 'PETR4',
          percent: 5,
          confidence: null,
          rationale: 'b',
        },
        {
          position: 2,
          action: 'HOLD',
          ticker: 'VALE3',
          percent: null,
          confidence: null,
          rationale: 'c',
        },
      ],
      dropped: [{ position: 3, reason: 'not_in_universe' }],
    },
    {
      competitor: { id: ulid('04'), slug: 'fake-b', name: 'Fake B' },
      status: 'FORCED_HOLD',
      holdReason: 'prazo',
      marketView: null,
      summary: null,
      inputSha256: null,
      outputSha256: null,
      costMicroUsd: 0,
      usage: null,
      applied: null,
      items: [],
      dropped: [],
    },
  ],
  ...overrides,
});

describe('formatCycle (cycle:show)', () => {
  const text = formatCycle(view());

  it('mostra o ciclo, a data e o status, e os horários em Brasília (08:00 e 09:30)', () => {
    expect(text).toContain('2026-11-03');
    expect(text).toContain('CLOSED');
    expect(text).toMatch(/decisão 08:00.*prazo 09:30/);
  });

  it('mostra os hashes públicos do prompt e do briefing, nunca outra coisa', () => {
    expect(text).toContain('a'.repeat(64));
    expect(text).toContain('b'.repeat(64));
    expect(text).toContain('0123456789abcdef0123456789abcdef');
  });

  it('uma linha por competidor: status, visão, contagem por ação, descartados, custo e chamadas', () => {
    expect(text).toMatch(/fake-a\s+DECIDED\s+neutro\s+BUY 2 · SELL 0 · HOLD 1\s+1\s+0\.232000\s+2/);
    expect(text).toMatch(/fake-b\s+HOLD forçado: prazo/);
  });

  it('o ciclo retroativo diz que é retroativo e a hora real em que rodou; o ao vivo também diz o modo', () => {
    const retro = formatCycle(view({ mode: 'RETROATIVO', executedAt: '2026-11-07T14:02:11.000Z' }));
    expect(retro).toContain('retroativo: rodado de verdade em 2026-11-07T14:02:11.000Z (UTC)');
    expect(formatCycle(view())).toContain('ao vivo: rodado em 2026-11-03T11:00:00.120Z (UTC)');
  });

  it('ciclo pulado mostra o motivo e que não há decisões', () => {
    const skipped = formatCycle(
      view({ status: 'SKIPPED', skipReason: 'orcamento', decisions: [], closedAt: null }),
    );
    expect(skipped).toContain('pulado: orcamento');
    expect(skipped).toContain('nenhuma decisão');
  });

  it('prompt ainda sem SHA-256 registrado (nenhum decide rodou) e ciclo sem briefing', () => {
    const t = formatCycle(
      view({
        prompt: { version: '0123456789abcdef0123456789abcdef', sha256: null },
        briefing: null,
        decisions: [],
      }),
    );
    expect(t).toContain('ainda não registrado');
    expect(t).toContain('briefing: nenhum');
  });
});
