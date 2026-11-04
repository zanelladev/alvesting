import { describe, expect, it } from 'vitest';
import { UNIVERSE_RULES, selectUniverse, type VolumeStat } from './universe.js';

// Um papel que negociou `presenceDays` dos 60 pregões, com volume médio de `avg` reais por dia.
const stat = (ticker: string, avgReais: number, presenceDays = 60, window = 60): VolumeStat => ({
  instrumentId: `id-${ticker}`,
  ticker,
  // soma da janela em centavos: média x pregões da janela
  totalVolumeCents: BigInt(avgReais) * 100n * BigInt(window),
  presenceDays,
});

describe('regras do universo (plano, seção 2)', () => {
  it('até 500 ações, janela de 60 pregões e presença de 90%', () => {
    expect(UNIVERSE_RULES).toEqual({ maxMembers: 500, windowDays: 60, minPresencePercent: 90 });
  });
});

describe('selectUniverse', () => {
  it('ordena por volume financeiro médio, do maior para o menor, com posição de 1 em diante', () => {
    const result = selectUniverse(
      [stat('BBB3', 2_000_000), stat('AAA3', 9_000_000), stat('CCC3', 500_000)],
      60,
    );
    expect(result.members.map((m) => [m.position, m.ticker])).toEqual([
      [1, 'AAA3'],
      [2, 'BBB3'],
      [3, 'CCC3'],
    ]);
  });

  it('o volume médio é a soma da janela dividida pelos pregões da janela, em centavos', () => {
    const [member] = selectUniverse([stat('AAA3', 1_000_000)], 60).members;
    expect(member).toMatchObject({ avgVolumeCents: 100_000_000n, presenceDays: 60 });
  });

  it('dia sem negócio conta como volume zero na média, não é ignorado', () => {
    // 54 de 60 pregões com R$ 1 milhão: média = 54/60 de 1 milhão
    const totalVolumeCents = 54n * 100_000_000n;
    const [member] = selectUniverse(
      [{ instrumentId: 'id', ticker: 'AAA3', totalVolumeCents, presenceDays: 54 }],
      60,
    ).members;
    expect(member?.avgVolumeCents).toBe(90_000_000n);
  });

  it('presença mínima de 90%: 54 de 60 passa, 53 de 60 não', () => {
    const result = selectUniverse([stat('PASS3', 1_000_000, 54), stat('FAIL3', 5_000_000, 53)], 60);
    expect(result.members.map((m) => m.ticker)).toEqual(['PASS3']);
    expect(result.candidates).toBe(2);
    expect(result.eligible).toBe(1);
  });

  it('a presença é proporcional à janela (janela de 20 pregões pede 18)', () => {
    const result = selectUniverse([stat('PASS3', 1, 18, 20), stat('FAIL3', 1, 17, 20)], 20);
    expect(result.members.map((m) => m.ticker)).toEqual(['PASS3']);
  });

  it('corta em 500 e informa quantas passaram antes do corte', () => {
    const many = Array.from({ length: 620 }, (_, i) =>
      stat(`T${String(i).padStart(3, '0')}`, 1_000 + i),
    );
    const result = selectUniverse(many, 60);
    expect(result.candidates).toBe(620);
    expect(result.eligible).toBe(620);
    expect(result.members).toHaveLength(500);
    expect(result.members[0]?.ticker).toBe('T619'); // o maior volume
    expect(result.members[499]?.position).toBe(500);
    expect(result.members.some((m) => m.ticker === 'T000')).toBe(false); // o menor ficou de fora
  });

  it('empate no volume desempata pelo ticker, para a ordem não depender da entrada', () => {
    const forward = selectUniverse(
      [stat('ZZZ3', 1_000), stat('AAA3', 1_000), stat('MMM3', 1_000)],
      60,
    );
    const reversed = selectUniverse(
      [stat('MMM3', 1_000), stat('AAA3', 1_000), stat('ZZZ3', 1_000)],
      60,
    );
    expect(forward.members.map((m) => m.ticker)).toEqual(['AAA3', 'MMM3', 'ZZZ3']);
    expect(reversed.members).toEqual(forward.members);
  });

  it('sem candidatas, universo vazio', () => {
    expect(selectUniverse([], 60)).toEqual({ candidates: 0, eligible: 0, members: [] });
  });

  it('recusa dado impossível: presença maior que a janela, janela zero, volume negativo', () => {
    expect(() => selectUniverse([stat('AAA3', 1, 61)], 60)).toThrow(/presença/);
    expect(() => selectUniverse([], 0)).toThrow(/janela/);
    expect(() =>
      selectUniverse(
        [{ instrumentId: 'i', ticker: 'A', totalVolumeCents: -1n, presenceDays: 60 }],
        60,
      ),
    ).toThrow(/volume/);
  });
});
