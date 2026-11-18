import type { ReactNode } from 'react';
import type { ArenaCurrent, LeaderboardRow } from '@alvesting/contracts';
import { formatBps, formatPercentile, formatShortDate } from '../lib/format';
import { Arte } from './arte';
import { Logo, NomeCurto } from './competidor';
import { Fita } from './fita';
import {
  IconeArena,
  IconeBriefing,
  IconeCadeado,
  IconeCarteira,
  IconeChat,
  IconeExplorar,
  Marca,
} from './icones';
import { GraficoMini, type SerieMini } from './landing/grafico-mini';
import { BUTTON, NavLink, direction } from './ui';

// O topo da landing (ADR 0041), na página regrada: o texto à esquerda (o selo da temporada, o título em dois tons, o parágrafo com os ícones
// dentro do texto, os dois botões e o aviso da arena simulada) e, a partir de 1024 px, a janela da arena em miniatura saindo pela borda
// direita da coluna (no celular, embaixo do texto). Componente de servidor, sem entrada animada no texto: o título e o parágrafo nascem
// parados e à vista no HTML (o LCP do celular, d.10); a janela sobe 12 px ao abrir (só o `transform`, globals.css, `.janela-quadro`). Embaixo,
// numa faixa própria, a escadaria (`Escadaria`), na moldura escura nos dois temas, com a legenda e a fita no pé.

// a seta dos botões e do selo: anda 2 px para a frente no hover (`.seta`)
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
  // o selo da temporada ("Temporada em andamento · último pregão em 05/11"); sem temporada, nenhum
  pill: { text: string; href: string; vivo: boolean } | null;
  // algum modelo exibido decide pelo provedor fake (ui.tsx, isSimulated): o aviso da arena simulada
  simulated: boolean;
  // a janela da arena em miniatura (`JanelaArena`), decorativa
  janela?: ReactNode;
}

// O selo da temporada, levando ao último ciclo; antes do primeiro, o dia dele, levando às regras. Sem temporada, nenhum. O nome da temporada
// fica na arena (pode ser longo). A temporada em andamento diz a data do último pregão, e não "pregão N de M" (a conta é dos números,
// abaixo do topo); a encerrada fez todos os pregões dos parâmetros. `vivo`: a temporada está em andamento (o ponto que pulsa).
export function heroPill({
  season,
  lastCycle,
  nextCycle,
}: Pick<ArenaCurrent, 'season' | 'lastCycle' | 'nextCycle'>): HeroProps['pill'] {
  if (!season) return null;
  const total = season.params.sessions;
  const vivo = season.status !== 'FINISHED';
  if (lastCycle) {
    return {
      text: vivo
        ? `Temporada em andamento · último pregão em ${formatShortDate(lastCycle.date)}`
        : `Temporada encerrada · pregão ${total} de ${total}`,
      href: `/ciclos/${lastCycle.date}`,
      vivo,
    };
  }
  return nextCycle
    ? {
        text: `Temporada em andamento · primeiro pregão em ${formatShortDate(nextCycle.date)}`,
        href: '/como-funciona',
        vivo,
      }
    : null;
}

// Os dois botões, no topo e no convite do fim: o primário (a ação principal da superfície) leva à arena e o de contorno às regras.
// `escuro`: na faixa escura do convite, o primário claro e o de contorno no branco.
export const Chamadas = ({
  className = '',
  escuro = false,
}: {
  className?: string;
  escuro?: boolean;
}) => (
  <div className={`flex flex-wrap gap-2.5 ${className}`}>
    <NavLink href="/arena" className={`${BUTTON} ${escuro ? 'btn-claro' : 'btn-primary'}`}>
      Abrir a arena
      <Seta />
    </NavLink>
    <NavLink href="/como-funciona" className={escuro ? `${BUTTON} btn-vazado` : BUTTON}>
      Regras da arena
    </NavLink>
  </div>
);

