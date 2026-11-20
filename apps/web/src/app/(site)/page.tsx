import { Escadaria, Hero, JanelaArena, heroPill } from '../../components/hero';
import { Faq } from '../../components/landing/faq';
import type { SerieMini } from '../../components/landing/grafico-mini';
import { Laboratorios } from '../../components/landing/laboratorios';
import {
  ArenaAgora,
  Carteira,
  Citacao,
  Convite,
  Metodo,
  Numeros,
  Vao,
} from '../../components/landing/paineis';
import { isSimulated } from '../../components/ui';
import { api } from '../../lib/api';
import { heroTape } from '../../lib/fita';
import { REFERENCE_TICKER, readBars, readTape } from '../../lib/quotes';
import { withApiDown } from '../../lib/with-api-down';

// A landing (ADR 0041), na página regrada: o topo (o título, os botões e a janela da arena em miniatura), os números da temporada, a
// escadaria com a fita, o método em seis cenas, a justificativa de um modelo, o placar com o gráfico, o elenco, a carteira, o FAQ e o convite
// na faixa escura; o rodapé é da casca do site (components/site-chrome.tsx). O conteúdo inteiro da arena (o gráfico que se lê pelo teclado,
// o feed, os ciclos, a temporada e a faixa de cotações) mora na /arena.
// As leituras (d.10, o LCP do celular: o TTFB entra nele): a temporada atual, as últimas decisões, as barras do BOVA11 e a fita saem juntas;
// o ranking, o patrimônio e as carteiras sorteadas (o Monte Carlo, uma tabela pronta: a régua e a faixa das referências, no método), depois,
// juntos e só com ciclo (sem ciclo não há liquidação), numa ida só à api. Tudo pelo cache de dados do site
// (src/lib/api.ts); a página é dinâmica, porque o `next build` da imagem não tem api para chamar. O BOVA11 não vem da API pública (ela não
// entrega cotação bruta): sai da rota interna, com o segredo do servidor (src/lib/quotes.ts; docs/API.md, seção 6), e é o portão do segredo
// das cotações (sem ele, a tela de erro); a fita também, da rota interna do universo da semana.
export const dynamic = 'force-dynamic';

// as decisões do último ciclo, uma por modelo: a mais nova vai no painel da justificativa, e o elenco dá os nomes da faixa dos laboratórios
// antes da primeira liquidação (depois, o ranking também os dá)
const FEED_LIMIT = 6;

export default withApiDown(async function Landing() {
  // A fita é enfeite: a falha só da rota dela (um 5xx, o prazo, o banco sem o GRANT do universo) cai na fita do BOVA11 e do macro e vai para o
  // log, sem derrubar a landing.
  const [current, feed, bars, universe] = await Promise.all([
    api.arenaCurrent(),
    api.decisions({ limit: FEED_LIMIT }),
    readBars(REFERENCE_TICKER),
    readTape().catch((error: unknown) => {
      console.error('[web] landing sem a fita:', error);
      return { date: null, rows: [] };
    }),
  ]);
  const { season, lastCycle, macro } = current;
  const [board, equity, baseline] =
    season && lastCycle
      ? await Promise.all([
          api.leaderboard(season.slug),
          api.equity(season.slug),
          api.randomBaseline(season.slug),
        ])
      : [null, null, null];

  const ranked = (board?.rows ?? []).filter(
    (row) => row.competitor.type === 'MODEL' || row.competitor.type === 'RANDOM',
  );
  // A arena simulada (ui.tsx, SimulatedTag): algum modelo da temporada exibida decide pelo provedor fake. O elenco vem do ranking (a temporada
  // inteira, depois da primeira liquidação) e das decisões (as do último ciclo, antes dela).
  const cast = [...(board?.rows ?? []), ...feed.rows].map((row) => row.competitor);
  const simulated = cast.some(isSimulated);
  const modelos = [
    ...new Map(cast.filter((c) => c.type === 'MODEL').map((c) => [c.slug, c])).values(),
  ];

  // as séries do patrimônio: a dos modelos e do Sorteio (o placar e a janela do topo) e a das referências (a cena delas)
  const serie = (types: readonly string[]): SerieMini[] =>
    (equity?.series ?? [])
      .filter((s) => types.includes(s.competitor.type))
      .map((s) => ({ competitor: s.competitor, cents: s.equityCents }));
  const competidores = serie(['MODEL', 'RANDOM']);
  const referencias = serie(['CDI', 'BOVA11', 'EQUAL_WEIGHT']);
  const liquidados = equity?.dates.length ?? 0;
  // as carteiras sorteadas por pregão: na régua, as do pregão do ranking; atrás das referências, a faixa p5 a p95 de cada pregão do
  // patrimônio (sem um deles, a faixa fica de fora)
  const sorteadas = new Map((baseline?.rows ?? []).map((row) => [row.date, row]));
  const dias = (equity?.dates ?? []).map((date) => sorteadas.get(date));
  const faixa =
    dias.length > 0 && dias.every((row) => row !== undefined)
      ? {
          p5: dias.map((row) => row.equityCents.p5),
          p95: dias.map((row) => row.equityCents.p95),
        }
      : null;

  // o último fechamento do BOVA11 e o anterior (a rota interna dá as barras da mais antiga à mais nova)
  const latest = bars.at(-1);
  const bova11 = latest
    ? {
        date: latest.date,
        closeCents: latest.closeCents,
        previousCloseCents: bars.at(-2)?.closeCents ?? null,
      }
    : null;
  const tape = heroTape(universe, bova11, macro);
  const decision = feed.rows[0] ?? null;

  return (
    <>
      <Vao />
      <Hero
        pill={heroPill(current)}
        simulated={simulated}
        janela={
          ranked.length > 0 ? (
            <JanelaArena rows={ranked} series={competidores} date={lastCycle?.date ?? null} />
          ) : null
        }
      />
      {season ? (
        <Numeros season={season} universo={universe.rows.length} liquidados={liquidados} />
      ) : null}
      <Vao />
      <Escadaria caption={tape.caption} tape={tape} />
      <Vao />
      <Metodo
        season={season}
        lastCycle={lastCycle}
        decision={decision}
        cast={modelos}
        ranked={ranked}
        sorteadas={board?.asOf ? (sorteadas.get(board.asOf) ?? null) : null}
        referencias={referencias}
        faixa={faixa}
        ate={equity?.dates.at(-1) ?? null}
        universo={universe.rows.length}
      />
      {decision ? (
        <>
          <Vao />
          <Citacao decision={decision} />
        </>
      ) : null}
      <Vao />
      <ArenaAgora
        rows={ranked}
        series={competidores}
        season={season}
        lastCycle={lastCycle}
        liquidados={liquidados}
      />
      <Vao />
      <Laboratorios
        cast={cast}
        simulated={simulated}
        returns={new Map(ranked.map((row) => [row.competitor.slug, row.returnBps]))}
      />
      <Vao />
      <Carteira />
      <Vao />
      <Faq simulated={simulated} />
      <Vao />
      <Convite />
    </>
  );
});
