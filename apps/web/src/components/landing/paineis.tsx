import type { ReactNode } from 'react';
import type { FeedDecision, LastCycle, LeaderboardRow, SeasonSummary } from '@alvesting/contracts';
import { serieDe } from '../../lib/chart';
import { formatConfidence, formatDate, formatReais } from '../../lib/format';
import { Logo, NomeCurto } from '../competidor';
import { Chamadas } from '../hero';
import {
  IconeBriefing,
  IconeCadeado,
  IconeCarteira,
  IconeCheck,
  IconeGrafico,
  IconeMetodo,
  IconeMoeda,
} from '../icones';
import { LeaderboardTable } from '../tables';
import { Empty, LINK, NavLink } from '../ui';
import { GraficoMini, type SerieMini } from './grafico-mini';

// As faixas do meio da landing (ADR 0041; docs/TELAS.md, seção 10), na página regrada: os números da temporada, o método (seis cenas, uma
// por passo do pregão), a justificativa de um modelo em destaque, o placar com o gráfico, a carteira e o convite do fim, na faixa escura.
// Tudo de servidor e com o dado da api; as cenas são decorativas (o texto embaixo de cada uma diz o mesmo) e só se mexem por CSS.

const NO_RESULT =
  'Ainda não há resultado: a primeira liquidação acontece depois do primeiro pregão.';

// o vão de 48 px entre duas seções (24 no celular): uma faixa vazia, que desenha mais um fio na página
export const Vao = () => (
  <div aria-hidden="true" className="linha vao">
    <div className="coluna" />
  </div>
);

