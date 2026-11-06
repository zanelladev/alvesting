import type { AdminCosts, AdminJobs, AdminSeason, AdminSeasons } from '@alvesting/contracts';
import { formatBps, formatDate, formatDateTime, formatUsdMicro } from '../lib/format';
import { CreateSeasonForm, EditSeasonForm, ResubmitDlqForm, StartSeasonForm } from './admin-forms';
import { STICKY, Th } from './tables';
import { Aviso, CAIXA_ERRO, Empty, Fact, Facts, ROW, TABLE, TD, TableScroll } from './ui';

// As seções do painel de admin que só mostram (etapa 10, parte 2; docs/TELAS.md, seção 8). Server Components: lêem o que a api de admin
// devolveu, validado pelo contrato, e montam o HTML. Os formulários (admin-forms.tsx) são os únicos pedaços que vão ao navegador. Texto
// que vem do banco ou de terceiros (o nome da temporada, o motivo de uma falha, o MessageId) é texto: o React o escapa.

// O nome da linha fica preso à esquerda quando a tabela rola dentro da própria caixa: o cabeçalho de coluna e a célula presa são os das tabelas
// da arena (tables.tsx). O tipo do job vai na mono (é um identificador); o competidor e o dia, não.
const WRAP = 'break-all';

const STATUS: Record<string, string> = {
  RUNNING: 'rodando',
  SUCCEEDED: 'ok',
  FAILED: 'falhou',
  WAITING: 'esperando',
};

