import { describe, expect, it } from 'vitest';
import {
  NO_QUOTES,
  TAPE_LIMIT,
  TAPE_SEPARATOR,
  heroTape,
  macroParts,
  quoteText,
  tapeLoop,
  tapeText,
} from './fita';

// A fita do hero: o texto de cada cotação (ticker, fechamento, glifo e sinal), o macro e a lista vazia.
describe('quoteText', () => {
  it('o fechamento sem o símbolo e a variação com o glifo e o sinal', () => {
    expect(quoteText({ ticker: 'PETR4', closeCents: 3_812, previousCloseCents: 3_767 })).toBe(
      'PETR4 38,12 ▲ +1,19%',
    );
    expect(quoteText({ ticker: 'BOVA11', closeCents: 6_625, previousCloseCents: 6_690 })).toBe(
      'BOVA11 66,25 ▼ -0,97%',
    );
    expect(quoteText({ ticker: 'VALE3', closeCents: 5_000, previousCloseCents: 5_000 })).toBe(
      'VALE3 50,00 ■ 0,00%',
    );
  });

  it('sem o fechamento anterior (o primeiro pregão do papel), só o fechamento', () => {
    expect(quoteText({ ticker: 'MOVE3', closeCents: 1_234_567, previousCloseCents: null })).toBe(
      'MOVE3 12.345,67',
    );
    expect(quoteText({ ticker: 'MOVE3', closeCents: 100, previousCloseCents: 0 })).toBe(
      'MOVE3 1,00',
    );
  });
});

describe('macroParts', () => {
  const point = (value: string) => ({ date: '2026-11-30', value });

  it('cada valor do Banco Central com a unidade, como a faixa de cotações', () => {
    expect(
      macroParts({
        cdi: point('0.050140'),
        selic: point('14.50'),
        ipcaMonth: point('0.59'),
        ipca12m: point('4.78'),
        usd: point('5.4281'),
      }),
    ).toEqual([
      'CDI 0,050140% ao dia',
      'Selic 14,50% ao ano',
      'IPCA 0,59% no mês',
      'IPCA 4,78% em 12 meses',
      'Dólar R$ 5,4281',
    ]);
  });

  it('o valor que falta não entra', () => {
    expect(
      macroParts({ cdi: null, selic: point('14.50'), ipcaMonth: null, ipca12m: null, usd: null }),
    ).toEqual(['Selic 14,50% ao ano']);
  });
});

describe('tapeText e tapeLoop', () => {
  it('as partes vão separadas por um ponto no meio, e a lista vazia diz que não há cotação', () => {
    expect(tapeText(['A 1,00', 'B 2,00'])).toBe(`A 1,00${TAPE_SEPARATOR}B 2,00`);
    expect(tapeText([])).toBe(NO_QUOTES);
  });

  it('uma volta repete a linha (com o separador) até passar do mínimo, sem cortar no meio', () => {
    const loop = tapeLoop('BOVA11 66,25', 100);
    const unit = `BOVA11 66,25${TAPE_SEPARATOR}`;
    expect(loop.length).toBeGreaterThanOrEqual(100);
    expect(loop).toBe(unit.repeat(Math.ceil(100 / unit.length)));
    // a linha mais longa que o mínimo vai uma vez só
    expect(tapeLoop('x'.repeat(500), 100)).toBe(`${'x'.repeat(500)}${TAPE_SEPARATOR}`);
  });
});

describe('heroTape', () => {
  const macro = {
    cdi: { date: '2026-11-03', value: '0.050140' },
    selic: null,
    ipcaMonth: null,
    ipca12m: null,
    usd: null,
  };
  const bova11 = { date: '2026-11-04', closeCents: 6_625, previousCloseCents: 6_690 };

  it('com a rota interna da fita: o universo da semana, na ordem, e a legenda com quantos papéis e o pregão', () => {
    const tape = heroTape(
      {
        date: '2026-11-04',
        rows: [
          { ticker: 'VALE3', closeCents: 6_100, previousCloseCents: null },
          { ticker: 'PETR4', closeCents: 3_200, previousCloseCents: 3_100 },
        ],
      },
      bova11,
      macro,
    );
    expect(tape.text).toBe(`VALE3 61,00${TAPE_SEPARATOR}PETR4 32,00 ▲ +3,23%`);
    expect(tape.caption).toBe(
      'Os mesmos 2 papéis da B3, lidos por todos os modelos. Cotações: brapi.dev, pregão de 04/11/2026.',
    );
    // o leitor de tela recebe o fechamento e o sinal, sem o glifo: o sinal já diz a direção (nas tabelas o glifo também é só decoração)
    expect(tape.label).toBe(
      'Fechamentos do pregão de 04/11/2026: VALE3 61,00; PETR4 32,00 +3,23%.',
    );
  });

  it('o universo grande vai cortado nos de maior volume (os primeiros), e a legenda conta todos', () => {
    const rows = Array.from({ length: TAPE_LIMIT + 5 }, (_, i) => ({
      ticker: `AAAA${i}`,
      closeCents: 1_000,
      previousCloseCents: null,
    }));
    const tape = heroTape({ date: '2026-11-04', rows }, null, macro);
    expect(tape.text.split(TAPE_SEPARATOR)).toHaveLength(TAPE_LIMIT);
    expect(tape.text).not.toContain(`AAAA${TAPE_LIMIT} `);
    expect(tape.caption).toContain(`Os mesmos ${TAPE_LIMIT + 5} papéis da B3`);
    expect(tape.label).toContain(`, os ${TAPE_LIMIT} de maior volume:`);
  });

  it('sem a fita (antes do primeiro ciclo): o BOVA11 e o macro, com a outra legenda', () => {
    const tape = heroTape({ date: null, rows: [] }, bova11, macro);
    expect(tape.text).toBe(`BOVA11 66,25 ▼ -0,97%${TAPE_SEPARATOR}CDI 0,050140% ao dia`);
    expect(tape.label).toBe(
      'O BOVA11 e o macro do Banco Central: BOVA11 66,25 -0,97%; CDI 0,050140% ao dia.',
    );
    expect(tape.caption).toBe(
      'O mesmo briefing para todos os modelos: o BOVA11 e o macro do Banco Central. Cotações: brapi.dev, pregão de 04/11/2026.',
    );
  });

  it('sem nada: a fita diz que não há cotação, e a legenda fica com o crédito sem data', () => {
    const empty = { cdi: null, selic: null, ipcaMonth: null, ipca12m: null, usd: null };
    const tape = heroTape({ date: null, rows: [] }, null, empty);
    expect(tape.text).toBe(NO_QUOTES);
    expect(tape.label).toBe(NO_QUOTES);
    expect(tape.caption).toBe(
      'O mesmo briefing para todos os modelos: o BOVA11 e o macro do Banco Central. Cotações: brapi.dev.',
    );
  });
});
