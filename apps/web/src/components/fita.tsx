import type { CSSProperties } from 'react';
import { tapeLoop } from '../lib/fita';

// A fita do pé da moldura da landing (ADR 0034, nota de 05/11/2026): a linha de cotações rolando para a esquerda sem parar, só com CSS (o
// `.tape` de globals.css): o trilho leva duas voltas e anda uma, em linha reta, a uns 8 caracteres por segundo (a volta dura um oitavo de
// segundo por caractere). Na sans com algarismos tabulares, como o resto da landing: a sans não tem célula fixa, então ela rola contínua, e
// não um caractere por passo, como na mono de antes. A caixa é decorativa (`aria-hidden`); o mesmo dado vai uma vez para o leitor de tela,
// em `rotulo`. Sob movimento reduzido ela fica parada no começo. Mora na moldura escura nos dois temas, na tinta dela.
export function Fita({ texto, rotulo }: { texto: string; rotulo: string }) {
  const volta = tapeLoop(texto);
  return (
    <>
      <div aria-hidden="true" data-fita="" className="tape text-moldura-tinta">
        <div
          className="tape-trilho"
          style={{ '--tape-duracao': `${volta.length / 8}s` } as CSSProperties}
        >
          <span>{volta}</span>
          <span>{volta}</span>
        </div>
      </div>
      <p className="sr-only">{rotulo}</p>
    </>
  );
}
