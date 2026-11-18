import type { InternalBar, PublicCompetitor } from '@alvesting/contracts';
import { PORTFOLIO_LIMITS } from '@alvesting/contracts/portfolio-rules';
import { variationBps } from './format';
import { contagemDosModos, periodoDosTrechos, trechosRetroativos, type Modo } from './retroativo';

// A comparação da carteira com a arena (o pedido do Artur em 17/11/2026; docs/TELAS.md, seção 9): o mesmo dinheiro, nas mesmas datas, em cada
// competidor. Cada compra com data entra, com o mesmo custo, na carteira de cada competidor antes da abertura do dia da compra (pelo fechamento
// do pregão anterior; no primeiro pregão, pelo capital inicial, que é o patrimônio de todos antes dele) e vai até o fechamento do último pregão
// liquidado. A da pessoa é o custo dela e a quantidade × o fechamento de cada ação nesse pregão. É relatório do que já aconteceu, sem
// recomendação (Resolução CVM 19/2021, art. 1º, § 2º, II). Dinheiro em centavos inteiros, a conta em BigInt (custo × patrimônio passa do
// inteiro seguro) e o percentual em pontos-base pela regra do projeto (o variationBps: o meio para longe do zero).

export interface Compra {
  ticker: string;
  quantity: number;
  costCents: number;
  boughtOn: string | null;
}

export interface Resultado {
  valorCents: number;
  resultadoCents: number;
  rendimentoBps: number;
}

export interface Comparacao {
  // o primeiro pregão da temporada e o último liquidado: o período em que uma compra entra
  inicio: string;
  ate: string;
  // as compras que entraram e o custo delas
  compras: number;
  investidoCents: number;
  // as que ficaram de fora, por motivo
  fora: { semData: number; antes: number; depois: number; semCotacao: number };
  // nulo sem compra que entre
  voce: Resultado | null;
  // do maior valor para o menor
  competidores: Array<Resultado & { competitor: PublicCompetitor }>;
  // os pregões retroativos da arena que a comparação cobre (do primeiro em que uma compra entra ao último liquidado; ADR 0038), quantos e
  // quando; nulo sem nenhum, e sem compra que entre
  retroativos: { pregoes: number; periodo: string } | null;
}

// A compra cai no período da série: do primeiro pregão ao último liquidado.
export const noPeriodo = (boughtOn: string | null, dates: readonly string[]): boolean =>
  boughtOn !== null && boughtOn >= dates[0]! && boughtOn <= dates.at(-1)!;

// O fechamento do papel no último pregão liquidado: o da última barra até ele (a ação parada fica com o dela, como nas posições). Nenhum sem
// barra, ou com a barra acima do teto de PORTFOLIO_LIMITS, que não é cotação (a regra das posições da api).
export function fechamentoAte(
  bars: readonly Pick<InternalBar, 'date' | 'closeCents'>[],
  ate: string,
): number | null {
  const bar = bars.findLast((b) => b.date <= ate);
  return bar && bar.closeCents <= PORTFOLIO_LIMITS.maxCloseCents ? bar.closeCents : null;
}

const resultado = (valor: bigint, investido: bigint): Resultado => ({
  valorCents: Number(valor),
  resultadoCents: Number(valor - investido),
  rendimentoBps: variationBps(Number(valor), Number(investido)),
});

export function compararCarteira({
  lots,
  dates,
  modes,
  capitalCents,
  series,
  closes,
}: {
  lots: readonly Compra[];
  // as datas da série do patrimônio, da mais antiga à mais nova (a última é o último pregão liquidado), e o modo do ciclo de cada uma (sem
  // ele, a api de antes do campo, a comparação não diz o trecho retroativo)
  dates: readonly string[];
  modes?: readonly Modo[] | undefined;
  capitalCents: number;
  series: readonly { competitor: PublicCompetitor; equityCents: readonly number[] }[];
  // o fechamento de cada ação no último pregão liquidado (fechamentoAte); a que falta fica de fora, "sem cotação"
  closes: ReadonlyMap<string, number>;
}): Comparacao {
  const inicio = dates[0]!;
  const ate = dates.at(-1)!;
  const fora = { semData: 0, antes: 0, depois: 0, semCotacao: 0 };
  const dentro: Array<Compra & { boughtOn: string }> = [];
  for (const lot of lots) {
    if (lot.boughtOn === null) fora.semData += 1;
    else if (lot.boughtOn < inicio) fora.antes += 1;
    else if (lot.boughtOn > ate) fora.depois += 1;
    else if (!closes.has(lot.ticker)) fora.semCotacao += 1;
    else dentro.push({ ...lot, boughtOn: lot.boughtOn });
  }
  const investido = dentro.reduce((sum, lot) => sum + BigInt(lot.costCents), 0n);
  const base = { inicio, ate, compras: dentro.length, investidoCents: Number(investido), fora };
  if (dentro.length === 0) return { ...base, voce: null, competidores: [], retroativos: null };

  const voce = dentro.reduce(
    (sum, lot) => sum + BigInt(lot.quantity) * BigInt(closes.get(lot.ticker)!),
    0n,
  );
  // o pregão de cada compra cujo fechamento é a entrada do dinheiro: o de antes do dia dela (o primeiro pregão no dia ou depois, menos um; -1
  // é o capital inicial). A compra num dia sem pregão entra pelo fechamento do pregão anterior a ele, que é o valor à mão naquele dia.
  const entrada = dentro.map((lot) => dates.findIndex((date) => date >= lot.boughtOn) - 1);
  const competidores = series
    .map((s) => {
      const fim = BigInt(s.equityCents.at(-1)!);
      const valor = dentro.reduce((sum, lot, j) => {
        const k = entrada[j]!;
        const antes = BigInt(k < 0 ? capitalCents : s.equityCents[k]!);
        // o custo × quanto o patrimônio cresceu desde a entrada, no centavo mais próximo (o meio para cima: aqui tudo é positivo). ponytail:
        // cada compra arredonda o próprio centavo, então o total erra até meio centavo por compra (R$ 1 com as 200 do teto); somar as frações
        // antes de arredondar pede um denominador comum, se um dia importar
        return sum + (2n * BigInt(lot.costCents) * fim + antes) / (2n * antes);
      }, 0n);
      return { competitor: s.competitor, ...resultado(valor, investido) };
    })
    .sort((a, b) => b.valorCents - a.valorCents);
  // o primeiro pregão que a comparação cobre é o da compra mais antiga: os retroativos dali até o último liquidado
  const desde = Math.min(...entrada) + 1;
  const cobertos = modes?.slice(desde) ?? [];
  const pregoes = contagemDosModos(cobertos).RETROATIVO;
  const retroativos =
    pregoes > 0
      ? { pregoes, periodo: periodoDosTrechos(dates.slice(desde), trechosRetroativos(cobertos)) }
      : null;
  return { ...base, voce: resultado(voce, investido), competidores, retroativos };
}
