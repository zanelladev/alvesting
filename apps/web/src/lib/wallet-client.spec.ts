import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseBrl } from '@alvesting/contracts/portfolio-rules';
import type { Reply } from './account-client';
import {
  LOTS_PATH,
  centsText,
  checkLot,
  createdMessage,
  describeLot,
  lotFailure,
  lotSummary,
  pastedCents,
  removedMessage,
  savedMessage,
  typedCents,
  alocacao,
  type LotDraft,
} from './wallet-client';

// O que o navegador faz com a carteira (etapa 12, parte 2): conferir o que a pessoa digitou com a MESMA regra de dinheiro da api (o pacote de
// contratos, sem zod), montar o corpo e dizer em português e no campo o que a api recusou. Nenhum teste chama rede.
const draft = (over: Partial<LotDraft> = {}): LotDraft => ({
  ticker: 'MOVE3',
  quantity: '100',
  mode: 'unit',
  value: '35,50',
  boughtOn: '',
  ...over,
});

const NB = '\u00a0';

describe('checkLot', () => {
  it('os dois modos dão o mesmo custo total para os mesmos números (o aceite da etapa 12)', () => {
    const unit = checkLot(draft({ mode: 'unit', value: '35,50' }));
    const total = checkLot(draft({ mode: 'total', value: '3.550,00' }));
    expect(unit).toMatchObject({ ok: true, costCents: 355_000 });
    expect(total).toMatchObject({ ok: true, costCents: 355_000 });
    // o corpo para a api: o valor em centavos e o modo, que a api reaplica
    expect(unit.ok && unit.body).toEqual({
      ticker: 'MOVE3',
      quantity: 100,
      mode: 'unit',
      valueCents: 3_550,
    });
    expect(total.ok && total.body).toEqual({
      ticker: 'MOVE3',
      quantity: 100,
      mode: 'total',
      valueCents: 355_000,
    });
  });

  it('varia o par quantidade × preço: o custo é o produto exato em centavos, nunca em ponto flutuante', () => {
    for (const [quantity, unit, total, cost] of [
      ['7', '1.234,56', '8.641,92', 864_192],
      ['250', '0,07', '17,50', 1_750],
      ['3', '0,01', '0,03', 3],
      ['1', '1.000.000.000,00', '1.000.000.000,00', 100_000_000_000],
      ['1000000', '1.000,00', '1.000.000.000,00', 100_000_000_000],
      ['999999', '0,29', '289.999,71', 28_999_971],
    ] as const) {
      expect(
        checkLot(draft({ quantity, mode: 'unit', value: unit })),
        `${quantity} × ${unit}`,
      ).toMatchObject({
        ok: true,
        costCents: cost,
      });
      expect(
        checkLot(draft({ quantity, mode: 'total', value: total })),
        `total ${total}`,
      ).toMatchObject({
        ok: true,
        costCents: cost,
      });
    }
  });

  it('o ticker é aparado e vai em maiúsculas; a data só vai se foi informada', () => {
    const lowercase = checkLot(draft({ ticker: '  move3 ', boughtOn: '' }));
    expect(lowercase.ok && lowercase.body).not.toHaveProperty('boughtOn');
    expect(lowercase.ok && lowercase.body.ticker).toBe('MOVE3');
    const dated = checkLot(draft({ boughtOn: '2026-10-15' }));
    expect(dated.ok && dated.body.boughtOn).toBe('2026-10-15');
    // o tamanho exato do ticker de 6 caracteres (BOVA11 é recusado pela api, não aqui)
    expect(checkLot(draft({ ticker: 'b3sa3' })).ok).toBe(true);
  });

  it('todos os campos são conferidos de uma vez, um erro por campo, na chave do `name` do campo', () => {
    const out = checkLot(draft({ ticker: '', quantity: '', value: '', boughtOn: '15/10/2026' }));
    expect(out.ok).toBe(false);
    expect(!out.ok && Object.keys(out.fields).sort()).toEqual([
      'boughtOn',
      'quantity',
      'ticker',
      'value',
    ]);
    expect(!out.ok && out.fields.ticker).toBe('Informe o ticker da ação, como PETR4.');
    expect(!out.ok && out.fields.quantity).toBe('Informe a quantidade de ações.');
    expect(!out.ok && out.fields.value).toBe('Informe o valor.');
    expect(!out.ok && out.fields.boughtOn).toMatch(/Data inválida/);
  });

  it.each([
    ['PETR 4', /só letras e números/],
    ['PETR4;', /só letras e números/],
    ['PETR-4', /só letras e números/],
    ['A'.repeat(13), /só letras e números/],
  ])('ticker %j é recusado, com a frase do ticker', (ticker, message) => {
    const out = checkLot(draft({ ticker }));
    expect(!out.ok && out.fields.ticker).toMatch(message);
  });

  it.each([
    ['0', 'A quantidade precisa ser pelo menos 1.'],
    ['00', 'A quantidade precisa ser pelo menos 1.'],
    ['1.000', 'Use só números inteiros, sem ponto, vírgula nem sinal. Ex.: 100.'],
    ['1,5', 'Use só números inteiros, sem ponto, vírgula nem sinal. Ex.: 100.'],
    ['-3', 'Use só números inteiros, sem ponto, vírgula nem sinal. Ex.: 100.'],
    ['1e3', 'Use só números inteiros, sem ponto, vírgula nem sinal. Ex.: 100.'],
    ['1000001', `A quantidade passa de 1.000.000 ações por lançamento.`],
    ['99999999999999999999', `A quantidade passa de 1.000.000 ações por lançamento.`],
  ])('quantidade %j é recusada: %s', (quantity, message) => {
    const out = checkLot(draft({ quantity }));
    expect(!out.ok && out.fields.quantity).toBe(message);
    expect(!out.ok && Object.keys(out.fields)).toEqual(['quantity']);
  });

  it.each([
    ['', 'Informe o valor.'],
    ['R$ 12', 'Valor inválido. Use só números, com vírgula nos centavos. Ex.: 35,50.'],
    ['1e3', 'Valor inválido. Use só números, com vírgula nos centavos. Ex.: 35,50.'],
    ['-5', 'Valor inválido. Use só números, com vírgula nos centavos. Ex.: 35,50.'],
    ['0', 'O valor precisa ser maior que zero.'],
    ['0,00', 'O valor precisa ser maior que zero.'],
    ['1.000.000.000,01', `O valor passa de R$${NB}1.000.000.000,00.`],
  ])('valor %j é recusado: %s', (value, message) => {
    const out = checkLot(draft({ value }));
    expect(!out.ok && out.fields.value).toBe(message);
  });

  it('o ponto com 3 dígitos ("1.234") não é adivinhado: a frase manda escrever com vírgula', () => {
    for (const value of ['1.234', '12.345']) {
      const out = checkLot(draft({ value }));
      expect(!out.ok && out.fields.value).toBe(
        'Não dá para saber se o ponto separa milhares ou centavos. Escreva 1.234,00 ou 1234, com vírgula nos centavos.',
      );
    }
    // com um ou dois dígitos o ponto é o separador decimal (o teclado numérico de alguns Android só tem o ponto)
    expect(checkLot(draft({ value: '12.5' }))).toMatchObject({ ok: true, costCents: 125_000 });
    expect(checkLot(draft({ value: '0.35', quantity: '100' }))).toMatchObject({
      ok: true,
      costCents: 3_500,
    });
  });

  it('mais de 2 casas: no modo "por ação" a saída é o total; no modo "total" é só cortar a casa', () => {
    const unit = checkLot(draft({ mode: 'unit', value: '12,345' }));
    expect(!unit.ok && unit.fields.value).toBe(
      'Use no máximo 2 casas depois da vírgula. Se o preço tem mais casas, escolha “Valor total pago” e informe o total.',
    );
    const total = checkLot(draft({ mode: 'total', value: '12,345' }));
    expect(!total.ok && total.fields.value).toBe(
      'Use no máximo 2 casas depois da vírgula (os centavos).',
    );
  });

  it('o produto passa do teto do custo (1.000.000 de ações a R$ 100.000,00): o erro vai no campo do valor', () => {
    const out = checkLot(draft({ quantity: '1000000', value: '100.000,00' }));
    expect(!out.ok && out.fields).toEqual({
      value: `O custo total passa de R$${NB}1.000.000.000,00. Confira a quantidade e o valor.`,
    });
    // o mesmo valor, como total, cabe só se não passar do teto
    expect(
      checkLot(draft({ mode: 'total', quantity: '1000000', value: '1.000.000.000,00' })).ok,
    ).toBe(true);
  });

  it('a data de hoje para trás passa na conferência daqui (quem confere se é futura é a api, no relógio dela)', () => {
    expect(checkLot(draft({ boughtOn: '2099-01-01' })).ok).toBe(true);
    expect(checkLot(draft({ boughtOn: '2026-1-5' })).ok).toBe(false);
  });
});

