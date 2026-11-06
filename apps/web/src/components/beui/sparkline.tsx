// Adaptado da Sparkline da beUI (https://beui.dev/charts/sparkline; registro https://beui.dev/r/sparkline, lido em 05/11/2026). Copyright
// (c) 2026 Saurabh Chauhan, licença MIT (o texto inteiro em components/beui/LICENSE).
// O que veio de lá: a linha justa no dado (sem o zero e sem arredondar a escala, para não achatar uma série longe do zero), a curva monótona
// (components/beui/xy-path.ts), o ponto no último valor, o buraco no dado que falta e, por padrão, uma imagem com o resumo no nome (do primeiro
// ao último valor e a variação), sem parada de Tab dentro de uma tabela.
// O que mudou (ADR 0037): é um componente de servidor, sem 'use client', sem Motion e sem medir a caixa (a largura é fixa, 64 px por padrão):
// a tabela que a usa continua sem JavaScript, e a landing pode usá-la sem carregar nada. Saíram o modo de leitura (`interactive`), o selo da
// variação (`showDelta`; o retorno já está na mesma linha da tabela), a área e o `cn`. O valor é dinheiro em centavos (o lib/format.ts, sem
// float), e o resumo, em português; a cor é a da série, por `var()`.
import { formatBRL, formatBps, variationBps } from '../../lib/format';
import { linePath } from './xy-path';

const PAD = 3;

export function Sparkline({
  data,
  label,
  cor = 'currentColor',
  width = 64,
  height = 24,
  strokeWidth = 1.5,
}: {
  // os valores em centavos, na ordem; o nulo é o dado que falta
  data: readonly (number | null)[];
  // o nome, que o resumo completa ("Patrimônio de Modelo A: de R$ ... a R$ ... (+1,00%)")
  label: string;
  // a cor da linha (`var(--chart-*)`, que segue o tema)
  cor?: string;
  width?: number;
  height?: number;
  strokeWidth?: number;
}) {
  const present = data.filter((value): value is number => value !== null);
  const lo = present.length ? Math.min(...present) : 0;
  const hi = present.length ? Math.max(...present) : 1;
  const n = data.length;
  const x = (i: number) =>
    PAD + (n === 1 ? (width - PAD * 2) / 2 : (i / (n - 1)) * (width - PAD * 2));
  const y = (value: number) =>
    hi === lo ? height / 2 : PAD + ((hi - value) / (hi - lo)) * (height - PAD * 2);
  const points = data.map((value, i) => (value === null ? null : { x: x(i), y: y(value) }));
  const first = present[0];
  const last = present.at(-1);
  const end = points.findLast((point) => point !== null);
  const summary =
    first === undefined || last === undefined
      ? `${label}: sem dado`
      : `${label}: de ${formatBRL(first)} a ${formatBRL(last)}${first > 0 ? ` (${formatBps(variationBps(last, first))})` : ''}`;

  return (
    <svg
      role="img"
      aria-label={summary}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="shrink-0 overflow-visible"
      style={{ color: cor }}
    >
      {end ? (
        <>
          <path
            d={linePath(points)}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx={end.x} cy={end.y} r={2} fill="currentColor" />
        </>
      ) : null}
    </svg>
  );
}
