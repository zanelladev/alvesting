import type { Position, PublicCompetitor, Totals } from '@alvesting/contracts';
import type { Comparacao, Resultado } from '../lib/comparacao';
import { formatBRL, formatBRLSigned, formatBps, formatDate, formatQuantity } from '../lib/format';
import { Competidor } from './competidor';
import { LogoDoPapel } from './logo-do-papel';
import { STICKY_COMPETIDOR, Th, direction } from './tables';
import { LINK, NavLink, NotaSimulada, ROW, TABLE, TD, TH, TableScroll } from './ui';
import { AlocacaoDaCarteira, Dinheiro, Termo } from './wallet-charts';
import { BotaoLancar } from './wallet-lots';

// O resumo e as posições da carteira (etapa 12, parte 2; docs/TELAS.md, seção 9): Server Components; as peças vivas (o contador, a rosca e o
// tooltip) entram como ilhas, de components/wallet-charts.tsx. Os números vêm prontos da api (`GET /api/v1/me/portfolio`, docs/API.md, seção
// 9), em centavos e pontos-base inteiros: aqui só se formata. O resultado leva o sinal (+ ou -) E a palavra (ganho, perda), porque a tela não
// pode depender de cor para dizer se foi ganho ou perda, e o glifo ▲ ▼ ■ da direção, uma vez por linha (a Regra do Glifo; `direction` e o
// `data-dir`: o CSS o desenha antes do número, com a cor de dado só nele e o texto alternativo vazio, então o texto que o e2e compara não
// muda; o valor fica na tinta). Posição sem fechamento diz "sem cotação" e fica fora do valor e do resultado dos totais. O ticker é a sans 500
// com algarismos tabulares, com o logo da ação à esquerda (o da T0b), ligado à página dela, como nas carteiras da arena.

const DASH = '—';
const NO_QUOTE = 'sem cotação';

// As explicações do tooltip (o termo com o sublinhado pontilhado). A mesma coisa está em texto na tela, para quem usa o toque: o parágrafo das
// posições e o do modal de lançar.
export const EXPLICA = {
  resultado:
    'O valor estimado menos o custo: o que as ações valem pelo último fechamento, menos o que você pagou por elas. Não conta proventos, desdobramentos, corretagem, taxas nem impostos.',
  precoMedio:
    'O custo de todos os lançamentos da ação dividido pela quantidade, arredondado no centavo.',
} as const;

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

// O ticker com o logo, ligado à página da ação (a caixa de 44 px do link; o sublinhado só no hover, como os nomes das tabelas da arena)
export const TickerComLogo = ({ ticker, versao }: { ticker: string; versao?: string }) => (
  <NavLink href={`/acoes/${ticker}`} className={`${LINK} no-underline hover:underline`}>
    <LogoDoPapel ticker={ticker} versao={versao} className="mr-2.5" />
    {ticker}
  </NavLink>
);

