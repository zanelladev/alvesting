import type { Metadata } from 'next';
import { LeaderboardTable } from '../../components/tables';
import { Empty, Section } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { orNotFound } from '../../lib/page';
import { withApiDown } from '../../lib/with-api-down';

// O ranking completo (plano §3): os modelos, o Sorteio e as referências em tabelas separadas, com todas as métricas da liquidação.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Ranking' };

const GROUPS = [
  { id: 'modelos', title: 'Modelos', types: ['MODEL'] },
  { id: 'sorteio', title: 'Sorteio (controle)', types: ['RANDOM'] },
  { id: 'referencias', title: 'Referências', types: ['EQUAL_WEIGHT', 'CDI', 'BOVA11'] },
] as const;

export default withApiDown(async function RankingPage() {
  const { season } = await api.arenaCurrent();
  const board = season ? await orNotFound(api.leaderboard(season.slug)) : null;

  return (
    <>
      <header className="space-y-2">
        <h1 className="font-mono text-2xl font-semibold sm:text-3xl">Ranking</h1>
        <p>
          {season
            ? `${season.name}. Liquidado até ${season.settledThrough ? formatDate(season.settledThrough) : '(ainda não)'}.`
            : 'Nenhuma temporada em andamento ou encerrada ainda.'}
        </p>
      </header>

      {board && board.rows.length > 0 ? (
        <>
          {GROUPS.map(({ id, title, types }) => (
            <Section key={id} id={id} title={title}>
              <LeaderboardTable
                rows={board.rows.filter((row) =>
                  (types as readonly string[]).includes(row.competitor.type),
                )}
                label={`Ranking: ${title.toLowerCase()}`}
              />
            </Section>
          ))}
          <ul className="list-inside list-disc space-y-1 muted">
            <li>
              Pos. é a posição entre todos os competidores, por retorno; o empate vale a ordem do
              elenco. Por isso a posição dos modelos pode pular números.
            </li>
            <li>
              Percentil: a parcela das carteiras aleatórias do Monte Carlo que ficou abaixo do
              competidor, de 0 a 100. O ranking diz pouco sozinho; o percentil é o resultado
              principal.
            </li>
            <li>
              vs igual-peso e vs CDI: excesso de retorno sobre a referência, em pontos percentuais.
            </li>
            <li>
              Acerto: vendas com ganho sobre vendas feitas (entre parênteses). Custo LLM: o gasto
              acumulado com o provedor, em dólares.
            </li>
            <li>
              BOVA11 inclui proventos, que os modelos não recebem; é só contexto. A referência
              principal é o igual-peso do universo, só preço.
            </li>
          </ul>
        </>
      ) : (
        <Empty>
          {season
            ? 'Ainda não há resultado: a primeira liquidação acontece depois do primeiro pregão.'
            : 'Quando a primeira temporada começar, o ranking aparece aqui.'}
        </Empty>
      )}
    </>
  );
});
