import type { ReactNode } from 'react';
import type { ArenaCurrent } from '@alvesting/contracts';
import { formatShortDate } from '../lib/format';
import { Arte } from './arte';
import { Fita } from './fita';
import { BUTTON, NavLink } from './ui';

// O hero da landing (ADR 0035; docs/redesign-rallies/plano.md, d.2 e d.3), no desenho do Rallies com a arte de antes. Em cima, duas colunas a
// partir de 1024 px: o título e os dois CTAs à esquerda; a pílula da temporada, o parágrafo e o aviso da arena simulada à direita (no celular,
// uma coluna nessa ordem, os CTAs em largura cheia). Embaixo, a moldura grande, escura nos dois temas (`.moldura`: a arte é o azul claro da
// marca sobre o preto, e no claro sumiria no branco): a escadaria enche o palco, e no pé, por dentro, a legenda com o crédito das cotações e a
// fita. O cartão "Arena agora" segue o tema da página, então fica fora do elemento da moldura: por cima dela, à esquerda e embaixo, a partir de
// 1024 px (o lado esquerdo da arte é o vazio preto, e o touro fica à direita), e embaixo dela no celular. Componente de servidor, sem entrada
// animada: o título e o parágrafo nascem visíveis no HTML, antes da moldura (o LCP do celular, d.10). O que se mexe aqui é CSS: o toque nos
// botões e a seta que anda no hover (`.seta`, globals.css, o bloco da landing).

// a seta dos CTAs e da pílula da temporada: anda 2 px para a frente no hover (`.seta`)
const Seta = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 16 16"
    aria-hidden="true"
    focusable="false"
    className="seta"
  >
    <path
      d="M3 8h10M9 4l4 4-4 4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

export interface HeroProps {
  // a pílula da temporada ("Temporada encerrada · pregão 20 de 20"); sem temporada, nenhuma
  pill: { text: string; href: string } | null;
  // algum modelo exibido decide pelo provedor fake (ui.tsx, isSimulated): o aviso da arena simulada
  simulated: boolean;
  // a legenda do pé da moldura, com o crédito das cotações, e a fita (lib/fita.ts)
  caption: string;
  tape: { text: string; label: string };
  // o cartão "Arena agora" (por cima da moldura a partir de 1024 px)
  card?: ReactNode;
}

// A pílula da temporada, levando ao último ciclo; antes do primeiro, o dia dele, levando às regras. Sem temporada, nenhuma. O nome da temporada
// fica na arena (pode ser longo). A temporada em andamento diz a data do último pregão, e não "pregão N de M": a conta saía das datas do
// patrimônio, que a landing não lê (d.10: menos leituras que a home de antes); a encerrada fez todos os pregões dos parâmetros.
export function heroPill({
  season,
  lastCycle,
  nextCycle,
}: Pick<ArenaCurrent, 'season' | 'lastCycle' | 'nextCycle'>): HeroProps['pill'] {
  if (!season) return null;
  const total = season.params.sessions;
  if (lastCycle) {
    return {
      text:
        season.status === 'FINISHED'
          ? `Temporada encerrada · pregão ${total} de ${total}`
          : `Temporada em andamento · último pregão em ${formatShortDate(lastCycle.date)}`,
      href: `/ciclos/${lastCycle.date}`,
    };
  }
  return nextCycle
    ? {
        text: `Temporada em andamento · primeiro pregão em ${formatShortDate(nextCycle.date)}`,
        href: '/como-funciona',
      }
    : null;
}

// Os dois CTAs, no hero e no fim da landing: a pílula primária (a ação principal da superfície) leva à arena e a cinza às regras.
export const Chamadas = ({ className = '' }: { className?: string }) => (
  <div className={`flex flex-wrap gap-2 ${className}`}>
    <NavLink href="/arena" className={`${BUTTON} btn-primary`}>
      Abrir a arena
      <Seta />
    </NavLink>
    <NavLink href="/como-funciona" className={BUTTON}>
      Regras da arena
    </NavLink>
  </div>
);

export function Hero({ pill, simulated, caption, tape, card }: HeroProps) {
  return (
    <>
      <section className="grid gap-x-16 gap-y-6 pt-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)] lg:pt-20">
        <div className="grid content-start justify-items-start gap-6">
          <h1 className="max-w-[22ch] font-display text-30 text-balance">
            Modelos de linguagem investindo na B3
          </h1>
          <Chamadas className="max-sm:w-full max-sm:flex-col" />
        </div>
        <div className="grid content-start justify-items-start gap-4">
          {pill ? (
            <NavLink href={pill.href} className="pill -my-1.5">
              {pill.text}
              <Seta />
            </NavLink>
          ) : null}
          <p className="text-15 text-pretty text-muted">
            Às 08:00 de cada pregão, todos recebem o mesmo briefing e o mesmo prompt, oculto e com o
            hash publicado. As ordens fictícias executam na abertura, a preço real, com a
            justificativa aberta.
          </p>
          {/* o aviso da página (o `[!]` do sistema, na sans: a mono é só do hash), numa linha discreta, sem caixa */}
          {simulated ? (
            <p className="flex gap-2 text-xs text-muted">
              <span aria-hidden="true" className="shrink-0">
                [!]
              </span>
              <span>
                <strong>Decisões simuladas: os modelos ainda não estão conectados.</strong> Os nomes
                são os do elenco, mas quem decide por cada modelo marcado como simulado é uma
                estratégia fixa e simples. O resultado não diz nada sobre os modelos de verdade.
              </span>
            </p>
          ) : null}
        </div>
      </section>

      {/* A moldura: a partir de 1024 px o palco tem 12:5, e a arte (200 × 120 células, 5:3) enche a largura presa ao pé, sem as linhas de
          cima, que são só o preto vazio; no celular, a altura do palco de antes, com as 56 linhas de baixo (o touro e a escada). A arte nunca
          fica atrás de texto: o pé, com a legenda e a fita, vem depois do palco. A grade anda para a direita o bastante para o touro (as
          colunas 89 a 133 de 200) passar do cartão. */}
      <div className="relative mt-12 lg:mt-16">
        <div className="moldura flex flex-col overflow-hidden rounded-lg">
          <div className="relative isolate h-[min(75vw,420px)] lg:aspect-[12/5] lg:h-auto">
            <Arte nome="escadaria" className="max-lg:[--linhas:56] lg:[--deslocar:10%]" />
          </div>
          <div className="flex flex-col items-center justify-center gap-3 pt-2 pb-5 lg:h-20 lg:p-0">
            <p className="px-(--calha) text-center text-xs text-pretty text-moldura-cinza">
              {caption}
            </p>
            <Fita texto={tape.text} rotulo={tape.label} />
          </div>
        </div>
        {card ? (
          <div className="mt-4 lg:absolute lg:bottom-32 lg:left-12 lg:mt-0 lg:w-[min(520px,46%)]">
            {card}
          </div>
        ) : null}
      </div>
    </>
  );
}
