import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Portfolio } from '@alvesting/contracts';
import { Avisos } from '../../../../components/avisos';
import { PainelPerguntar } from '../../../../components/chat/chat-desligado';
import { WalletLots, type LotView } from '../../../../components/wallet-lots';
import {
  WalletComparison,
  WalletEmpty,
  WalletPositions,
  WalletSummary,
  type LeituraDaComparacao,
} from '../../../../components/wallet-panels';
import { Abas, Aviso, PageHead, Section } from '../../../../components/ui';
import { authCookieHeader } from '../../../../lib/account';
import { ApiError, api } from '../../../../lib/api';
import { compararCarteira, fechamentoAte, noPeriodo } from '../../../../lib/comparacao';
import { versoesDosLogos } from '../../../../lib/logos';
import { readBars } from '../../../../lib/quotes';
import { readPortfolio } from '../../../../lib/wallet';
import { withApiDown } from '../../../../lib/with-api-down';

// A carteira do usuário (plano §3, §9 e §11; etapa 12, parte 2; docs/TELAS.md, seção 9): o resumo, as posições por ticker (preço médio, último
// fechamento com a data, valor e resultado) e os lançamentos, com o formulário que lança, edita e apaga. É dado de uma pessoa e é dinheiro: lê
// `GET /api/v1/me/portfolio` no servidor com o cookie da requisição (só o da sessão vai à api), sem o cache de dados do Next (apiGetFresh). Ler o
// cookie torna a página dinâmica, e o Next a responde com `Cache-Control: private, no-store`; ela não é indexada.
//  - Sem sessão (sem cookie, ou com a que a api não reconhece), vai para a entrada, com o caminho de volta. Sem cookie a página nem chama a api.
//  - Com o aceite dos termos vencido a api responde 403 CONSENT_REQUIRED: vai para a conta, que mostra o texto novo e o pedido de aceite (a
//    política de privacidade, item 9, promete isso). A página não repete a leitura de `/me` para saber: a api é quem decide, e dá o motivo.
// As páginas públicas continuam sem ler a sessão: o cabeçalho tem só o link fixo "Carteira", o mesmo com ou sem login.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Minha carteira',
  robots: { index: false, follow: false },
};

const SIGN_IN = `/entrar?proximo=${encodeURIComponent('/carteira')}`;

// Ao navegador vai só o que a tela usa de cada lançamento (até 200): os instantes de criação e de edição ficam no servidor.
const lotView = ({
  id,
  ticker,
  quantity,
  costCents,
  boughtOn,
}: Portfolio['lots'][number]): LotView => ({
  id,
  ticker,
  quantity,
  costCents,
  boughtOn,
});

// A comparação com a arena (docs/TELAS.md, seção 9; lib/comparacao.ts): a temporada atual e a série do patrimônio (as leituras públicas, pelo
// cache de dados do site) e o fechamento, no último pregão liquidado, de cada ação comprada no período (a rota interna das barras, só do
// servidor; a tela mostra só o valor e o resultado, nunca o fechamento). A leitura que falha deixa só a comparação "indisponível agora", e a
// falha vai para o log; sem pregão liquidado ainda não há com que comparar.
async function lerComparacao(lots: Portfolio['lots']): Promise<LeituraDaComparacao> {
  try {
    const { season } = await api.arenaCurrent();
    if (!season?.settledThrough) return 'sem-pregao';
    const equity = await api.equity(season.slug);
    if (equity.dates.length === 0) return 'sem-pregao';
    const ate = equity.dates.at(-1)!;
    const tickers = new Set(
      lots.filter((lot) => noPeriodo(lot.boughtOn, equity.dates)).map((lot) => lot.ticker),
    );
    const closes = new Map<string, number>();
    await Promise.all(
      [...tickers].map(async (ticker) => {
        const close = fechamentoAte(await readBars(ticker), ate);
        if (close !== null) closes.set(ticker, close);
      }),
    );
    return compararCarteira({
      lots,
      dates: equity.dates,
      modes: equity.modes,
      capitalCents: equity.season.params.capitalCents,
      series: equity.series,
      closes,
    });
  } catch (error) {
    console.error('[web] comparação da carteira indisponível:', error);
    return 'indisponivel';
  }
}