// O campo de dinheiro do lançamento (o padrão dos bancos brasileiros): os centavos entram pela direita. O campo guarda os algarismos (os centavos,
// sem os zeros da frente) e mostra o texto deles; cada tecla é lida do texto novo do campo.
describe('o campo de dinheiro: os centavos entram pela direita', () => {
  // o que acontece no campo quando a pessoa digita uma tecla no fim do que ele mostra
  const press = (digits: string, key: string) => typedCents(centsText(digits) + key);

  it('cada algarismo empurra os outros para a esquerda: 3, 35, 355 e 3.550 viram 0,03, 0,35, 3,55 e 35,50', () => {
    const shown: string[] = [];
    let digits = '';
    for (const key of '3550') {
      digits = press(digits, key)!;
      shown.push(centsText(digits));
    }
    expect(shown).toEqual(['0,03', '0,35', '3,55', '35,50']);
  });

  it('o vazio mostra o marcador (o campo fica vazio), e o zero sozinho não entra', () => {
    expect(centsText('')).toBe('');
    expect(press('', '0')).toBe('');
    expect(press('', '7')).toBe('7');
  });

  it('o Backspace tira o último algarismo (o texto perde o último caractere)', () => {
    expect(typedCents('35,5')).toBe('355');
    expect(typedCents('0,0')).toBe('');
    expect(typedCents('')).toBe('');
  });

  it('o milhar aparece enquanto digita', () => {
    expect(centsText('123456')).toBe('1.234,56');
    expect(centsText('100000000000')).toBe('1.000.000.000,00');
    expect(press('12345', '6')).toBe('123456');
  });

  it('só algarismos contam: a vírgula, o ponto e a letra não mudam nada', () => {
    expect(press('355', ',')).toBe('355');
    expect(press('355', '.')).toBe('355');
    expect(press('355', 'a')).toBe('355');
    // o dígito de outro alfabeto também não (o "٣" árabe)
    expect(press('355', '٣')).toBe('355');
  });

  it('no máximo 12 algarismos: o 13º não entra (null: o campo fica como estava)', () => {
    expect(press('99999999999', '9')).toBe('999999999999');
    expect(press('999999999999', '9')).toBeNull();
  });

  it('colar passa pela regra do contrato (parseBrl): "35", "35,5", "1.234,56" e "R$ 35,50" viram os centavos', () => {
    expect(pastedCents('35')).toBe('3500');
    expect(pastedCents('35,5')).toBe('3550');
    expect(pastedCents('1.234,56')).toBe('123456');
    expect(pastedCents('R$ 35,50')).toBe('3550');
    expect(pastedCents(`R$${NB}35,50`)).toBe('3550');
    expect(pastedCents(' 12.5 ')).toBe('1250');
  });

  it('o que o parseBrl recusa, colado, não muda nada (null)', () => {
    for (const text of ['1.234', '12,345', 'abc', '-5', '0,00', 'R$', '', '1.000.000.000,01']) {
      expect(pastedCents(text), text).toBeNull();
    }
  });

  it('o texto do campo é lido pela mesma regra do envio (o checkLot): nenhum centavo se perde', () => {
    for (const cents of [
      1, 9, 10, 99, 100, 101, 12_345, 355_000, 864_192, 99_999_999_999, 100_000_000_000,
    ]) {
      expect(parseBrl(centsText(String(cents))), String(cents)).toEqual({ ok: true, cents });
    }
  });
});

