import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  BUY_PERCENT_OF_EQUITY,
  MAX_DECISION_ITEMS,
  MAX_ORDERS_PER_CYCLE,
  SELL_PERCENT_OF_POSITION,
  decisionItemSchema,
  llmDecisionSchema,
  parseLlmDecision,
} from './llm-decision.js';

const buy = (overrides: Record<string, unknown> = {}) => ({
  ticker: 'WEGE3',
  action: 'BUY',
  percent_of_equity: 10,
  confidence: 0.7,
  rationale: 'Resultado do trimestre acima do esperado.',
  ...overrides,
});
const sell = (overrides: Record<string, unknown> = {}) => ({
  ticker: 'VALE3',
  action: 'SELL',
  percent_of_position: 50,
  confidence: 0.6,
  rationale: 'Minério em queda.',
  ...overrides,
});
const hold = (overrides: Record<string, unknown> = {}) => ({
  ticker: 'ITUB4',
  action: 'HOLD',
  rationale: 'Sem fato novo.',
  ...overrides,
});
const response = (decisions: unknown[] = [buy(), sell(), hold()], overrides = {}) => ({
  summary: 'Dia de cautela: reduzo mineração e aumento exposição a energia.',
  market_view: 'neutro',
  decisions,
  ...overrides,
});

const issuePaths = (value: unknown) => {
  const result = llmDecisionSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((issue) => issue.path);
};

