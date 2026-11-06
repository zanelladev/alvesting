import type { Position, Totals } from '@alvesting/contracts';
import { formatBRL, formatBRLSigned, formatBps, formatDate, formatQuantity } from '../lib/format';
import { STICKY, Th, direction } from './tables';
import { ROW, TABLE, TD, TableScroll } from './ui';

// O resumo e as posições da carteira (etapa 12, parte 2; docs/TELAS.md, seção 9): Server Components, sem JavaScript no navegador. Os números
// vêm prontos da api (`GET /api/v1/me/portfolio`, docs/API.md, seção 9), em centavos e pontos-base inteiros: aqui só se formata. O resultado
// leva o sinal (+ ou -) E a palavra (ganho, perda), porque a tela não pode depender de cor para dizer se foi ganho ou perda, e o glifo ▲ ▼ ■ da
// direção, como as posições dos modelos (`direction` e o `data-dir` de tables.tsx: o CSS o desenha antes do número, com a cor de dado só nele e
// o texto alternativo vazio, então o texto que o e2e compara não muda; o valor fica na tinta). Posição sem fechamento diz "sem cotação" e fica
// fora do valor e do resultado dos totais.

const DASH = '—';
const NO_QUOTE = 'sem cotação';

const verdict = (cents: number): string =>
  cents > 0 ? 'ganho' : cents < 0 ? 'perda' : 'sem variação';
// o percentual pode faltar mesmo com fechamento (a api o dá como nulo quando não cabe no inteiro seguro)
const percent = (bps: number | null): string => (bps === null ? 'sem percentual' : formatBps(bps));

// A posição com fechamento tem os quatro campos juntos (o contrato recusa o estado misturado); sem ele, nenhum.
function priced(p: Position) {
  if (
    p.closeCents === null ||
    p.closeDate === null ||
    p.valueCents === null ||
    p.pnlCents === null
  ) {
    return null;
  }
  return {
    closeCents: p.closeCents,
    closeDate: p.closeDate,
    valueCents: p.valueCents,
    pnlCents: p.pnlCents,
  };
}

