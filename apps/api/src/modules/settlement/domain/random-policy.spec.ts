import { createHash } from 'node:crypto';
import { decisionItemSchema } from '@alvesting/contracts';
import { describe, expect, it } from 'vitest';
import { SORTEIO_PORTFOLIO, draw, randomDecisions } from './random-policy.js';

// A política aleatória do Sorteio e do Monte Carlo (plano, 2): a cada pregão, de 0 a 5 ordens; cada ordem é SELL de uma
// posição sorteada (1% a 100%) ou BUY de uma ação sorteada do universo da semana (5% a 25% do patrimônio). Tudo sai
// do SHA-256 de "semente:pregão:carteira:contador", sem gerador caseiro. Os valores fixos abaixo vieram do `shasum`
// do sistema e de uma conta em python, nunca deste código.

const SEED = 'semente-teste';
const UNIVERSE = ['AAA3', 'BBB4', 'CCC3', 'DDD3', 'EEE3']; // ordem alfabética
const HELD = ['BBB4', 'CCC3'];
const policy = (date: string, portfolio = SORTEIO_PORTFOLIO, held = HELD, universe = UNIVERSE) =>
  randomDecisions({ seed: SEED, date, portfolio, held, universe }).map((item) =>
    item.action === 'BUY'
      ? ['BUY', item.ticker, item.percent_of_equity]
      : item.action === 'SELL'
        ? ['SELL', item.ticker, item.percent_of_position]
        : ['HOLD', item.ticker],
  );

describe('draw (a fonte de todo o acaso)', () => {
  it('é o SHA-256 de "semente:pregão:carteira:contador", 6 bytes lidos como inteiro', () => {
    // shasum -a 256 de "semente-teste:2026-11-03:sorteio:0" começa por 32c1beef57b5; o do contador 1, por 47841c4426b7
    expect(draw(SEED, '2026-11-03', 'sorteio', 0)).toBe(0x32c1beef57b5);
    expect(draw(SEED, '2026-11-03', 'sorteio', 1)).toBe(0x47841c4426b7);
    const byHand = createHash('sha256').update('semente-teste:2026-11-03:sorteio:2').digest('hex');
    expect(draw(SEED, '2026-11-03', 'sorteio', 2)).toBe(Number.parseInt(byHand.slice(0, 12), 16));
  });

  it('é um inteiro seguro, o mesmo para os mesmos argumentos, e muda com qualquer um deles', () => {
    const base = draw(SEED, '2026-11-03', 'sorteio', 0);
    expect(Number.isSafeInteger(base)).toBe(true);
    expect(draw(SEED, '2026-11-03', 'sorteio', 0)).toBe(base);
    expect(draw('outra', '2026-11-03', 'sorteio', 0)).not.toBe(base);
    expect(draw(SEED, '2026-11-04', 'sorteio', 0)).not.toBe(base);
    expect(draw(SEED, '2026-11-03', 'mc:0', 0)).not.toBe(base);
    expect(draw(SEED, '2026-11-03', 'sorteio', 1)).not.toBe(base);
  });
});

