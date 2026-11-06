// A arte ASCII no azul da marca (ADR 0034, nota de 05/11/2026; ADR 0037, seção 2). Troca só as cores da paleta (o pedaço PLTE) dos quatro
// sprites PNG de paleta de 8 bits da arte, a escadaria do hero e o urso da 404 (o arquivo inteiro e o quadro 0 de cada uma): os índices de
// cada pixel (o IDAT), a transparência (o tRNS) e os glifos (os .json) ficam como estão. A arte continua arquivo; o código do site só troca
// o quadro.
//
// Cada cor visível vira o tom da escala da primária (lida do globals.css, onde os tokens moram) com a luminância relativa mais próxima da
// dela: o contraste de cada célula com o preto da moldura fica o de antes, e o desenho, o mesmo. Quando duas cores de luminância diferente
// cairiam no mesmo tom de 8 bits, a mais clara sobe para o tom seguinte da rampa: a ordem de luminância nunca se inverte nem empata. O preto
// (o fundo e o vazio da arte) e as entradas transparentes ficam. Rodar de novo não muda nada (cada tom da rampa é o mais próximo de si).
//
// Uso: node scripts/arte-azul.mjs   (reescreve os quatro PNG de apps/web/public/ascii/arte; o teste é o arte-azul.test.mjs)
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const DIR = path.join(raiz, 'apps/web/public/ascii/arte');
const CSS = path.join(raiz, 'apps/web/src/app/globals.css');

// a arte de cada arquivo (o quadro 0 tem a paleta do arquivo inteiro)
export const ARQUIVOS = [
  ['escadaria', 'escadaria.png'],
  ['escadaria', 'escadaria-q0.png'],
  ['urso', 'urso.png'],
  ['urso', 'urso-q0.png'],
];

// A escala da primária do globals.css, do 50 ao 950: [L, C, h] em OKLCH.
export function escalaDaPrimaria(css) {
  const passos = [...css.matchAll(/--color-primary-(\d+): oklch\(([\d.]+) ([\d.]+) ([\d.]+)\);/g)];
  if (passos.length !== 11)
    throw new Error(`esperava os 11 tons da primária, achei ${passos.length}`);
  return passos.map((m) => [Number(m[2]), Number(m[3]), Number(m[4])]);
}

const linear = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const gama = (v) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

// a luminância relativa da WCAG de uma cor de 8 bits
export const luminancia = ([r, g, b]) =>
  0.2126 * linear(r / 255) + 0.7152 * linear(g / 255) + 0.0722 * linear(b / 255);

// OKLCH para sRGB de 8 bits (a conversão do OKLab de Björn Ottosson); a escala cabe no sRGB, e o corte nas pontas só protege o arredondamento
function rgb8(l, c, h) {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const L = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const M = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const S = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ].map((v) => Math.round(Math.min(1, Math.max(0, gama(v))) * 255));
}

// A rampa: a escala amostrada de mil em mil passos entre um tom e o seguinte (L e C em linha reta, a matiz fixa), em 8 bits, do escuro ao
// claro, só com os tons que sobem a luminância (o arredondamento repete cores vizinhas).
export function rampa(escala) {
  const tons = [];
  for (let i = (escala.length - 1) * 1000; i >= 0; i -= 1) {
    const k = Math.min(escala.length - 2, Math.floor(i / 1000));
    const f = i / 1000 - k;
    const [l0, c0, h] = escala[k];
    const [l1, c1] = escala[k + 1];
    const rgb = rgb8(l0 + (l1 - l0) * f, c0 + (c1 - c0) * f, h);
    const y = luminancia(rgb);
    if (tons.length === 0 || y > tons.at(-1).y) tons.push({ rgb, y });
  }
  return tons;
}

// A paleta nova (um Buffer do tamanho do PLTE): da cor mais escura à mais clara, cada uma no tom de luminância mais próxima, nunca abaixo
// do tom da cor anterior (o mesmo tom só para a mesma luminância).
export function paletaAzul(plte, trns, tons) {
  const nova = Buffer.from(plte);
  const cores = [];
  for (let i = 0; i < plte.length / 3; i += 1) {
    const y = luminancia([...plte.subarray(i * 3, i * 3 + 3)]);
    const transparente = trns !== undefined && i < trns.length && trns[i] === 0;
    if (!transparente && y > 0) cores.push({ i, y });
  }
  cores.sort((a, b) => a.y - b.y || a.i - b.i);
  let anterior = { k: -1, y: -1 };
  for (const { i, y } of cores) {
    let k = tons.findIndex((tom) => tom.y >= y);
    if (k === -1) k = tons.length - 1;
    else if (k > 0 && y - tons[k - 1].y <= tons[k].y - y) k -= 1;
    if (y === anterior.y) k = anterior.k;
    else k = Math.max(k, anterior.k + 1);
    if (k >= tons.length) throw new Error('a rampa acabou antes das cores');
    Buffer.from(tons[k].rgb).copy(nova, i * 3);
    anterior = { k, y };
  }
  return nova;
}

// os pedaços de um PNG: o tipo, os dados e os bytes inteiros (o tamanho, o tipo, os dados e o CRC)
export function pedacos(png) {
  const lista = [];
  for (let off = 8; off < png.length;) {
    const tamanho = png.readUInt32BE(off);
    lista.push({
      type: png.toString('latin1', off + 4, off + 8),
      data: png.subarray(off + 8, off + 8 + tamanho),
      raw: png.subarray(off, off + 12 + tamanho),
    });
    off += 12 + tamanho;
  }
  return lista;
}

// o mesmo PNG com os dados do PLTE trocados (do mesmo tamanho) e o CRC dele refeito; o resto, byte a byte
export function trocarPaleta(png, plte) {
  const saida = Buffer.from(png);
  const p = pedacos(saida).find((pedaco) => pedaco.type === 'PLTE');
  if (!p || p.data.length !== plte.length)
    throw new Error('o PLTE novo tem de ter o tamanho do antigo');
  plte.copy(p.data);
  p.raw.writeUInt32BE(zlib.crc32(p.raw.subarray(4, -4)), p.raw.length - 4);
  return saida;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const tons = rampa(escalaDaPrimaria(readFileSync(CSS, 'utf8')));
  for (const [, arquivo] of ARQUIVOS) {
    const alvo = path.join(DIR, arquivo);
    const png = readFileSync(alvo);
    const ihdr = pedacos(png).find((p) => p.type === 'IHDR').data;
    if (ihdr[8] !== 8 || ihdr[9] !== 3) throw new Error(`${arquivo}: esperava paleta de 8 bits`);
    const plte = pedacos(png).find((p) => p.type === 'PLTE').data;
    const trns = pedacos(png).find((p) => p.type === 'tRNS')?.data;
    const nova = paletaAzul(plte, trns, tons);
    writeFileSync(alvo, trocarPaleta(png, nova));
    const trocadas = Array.from({ length: plte.length / 3 }, (_, i) => i).filter(
      (i) => Buffer.compare(plte.subarray(i * 3, i * 3 + 3), nova.subarray(i * 3, i * 3 + 3)) !== 0,
    );
    console.log(`${arquivo}: ${trocadas.length} cores trocadas, ${png.length} B`);
  }
}
