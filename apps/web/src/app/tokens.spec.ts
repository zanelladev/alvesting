import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// O contraste do sistema visual (docs/DESIGN.md; ADR 0037), lido do próprio globals.css: os tokens moram no `@theme`, cada cor com o par
// `light-dark(claro, escuro)`, e este teste resolve os dois temas e calcula a razão da WCAG 2.2 (1.4.3 para texto, 1.4.11 para o que
// identifica um controle). O axe do e2e confere a página montada; aqui fica o par que ele não vê (o anel de foco, o fio do campo, a cor
// do botão no hover) e a regra de que as peças das bibliotecas leem a nossa paleta pelo nome que elas esperam, sem cor crua.
const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');
const theme = /@theme \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
const tokens = new Map(
  [...theme.matchAll(/--color-([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]),
);

// o código do site fora do globals.css e dos testes: as peças, as telas e os módulos CSS
const SRC = new URL('..', import.meta.url);
const SOURCES: Array<[string, string]> = (readdirSync(SRC, { recursive: true }) as string[])
  .filter((file) => /\.(tsx?|css)$/.test(file) && !/\.spec\.tsx?$/.test(file))
  .filter((file) => !file.endsWith('globals.css'))
  .map((file) => [file, readFileSync(new URL(file, SRC), 'utf8')]);

type Rgb = [number, number, number];
type Scheme = 'light' | 'dark';

// o argumento de cima de `light-dark(a, b)`: a vírgula fora dos parênteses
function split(args: string): [string, string] {
  let depth = 0;
  for (let i = 0; i < args.length; i += 1) {
    const char = args[i];
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === ',' && depth === 0) return [args.slice(0, i), args.slice(i + 1)];
  }
  throw new Error(`light-dark sem dois argumentos: ${args}`);
}

const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const gamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

// OKLCH para sRGB (as matrizes da especificação, css-color-4)
function oklch(l: number, c: number, h: number): Rgb {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const lms = [
    (l + 0.3963377774 * a + 0.2158037573 * b) ** 3,
    (l - 0.1055613458 * a - 0.0638541728 * b) ** 3,
    (l - 0.0894841775 * a - 1.291485548 * b) ** 3,
  ] as const;
  return [
    4.0767416621 * lms[0] - 3.3077115913 * lms[1] + 0.2309699292 * lms[2],
    -1.2684380046 * lms[0] + 2.6097574011 * lms[1] - 0.3413193965 * lms[2],
    -0.0041960863 * lms[0] - 0.7034186147 * lms[1] + 1.707614701 * lms[2],
  ].map(gamma) as Rgb;
}

function resolve(value: string, scheme: Scheme): Rgb {
  const text = value.trim();
  const pair = /^light-dark\(([\s\S]*)\)$/.exec(text);
  if (pair) return resolve(split(pair[1]!)[scheme === 'light' ? 0 : 1], scheme);
  const ref = /^var\(--color-([a-z0-9-]+)\)$/.exec(text);
  if (ref) {
    const target = tokens.get(ref[1]!);
    if (!target) throw new Error(`token inexistente: --color-${ref[1]}`);
    return resolve(target, scheme);
  }
  const hex = /^#([0-9a-f]{6})$/i.exec(text);
  if (hex) return [0, 2, 4].map((i) => parseInt(hex[1]!.slice(i, i + 2), 16) / 255) as Rgb;
  const lch = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(text);
  if (lch) return oklch(Number(lch[1]), Number(lch[2]), Number(lch[3]));
  throw new Error(`cor que o teste não lê: ${text}`);
}

const color = (name: string, scheme: Scheme) => {
  const value = tokens.get(name);
  if (!value) throw new Error(`token inexistente: --color-${name}`);
  return resolve(value, scheme);
};
const luminance = (rgb: Rgb) => {
  const [r, g, b] = rgb.map((c) => linear(Math.min(1, Math.max(0, c))));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const ratio = (a: Rgb, b: Rgb) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
const hex = (rgb: Rgb) =>
  `#${rgb
    .map((c) =>
      Math.round(Math.min(1, Math.max(0, c)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;

const TEXT = 4.5;
const UI = 3;
// [frente, fundo, mínimo]: o texto e o texto secundário sobre o fundo e os cartões, o texto do botão primário sobre a primária (em
// repouso e no hover), o link, e com 3:1 o anel de foco, o fio dos controles e a pílula escolhida do seletor de tema
const PAIRS: [string, string, number][] = [
  ['ink', 'canvas', TEXT],
  ['ink', 'surface-card', TEXT],
  ['ink', 'surface-strong', TEXT],
  ['body', 'canvas', TEXT],
  ['body', 'surface-card', TEXT],
  ['muted', 'canvas', TEXT],
  ['muted', 'surface-card', TEXT],
  ['muted', 'surface-strong', TEXT],
  ['primary-foreground', 'primary', TEXT],
  ['primary-foreground', 'primary-hover', TEXT],
  ['link', 'canvas', TEXT],
  ['link', 'surface-card', TEXT],
  ['data-up', 'canvas', TEXT],
  ['data-down', 'canvas', TEXT],
  ['data-up', 'surface-card', TEXT],
  ['data-down', 'surface-card', TEXT],
  ['ring', 'canvas', UI],
  ['ring', 'surface-card', UI],
  ['ring', 'surface-strong', UI],
  ['control', 'canvas', UI],
  ['control', 'surface-card', UI],
  ['primary', 'surface-strong', UI],
  ['serie-openai', 'canvas', UI],
  ['serie-anthropic', 'canvas', UI],
  ['serie-google', 'canvas', UI],
  ['serie-xai', 'canvas', UI],
  ['serie-deepseek', 'canvas', UI],
  ['serie-qwen', 'canvas', UI],
  ['serie-neutra', 'canvas', UI],
];

describe('o contraste dos tokens (WCAG 2.2 AA), nos dois temas', () => {
  for (const scheme of ['light', 'dark'] as const) {
    it.each(PAIRS)(`${scheme}: %s sobre %s, pelo menos %d:1`, (front, back, minimum) => {
      const value = ratio(color(front, scheme), color(back, scheme));
      expect(
        value,
        `${hex(color(front, scheme))} sobre ${hex(color(back, scheme))}`,
      ).toBeGreaterThanOrEqual(minimum);
    });
  }
});

describe('a primária', () => {
  it('é o azul do logo (#14144C) no claro, e a escala tem o mesmo tom, do mais claro ao mais escuro', () => {
    expect(hex(color('primary-950', 'light'))).toBe('#14144c');
    expect(hex(color('primary', 'light'))).toBe('#14144c');
    const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map(
      (step) => tokens.get(`primary-${step}`) ?? '',
    );
    const parsed = steps.map((value) => /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(value));
    expect(parsed.every(Boolean), steps.join(' | ')).toBe(true);
    const lightness = parsed.map((m) => Number(m![1]));
    expect([...lightness].sort((a, b) => b - a)).toEqual(lightness);
    expect(new Set(parsed.map((m) => m![3])).size).toBe(1);
  });

  // o azul quase preto some no fundo escuro: no escuro a primária é a variante clara do mesmo tom
  it('no escuro é uma variante clara da escala', () => {
    expect(tokens.get('primary')).toMatch(
      /^light-dark\(var\(--color-primary-950\), var\(--color-primary-[1-4]00\)\)$/,
    );
    expect(ratio(color('primary', 'dark'), color('canvas', 'dark'))).toBeGreaterThanOrEqual(TEXT);
  });
});

// As três bibliotecas (ADR 0037) leem as cores, as medidas e o movimento por nomes delas (o shadcn na beUI e na ReUI, a Arc). Cada nome do
// `:root` aponta para um token nosso, para a peça copiada herdar a paleta nos dois temas (cor crua ali seria uma segunda fonte de verdade), e
// só fica o nome que alguém lê: o `:root` vai inteiro no CSS único, que a landing baixa (o fechamento da onda tirou os que nenhuma peça lia).
// A peça nova que pedir outro nome o acrescenta, e o teste a acompanha.
describe('os nomes das bibliotecas apontam para os tokens', () => {
  const root =
    /\/\* os nomes das bibliotecas[\s\S]*?:root \{([\s\S]*?)\n {2}\}/.exec(css)?.[1] ?? '';
  const aliases = new Map(
    [...root.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]),
  );
  // o que o site lê fora do globals.css (as peças, os gráficos) e o que o próprio globals.css lê fora do `:root`
  const sources = SOURCES.map(([, text]) => text);
  const outside = css.replace(root, '');
  const read = (name: string) =>
    // `var(--x)` no CSS e no `style`, e o `-(--x)` dos utilitários do Tailwind (`px-(--calha)`)
    [...sources, outside].some((text) => new RegExp(`(var\\(|-\\()${name}[,)]`).test(text));

  it('o :root tem os nomes que as peças copiadas leem', () => {
    for (const name of ['--background', '--foreground', '--shadow-raised', '--radius-panel'])
      expect(aliases.has(name), name).toBe(true);
    for (let i = 1; i <= 7; i += 1) expect(aliases.has(`--chart-${i}`), `--chart-${i}`).toBe(true);
  });

  it.each([...aliases.keys()])('%s tem quem o leia', (name) => {
    expect(read(name), `${name} sem leitor: tire-o do :root`).toBe(true);
  });

  it.each(
    [...aliases].filter(([, value]) => !/^(\d|0 |calc|clamp)/.test(value) && !/ms$/.test(value)),
  )('%s lê um token, sem cor crua', (_name, value) => {
    expect(value).toMatch(/var\(--(color|font|ease|duration)-[a-z0-9-]+\)/);
    expect(value).not.toMatch(/#[0-9a-f]{3,8}\b|oklch\(|rgb\(/i);
  });
});

// A Regra do Token (docs/DESIGN.md): nenhuma peça pinta cor crua, que não segue o tema nem muda com a paleta; a cor vem de um token do
// `@theme`. A única cor escrita fora do globals.css é a da barra do navegador (o `theme-color`, que o layout e o script do tema escrevem em
// hexadecimal, porque a meta não lê variável do CSS): ela tem de ser o canvas dos dois temas.
describe('a Regra do Token nas peças', () => {
  it('nenhuma peça pinta cor crua (branco, preto, hexadecimal, rgb, oklch ou a cor do sistema)', () => {
    const raw =
      /\b(bg|text|border|outline|ring|fill|stroke|decoration|shadow)-(white|black)\b|-\[(color:)?(#|rgb|oklch|hsl|Canvas)/;
    const offenders = SOURCES.flatMap(([file, text]) =>
      text
        .split('\n')
        .filter((line) => raw.test(line))
        .map((line) => `${file}: ${line.trim().slice(0, 80)}`),
    );
    expect(offenders).toEqual([]);
  });

  it('a cor da barra do navegador é o canvas, no claro e no escuro', () => {
    const [claro, escuro] = split(/^light-dark\(([\s\S]*)\)$/.exec(tokens.get('canvas')!)![1]!).map(
      (value) => value.trim().toLowerCase(),
    );
    const layout = readFileSync(new URL('./layout.tsx', import.meta.url), 'utf8');
    const script = readFileSync(
      new URL('../components/beui/theme-selector.tsx', import.meta.url),
      'utf8',
    );
    expect(layout).toContain(`media: '(prefers-color-scheme: light)', color: '${claro}'`);
    expect(layout).toContain(`media: '(prefers-color-scheme: dark)', color: '${escuro}'`);
    const literals = [...script.matchAll(/'(#[0-9a-f]{6})'/gi)].map((m) => m[1]!.toLowerCase());
    expect(new Set(literals)).toEqual(new Set([claro, escuro]));
  });
});

// A Geist dos títulos só tinha a face 600, e o navegador a usava em qualquer peso pedido; a fonte do sistema respeita o peso, então o
// `font-display` traz o 600 com ele (docs/DESIGN.md, a tipografia). Sem a regra, todo título que não declara peso cai para o 400.
describe('a tipografia', () => {
  it('o font-display leva o peso 600 na camada base (um peso explícito, que é utilitário, ainda ganha)', () => {
    const base = /@layer base \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
    expect(base).toMatch(/\n {2}\.font-display \{\s*font-weight: 600;\s*\}/);
  });
});