describe('llmDecisionSchema: casos válidos', () => {
  it('aceita o exemplo do plano (BUY, SELL e HOLD)', () => {
    expect(llmDecisionSchema.safeParse(response()).success).toBe(true);
  });

  it('aceita nenhuma decisão', () => {
    expect(llmDecisionSchema.safeParse(response([])).success).toBe(true);
  });

  it.each(['otimista', 'pessimista', 'neutro'])('aceita market_view %s', (market_view) => {
    expect(llmDecisionSchema.safeParse(response(undefined, { market_view })).success).toBe(true);
  });

  it.each([5, 7.5, 25])('aceita BUY com percent_of_equity %s', (percent_of_equity) => {
    expect(decisionItemSchema.safeParse(buy({ percent_of_equity })).success).toBe(true);
  });

  it.each([1, 33.3, 100])('aceita SELL com percent_of_position %s', (percent_of_position) => {
    expect(decisionItemSchema.safeParse(sell({ percent_of_position })).success).toBe(true);
  });

  it('aceita BUY e SELL sem confidence (é só informativa)', () => {
    expect(decisionItemSchema.safeParse(buy({ confidence: undefined })).success).toBe(true);
    expect(decisionItemSchema.safeParse(sell({ confidence: undefined })).success).toBe(true);
  });

  it('o limite do plano é 5 ordens por ciclo', () => {
    expect(MAX_ORDERS_PER_CYCLE).toBe(5);
  });

  // O briefing anuncia estas faixas aos modelos: o schema que valida a resposta tem de ser o mesmo (uma fonte só).
  it('as faixas exportadas são as que o schema valida, nas pontas', () => {
    const [buyMin, buyMax] = BUY_PERCENT_OF_EQUITY;
    const [sellMin, sellMax] = SELL_PERCENT_OF_POSITION;
    expect([buyMin, buyMax, sellMin, sellMax]).toEqual([5, 25, 1, 100]);
    const buys = (value: number) =>
      decisionItemSchema.safeParse(buy({ percent_of_equity: value })).success;
    const sells = (value: number) =>
      decisionItemSchema.safeParse(sell({ percent_of_position: value })).success;
    expect([buys(buyMin), buys(buyMax), buys(buyMin - 0.01), buys(buyMax + 0.01)]).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect([sells(sellMin), sells(sellMax), sells(sellMin - 0.01), sells(sellMax + 0.01)]).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it('aceita 5 ordens e HOLD até o teto de itens', () => {
    const orders = Array.from({ length: 5 }, (_, i) => buy({ ticker: `ACAO${i + 1}` }));
    const holds = Array.from({ length: MAX_DECISION_ITEMS - 5 }, (_, i) =>
      hold({ ticker: `MANT${i + 1}` }),
    );
    expect(llmDecisionSchema.safeParse(response([...orders, ...holds])).success).toBe(true);
  });

  it('apara os espaços do rationale', () => {
    const parsed = decisionItemSchema.parse(hold({ rationale: '  sem fato novo  ' }));
    expect(parsed.rationale).toBe('sem fato novo');
  });
});

describe('llmDecisionSchema: limites numéricos', () => {
  it.each([4.99, 0, -5, 25.01, 100])(
    'rejeita BUY com percent_of_equity %s',
    (percent_of_equity) => {
      expect(issuePaths(response([buy({ percent_of_equity })]))).toContainEqual([
        'decisions',
        0,
        'percent_of_equity',
      ]);
    },
  );

  it.each([0.99, 0, -1, 100.01])(
    'rejeita SELL com percent_of_position %s',
    (percent_of_position) => {
      expect(issuePaths(response([sell({ percent_of_position })]))).toContainEqual([
        'decisions',
        0,
        'percent_of_position',
      ]);
    },
  );

  it.each([-0.1, 1.01])('rejeita confidence %s', (confidence) => {
    expect(decisionItemSchema.safeParse(buy({ confidence })).success).toBe(false);
  });

  it.each([0, 1])('aceita confidence %s', (confidence) => {
    expect(decisionItemSchema.safeParse(buy({ confidence })).success).toBe(true);
  });

  it('não converte número escrito como texto', () => {
    expect(decisionItemSchema.safeParse(buy({ percent_of_equity: '10' })).success).toBe(false);
  });
});

describe('llmDecisionSchema: textos', () => {
  it('aceita summary de 600 caracteres e rejeita 601', () => {
    expect(
      llmDecisionSchema.safeParse(response(undefined, { summary: 'a'.repeat(600) })).success,
    ).toBe(true);
    expect(issuePaths(response(undefined, { summary: 'a'.repeat(601) }))).toContainEqual([
      'summary',
    ]);
  });

  it('rejeita summary vazio ou só de espaços', () => {
    expect(issuePaths(response(undefined, { summary: '' }))).toContainEqual(['summary']);
    expect(issuePaths(response(undefined, { summary: '   ' }))).toContainEqual(['summary']);
  });

  it('aceita rationale de 280 caracteres e rejeita 281', () => {
    expect(decisionItemSchema.safeParse(hold({ rationale: 'a'.repeat(280) })).success).toBe(true);
    expect(decisionItemSchema.safeParse(hold({ rationale: 'a'.repeat(281) })).success).toBe(false);
  });

  it('rejeita rationale vazio em qualquer ação', () => {
    for (const item of [
      buy({ rationale: '' }),
      sell({ rationale: ' ' }),
      hold({ rationale: '' }),
    ]) {
      expect(decisionItemSchema.safeParse(item).success).toBe(false);
    }
  });

  it('aceita acentos, emojis e caracteres especiais no texto', () => {
    const rationale = 'Ação em alta 📈 — "pré-sal" & cia; DROP TABLE; <b>x</b>';
    expect(decisionItemSchema.safeParse(hold({ rationale })).success).toBe(true);
  });
});

describe('llmDecisionSchema: ticker no formato da B3', () => {
  it.each(['WEGE3', 'PETR4', 'BPAC11', 'B3SA3', 'TAEE11'])('aceita %s', (ticker) => {
    expect(decisionItemSchema.safeParse(hold({ ticker })).success).toBe(true);
  });

  it.each([
    'wege3',
    'WEGE',
    'WEGE333',
    'PETR',
    'PETR4F',
    ' PETR4',
    'PETR4 ',
    'PETR-4',
    '3PETR4',
    '',
    'WEG3',
  ])('rejeita "%s"', (ticker) => {
    expect(decisionItemSchema.safeParse(hold({ ticker })).success).toBe(false);
  });
});

describe('llmDecisionSchema: estrutura', () => {
  it.each(['otimist', 'bullish', 'NEUTRO', ''])('rejeita market_view "%s"', (market_view) => {
    expect(issuePaths(response(undefined, { market_view }))).toContainEqual(['market_view']);
  });

  it.each(['buy', 'SHORT', 'HODL', ''])('rejeita action "%s"', (action) => {
    expect(decisionItemSchema.safeParse(hold({ action })).success).toBe(false);
  });

  it('HOLD só carrega ticker, action e rationale', () => {
    expect(decisionItemSchema.safeParse(hold({ percent_of_equity: 10 })).success).toBe(false);
    expect(decisionItemSchema.safeParse(hold({ percent_of_position: 10 })).success).toBe(false);
    expect(decisionItemSchema.safeParse(hold({ confidence: 0.5 })).success).toBe(false);
  });

  it('BUY sem percent_of_equity e SELL sem percent_of_position são inválidos', () => {
    expect(decisionItemSchema.safeParse(buy({ percent_of_equity: undefined })).success).toBe(false);
    expect(decisionItemSchema.safeParse(sell({ percent_of_position: undefined })).success).toBe(
      false,
    );
  });

  it('BUY com o campo do SELL (e vice-versa) é inválido', () => {
    expect(decisionItemSchema.safeParse(buy({ percent_of_position: 10 })).success).toBe(false);
    expect(decisionItemSchema.safeParse(sell({ percent_of_equity: 10 })).success).toBe(false);
  });

  it('rejeita chave desconhecida no topo', () => {
    expect(
      llmDecisionSchema.safeParse(response(undefined, { reasoning: 'passo a passo' })).success,
    ).toBe(false);
  });

  it.each(['summary', 'market_view', 'decisions'])('rejeita resposta sem %s', (campo) => {
    const value: Record<string, unknown> = response();
    delete value[campo];
    expect(llmDecisionSchema.safeParse(value).success).toBe(false);
  });

  it('rejeita mais de 5 ordens BUY ou SELL, mesmo misturadas com HOLD', () => {
    const orders = Array.from({ length: 6 }, (_, i) =>
      i % 2 === 0 ? buy({ ticker: `ACAO${i + 1}` }) : sell({ ticker: `ACAO${i + 1}` }),
    );
    expect(issuePaths(response([hold(), ...orders]))).toContainEqual(['decisions']);
  });

  it('rejeita decisions que não é lista', () => {
    expect(llmDecisionSchema.safeParse(response('BUY WEGE3' as unknown as unknown[])).success).toBe(
      false,
    );
  });

  it('o teto de itens é 50: HOLD não é canal livre de texto', () => {
    expect(MAX_DECISION_ITEMS).toBe(50);
    const holds = (count: number) =>
      Array.from({ length: count }, (_, i) => hold({ ticker: `MANT${i + 1}` }));
    expect(llmDecisionSchema.safeParse(response(holds(MAX_DECISION_ITEMS))).success).toBe(true);
    expect(issuePaths(response(holds(MAX_DECISION_ITEMS + 1)))).toContainEqual(['decisions']);
  });
});

describe('parseLlmDecision', () => {
  it('devolve o dado validado quando o texto é um JSON correto, sem nada descartado', () => {
    const result = parseLlmDecision(JSON.stringify(response()));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.decisions).toHaveLength(3);
      expect(result.data.dropped).toEqual([]);
      expect(result.data.market_view).toBe('neutro');
    }
  });

  it.each([
    ['JSON cortado no meio', '{"summary": "oi", "market_view": '],
    ['texto solto', 'Compre WEGE3 agora'],
    ['vazio', ''],
    ['JSON dentro de cerca markdown', '```json\n' + JSON.stringify(response()) + '\n```'],
    ['aspas simples', "{'summary': 'oi'}"],
  ])('marca invalid_json para %s', (_nome, texto) => {
    expect(parseLlmDecision(texto)).toEqual({ success: false, reason: 'invalid_json' });
  });

  it.each([
    ['lista', '[]'],
    ['null', 'null'],
    ['objeto vazio', '{}'],
    ['sem decisions', JSON.stringify({ summary: 'oi', market_view: 'neutro' })],
    ['decisions que não é lista', JSON.stringify(response('BUY WEGE3' as unknown as unknown[]))],
    ['market_view fora da lista', JSON.stringify(response(undefined, { market_view: 'alta' }))],
    ['summary vazio', JSON.stringify(response(undefined, { summary: '' }))],
    ['chave a mais no topo', JSON.stringify(response(undefined, { reasoning: 'passo a passo' }))],
  ])('marca invalid_schema para JSON válido porém fora do contrato (%s)', (_nome, texto) => {
    const result = parseLlmDecision(texto);
    expect(result).toMatchObject({ success: false, reason: 'invalid_schema' });
    if (!result.success && result.reason === 'invalid_schema') {
      expect(result.issues.length).toBeGreaterThan(0);
    }
  });

  it('não repete o texto do item descartado (evita vazar conteúdo no log)', () => {
    const result = parseLlmDecision(
      JSON.stringify(response([buy({ rationale: 'x'.repeat(300) })])),
    );
    expect(result).toMatchObject({ success: true, data: { dropped: [{ index: 0 }] } });
    expect(JSON.stringify(result)).not.toContain('x'.repeat(300));
  });
});

