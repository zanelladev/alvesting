import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { LegalDocumentId } from '@alvesting/contracts';
import { AcceptConsentsForm, DeleteAccountForm, SignOutForm } from '../../components/account-forms';
import {
  Aviso,
  BUTTON,
  CAIXA,
  Fact,
  Facts,
  LINK,
  NavLink,
  PageHead,
  Section,
} from '../../components/ui';
import { authCookieHeader, readMe } from '../../lib/account';
import { formatDateTime } from '../../lib/format';
import { withApiDown } from '../../lib/with-api-down';

// A conta (plano §3 e §9; etapa 11, parte 2; docs/CONTA.md): os dados mínimos, os aceites com a versão e a data, sair, exportar e excluir.
// É a única tela que lê dado do usuário: lê GET /api/v1/me no servidor com o cookie da requisição (só o da sessão vai à api), sem o cache
// de dados do Next (apiGetFresh). Ler o cookie torna a página dinâmica, e o Next a responde com `Cache-Control: private, no-store`.
// Sem sessão (ou com a sessão que a api não reconhece) manda para a entrada, com o caminho de volta.
// ponytail: o servidor não repassa ao navegador o cookie renovado que a api devolve quando a sessão passa de metade do prazo (um
// Server Component não escreve cookie), então o cookie vale 7 dias a partir do login, ainda que o banco renove a sessão a cada uso.
// A saída, quando mais telas dependerem de sessão longa: renovar por um Route Handler ou pelo cliente (GET /api/auth/get-session).
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Minha conta', robots: { index: false, follow: false } };

const DOCUMENTS: Record<LegalDocumentId, { title: string; href: string }> = {
  TERMS: { title: 'Termos de uso', href: '/termos' },
  PRIVACY: { title: 'Política de privacidade', href: '/privacidade' },
};

export default withApiDown(async function AccountPage() {
  const me = await readMe(authCookieHeader((await headers()).get('cookie')));
  if (!me) redirect(`/entrar?proximo=${encodeURIComponent('/conta')}`);

  const terms = me.consent.documents.find((d) => d.document === 'TERMS');
  const privacy = me.consent.documents.find((d) => d.document === 'PRIVACY');
  const pending = !me.consent.upToDate && terms && privacy;

  // os aceites, com a versão e a data de cada um; com o aceite pendente, a seção vem antes de tudo, com o formulário (plano §3)
  const consents = (
    <Section id="aceites" title="Termos e privacidade">
      {pending ? (
        <Aviso>
          Os textos mudaram. Leia a versão nova e aceite para continuar usando os recursos da conta.
          Exportar os dados e excluir a conta seguem disponíveis sem o aceite novo.
        </Aviso>
      ) : null}
      <ul className="max-w-2xl">
        {me.consent.documents.map((doc) => (
          <li key={doc.document} className="border-b border-hairline py-3 text-ink">
            {DOCUMENTS[doc.document].title}, versão {doc.version}:{' '}
            {doc.acceptedAt ? `aceito em ${formatDateTime(doc.acceptedAt)}` : 'ainda não aceito'}
          </li>
        ))}
      </ul>
      {/* o aceite é um registro legal: o fuso fica à vista na tela, e não só na documentação */}
      <p className="muted">Datas e horas no horário de Brasília.</p>
      <ul className="flex flex-wrap gap-x-6">
        {(Object.keys(DOCUMENTS) as LegalDocumentId[]).map((id) => (
          <li key={id}>
            <NavLink href={DOCUMENTS[id].href} className={LINK}>
              Ler {DOCUMENTS[id].title.toLowerCase()}
            </NavLink>
          </li>
        ))}
      </ul>
      {pending ? (
        <div className="card max-w-md">
          <AcceptConsentsForm
            terms={terms.version}
            privacy={privacy.version}
            labelledBy="aceites-titulo"
          />
        </div>
      ) : null}
    </Section>
  );

  return (
    <>
      <PageHead title="Minha conta">
        <p className="max-w-prose text-lead text-pretty">
          O que a Alvesting guarda de você, e o que você pode fazer com isso: sair, baixar uma cópia
          ou apagar tudo.
        </p>
        <noscript>
          <p className={`max-w-prose ${CAIXA}`}>
            Sair, aceitar versões novas e excluir a conta precisam de JavaScript. Ative o JavaScript
            no navegador e recarregue a página.
          </p>
        </noscript>
      </PageHead>

      {pending ? consents : null}

      <Section id="dados" title="Dados">
        <div className="max-w-2xl">
          <Facts>
            <Fact term="Nome" prose>
              <span className="break-words">{me.name}</span>
            </Fact>
            <Fact term="E-mail" prose>
              <span className="break-all">{me.email}</span>
            </Fact>
            <Fact term="E-mail confirmado" prose>
              {me.emailVerified ? 'sim' : 'não'}
            </Fact>
            {me.role === 'ADMIN' ? (
              <Fact term="Papel" prose>
                admin
              </Fact>
            ) : null}
          </Facts>
        </div>
        {/* o painel não tem link no cabeçalho (as páginas públicas não leem a sessão); a conta já a lê, então é daqui que o admin chega */}
        {me.role === 'ADMIN' ? (
          <p>
            <NavLink href="/admin" className={LINK}>
              Abrir o painel da arena
            </NavLink>
          </p>
        ) : null}
      </Section>

      {pending ? null : consents}

      <Section id="sair" title="Sair">
        <p className="max-w-prose">Encerra a sessão neste aparelho.</p>
        <SignOutForm labelledBy="sair-titulo" />
      </Section>

      <Section id="meus-dados" title="Meus dados">
        <p className="max-w-prose">
          Baixe uma cópia de tudo o que a Alvesting guarda de você: o cadastro, as contas
          vinculadas, as sessões, os aceites e a carteira com os lançamentos, em um arquivo JSON.
          Sem a senha nem as chaves.
        </p>
        {/* um link comum, sem JavaScript: a api responde com Content-Disposition: attachment e o navegador baixa o arquivo */}
        <a href="/api/v1/me/export" download="alvesting-meus-dados.json" className={BUTTON}>
          Baixar meus dados (JSON)
        </a>
      </Section>

      <Section id="excluir" title="Excluir a conta">
        <p className="max-w-prose">A exclusão é definitiva. Ela apaga, no mesmo ato:</p>
        <ul className="max-w-prose list-disc space-y-1 pl-6">
          <li>o seu cadastro (nome e e-mail) e a senha;</li>
          <li>o vínculo com o Google, se você entrou por ele;</li>
          <li>todas as sessões abertas, em todos os aparelhos;</li>
          <li>o histórico de aceites dos termos e da política;</li>
          <li>a sua carteira, com todos os lançamentos;</li>
          <li>os pedidos de confirmação e de redefinição de senha ainda pendentes.</li>
        </ul>
        <p className="max-w-prose">
          Ficam só o registro de auditoria da exclusão, com um código aleatório da conta e sem nome
          nem e-mail. As cópias de segurança do banco guardam os seus dados por até 7 dias e depois
          deixam de tê-los.
        </p>
        {/* a confirmação e a senha num cartão de borda vermelha; o botão fica no escuro, e não na pílula branca: não é a ação que a tela
            convida a fazer */}
        <div className="card max-w-md border-semantic-error/60">
          <DeleteAccountForm labelledBy="excluir-titulo" />
        </div>
      </Section>
    </>
  );
});
