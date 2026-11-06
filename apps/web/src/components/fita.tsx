import type { CSSProperties } from 'react';
import { tapeLoop } from '../lib/fita';

// A fita do pé da moldura da landing (ADR 0034): a linha de cotações rolando para a esquerda, um caractere por passo, a 8 por segundo, só com
// CSS (o `.tape` de globals.css): o trilho leva duas voltas e anda uma. A caixa é decorativa (`aria-hidden`); o mesmo dado vai uma vez para o
// leitor de tela, em `rotulo`. Sob movimento reduzido ela fica parada no começo. Mora na moldura escura nos dois temas, na tinta dela.
export function Fita({ texto, rotulo }: { texto: string; rotulo: string }) {
  const volta = tapeLoop(texto);
  return (
    <>
      <div aria-hidden="true" data-fita="" className="tape text-moldura-tinta">
        <div
          className="tape-trilho"
          style={
            {
              '--tape-passos': volta.length,
              '--tape-duracao': `${volta.length / 8}s`,
            } as CSSProperties
          }
        >
          <span>{volta}</span>
          <span>{volta}</span>
        </div>
      </div>
      <p className="sr-only">{rotulo}</p>
    </>
  );
}