// Plano (2) e METODOLOGIA: "item inválido descartado". O envelope é estrito (sem ele a resposta cai no
// reparo); cada item é validado sozinho, e o que não passa sai sem derrubar os outros.
describe('parseLlmDecision: item inválido é descartado, o resto vale', () => {
  const parse = (decisions: unknown[]) => {
    const result = parseLlmDecision(JSON.stringify(response(decisions)));
    if (!result.success) throw new Error(`esperava sucesso, veio ${result.reason}`);
    return result.data;
  };

  it('descarta só a ordem fora do limite e mantém as outras, na ordem do modelo', () => {
    const data = parse([buy(), sell({ percent_of_position: 150 }), hold()]);
    expect(data.decisions.map((d) => d.ticker)).toEqual(['WEGE3', 'ITUB4']);
    expect(data.dropped).toHaveLength(1);
    expect(data.dropped[0]).toMatchObject({ index: 1, reason: 'invalid_item' });
  });

  it.each([
    ['ticker fora do formato', hold({ ticker: 'petr4' })],
    ['rationale vazio', hold({ rationale: ' ' })],
    ['campo a mais', hold({ confidence: 0.5 })],
    ['action desconhecida', hold({ action: 'SHORT' })],
    ['percentual como texto', buy({ percent_of_equity: '10' })],
    ['null', null],
    ['texto solto', 'BUY WEGE3'],
    ['número', 42],
    ['lista', []],
  ])('descarta o item com %s e aponta o índice', (_nome, item) => {
    const data = parse([hold({ ticker: 'VALE3' }), item]);
    expect(data.decisions.map((d) => d.ticker)).toEqual(['VALE3']);
    expect(data.dropped).toMatchObject([{ index: 1, reason: 'invalid_item' }]);
  });

  it('as issues do item descartado trazem o caminho do campo, relativo ao item', () => {
    const [dropped] = parse([buy({ percent_of_equity: 99 })]).dropped;
    expect(dropped).toMatchObject({ reason: 'invalid_item' });
    if (dropped?.reason === 'invalid_item') {
      expect(dropped.issues.map((i) => i.path)).toContainEqual(['percent_of_equity']);
    }
  });

  it('a 5ª ordem fica e a 6ª é descartada; a 6ª leva o motivo over_order_limit', () => {
    const orders = Array.from({ length: 6 }, (_, i) =>
      i % 2 === 0 ? buy({ ticker: `ACAO${i + 1}` }) : sell({ ticker: `ACAO${i + 1}` }),
    );
    const data = parse(orders);
    expect(data.decisions.map((d) => d.ticker)).toEqual([
      'ACAO1',
      'ACAO2',
      'ACAO3',
      'ACAO4',
      'ACAO5',
    ]);
    expect(data.dropped).toEqual([{ index: 5, reason: 'over_order_limit' }]);
  });

  it('HOLD não conta no limite e nunca é descartado por ele', () => {
    const orders = Array.from({ length: 5 }, (_, i) => buy({ ticker: `ACAO${i + 1}` }));
    const holds = Array.from({ length: 12 }, (_, i) => hold({ ticker: `MANT${i + 1}` }));
    const data = parse([...holds.slice(0, 6), ...orders, ...holds.slice(6)]);
    expect(data.decisions).toHaveLength(17);
    expect(data.dropped).toEqual([]);
  });

  it('ordem inválida não gasta o limite: as 5 válidas que vêm depois ficam', () => {
    const data = parse([
      buy({ ticker: 'RUIM3', percent_of_equity: 99 }),
      ...Array.from({ length: 5 }, (_, i) => buy({ ticker: `ACAO${i + 1}` })),
    ]);
    expect(data.decisions.map((d) => d.ticker)).toEqual([
      'ACAO1',
      'ACAO2',
      'ACAO3',
      'ACAO4',
      'ACAO5',
    ]);
    expect(data.dropped).toMatchObject([{ index: 0, reason: 'invalid_item' }]);
  });

  it('tudo inválido vira lista vazia com tudo em dropped (quem decide o HOLD é a etapa 6)', () => {
    const data = parse([buy({ percent_of_equity: 1 }), 'lixo', null]);
    expect(data.decisions).toEqual([]);
    expect(data.dropped.map((d) => d.index)).toEqual([0, 1, 2]);
  });

  it('o resumo e a visão de mercado passam adiante', () => {
    const data = parse([hold()]);
    expect(data.market_view).toBe('neutro');
    expect(data.summary).toBe(response().summary);
  });
});