describe('randomDecisions', () => {
  it('sorteia as ordens como contado por fora (pregão de 1 ordem)', () => {
    // contador 0: 55807713433525 % 6 = 1 ordem; contador 1 (par = SELL, ímpar = BUY): 78632735483575 é ímpar, BUY;
    // contador 2: 5697488387600 % 5 = 0, AAA3; contador 3: 125146120664631 % 21 = 3, 5 + 3 = 8%
    expect(policy('2026-11-03')).toEqual([['BUY', 'AAA3', 8]]);
  });

  it('sorteia as ordens como contado por fora (pregão de 5 ordens, com SELL e BUY misturados)', () => {
    expect(policy('2026-11-05')).toEqual([
      ['BUY', 'AAA3', 24],
      ['SELL', 'BBB4', 11],
      ['BUY', 'CCC3', 23],
      ['BUY', 'DDD3', 12],
      ['BUY', 'EEE3', 9],
    ]);
  });

  it('um pregão pode ter 0 ordens', () => {
    expect(policy('2026-11-04')).toEqual([]);
  });

  it('SELL só de posição que a carteira tem; sem posição, nunca vende', () => {
    expect(policy('2026-11-06')).toEqual([
      ['SELL', 'CCC3', 3],
      ['BUY', 'DDD3', 11],
      ['SELL', 'BBB4', 71],
    ]);
    for (let day = 1; day <= 28; day += 1) {
      const date = `2026-11-${String(day).padStart(2, '0')}`;
      for (const item of policy(date, SORTEIO_PORTFOLIO, [])) expect(item[0]).toBe('BUY');
    }
  });

  it('é determinística: a mesma semente, o mesmo pregão e a mesma carteira dão as mesmas ordens', () => {
    const first = policy('2026-11-05');
    for (let i = 0; i < 3; i += 1) expect(policy('2026-11-05')).toEqual(first);
  });

  it('outra semente, outro pregão ou outra carteira dão outras ordens', () => {
    const base = JSON.stringify(
      Array.from({ length: 20 }, (_, i) => policy(`2026-11-${String(i + 1).padStart(2, '0')}`)),
    );
    const other = (seed: string, portfolio: string) =>
      JSON.stringify(
        Array.from({ length: 20 }, (_, i) =>
          randomDecisions({
            seed,
            date: `2026-11-${String(i + 1).padStart(2, '0')}`,
            portfolio,
            held: HELD,
            universe: UNIVERSE,
          }),
        ),
      );
    expect(other('outra-semente', SORTEIO_PORTFOLIO)).not.toEqual(base);
    expect(other(SEED, 'mc:0')).not.toEqual(base);
    expect(policy('2026-11-05')).not.toEqual(policy('2026-11-06'));
  });

  it('não depende da ordem em que as posições chegam', () => {
    expect(policy('2026-11-06', SORTEIO_PORTFOLIO, ['CCC3', 'BBB4'])).toEqual(policy('2026-11-06'));
  });

  it('respeita as regras da arena: 5 ordens no máximo, tickers distintos, faixas de percentual, schema do contrato', () => {
    const universe = Array.from({ length: 40 }, (_, i) => `U${String(i).padStart(2, '0')}A3`);
    // OUTA3 saiu do universo da semana depois de comprada: pode ser vendida, nunca comprada
    const held = [...universe.filter((_, i) => [3, 17, 39].includes(i)), 'OUTA3'];
    let soldOutsider = false;
    for (let portfolio = 0; portfolio < 120; portfolio += 1) {
      for (let day = 1; day <= 20; day += 1) {
        const items = randomDecisions({
          seed: SEED,
          date: `2026-11-${String(day).padStart(2, '0')}`,
          portfolio: `mc:${portfolio}`,
          held,
          universe,
        });
        expect(items.length).toBeLessThanOrEqual(5);
        expect(new Set(items.map((i) => i.ticker)).size).toBe(items.length);
        for (const item of items) {
          expect(decisionItemSchema.safeParse(item).success).toBe(true);
          if (item.action === 'BUY') {
            expect(universe).toContain(item.ticker);
            expect(Number.isInteger(item.percent_of_equity)).toBe(true);
          } else if (item.action === 'SELL') {
            expect(held).toContain(item.ticker);
            expect(Number.isInteger(item.percent_of_position)).toBe(true);
            if (item.ticker === 'OUTA3') soldOutsider = true;
          } else throw new Error('a política nunca sorteia HOLD');
        }
      }
    }
    expect(soldOutsider).toBe(true);
  });

  it('com universo menor que o número sorteado, para sem repetir ticker e sem erro', () => {
    for (let day = 1; day <= 28; day += 1) {
      const items = randomDecisions({
        seed: SEED,
        date: `2026-11-${String(day).padStart(2, '0')}`,
        portfolio: 'p',
        held: [],
        universe: ['AAA3', 'BBB4'],
      });
      expect(items.length).toBeLessThanOrEqual(2);
      expect(new Set(items.map((i) => i.ticker)).size).toBe(items.length);
    }
  });

  it('sem posição e sem universo, não há o que sortear', () => {
    expect(policy('2026-11-05', SORTEIO_PORTFOLIO, [], [])).toEqual([]);
  });

  it('o acaso é uniforme: de 0 a 5 ordens, SELL e BUY meio a meio, e cobre as faixas inteiras', () => {
    const counts = [0, 0, 0, 0, 0, 0];
    let sells = 0;
    let buys = 0;
    const buyPercents = new Set<number>();
    const sellPercents = new Set<number>();
    const universe = Array.from({ length: 60 }, (_, i) => `V${String(i).padStart(2, '0')}3`);
    const held = universe.slice(0, 8);
    for (let portfolio = 0; portfolio < 1000; portfolio += 1) {
      for (let day = 1; day <= 6; day += 1) {
        const items = randomDecisions({
          seed: 'uniformidade',
          date: `2026-11-${String(day).padStart(2, '0')}`,
          portfolio: `mc:${portfolio}`,
          held,
          universe,
        });
        counts[items.length] = (counts[items.length] ?? 0) + 1;
        for (const item of items) {
          if (item.action === 'SELL') {
            sells += 1;
            sellPercents.add(item.percent_of_position);
          } else if (item.action === 'BUY') {
            buys += 1;
            buyPercents.add(item.percent_of_equity);
          }
        }
      }
    }
    // 6.000 pregões: cerca de 1.000 para cada quantidade de ordens
    for (const count of counts) {
      expect(count).toBeGreaterThan(850);
      expect(count).toBeLessThan(1150);
    }
    expect(sells / (sells + buys)).toBeGreaterThan(0.45);
    expect(sells / (sells + buys)).toBeLessThan(0.55);
    expect(Math.min(...buyPercents)).toBe(5);
    expect(Math.max(...buyPercents)).toBe(25);
    expect(buyPercents.size).toBe(21);
    expect(Math.min(...sellPercents)).toBe(1);
    expect(Math.max(...sellPercents)).toBe(100);
    expect(sellPercents.size).toBe(100);
  });
});
