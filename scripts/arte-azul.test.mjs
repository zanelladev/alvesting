import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import zlib from 'node:zlib';
import {
  ARQUIVOS,
  escalaDaPrimaria,
  luminancia,
  paletaAzul,
  pedacos,
  rampa,
} from './arte-azul.mjs';

// A arte no azul da marca (scripts/arte-azul.mjs; ADR 0034, nota de 05/11/2026): a troca só pode mudar as cores da paleta. Os índices de
// cada pixel, a transparência e o cabeçalho continuam os dos arquivos da v1, e a ordem de luminância das cores também: o que era mais claro
// continua mais claro, e o fundo continua o fundo. O "antes" foi medido nos arquivos âmbar, antes da troca (abaixo).

const css = readFileSync(new URL('../apps/web/src/app/globals.css', import.meta.url), 'utf8');
const tons = rampa(escalaDaPrimaria(css));
const ler = (arquivo) =>
  readFileSync(new URL(`../apps/web/public/ascii/arte/${arquivo}`, import.meta.url));
const pedaco = (png, tipo) => pedacos(png).find((p) => p.type === tipo)?.data;
const cores = (plte) =>
  Array.from({ length: plte.length / 3 }, (_, i) => [...plte.subarray(i * 3, i * 3 + 3)]);
const alfa = (trns, i) => (trns && i < trns.length ? trns[i] : 255);

// O PNG inteiro menos os dados do PLTE (o nome dele fica, para a ordem dos pedaços contar), medido nos arquivos âmbar copiados da v1.
const RESTO_ANTES = {
  'escadaria.png': '0a942fce1457e2c428725bc4c92d310f4daff414250c9ff76ddf7ed1caffcd0c',
  'escadaria-q0.png': '47f266d9b03939d926be2d331d95b42dac610f70d1522915e671442f5761003e',
  'urso.png': '0bda64812f8bfcdad9ef8234ed3dfb99381d2f97ba8895113eec2e67262a2f5c',
  'urso-q0.png': '440904326271182c3aaa1ee4e8be6fabd26010d4c249286c4b6cbfe605176065',
};
const resto = (png) => {
  const hash = createHash('sha256').update(png.subarray(0, 8));
  for (const p of pedacos(png)) hash.update(p.type === 'PLTE' ? Buffer.from('PLTE') : p.raw);
  return hash.digest('hex');
};

// As paletas âmbar da v1 (o quadro 0 e o arquivo inteiro de cada arte têm a mesma): as 67 entradas que os pixels usam, na ordem do
// arquivo; as outras 189 são o preto transparente.
const PALETA_ANTES = {
  escadaria:
    '000000 505050 000000 646464 b5a694 7b7b7b 3f3f3f 939393 cdc5b1 aaaaaa 6e362e d6c190 d8b972 594946 463634 ecdaac 9a8e89 502b26 c59e72 7e2a1c 7a2e21 fbe3a7 58221a c6c6c6 e8ba52 a3887b 63413b bab7b1 e2bd69 fbd16f f28916 d7964e 832516 ded2b2 837671 f4ba36 efcc79 fbb415 5d1e15 e46128 d96735 a75c46 c5baa0 c3ae7f ea8e29 e5c883 8d4438 c6734f e39136 ce6f45 cbbd9b bf7858 a7331e c64823 eb5c1e b45438 bf4d2b 9b6554 a13724 ffc032 b87c62 824d44 715954 9b3c2b 906d63 ad2e18 cd441c',
  urso: '000000 000000 505050 babab8 3f3f3f a9a9a9 cbc5b8 7b7b7b 939393 646464 584946 c6c6c6 6e362e ebdaac b3a695 463734 fbe3a7 63413b ded2b2 e9ba4f d69650 f2b835 7a2e21 d7c18f c79d70 715955 a88575 7e2a1c 502c26 d7b872 85746f 832516 d76837 9a6656 a75c46 eecc7a ce6f45 fad16f e2bd69 9a8e89 f18a18 fcb414 e39136 c6734f bf7858 b45438 906d63 ea8e29 8e4437 b87c62 58231b c5baa0 e46128 cbbd9b e5c883 c3ae7f 824d44 ffc032 9b3c2b c64823 eb5c1e bf4d2b a7331e a13724 ad2e18 cd441c 5d1e15',
};
const paletaAntes = (arte) => {
  const plte = Buffer.alloc(256 * 3);
  PALETA_ANTES[arte].split(' ').forEach((hex, i) => Buffer.from(hex, 'hex').copy(plte, i * 3));
  return plte;
};

