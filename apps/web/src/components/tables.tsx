import type { LeaderboardRow, PublicCompetitor } from '@alvesting/contracts';
import {
  formatBRL,
  formatBRLSigned,
  formatBps,
  formatPercentile,
  formatQuantity,
  formatUsdMicro,
} from '../lib/format';
import { Competidor } from './competidor';
import { LINK, NavLink, ROW, SimulatedTag, TABLE, TD, TH, TableScroll, direction } from './ui';

// As tabelas da arena. Densas e legíveis: números tabulares, uma linha por competidor ou posição, com o nome como cabeçalho da linha (o
// leitor de tela lê "CDI, retorno...", e "Gemini 4 Argon simulado, retorno..." com a etiqueta da arena simulada), o logo do laboratório ao
// lado do nome (competidor.tsx; decorativo) e preso à esquerda quando a tabela rola dentro da própria caixa (ui.tsx, TableScroll). As colunas que mais dizem vêm primeiro, para
// caberem em 360 px sem rolar: o resto está à direita. Valor que não existe (percentil antes do Monte Carlo, acerto sem venda) é "—".

const DASH = '—';
const NAME = `${LINK} font-sans`;
// (a direção mora em ui.tsx, de onde o componente do competidor também a lê; as telas a importam daqui)
export { direction };
// o nome nunca quebra no meio de uma palavra, nem o ticker em dois; só nos espaços, e só abaixo de 1024 px (para caber em 360 px): na tela
// larga, o nome e a etiqueta "simulado" ficam numa linha, e a linha do nome comprido tem a altura das outras. (A tabela de posições da
// carteira, wallet-panels.tsx, usa o cabeçalho de coluna e a célula presa à esquerda daqui.) O fundo é o da caixa em que a tabela está. O
// nome e o ticker em 14/600, como os do Rallies (plano do redesenho, e.2 e e.6).
const PRESA =
  'sticky left-0 bg-canvas py-1 text-left text-sm font-semibold text-ink lg:whitespace-nowrap';
export const STICKY = `${PRESA} px-2`;
// a célula do competidor: o logo fica fora do fluxo do texto, no respiro da esquerda (globals.css, `.celula-competidor`), e a célula tem
// pelo menos 160 px (o nome curto cabe numa linha no celular, com a etiqueta embaixo)
const STICKY_COMPETIDOR = `${PRESA} celula-competidor min-w-40 pr-2 pl-10`;

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
              <th scope="row" className={STICKY_COMPETIDOR}>
                <Competidor competitor={row.competitor} />
              </th>
              <td className={TD} data-dir={direction(row.returnBps)}>
                {formatBps(row.returnBps)}
              </td>
              <td className={TD}>
                {row.percentileBps === null ? DASH : formatPercentile(row.percentileBps)}
              </td>
              {compact ? null : (
                <>
                  <td className={TD}>{formatBRL(row.equityCents)}</td>
                  <td
                    className={TD}
                    data-dir={
                      row.excessEqualWeightBps === null
                        ? undefined
                        : direction(row.excessEqualWeightBps)
                    }
                  >
                    {row.excessEqualWeightBps === null ? DASH : formatBps(row.excessEqualWeightBps)}
                  </td>
                  <td
                    className={TD}
                    data-dir={row.excessCdiBps === null ? undefined : direction(row.excessCdiBps)}
                  >
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
  // quem tem a ação é um modelo da arena simulada (ui.tsx, SimulatedTag)
  simulated?: boolean;
  // na tabela de quem tem a ação: o competidor, que leva o logo, o link e a etiqueta (competidor.tsx)
  competitor?: PublicCompetitor;
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
              <th scope="row" className={row.competitor ? STICKY_COMPETIDOR : STICKY}>
                {row.competitor ? (
                  <Competidor competitor={row.competitor} />
                ) : (
                  <>
                    <NavLink
                      href={row.href}
                      className={`${NAME} ${first === 'Ação' ? 'font-mono whitespace-nowrap' : ''}`}
                    >
                      {row.label}
                    </NavLink>
                    {row.simulated ? <SimulatedTag /> : null}
                  </>
                )}
              </th>
              <td className={TD}>
                {formatBRL(row.valueCents)}
                {row.stale ? (
                  <span className="block font-sans text-xs text-muted">sem negócio no dia</span>
                ) : null}
              </td>
              <td className={TD} data-dir={direction(row.pnlCents)}>
                {formatBRLSigned(row.pnlCents)}
              </td>
              <td className={TD}>{formatQuantity(row.quantity)}</td>
              <td className={TD}>{formatBRL(row.avgPriceCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}
