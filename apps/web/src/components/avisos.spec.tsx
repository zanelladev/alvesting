import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Avisos, PilhaDeAvisos, guardarAvisoPendente, lerAvisoPendente } from './avisos';

// Os avisos de página (o toast da beUI, docs/TELAS.md): a pilha nasce vazia no HTML do servidor, dentro do `main` e na ordem do Tab, como uma
// lista com `aria-live="polite"` (a região existe antes do primeiro aviso: o leitor de tela anuncia o que chega depois). O aviso que precisa
// sobreviver a uma recarga (o aceite dos termos recarrega a conta) passa pelo `sessionStorage`, uma vez só.
const memoria = () => {
  const dados = new Map<string, string>();
  return {
    getItem: (k: string) => dados.get(k) ?? null,
    setItem: (k: string, v: string) => void dados.set(k, v),
    removeItem: (k: string) => void dados.delete(k),
  };
};

describe('o aviso que sobrevive à recarga', () => {
  it('é lido uma vez só, e some depois de lido', () => {
    const storage = memoria();
    guardarAvisoPendente('Aceite registrado.', storage);
    expect(lerAvisoPendente(storage)).toBe('Aceite registrado.');
    expect(lerAvisoPendente(storage)).toBeNull();
  });

  it('o navegador que recusa o armazenamento (modo privado antigo, cota) não quebra a tela', () => {
    const recusa = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
      removeItem: () => undefined,
    };
    expect(() => guardarAvisoPendente('x', recusa)).not.toThrow();
    expect(lerAvisoPendente(recusa)).toBeNull();
  });
});

describe('PilhaDeAvisos', () => {
  it('nasce vazia, como uma lista com nome e aria-live polite (a região viva existe antes do aviso)', () => {
    const out = renderToStaticMarkup(
      <Avisos>
        <PilhaDeAvisos />
      </Avisos>,
    );
    expect(out).toMatch(
      /^<ol aria-live="polite" aria-atomic="false" aria-label="Avisos"[^>]*><\/ol>$/,
    );
  });
});