// A linha acima dos botões do modal: o custo total no modo por ação e o preço médio no modo total, a regra da api (divRound: o mais próximo,
// com o meio para longe do zero), em conta inteira.
describe('lotSummary', () => {
  it('no modo por ação, o custo total é a quantidade vezes o preço', () => {
    expect(lotSummary('unit', 100, 3_550)).toEqual({ label: 'Custo total', cents: 355_000 });
    expect(lotSummary('unit', 7, 123_456)).toEqual({ label: 'Custo total', cents: 864_192 });
  });

  it('no modo total, o preço médio por ação, arredondado no centavo com o meio para longe do zero', () => {
    expect(lotSummary('total', 100, 355_000)).toEqual({
      label: 'Preço médio por ação',
      cents: 3_550,
    });
    // 100 ações por R$ 3.550,50: R$ 35,505 sobe para R$ 35,51
    expect(lotSummary('total', 100, 355_050)!.cents).toBe(3_551);
    // 3 ações por R$ 10,00: R$ 3,333... fica em R$ 3,33
    expect(lotSummary('total', 3, 1_000)!.cents).toBe(333);
    // 2 por R$ 0,01: meio centavo sobe para 1
    expect(lotSummary('total', 2, 1)!.cents).toBe(1);
    // o maior total pela menor divisão: inteiro, sem perder o centavo
    expect(lotSummary('total', 2, 99_999_999_999)!.cents).toBe(50_000_000_000);
  });

  it('some sem valor e acima do teto do custo', () => {
    expect(lotSummary('unit', 100, null)).toBeNull();
    // 1.000.000 de ações a R$ 100.000,00: R$ 100 bilhões, acima do teto de R$ 1 bilhão
    expect(lotSummary('unit', 1_000_000, 10_000_000)).toBeNull();
    expect(lotSummary('total', 10, 100_000_000_001)).toBeNull();
  });
});