// O cabeçalho de seção: o selo e o título em dois tons à esquerda; à direita, o parágrafo e o link. `id`: o do título, para a seção dele.
export function CabSecao({
  id,
  selo,
  titulo,
  tom2,
  texto,
  link,
}: {
  id: string;
  selo: ReactNode;
  titulo: string;
  tom2: string;
  texto: ReactNode;
  link?: { label: string; href: string };
}) {
  return (
    <div className="linha">
      <div className="coluna">
        <div className="cab-secao">
          <div>
            <span className="selo">{selo}</span>
            <h2 id={id} className="text-secao font-medium">
              {titulo} <span className="tom2">{tom2}</span>
            </h2>
          </div>
          <div>
            <p className="text-[1.03125rem] leading-relaxed text-pretty text-body">{texto}</p>
            {link ? (
              <NavLink href={link.href} className={`${LINK} gap-1.5 font-medium no-underline`}>
                {link.label}
                <span aria-hidden="true" className="seta">
                  ›
                </span>
              </NavLink>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

// Os números da temporada: o capital de cada modelo, o tamanho do universo e os pregões liquidados, depois da célula em branco que abre a
// faixa (o `::before` de `.numeros`). As carteiras do sorteio saíram daqui (18/11/2026): o método as explica na cena delas. Só com
// temporada; cada número só aparece quando há dado para ele.
export function Numeros({
  season,
  universo,
  liquidados,
}: {
  season: SeasonSummary;
  universo: number;
  liquidados: number;
}) {
  // o capital em milhares de reais quando é redondo ("R$ 100 mil"), que cabe na célula; senão, inteiro
  const reais = season.params.capitalCents / 100;
  const capital =
    reais % 1000 === 0
      ? `R$ ${(reais / 1000).toLocaleString('pt-BR')} mil`
      : `R$ ${formatReais(season.params.capitalCents)}`;
  const itens = [
    [capital, 'fictícios para cada modelo no início da temporada'],
    ...(universo > 0 ? [[String(universo), 'papéis da B3, os mesmos para todos os modelos']] : []),
    [`${liquidados} de ${season.params.sessions}`, `pregões liquidados na ${season.name}`],
  ] as const;
  return (
    <div className="linha">
      <div className="coluna">
        <dl className="numeros">
          {itens.map(([numero, oQue]) => (
            <div key={oQue}>
              <dt>{oQue}</dt>
              <dd>{numero}</dd>
            </div>
          ))}
        </dl>
      </div>
    </div>
  );
}

// As ordens da decisão, como a cena as mostra: a ação, o ticker e o tamanho (a parte da posição na venda, a do patrimônio na compra) com a
// confiança; o HOLD só com o ticker
const tamanho = (item: FeedDecision['items'][number]) =>
  item.action === 'HOLD' || item.percent === null
    ? null
    : `${item.percent}% ${item.action === 'SELL' ? 'da posição' : 'do patrimônio'}${item.confidence === null ? '' : ` · confiança ${formatConfidence(item.confidence)}`}`;

const Ordem = ({ item, className }: { item: FeedDecision['items'][number]; className: string }) => (
  <div className={className}>
    <span data-action={item.action} className="badge">
      {item.action}
    </span>
    <span className="chip -my-2 min-h-11">{item.ticker}</span>
    {tamanho(item) ? <span className="ml-auto text-xs text-muted">{tamanho(item)}</span> : null}
  </div>
);

export interface MetodoProps {
  season: SeasonSummary | null;
  lastCycle: LastCycle | null;
  // a decisão mais nova do último ciclo (o feed da landing)
  decision: FeedDecision | null;
  // os modelos do elenco, para os logos da cena do prompt
  cast: readonly SerieMini['competitor'][];
  // os competidores com percentil, para a régua do Monte Carlo
  ranked: readonly Pick<LeaderboardRow, 'competitor' | 'percentileBps'>[];
  // as séries das referências (o CDI, o BOVA11 e o igual-peso), para a cena delas
  referencias: readonly SerieMini[];
  universo: number;
}

export function Metodo({
  season,
  lastCycle,
  decision,
  cast,
  ranked,
  referencias,
  universo,
}: MetodoProps) {
  const hora = season?.params.decisionTimeBrt ?? '08:00';
  const prazo = season?.params.deadlineTimeBrt ?? '09:30';
  const custo = season ? (season.params.tradeCostBps / 100).toString().replace('.', ',') : null;
  const sorteadas = (season?.params.monteCarloRuns ?? 1000).toLocaleString('pt-BR');
  const ordens = decision?.items.slice(0, 3) ?? [];
  const aExecutar = decision?.items.find((item) => item.action !== 'HOLD') ?? null;
  const modelos = cast.slice(0, 6);

  // a régua do percentil: cada competidor na posição dele, de 0 a 100; quem fica a menos de 9 pontos de outro sobe uma fila. Os logos
  // entram do maior percentil ao menor, com as quatro entradas em rodízio, como no desenho
  const filas: number[][] = [];
  const marcadores = ranked
    .filter((row) => row.percentileBps !== null)
    .map((row) => ({ row, p: row.percentileBps! / 100 }))
    .sort((a, b) => b.p - a.p)
    .map(({ row, p }) => {
      let fila = filas.findIndex((ps) => ps.every((q) => Math.abs(q - p) >= 9));
      if (fila < 0) fila = filas.push([]) - 1;
      filas[fila]!.push(p);
      return { row, p, fila };
    });

  return (
    <section aria-labelledby="metodo-titulo" className="folha">
      <CabSecao
        id="metodo-titulo"
        selo={
          <>
            <IconeMetodo />O método
          </>
        }
        titulo="Todo pregão, a mesma pergunta"
        tom2="para todos os modelos."
        texto="As mesmas notícias, o mesmo prompt e o mesmo dinheiro fictício: só a decisão muda. O Sorteio decide ao acaso com as mesmas regras, e o percentil separa a habilidade da sorte."
        link={{ label: 'Ler como funciona', href: '/como-funciona' }}
      />
      <div className="linha">
        <div className="coluna">
          <ol className="metodo">
            <li>
              <div aria-hidden="true" className="cena">
                <div className="cena-cartao top-8 left-1/2 w-[19rem] -translate-x-1/2">
                  <div className="cena-cab">
                    <span className="flex items-center gap-2">
                      <IconeBriefing size={16} />
                      Briefing{lastCycle ? ` de ${formatDate(lastCycle.date)}` : ''}
                    </span>
                    <span className="badge font-medium">{hora}</span>
                  </div>
                  <div className="cena-linha cena-entra-1">
                    <IconeBriefing />
                    Notícias do dia
                    <span className="cena-ok">
                      <IconeCheck />
                    </span>
                  </div>
                  <div className="cena-linha cena-entra-2">
                    <IconeGrafico />
                    {universo > 0 ? `Cotações dos ${universo} papéis` : 'Cotações do universo'}
                    <span className="cena-ok">
                      <IconeCheck />
                    </span>
                  </div>
                  <div className="cena-linha cena-entra-3">
                    <IconeMoeda />
                    CDI, Selic, IPCA e dólar
                    <span className="cena-ok">
                      <IconeCheck />
                    </span>
                  </div>
                  {lastCycle?.briefingSha256 ? (
                    <div className="cena-entra-4 flex flex-col gap-0.5 px-3.5 py-2.5 text-xs text-muted">
                      SHA-256 do briefing
                      <span className="hash cena-digita">
                        {lastCycle.briefingSha256.slice(0, 24)}…
                      </span>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="cena-texto">
                <h3 className="text-[1.0625rem] font-semibold">{hora} · O briefing</h3>
                <p className="text-15 leading-relaxed text-pretty text-body">
                  As mesmas notícias, cotações e o macro do dia, para todos ao mesmo tempo. O
                  briefing é guardado com o próprio SHA-256.
                </p>
              </div>
            </li>
            <li>
              <div aria-hidden="true" className="cena">
                {modelos.map((competitor, i) => {
                  const esquerda = i < 3;
                  const top = 5.75 + (i % 3) * 2.5;
                  return (
                    <span key={competitor.slug}>
                      <Logo
                        competitor={competitor}
                        className={`absolute size-8 ${esquerda ? 'left-6' : 'right-6'}`}
                        style={{ top: `${top}rem` }}
                      />
                      <span
                        data-lado={esquerda ? 'e' : 'd'}
                        className={`cena-traco ${esquerda ? 'right-[calc(50%+5.75rem)] left-[3.75rem]' : 'right-[3.75rem] left-[calc(50%+5.75rem)]'}`}
                        style={{ top: `${top + 1}rem` }}
                      />
                    </span>
                  );
                })}
                <div className="cena-cartao top-[4.75rem] left-1/2 flex w-44 -translate-x-1/2 flex-col items-center gap-2 px-3.5 py-4 text-center">
                  <span className="grid size-10 place-items-center rounded-xl bg-surface-card text-ink">
                    <IconeCadeado />
                  </span>
                  <span className="text-13 font-semibold text-ink">Prompt da arena</span>
                  <span className="text-xs text-muted">oculto até o fim da temporada</span>
                  {lastCycle?.prompt ? (
                    <span className="hash text-[0.6875rem] text-muted">
                      versão {lastCycle.prompt.version.slice(0, 8)}…
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="cena-texto">
                <h3 className="text-[1.0625rem] font-semibold">O prompt oculto</h3>
                <p className="text-15 leading-relaxed text-pretty text-body">
                  O texto é igual para todos e fica oculto durante a temporada. A versão e o SHA-256
                  saem a cada ciclo, e o texto é revelado no fim.
                </p>
              </div>
            </li>
            <li>
              <div aria-hidden="true" className="cena">
                <div className="cena-cartao top-8 right-6 left-6">
                  <div className="cena-cab">
                    {decision ? (
                      <span className="flex min-w-0 items-center gap-2">
                        <Logo competitor={decision.competitor} className="size-5" />
                        <span className="truncate">
                          <NomeCurto
                            name={decision.competitor.name}
                            type={decision.competitor.type}
                          />
                        </span>
                      </span>
                    ) : (
                      <span>Um modelo</span>
                    )}
                    <span className="cena-pensando">
                      <i />
                      <i />
                      <i />
                      decidindo
                    </span>
                  </div>
                  {ordens.length > 0 ? (
                    ordens.map((item, i) => (
                      <Ordem
                        key={item.ticker}
                        item={item}
                        className={`cena-ordem cena-entra-${i + 2}`}
                      />
                    ))
                  ) : (
                    <div className="cena-ordem cena-entra-2">
                      <span data-action="BUY" className="badge">
                        BUY
                      </span>
                      <span data-action="SELL" className="badge">
                        SELL
                      </span>
                      <span data-action="HOLD" className="badge">
                        HOLD
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <div className="cena-texto">
                <h3 className="text-[1.0625rem] font-semibold">A decisão aberta</h3>
                <p className="text-15 leading-relaxed text-pretty text-body">
                  Cada modelo responde BUY, SELL ou HOLD, com a confiança e a justificativa de cada
                  ordem, nas palavras dele.
                </p>
              </div>
            </li>
            <li>
              <div aria-hidden="true" className="cena">
                <div className="cena-cartao top-10 right-6 left-6 flex flex-col gap-4 px-4 pt-4 pb-5">
                  {aExecutar ? (
                    <Ordem item={aExecutar} className="flex items-center gap-2" />
                  ) : (
                    <span className="text-13 font-semibold text-ink">A ordem do dia</span>
                  )}
                  <div className="flex gap-2.5 text-13 font-medium text-ink">
                    {[
                      [hora, 'Decisão', true],
                      [prazo, 'Prazo', true],
                      ['', 'Abertura', false],
                    ].map(([quando, oQue, feito]) => (
                      <span key={oQue as string} className="flex flex-1 flex-col gap-1">
                        <span className="min-h-4 text-xs font-normal text-muted">{quando}</span>
                        <span className="flex items-center gap-1.5">
                          {oQue}
                          {feito ? (
                            <span className="cena-ok ml-0 size-4">
                              <IconeCheck />
                            </span>
                          ) : null}
                        </span>
                      </span>
                    ))}
                  </div>
                  <div className="cena-barra">
                    <span />
                  </div>
                  <span className="badge cena-executa self-start font-medium">
                    Executada no preço de abertura
                  </span>
                </div>
              </div>
              <div className="cena-texto">
                <h3 className="text-[1.0625rem] font-semibold">Na abertura</h3>
                <p className="text-15 leading-relaxed text-pretty text-body">
                  As ordens executam no preço oficial de abertura
                  {custo ? `, com custo de ${custo}% por operação,` : ','} e o caixa rende o CDI.
                </p>
              </div>
            </li>
            <li>
              <div aria-hidden="true" className="cena">
                <div className="cena-regua" />
                <div className="absolute bottom-[5.5rem] left-1/2 h-9 w-px bg-muted" />
                {marcadores.map(({ row, p, fila }, i) => (
                  <span
                    key={row.competitor.slug}
                    className="cena-marcador"
                    style={{
                      left: `calc(1.25rem + (100% - 2.5rem) * ${p.toFixed(1)} / 100)`,
                      bottom: `${6.5 + fila * 1.625}rem`,
                    }}
                  >
                    <Logo
                      competitor={row.competitor}
                      className={`size-5 cena-entra-${(i % 4) + 1}`}
                    />
                  </span>
                ))}
                <span className="absolute bottom-[3.75rem] left-5 text-xs text-muted">0</span>
                <span className="absolute bottom-[3.75rem] left-1/2 -translate-x-1/2 text-xs text-muted">
                  mediana
                </span>
                <span className="absolute right-5 bottom-[3.75rem] text-xs text-muted">100</span>
                <span className="absolute inset-x-5 bottom-6 text-center text-xs text-muted">
                  Percentil de cada um contra as {sorteadas} carteiras sorteadas
                </span>
              </div>
              <div className="cena-texto">
                <h3 className="text-[1.0625rem] font-semibold">Sorte ou habilidade?</h3>
                <p className="text-15 leading-relaxed text-pretty text-body">
                  {sorteadas} carteiras sorteadas com as mesmas regras formam a régua: o percentil
                  diz quantas delas cada modelo deixou para trás.
                </p>
              </div>
            </li>
            <li>
              <div aria-hidden="true" className="cena px-6 pt-9 pr-36 pb-14">
                {referencias.length > 0 ? (
                  <GraficoMini series={referencias} altura={150} rotulos desenha />
                ) : null}
                <span className="absolute bottom-5 left-6 text-xs text-muted">
                  {season?.startDate ? `Desde ${formatDate(season.startDate)}, ` : ''}
                  {season ? `R$ ${formatReais(season.params.capitalCents)}` : ''} no início
                </span>
              </div>
              <div className="cena-texto">
                <h3 className="text-[1.0625rem] font-semibold">As referências</h3>
                <p className="text-15 leading-relaxed text-pretty text-body">
                  O CDI, o BOVA11 e a carteira igual-peso do universo correm junto, como a régua do
                  mercado.
                </p>
              </div>
            </li>
          </ol>
        </div>
      </div>
    </section>
  );
}

// A justificativa de um modelo em destaque: o resumo da decisão mais nova, a primeira frase (o contexto) no apoio e o resto (a decisão) na
// tinta, e quem disse na célula ao lado, com o link para o feed. Sem decisão, nada.
export function Citacao({ decision }: { decision: FeedDecision | null }) {
  const summary = decision?.summary;
  if (!decision || !summary) return null;
  const corte = summary.search(/[.!?]\s/);
  const contexto = corte < 0 ? '' : summary.slice(0, corte + 1);
  const resto = corte < 0 ? summary : summary.slice(corte + 2);
  const primeira = decision.items.find((item) => item.action !== 'HOLD') ?? decision.items[0];
  return (
    <div className="linha">
      <div className="coluna">
        <figure className="citacao m-0">
          <blockquote>
            {contexto ? `${contexto} ` : null}
            <strong>{resto}</strong>
          </blockquote>
          <figcaption>
            <span className="flex items-center gap-3 text-base font-semibold text-ink">
              <Logo competitor={decision.competitor} className="size-12" />
              <span>
                {decision.competitor.name}
                <span className="block text-sm font-normal text-muted">
                  Decisão de {formatDate(decision.date)}
                </span>
              </span>
            </span>
            {primeira ? (
              <p className="text-sm text-muted">
                {primeira.action} {primeira.ticker}
                {tamanho(primeira) ? `, ${tamanho(primeira)}` : ''}. Cada decisão sai inteira no
                feed.
              </p>
            ) : null}
            <NavLink
              href="/arena#feed"
              className={`${LINK} gap-1.5 self-start font-medium no-underline`}
            >
              Ler o feed
              <span aria-hidden="true" className="seta">
                ›
              </span>
            </NavLink>
          </figcaption>
        </figure>
      </div>
    </div>
  );
}

// O placar: quem está ganhando, na tabela compacta do ranking (os modelos e o Sorteio), e o gráfico do patrimônio ao lado, com o logo e o
// valor no fim de cada linha e a legenda embaixo.
export function ArenaAgora({
  rows,
  series,
  season,
  lastCycle,
  liquidados,
}: {
  rows: readonly LeaderboardRow[];
  series: readonly SerieMini[];
  season: SeasonSummary | null;
  lastCycle: LastCycle | null;
  liquidados: number;
}) {
  return (
    <section aria-labelledby="arena-agora-titulo" className="folha">
      <CabSecao
        id="arena-agora-titulo"
        selo={
          <>
            {season && season.status !== 'FINISHED' ? (
              <span aria-hidden="true" className="selo-vivo" />
            ) : null}
            Arena agora
          </>
        }
        titulo="Quem está ganhando"
        tom2={
          liquidados > 0
            ? `depois de ${liquidados} ${liquidados === 1 ? 'pregão' : 'pregões'}.`
            : 'a partir do primeiro pregão.'
        }
        texto={
          season?.startDate && lastCycle
            ? `O patrimônio de cada modelo desde ${formatDate(season.startDate)}, ao lado do Sorteio. Dados até o pregão de ${formatDate(lastCycle.date)}.`
            : 'O patrimônio de cada modelo, ao lado do Sorteio e das referências, depois de cada pregão.'
        }
        link={{ label: 'Abrir a arena', href: '/arena' }}
      />
      <div className="linha">
        <div className="coluna">
          {rows.length > 0 ? (
            <div className="placar-landing">
              <div className="space-y-3 p-5 lg:p-6">
                <LeaderboardTable
                  rows={rows}
                  label="Ranking por retorno: modelos e Sorteio"
                  compact
                />
                <p className="text-xs text-muted">
                  A posição vale entre todos os competidores, referências incluídas (CDI, igual-peso
                  e BOVA11): por isso a tabela pode pular números.
                </p>
              </div>
              <div className="grafico-landing">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-[1.0625rem] font-semibold">Patrimônio</h3>
                  {season?.startDate ? (
                    <span className="text-xs text-muted">
                      R$ {formatReais(season.params.capitalCents)} em {formatDate(season.startDate)}
                    </span>
                  ) : null}
                </div>
                <GraficoMini series={series} altura={300} rotulos />
                <ul
                  aria-hidden="true"
                  className="legenda flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted"
                >
                  {series.map((s) => {
                    const { cor, traco } = serieDe(s.competitor);
                    return (
                      <li key={s.competitor.slug} className="inline-flex items-center gap-1.5">
                        <svg width="16" height="4" aria-hidden="true" className="shrink-0">
                          <path
                            d="M0 2H16"
                            strokeWidth="2"
                            strokeDasharray={traco}
                            style={{ stroke: cor }}
                          />
                        </svg>
                        <NomeCurto name={s.competitor.name} type={s.competitor.type} />
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          ) : (
            <div className="p-5 lg:p-6">
              <Empty>{NO_RESULT}</Empty>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// A carteira do usuário, numa faixa curta: o que ela é e o link para ela
export const Carteira = () => (
  <section aria-labelledby="carteira-titulo">
    <CabSecao
      id="carteira-titulo"
      selo={
        <>
          <IconeCarteira />
          Sua carteira
        </>
      }
      titulo="Anote as suas ações"
      tom2="e compare com a arena."
      texto="Lance as ações que você comprou e acompanhe o preço médio, o valor estimado e o ganho ou a perda. A Alvesting não compra nem vende nada e não fala com a sua corretora."
      link={{ label: 'Abrir a carteira', href: '/carteira' }}
    />
  </section>
);

// O convite do fim, na faixa escura (a mesma do rodapé, logo embaixo): o título em dois tons no branco e os dois botões
export const Convite = () => (
  <section aria-labelledby="cta-titulo" className="linha escura">
    <div className="coluna">
      <div className="convite">
        <h2 id="cta-titulo" className="text-secao font-medium">
          Veja a arena agora. <span className="tom2">O mesmo prompt para todos, todo pregão.</span>
        </h2>
        <Chamadas escuro className="justify-center" />
      </div>
    </div>
  </section>
);
