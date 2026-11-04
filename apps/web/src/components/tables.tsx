import type { LeaderboardRow } from '@alvesting/contracts';
import {
  formatBRL,
  formatBRLSigned,
  formatBps,
  formatPercentile,
  formatQuantity,
  formatUsdMicro,
} from '../lib/format';
import { LINK, NavLink, ROW, TABLE, TD, TH, TableScroll } from './ui';

// As tabelas da arena. Densas e legíveis: números em fonte mono e tabulares, uma linha por competidor ou posição, com o nome como
// cabeçalho da linha (o leitor de tela lê "Fake Hold, retorno...") e preso à esquerda quando a tabela rola dentro da própria caixa
// (ui.tsx, TableScroll). As colunas que mais dizem vêm primeiro, para caberem em 360 px sem rolar: o resto está à direita. Valor que
// não existe (percentil antes do Monte Carlo, acerto sem venda) é "—".

const DASH = '—';
const NAME = `${LINK} font-sans`;
// o nome nunca quebra no meio de uma palavra, nem o ticker em dois; só nos espaços. (A tabela de posições da carteira, wallet-panels.tsx, usa
// o cabeçalho de coluna e a célula presa à esquerda daqui.)
export const STICKY = 'sticky left-0 min-w-28 bg-paper px-1.5 py-1 text-left font-normal sm:px-2';

export const Th = ({ children }: { children: string }) => (
  <th scope="col" className={TH}>
    {children}
  </th>
);

export function LeaderboardTable({
  rows,
  label,
  compact = false,
}: {
  rows: readonly LeaderboardRow[];
  // o nome da tabela, para o leitor de tela
  label: string;
  // a home mostra posição, nome, retorno e percentil; o ranking, essas quatro e mais sete
  compact?: boolean;
}) {
  return (
    <TableScroll label={label}>
      <table className={TABLE}>
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            <Th>Pos.</Th>
            <Th>Competidor</Th>
            <Th>Retorno</Th>
            <Th>Percentil</Th>
            {compact ? null : (
              <>
                <Th>Patrimônio</Th>
                <Th>vs igual-peso</Th>
                <Th>vs CDI</Th>
                <Th>Drawdown</Th>
                <Th>Acerto</Th>
                <Th>Operações</Th>
                <Th>Custo LLM</Th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.competitor.slug} className={ROW}>
              <td className={TD}>{row.rank}</td>
              <th scope="row" className={STICKY}>
                <NavLink href={`/modelos/${row.competitor.slug}`} className={NAME}>
                  {row.competitor.name}
                </NavLink>
              </th>
              <td className={TD}>{formatBps(row.returnBps)}</td>
              <td className={TD}>
                {row.percentileBps === null ? DASH : formatPercentile(row.percentileBps)}
              </td>
              {compact ? null : (
                <>
                  <td className={TD}>{formatBRL(row.equityCents)}</td>
                  <td className={TD}>
                    {row.excessEqualWeightBps === null ? DASH : formatBps(row.excessEqualWeightBps)}
                  </td>
                  <td className={TD}>
                    {row.excessCdiBps === null ? DASH : formatBps(row.excessCdiBps)}
                  </td>
                  <td className={TD}>{formatBps(row.maxDrawdownBps, { signed: false })}</td>
                  <td className={TD}>
                    {row.winRateBps === null
                      ? DASH
                      : `${formatBps(row.winRateBps, { signed: false })} (${row.winningSells}/${row.sells})`}
                  </td>
                  <td className={TD}>{row.trades}</td>
                  <td className={TD}>{formatUsdMicro(row.llmCostMicroUsd)}</td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

export interface PositionRow {
  key: string;
  label: string;
  href: string;
  quantity: number;
  avgPriceCents: number;
  valueCents: number;
  pnlCents: number;
  // a ação não teve negócio no dia: o valor é pelo último fechamento conhecido
  stale: boolean;
}

// A carteira de um modelo (primeira coluna: a ação) ou quem tem uma ação (primeira coluna: o competidor). O fechamento de cada ação não
// aparece na tabela: só o valor da posição, o resultado e o preço médio pago, registros da arena (docs/API.md, seção 6).
export function PositionsTable({
  rows,
  first,
  label,
}: {
  rows: readonly PositionRow[];
  first: 'Ação' | 'Competidor';
  label: string;
}) {
  return (
    <TableScroll label={label}>
      <table className={TABLE}>
        <caption className="sr-only">{label}</caption>
        <thead>
          <tr>
            <Th>{first}</Th>
            <Th>Valor</Th>
            <Th>Resultado</Th>
            <Th>Quantidade</Th>
            <Th>Preço médio</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={ROW}>
              <th scope="row" className={STICKY}>
                <NavLink
                  href={row.href}
                  className={`${NAME} ${first === 'Ação' ? 'font-mono whitespace-nowrap' : ''}`}
                >
                  {row.label}
                </NavLink>
              </th>
              <td className={TD}>
                {formatBRL(row.valueCents)}
                {row.stale ? (
                  <span className="block font-sans text-xs text-muted">sem negócio no dia</span>
                ) : null}
              </td>
              <td className={TD}>{formatBRLSigned(row.pnlCents)}</td>
              <td className={TD}>{formatQuantity(row.quantity)}</td>
              <td className={TD}>{formatBRL(row.avgPriceCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}
