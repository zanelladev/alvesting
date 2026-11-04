import type { DecisionItem, ParsedLlmDecision } from '@alvesting/contracts';
import { describe, expect, it } from 'vitest';
import { buildDecisionItems } from './decision-items.js';
import type { SemanticContext } from './decision-validation.js';
import { LEAK_WARNING, createLeakFilter } from './leak-filter.js';

// O prompt aqui é sintético: gerado no teste, nunca o de verdade.
const CANARY = 'alv-canary-0a1b2c3d4e5f60718293a4b5';
// 98 palavras que nenhuma resposta comum repete: "p000 p001 ... p097"
const PROMPT_WORDS = Array.from({ length: 98 }, (_, i) => `p${String(i).padStart(3, '0')}`);
const PROMPT = `Controle ${CANARY} do teste. ${PROMPT_WORDS.join(' ')}.`;
const filter = createLeakFilter(PROMPT);

const hold = (ticker: string, rationale = 'Sem fato novo.'): DecisionItem => ({
  ticker,
  action: 'HOLD',
  rationale,
});
const buy = (ticker: string, rationale = 'Compra.'): DecisionItem => ({
  ticker,
  action: 'BUY',
  percent_of_equity: 10,
  confidence: 0.7,
  rationale,
});

const context = (overrides: Partial<SemanticContext> = {}): SemanticContext => ({
  universe: new Set(['PETR4', 'VALE3', 'ITUB4']),
  holdings: new Map(),
  maxPositions: 10,
  maxOrders: 5,
  ...overrides,
});
const parsed = (
  decisions: DecisionItem[],
  summary = 'Dia calmo.',
  dropped: ParsedLlmDecision['dropped'] = [],
): ParsedLlmDecision => ({ summary, market_view: 'neutro', decisions, dropped });

describe('buildDecisionItems: o texto do modelo é texto de terceiro', () => {
  it('tira controle (o NUL que o Postgres recusa), bidi, largura zero, HTML, quebra de linha e espaço dobrado', () => {
    const built = buildDecisionItems(
      parsed(
        [buy('PETR4', 'Compra\u0000 de <b>PETR4</b> \u202Efoi\u200B boa,\r\n  de verdade.')],
        'Cenário\u0000 calmo\u202E\u200B; <img src=x onerror=alert(1)> reduzo\n\nenergia.',
      ),
      context(),
      filter,
    );
    expect(built.summary).toBe('Cenário calmo; reduzo energia.');
    expect(built.items[0]!.rationale).toBe('Compra de PETR4 foi boa, de verdade.');
    expect(built.leakFields).toEqual([]);
    // nada de caractere de controle, de formato nem de tag no que vai ao banco e à API
    for (const text of [built.summary, built.items[0]!.rationale!]) {
      expect(text).not.toMatch(/[\p{C}\p{Default_Ignorable_Code_Point}<>]/u);
      expect(text).not.toContain('\n');
    }
  });

  it('o link vira um aviso, com ou sem esquema (http, ftp, www)', () => {
    const built = buildDecisionItems(
      parsed(
        [hold('PETR4', 'Detalhes em http://exemplo.com/a?b=1&c=2 e ftp://x.org/y.')],
        'Veja https://exemplo.com/r e WWW.exemplo.com.br/pix hoje.',
      ),
      context(),
      filter,
    );
    expect(built.summary).toBe('Veja [link removido] e [link removido] hoje.');
    expect(built.items[0]!.rationale).toBe('Detalhes em [link removido] e [link removido]');
  });

  it('texto comum com acento, emoji e símbolos passa como veio (NFC)', () => {
    const text = 'Selic em 14,75% a.a. — lucro < 5% não muda a tese 📈 (R$ 1,2 mi).';
    const built = buildDecisionItems(parsed([hold('PETR4', text)], text), context(), filter);
    expect(built.summary).toBe(text);
    expect(built.items[0]!.rationale).toBe(text);
  });

  it('a limpeza vem antes do filtro: invisível no meio da palavra não esconde o trecho do prompt', () => {
    const sneaky = PROMPT_WORDS.slice(0, 9)
      .map((word) => `${word.slice(0, 2)}\u200B${word.slice(2)}`)
      .join(' ');
    const built = buildDecisionItems(parsed([hold('PETR4')], sneaky), context(), filter);
    expect(built.leakFields).toEqual(['summary']);
    expect(built.summary).toBe(LEAK_WARNING);
  });

  it('o canário num dos campos troca só o trecho dele e registra só o nome do campo', () => {
    const built = buildDecisionItems(
      parsed([hold('PETR4', 'ok'), hold('VALE3', `Controle ${CANARY} aqui.`)]),
      context(),
      filter,
    );
    expect(built.leakFields).toEqual(['decisions.1.rationale']);
    expect(built.items.map((i) => i.rationale)).toEqual(['ok', `Controle ${LEAK_WARNING} aqui.`]);
    expect(built.summary).toBe('Dia calmo.');
  });
});

