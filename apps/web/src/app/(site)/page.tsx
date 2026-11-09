import { Chamadas, Hero, heroPill } from '../../components/hero';
import { Faq } from '../../components/landing/faq';
import { Laboratorios } from '../../components/landing/laboratorios';
import { ArenaAgora, Paineis } from '../../components/landing/paineis';
import { isSimulated } from '../../components/ui';
import { api } from '../../lib/api';
import { heroTape } from '../../lib/fita';
import { versoesDosLogos } from '../../lib/logos';
import { REFERENCE_TICKER, readBars, readTape } from '../../lib/quotes';
import { withApiDown } from '../../lib/with-api-down';

// A landing (ADR 0035), no desenho da landing do Rallies com o nosso conteúdo: o hero de texto, a
// moldura grande com a escadaria e o cartão "Arena agora" por cima, a faixa dos seis laboratórios, os quatro painéis com recortes de UI de
// verdade, o FAQ e o CTA; o rodapé grande é da casca do site (components/site-chrome.tsx). O conteúdo da arena (o gráfico do patrimônio, o
// ranking inteiro, o feed, os ciclos, a temporada e a faixa de cotações) mora na /arena.
// As leituras (d.10, o LCP do celular: o TTFB entra nele): a temporada atual, as últimas decisões, as barras do BOVA11, a fita e o índice dos
// logos das ações (lib/logos.ts: uma hora no cache de dados; a falha vira os monogramas, sem derrubar a página) saem juntas;
// o ranking, depois, só com ciclo (sem ciclo não há liquidação). Nada do patrimônio nem do Monte Carlo. Tudo pelo cache de dados do site
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
  const [current, feed, bars, universe, logos] = await Promise.all([
    api.arenaCurrent(),
    api.decisions({ limit: FEED_LIMIT }),
    readBars(REFERENCE_TICKER),
    readTape().catch((error: unknown) => {
      console.error('[web] landing sem a fita:', error);
      return { date: null, rows: [] };
    }),
    versoesDosLogos(),
  ]);
  const { season, lastCycle, macro } = current;
  const board = season && lastCycle ? await api.leaderboard(season.slug) : null;

  const ranked = (board?.rows ?? []).filter(
    (row) => row.competitor.type === 'MODEL' || row.competitor.type === 'RANDOM',
  );
  // A arena simulada (ui.tsx, SimulatedTag): algum modelo da temporada exibida decide pelo provedor fake. O elenco vem do ranking (a temporada
  // inteira, depois da primeira liquidação) e das decisões (as do último ciclo, antes dela).
  const cast = [...(board?.rows ?? []), ...feed.rows].map((row) => row.competitor);
  const simulated = cast.some(isSimulated);

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

  return (
    <>
      <Hero
        pill={heroPill(current)}
        simulated={simulated}
        caption={tape.caption}
        tape={tape}
        card={<ArenaAgora rows={ranked} />}
      />
      <Laboratorios cast={cast} simulated={simulated} />
      <Paineis
        lastCycle={lastCycle}
        decision={feed.rows[0] ?? null}
        ranked={ranked}
        logos={logos}
      />
      <Faq simulated={simulated} />
      <section
        aria-labelledby="cta-titulo"
        className="mt-28 flex flex-col items-center gap-7 pb-8 text-center"
      >
        <h2 id="cta-titulo" className="font-display text-30 lg:text-42">
          Veja a arena agora.
        </h2>
        <Chamadas className="justify-center" />
      </section>
    </>
  );
});
