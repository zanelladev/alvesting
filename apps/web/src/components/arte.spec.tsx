import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Arte, GRADES } from './arte';

// O urso da 404 (components/arte.tsx): o documento leva a grade e o sprite do quadro 0 (o quadro de espera), nunca o texto do quadro, que o
// navegador busca depois do load em public/ascii/arte/urso-q0.json. O tamanho da grade escrito no componente tem de ser o do arquivo.
const urso = JSON.parse(
  readFileSync(new URL('../../public/ascii/arte/urso-q0.json', import.meta.url), 'utf8'),
) as { cols: number; rows: number; frames: string[] };

describe('Arte do urso', () => {
  it('a grade do componente é a do arquivo do quadro 0', () => {
    expect([GRADES.urso.cols, GRADES.urso.rows]).toEqual([urso.cols, urso.rows]);
    expect(urso.frames[0]!.split('\n')).toHaveLength(urso.rows);
  });

  it('o HTML leva a grade e o sprite do quadro 0, e o texto do quadro fica de fora', () => {
    const out = renderToStaticMarkup(<Arte nome="urso" />);
    expect(out).toMatch(
      /^<div aria-hidden="true" data-arte="urso" class="arte " style="--cols:200;--rows:85;--sprite:url\(\/ascii\/arte\/urso-q0\.png\)">/,
    );
    expect(out).toContain('<pre class="arte-texto"></pre>');
    // nenhum pedaço do quadro: a linha mais cheia dele não aparece
    const fullest = urso.frames[0]!.split('\n').sort(
      (a, b) => b.trim().length - a.trim().length,
    )[0]!;
    expect(out).not.toContain(fullest.trim().slice(0, 40));
  });
});
