import type { CSSProperties } from 'react';
import escadaria from '../arte/escadaria-q0.json';
import { ArteViva } from './arte-viva';

// A arte ASCII com brasa (ADR 0034; a procedência de cada arquivo em docs/DEPENDENCIAS.md, "Artes"). A arte é arquivo, e o código só troca
// o quadro: nada de canvas nem de shader. A brasa é o sprite do quadro 0 (um PNG de uns 4 KB), que o CSS pede (`.arte` em globals.css) junto
// com o tamanho da grade: sem JavaScript no celular e sem salto de layout. Sem `preload` de alta prioridade: o Lantern do Lighthouse conta todo
// pedido de alta prioridade como bloqueante do LCP, e a home passava do teto (docs/TELAS.md, seção 5); a imagem é de baixa entropia e não vira
// candidata ao LCP quando chega. O laço (o arquivo inteiro, uns 380 KB no fio) só toca a partir de 1024 px, depois do load (arte-viva.tsx).
//
// O quadro 0 da escadaria (o hero da landing) vem no HTML, importado (entra no build, e não lido de `public/`, que no standalone muda de
// lugar). O do urso (a 404), não: o Next serializa a árvore do not-found de cada segmento no payload de toda página dele, e os 17 KB do
// quadro iam junto, duas vezes, em toda página. O documento leva só a grade e o sprite do quadro 0 (os ladrilhos, pelo CSS: o quadro de
// espera), e o texto do quadro 0 chega depois do load, do arquivo pequeno `public/ascii/arte/urso-q0.json` (arte-viva.tsx).
// ponytail: o tamanho da grade do urso está escrito aqui (o arquivo dele fica em public/); o arte.spec.tsx confere contra o arquivo.
export const GRADES = {
  escadaria: { cols: escadaria.cols, rows: escadaria.rows, quadro0: escadaria.frames[0] },
  urso: { cols: 200, rows: 85, quadro0: null },
} as const;

// `laco={false}` (T2c; docs/redesign-rallies/plano.md, f.6): só o quadro 0 do HTML, sem o ArteViva (nada do arquivo inteiro). É da tela dividida
// de entrar e criar conta, que mostra a escadaria só a partir de 1024 px, justamente onde o laço tocaria. Só serve à arte que traz o quadro 0 no
// HTML (a escadaria): o do urso chega pelo ArteViva.
export function Arte({
  nome,
  className = '',
  style,
  laco = true,
}: {
  nome: keyof typeof GRADES;
  className?: string;
  style?: CSSProperties;
  laco?: boolean;
}) {
  const grade = GRADES[nome];
  const sprite = `/ascii/arte/${nome}-q0.png`;
  return (
    <div
      aria-hidden="true"
      data-arte={nome}
      className={`arte ${className}`}
      style={
        {
          ...style,
          '--cols': grade.cols,
          '--rows': grade.rows,
          '--sprite': `url(${sprite})`,
        } as CSSProperties
      }
    >
      <div className="arte-grade">
        <div className="arte-ladrilho" />
        <pre className="arte-texto">{grade.quadro0}</pre>
      </div>
      {laco ? <ArteViva nome={nome} quadro0={grade.quadro0 === null} /> : null}
    </div>
  );
}