export function JobsPanel({ jobs }: { jobs: AdminJobs }) {
  return (
    <>
      <p className="max-w-prose">
        O último job de cada tipo e quantos há em cada estado. &quot;Esperando&quot; é o{' '}
        <code>eod</code> que aguarda o arquivo do pregão, e não conta como falha.
      </p>
      {jobs.jobs.length === 0 ? (
        <Empty>Nenhum job rodou ainda.</Empty>
      ) : (
        <TableScroll label="Último job de cada tipo">
          <table className={TABLE}>
            <caption className="sr-only">Último job de cada tipo</caption>
            <thead>
              <tr>
                <Th>Tipo</Th>
                <Th>Estado</Th>
                <Th>Chave</Th>
                <Th>Tent.</Th>
                <Th>Início</Th>
                <Th>Falhou</Th>
                <Th>Esperando</Th>
              </tr>
            </thead>
            <tbody>
              {jobs.jobs.map((job) => (
                <tr key={job.type} className={ROW}>
                  <th scope="row" className={`${STICKY} font-mono`}>
                    {job.type}
                  </th>
                  <td className={TD}>{STATUS[job.latest.status] ?? job.latest.status}</td>
                  <td className={TD}>{job.latest.key}</td>
                  <td className={TD}>{job.latest.attempts}</td>
                  <td className={TD}>{formatDateTime(job.latest.startedAt)}</td>
                  <td className={TD}>{job.counts.FAILED}</td>
                  <td className={TD}>{job.counts.WAITING}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      {jobs.failures.length > 0 ? (
        <>
          <h3 className="pt-4 font-display text-title">Falhas recentes</h3>
          <ul className="space-y-2">
            {jobs.failures.map((run) => (
              <li
                key={`${run.type}:${run.key}`}
                className="min-w-0 border-l-2 border-semantic-error pl-2"
              >
                <p className={`font-mono text-sm text-ink ${WRAP}`}>
                  {run.type} {run.key}
                </p>
                <p className="muted">
                  {formatDateTime(run.startedAt)}, tentativa {run.attempts}
                  {run.error ? `: ${run.error}` : ''}
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <h3 className="pt-4 font-display text-title">Arquivos da CVM</h3>
      {jobs.fetchStates.length === 0 ? (
        <Empty>Nenhum arquivo da CVM foi conferido ainda.</Empty>
      ) : (
        <ul className="space-y-1">
          {jobs.fetchStates.map((state) => (
            <li key={state.source}>
              <span className={`font-mono ${WRAP}`}>{state.source}</span>: conferido em{' '}
              {formatDateTime(state.checkedAt)}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

// A DLQ que não deu para ler é erro de leitura, e não "ainda não há nada": a caixa de erro, e não o vazio. Todas sem leitura (o Service Bus
// fora, ou a api sem ele) são o mesmo motivo: uma frase só para a seção, e não a mesma seis vezes.
const UNREAD =
  '(o Service Bus não respondeu ou a api não está configurada para ele). Tente de novo; o painel não pede outro papel por isso.';

export function QueuesPanel({ queues }: { queues: AdminJobs['queues'] }) {
  const unread = queues.length > 0 && queues.every((q) => q.deadLetters.status === 'unavailable');
  return (
    <>
      <p className="max-w-prose">
        A DLQ de cada fila, lida sem consumir. Reenviar devolve a mensagem à fila de origem com o
        mesmo MessageId e é idempotente: o que já saiu da DLQ não sai de novo. Corrija a causa
        antes.
      </p>
      {unread ? (
        <p className={`max-w-prose ${CAIXA_ERRO}`}>
          Não deu para ler a DLQ de nenhuma fila agora {UNREAD}
        </p>
      ) : (
        <ul className="space-y-6">
          {queues.map(({ queue, deadLetters }) => (
            <li key={queue} className="min-w-0 space-y-2">
              <h3 className="font-mono text-base">{queue}</h3>
              {deadLetters.status === 'unavailable' ? (
                <p className={`max-w-prose ${CAIXA_ERRO}`}>
                  Não deu para ler a DLQ desta fila agora {UNREAD}
                </p>
              ) : deadLetters.count === 0 ? (
                <p>DLQ vazia.</p>
              ) : (
                <>
                  <p className="text-ink">
                    {deadLetters.capped
                      ? `${deadLetters.count} ou mais mensagens na DLQ`
                      : plural(deadLetters.count, 'mensagem na DLQ', 'mensagens na DLQ')}
                  </p>
                  <ul className="space-y-4">
                    {deadLetters.messages.map((message, index) => {
                      const id = `dlq-${queue}-${index}`;
                      return (
                        <li key={`${message.messageId}:${index}`} className="card">
                          {/* a posição entra no nome do formulário (aria-labelledby aponta para cá): a mesma mensagem pode estar duas
                            vezes na DLQ (o MessageId é determinístico e o Service Bus Basic não detecta duplicata), e dois formulários
                            com o mesmo nome violam o landmark único */}
                          <p id={id} className={`font-mono text-sm text-ink ${WRAP}`}>
                            {message.messageId}
                            <span className="sr-only">
                              {` (mensagem ${index + 1} de ${deadLetters.messages.length})`}
                            </span>
                          </p>
                          <p className="muted">
                            {plural(message.deliveryCount, 'entrega', 'entregas')}
                            {message.reason ? `, motivo ${message.reason}` : ''}
                            {message.enqueuedAt
                              ? `, desde ${formatDateTime(message.enqueuedAt)}`
                              : ''}
                          </p>
                          {message.description ? (
                            <p className="muted">{message.description}</p>
                          ) : null}
                          {message.resubmittable ? (
                            <div className="mt-2">
                              <ResubmitDlqForm
                                queue={queue}
                                messageId={message.messageId}
                                labelledBy={id}
                              />
                            </div>
                          ) : (
                            <p className="muted mt-2">
                              O MessageId está fora do padrão da arena (outra ferramenta pôs a
                              mensagem aqui): ela fica na lista para ser vista e não se reenvia por
                              este painel.
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// Soma `value` por chave, na ordem em que a chave aparece.
function sumBy<T>(rows: readonly T[], key: (row: T) => string, value: (row: T) => number) {
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(key(row), (totals.get(key(row)) ?? 0) + value(row));
  return [...totals];
}

export function CostsPanel({ costs }: { costs: AdminCosts }) {
  const [year, month] = costs.month.split('-');
  // a parte do teto já usada, em pontos-base inteiros (BigInt: sem float em dinheiro)
  const used =
    costs.capMicroUsd !== null && costs.capMicroUsd > 0
      ? formatBps(Number((BigInt(costs.spentMicroUsd) * 10_000n) / BigInt(costs.capMicroUsd)), {
          signed: false,
        })
      : null;
  const byCompetitor = sumBy(
    costs.rows,
    (row) => `${row.season} / ${row.name}`,
    (row) => row.costMicroUsd,
  ).sort(([a], [b]) => a.localeCompare(b, 'pt-BR'));
  const byDay = sumBy(
    costs.rows,
    (row) => row.date,
    (row) => row.costMicroUsd,
  );
  return (
    <>
      <Facts>
        <Fact term="Mês">{`${month}/${year}`}</Fact>
        <Fact term="Gasto no mês">{formatUsdMicro(costs.spentMicroUsd)}</Fact>
        <Fact term="Teto do mês">
          {costs.capMicroUsd === null ? 'não configurado' : formatUsdMicro(costs.capMicroUsd)}
        </Fact>
        {used ? <Fact term="Usado do teto">{used}</Fact> : null}
      </Facts>
      {costs.capMicroUsd === null ? (
        <Aviso>
          Teto não configurado: sem ele o ciclo com modelo pago é pulado (os modelos fake custam
          zero e não dependem dele).
        </Aviso>
      ) : null}
      <p className="muted">
        A mesma soma que o agendador compara com o teto antes de abrir o ciclo: o custo das decisões
        dos ciclos do mês, de todas as temporadas. O ciclo que começa abaixo do teto pode passar um
        pouco.
      </p>
      {costs.rows.length === 0 ? (
        <Empty>Nenhuma decisão neste mês ainda.</Empty>
      ) : (
        <>
          <TableScroll label="Custo por competidor no mês">
            <table className={TABLE}>
              <caption className="sr-only">Custo por competidor no mês</caption>
              <thead>
                <tr>
                  <Th>Competidor</Th>
                  <Th>Custo</Th>
                </tr>
              </thead>
              <tbody>
                {byCompetitor.map(([label, micro]) => (
                  <tr key={label} className={ROW}>
                    <th scope="row" className={STICKY}>
                      {label}
                    </th>
                    <td className={TD}>{formatUsdMicro(micro)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
          <TableScroll label="Custo por dia no mês">
            <table className={TABLE}>
              <caption className="sr-only">Custo por dia no mês</caption>
              <thead>
                <tr>
                  <Th>Dia</Th>
                  <Th>Custo</Th>
                </tr>
              </thead>
              <tbody>
                {byDay.map(([date, micro]) => (
                  <tr key={date} className={ROW}>
                    <th scope="row" className={STICKY}>
                      {formatDate(date)}
                    </th>
                    <td className={TD}>{formatUsdMicro(micro)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </>
      )}
    </>
  );
}

const SEASON_STATUS: Record<AdminSeason['status'], string> = {
  DRAFT: 'rascunho',
  RUNNING: 'em andamento',
  FINISHED: 'encerrada',
};

function SeasonCard({ season }: { season: AdminSeason }) {
  // O id do título vem do ULID da temporada, e não do slug: o slug "nova" (válido) daria `temporada-nova`, o id do título do formulário
  // de criação, e o slug "x" colidiria com o "x-editar". O ULID é maiúsculo e nunca termina em `-editar` nem em `-iniciar`.
  const base = `temporada-${season.id}`;
  const draft = season.status === 'DRAFT';
  return (
    <li className="card space-y-4">
      <h3 id={base} className={`font-display text-title ${WRAP}`}>
        {season.name}
      </h3>
      <Facts dense>
        <Fact term="Slug" wide>
          <span className="break-all">{season.slug}</span>
        </Fact>
        <Fact term="Estado">{SEASON_STATUS[season.status]}</Fact>
        <Fact term="Início">{season.startDate ? formatDate(season.startDate) : 'ainda não'}</Fact>
        <Fact term="Pregões">{season.params.sessions}</Fact>
      </Facts>
      <ul className="space-y-1 text-sm">
        {season.competitors.map((competitor) => (
          <li key={competitor.slug} className={`font-mono ${WRAP}`}>
            {competitor.kind === 'MODEL'
              ? `${competitor.slug}: ${competitor.provider} ${competitor.modelId}`
              : competitor.kind === 'BENCHMARK'
                ? `${competitor.slug}: referência ${competitor.benchmark}`
                : `${competitor.slug}: sorteio`}
          </li>
        ))}
      </ul>
      {draft ? (
        <>
          {/* o nome do formulário leva o slug: dois rascunhos não podem ter dois formulários com o mesmo nome (landmark único, axe) */}
          <h4 id={`${base}-editar`} className={`font-display text-sm font-medium text-ink ${WRAP}`}>
            Editar o rascunho {season.slug}
          </h4>
          <EditSeasonForm
            id={season.id}
            labelledBy={`${base}-editar`}
            initialJson={JSON.stringify(
              { name: season.name, params: season.params, competitors: season.competitors },
              null,
              2,
            )}
          />
          <h4
            id={`${base}-iniciar`}
            className={`font-display text-sm font-medium text-ink ${WRAP}`}
          >
            Iniciar o rascunho {season.slug}
          </h4>
          <StartSeasonForm id={season.id} slug={season.slug} labelledBy={`${base}-iniciar`} />
        </>
      ) : (
        <p className="muted">Regras, elenco e prompt ficam fixos: esta temporada não se edita.</p>
      )}
    </li>
  );
}

export function SeasonsPanel({ seasons }: { seasons: AdminSeasons }) {
  return (
    <>
      <p className="max-w-prose">
        Todas as temporadas, o rascunho inclusive (a página pública só mostra as que começaram). Só
        o rascunho se edita. Uma temporada em andamento não muda regras, elenco nem prompt, e só uma
        fica em andamento por vez.
      </p>
      {seasons.seasons.length === 0 ? (
        <Empty>Nenhuma temporada criada ainda.</Empty>
      ) : (
        <ul className="space-y-6">
          {seasons.seasons.map((season) => (
            <SeasonCard key={season.id} season={season} />
          ))}
        </ul>
      )}
      <h3 id="temporada-nova" className="pt-4 font-display text-title">
        Nova temporada
      </h3>
      <div className="card max-w-md">
        <CreateSeasonForm labelledBy="temporada-nova" />
      </div>
    </>
  );
}
