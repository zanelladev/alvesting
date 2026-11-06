import type { DropReason, HoldReason, PublicCompetitor } from '@alvesting/contracts';
import { formatBps, formatConfidence, formatDate, formatPercentValue } from '../lib/format';
import { Logo } from './competidor';
import { LogoDoPapel } from './logo-do-papel';
import { LINK, NavLink, SimulatedTag, direction } from './ui';

// A decisão de um modelo num pregão, como o feed da arena, a página do modelo, a do ciclo e a landing a mostram. O texto do modelo (resumo e
// justificativa) é dado de terceiro: já passou pela limpeza e pelo filtro de vazamento na api (docs/METODOLOGIA.md) e aqui entra como
// TEXTO, nunca como HTML nem como link (o React o escapa). Do item descartado só a posição e o motivo; o conteúdo nunca sai.

export type Action = 'BUY' | 'SELL' | 'HOLD';

export interface DecisionCardData {
  // o tipo, o provedor e o modelo vêm no feed (o competidor público) e não no ciclo: o logo os usa quando há
  competitor: {
    slug: string;
    name: string;
    type?: PublicCompetitor['type'];
    provider?: PublicCompetitor['provider'];
    modelId?: PublicCompetitor['modelId'];
  };
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
// `badge` do sistema, globals.css), na sans 500 (a mono é só para hash e código).
const BADGE: Record<Action, string> = {
  BUY: 'border-ink bg-ink text-canvas',
  SELL: 'border-ink text-ink',
  HOLD: 'border-dashed text-body',
};
export const ActionBadge = ({ action }: { action: Action }) => (
  <span data-action={action} className={`badge font-medium ${BADGE[action]}`}>
    {action}
  </span>
);

const percentOf = (action: Action, percent: number | null): string | null =>
  percent === null || action === 'HOLD'
    ? null
    : `${formatPercentValue(percent)} ${action === 'BUY' ? 'do patrimônio' : 'da posição'}`;

// O nome e a data do cabeçalho: links sem o sublinhado (o desenho do feed do Rallies), na caixa de 44 px do `link`.
const HEAD_LINK = `${LINK} no-underline hover:underline`;

// O item do feed do Rallies (plano do redesenho, e.5): no cabeçalho o logo do laboratório, o nome do modelo, o retorno dele na temporada
// (`returnBps`, do ranking: quem não o tem não o mostra) e a data do pregão; o resumo do modelo como o título do item; cada ordem com a
// etiqueta, o ticker num chip, o percentual, a confiança e a justificativa; os itens descartados recuados, como uma resposta. Um item por
// vez, separado do de cima por um fio (o primeiro da lista, sem). `date`: a data do pregão, como link para o ciclo (não vai na página do
// ciclo, que já é ele). `by`: o que dá o título do item, o modelo (no feed e no ciclo) ou a data (na página do próprio modelo, que já
// mostra o nome e o logo). `simulated`: a decisão veio do provedor fake, e o item leva a etiqueta "simulado" logo depois do título (ui.tsx,
// SimulatedTag), uma vez por item; `avisoNaPagina` a tira, quando a página já tem o aviso que cobre a lista (o feed da arena, o ciclo).
// `logos`: a versão do logo de cada ticker (lib/logos.ts, versoesDosLogos), para o logo à esquerda do ticker de cada ordem; sem ela, o
// monograma.
// O contrato de DOM que os testes leem fica: o `article`, o `h3` com o link do modelo ou da data, um `p` só no cabeçalho (a data e a visão de
// mercado), o resumo como o único `p` direto do item e um `li` por ordem, com o `[data-action]` e o link do ticker.
export function DecisionCard({
  decision,
  date,
  by,
  simulated = false,
  avisoNaPagina = false,
  returnBps,
  logos,
}: {
  decision: DecisionCardData;
  date?: string;
  by: 'model' | 'date';
  simulated?: boolean;
  avisoNaPagina?: boolean;
  returnBps?: number | null;
  logos?: ReadonlyMap<string, string>;
}) {
  const { competitor } = decision;
  const modelLink = (
    <NavLink href={`/modelos/${competitor.slug}`} className={HEAD_LINK}>
      {competitor.name}
    </NavLink>
  );
  // a data na linha de baixo do cabeçalho vai em muted; como título do item (na página do modelo), na tinta do h3
  const dateLink = (muted: boolean) =>
    date ? (
      <NavLink
        href={`/ciclos/${date}`}
        className={muted ? `${HEAD_LINK} text-muted hover:text-ink` : HEAD_LINK}
      >
        {formatDate(date)}
      </NavLink>
    ) : null;

  return (
    <article className="min-w-0 space-y-3 border-t border-hairline py-6 first:border-t-0 first:pt-0">
      <header className="flex min-w-0 items-center gap-3">
        {/* só modelo decide: o laboratório sai do tipo e do modelo quando o dado os traz (o feed), e senão do slug (o ciclo) */}
        {by === 'model' ? (
          <Logo
            competitor={{
              slug: competitor.slug,
              name: competitor.name,
              type: competitor.type ?? 'MODEL',
              provider: competitor.provider ?? null,
              modelId: competitor.modelId ?? null,
            }}
            className="size-10"
          />
        ) : null}
        <div className="flex min-w-0 flex-wrap items-center gap-x-3">
          <h3 className="text-15 font-semibold text-ink">
            {by === 'model' ? modelLink : dateLink(false)}
          </h3>
          {by === 'model' && simulated && !avisoNaPagina ? <SimulatedTag /> : null}
          {returnBps === undefined || returnBps === null ? null : (
            <span
              data-dir={direction(returnBps)}
              className="text-sm font-semibold text-ink tabular-nums"
            >
              {formatBps(returnBps)}
            </span>
          )}
          <p className="flex flex-wrap items-center gap-x-3 text-xs text-muted">
            {by === 'model' ? dateLink(true) : null}
            {decision.marketView ? <span>{MARKET_VIEW[decision.marketView]}</span> : null}
          </p>
        </div>
      </header>

      {decision.status === 'FORCED_HOLD' ? (
        <p className="text-18 font-semibold text-ink">
          HOLD forçado{decision.holdReason ? `: ${HOLD_REASON[decision.holdReason]}` : ''}
        </p>
      ) : null}
      {decision.summary ? (
        <p className="text-18 font-semibold text-pretty text-ink">{decision.summary}</p>
      ) : null}

      {decision.items.length > 0 ? (
        <ul className="space-y-3">
          {decision.items.map((item) => {
            const percent = percentOf(item.action, item.percent);
            return (
              <li key={item.position} className="flex flex-wrap items-center gap-x-2">
                <ActionBadge action={item.action} />
                <NavLink href={`/acoes/${item.ticker}`} className="chip font-medium">
                  <LogoDoPapel ticker={item.ticker} versao={logos?.get(item.ticker)} />
                  {item.ticker}
                </NavLink>
                {percent ? <span className="text-sm text-ink tabular-nums">{percent}</span> : null}
                {item.confidence === null ? null : (
                  <span className="muted">confiança {formatConfidence(item.confidence)}</span>
                )}
                {/* a justificativa é do modelo e pode ter uma palavra sem espaço: o item flex precisa poder encolher (min-w-0) para o
                    `break-word` do html quebrá-la, senão ela alarga a página em 360 px */}
                <p className="min-w-0 basis-full text-sm leading-relaxed text-body">
                  {item.rationale}
                </p>
              </li>
            );
          })}
        </ul>
      ) : null}

      {/* os descartados, recuados com a quina, como a resposta de um item do feed do Rallies */}
      {decision.dropped.length > 0 ? (
        <div className="flex gap-3 pl-1 text-sm">
          <span
            aria-hidden="true"
            className="mt-1 size-3 shrink-0 rounded-bl-sm border-b border-l border-hairline-strong"
          />
          <div className="min-w-0 space-y-1">
            <p className="font-medium text-ink">Itens descartados</p>
            <ul aria-label="Itens descartados" className="space-y-1 text-muted">
              {decision.dropped.map((drop) => (
                <li key={drop.position}>
                  Item {drop.position + 1}: {DROP_REASON[drop.reason]}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </article>
  );
}