describe('as frases do resultado', () => {
  it('descrevem o lançamento com a quantidade agrupada e o custo em reais', () => {
    const lot = { quantity: 100, ticker: 'MOVE3' };
    expect(describeLot({ quantity: 1_000_000, ticker: 'SINA3' })).toBe('1.000.000 SINA3');
    expect(createdMessage(lot, 355_000)).toBe(
      `Compra lançada: 100 MOVE3, custo total R$${NB}3.550,00.`,
    );
    expect(savedMessage(lot, 177_500)).toBe(
      `Lançamento salvo: 100 MOVE3, custo total R$${NB}1.775,00.`,
    );
    expect(removedMessage(lot)).toBe('Lançamento apagado: 100 MOVE3.');
  });

  it('o caminho das rotas é o da api, na mesma origem', () => {
    expect(LOTS_PATH).toBe('/api/v1/me/portfolio/lots');
  });
});

describe('lotFailure', () => {
  const failure = (over: Partial<Reply>): Reply => ({ ok: false, status: 400, ...over });

  it('o 400 de validação põe a frase no campo que a api recusou (valueCents é o campo "value" do formulário)', () => {
    expect(lotFailure(failure({ code: 'VALIDATION_ERROR', paths: ['ticker'] })).fields).toEqual({
      ticker:
        'Não encontramos esta ação. Use o código de uma ação da B3 que a Alvesting acompanha, como PETR4. O BOVA11 e os fundos não entram.',
    });
    expect(
      lotFailure(failure({ code: 'VALIDATION_ERROR', paths: ['valueCents', 'boughtOn'] })).fields,
    ).toEqual({
      value: `Confira o valor: o custo total do lançamento não pode passar de R$${NB}1.000.000.000,00.`,
      boughtOn: 'A data não pode ser no futuro nem anterior a 01/01/1900.',
    });
    expect(lotFailure(failure({ code: 'VALIDATION_ERROR', paths: ['quantity'] })).fields).toEqual({
      quantity: 'Confira a quantidade: um número inteiro de 1 a 1.000.000.',
    });
  });

  it('o campo repetido entra uma vez; o que o formulário não tem vira o aviso do formulário', () => {
    const repeated = lotFailure(failure({ code: 'VALIDATION_ERROR', paths: ['ticker', 'ticker'] }));
    expect(Object.keys(repeated.fields ?? {})).toEqual(['ticker']);
    for (const paths of [undefined, [], ['mode'], ['ruído']]) {
      const out = lotFailure(failure({ code: 'VALIDATION_ERROR', ...(paths ? { paths } : {}) }));
      expect(out.fields).toBeUndefined();
      expect(out.message).toBe('Não foi possível concluir. Confira os dados e tente de novo.');
    }
  });

  it('o limite de 200 lançamentos diz o que fazer', () => {
    expect(lotFailure(failure({ status: 409, code: 'LOT_LIMIT' })).message).toBe(
      'A carteira chegou ao máximo de 200 lançamentos. Apague algum para lançar outro.',
    );
  });

  it('o aceite vencido manda para a conta, e a sessão que acabou manda para a entrada', () => {
    expect(lotFailure(failure({ status: 403, code: 'CONSENT_REQUIRED' }))).toEqual({
      message: 'Os termos mudaram. Aceite a versão nova na sua conta para continuar.',
      link: 'conta',
    });
    expect(lotFailure(failure({ status: 401, code: 'UNAUTHORIZED' }))).toEqual({
      message: 'Sua sessão acabou. Entre de novo para continuar.',
      link: 'entrar',
    });
  });

  it('o lançamento que não existe mais (apagado noutra aba) pede a lista nova', () => {
    expect(lotFailure(failure({ status: 404, code: 'NOT_FOUND' }))).toEqual({
      gone: true,
      message: 'Este lançamento não existe mais (talvez tenha sido apagado em outra aba).',
    });
  });

  it('o resto cai nas frases de rede e de servidor da conta, e nunca na mensagem da api', () => {
    expect(lotFailure(failure({ status: 0 })).message).toMatch(/Sem conexão com o servidor/);
    expect(lotFailure(failure({ status: 500, code: 'INTERNAL_ERROR' })).message).toBe(
      'Não foi possível concluir agora. Tente de novo em alguns minutos.',
    );
    expect(lotFailure(failure({ status: 429, retryAfter: 7 })).message).toBe(
      'Muitas tentativas. Espere 7 segundos e tente de novo.',
    );
    // um 403 que não é o do aceite (o Origin) não manda a pessoa para a conta
    const forbidden = lotFailure(failure({ status: 403, code: 'FORBIDDEN' }));
    expect(forbidden.link).toBeUndefined();
    expect(forbidden.message).toBe('Não foi possível concluir. Confira os dados e tente de novo.');
  });
});

