// A triagem determinística do briefing (plano 10; docs/DADOS.md, seção 18). Das SCREENING.pool ações mais líquidas do
// universo (posição 1 a 100 por volume financeiro médio, a ordem do universe_member), as SCREENING.size que mais se
// mexeram no último pregão, em valor absoluto, altas e baixas juntas. Elas ganham barras de 30 pregões no briefing,
// além das ações citadas nas notícias e das posições de cada modelo (etapa 6).
//
// Por que assim: o universo tem até 500 ações e o briefing não leva as barras de todas. A variação do dia aponta onde
// há notícia ou fluxo; o corte nas 100 mais líquidas evita que um papel quase parado, com um negócio de um centavo,
// ocupe a lista. É uma heurística declarada, igual para todos os modelos, e não uma recomendação.
export const SCREENING = { pool: 100, size: 15 } as const;

export interface ScreenRow {
  ticker: string;
  // 1 = maior volume médio do universo
  position: number;
  // variação do último fechamento sobre o anterior, em pontos-base; null se não negociou nos dois pregões
  changeBps: number | null;
  lastVolumeCents: bigint;
}

export function screen(rows: readonly ScreenRow[]): string[] {
  return rows
    .filter((row) => row.position <= SCREENING.pool && row.changeBps !== null)
    .sort((a, b) => {
      const byMove = Math.abs(b.changeBps!) - Math.abs(a.changeBps!);
      if (byMove !== 0) return byMove;
      if (a.lastVolumeCents !== b.lastVolumeCents)
        return a.lastVolumeCents > b.lastVolumeCents ? -1 : 1;
      return a.ticker < b.ticker ? -1 : a.ticker > b.ticker ? 1 : 0;
    })
    .slice(0, SCREENING.size)
    .map((row) => row.ticker);
}
