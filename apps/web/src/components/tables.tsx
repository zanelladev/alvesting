import type { LeaderboardRow, PublicCompetitor } from '@alvesting/contracts';
import {
  formatBRL,
  formatBRLSigned,
  formatBps,
  formatPercentile,
  formatQuantity,
  formatUsdMicro,
} from '../lib/format';
import { Sparkline } from './beui/sparkline';
import { Competidor } from './competidor';
import { LogoDoPapel } from './logo-do-papel';
import {
  LINK,
  NavLink,
  NotaSimulada,
  ROW,
  SimulatedTag,
  TABLE,
  TD,
  TH,
  TableScroll,
  direction,
} from './ui';
import { serieDe } from '../lib/chart';

// As tabelas da arena. Densas e legíveis: números tabulares, uma linha por competidor ou posição, com o nome como cabeçalho da linha (o
// leitor de tela lê "CDI, retorno..."), o logo do laboratório ao lado do nome (competidor.tsx; decorativo) e preso à esquerda quando a
// tabela rola dentro da própria caixa (ui.tsx, TableScroll). As colunas que mais dizem vêm primeiro, para caberem em 360 px sem rolar: o
// resto está à direita. Valor que não existe (percentil antes do Monte Carlo, acerto sem venda) é "—". A linha acende no hover em 150 ms
// (globals.css, `.row`), a célula presa junto. A Regra do Glifo (docs/DESIGN.md): o ▲ ▼ ■ só no número principal da linha.

const DASH = '—';
const NAME = `${LINK} font-sans`;
// (a direção mora em ui.tsx, de onde o componente do competidor também a lê; as telas a importam daqui)
export { direction };
// o nome e o ticker numa linha só, em toda largura: a tabela rola dentro da caixa dela (com a pista de que há mais, ui.tsx, TableScroll), e
// o nome é o curto (o das referências também), então as linhas têm a mesma altura (o QA do fechamento, achado 17: no celular os nomes
// quebravam em duas e três linhas). (A tabela de posições da carteira, wallet-panels.tsx, usa o cabeçalho de coluna e a célula presa à
// esquerda daqui.) O fundo é o da caixa em que a tabela está. O nome e o ticker em 14/600, como os do Rallies (plano do redesenho, e.2 e e.6).
const PRESA = 'celula-presa py-1 text-left text-sm font-semibold whitespace-nowrap text-ink';
export const STICKY = `${PRESA} px-2`;
// a célula do competidor: o logo fica fora do fluxo do texto, no respiro da esquerda (globals.css, `.celula-competidor`)
const STICKY_COMPETIDOR = `${PRESA} celula-competidor pr-2 pl-10`;
// A tabela compacta (a landing, o "Sorte ou habilidade?") cabe no celular sem rolar, com o Percentil à vista (o QA do fechamento, achado 4: em
// 390 px ele ficava escondido à direita, e o painel é sobre ele): o respiro das células é de 4 px, e o nome curto, em 13 px, pode quebrar ao lado
// do logo, que fica fora do fluxo do texto (como no ranking: no celular ele nunca fica sozinho numa linha acima do nome).
const COMPACTA = 'px-1';
const NOME_COMPACTO =
  'celula-competidor relative px-1 py-1 pl-10 text-left text-13 font-semibold text-ink';

// As larguras das colunas do ranking completo, as mesmas nas três tabelas (os modelos, o Sorteio e as referências: `table-layout: fixed`), para
// a coluna de uma ficar embaixo da mesma coluna da outra (o QA do fechamento, achado 4: elas tinham 1.045, 1.022 e 1.103 px). Medidas no conteúdo
// de cada coluna em 1440 px (o cabeçalho de 11 px e o número de 13 px, com os 8 px de cada lado) e no nome curto mais longo do elenco
// ("DeepSeek V4 Pro" ao lado do logo), com folga. Sem a Tendência, a coluna dela sai.
const LARGURAS = [44, 184, 88, 72, 120, 88, 104, 72, 84, 112, 84, 96] as const;
const TENDENCIA = 5;

