import { createHash } from 'node:crypto';
import type { ClientOptions } from 'openai';

// O provedor fake (plano 10): um LLM falso, determinístico e DENTRO do processo, para a Temporada 0 (o ensaio) e para os
// testes. Entra pelo `fetch` do SDK da OpenAI, então o caminho do SDK (montar a requisição, ler a resposta, o usage) é o
// mesmo dos provedores de verdade; só a rede é trocada. Não chama nada fora do processo.
//
// O ID do modelo escolhe o comportamento (fake/<nome>):
//   fake/always-fail          responde 500: o caminho de falha (retry da fila, e a última tentativa vira HOLD)
//   fake/invalid-json-once    texto que não é JSON na 1ª chamada e a decisão válida no reparo
//   fake/invalid-json-always  nunca devolve JSON: o reparo também falha
//   fake/echo-prompt          devolve o prompt de sistema inteiro no resumo e nos motivos (o teste de canário)
//   fake/momentum             compra as duas maiores altas do último pregão (10% do patrimônio cada) e vende a posição que está
//                             abaixo do custo médio
//   fake/momentum-focused     o momentum concentrado: só a maior alta, com 20% do patrimônio
//   fake/contrarian           o contrário: compra as duas maiores quedas e realiza a posição que ganhou 2% ou mais
//   fake/contrarian-spread    o contrário espalhado: as três maiores quedas, com 5% do patrimônio cada
//   fake/hold-only            só segura (um HOLD): rende como o CDI
//   qualquer outro            uma decisão válida e determinística, a mesma para o mesmo modelo e o mesmo pregão (o ensaio usa
//                             fake/hash-picks)
// As estratégias leem só o briefing e a carteira que o modelo recebe, como um modelo de verdade. O elenco do ensaio
// (apps/api/seasons/ensaio.json) leva o nome dos modelos da Temporada 1 e só usa estratégias que nunca falham: a falha simulada
// (always-fail, invalid-json-*, echo-prompt) é dos testes, com um ID de teste, e nunca vai para o nome de um modelo de verdade.

type Fetch = NonNullable<ClientOptions['fetch']>;

interface Turn {
  role?: unknown;
  content?: unknown;
}

