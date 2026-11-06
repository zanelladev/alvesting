import type { CSSProperties } from 'react';
import escadaria from '../arte/escadaria-q0.json';
import urso from '../arte/urso-q0.json';
import { ArteViva } from './arte-viva';

// A arte ASCII com brasa (ADR 0034; a procedência de cada arquivo em docs/DEPENDENCIAS.md, "Artes"). A arte é arquivo, e o código só troca
// o quadro: nada de canvas nem de shader. O servidor manda o quadro 0 inteiro no HTML, e a brasa é o sprite do quadro 0 (um PNG de uns 4 KB),
// que o CSS pede (`.arte` em globals.css) junto com o tamanho da grade: sem JavaScript no celular e sem salto de layout. Sem `preload` de
// alta prioridade: o Lantern do Lighthouse conta todo pedido de alta prioridade como bloqueante do LCP, e a home passava do teto (docs/TELAS.md,
// seção 5); a imagem é de baixa entropia e não vira candidata ao LCP quando chega. O laço (o arquivo inteiro, uns 380 KB no fio) só toca a
// partir de 1024 px, depois do load (arte-viva.tsx).
// O quadro 0 é importado (entra no build), e não lido de `public/`, que no standalone muda de lugar.
const ARTES = { escadaria, urso } as const;

export function Arte({
  nome,
  className = '',
  style,
}: {
  nome: keyof typeof ARTES;
  className?: string;
  style?: CSSProperties;
}) {
  const arte = ARTES[nome];
  const sprite = `/ascii/arte/${nome}-q0.png`;
  return (
    <div
      aria-hidden="true"
      data-arte={nome}
      className={`arte ${className}`}
      style={
        {
          ...style,
          '--cols': arte.cols,
          '--rows': arte.rows,
          '--sprite': `url(${sprite})`,
        } as CSSProperties
      }
    >
      <div className="arte-grade">
        <div className="arte-ladrilho" />
        <pre className="arte-texto">{arte.frames[0]}</pre>
      </div>
      <ArteViva nome={nome} />
    </div>
  );
}
