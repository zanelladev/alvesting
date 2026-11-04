import { parseLlmDecision } from '@alvesting/contracts';
import { describe, expect, it } from 'vitest';
import { userMessage } from '../domain/llm-messages.js';
import { buildOwnPart } from '../domain/own-part.js';
import { SESSIONS, TEST_PROMPT, UNIVERSE, syntheticBriefing } from '../testing/arena.fixture.js';
import { createFakeFetch } from './fake-llm.js';

const briefing = syntheticBriefing();
const briefingBlock = { name: 'BRIEFING' as const, bytes: briefing.bytes, sha256: briefing.sha256 };
const tickers = UNIVERSE.map((row) => row.ticker);

// avg: o preço médio da posição (padrão 50,00); last: o último fechamento dela, se a carteira tem barra dela
type Held = { ticker: string; quantity: bigint; avg?: bigint; last?: bigint };

function ownBlock(positions: Held[] = []) {
  const last = SESSIONS[SESSIONS.length - 1]!;
  const own = buildOwnPart({
    date: '2026-11-03',
    sessions: SESSIONS,
    portfolio: {
      cashCents: 10_000_000n,
      positions: positions.map((p) => ({
        ticker: p.ticker,
        quantity: p.quantity,
        avgPriceCents: p.avg ?? 5_000n,
      })),
    },
    bars: new Map(
      positions.flatMap((p) =>
        p.last === undefined
          ? []
          : [
              [
                p.ticker,
                [
                  {
                    date: last,
                    openCents: p.last,
                    highCents: p.last,
                    lowCents: p.last,
                    closeCents: p.last,
                    volumeCents: 1n,
                  },
                ],
              ] as const,
            ],
      ),
    ),
  });
  return { name: 'CARTEIRA' as const, bytes: own.bytes, sha256: own.sha256 };
}

function request(
  model: string,
  extraTurns: unknown[] = [],
  positions: Held[] = [],
  block: { name: 'BRIEFING'; bytes: Buffer; sha256: string } = briefingBlock,
) {
  return {
    model,
    messages: [
      { role: 'system', content: TEST_PROMPT },
      { role: 'user', content: userMessage([block, ownBlock(positions)]) },
      ...extraTurns,
    ],
  };
}

interface Completion {
  id: string;
  choices: Array<{ message: { content: string } }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  error?: unknown;
}

