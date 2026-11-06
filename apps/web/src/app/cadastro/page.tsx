import type { Metadata } from 'next';
import { SignUpForm } from '../../components/account-forms';
import { LINK, NavLink, PageHead } from '../../components/ui';
import { readLegal, readProviders } from '../../lib/account';
import { documentOf } from '../../lib/legal';
import { withApiDown } from '../../lib/with-api-down';

// Criar conta (plano §3, §12; etapa 11, parte 2; docs/CONTA.md). O aceite é explícito: duas caixas, nunca marcadas, com a versão vigente
// de cada texto. As versões vêm da api, sem cache (o aceite grava a versão que a pessoa viu, e a api recusa outra). Lê também quais
// logins ela oferece.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Criar conta', robots: { index: false, follow: false } };

export default withApiDown(async function SignUpPage() {
  const [legal, providers] = await Promise.all([readLegal(), readProviders()]);
  const terms = documentOf(legal, 'TERMS');
  const privacy = documentOf(legal, 'PRIVACY');

  return (
    <>
      <PageHead title="Criar conta">
        <p className="max-w-prose text-lead text-pretty">
          Informe o nome, o e-mail e uma senha. Você vai receber um link para confirmar o e-mail
          antes do primeiro acesso.
        </p>
      </PageHead>

      <div className="card mt-12 max-w-md">
        <SignUpForm terms={terms.version} privacy={privacy.version} google={providers.google} />
      </div>

      <ul className="flex flex-wrap gap-x-6">
        <li>
          <NavLink href="/entrar" className={LINK}>
            Já tenho conta
          </NavLink>
        </li>
      </ul>
    </>
  );
});
