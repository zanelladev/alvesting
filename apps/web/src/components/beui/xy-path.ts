// Copiado da beUI (https://beui.dev/charts/line-chart), arquivo `components/charts/xy/path.ts` do item "line-chart" (registro
// https://beui.dev/r/line-chart, lido em 05/11/2026; o mesmo arquivo vem na "sparkline"). Copyright (c) 2026 Saurabh Chauhan, licença MIT (o
// texto inteiro em components/beui/LICENSE).
// O que mudou (ADR 0037): os comentários (em português), o `areaPath`, que saiu (as nossas linhas não têm área), e as curvas `linear` e
// `step`, que nenhum gráfico usava (o fechamento da onda, 05/11/2026): fica a monótona. Função pura, sem React: serve ao gráfico de linhas
// (components/beui/line-chart.tsx, no cliente) e à sparkline (components/beui/sparkline.tsx, no servidor).
export type XYPathPoint = { x: number; y: number } | null;

const f = (value: number) => Math.round(value * 100) / 100;

/** Os trechos contínuos. Um buraco no dado é um buraco na linha, nunca uma interpolação. */
function runs(points: readonly XYPathPoint[]) {
  const out: { x: number; y: number }[][] = [];
  let run: { x: number; y: number }[] = [];
  for (const point of points) {
    if (point) run.push(point);
    else if (run.length) {
      out.push(run);
      run = [];
    }
  }
  if (run.length) out.push(run);
  return out;
}

// A cúbica monótona (Fritsch–Carlson): suave, mas nunca passa de um pico nem desce abaixo de um vale que o dado não tem.
function tangents(run: { x: number; y: number }[]) {
  const n = run.length;
  const t = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const h0 = run[i]!.x - run[i - 1]!.x;
    const h1 = run[i + 1]!.x - run[i]!.x;
    const s0 = h0 ? (run[i]!.y - run[i - 1]!.y) / h0 : 0;
    const s1 = h1 ? (run[i + 1]!.y - run[i]!.y) / h1 : 0;
    const p = h0 + h1 ? (s0 * h1 + s1 * h0) / (h0 + h1) : 0;
    t[i] =
      (Math.sign(s0) + Math.sign(s1)) * Math.min(Math.abs(s0), Math.abs(s1), 0.5 * Math.abs(p));
  }
  const end = (a: number, b: number, neighbour: number) => {
    const h = run[b]!.x - run[a]!.x;
    return h ? (3 * (run[b]!.y - run[a]!.y)) / h / 2 - neighbour / 2 : neighbour;
  };
  t[0] = end(0, 1, t[1]!);
  t[n - 1] = end(n - 2, n - 1, t[n - 2]!);
  return t;
}

function segment(run: { x: number; y: number }[]) {
  const [first, ...rest] = run;
  let d = `M${f(first!.x)},${f(first!.y)}`;
  // um ponto sozinho vira um ponto, pela ponta redonda da linha; dois, uma reta
  if (!rest.length) return `${d}h0`;
  if (run.length === 2) return `${d}L${f(rest[0]!.x)},${f(rest[0]!.y)}`;
  const t = tangents(run);
  for (let i = 1; i < run.length; i++) {
    const a = run[i - 1]!;
    const b = run[i]!;
    const dx = (b.x - a.x) / 3;
    d += `C${f(a.x + dx)},${f(a.y + dx * t[i - 1]!)},${f(b.x - dx)},${f(b.y - dx * t[i]!)},${f(b.x)},${f(b.y)}`;
  }
  return d;
}

export function linePath(points: readonly XYPathPoint[]) {
  return runs(points).map(segment).join('');
}