export default withApiDown(async function WalletPage() {
  const cookie = authCookieHeader((await headers()).get('cookie'));
  if (!cookie) redirect(SIGN_IN);

  // o índice dos logos das ações (lib/logos.ts) sai junto com a carteira; a leitura que falha é o mapa vazio (só monogramas), nunca um erro
  const allLogos = versoesDosLogos();
  let wallet: Portfolio;
  try {
    wallet = await readPortfolio(cookie);
  } catch (error) {
    // a sessão acabou (vencida, adulterada, usuário apagado), ou o aceite venceu; qualquer outro erro vira "a arena não respondeu"
    if (error instanceof ApiError && error.status === 401) redirect(SIGN_IN);
    if (error instanceof ApiError && error.status === 403 && error.code === 'CONSENT_REQUIRED') {
      redirect('/conta');
    }
    throw error;
  }

  // o dia de hoje em Brasília, para o seletor de data (o servidor pode estar em UTC); quem confere a data de verdade é a api
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
    new Date(),
  );

  const hasLots = wallet.lots.length > 0;
  // ao navegador vai só a versão do logo dos tickers desta carteira (o componente de cliente dos lançamentos e a legenda da rosca a recebem);
  // a comparação é lida junto
  const [versions, comparacao] = await Promise.all([
    allLogos,
    hasLots ? lerComparacao(wallet.lots) : null,
  ]);
  const logos = Object.fromEntries(
    [...new Set([...wallet.positions, ...wallet.lots].map((item) => item.ticker))].flatMap(
      (ticker) => {
        const version = versions.get(ticker);
        return version ? [[ticker, version] as const] : [];
      },
    ),
  );

  return (
    <Avisos foco="#lancamentos-titulo">
      <PageHead title="Minha carteira">
        <p className="max-w-prose text-15 text-pretty">
          As ações que você comprou, anotadas por você. A Alvesting calcula o preço médio, o valor
          estimado e o ganho ou a perda. Ela não compra nem vende nada, não fala com a sua corretora
          e não confere os lançamentos: valem os números que você digita.
        </p>
        <noscript>
          <p className="max-w-prose text-body">
            Lançar, editar e apagar compras precisam de JavaScript. Ative o JavaScript no navegador
            e recarregue a página.
          </p>
        </noscript>
      </PageHead>

      {/* O layout da carteira em dois painéis (ADR 0041): a coluna da carteira, de 360 px, e o meio com as posições, a comparação e os
          lançamentos, com o painel "Perguntar" (o chat desligado) embaixo dele. Na coluna de 1.040 px do app, um terceiro painel de 360 px
          deixaria o meio com 320 px, e a tabela de posições não caberia: em 1440 px o meio tem 632 px de conteúdo, e ela cabe inteira. A
          partir de 1024 px a grade come o respiro da coluna (-mx-6), cada painel tem o seu, e o fio embaixo do cabeçalho vai de uma borda à
          outra da coluna, com o fio entre os painéis descendo dele. No celular, uma coluna só, nesta ordem. */}
      <div className="grid gap-y-10 lg:-mx-6 lg:grid-cols-[22.5rem_minmax(0,1fr)] lg:border-t lg:border-hairline">
        <div className="min-w-0 lg:border-r lg:border-hairline lg:px-6 lg:pt-6">
          {hasLots ? (
            <WalletSummary totals={wallet.totals} positions={wallet.positions} logos={logos} />
          ) : (
            <WalletEmpty />
          )}
        </div>

        <div className="min-w-0 lg:px-6 lg:pt-6">
          {hasLots ? (
            <Abas
              label="Seções da carteira"
              items={[
                { label: 'Posições', href: '#posicoes' },
                { label: 'Comparação', href: '#comparacao' },
                { label: 'Lançamentos', href: '#lancamentos' },
              ]}
            />
          ) : null}
          {/* o aviso da carteira: [!] em cinza (não há cor de aviso no sistema visual) */}
          <Aviso className={hasLots ? 'mt-4' : undefined}>
            Valores estimados pelo último fechamento disponível; não é recomendação de investimento.
          </Aviso>
          {hasLots ? (
            <Section id="posicoes" title="Posições">
              <p className="muted max-w-prose">
                O fechamento é o da última barra de cada ação, com a data dele: o valor e o
                resultado são estimados e podem estar atrasados. Não consideram proventos,
                desdobramentos, corretagem, taxas nem impostos. Cotações: brapi.dev.
              </p>
              <WalletPositions positions={wallet.positions} logos={logos} />
            </Section>
          ) : null}
          {comparacao ? (
            <Section id="comparacao" title="Comparação com a arena">
              <WalletComparison comparacao={comparacao} />
            </Section>
          ) : null}
          <WalletLots lots={wallet.lots.map(lotView)} today={today} logos={logos} />
        </div>

        <div className="min-w-0 lg:col-start-2 lg:px-6">
          <PainelPerguntar />
        </div>
      </div>
    </Avisos>
  );
});