const MARKET_VIEWS = ['otimista', 'pessimista', 'neutro'] as const;
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// O conteúdo de um bloco [[NOME sha256=...]] ... [[/NOME sha256=...]] da mensagem do usuário.
function blockOf(turns: Turn[], name: string): unknown {
  for (const turn of turns) {
    if (turn.role !== 'user') continue;
    const match = new RegExp(
      `\\[\\[${name} sha256=([0-9a-f]{64})\\]\\]\\n([\\s\\S]*?)\\n\\[\\[/${name} sha256=\\1\\]\\]`,
    ).exec(text(turn.content));
    if (match) {
      try {
        return JSON.parse(match[2]!);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function universeOf(briefing: unknown): string[] {
  const rows = (briefing as { universe?: { rows?: unknown } } | undefined)?.universe?.rows;
  return Array.isArray(rows)
    ? rows.flatMap((row: unknown) =>
        Array.isArray(row) && typeof row[0] === 'string' ? [row[0]] : [],
      )
    : [];
}

function holdingsOf(own: unknown): string[] {
  const positions = (own as { positions?: unknown } | undefined)?.positions;
  return Array.isArray(positions)
    ? positions.flatMap((p: unknown) => {
        const ticker = (p as { ticker?: unknown } | null)?.ticker;
        return typeof ticker === 'string' ? [ticker] : [];
      })
    : [];
}

// Uma decisão válida e determinística: sorteia a partir do SHA-256 de "modelo|pregão", sem acaso de verdade.
function decide(model: string, turns: Turn[]): unknown {
  const briefing = blockOf(turns, 'BRIEFING');
  const date = text((briefing as { date?: unknown } | undefined)?.date);
  const seed = createHash('sha256').update(`${model}|${date}`).digest();
  const universe = universeOf(briefing).slice(0, 40);
  const held = holdingsOf(blockOf(turns, 'CARTEIRA'));

  const decisions: unknown[] = [];
  const used = new Set<string>();
  if (held.length > 0 && seed[1]! % 2 === 0) {
    const ticker = held[seed[2]! % held.length]!;
    used.add(ticker);
    decisions.push({
      ticker,
      action: 'SELL',
      percent_of_position: 50 + (seed[3]! % 51),
      confidence: 0.6,
      rationale: `Realização simulada de ${ticker} (provedor fake).`,
    });
  }
  const buys = 1 + (seed[4]! % 3);
  for (
    let i = 0;
    i < universe.length &&
    decisions.filter((d) => (d as { action: string }).action === 'BUY').length < buys;
    i += 1
  ) {
    const ticker = universe[(seed[5 + i]! + i) % universe.length]!;
    if (used.has(ticker) || held.includes(ticker)) continue;
    used.add(ticker);
    decisions.push({
      ticker,
      action: 'BUY',
      percent_of_equity: 5 + (seed[10 + i]! % 8),
      confidence: 0.7,
      rationale: `Compra simulada de ${ticker} (provedor fake).`,
    });
  }
  const keep = universe.find((ticker) => !used.has(ticker));
  if (keep) {
    decisions.push({ ticker: keep, action: 'HOLD', rationale: 'Sem fato novo (provedor fake).' });
  }
  return {
    summary: `Decisão simulada do provedor fake (${model}) para o pregão ${date}.`,
    market_view: MARKET_VIEWS[seed[0]! % MARKET_VIEWS.length],
    decisions,
  };
}

// A tabela do universo do briefing com a variação do último pregão (em pontos-base; null sem fechamento anterior).
function changesOf(briefing: unknown): Array<{ ticker: string; changeBps: number | null }> {
  const rows = (briefing as { universe?: { rows?: unknown } } | undefined)?.universe?.rows;
  return Array.isArray(rows)
    ? rows.flatMap((row: unknown) =>
        Array.isArray(row) && typeof row[0] === 'string'
          ? [{ ticker: row[0], changeBps: typeof row[3] === 'number' ? row[3] : null }]
          : [],
      )
    : [];
}

// As posições da carteira com o preço médio e o último fechamento (null se a carteira não tem barra dela).
function positionsOf(own: unknown): Array<{ ticker: string; avg: number; last: number | null }> {
  const positions = (own as { positions?: unknown } | undefined)?.positions;
  return Array.isArray(positions)
    ? positions.flatMap((value: unknown) => {
        const p = value as Record<string, unknown> | null;
        return typeof p?.ticker === 'string' && typeof p.avg_price_cents === 'number'
          ? [
              {
                ticker: p.ticker,
                avg: p.avg_price_cents,
                last: typeof p.last_close_cents === 'number' ? p.last_close_cents : null,
              },
            ]
          : [];
      })
    : [];
}

// momentum e contrarian são a mesma estrutura com o sinal trocado, e cada variante muda só quantas ações compra (`picks`) e quanto do
// patrimônio põe em cada uma (`percent`).
interface Trend {
  momentum: boolean;
  picks: number;
  percent: number;
}
const TRENDS = {
  momentum: { momentum: true, picks: 2, percent: 10 },
  'momentum-focused': { momentum: true, picks: 1, percent: 20 },
  contrarian: { momentum: false, picks: 2, percent: 10 },
  'contrarian-spread': { momentum: false, picks: 3, percent: 5 },
} satisfies Record<string, Trend>;
const isTrend = (behavior: string): behavior is keyof typeof TRENDS =>
  Object.hasOwn(TRENDS, behavior);

// Todas leem só o que o modelo recebe: a variação do último pregão na tabela do briefing e o preço médio e o último fechamento da
// carteira. Compram `picks` ações que ainda não têm e saem (100%) de até duas posições: o momentum, das que estão abaixo do custo; o
// contrário, das que ganharam 2% ou mais.
function trend({ momentum, picks, percent }: Trend, turns: Turn[]): unknown {
  const ranked = changesOf(blockOf(turns, 'BRIEFING'))
    .filter((row) => row.changeBps !== null)
    .sort(
      (a, b) =>
        (momentum ? 1 : -1) * ((b.changeBps ?? 0) - (a.changeBps ?? 0)) ||
        (a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0),
    );
  const held = positionsOf(blockOf(turns, 'CARTEIRA'));
  const owned = new Set(held.map((position) => position.ticker));
  const exits = held
    .filter((position) =>
      position.last === null
        ? false
        : momentum
          ? position.last < position.avg
          : position.last * 100 >= position.avg * 102,
    )
    .slice(0, 2);
  const decisions: unknown[] = [
    ...exits.map((position) => ({
      ticker: position.ticker,
      action: 'SELL',
      percent_of_position: 100,
      confidence: 0.6,
      rationale: momentum
        ? `Abaixo do custo médio: corta a perda de ${position.ticker} (provedor fake).`
        : `Ganho de pelo menos 2% sobre o custo médio: realiza ${position.ticker} (provedor fake).`,
    })),
    ...ranked
      .filter((row) => !owned.has(row.ticker))
      .slice(0, picks)
      .map((row) => ({
        ticker: row.ticker,
        action: 'BUY',
        percent_of_equity: percent,
        confidence: 0.6,
        rationale: `${momentum ? 'Maior alta' : 'Maior queda'} do último pregão (${row.changeBps} pontos-base), provedor fake.`,
      })),
  ];
  const first = ranked[0]?.ticker;
  if (decisions.length === 0 && first) {
    decisions.push({
      ticker: first,
      action: 'HOLD',
      rationale: 'Nada a fazer hoje (provedor fake).',
    });
  }
  const what = momentum
    ? picks === 1
      ? 'a maior alta'
      : 'as maiores altas'
    : picks === 1
      ? 'a maior queda'
      : 'as maiores quedas';
  return {
    summary: `${momentum ? 'Segue a alta' : 'Contra a maré'}: compra ${what} do último pregão (provedor fake).`,
    market_view: momentum ? 'otimista' : 'pessimista',
    decisions,
  };
}

// Só segura: um HOLD e nenhuma ordem. O caixa rende o CDI, então o patrimônio é o da referência CDI.
function holdOnly(turns: Turn[]): unknown {
  const first = universeOf(blockOf(turns, 'BRIEFING'))[0] ?? 'PETR4';
  return {
    summary: 'Sem convicção: segura o caixa (provedor fake).',
    market_view: 'neutro',
    decisions: [{ ticker: first, action: 'HOLD', rationale: 'Segura o caixa (provedor fake).' }],
  };
}

// O prompt inteiro no resumo e nos motivos de uma compra e de uma manutenção (se o texto cabe nos limites do contrato).
function echoPrompt(system: string, turns: Turn[]): unknown {
  const [first, second] = universeOf(blockOf(turns, 'BRIEFING'));
  return {
    summary: system,
    market_view: 'neutro',
    decisions: [
      { ticker: first ?? 'PETR4', action: 'BUY', percent_of_equity: 5, rationale: system },
      { ticker: second ?? 'VALE3', action: 'HOLD', rationale: system },
    ],
  };
}

function completion(model: string, turns: Turn[], content: string): Response {
  const promptChars = turns.reduce((sum, turn) => sum + text(turn.content).length, 0);
  const promptTokens = Math.ceil(promptChars / 4);
  const completionTokens = Math.ceil(content.length / 4);
  return json(200, {
    id: `fake-${createHash('sha256').update(`${model}|${promptChars}|${content}`).digest('hex').slice(0, 12)}`,
    object: 'chat.completion',
    created: 0,
    model,
    provider: 'fake',
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
      completion_tokens_details: { reasoning_tokens: 0 },
      cost: 0,
    },
  });
}

export function createFakeFetch(): Fetch {
  return (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (
      (init?.method ?? 'GET').toUpperCase() !== 'POST' ||
      !url.pathname.endsWith('/chat/completions')
    ) {
      return Promise.resolve(
        json(404, { error: { message: 'rota inexistente no provedor fake' } }),
      );
    }
    let body: { model?: unknown; messages?: unknown };
    try {
      body = JSON.parse(text(init?.body)) as typeof body;
    } catch {
      return Promise.resolve(json(400, { error: { message: 'corpo não é JSON' } }));
    }
    const turns = Array.isArray(body.messages) ? (body.messages as Turn[]) : [];
    if (turns.length === 0) {
      return Promise.resolve(json(400, { error: { message: 'sem mensagens' } }));
    }
    const model = text(body.model);
    const system = text(turns.find((turn) => turn.role === 'system')?.content);
    const repaired = turns.some((turn) => turn.role === 'assistant');
    const behavior = model.replace(/^fake\//, '');

    let content: string;
    if (behavior === 'always-fail') {
      return Promise.resolve(json(500, { error: { message: 'falha simulada do provedor fake' } }));
    } else if (
      behavior === 'invalid-json-always' ||
      (behavior === 'invalid-json-once' && !repaired)
    ) {
      content = 'Não consegui montar o JSON agora, desculpe.';
    } else if (behavior === 'echo-prompt') {
      content = JSON.stringify(echoPrompt(system, turns));
    } else if (isTrend(behavior)) {
      content = JSON.stringify(trend(TRENDS[behavior], turns));
    } else if (behavior === 'hold-only') {
      content = JSON.stringify(holdOnly(turns));
    } else {
      content = JSON.stringify(decide(model, turns));
    }
    return Promise.resolve(completion(model, turns, content));
  };
}
