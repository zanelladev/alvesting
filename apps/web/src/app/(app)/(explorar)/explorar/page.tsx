import type { Metadata } from 'next';
import type { ReactElement } from 'react';
import type { InternalTape, LeaderboardRow } from '@alvesting/contracts';
import { Tooltip } from '../../../../components/arc/tooltip/tooltip';
import { lerCarteiras } from '../../../../components/arena/carteiras';
import {
  BarraExplorar,
  CartaoCompetidor,
  EXPLORAR,
  UniversoDaSemana,
} from '../../../../components/arena/explorar';
import { ComBarra, NavegacaoDaArea } from '../../../../components/arena/pagina';
import { Empty, NotaSimulada, SearchForm, Section } from '../../../../components/ui';
import { api } from '../../../../lib/api';
import { formatPercentile } from '../../../../lib/format';
import { versoesDosLogos } from '../../../../lib/logos';
import { readTape } from '../../../../lib/quotes';
import { withApiDown } from '../../../../lib/with-api-down';

// O Explorar (docs/redesign-rallies/plano.md, f.1), no desenho do Discover do Rallies: o título, a busca de ações e as carteiras da arena em
// cartões (um por competidor da temporada, com o logo, o que ele é, o número de posições e o retorno), em duas grades, a dos modelos e a do
// controle e das referências; e o universo da semana (os papéis do briefing do último ciclo, com o fechamento e o logo de cada um). A barra
// "Explorar" fica ao lado (components/arena/explorar.tsx). Lê a api pelo cache de dados do site e é dinâmica, como as outras telas da arena.
// O tooltip da Arc (ADR 0037) explica onde ajuda: em cada cartão de modelo, o nome inteiro e o que é o percentil.
// É de cliente (o Motion e o tooltip da Radix só nesta tela, como ilha): no toque ele não abre, e o que ele diz é complemento (o percentil
// está à vista; as regras do universo, também, em texto).
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Explorar' };

// o tooltip do cartão do modelo: o nome inteiro (com o sufixo de versão) e o que é o percentil, como o da faixa da arena
function dicaDoCartao(row: LeaderboardRow) {
  const percentil = row.percentileBps;
  if (percentil === null) return undefined;
  return function comDica(link: ReactElement) {
    return (
      <Tooltip
        side="bottom"
        content={
          <>
            <span className="block font-medium">{row.competitor.name}</span>
            <span className="block">
              Percentil {formatPercentile(percentil)}: o retorno ficou acima de{' '}
              {formatPercentile(percentil)}% das carteiras sorteadas do Monte Carlo.
            </span>
          </>
        }
      >
        {link}
      </Tooltip>
    );
  };
}

const NO_RESULT =
  'Ainda não há resultado: os cartões aparecem depois da primeira liquidação, com o retorno de cada competidor.';

export default withApiDown(async function ExplorarPage() {
  const { season } = await api.arenaCurrent();
  // o ranking (o retorno de cada cartão e a barra), as carteiras dos modelos (o número de posições) e o universo da semana não dependem um
  // do outro. O universo é enfeite: a falha só dele vai para o log e a seção diz que não há, sem derrubar a tela.
  const board = season ? api.leaderboard(season.slug) : null;
  const [ranking, carteiras, tape, logos] = await Promise.all([
    board,
    season && board ? board.then((b) => lerCarteiras(b.rows, season.slug)) : [],
    readTape().catch((error: unknown): InternalTape => {
      console.error('[web] explorar sem o universo da semana:', error);
      return { date: null, rows: [] };
    }),
    versoesDosLogos(),
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
      {/* o fio embaixo da busca vai de uma borda à outra do principal, como o do Discover do Rallies (come o respiro do `main`) */}
      <header className="-mx-5 space-y-6 border-b border-hairline px-5 pb-6 lg:-mx-6 lg:px-6">
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
            {/* o "simulado" uma vez por contexto: a nota no cabeçalho da grade (o Sorteio e as referências não decidem) */}
            <NotaSimulada competitors={grupo.rows.map((row) => row.competitor)} />
            <ul
              aria-label={grupo.title}
              className="grid gap-x-4 gap-y-4 sm:grid-cols-2 lg:grid-cols-4"
            >
              {grupo.rows.map((row) => (
                <CartaoCompetidor
                  key={row.competitor.slug}
                  row={row}
                  posicoes={posicoes.get(row.competitor.slug) ?? null}
                  envolver={dicaDoCartao(row)}
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
        <UniversoDaSemana tape={tape} logos={logos} />
      </Section>
    </ComBarra>
  );
});