// A coluna da carteira (o "Portfolio" do Today do Rallies; docs/redesign-rallies/plano.md, f.3): o valor estimado na Geist de 20, o resultado
// com o sinal, o percentual e a palavra, e o custo total; as posições numa lista curta (o ticker, o percentual e o último fechamento com a
// data: a mesma informação da tabela, nunca nova, e só a partir de 1024 px, onde a tabela fica ao lado; no celular a tabela vem logo abaixo) e,
// no pé, a pílula preta "Lançar compra", que leva ao formulário (no celular ele fica no fim da tela). Os três números são os pares termo/valor
// da região "Resumo", nesta ordem, que o e2e confere contra a api.
export function WalletSummary({
  totals,
  positions = [],
}: {
  totals: Totals;
  positions?: readonly Position[];
}) {
  return (
    <section id="resumo" aria-labelledby="resumo-titulo" className="min-w-0 space-y-5">
      <h2 id="resumo-titulo" className="text-15 font-medium text-ink">
        Resumo
      </h2>
      <dl className="space-y-3">
        <div>
          <dt className="text-13 text-muted">Valor estimado</dt>
          <dd className="font-display text-20 font-semibold text-ink tabular-nums">
            {totals.valueCents === null ? NO_QUOTE : formatBRL(totals.valueCents)}
          </dd>
        </div>
        <div>
          <dt className="text-13 text-muted">Resultado</dt>
          <dd className="text-sm text-ink tabular-nums">
            {totals.pnlCents === null ? (
              NO_QUOTE
            ) : (
              <>
                <span data-dir={direction(totals.pnlCents)}>
                  {formatBRLSigned(totals.pnlCents)}
                </span>{' '}
                <span className="text-muted">
                  {`(${percent(totals.pnlBps)}, ${verdict(totals.pnlCents)})`}
                </span>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-13 text-muted">Custo total</dt>
          <dd className="text-sm text-ink tabular-nums">{formatBRL(totals.costCents)}</dd>
        </div>
      </dl>
      {totals.unpriced > 0 ? (
        <p className="muted">
          {totals.unpriced === 1
            ? '1 posição está sem cotação: fica fora do valor estimado e do resultado, mas o custo dela está no custo total.'
            : `${totals.unpriced} posições estão sem cotação: ficam fora do valor estimado e do resultado, mas o custo delas está no custo total.`}
        </p>
      ) : null}
      {positions.length > 0 ? (
        <div className="hidden lg:block">
          <h3 className="pb-1 text-13 font-medium text-muted">Por ação</h3>
          <ul className="divide-y divide-hairline border-y border-hairline">
            {positions.map((p) => {
              const close = priced(p);
              return (
                <li key={p.ticker} className="flex items-baseline justify-between gap-3 py-2.5">
                  <span className="font-mono text-sm font-semibold text-ink">{p.ticker}</span>
                  {close ? (
                    <span className="min-w-0 text-right">
                      <span
                        data-dir={direction(close.pnlCents)}
                        className="block text-sm text-ink tabular-nums"
                      >
                        {percent(p.pnlBps)}
                      </span>
                      <span className="block text-xs text-muted">
                        {`${formatBRL(close.closeCents)} em ${formatDate(close.closeDate)}`}
                      </span>
                    </span>
                  ) : (
                    <span className="text-xs text-muted">{NO_QUOTE}</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <a href="#lancar" className="btn btn-primary">
        Lançar compra
      </a>
    </section>
  );
}

// A mesma coluna com a carteira vazia: sem números (não há o que somar) e sem a região "Resumo"; a frase e a pílula que leva ao formulário.
export const WalletEmpty = () => (
  <div className="min-w-0 space-y-4">
    <p className="font-display text-20 font-semibold text-ink">Nenhuma compra ainda</p>
    <p className="muted">
      Lance a primeira e aqui aparecem o valor estimado, o resultado e o custo total da carteira.
    </p>
    <a href="#lancar" className="btn btn-primary">
      Lançar compra
    </a>
  </div>
);

// Uma linha por ticker. As colunas que mais dizem vêm primeiro (ação, valor e resultado), para caberem em 360 px sem rolar; o resto fica à
// direita, na rolagem da própria caixa (docs/TELAS.md, seção 3). O fechamento leva a data DELE: um papel parado tem data mais antiga que os outros.
export function WalletPositions({ positions }: { positions: readonly Position[] }) {
  return (
    <TableScroll label="Posições da carteira, por ticker">
      <table className={TABLE}>
        <caption className="sr-only">Posições da carteira, por ticker</caption>
        <thead>
          <tr>
            <Th>Ação</Th>
            <Th>Valor</Th>
            <Th>Resultado</Th>
            <Th>Quantidade</Th>
            <Th>Preço médio</Th>
            <Th>Fechamento</Th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const close = priced(p);
            return (
              <tr key={p.ticker} className={ROW}>
                <th scope="row" className={`${STICKY} font-mono`}>
                  {p.ticker}
                </th>
                <td className={TD}>{close ? formatBRL(close.valueCents) : NO_QUOTE}</td>
                <td className={TD} data-dir={close ? direction(close.pnlCents) : undefined}>
                  {close ? (
                    <>
                      {formatBRLSigned(close.pnlCents)}{' '}
                      <span className="block font-sans text-xs text-muted">
                        {`${percent(p.pnlBps)} · ${verdict(close.pnlCents)}`}
                      </span>
                    </>
                  ) : (
                    DASH
                  )}
                </td>
                <td className={TD}>{formatQuantity(p.quantity)}</td>
                <td className={TD}>{formatBRL(p.avgPriceCents)}</td>
                <td className={TD}>
                  {close ? (
                    <>
                      {formatBRL(close.closeCents)}{' '}
                      <span className="block font-sans text-xs text-muted">
                        {`em ${formatDate(close.closeDate)}`}
                      </span>
                    </>
                  ) : (
                    DASH
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableScroll>
  );
}
