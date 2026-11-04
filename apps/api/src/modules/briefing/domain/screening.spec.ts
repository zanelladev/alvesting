import { describe, expect, it } from 'vitest';
import { SCREENING, screen, type ScreenRow } from './screening.js';

// A triagem determinística (plano 10, "top 15 da triagem"): das 100 ações mais líquidas do universo, as 15 que mais se
// mexeram no último pregão. Define quais ações ganham barras de 30 pregões no briefing além das citadas nas notícias.
const row = (
  ticker: string,
  position: number,
  changeBps: number | null,
  volume = 1_000_000n,
): ScreenRow => ({
  ticker,
  position,
  changeBps,
  lastVolumeCents: volume,
});

describe('screen', () => {
  it('a regra é: pool das 100 mais líquidas, 15 maiores variações absolutas', () => {
    expect(SCREENING).toEqual({ pool: 100, size: 15 });
  });

  it('ordena pela variação absoluta, altas e baixas juntas', () => {
    const rows = [
      row('AAAA3', 1, 100),
      row('BBBB3', 2, -500),
      row('CCCC3', 3, 300),
      row('DDDD3', 4, -50),
    ];
    expect(screen(rows)).toEqual(['BBBB3', 'CCCC3', 'AAAA3', 'DDDD3']);
  });

  it('só as 100 mais líquidas entram: a posição 101 não, mesmo com a maior variação', () => {
    const rows = [row('MILLER3', 150, 9000), row('LIQUIDA3', 100, 10), row('FORA3', 101, 8000)];
    expect(screen(rows)).toEqual(['LIQUIDA3']);
  });

  it('ação sem variação (não negociou nos dois últimos pregões) não entra', () => {
    expect(screen([row('SEMDADO3', 1, null), row('COMDADO3', 2, 5)])).toEqual(['COMDADO3']);
  });

  it('empate na variação: maior volume do último pregão, depois o ticker', () => {
    const rows = [
      row('CCCC3', 1, 200, 5_000n),
      row('AAAA3', 2, 200, 9_000n),
      row('BBBB3', 3, -200, 9_000n),
      row('DDDD3', 4, 200, 5_000n),
    ];
    expect(screen(rows)).toEqual(['AAAA3', 'BBBB3', 'CCCC3', 'DDDD3']);
  });

  it('devolve no máximo 15', () => {
    const rows = Array.from({ length: 40 }, (_, i) =>
      row(`T${String(i).padStart(3, '0')}`, i + 1, i + 1),
    );
    const out = screen(rows);
    expect(out).toHaveLength(15);
    expect(out[0]).toBe('T039');
    expect(out[14]).toBe('T025');
  });

  it('não depende da ordem em que as linhas chegam', () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      row(`T${String(i).padStart(3, '0')}`, i + 1, ((i * 37) % 11) - 5),
    );
    expect(screen([...rows].reverse())).toEqual(screen(rows));
  });

  it('universo pequeno ou vazio', () => {
    expect(screen([])).toEqual([]);
    expect(screen([row('AAAA3', 1, 10)])).toEqual(['AAAA3']);
  });
});
