import type { CycleMode, Leaderboard } from '@alvesting/contracts';
import { formatShortDate } from './format';

// O trecho retroativo da temporada (ADR 0038; docs/METODOLOGIA.md, "Temporada 1"): os pregões rodados depois, com o relógio do pregão simulado,
// e não ao vivo. O site o marca onde ele aparece, do jeito discreto do "simulado" (docs/DESIGN.md; docs/TELAS.md, seção 10): a etiqueta no
// pregão, a nota uma vez na página que mostra o resultado da temporada e o fundo hachurado no gráfico do patrimônio. Só `import type` do
// contrato: o gráfico, que usa este módulo, é de cliente.

// o modo do ciclo de cada data da série do patrimônio (`modes`); nulo no pregão liquidado sem ciclo
export type Modo = CycleMode | null;
export type ContagemDosModos = Leaderboard['cyclesByMode'];

// Um trecho de pregões retroativos seguidos, pelo índice das datas (o primeiro e o último). O ao vivo e o pregão sem ciclo cortam o trecho.
export interface Trecho {
  inicio: number;
  fim: number;
}

export function trechosRetroativos(modes: readonly Modo[]): Trecho[] {
  const trechos: Trecho[] = [];
  modes.forEach((mode, i) => {
    if (mode !== 'RETROATIVO') return;
    const ultimo = trechos.at(-1);
    if (ultimo && ultimo.fim === i - 1) ultimo.fim = i;
    else trechos.push({ inicio: i, fim: i });
  });
  return trechos;
}

// Quantos pregões de cada modo, como o `cyclesByMode` do ranking: o pregão sem ciclo fica de fora das duas contas.
export const contagemDosModos = (modes: readonly Modo[]): ContagemDosModos => ({
  RETROATIVO: modes.filter((mode) => mode === 'RETROATIVO').length,
  AO_VIVO: modes.filter((mode) => mode === 'AO_VIVO').length,
});

// Quando: "de 13/10 a 13/11", "em 18/11" ou "de 13/10 a 13/11 e em 18/11" (o dia e o mês: a temporada é de um ano só).
export function periodoDosTrechos(dates: readonly string[], trechos: readonly Trecho[]): string {
  const partes = trechos.map(({ inicio, fim }) =>
    inicio === fim
      ? `em ${formatShortDate(dates[inicio]!)}`
      : `de ${formatShortDate(dates[inicio]!)} a ${formatShortDate(dates[fim]!)}`,
  );
  return partes.length > 1
    ? `${partes.slice(0, -1).join(', ')} e ${partes.at(-1)!}`
    : (partes[0] ?? '');
}

// A frase da nota (ui.tsx, NotaRetroativa): quantos dos pregões da temporada, quando (se a página sabe as datas) e o que quer dizer. Nenhum
// retroativo: nada.
export function fraseRetroativa(contagem: ContagemDosModos, periodo?: string): string | null {
  const n = contagem.RETROATIVO;
  if (n === 0) return null;
  const total = n + contagem.AO_VIVO;
  const quais =
    n === total ? (n === 1 ? 'O pregão' : `Os ${n} pregões`) : `${n} dos ${total} pregões`;
  return `${quais}${periodo ? `, ${periodo},` : ''} ${n === 1 ? 'foi rodado' : 'foram rodados'} depois, e não ao vivo.`;
}

// A frase da página que lê a série do patrimônio (a arena, o ranking, o modelo): a conta e o período saem das mesmas datas. Sem o modo (a
// api de antes do campo; ele é opcional no contrato pela ordem do deploy), nada.
export const fraseDaSerie = ({
  dates,
  modes,
}: {
  dates: readonly string[];
  modes?: readonly Modo[] | undefined;
}): string | null =>
  modes
    ? fraseRetroativa(contagemDosModos(modes), periodoDosTrechos(dates, trechosRetroativos(modes)))
    : null;

// O fundo de cada trecho no gráfico, no eixo x do desenho (`xs`, de 0 a `largura`): de meio passo antes do primeiro pregão a meio passo depois
// do último, sem passar das bordas. Com uma data só, o desenho inteiro.
export function faixasRetroativas(
  xs: readonly number[],
  trechos: readonly Trecho[],
  largura: number,
): Array<{ x: number; largura: number }> {
  const meio = xs.length > 1 ? (xs[1]! - xs[0]!) / 2 : largura;
  return trechos.map(({ inicio, fim }) => {
    const x = Math.max(0, xs[inicio]! - meio);
    return { x, largura: Math.min(largura, xs[fim]! + meio) - x };
  });
}
