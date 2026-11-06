import type { Metadata } from 'next';
import type { CycleView } from '@alvesting/contracts';
import { cycleRefSchema } from '@alvesting/contracts';
import { AREA_ARENA, NavegacaoDaArea, telasDaArena } from '../../../../../components/arena/pagina';
import { DecisionCard } from '../../../../../components/decisions';
import { Empty, Fact, Facts, PageHead, Section } from '../../../../../components/ui';
import { api } from '../../../../../lib/api';
import { formatDate, formatTime, formatWeekdayDate } from '../../../../../lib/format';
import { orNotFound } from '../../../../../lib/page';
import { withApiDown } from '../../../../../lib/with-api-down';

// O ciclo de um pregão (plano §3 e §10; no desenho do Rallies, docs/redesign-rallies/plano.md, e.7: as decisões em itens de feed, numa
// coluna): os horários, a versão e o SHA-256 do prompt (o texto nunca, nem em
// bloco de código), o SHA-256 do briefing, as decisões de cada modelo e os itens descartados com o motivo. `:data` é AAAA-MM-DD; o ULID do
// ciclo também vale (a api aceita os dois).
export const dynamic = 'force-dynamic';

const SKIP_REASON = {
  sem_briefing: 'o briefing não foi congelado',
  orcamento: 'o teto de custo foi atingido',
} as const satisfies Record<NonNullable<CycleView['skipReason']>, string>;

// A situação no cabeçalho, como a v1 a marcava: o colchete diz o estado sem depender da cor (não há cor de aviso: o aberto fica no cinza).
const FLAG = {
  CLOSED: { text: '[ok] fechado', tone: 'text-semantic-success' },
  OPEN: { text: '[!] aberto', tone: '' },
  SKIPPED: { text: '[x] pulado', tone: 'text-semantic-error' },
} as const satisfies Record<CycleView['status'], { text: string; tone: string }>;

type Props = { params: Promise<{ data: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { data } = await params;
  // só a data vira título: o que não é data (ou é um ULID) fica com o título genérico
  const date = cycleRefSchema.safeParse(data);
  return {
    title:
      date.success && /^\d{4}-\d{2}-\d{2}$/.test(data) ? `Ciclo de ${formatDate(data)}` : 'Ciclo',
  };
}

function status(cycle: CycleView): string {
  if (cycle.status === 'SKIPPED') {
    return `Pulado${cycle.skipReason ? `: ${SKIP_REASON[cycle.skipReason]}` : ''}`;
  }
  return cycle.status === 'CLOSED' ? 'Fechado' : 'Aberto';
}

// O hash é dado, não código: o valor inteiro na mono, quebrando onde precisar (64 caracteres não cabem em 360 px), sem bloco de código.
const Hash = ({ term, value }: { term: string; value: string }) => (
  <div className="space-y-1">
    <dt className="text-sm text-muted">{term}</dt>
    <dd className="font-mono text-sm break-all text-ink">{value}</dd>
  </div>
);

export default withApiDown(async function CyclePage({ params }: Props) {
  const { data } = await params;
  // o último ciclo da temporada atual marca a aba "Último ciclo" quando é este
  const [cycle, { lastCycle }] = await Promise.all([
    orNotFound(api.cycle(data)),
    api.arenaCurrent(),
  ]);
  const flag = FLAG[cycle.status];
  const last = lastCycle?.date ?? null;

  return (
    <>
      <NavegacaoDaArea
        label="Telas da arena"
        area={AREA_ARENA}
        trilha={`Ciclo de ${formatDate(cycle.date)}`}
        telas={telasDaArena(last === cycle.date ? 'ciclo' : null, last)}
      />
      <PageHead title={`Ciclo de ${formatDate(cycle.date)}`}>
        <p className="max-w-prose text-15 text-pretty">
          Os horários, os hashes do prompt e do briefing, iguais para todos, e a decisão de cada
          modelo neste pregão.
        </p>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 muted">
          <span className={`badge font-mono ${flag.tone}`}>{flag.text}</span>
          <span>{formatWeekdayDate(cycle.date)}</span>
        </p>
      </PageHead>

      <Section id="horarios" title="Horários">
        <Facts>
          <Fact term="Situação">{status(cycle)}</Fact>
          <Fact term="Decisão">{formatTime(cycle.decisionAt)}</Fact>
          <Fact term="Prazo">{formatTime(cycle.deadlineAt)}</Fact>
          <Fact term="Fechamento">
            {cycle.closedAt ? formatTime(cycle.closedAt, true) : 'ainda aberto'}
          </Fact>
        </Facts>
        <p className="muted">
          Horários de Brasília. Sem resposta até o prazo, o modelo fica em HOLD.
        </p>
      </Section>

      <Section id="prompt-e-briefing" title="Prompt e briefing">
        {cycle.prompt || cycle.briefing ? (
          <>
            <dl className="card space-y-4">
              <Hash term="Versão do prompt" value={cycle.prompt?.version ?? 'sem registro'} />
              <Hash term="SHA-256 do prompt" value={cycle.prompt?.sha256 ?? 'sem registro'} />
              <Hash term="SHA-256 do briefing" value={cycle.briefing?.sha256 ?? 'sem registro'} />
            </dl>
            <p className="max-w-prose muted">
              O texto do prompt fica oculto durante a temporada: só a versão e o SHA-256 são
              públicos. Padrão adotado: o texto é revelado no fim da temporada, e o hash publicado
              confere. O briefing é o mesmo para todos os modelos.
            </p>
          </>
        ) : (
          <Empty>Sem prompt nem briefing registrados.</Empty>
        )}
      </Section>

      <Section id="decisoes" title="Decisões">
        {cycle.decisions.length > 0 ? (
          <div className="max-w-2xl">
            {cycle.decisions.map((decision) => (
              <DecisionCard
                key={decision.competitor.slug}
                decision={decision}
                by="model"
                // o ciclo não traz o provedor do competidor, e sim o que respondeu a decisão
                simulated={decision.applied?.provider === 'fake'}
              />
            ))}
          </div>
        ) : (
          <Empty>
            {cycle.status === 'SKIPPED'
              ? 'Nenhum modelo foi chamado neste ciclo.'
              : 'Nenhuma decisão registrada neste ciclo.'}
          </Empty>
        )}
      </Section>
    </>
  );
});
