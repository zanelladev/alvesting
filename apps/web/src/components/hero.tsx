import type { ArenaCurrent } from '@alvesting/contracts';
import { formatShortDate } from '../lib/format';
import { Arte } from './arte';
import { Fita } from './fita';
import { BUTTON, HERO_TITLE, NavLink } from './ui';

// O hero da home (ADR 0034; docs/redesign-ascii/plano.md, seção 4): a composição da v1 com o texto da v2. O preto, a escadaria em ASCII
// âmbar sangrando à direita e embaixo, a pílula do anúncio, o título, a descrição, a pílula branca e o botão escuro, e no pé a legenda e a
// fita. Componente de servidor, sem entrada animada: o título nasce visível no HTML (o que o LCP da home pede). A seção sai da coluna do
// main por margem negativa (a mesma técnica da linha da moldura), e o texto volta para a coluna de 1200 com a calha.

const Seta = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
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
  // a pílula do anúncio ("Temporada em andamento · pregão 4 de 20"); sem temporada, nenhuma
  pill: { text: string; href: string } | null;
  // o último ciclo: "Ver decisões" leva a ele; sem ciclo, o botão some e "Regras da arena" vira a pílula branca
  lastCycleDate: string | null;
  // algum modelo exibido decide pelo provedor fake (ui.tsx, isSimulated): o aviso da arena simulada
  simulated: boolean;
  // a legenda do pé, com o crédito das cotações, e a fita (lib/fita.ts)
  caption: string;
  tape: { text: string; label: string };
}

// A pílula do anúncio: a temporada e o pregão em que ela está (de `params.sessions`), levando ao último ciclo; antes do primeiro, o dia dele,
// levando às regras. Sem temporada, nenhuma. O nome da temporada fica na seção "Temporada" (pode ser longo). O pregão é o do último ciclo:
// os liquidados (`settled`, as datas do patrimônio) e mais ele mesmo enquanto não é liquidado (o ciclo nasce às 08:00 e a liquidação sai à
// noite; sem isto o primeiro dia diria "pregão 0").
export function heroPill(
  { season, lastCycle, nextCycle }: Pick<ArenaCurrent, 'season' | 'lastCycle' | 'nextCycle'>,
  settled: number,
): HeroProps['pill'] {
  if (!season) return null;
  const total = season.params.sessions;
  if (lastCycle) {
    const session = settled + (season.settledThrough === lastCycle.date ? 0 : 1);
    return {
      text:
        season.status === 'FINISHED'
          ? `Temporada encerrada · pregão ${total} de ${total}`
          : `Temporada em andamento · pregão ${session} de ${total}`,
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

export function Hero({ pill, lastCycleDate, simulated, caption, tape }: HeroProps) {
  return (
    <section className="relative isolate -mt-6 ml-[calc(50%-50vw)] flex min-h-[max(656px,calc(100svh-4rem))] w-screen flex-col overflow-hidden">
      <div className="mx-auto w-full max-w-[1200px] px-(--calha) pt-24 max-[560px]:pt-16">
        <div className="grid max-w-[860px] justify-items-start gap-5">
          {pill ? (
            <NavLink href={pill.href} className="pill -my-1.5">
              {pill.text}
              <Seta />
            </NavLink>
          ) : null}
          <h1 className={HERO_TITLE}>Modelos de linguagem investindo na B3</h1>
          <p className="max-w-[560px] text-lead text-pretty max-[560px]:text-base">
            Às 08:00 de cada pregão, todos recebem o mesmo briefing e o mesmo prompt, oculto e com o
            hash publicado. As ordens fictícias executam na abertura, a preço real, com a
            justificativa aberta.
          </p>
          {simulated ? (
            <p className="flex max-w-[560px] gap-2 text-label text-muted">
              <span aria-hidden="true" className="font-mono">
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
      </div>
      {/* A arte nunca fica atrás de texto. A partir de 1024 px ela é o fundo do hero inteiro, sangrando à direita e embaixo, e termina
          acima da fita (o pé mora no preto); a grade anda para a direita o bastante para o touro (as colunas 89 a 133 de 200) começar
          depois da coluna de texto (560 px e a calha), em qualquer largura. Abaixo de 1024 px o texto é alto demais para ela: a arte vai
          para o palco sob os botões (este bloco), e só as 56 linhas de baixo da grade aparecem (o touro e a escada). */}
      <div className="max-lg:relative max-lg:isolate">
        <Arte
          nome="escadaria"
          className="-z-10 max-lg:top-auto max-lg:h-[min(75vw,420px)] max-lg:[--linhas:56] lg:bottom-22 lg:[--deslocar:max(5.5vw_+_8px,608px_-_44.5vw)]"
        />
        <div className="mx-auto flex w-full max-w-[1200px] flex-wrap gap-3 px-(--calha) pt-8 max-[560px]:*:flex-1">
          {lastCycleDate ? (
            <NavLink href={`/ciclos/${lastCycleDate}`} className={`${BUTTON} btn-primary`}>
              Ver decisões
              <Seta />
            </NavLink>
          ) : null}
          <NavLink
            href="/como-funciona"
            className={lastCycleDate ? BUTTON : `${BUTTON} btn-primary`}
          >
            Regras da arena
          </NavLink>
        </div>
        <div className="h-[min(75vw,420px)] lg:hidden" />
      </div>
      <div className="mt-auto flex flex-col items-center gap-3 pt-6 pb-6 lg:pt-12">
        <p className="px-(--calha) text-center text-label text-pretty text-muted">{caption}</p>
        <Fita texto={tape.text} rotulo={tape.label} />
      </div>
    </section>
  );
}