describe('a rampa da primária', () => {
  test('é a escala do globals.css: do 950 (#14144c) ao 50 (#f2f5fe), com a luminância sempre subindo', () => {
    const hex = (rgb) => Buffer.from(rgb).toString('hex');
    assert.equal(hex(tons[0].rgb), '14144c');
    assert.equal(hex(tons.at(-1).rgb), 'f2f5fe');
    for (let i = 1; i < tons.length; i += 1) assert.ok(tons[i].y > tons[i - 1].y, `tom ${i}`);
  });
});

for (const [arte, arquivo] of ARQUIVOS) {
  describe(arquivo, () => {
    const png = ler(arquivo);
    const plte = pedaco(png, 'PLTE');
    const trns = pedaco(png, 'tRNS');
    const antes = cores(paletaAntes(arte));
    const agora = cores(plte);

    test('só a paleta mudou: o cabeçalho, a transparência e os índices de cada pixel são os da v1', () => {
      assert.equal(resto(png), RESTO_ANTES[arquivo]);
      for (const p of pedacos(png)) {
        assert.equal(
          p.raw.readUInt32BE(p.raw.length - 4),
          zlib.crc32(p.raw.subarray(4, -4)),
          p.type,
        );
      }
    });

    test('a paleta é a de antes no azul da marca: cada cor visível é um tom da rampa, ou o preto', () => {
      assert.deepEqual(plte, paletaAzul(paletaAntes(arte), trns, tons));
      const naRampa = new Set(tons.map((t) => t.rgb.join()));
      agora.forEach((rgb, i) => {
        if (alfa(trns, i) === 0 || rgb.every((v) => v === 0)) return;
        assert.ok(naRampa.has(rgb.join()), `a cor ${i} (${rgb}) não é um tom da primária`);
      });
      // rodar o script de novo não muda nada
      assert.deepEqual(paletaAzul(plte, trns, tons), plte);
    });

    test('a mesma ordem de luminância: nenhum par se inverte nem empata, e o fundo continua o fundo', () => {
      const visiveis = antes.map((_, i) => i).filter((i) => alfa(trns, i) > 0);
      for (const i of visiveis) {
        for (const j of visiveis) {
          const era = Math.sign(luminancia(antes[i]) - luminancia(antes[j]));
          assert.equal(Math.sign(luminancia(agora[i]) - luminancia(agora[j])), era, `${i} e ${j}`);
        }
      }
      // o preto (o fundo e o vazio da arte) e as entradas transparentes ficam como eram
      antes.forEach((rgb, i) => {
        if (alfa(trns, i) === 0 || rgb.every((v) => v === 0))
          assert.deepEqual(agora[i], rgb, `${i}`);
      });
    });

    // A luminância mais próxima: o contraste de cada cor com o preto da moldura fica o de antes (o desempate da ordem sobe um tom ou dois).
    test('o contraste de cada cor com o preto da moldura fica a menos de 3% do de antes', () => {
      antes.forEach((rgb, i) => {
        if (alfa(trns, i) === 0) return;
        const contraste = (cor) => (luminancia(cor) + 0.05) / 0.05;
        const desvio = Math.abs(contraste(agora[i]) / contraste(rgb) - 1);
        assert.ok(desvio < 0.03, `a cor ${i}: ${(desvio * 100).toFixed(2)}%`);
      });
    });
  });
}

// O laço troca o sprite do quadro 0 pelo do arquivo inteiro no meio da animação (components/arte-viva.tsx): as cores têm de ser as mesmas.
test('o quadro 0 e o arquivo inteiro de cada arte têm a mesma paleta', () => {
  for (const arte of ['escadaria', 'urso']) {
    assert.deepEqual(pedaco(ler(`${arte}-q0.png`), 'PLTE'), pedaco(ler(`${arte}.png`), 'PLTE'));
  }
});
