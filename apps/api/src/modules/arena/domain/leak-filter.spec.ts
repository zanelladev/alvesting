import { describe, expect, it } from 'vitest';
import { LEAK_WARNING, NGRAM_WORDS, createLeakFilter, hasCanary } from './leak-filter.js';

// O texto do prompt aqui é sintético: gerado no teste, nunca o de verdade.
const CANARY = 'alv-canary-0a1b2c3d4e5f60718293a4b5';
const PROMPT = [
  'Você é um gestor de carteira que decide uma vez por dia com dados congelados.',
  `Linha de controle ${CANARY} que nunca deve aparecer em resposta pública.`,
  'Compre pouco quando a notícia for fraca e venda tudo quando o risco estiver acima do limite aceito.',
  'Responda sempre em português do Brasil, apenas com o JSON do formato pedido.',
].join('\n');

const filter = createLeakFilter(PROMPT);

describe('createLeakFilter: o canário', () => {
  it('troca o canário por um aviso, mesmo escrito em maiúsculas', () => {
    const result = filter.redact(`Veja: ${CANARY.toUpperCase()} e pronto.`);
    expect(result).toMatchObject({ leaked: true, text: `Veja: ${LEAK_WARNING} e pronto.` });
  });

  it('só o canário do prompt conta: outro texto parecido passa', () => {
    expect(filter.redact('alv-canary-ffffffffffffffffffffffff').leaked).toBe(false);
  });

  it('prompt sem canário: só os n-gramas valem', () => {
    const semCanario = createLeakFilter(
      'uma frase com muitas palavras seguidas para formar um n-grama inteiro',
    );
    expect(semCanario.redact(CANARY).leaked).toBe(false);
  });

  // O canário é achado pelas letras e dígitos, com qualquer separador entre eles: o eco "arrumado" não escapa
  it.each([
    ['hífens trocados por espaços', 'alv canary 0a1b2c3d4e5f60718293a4b5'],
    ['hífens trocados por sublinhado', 'alv_canary_0a1b2c3d4e5f60718293a4b5'],
    ['quebra de linha no meio', 'alv-\ncanary-\n0a1b2c3d4e5f60718293a4b5'],
    ['largura zero no meio', 'alv-can\u200Bary-0a1b2c3d4e5f60718293a4b5'],
    ['soft hyphen no meio', 'alv-canary-0a1b2c3d\u00AD4e5f60718293a4b5'],
    ['letras separadas', 'a l v - c a n a r y - 0a1b2c3d4e5f60718293a4b5'],
    ['hífen escapado do JSON cru', '"alv\\u002dcanary\\u002d0a1b2c3d4e5f60718293a4b5"'],
    ['caixa alta', 'ALV CANARY 0A1B2C3D4E5F60718293A4B5'],
  ])('o canário com %s também é achado', (_nome, variant) => {
    for (const result of [
      filter.redact(`antes ${variant} depois`),
      filter.redactCanary(`antes ${variant} depois`),
    ]) {
      expect(result.leaked, variant).toBe(true);
      expect(result.text).toContain(LEAK_WARNING);
      expect(result.text.toLowerCase()).not.toMatch(/0a1b2c3d|4e5f6071|8293a4b5/);
      expect(result.text.startsWith('antes ') && result.text.endsWith(' depois')).toBe(true);
    }
  });

  it('o canário de outro prompt, ou com um caractere a menos, não é achado', () => {
    expect(filter.redact('alv canary 0a1b2c3d4e5f60718293a4b6').leaked).toBe(false);
    expect(filter.redact('alv canary 0a1b2c3d4e5f60718293a4b').leaked).toBe(false);
    expect(filter.redactCanary('alvcanary só um pedaço').leaked).toBe(false);
  });
});