async function call(body: unknown, url = 'http://fake-llm.invalid/v1/chat/completions') {
  const response = await createFakeFetch()(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { response, json: (await response.json()) as Completion };
}

const contentOf = (json: Completion): string => json.choices[0]!.message.content;

describe('createFakeFetch: o provedor fake, determinístico e dentro do processo', () => {
  it('responde no formato de chat completion, com usage e custo zero', async () => {
    const { response, json } = await call(request('fake/deterministic-a'));
    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      object: 'chat.completion',
      model: 'fake/deterministic-a',
      provider: 'fake',
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant' } }],
      usage: { completion_tokens_details: { reasoning_tokens: 0 }, cost: 0 },
    });
    expect(json.usage.prompt_tokens).toBeGreaterThan(0);
    expect(json.usage.total_tokens).toBe(json.usage.prompt_tokens + json.usage.completion_tokens);
  });

  it('o conteúdo é uma decisão válida pelo contrato, com compras só do universo do briefing', async () => {
    const { json } = await call(request('fake/deterministic-a'));
    const parsed = parseLlmDecision(contentOf(json));
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.dropped).toEqual([]);
    const buys = parsed.data.decisions.filter((d) => d.action === 'BUY');
    expect(buys.length).toBeGreaterThan(0);
    for (const buy of buys) expect(tickers).toContain(buy.ticker);
    expect(parsed.data.decisions.filter((d) => d.action !== 'HOLD').length).toBeLessThanOrEqual(5);
  });

  it('é determinístico: a mesma entrada dá exatamente a mesma resposta', async () => {
    const a = await call(request('fake/deterministic-a'));
    const b = await call(request('fake/deterministic-a'));
    expect(contentOf(a.json)).toBe(contentOf(b.json));
    expect(a.json.id).toBe(b.json.id);
  });

  it('modelos diferentes decidem diferente, e pregões diferentes também', async () => {
    const contents = new Set<string>();
    for (const letter of ['a', 'b', 'c', 'd', 'e']) {
      contents.add(contentOf((await call(request(`fake/deterministic-${letter}`))).json));
    }
    expect(contents.size).toBeGreaterThan(1);
  });

  it('só vende o que a carteira tem, dentro das faixas do contrato', async () => {
    const held = [{ ticker: 'WEGE3', quantity: 100n }];
    const sells = new Set<string>();
    for (const letter of 'abcdefghij') {
      const { json } = await call(request(`fake/deterministic-${letter}`, [], held));
      const parsed = parseLlmDecision(contentOf(json));
      expect(parsed.success).toBe(true);
      if (!parsed.success) continue;
      expect(parsed.data.dropped).toEqual([]);
      for (const item of parsed.data.decisions) {
        if (item.action === 'SELL') sells.add(item.ticker);
      }
    }
    expect([...sells]).toEqual(['WEGE3']);
  });

  it('sem posições, nunca vende', async () => {
    for (const letter of 'abcdef') {
      const { json } = await call(request(`fake/deterministic-${letter}`));
      expect(contentOf(json)).not.toContain('"SELL"');
    }
  });

  it('fake/always-fail responde 500 com corpo de erro (o caminho de falha do SDK)', async () => {
    const { response, json } = await call(request('fake/always-fail'));
    expect(response.status).toBe(500);
    expect(json.error).toBeDefined();
  });

  it('fake/invalid-json-once erra na primeira chamada e acerta no reparo', async () => {
    const first = await call(request('fake/invalid-json-once'));
    expect(parseLlmDecision(contentOf(first.json)).success).toBe(false);
    const repaired = await call(
      request('fake/invalid-json-once', [
        { role: 'assistant', content: contentOf(first.json) },
        { role: 'user', content: 'Responda de novo somente com o JSON.' },
      ]),
    );
    expect(parseLlmDecision(contentOf(repaired.json)).success).toBe(true);
  });

  it('fake/invalid-json-always nunca acerta', async () => {
    const twice = await call(
      request('fake/invalid-json-always', [
        { role: 'assistant', content: 'x' },
        { role: 'user', content: 'de novo' },
      ]),
    );
    expect(parseLlmDecision(contentOf(twice.json)).success).toBe(false);
  });

  it('fake/echo-prompt devolve o prompt de sistema inteiro no resumo e nos motivos (teste de canário)', async () => {
    const { json } = await call(request('fake/echo-prompt'));
    const decision = JSON.parse(contentOf(json)) as {
      summary: string;
      decisions: Array<{ rationale: string }>;
    };
    expect(decision.summary).toBe(TEST_PROMPT);
    expect(decision.decisions.length).toBeGreaterThan(0);
    for (const item of decision.decisions) expect(item.rationale).toBe(TEST_PROMPT);
    // continua uma decisão que o contrato aceita, se o prompt cabe nos limites (o do teste cabe)
    expect(parseLlmDecision(contentOf(json)).success).toBe(true);
  });

  it('só atende POST em /chat/completions; o resto é 404', async () => {
    const { response } = await call(
      request('fake/deterministic-a'),
      'http://fake-llm.invalid/v1/models',
    );
    expect(response.status).toBe(404);
  });

  it('corpo que não é JSON ou sem a mensagem do usuário é 400, não exceção', async () => {
    const bad = await createFakeFetch()('http://fake-llm.invalid/v1/chat/completions', {
      method: 'POST',
      body: 'não é json',
    });
    expect(bad.status).toBe(400);
    const empty = await call({ model: 'fake/deterministic-a', messages: [] });
    expect(empty.response.status).toBe(400);
  });
});

