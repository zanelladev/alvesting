import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as cycle from './cycle.js';
import * as internal from './internal.js';
import * as pub from './public.js';

// A API pública não entrega cotação bruta (docs/API.md, seção 6; ADR 0033). A licença da brapi deixa guardar, exibir e derivar, e
// proíbe "entregar os Dados a terceiros como feed, API ou base bruta": barra de preço (abertura, máxima, mínima e fechamento) e o
// fechamento de um papel não saem de nenhuma rota pública. Saem o resultado do experimento (o que a arena fez com o dinheiro fictício)
// e o que dele se deriva.
//
// O teste lê cada schema que public.ts e cycle.ts exportam (as respostas e as entradas das rotas públicas) pelo JSON Schema, junta o nome
// de TODO campo, em qualquer profundidade, e reprova (1) campo com nome de cotação bruta e (2) campo em centavos que não esteja na lista
// branca abaixo. Campo novo com dinheiro obriga a decidir aqui, com o motivo, e a escrever a linha na tabela do API.md.

// Os campos em centavos que a API pública entrega, e por quê. São o registro da arena (o que os competidores fizeram) ou o parâmetro dela:
// nunca o preço de um papel por si só.
const ARENA_RECORD_FIELDS: Readonly<Record<string, string>> = {
  capitalCents:
    'capital inicial fictício da temporada: parâmetro do experimento (as sementes e as regras são públicas, de propósito)',
  equityCents:
    'patrimônio de um competidor no pregão (caixa mais posições): resultado da liquidação, e os percentis do Monte Carlo',
  // Os campos daqui para baixo são só do MODELO (a composição da carteira, `holdings`, e os donos de uma ação): o Sorteio e as referências
  // ficam de fora, porque o igual-peso segura o universo inteiro e o BOVA11 um papel só (o ADR 0033 e o teste de integração da API explicam).
  cashCents: 'caixa de um modelo no pregão: resultado da liquidação',
  positionsValueCents: 'soma do valor das posições de um modelo no pregão: resultado da liquidação',
  costCents: 'custo total pago por um modelo na posição (valor mais custos das compras)',
  avgPriceCents:
    'preço médio pago por um modelo, custo dividido pela quantidade: sai das execuções da arena, não de uma barra',
  markCents:
    'marcação da posição de um modelo no último pregão liquidado (o fechamento com que ela foi valorada): registro do experimento, e quantidade e valor já a dão (valueCents ÷ quantity)',
  valueCents: 'valor da posição de um modelo no pregão: quantidade × marcação',
  pnlCents: 'resultado da posição de um modelo: valor menos custo',
};

// Nome de campo que carrega cotação bruta. Os pedaços do nome em camelCase (`previousCloseCents` → previous, close, cents), por palavra
// inteira: `closedAt` não é `close`, e `lastCycle` não é cotação.
const RAW_QUOTE_WORDS: ReadonlySet<string> = new Set([
  'open',
  'high',
  'low',
  'close',
  'previous',
  'prev',
  'bid',
  'ask',
  'vwap',
  'volume',
  'price',
  'quote',
  'quotes',
  'ohlc',
  'bar',
  'bars',
  'candle',
  'candles',
  'settle',
  'adjusted',
  'bova11',
]);

const words = (name: string): string[] =>
  name
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z\d]+/)
    .filter(Boolean);

// Todo nome de campo (propriedade de objeto) do JSON Schema, em qualquer profundidade.
function fieldNames(node: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(node)) {
    for (const item of node) fieldNames(item, found);
  } else if (node !== null && typeof node === 'object') {
    for (const [key, value] of Object.entries(node) as Array<[string, unknown]>) {
      if (key === 'properties' && value !== null && typeof value === 'object') {
        for (const name of Object.keys(value)) found.add(name);
      }
      fieldNames(value, found);
    }
  }
  return found;
}

const fieldsOf = (schema: z.ZodType): Set<string> =>
  fieldNames(z.toJSONSchema(schema, { io: 'output', unrepresentable: 'any' }));

// O que reprova num conjunto de campos. `allowed`: a lista branca.
function violations(fields: Iterable<string>, allowed: Readonly<Record<string, string>>): string[] {
  const out: string[] = [];
  for (const name of fields) {
    if (name in allowed) continue;
    if (words(name).some((word) => RAW_QUOTE_WORDS.has(word))) {
      out.push(`${name}: nome de cotação bruta`);
    } else if (name.endsWith('Cents')) {
      out.push(`${name}: campo em centavos fora da lista branca`);
    }
  }
  return out;
}

const publicSchemas: Array<[string, z.ZodType]> = Object.entries({ ...pub, ...cycle }).flatMap(
  ([name, value]): Array<[string, z.ZodType]> =>
    value instanceof z.ZodType ? [[name, value]] : [],
);

