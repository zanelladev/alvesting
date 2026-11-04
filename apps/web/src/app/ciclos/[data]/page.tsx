import type { Metadata } from 'next';
import type { CycleView } from '@alvesting/contracts';
import { cycleRefSchema } from '@alvesting/contracts';
import { DecisionCard } from '../../../components/decisions';
import { Empty, Fact, Facts, Section } from '../../../components/ui';
import { api } from '../../../lib/api';
import { formatDate, formatTime, formatWeekdayDate } from '../../../lib/format';
import { orNotFound } from '../../../lib/page';
import { withApiDown } from '../../../lib/with-api-down';

// O ciclo de um pregão (plano §3 e §10): os horários, a versão e o SHA-256 do prompt (o texto nunca), o SHA-256 do briefing, as decisões
// de cada modelo e os itens descartados com o motivo. `:data` é AAAA-MM-DD; o ULID do ciclo também vale (a api aceita os dois).
export const dynamic = 'force-dynamic';

const SKIP_REASON = {
  sem_briefing: 'o briefing não foi congelado',
  orcamento: 'o teto de custo foi atingido',
} as const satisfies Record<NonNullable<CycleView['skipReason']>, string>;

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

export default withApiDown(async function CyclePage({ params }: Props) {
  const { data } = await params;
  const cycle = await orNotFound(api.cycle(data));

  return (
    <>
      <header className="space-y-2">
        <h1 className="font-mono text-2xl font-semibold sm:text-3xl">
          Ciclo de {formatDate(cycle.date)}
        </h1>
        <p className="text-muted">{formatWeekdayDate(cycle.date)}</p>
      </header>

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
            <Facts>
              <Fact term="Versão do prompt">{cycle.prompt?.version ?? 'sem registro'}</Fact>
              <Fact term="SHA-256 do prompt">
                <span className="break-all">{cycle.prompt?.sha256 ?? 'sem registro'}</span>
              </Fact>
              <Fact term="SHA-256 do briefing">
                <span className="break-all">{cycle.briefing?.sha256 ?? 'sem registro'}</span>
              </Fact>
            </Facts>
            <p className="muted">
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
          <div className="space-y-3">
            {cycle.decisions.map((decision) => (
              <DecisionCard key={decision.competitor.slug} decision={decision} by="model" />
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