// A alocação da rosca (docs/TELAS.md, seção 9): o valor de cada posição com fechamento sobre o valor estimado, do maior para o menor, em
// pontos-base inteiros pela regra do projeto (`ratioBps`, o meio para longe do zero). Até seis ações, uma fatia por ação; mais que isso, as cinco
// maiores e "Outras", com a soma do resto. A posição sem cotação não tem valor e fica fora (o custo dela segue no custo total).
describe('alocacao', () => {
  const pos = (ticker: string, valueCents: number | null) => ({
    ticker,
    quantity: 10,
    costCents: 1_000,
    avgPriceCents: 100,
    closeCents: valueCents === null ? null : 100,
    closeDate: valueCents === null ? null : '2026-11-09',
    valueCents,
    pnlCents: valueCents === null ? null : valueCents - 1_000,
    pnlBps: null,
  });

  it('uma fatia por ação, da maior para a menor, com a parte em pontos-base e a cor na ordem', () => {
    expect(
      alocacao([pos('MOVE3', 1_429_400), pos('PAUS3', 21_047_500), pos('SINA3', 84_110)]),
    ).toEqual({
      totalCents: 22_561_010,
      fatias: [
        {
          id: 'PAUS3',
          nome: 'PAUS3',
          valueCents: 21_047_500,
          shareBps: 9_329,
          cor: 'var(--fatia-1)',
          tickers: ['PAUS3'],
        },
        {
          id: 'MOVE3',
          nome: 'MOVE3',
          valueCents: 1_429_400,
          shareBps: 634,
          cor: 'var(--fatia-2)',
          tickers: ['MOVE3'],
        },
        {
          id: 'SINA3',
          nome: 'SINA3',
          valueCents: 84_110,
          shareBps: 37,
          cor: 'var(--fatia-3)',
          tickers: ['SINA3'],
        },
      ],
    });
  });

  it('a posição sem cotação e a de valor zero ficam fora; sem nenhuma com valor, não há rosca', () => {
    expect(
      alocacao([pos('MOVE3', 500), pos('SEMN3', null), pos('ZERO3', 0)]).fatias.map((f) => f.id),
    ).toEqual(['MOVE3']);
    expect(alocacao([pos('SEMN3', null)])).toEqual({ totalCents: 0, fatias: [] });
    expect(alocacao([])).toEqual({ totalCents: 0, fatias: [] });
  });

  it('seis ações cabem uma a uma; a sétima junta as menores em "Outras", com a soma e a quantidade', () => {
    const seis = ['A', 'B', 'C', 'D', 'E', 'F'].map((t, i) => pos(`${t}AAA3`, (6 - i) * 100));
    expect(alocacao(seis).fatias.map((f) => f.id)).toEqual([
      'AAAA3',
      'BAAA3',
      'CAAA3',
      'DAAA3',
      'EAAA3',
      'FAAA3',
    ]);

    const oito = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((t, i) =>
      pos(`${t}AAA3`, (8 - i) * 100),
    );
    const { totalCents, fatias } = alocacao(oito);
    expect(totalCents).toBe(3_600);
    expect(fatias.map((f) => f.id)).toEqual([
      'AAAA3',
      'BAAA3',
      'CAAA3',
      'DAAA3',
      'EAAA3',
      'outras',
    ]);
    expect(fatias.at(-1)).toEqual({
      id: 'outras',
      nome: 'Outras (3 ações)',
      valueCents: 600,
      shareBps: 1_667,
      cor: 'var(--fatia-outras)',
      tickers: ['FAAA3', 'GAAA3', 'HAAA3'],
    });
  });

  // a cor de cada fatia é uma variável do `.rosca` do globals.css: a que não existe cai no `stroke` herdado (nenhum), e a fatia some do anel
  it('toda cor que a alocação dá existe no globals.css, a sexta fatia inclusive', () => {
    const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
    const rosca = /\.rosca \{([\s\S]*?)\}/.exec(css)?.[1] ?? '';
    const carteiras = [6, 7, 8].map((n) =>
      Array.from({ length: n }, (_, i) => pos(`${String.fromCharCode(65 + i)}AAA3`, (n - i) * 100)),
    );
    const cores = new Set(carteiras.flatMap((c) => alocacao(c).fatias.map((f) => f.cor)));
    expect([...cores]).toContain('var(--fatia-6)');
    for (const cor of cores) {
      const nome = /^var\((--[a-z0-9-]+)\)$/.exec(cor)?.[1];
      expect(rosca, cor).toMatch(new RegExp(`${nome}:`));
    }
  });

  it('o empate no valor sai na ordem do ticker (a mesma ordem em toda renderização)', () => {
    expect(alocacao([pos('SINA3', 100), pos('MOVE3', 100)]).fatias.map((f) => f.id)).toEqual([
      'MOVE3',
      'SINA3',
    ]);
  });
});