describe('createLeakFilter: n-gramas de 8 palavras', () => {
  it('o tamanho do n-grama é o do plano (8 palavras)', () => {
    expect(NGRAM_WORDS).toBe(8);
  });

  it('remove um trecho de 8 palavras copiado do prompt e mantém o resto do texto', () => {
    const result = filter.redact(
      'Minha tese: compre pouco quando a notícia for fraca e venda tudo hoje. Fim.',
    );
    expect(result.leaked).toBe(true);
    expect(result.text).toBe(`Minha tese: ${LEAK_WARNING} hoje. Fim.`);
    expect(result.text).not.toContain('compre pouco');
  });

  it('7 palavras seguidas não bastam', () => {
    // "compre pouco quando a notícia for fraca" são 7 palavras
    expect(
      filter.redact('Pense: compre pouco quando a notícia for fraca, mas só isso.').leaked,
    ).toBe(false);
  });

  it('ignora caixa, acento e pontuação ao comparar', () => {
    const result = filter.redact('COMPRE, pouco... quando a NOTICIA for FRACA e venda!!!');
    expect(result.leaked).toBe(true);
    expect(result.text).toBe(LEAK_WARNING + '!!!');
  });

  it('um trecho longo vira um único aviso, não um por janela', () => {
    const result = filter.redact(
      'Compre pouco quando a notícia for fraca e venda tudo quando o risco estiver acima do limite aceito.',
    );
    expect(result.text.split(LEAK_WARNING)).toHaveLength(2);
    expect(result.text).toBe(`${LEAK_WARNING}.`);
  });

  it('dois trechos separados viram dois avisos, e o meio fica', () => {
    const result = filter.redact(
      'Responda sempre em português do Brasil, apenas com ok. E depois: compre pouco quando a notícia for fraca e venda.',
    );
    // o primeiro trecho (8 palavras: responda sempre em português do brasil apenas com) e o segundo
    expect(result.text).toContain(' ok. E depois: ');
    expect(result.text.match(new RegExp(LEAK_WARNING.replace(/[[\]]/g, '\\$&'), 'g'))).toHaveLength(
      2,
    );
  });

  it('texto que não tem nada do prompt passa intacto', () => {
    const text = 'Resultado do trimestre acima do esperado; margem em alta e dívida controlada.';
    expect(filter.redact(text)).toEqual({ text, leaked: false });
  });

  it('o prompt todo, devolvido pelo modelo, some por inteiro', () => {
    const result = filter.redact(PROMPT);
    expect(result.leaked).toBe(true);
    expect(result.text).not.toContain('gestor de carteira');
    expect(result.text).not.toContain(CANARY);
  });

  it('prompt curto demais para ter n-grama (menos de 8 palavras) só tem o canário', () => {
    const curto = createLeakFilter(`pouco texto ${CANARY}`);
    expect(curto.redact('pouco texto').leaked).toBe(false);
    expect(curto.redact(CANARY).leaked).toBe(true);
  });

  it('prompt vazio não marca nada', () => {
    expect(createLeakFilter('').redact('qualquer coisa aqui').leaked).toBe(false);
  });
});

describe('createLeakFilter: JSON cru do provedor', () => {
  it('acha o trecho mesmo com \\n, \\" e \\u escritos como no JSON', () => {
    const escaped = JSON.stringify({ summary: PROMPT, ok: 'x' });
    const result = filter.redact(escaped);
    expect(result.leaked).toBe(true);
    expect(result.text).not.toContain('gestor de carteira');
    expect(result.text).not.toContain(CANARY);
  });

  it('redactDeep percorre objetos e listas e relata os caminhos', () => {
    const body = {
      id: 'chatcmpl-1',
      choices: [{ message: { content: `eco: ${PROMPT}`, role: 'assistant' } }],
      usage: { total_tokens: 12 },
    };
    const { value, paths } = filter.redactDeep(body);
    expect(JSON.stringify(value)).not.toContain(CANARY);
    expect(JSON.stringify(value)).not.toContain('gestor de carteira');
    expect(paths).toEqual(['choices.0.message.content']);
    expect((value as typeof body).usage.total_tokens).toBe(12);
    expect(body.choices[0]!.message.content).toContain(CANARY); // não muda o original
  });

  it('redactDeep não mexe no que não vaza', () => {
    const body = { a: ['x', 1, null, true], b: { c: 'texto comum' } };
    const { value, paths } = filter.redactDeep(body);
    expect(value).toEqual(body);
    expect(paths).toEqual([]);
  });
});