// A coluna da carteira (ADR 0041): o valor estimado, o resultado com o sinal, o
// percentual e a palavra, e o custo total, no contador da Arc (rola quando o número muda depois de lançar, editar ou apagar; nada na abertura);
// a alocação na rosca da beUI, com a legenda ligada; e, no pé, a pílula cinza "Lançar compra", que abre o modal de lançar (o botão é uma ilha
// de cliente, de wallet-lots.tsx). Os três números são os pares termo/valor da região "Resumo", nesta ordem, que o e2e confere contra a api.
export function WalletSummary({
  totals,
  positions = [],
  logos = {},
}: {
  totals: Totals;
  positions?: readonly Position[];
  logos?: Readonly<Record<string, string>>;
}) {
  return (
    <section id="resumo" aria-labelledby="resumo-titulo" className="min-w-0 space-y-6">
      <h2 id="resumo-titulo" className="text-15 font-medium text-ink">
        Resumo
      </h2>
      <dl className="space-y-3">
        <div>
          <dt className="text-13 text-muted">Valor estimado</dt>
          <dd className="font-display text-20 font-semibold text-ink tabular-nums">
            {totals.valueCents === null ? NO_QUOTE : <Dinheiro cents={totals.valueCents} />}
          </dd>
        </div>
        <div>
          {/* o termo tem a caixa de 44 px; a margem negativa a deixa ocupar só a linha do texto (o par fica na altura dos outros) */}
          <dt className="text-13 text-muted [&_.termo]:-my-3.5">
            <Termo explicacao={EXPLICA.resultado}>Resultado</Termo>
          </dt>
          <dd className="text-sm text-ink tabular-nums">
            {totals.pnlCents === null ? (
              NO_QUOTE
            ) : (
              <>
                <span data-dir={direction(totals.pnlCents)}>
                  <Dinheiro cents={totals.pnlCents} sinal />
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
          <dd className="text-sm text-ink tabular-nums">
            <Dinheiro cents={totals.costCents} />
          </dd>
        </div>
      </dl>
      {totals.unpriced > 0 ? (
        <p className="muted">
          {totals.unpriced === 1
            ? '1 posição está sem cotação: fica fora do valor estimado e do resultado, mas o custo dela está no custo total.'
            : `${totals.unpriced} posições estão sem cotação: ficam fora do valor estimado e do resultado, mas o custo delas está no custo total.`}
        </p>
      ) : null}
      <AlocacaoDaCarteira positions={positions} logos={logos} />
      {/* a pílula cinza: a primária é o "Lançar compra" do cabeçalho dos lançamentos, a ação principal da tela (o QA do fechamento, achado 9:
          eram duas pílulas primárias com o mesmo texto) */}
      <BotaoLancar />
    </section>
  );
}

// A mesma coluna com a carteira vazia: sem números (não há o que somar) e sem a região "Resumo"; a frase e a pílula que abre o modal de lançar.
export const WalletEmpty = () => (
  <div className="min-w-0 space-y-4">
    <p className="font-display text-20 font-semibold text-ink">Nenhuma compra ainda</p>
    <p className="muted max-w-prose">
      Lance a primeira e aqui aparecem o valor estimado, o resultado, o custo total e a alocação da
      carteira.
    </p>
    <BotaoLancar />
  </div>
);

// o cabeçalho de coluna que é um termo com explicação: a caixa de 44 px do termo dá a altura da linha do cabeçalho
const ThTermo = ({ children, explicacao }: { children: string; explicacao: string }) => (
  <th scope="col" className={`${TH} py-0`}>
    <Termo explicacao={explicacao}>{children}</Termo>
  </th>
);

// Uma linha por ticker. As colunas que mais dizem vêm primeiro (ação, valor e resultado), para caberem em 360 px sem rolar; o resto fica à
// direita, na rolagem da própria caixa (docs/TELAS.md, seção 3). O fechamento leva a data DELE: um papel parado tem data mais antiga que os outros.
export function WalletPositions({
  positions,
  logos = {},
}: {
  positions: readonly Position[];
  logos?: Readonly<Record<string, string>>;
}) {
  return (
    <TableScroll label="Posições da carteira, por ticker">
      {/* as células a 6 px de cada lado (as das outras tabelas têm 8): com o logo ao lado do ticker, as seis colunas cabem inteiras no painel do
          meio em 1440 px (carteira-layout.spec.ts) */}
      <table className={`${TABLE} [&_:is(td,th)]:px-1.5`}>
        <caption className="sr-only">Posições da carteira, por ticker</caption>
        <thead>
          <tr>
            <Th>Ação</Th>
            <Th>Valor</Th>
            <ThTermo explicacao={EXPLICA.resultado}>Resultado</ThTermo>
            <Th>Quantidade</Th>
            <ThTermo explicacao={EXPLICA.precoMedio}>Preço médio</ThTermo>
            <Th>Fechamento</Th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p) => {
            const close = priced(p);
            return (
              <tr key={p.ticker} className={ROW}>
                <th
                  scope="row"
                  className="celula-presa px-2 py-1 text-left text-sm font-medium text-ink"
                >
                  <TickerComLogo ticker={p.ticker} versao={logos[p.ticker]} />
                </th>
                <td className={TD}>{close ? formatBRL(close.valueCents) : NO_QUOTE}</td>
                <td className={TD} data-dir={close ? direction(close.pnlCents) : undefined}>
                  {close ? (
                    <>
                      {formatBRLSigned(close.pnlCents)}{' '}
                      <span className="block text-xs text-muted">
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
                      <span className="block text-xs text-muted">
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

// O que a página lê para a comparação (app/(app)/(carteira)/carteira/page.tsx): a conta pronta, a temporada ainda sem pregão liquidado, ou a
// leitura que falhou.
export type LeituraDaComparacao = Comparacao | 'sem-pregao' | 'indisponivel';

// A comparação com a arena (o pedido do Artur em 17/11/2026; docs/TELAS.md, seção 9; a conta em lib/comparacao.ts): o mesmo dinheiro de cada
// compra com data, nas mesmas datas, em cada competidor, numa tabela do maior valor no último pregão liquidado para o menor, com a carteira da
// pessoa entre eles. O resultado leva o sinal, a palavra e o glifo, como nas posições. Quem fica de fora é contado, pelo motivo. A leitura que
// falha deixa só esta parte "indisponível agora".
export function WalletComparison({ comparacao }: { comparacao: LeituraDaComparacao }) {
  if (comparacao === 'indisponivel') {
    return <p className="muted max-w-prose">A comparação com a arena está indisponível agora.</p>;
  }
  if (comparacao === 'sem-pregao') {
    return (
      <p className="muted max-w-prose">
        A comparação começa depois do primeiro pregão liquidado da temporada.
      </p>
    );
  }
  const { inicio, ate, compras, investidoCents, fora, voce, competidores } = comparacao;
  const motivos = [
    fora.semData ? `${fora.semData} sem data` : null,
    fora.antes ? `${fora.antes} antes de ${formatDate(inicio)}, o começo da temporada` : null,
    fora.depois ? `${fora.depois} depois de ${formatDate(ate)}, o último pregão liquidado` : null,
    fora.semCotacao ? `${fora.semCotacao} sem cotação em ${formatDate(ate)}` : null,
  ].filter((motivo) => motivo !== null);
  const deFora = motivos.length > 0 ? ` Ficam de fora: ${motivos.join('; ')}.` : '';
  if (voce === null) {
    return (
      <p className="muted max-w-prose">
        {`Nenhuma compra entra na comparação.${deFora} Para entrar, a compra precisa ter a data, de ${formatDate(inicio)} a ${formatDate(ate)}.`}
      </p>
    );
  }
  // a carteira da pessoa entre os competidores, do maior valor para o menor (no empate, ela primeiro)
  const linhas: Array<Resultado & { competitor: PublicCompetitor | null }> = [
    { competitor: null, ...voce },
    ...competidores,
  ].sort((a, b) => b.valorCents - a.valorCents);
  const label = `Comparação com a arena, no fechamento de ${formatDate(ate)}`;
  return (
    <>
      <p className="muted max-w-prose">
        {`Quanto valeria no fechamento de ${formatDate(ate)}, o último pregão liquidado, o mesmo dinheiro de cada compra posto em cada competidor da arena no dia dela. O competidor recebe o dinheiro antes da abertura daquele dia; a sua conta usa o preço que você pagou e o fechamento de cada ação, sem proventos, corretagem nem taxas.`}
      </p>
      <p className="mt-2 max-w-prose">
        {`${compras === 1 ? 'Entra 1 compra' : `Entram ${compras} compras`}, ${formatBRL(investidoCents)} no total.${deFora}`}
      </p>
      <NotaSimulada competitors={competidores.map((c) => c.competitor)} className="pt-4" />
      <div className="mt-4">
        <TableScroll label={label}>
          <table className={TABLE}>
            <caption className="sr-only">{label}</caption>
            <thead>
              <tr>
                <Th>Carteira</Th>
                <Th>Resultado</Th>
                <Th>Valor</Th>
              </tr>
            </thead>
            <tbody>
              {linhas.map((linha) => (
                <tr key={linha.competitor?.slug ?? 'voce'} className={ROW}>
                  <th scope="row" className={STICKY_COMPETIDOR}>
                    {linha.competitor ? (
                      <Competidor competitor={linha.competitor} etiqueta={false} curto />
                    ) : (
                      'Sua carteira'
                    )}
                  </th>
                  <td className={TD} data-dir={direction(linha.resultadoCents)}>
                    {formatBRLSigned(linha.resultadoCents)}{' '}
                    <span className="block text-xs text-muted">
                      {`${formatBps(linha.rendimentoBps)} · ${verdict(linha.resultadoCents)}`}
                    </span>
                  </td>
                  <td className={TD}>{formatBRL(linha.valorCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </div>
    </>
  );
}
