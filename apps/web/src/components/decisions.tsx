import type { DropReason, HoldReason } from '@alvesting/contracts';
import { formatConfidence, formatDate, formatPercentValue } from '../lib/format';
import { LINK, NavLink, SimulatedTag } from './ui';

// A decisão de um modelo num pregão, como o feed da home, a página do modelo e a do ciclo a mostram. O texto do modelo (resumo e
// justificativa) é dado de terceiro: já passou pela limpeza e pelo filtro de vazamento na api (docs/METODOLOGIA.md) e aqui entra como
// TEXTO, nunca como HTML nem como link (o React o escapa). Do item descartado só a posição e o motivo; o conteúdo nunca sai.

export type Action = 'BUY' | 'SELL' | 'HOLD';

export interface DecisionCardData {
  competitor: { slug: string; name: string };
  status: 'DECIDED' | 'FORCED_HOLD';
  holdReason: HoldReason | null;
  marketView: 'otimista' | 'pessimista' | 'neutro' | null;
  summary: string | null;
  items: ReadonlyArray<{
    position: number;
    action: Action;
    ticker: string;
    percent: number | null;
    confidence: number | null;
    rationale: string;
  }>;
  dropped: ReadonlyArray<{ position: number; reason: DropReason }>;
}

// A visão de mercado concorda com "visão" (o valor do contrato é o que o modelo responde, no masculino): "visão neutra".
const MARKET_VIEW: Record<NonNullable<DecisionCardData['marketView']>, string> = {
  otimista: 'visão otimista',
  pessimista: 'visão pessimista',
  neutro: 'visão neutra',
};

// Por que a decisão virou HOLD à força, e por que um item da resposta foi descartado (os motivos do contrato, em português).
const HOLD_REASON: Record<HoldReason, string> = {
  prazo: 'fora do prazo',
  prompt_divergente: 'prompt divergente',
  resposta_invalida: 'resposta inválida',
  falha: 'falha do provedor',
  sem_resposta: 'sem resposta',
};
const DROP_REASON: Record<DropReason, string> = {
  invalid_item: 'item fora do formato',
  over_order_limit: 'acima do limite de ordens por ciclo',
  not_in_universe: 'ação fora do universo',
  not_in_portfolio: 'venda de ação que não está na carteira',
  duplicate_ticker: 'ticker repetido na resposta',
  max_positions: 'acima do limite de posições',
};

// Compra e venda cheia ou vazada, e o HOLD tracejado: o que o item faz se lê pela palavra e pela borda, sem depender de cor (a etiqueta
// `badge` do sistema, globals.css).
const BADGE: Record<Action, string> = {
  BUY: 'border-ink bg-ink text-canvas',
  SELL: 'border-ink text-ink',
  HOLD: 'border-dashed text-body',
};
export const ActionBadge = ({ action }: { action: Action }) => (
  <span data-action={action} className={`badge font-mono ${BADGE[action]}`}>
    {action}
  </span>
);

const percentOf = (action: Action, percent: number | null): string | null =>
  percent === null || action === 'HOLD'
    ? null
    : `${formatPercentValue(percent)} ${action === 'BUY' ? 'do patrimônio' : 'da posição'}`;

// `date`: a data do pregão, como link para o ciclo (não vai na página do ciclo, que já é ele). `by`: o que dá o título do cartão, o
// modelo (no feed e no ciclo) ou a data (na página do próprio modelo, que já mostra o nome). `simulated`: a decisão veio do provedor
// fake, e o nome do modelo leva a etiqueta (ui.tsx, SimulatedTag).
export function DecisionCard({
  decision,
  date,
  by,
  simulated = false,
}: {
  decision: DecisionCardData;
  date?: string;
  by: 'model' | 'date';
  simulated?: boolean;
}) {
  const modelLink = (
    <>
      <NavLink href={`/modelos/${decision.competitor.slug}`} className={LINK}>
        {decision.competitor.name}
      </NavLink>
      {simulated ? <SimulatedTag /> : null}
    </>
  );
  const dateLink = date ? (
    <NavLink href={`/ciclos/${date}`} className={LINK}>
      {formatDate(date)}
    </NavLink>
  ) : null;

  return (
    <article className="card space-y-3">
      <header>
        <h3 className="font-display text-title">{by === 'model' ? modelLink : dateLink}</h3>
        <p className="flex flex-wrap items-center gap-x-3 muted">
          {by === 'model' ? dateLink : null}
          {decision.marketView ? <span>{MARKET_VIEW[decision.marketView]}</span> : null}
        </p>
      </header>

      {decision.status === 'FORCED_HOLD' ? (
        <p className="font-display font-medium text-ink">
          HOLD forçado{decision.holdReason ? `: ${HOLD_REASON[decision.holdReason]}` : ''}
        </p>
      ) : null}
      {decision.summary ? <p>{decision.summary}</p> : null}

      {decision.items.length > 0 ? (
        <ul className="space-y-2">
          {decision.items.map((item) => {
            const percent = percentOf(item.action, item.percent);
            return (
              <li key={item.position} className="flex flex-wrap items-center gap-x-3">
                <ActionBadge action={item.action} />
                <NavLink href={`/acoes/${item.ticker}`} className={`${LINK} font-mono`}>
                  {item.ticker}
                </NavLink>
                {percent ? <span className="text-sm text-ink tabular-nums">{percent}</span> : null}
                {item.confidence === null ? null : (
                  <span className="muted">confiança {formatConfidence(item.confidence)}</span>
                )}
                {/* a justificativa é do modelo e pode ter uma palavra sem espaço: o item flex precisa poder encolher (min-w-0) para o
                    `break-word` do html quebrá-la, senão ela alarga a página em 360 px */}
                <p className="min-w-0 basis-full text-sm">{item.rationale}</p>
              </li>
            );
          })}
        </ul>
      ) : null}

      {decision.dropped.length > 0 ? (
        <div className="text-sm">
          <p className="font-display font-medium text-ink">Itens descartados</p>
          <ul aria-label="Itens descartados" className="list-disc pl-6">
            {decision.dropped.map((drop) => (
              <li key={drop.position}>
                Item {drop.position + 1}: {DROP_REASON[drop.reason]}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </article>
  );
}