describe('createLeakFilter: Unicode', () => {
  // "não" decomposto (n, a, til solto, o) é a mesma palavra que o "não" composto
  const nfd = (text: string) => text.normalize('NFD');
  const SENTENCE = 'Compre pouco quando a notícia não for fraca e venda tudo hoje.';

  it('prompt composto, resposta decomposta (NFD): o trecho é achado', () => {
    const only = createLeakFilter(SENTENCE);
    const result = only.redact(nfd(SENTENCE));
    expect(result.leaked).toBe(true);
    expect(result.text).toBe(`${LEAK_WARNING}.`);
  });

  it('prompt decomposto, resposta composta: o trecho é achado', () => {
    const only = createLeakFilter(nfd(SENTENCE));
    const result = only.redact(SENTENCE);
    expect(result.leaked).toBe(true);
    expect(result.text).toBe(`${LEAK_WARNING}.`);
  });

  it('soft hyphen e largura zero no meio das palavras não escondem o trecho', () => {
    const only = createLeakFilter(SENTENCE);
    const sneaky = 'Com\u00ADpre po\u200Buco quando a notícia não for fraca e venda tudo hoje.';
    expect(only.redact(sneaky).leaked).toBe(true);
  });

  it('marca solta ou invisível sozinha não conta como palavra (não quebra a janela)', () => {
    const only = createLeakFilter(SENTENCE);
    expect(
      only.redact('Compre pouco quando a notícia não \u0301 for fraca e venda tudo hoje.').leaked,
    ).toBe(true);
  });
});

describe('createLeakFilter: só o canário (o dado que é nosso)', () => {
  it('troca o canário e deixa passar o que só se parece com o prompt', () => {
    const copied = 'Responda sempre em português do Brasil, apenas com o JSON do formato pedido.';
    expect(filter.redact(copied).leaked).toBe(true);
    expect(filter.redactCanary(copied)).toEqual({ text: copied, leaked: false });
    expect(filter.redactCanary(`x ${CANARY} y`)).toEqual({
      text: `x ${LEAK_WARNING} y`,
      leaked: true,
    });
  });

  it('sem canário no prompt não há o que procurar', () => {
    const text = `${CANARY} qualquer coisa`;
    expect(createLeakFilter('só texto, sem linha de controle nenhuma').redactCanary(text)).toEqual({
      text,
      leaked: false,
    });
  });
});

describe('hasCanary: o prompt de produção tem de trazer a linha de controle', () => {
  it.each([
    [`Controle ${CANARY} aqui`, true],
    ['alv-canary-0123456789abcdef', true], // 16 caracteres, o mínimo
    ['ALV-CANARY-0123456789ABCDEF', true], // a caixa não importa
    ['alv-canary-0123456789abcde', false], // 15: curto
    ['alv-canary-0123456789-abcdef', false], // hífen no meio do token
    ['TODO: escrever o prompt', false],
    ['', false],
  ])('%j -> %s', (prompt, expected) => {
    expect(hasCanary(prompt)).toBe(expected);
  });
});