export const Th = ({ children, className }: { children: string; className?: string }) => (
  <th scope="col" className={className ? `${TH} ${className}` : TH}>
    {children}
  </th>
);

export function LeaderboardTable({
  rows,
  label,
  compact = false,
  avisoNaPagina = false,
  tendencias,
}: {
  rows: readonly LeaderboardRow[];
  // o nome da tabela, para o leitor de tela
  label: string;
  // a home mostra posição, nome, retorno e percentil; o ranking, essas quatro e mais sete
  compact?: boolean;
  // a nota "simulado" vem uma vez, antes da tabela (docs/DESIGN.md: uma vez por contexto); a página que já avisa a tira
  avisoNaPagina?: boolean;
  // o patrimônio de cada pregão, por competidor (o slug): no ranking completo, a coluna "Tendência" com a sparkline de cada linha
  tendencias?: ReadonlyMap<string, readonly (number | null)[]>;
}) {
  const tendencia = !compact && tendencias !== undefined;
  return (
    <>
      {avisoNaPagina ? null : (
        <NotaSimulada competitors={rows.map((row) => row.competitor)} className="pb-3" />
      )}
      <TableScroll label={label}>
        <table className={compact ? TABLE : `${TABLE} table-fixed`}>
          <caption className="sr-only">{label}</caption>
          {compact ? null : (
            <colgroup>
              {LARGURAS.filter((_, i) => tendencia || i !== TENDENCIA).map((width, i) => (
                <col key={i} style={{ width }} />
              ))}
            </colgroup>
          )}
          <thead>
            <tr>
              <Th className={compact ? COMPACTA : undefined}>Pos.</Th>
              <Th className={compact ? COMPACTA : undefined}>Competidor</Th>
              <Th className={compact ? COMPACTA : undefined}>Retorno</Th>
              <Th className={compact ? COMPACTA : undefined}>Percentil</Th>
              {compact ? null : (
                <>
                  <Th>Patrimônio</Th>
                  {tendencia ? <Th>Tendência</Th> : null}
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
            {rows.map((row) => {
              const serie = tendencias?.get(row.competitor.slug);
              return (
                <tr key={row.competitor.slug} className={ROW}>
                  <td className={compact ? `${TD} ${COMPACTA}` : TD}>{row.rank}</td>
                  <th scope="row" className={compact ? NOME_COMPACTO : STICKY_COMPETIDOR}>
                    <Competidor competitor={row.competitor} etiqueta={false} curto />
                  </th>
                  <td
                    className={compact ? `${TD} ${COMPACTA}` : TD}
                    data-dir={direction(row.returnBps)}
                  >
                    {formatBps(row.returnBps)}
                  </td>
                  <td className={compact ? `${TD} ${COMPACTA}` : TD}>
                    {row.percentileBps === null ? DASH : formatPercentile(row.percentileBps)}
                  </td>
                  {compact ? null : (
                    <>
                      <td className={TD}>{formatBRL(row.equityCents)}</td>
                      {tendencia ? (
                        <td className={TD}>
                          {serie ? (
                            <Sparkline
                              data={serie}
                              label={`Patrimônio de ${row.competitor.name}`}
                              cor={serieDe(row.competitor).cor}
                            />
                          ) : (
                            DASH
                          )}
                        </td>
                      ) : null}
                      <td className={TD}>
                        {row.excessEqualWeightBps === null
                          ? DASH
                          : formatBps(row.excessEqualWeightBps)}
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
              );
            })}
          </tbody>
        </table>
      </TableScroll>
    </>
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
  logos,
}: {
  rows: readonly PositionRow[];
  first: 'Ação' | 'Competidor';
  label: string;
  // a versão do logo de cada ticker (lib/logos.ts): o logo da empresa à esquerda do ticker; sem ela, o monograma
  logos?: ReadonlyMap<string, string>;
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
                      className={`${NAME} ${first === 'Ação' ? 'font-medium whitespace-nowrap' : ''}`}
                    >
                      {first === 'Ação' ? (
                        <LogoDoPapel
                          ticker={row.label}
                          versao={logos?.get(row.label)}
                          className="mr-3.5"
                        />
                      ) : null}
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