describe('buildDecisionItems: o prompt partido em pedaços de 7 palavras', () => {
  // 14 campos de 7 palavras: nenhum chega ao limiar de 8, e juntos são o prompt inteiro
  const slices = Array.from({ length: 14 }, (_, i) =>
    PROMPT_WORDS.slice(i * 7, i * 7 + 7).join(' '),
  );
  const attack = () =>
    parsed(
      slices.slice(1).map((slice, i) => hold(`HOL${String.fromCharCode(65 + i)}1`, slice)),
      slices[0],
    );

  it('cada pedaço sozinho passa pelo filtro (é por isso que o conjunto é conferido)', () => {
    for (const slice of slices) expect(filter.redact(slice).leaked).toBe(false);
  });

  it('o conjunto remontado é achado: todos os textos viram o aviso, e todos os campos são registrados', () => {
    const built = buildDecisionItems(attack(), context(), filter);
    expect(built.summary).toBe(LEAK_WARNING);
    expect(built.items).toHaveLength(13);
    expect(built.items.every((item) => item.rationale === LEAK_WARNING)).toBe(true);
    expect(built.leakFields).toHaveLength(14);
    expect(built.leakFields[0]).toBe('summary');
    expect(built.leakFields[1]).toBe('decisions.0.rationale');
    // nada do prompt sobrou em lugar nenhum
    const everything = JSON.stringify(built);
    for (const word of PROMPT_WORDS.slice(0, 40)) expect(everything).not.toContain(word);
    // as ordens, os tickers e os percentuais não são texto público: ficam
    expect(built.items.map((i) => i.action)).toEqual(Array(13).fill('HOLD'));
  });

  it('só os textos que ficam entram na conta: item descartado não leva o seu texto para o conjunto', () => {
    // XPTO3 está fora do universo: o BUY é descartado e o rationale dele nem é guardado
    const decisions = [buy('XPTO3', slices[1]), hold('PETR4', slices[2])];
    const built = buildDecisionItems(parsed(decisions, slices[0]), context(), filter);
    expect(built.leakFields).toEqual([]);
    expect(built.items[0]).toMatchObject({ dropped: true, rationale: null });
  });

  it('textos sem relação com o prompt nunca disparam o conjunto', () => {
    const decisions = Array.from({ length: 30 }, (_, i) =>
      hold(`HOL${String.fromCharCode(65 + (i % 26))}${i}`, `Mantém a posição ${i} sem fato novo.`),
    );
    const built = buildDecisionItems(parsed(decisions), context(), filter);
    expect(built.leakFields).toEqual([]);
    expect(built.items.some((item) => item.rationale === LEAK_WARNING)).toBe(false);
  });
});

describe('buildDecisionItems: o resto da decisão', () => {
  it('guarda ação, ticker e percentual do item descartado, mas não o texto', () => {
    const built = buildDecisionItems(
      parsed([buy('XPTO3', 'texto que não pode ser guardado')]),
      context(),
      filter,
    );
    expect(built.items).toEqual([
      {
        position: 0,
        action: 'BUY',
        ticker: 'XPTO3',
        percent: 10,
        confidence: 0.7,
        rationale: null,
        dropped: true,
        dropReason: 'not_in_universe',
        dropDetail: null,
      },
    ]);
    expect(built.dropped).toEqual([{ index: 0, reason: 'not_in_universe', detail: null }]);
  });

  it('o item que o parser descartou entra com os códigos dos campos, na posição dele', () => {
    const built = buildDecisionItems(
      parsed([hold('PETR4')], 'Dia calmo.', [
        {
          index: 1,
          reason: 'invalid_item',
          issues: [{ code: 'too_big', path: ['percent_of_equity'] } as never],
        },
      ]),
      context(),
      filter,
    );
    expect(built.items.map((i) => [i.position, i.dropped, i.dropDetail])).toEqual([
      [0, false, null],
      [1, true, 'percent_of_equity:too_big'],
    ]);
  });

  it('o corte dos textos respeita 600 caracteres no resumo e 280 no motivo', () => {
    const built = buildDecisionItems(
      parsed([hold('PETR4', 'y'.repeat(280))], 'x'.repeat(600)),
      context(),
      filter,
    );
    expect(built.summary).toHaveLength(600);
    expect(built.items[0]!.rationale).toHaveLength(280);
  });
});