describe('a API pública não entrega cotação bruta', () => {
  it('lê os schemas das rotas públicas (as respostas e as entradas)', () => {
    const names = publicSchemas.map(([name]) => name);
    for (const expected of [
      'arenaCurrentSchema',
      'competitorDetailSchema',
      'cycleViewSchema',
      'decisionsPageSchema',
      'equitySchema',
      'leaderboardSchema',
      'macroSchema',
      'newsPageSchema',
      'randomBaselineSchema',
      'seasonsPageSchema',
      'stockDetailSchema',
      'stockSearchSchema',
    ]) {
      expect(names, expected).toContain(expected);
    }
  });

  for (const [name, schema] of publicSchemas) {
    it(`${name}: nenhum campo de cotação bruta, e todo campo em centavos está na lista branca`, () => {
      expect(violations(fieldsOf(schema), ARENA_RECORD_FIELDS)).toEqual([]);
    });
  }

  it('a barra de preço e o fechamento do BOVA11 saíram dos schemas que as continham', () => {
    expect(fieldsOf(pub.stockDetailSchema).has('bars')).toBe(false);
    expect(fieldsOf(pub.macroSchema).has('bova11')).toBe(false);
    expect(fieldsOf(pub.arenaCurrentSchema).has('previousCloseCents')).toBe(false);
    // a resposta que perdeu o campo o recusa: o schema é estrito
    expect(pub.stockDetailSchema.safeParse({ ticker: 'PETR4', bars: [] }).success).toBe(false);
  });

  // A composição da carteira (caixa e posições) é só do modelo. O igual-peso segura o universo inteiro e o BOVA11 um papel só: a posição e o
  // caixa deles seriam o fechamento de todo papel, todo pregão. O schema deixa a composição nula e a mantém num bloco só (`holdings`), então
  // não há como mandar o caixa sem as posições nem as posições soltas.
  it('a composição da carteira é um bloco só e pode faltar (o Sorteio e as referências não a trazem)', () => {
    const portfolio = pub.competitorDetailSchema.shape.portfolio.unwrap();
    const base = { date: '2026-11-05', equityCents: 1_000_000 };
    const holdings = { cashCents: 400_000, positionsValueCents: 600_000, positions: [] };
    expect(portfolio.safeParse({ ...base, holdings: null }).success).toBe(true);
    expect(portfolio.safeParse({ ...base, holdings }).success).toBe(true);
    // o campo é obrigatório (nulo, não ausente): a resposta nunca esquece de dizer
    expect(portfolio.safeParse(base).success).toBe(false);
    // a forma antiga (caixa e posições soltos na carteira) não passa, e o bloco não vem pela metade
    expect(portfolio.safeParse({ ...base, ...holdings, holdings: null }).success).toBe(false);
    expect(portfolio.safeParse({ ...base, positions: [], holdings: null }).success).toBe(false);
    expect(portfolio.safeParse({ ...base, holdings: { cashCents: 1 } }).success).toBe(false);
    expect(portfolio.safeParse({ ...base, holdings: { positions: [] } }).success).toBe(false);
  });

  it('o detector pega o que se quer pegar: OHLC, fechamento anterior, barras e campo novo em centavos', () => {
    const bad = (shape: z.ZodRawShape) => violations(fieldsOf(z.strictObject(shape)), {});
    for (const name of [
      'openCents',
      'highCents',
      'lowCents',
      'closeCents',
      'previousCloseCents',
      'prevClose',
      'adjustedCloseCents',
      'lastPrice',
      'volumeCents',
      'bid',
      'ask',
      'vwapCents',
      'regularMarketPrice',
      'bars',
      'candles',
      'ohlc',
      'bova11',
      // dinheiro novo sem decisão
      'surpriseCents',
    ]) {
      expect(bad({ [name]: z.number() }), name).toHaveLength(1);
    }
    // em qualquer profundidade: dentro de lista e de objeto
    const nested = z.strictObject({
      rows: z.array(z.strictObject({ inner: z.strictObject({ closeCents: z.number() }) })),
    });
    expect(violations(fieldsOf(nested), {})).toEqual(['closeCents: nome de cotação bruta']);
    // nome que só parece: palavra inteira, não pedaço
    expect(bad({ closedAt: z.string(), lastCycle: z.string(), percentileBps: z.number() })).toEqual(
      [],
    );
  });

  it('a lista branca só entra com motivo, nunca aceita OHLC e não guarda campo que nenhum schema público tem', () => {
    const present = new Set(publicSchemas.flatMap(([, schema]) => [...fieldsOf(schema)]));
    for (const [name, reason] of Object.entries(ARENA_RECORD_FIELDS)) {
      expect(reason.length, `${name}: motivo`).toBeGreaterThan(20);
      expect(name.endsWith('Cents'), `${name}: é um campo em centavos`).toBe(true);
      expect(name, `${name}: OHLC nunca é registro da arena`).not.toMatch(
        /^(open|high|low|close|previousClose)/,
      );
      expect(present.has(name), `${name}: nenhum schema público tem este campo`).toBe(true);
    }
  });

  it('cada campo da lista branca está na tabela do API.md, seção 6', () => {
    const api = readFileSync(new URL('../../../docs/API.md', import.meta.url), 'utf8');
    const section = /^## 6\. [\s\S]*?(?=^## 7\. )/m.exec(api)?.[0] ?? '';
    expect(section, 'a seção 6 do API.md não foi achada').toContain('registro da arena');
    for (const name of Object.keys(ARENA_RECORD_FIELDS)) {
      expect(section, `${name}: falta na tabela do API.md, seção 6`).toContain(`\`${name}\``);
    }
  });

  it('o schema interno (site → api) é o único com barra de preço, e não é exportado pelo contrato público', () => {
    expect(fieldsOf(internal.internalBarsSchema)).toEqual(
      new Set(['bars', 'date', 'openCents', 'highCents', 'lowCents', 'closeCents']),
    );
    for (const [name] of publicSchemas) {
      expect(Object.keys(internal), name).not.toContain(name);
    }
  });
});