export function Hero({ pill, simulated, janela }: HeroProps) {
  return (
    <section aria-labelledby="topo-titulo" className="linha">
      <div className="coluna">
        <div className="topo-landing">
          <div className="topo-texto">
            {pill ? (
              <NavLink href={pill.href} className="pill -my-1.5">
                {pill.vivo ? <span aria-hidden="true" className="selo-vivo" /> : null}
                {pill.text}
                <Seta />
              </NavLink>
            ) : null}
            <h1 id="topo-titulo" className="max-w-[16ch] text-titulo font-medium">
              Modelos de linguagem <span className="tom2">investindo na B3</span>
            </h1>
            <p className="max-w-[34rem] text-lg/[1.7] text-pretty text-body">
              Às 08:00 de cada pregão, todos recebem o mesmo
              <span aria-hidden="true" className="ico">
                <IconeBriefing />
              </span>
              briefing e o mesmo
              <span aria-hidden="true" className="ico">
                <IconeCadeado />
              </span>
              prompt, oculto e com o hash publicado. As ordens fictícias executam na abertura, a
              preço real, com a justificativa aberta.
            </p>
            <Chamadas className="max-sm:w-full max-sm:flex-col" />
            {/* o aviso da página (o `[!]` do sistema), numa linha discreta, sem caixa */}
            {simulated ? (
              <p className="flex gap-2 text-xs text-muted">
                <span aria-hidden="true" className="shrink-0">
                  [!]
                </span>
                <span>
                  <strong>Decisões simuladas: os modelos ainda não estão conectados.</strong> Os
                  nomes são os do elenco, mas quem decide por cada modelo marcado como simulado é
                  uma estratégia fixa e simples. O resultado não diz nada sobre os modelos de
                  verdade.
                </span>
              </p>
            ) : null}
          </div>
          {janela ? (
            <>
              {janela}
              <div className="esmaece-baixo" />
              <div className="esmaece-direita" />
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}

// A janela da arena em miniatura (o topo da landing): a lateral do app, o placar dos quatro primeiros e o gráfico do patrimônio, com o dado de
// verdade do último pregão liquidado. Decorativa (`aria-hidden`, nenhum link dentro): o mesmo dado está em texto mais abaixo, no placar.
export function JanelaArena({
  rows,
  series,
  date,
}: {
  rows: readonly Pick<LeaderboardRow, 'competitor' | 'returnBps' | 'percentileBps'>[];
  series: readonly SerieMini[];
  date: string | null;
}) {
  return (
    <div aria-hidden="true" className="janela-quadro">
      <div className="janela">
        <div className="janela-barra">
          <i />
          <i />
          <i />
          <span className="janela-endereco">
            <IconeCadeado size={13} />
            alvesting · arena
          </span>
        </div>
        <div className="janela-corpo">
          <div className="janela-lado">
            <span className="mb-2.5 inline-flex items-center gap-2 px-1.5 font-marca text-sm font-semibold text-ink">
              <Marca size={16} />
              Alvesting
            </span>
            <span data-atual="" className="janela-item">
              <IconeArena size={15} />
              Arena
            </span>
            <span className="janela-item">
              <IconeExplorar size={15} />
              Explorar
            </span>
            <span className="janela-item">
              <IconeCarteira size={15} />
              Carteira
            </span>
            <span className="janela-item">
              <IconeChat size={15} />
              Chat
            </span>
          </div>
          <div className="janela-conteudo">
            <div className="flex items-center gap-2.5">
              <span className="text-xl font-semibold tracking-[-0.02em] text-ink">Arena</span>
              {date ? (
                <span className="ml-auto text-xs text-muted">
                  pregão de {formatShortDate(date)}
                </span>
              ) : null}
            </div>
            <div className="janela-placar">
              {rows.slice(0, 4).map((row, i) => (
                <div key={row.competitor.slug}>
                  <span className="text-[0.6875rem] text-muted">{i + 1}º</span>
                  <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium whitespace-nowrap text-ink">
                    <Logo competitor={row.competitor} className="size-4" />
                    <span className="min-w-0 truncate">
                      <NomeCurto name={row.competitor.name} type={row.competitor.type} />
                    </span>
                  </span>
                  <span
                    data-dir={direction(row.returnBps)}
                    className="text-lg leading-tight font-semibold tracking-[-0.02em] whitespace-nowrap text-ink"
                  >
                    {formatBps(row.returnBps)}
                  </span>
                  <span className="text-[0.6875rem] text-muted">
                    percentil{' '}
                    {row.percentileBps === null ? '—' : formatPercentile(row.percentileBps)}
                  </span>
                </div>
              ))}
            </div>
            {series.length > 0 ? (
              <div className="janela-grafico">
                <span className="text-xs text-muted">Patrimônio, em R$</span>
                <GraficoMini series={series} altura={200} />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export interface EscadariaProps {
  // a legenda do pé da moldura, com o crédito das cotações, e a fita (lib/fita.ts)
  caption: string;
  tape: { text: string; label: string };
}

// A escadaria, numa faixa própria: a moldura escura nos dois temas (`.moldura`: a arte é o azul claro da marca sobre o preto, e no claro
// sumiria no branco), a arte enchendo o palco (no celular, as 56 linhas de baixo: o touro e a escada) e, no pé, por dentro, a legenda com o
// crédito das cotações e a fita. A arte nunca fica atrás de texto que precise ser lido: o pé fica embaixo do touro, sobre o preto.
export function Escadaria({ caption, tape }: EscadariaProps) {
  return (
    <div className="linha">
      <div className="coluna">
        <div className="moldura moldura-faixa">
          <div className="moldura-palco">
            <Arte nome="escadaria" className="max-lg:[--linhas:56] lg:[--deslocar:10%]" />
          </div>
          <div className="moldura-pe">
            <p className="px-(--calha) text-center text-xs text-pretty text-moldura-cinza">
              {caption}
            </p>
            <Fita texto={tape.text} rotulo={tape.label} />
          </div>
        </div>
      </div>
    </div>
  );
}
