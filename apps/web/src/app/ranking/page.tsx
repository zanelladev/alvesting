import type { Metadata } from 'next';
import { LeaderboardTable } from '../../components/tables';
import { Empty, PageHead, Section } from '../../components/ui';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { orNotFound } from '../../lib/page';
import { withApiDown } from '../../lib/with-api-down';

// O ranking completo (plano §3; o desenho é o da v1, ADR 0034): os modelos, o Sorteio e as referências em tabelas separadas, com todas as
// métricas da liquidação, e o que cada coluna quer dizer.
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
      <PageHead title="Ranking">
        <p className="max-w-prose text-lead text-pretty">
          Todos os competidores da temporada, por retorno, com as métricas da liquidação.
        </p>
        <p className="muted">
          {season
            ? `${season.name} · liquidado até ${season.settledThrough ? formatDate(season.settledThrough) : 'ainda não'}`
            : 'Nenhuma temporada em andamento ou encerrada ainda.'}
        </p>
      </PageHead>

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
          <Section id="como-ler" title="Como ler a tabela">
            <ul className="max-w-prose list-disc pl-6 space-y-2 muted">
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
                vs igual-peso e vs CDI: excesso de retorno sobre a referência, em pontos
                percentuais.
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
          </Section>
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
