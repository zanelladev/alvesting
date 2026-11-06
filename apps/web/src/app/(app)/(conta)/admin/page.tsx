import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { CorporateEventForm, RerunCycleForm } from '../../../../components/admin-forms';
import {
  CostsPanel,
  JobsPanel,
  QueuesPanel,
  SeasonsPanel,
} from '../../../../components/admin-panels';
import { SecaoCartao } from '../../../../components/cartao';
import { CAIXA, PageHead } from '../../../../components/ui';
import { authCookieHeader, readMe } from '../../../../lib/account';
import { readAdmin, type AdminData } from '../../../../lib/admin';
import { ApiError } from '../../../../lib/api';
import { withApiDown } from '../../../../lib/with-api-down';

// O painel da arena (plano §3 e §9, etapa 10, parte 2; docs/TELAS.md, seção 8): jobs, filas e DLQ, custos do mês contra o teto,
// temporadas, reprocessar o ciclo e o evento corporativo. Só para o admin.
//  - Sem sessão (ou com a que a api não reconhece), vai para a entrada, com o caminho de volta.
//  - Quem não tem o papel admin recebe 404, para a página não revelar que existe. Vale antes de olhar o aceite dos termos e antes de
//    chamar a api de admin: quem não é admin não aprende nada, nem pelo tempo da resposta.
//  - Admin com o aceite vencido vai para a conta aceitar (a api de admin responde 403 CONSENT_REQUIRED).
// Lê no servidor com o cookie da requisição (só o da sessão vai à api), sem o cache de dados do Next (apiGetFresh): dinâmica, privada e
// no-store, como a /conta. As páginas públicas continuam sem ler a sessão; o cabeçalho não tem link para cá (a /conta mostra um ao admin).
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Painel da arena',
  robots: { index: false, follow: false },
};

const SIGN_IN = `/entrar?proximo=${encodeURIComponent('/admin')}`;

export default withApiDown(async function AdminPage() {
  const cookie = authCookieHeader((await headers()).get('cookie'));
  const me = await readMe(cookie);
  if (!me) redirect(SIGN_IN);
  if (me.role !== 'ADMIN') notFound();
  if (!me.consent.upToDate) redirect('/conta');

  let data: AdminData;
  try {
    data = await readAdmin(cookie);
  } catch (error) {
    // a sessão acabou entre as duas leituras (401), ou o papel foi tirado (403): a mesma resposta de quem chegou sem ele
    if (error instanceof ApiError && error.status === 401) redirect(SIGN_IN);
    if (error instanceof ApiError && error.status === 403) notFound();
    throw error;
  }

  // o dia de Brasília, para o campo do reprocesso; o servidor pode estar em UTC
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(
    new Date(),
  );

  return (
    <>
      <PageHead title="Painel da arena">
        <p className="max-w-prose text-15 text-pretty">
          A operação da arena: jobs, filas, custos e temporadas. Só o admin vê esta página. Cada
          ação pede uma confirmação explícita e fica na trilha de auditoria com o seu código.
        </p>
        <noscript>
          <p className={`max-w-prose ${CAIXA}`}>
            As ações do painel precisam de JavaScript. Ative o JavaScript no navegador e recarregue
            a página.
          </p>
        </noscript>
      </PageHead>

      {/* Na casca do app, sem barra secundária: cada seção num cartão (docs/redesign-rallies/plano.md, f.4); as tabelas rolam dentro dele */}
      <div className="max-w-[960px] space-y-4">
        <SecaoCartao id="jobs" title="Jobs">
          <JobsPanel jobs={data.jobs} />
        </SecaoCartao>

        <SecaoCartao id="filas" title="Filas e DLQ">
          <QueuesPanel queues={data.jobs.queues} />
        </SecaoCartao>

        <SecaoCartao id="custos" title="Custos do mês">
          <CostsPanel costs={data.costs} />
        </SecaoCartao>

        <SecaoCartao id="temporadas" title="Temporadas">
          <SeasonsPanel seasons={data.seasons} />
        </SecaoCartao>

        <SecaoCartao id="ciclo" title="Reprocessar um ciclo">
          <p className="max-w-prose">
            Quando o agendador das 08:00 falhou, ou o briefing só chegou depois. Publica a decisão
            de quem ainda não decidiu, só entre as 08:00 e 5 minutos antes do prazo das 09:30 de
            Brasília (o worker leva um tempo para pegar a mensagem). Depois disso não publica nada,
            e uma decisão já gravada nunca muda.
          </p>
          <RerunCycleForm defaultDate={today} labelledBy="ciclo-titulo" />
        </SecaoCartao>

        <SecaoCartao id="evento" title="Evento corporativo">
          <p className="max-w-prose">
            Desdobramento, grupamento ou bonificação em ações. Registra o evento e enfileira a
            reliquidação das temporadas que já passaram da data ex; o worker liquida em alguns
            minutos, e isso muda resultados já publicados. O cache público leva até 5 minutos,
            depois disso, para mostrar o número novo.
          </p>
          <CorporateEventForm labelledBy="evento-titulo" />
        </SecaoCartao>
      </div>
    </>
  );
});