// As estratégias do ensaio (arena:ensaio, apps/api/seasons/ensaio.json): comportamentos diferentes sobre o mesmo briefing. No
// briefing sintético a variação do último pregão é 65 bps em ABEV3, 66 em BBDC4, 73 em ITUB4, 80 em PETR4, 82 em RENT3, 83 em SUZB3,
// 86 em VALE3 e 87 em WEGE3 (a inicial do ticker); a maior alta é WEGE3, e a maior queda, ABEV3.
describe('createFakeFetch: as estratégias do ensaio', () => {
  type Item = {
    ticker: string;
    action: string;
    percent_of_equity?: number;
    percent_of_position?: number;
  };
  const itemsOf = (json: Completion): Item[] =>
    (JSON.parse(contentOf(json)) as { decisions: Item[] }).decisions;

  it('fake/momentum compra as duas maiores altas do último pregão, 10% do patrimônio cada', async () => {
    const { json } = await call(request('fake/momentum'));
    expect(parseLlmDecision(contentOf(json))).toMatchObject({ success: true });
    expect(itemsOf(json)).toEqual([
      expect.objectContaining({ ticker: 'WEGE3', action: 'BUY', percent_of_equity: 10 }),
      expect.objectContaining({ ticker: 'VALE3', action: 'BUY', percent_of_equity: 10 }),
    ]);
  });

  it('fake/momentum vende (100%) a posição que está abaixo do custo médio e não compra de novo o que já tem', async () => {
    const held: Held[] = [
      { ticker: 'WEGE3', quantity: 100n, avg: 10_000n, last: 10_087n }, // acima do custo: segura e não recompra
      { ticker: 'PETR4', quantity: 50n, avg: 10_000n, last: 9_000n }, // abaixo do custo: vende
    ];
    const { json } = await call(request('fake/momentum', [], held));
    const items = itemsOf(json);
    expect(items[0]).toMatchObject({ ticker: 'PETR4', action: 'SELL', percent_of_position: 100 });
    const buys = items.filter((item) => item.action === 'BUY').map((item) => item.ticker);
    expect(buys).toEqual(['VALE3', 'SUZB3']); // WEGE3 já está na carteira
    expect(parseLlmDecision(contentOf(json))).toMatchObject({ success: true });
  });

  it('fake/contrarian compra as duas maiores quedas e realiza a posição que ganhou 2% ou mais sobre o custo', async () => {
    const plain = await call(request('fake/contrarian'));
    expect(itemsOf(plain.json).map((item) => [item.ticker, item.action])).toEqual([
      ['ABEV3', 'BUY'],
      ['BBDC4', 'BUY'],
    ]);
    const held: Held[] = [
      { ticker: 'WEGE3', quantity: 100n, avg: 10_000n, last: 10_200n }, // +2,00%: realiza
      { ticker: 'VALE3', quantity: 100n, avg: 10_000n, last: 10_199n }, // +1,99%: segura
    ];
    const { json } = await call(request('fake/contrarian', [], held));
    const sells = itemsOf(json).filter((item) => item.action === 'SELL');
    expect(sells.map((item) => item.ticker)).toEqual(['WEGE3']);
    expect(parseLlmDecision(contentOf(json))).toMatchObject({ success: true });
  });

  it('fake/hold-only só segura: um HOLD e nenhuma ordem, mesmo com posições', async () => {
    const held: Held[] = [{ ticker: 'WEGE3', quantity: 100n, avg: 10_000n, last: 12_000n }];
    for (const positions of [[], held]) {
      const { json } = await call(request('fake/hold-only', [], positions));
      const parsed = parseLlmDecision(contentOf(json));
      expect(parsed).toMatchObject({ success: true });
      expect(itemsOf(json)).toHaveLength(1);
      expect(itemsOf(json)[0]).toMatchObject({ action: 'HOLD' });
    }
  });

  it('fake/flaky-json erra o JSON na primeira chamada dos dias de dia ímpar e acerta no reparo; nos pares, acerta de primeira', async () => {
    // 03/11 (dia 3): quebra a primeira chamada
    const first = await call(request('fake/flaky-json'));
    expect(parseLlmDecision(contentOf(first.json)).success).toBe(false);
    const repaired = await call(
      request('fake/flaky-json', [
        { role: 'assistant', content: contentOf(first.json) },
        { role: 'user', content: 'Responda de novo somente com o JSON.' },
      ]),
    );
    expect(parseLlmDecision(contentOf(repaired.json)).success).toBe(true);

    // 04/11 (dia 4): a primeira chamada já vem boa
    const even = syntheticBriefing('2026-11-04');
    const evenBlock = { name: 'BRIEFING' as const, bytes: even.bytes, sha256: even.sha256 };
    const ok = await call(request('fake/flaky-json', [], [], evenBlock));
    expect(parseLlmDecision(contentOf(ok.json)).success).toBe(true);
  });

  it('as estratégias são determinísticas e diferentes entre si', async () => {
    const answers = new Set<string>();
    for (const model of ['momentum', 'contrarian', 'hold-only']) {
      const a = await call(request(`fake/${model}`));
      const b = await call(request(`fake/${model}`));
      expect(contentOf(a.json)).toBe(contentOf(b.json));
      answers.add(contentOf(a.json));
    }
    expect(answers.size).toBe(3);
  });
});