// A etapa 6 aplica o corte das 5 ordens depois da validação do domínio (universo, posição, ticker repetido): ordem
// inválida por esses motivos também não pode gastar o limite (ADR 0016). Para isso lê os itens sem o corte.
describe('parseLlmDecision com applyOrderCap: false', () => {
  const orders = Array.from({ length: 7 }, (_, i) => buy({ ticker: `ACAO${i + 1}` }));

  it('devolve todas as ordens válidas, na ordem do modelo, sem over_order_limit', () => {
    const result = parseLlmDecision(JSON.stringify(response(orders)), { applyOrderCap: false });
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.decisions).toHaveLength(7);
    expect(result.data.dropped).toEqual([]);
  });

  it('continua descartando o item que não passa no schema', () => {
    const result = parseLlmDecision(
      JSON.stringify(response([buy({ percent_of_equity: 99 }), ...orders])),
      { applyOrderCap: false },
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.decisions).toHaveLength(7);
    expect(result.data.dropped).toMatchObject([{ index: 0, reason: 'invalid_item' }]);
  });

  it('o teto de itens vale também no envelope: 51 itens (mesmo inválidos) derrubam a resposta, com o caminho e a regra', () => {
    const items = (count: number) => Array.from({ length: count }, () => ({ lixo: true }));
    expect(
      parseLlmDecision(JSON.stringify(response(items(MAX_DECISION_ITEMS))), {
        applyOrderCap: false,
      }),
    ).toMatchObject({ success: true });
    const result = parseLlmDecision(JSON.stringify(response(items(MAX_DECISION_ITEMS + 1))), {
      applyOrderCap: false,
    });
    expect(result).toMatchObject({ success: false, reason: 'invalid_schema' });
    if (!result.success && result.reason === 'invalid_schema') {
      expect(result.issues.map((issue) => [issue.path, issue.code])).toEqual([
        [['decisions'], 'too_big'],
      ]);
    }
  });

  it('o padrão não muda: sem a opção, o corte das 5 ordens vale', () => {
    const result = parseLlmDecision(JSON.stringify(response(orders)));
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.decisions).toHaveLength(MAX_ORDERS_PER_CYCLE);
    expect(result.data.dropped).toEqual([
      { index: 5, reason: 'over_order_limit' },
      { index: 6, reason: 'over_order_limit' },
    ]);
  });
});

describe('JSON Schema para provedores com saída estruturada', () => {
  it('converte o schema e mantém o formato fechado', () => {
    const json = z.toJSONSchema(llmDecisionSchema) as unknown as {
      additionalProperties?: boolean;
      properties: { market_view: { enum: string[] } };
    };
    expect(json.additionalProperties).toBe(false);
    expect(json.properties.market_view.enum).toEqual(['otimista', 'pessimista', 'neutro']);
  });
});
