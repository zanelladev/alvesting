import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Portfolio } from '@alvesting/contracts';
import { Avisos } from '../../../../components/avisos';
import { PainelPerguntar } from '../../../../components/chat/chat-desligado';
import { WalletLots, type LotView } from '../../../../components/wallet-lots';
import { WalletEmpty, WalletPositions, WalletSummary } from '../../../../components/wallet-panels';
import { Abas, Aviso, PageHead, Section } from '../../../../components/ui';
import { authCookieHeader } from '../../../../lib/account';
import { ApiError } from '../../../../lib/api';
import { versoesDosLogos } from '../../../../lib/logos';
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

  // ao navegador vai só a versão do logo dos tickers desta carteira (o componente de cliente dos lançamentos e a legenda da rosca a recebem)
  const versions = await allLogos;
  const logos = Object.fromEntries(
    [...new Set([...wallet.positions, ...wallet.lots].map((item) => item.ticker))].flatMap(
      (ticker) => {
        const version = versions.get(ticker);
        return version ? [[ticker, version] as const] : [];
      },
    ),
  );

  const hasLots = wallet.lots.length > 0;
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

      {/* O layout do Today do Rallies (docs/redesign-rallies/plano.md, f.3): a coluna da carteira, o meio com as posições e os lançamentos, e
          o painel "Perguntar" (o chat desligado), que a partir de 1280 px é a terceira coluna e abaixo disso um cartão no fim da tela. A partir
          de 1024 px as colunas são painéis de 360 px separados por fio, como as barras do Rallies: a grade come o respiro do `main` da casca
          (-mx-6) e cada painel tem o seu. Em 1440 px o meio tem 592 px de conteúdo, e a tabela de posições cabe inteira. No celular, uma
          coluna só, nesta ordem. A partir de 1024 px o fio embaixo do cabeçalho vai de uma borda à outra do principal, e os fios entre os
          painéis descem dele (o Today do Rallies, no recorte da landing deles). */}
      <div className="grid gap-y-10 lg:-mx-6 lg:grid-cols-[22.5rem_minmax(0,1fr)] lg:border-t lg:border-hairline xl:grid-cols-[22.5rem_minmax(0,1fr)_22.5rem]">
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
          <WalletLots lots={wallet.lots.map(lotView)} today={today} logos={logos} />
        </div>

        <div className="min-w-0 lg:col-start-2 lg:px-6 xl:col-start-3 xl:row-start-1 xl:border-l xl:border-hairline xl:pt-6">
          <PainelPerguntar />
        </div>
      </div>
    </Avisos>
  );
});
