import type { Position, Totals } from '@alvesting/contracts';
import { formatBRL, formatBRLSigned, formatBps, formatDate, formatQuantity } from '../lib/format';
import { STICKY, Th, direction } from './tables';
import { ROW, StripItem, TABLE, TD, TableScroll } from './ui';

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

// O resumo é a faixa de números da home (a `stats-band` do Arc): as três células divididas por um fio, numa caixa de borda; uma embaixo da outra
// no celular, lado a lado a partir de 768 px. O percentual e a palavra vão embaixo do resultado, menores, como a data na faixa da home.
export function WalletSummary({ totals }: { totals: Totals }) {
  return (
    <>
      <div className="overflow-hidden rounded-panel border border-hairline">
        <dl className="grid gap-px bg-hairline md:grid-cols-3">
          <StripItem term="Custo total">{formatBRL(totals.costCents)}</StripItem>
          <StripItem term="Valor estimado">
            {totals.valueCents === null ? NO_QUOTE : formatBRL(totals.valueCents)}
          </StripItem>
          <StripItem term="Resultado">
            {totals.pnlCents === null ? (
              NO_QUOTE
            ) : (
              <>
                <span data-dir={direction(totals.pnlCents)}>
                  {formatBRLSigned(totals.pnlCents)}
                </span>{' '}
                <span className="block font-sans text-xs font-normal text-muted">
                  {`(${percent(totals.pnlBps)}, ${verdict(totals.pnlCents)})`}
                </span>
              </>
            )}
          </StripItem>
        </dl>
      </div>
      {totals.unpriced > 0 ? (
        <p className="muted max-w-prose">
          {totals.unpriced === 1
            ? '1 posição está sem cotação: fica fora do valor estimado e do resultado, mas o custo dela está no custo total.'
            : `${totals.unpriced} posições estão sem cotação: ficam fora do valor estimado e do resultado, mas o custo delas está no custo total.`}
        </p>
      ) : null}
    </>
  );
}

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
