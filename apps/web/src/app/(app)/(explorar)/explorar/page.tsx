import type { Metadata } from 'next';
import type { InternalTape, LeaderboardRow } from '@alvesting/contracts';
import { lerCarteiras } from '../../../../components/arena/carteiras';
import {
  BarraExplorar,
  CartaoCompetidor,
  EXPLORAR,
  UniversoDaSemana,
} from '../../../../components/arena/explorar';
import { ComBarra, NavegacaoDaArea } from '../../../../components/arena/pagina';
import { Empty, SearchForm, Section } from '../../../../components/ui';
import { api } from '../../../../lib/api';
import { readTape } from '../../../../lib/quotes';
import { withApiDown } from '../../../../lib/with-api-down';

// O Explorar (docs/redesign-rallies/plano.md, f.1), no desenho do Discover do Rallies: o título, a busca de ações e as carteiras da arena em
// cartões (um por competidor da temporada, com o logo, o que ele é, o número de posições e o retorno), em duas grades, a dos modelos e a do
// controle e das referências; e o universo da semana (os papéis do briefing do último ciclo, com o fechamento). A barra "Explorar" fica ao
// lado (components/arena/explorar.tsx). Lê a api pelo cache de dados do site e é dinâmica, como as outras telas da arena.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Explorar' };

const NO_RESULT =
  'Ainda não há resultado: os cartões aparecem depois da primeira liquidação, com o retorno de cada competidor.';

export default withApiDown(async function ExplorarPage() {
  const { season } = await api.arenaCurrent();
  // o ranking (o retorno de cada cartão e a barra), as carteiras dos modelos (o número de posições) e o universo da semana não dependem um
  // do outro. O universo é enfeite: a falha só dele vai para o log e a seção diz que não há, sem derrubar a tela.
  const board = season ? api.leaderboard(season.slug) : null;
  const [ranking, carteiras, tape] = await Promise.all([
    board,
    season && board ? board.then((b) => lerCarteiras(b.rows, season.slug)) : [],
    readTape().catch((error: unknown): InternalTape => {
      console.error('[web] explorar sem o universo da semana:', error);
      return { date: null, rows: [] };
    }),
  ]);
  const rows: readonly LeaderboardRow[] = ranking?.rows ?? [];
  // a carteira indisponível (a leitura que falhou, components/arena/carteiras.tsx) fica sem o número: o cartão mostra o traço
  const posicoes = new Map(
    carteiras.map((detail) => [
      detail.competitor.slug,
      'indisponivel' in detail ? null : (detail.portfolio?.holdings?.positions.length ?? null),
    ]),
  );
  const grupos = [
    {
      id: 'modelos',
      title: 'Modelos',
      rows: rows.filter((row) => row.competitor.type === 'MODEL'),
    },
    {
      id: 'referencias',
      title: 'Controle e referências',
      rows: rows.filter((row) => row.competitor.type !== 'MODEL'),
    },
  ];

  return (
    <ComBarra largura={300} barra={<BarraExplorar rows={rows} />}>
      <NavegacaoDaArea label="Telas do explorar" area={EXPLORAR} trilha="Explorar" telas={[]} />
      <header className="space-y-6 border-b border-hairline pb-6">
        <h1 className="max-w-[18ch] font-display text-32 text-balance">
          Explore as carteiras da arena
        </h1>
        <SearchForm
          action="/acoes"
          name="q"
          label="Buscar ação pelo ticker ou pelo nome"
          placeholder="Buscar ação…"
          button="Buscar"
          maxLength={40}
        />
      </header>

      {rows.length > 0 ? (
        grupos.map((grupo) => (
          <Section key={grupo.id} id={grupo.id} title={grupo.title}>
            <ul
              aria-label={grupo.title}
              className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-4"
            >
              {grupo.rows.map((row) => (
                <CartaoCompetidor
                  key={row.competitor.slug}
                  row={row}
                  posicoes={posicoes.get(row.competitor.slug) ?? null}
                />
              ))}
            </ul>
          </Section>
        ))
      ) : (
        <div className="mt-8">
          <Empty>{NO_RESULT}</Empty>
        </div>
      )}

      <Section id="universo" title="Universo da semana">
        <UniversoDaSemana tape={tape} />
      </Section>
    </ComBarra>
  );
});
