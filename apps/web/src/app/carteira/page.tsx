import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Portfolio } from '@alvesting/contracts';
import { WalletLots, type LotView } from '../../components/wallet-lots';
import { WalletPositions, WalletSummary } from '../../components/wallet-panels';
import { Aviso, CAIXA, PageHead, Section } from '../../components/ui';
import { authCookieHeader } from '../../lib/account';
import { ApiError } from '../../lib/api';
import { readPortfolio } from '../../lib/wallet';
import { withApiDown } from '../../lib/with-api-down';

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

  return (
    <>
      <PageHead title="Minha carteira">
        <p className="max-w-prose text-lead text-pretty">
          As ações que você comprou, anotadas por você. A Alvesting calcula o preço médio, o valor
          estimado e o ganho ou a perda. Ela não compra nem vende nada, não fala com a sua corretora
          e não confere os lançamentos: valem os números que você digita.
        </p>
        <noscript>
          <p className={`max-w-prose ${CAIXA}`}>
            Lançar, editar e apagar compras precisam de JavaScript. Ative o JavaScript no navegador
            e recarregue a página.
          </p>
        </noscript>
      </PageHead>

      {/* o aviso da carteira: [!] em cinza (não há cor de aviso no sistema visual; o âmbar leria como "escolhido") */}
      <Aviso className="mt-12">
        Valores estimados pelo último fechamento disponível; não é recomendação de investimento.
      </Aviso>

      {wallet.lots.length > 0 ? (
        <>
          <Section id="resumo" title="Resumo">
            <WalletSummary totals={wallet.totals} />
          </Section>
          <Section id="posicoes" title="Posições">
            <p className="muted max-w-prose">
              O fechamento é o da última barra de cada ação, com a data dele: o valor e o resultado
              são estimados e podem estar atrasados. Não consideram proventos, desdobramentos,
              corretagem, taxas nem impostos. Cotações: brapi.dev.
            </p>
            <WalletPositions positions={wallet.positions} />
          </Section>
        </>
      ) : null}

      <WalletLots lots={wallet.lots.map(lotView)} today={today} />
    </>
  );
});