// O prompt tem de descrever o formato de saída (docs/ARENA.md, seção 6), e toda resposta repete as chaves e os números dele.
// O n-grama sobre o JSON cru marcaria quase toda resposta comum.
describe('createLeakFilter: o formato de saída que o prompt descreve não é vazamento', () => {
  const FORMAT_EXAMPLE = JSON.stringify(
    {
      summary: 'até 600 caracteres, em português',
      market_view: 'otimista | pessimista | neutro',
      decisions: [
        {
          ticker: 'WEGE3',
          action: 'BUY',
          percent_of_equity: 10,
          confidence: 0.7,
          rationale: 'até 280 caracteres',
        },
        {
          ticker: 'VALE3',
          action: 'SELL',
          percent_of_position: 50,
          confidence: 0.6,
          rationale: 'motivo',
        },
        { ticker: 'ITUB4', action: 'HOLD', rationale: 'motivo' },
      ],
    },
    null,
    2,
  );
  const WITH_FORMAT = [
    'Você é um gestor de carteira que decide uma vez por dia com dados congelados.',
    `Linha de controle ${CANARY} que nunca deve aparecer em resposta pública.`,
    'Responda somente com este JSON:',
    FORMAT_EXAMPLE,
  ].join('\n');
  const formatted = createLeakFilter(WITH_FORMAT);

  // uma resposta comum: mesmas chaves, mesmos números, outros tickers e outros textos
  const typical = JSON.stringify({
    summary: 'Cenário calmo; reduzo mineração e aumento energia.',
    market_view: 'neutro',
    decisions: [
      {
        ticker: 'PETR4',
        action: 'BUY',
        percent_of_equity: 10,
        confidence: 0.7,
        rationale: 'Petróleo firme e dividendos.',
      },
      {
        ticker: 'ABEV3',
        action: 'SELL',
        percent_of_position: 50,
        confidence: 0.6,
        rationale: 'Margem pressionada.',
      },
    ],
  });

  it('o n-grama sobre o JSON cru marca a resposta comum (por isso o conteúdo é lido como documento)', () => {
    expect(formatted.redact(typical).leaked).toBe(true);
  });

  it('redactModelOutput devolve a resposta comum exatamente como veio', () => {
    expect(formatted.redactModelOutput(typical)).toEqual({ text: typical, leaked: false });
    const pretty = JSON.stringify(JSON.parse(typical), null, 4);
    expect(formatted.redactModelOutput(pretty)).toEqual({ text: pretty, leaked: false });
  });

  it('redactDeep faz o mesmo com a resposta do provedor: o conteúdo é um documento JSON dentro de um texto', () => {
    const provider = {
      id: 'gen-1',
      choices: [{ message: { role: 'assistant', content: typical }, finish_reason: 'stop' }],
      usage: { total_tokens: 12 },
    };
    const { value, paths } = formatted.redactDeep(provider);
    expect(paths).toEqual([]);
    expect(value).toEqual(provider);
    expect((value as typeof provider).choices[0]!.message.content).toBe(typical);
  });

  it('o texto de dentro continua filtrado: o prompt no summary e no rationale some, o resto fica', () => {
    const echo = JSON.stringify({
      summary: WITH_FORMAT,
      market_view: 'neutro',
      decisions: [
        { ticker: 'PETR4', action: 'HOLD', rationale: 'Sem fato novo.' },
        { ticker: 'VALE3', action: 'HOLD', rationale: `Veja: ${CANARY}` },
      ],
    });
    const result = formatted.redactModelOutput(echo);
    expect(result.leaked).toBe(true);
    expect(result.text).not.toContain(CANARY);
    expect(result.text).not.toContain('gestor de carteira');
    const parsed = JSON.parse(result.text) as {
      market_view: string;
      decisions: Array<{ rationale: string }>;
    };
    expect(parsed.market_view).toBe('neutro');
    expect(parsed.decisions[0]!.rationale).toBe('Sem fato novo.');
    expect(parsed.decisions[1]!.rationale).toBe(`Veja: ${LEAK_WARNING}`);
  });

  it('o canário vale no documento inteiro: numa chave também', () => {
    const inKey = JSON.stringify({
      [CANARY]: 1,
      summary: 'x',
      market_view: 'neutro',
      decisions: [],
    });
    const result = formatted.redactModelOutput(inKey);
    expect(result.leaked).toBe(true);
    expect(result.text).not.toContain(CANARY);
    expect(JSON.parse(result.text)).toHaveProperty(LEAK_WARNING, 1);
  });

  it('o que não é JSON segue pelo n-grama de sempre, e JSON dentro de JSON também é lido', () => {
    expect(formatted.redactModelOutput(`eco: ${WITH_FORMAT}`).leaked).toBe(true);
    const nested = {
      content: JSON.stringify({ outer: JSON.stringify({ rationale: WITH_FORMAT }) }),
    };
    const { value, paths } = formatted.redactDeep(nested);
    expect(paths).toEqual(['content']);
    expect(JSON.stringify(value)).not.toContain('gestor de carteira');
  });

  it('JSON torto não derruba o filtro', () => {
    expect(formatted.redactModelOutput('{"summary": ').leaked).toBe(false);
  });

  it('JSON fundo demais dentro de um texto (um modelo em laço) volta ao n-grama de sempre, em vez de falhar', () => {
    let deep: unknown = WITH_FORMAT; // o prompt no fundo do aninhamento
    for (let i = 0; i < 60; i += 1) deep = { a: deep };
    const result = formatted.redactModelOutput(JSON.stringify(deep));
    expect(result.leaked).toBe(true);
    expect(result.text).not.toContain(CANARY);
    // e o mesmo texto sem nada do prompt passa
    let harmless: unknown = 'nada a ver com o prompt';
    for (let i = 0; i < 60; i += 1) harmless = { a: harmless };
    expect(formatted.redactModelOutput(JSON.stringify(harmless)).leaked).toBe(false);
  });

  it('o valor (não o texto) fundo demais continua sendo erro: a resposta do provedor nunca chega assim', () => {
    let deep: unknown = 'x';
    for (let i = 0; i < 40; i += 1) deep = { a: deep };
    expect(() => formatted.redactDeep(deep)).toThrow(RangeError);
  });
});
