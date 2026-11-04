import type { Position, Totals } from '@alvesting/contracts';
import { formatBRL, formatBRLSigned, formatBps, formatDate, formatQuantity } from '../lib/format';
import { STICKY, Th } from './tables';
import { Fact, Facts, ROW, TABLE, TD, TableScroll } from './ui';

// O resumo e as posições da carteira (etapa 12, parte 2; docs/TELAS.md, seção 9): Server Components, sem JavaScript no navegador. Os números
// vêm prontos da api (`GET /api/v1/me/portfolio`, docs/API.md, seção 9), em centavos e pontos-base inteiros: aqui só se formata. O resultado
// leva o sinal (+ ou -) E a palavra (ganho, perda), porque a tela não pode depender de cor para dizer se foi ganho ou perda (e a estética daqui é
// preto sobre papel). Posição sem fechamento diz "sem cotação" e fica fora do valor e do resultado dos totais.

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

export function WalletSummary({ totals }: { totals: Totals }) {
  return (
    <>
      <Facts>
        <Fact term="Custo total">{formatBRL(totals.costCents)}</Fact>
        <Fact term="Valor estimado">
          {totals.valueCents === null ? NO_QUOTE : formatBRL(totals.valueCents)}
        </Fact>
        <Fact term="Resultado">
          {totals.pnlCents === null
            ? NO_QUOTE
            : `${formatBRLSigned(totals.pnlCents)} (${percent(totals.pnlBps)}, ${verdict(totals.pnlCents)})`}
        </Fact>
      </Facts>
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
                <td className={TD}>
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
