import type { Metadata } from 'next';
import { ResetPasswordForm } from '../../components/account-forms';
import { BUTTON, NavLink, PageHead } from '../../components/ui';
import { first, type SearchParams } from '../../lib/page';

// Redefinir a senha (plano §3; etapa 11, parte 2; docs/CONTA.md). O link do e-mail traz o token na URL (?token=). Por isso esta página
// responde com `Referrer-Policy: no-referrer` (next.config.ts): o token não vai no Referer para nenhum recurso. O token nunca é mostrado:
// vai direto para o formulário, que o manda à api com a senha nova. A forma esperada é a do Better Auth (letras, números, "_" e "-"); outra
// coisa vale como link incompleto.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Redefinir a senha',
  robots: { index: false, follow: false },
};

const TOKEN = /^[\w-]{1,128}$/;

export default async function ResetPasswordPage({ searchParams }: { searchParams: SearchParams }) {
  const raw = first((await searchParams).token);
  const token = raw !== undefined && TOKEN.test(raw) ? raw : undefined;

  return (
    <>
      <PageHead title="Redefinir a senha">
        <p className="max-w-prose text-lead text-pretty">
          {token
            ? 'Escolha a senha nova. Ao salvar, as outras sessões abertas da conta são encerradas.'
            : 'Este link está incompleto. Abra o link do e-mail inteiro, ou peça um novo.'}
        </p>
        {/* sem o token, a saída é a única ação da tela: a pílula branca */}
        {token ? null : (
          <p className="pt-4">
            <NavLink href="/esqueci-senha" className={`${BUTTON} btn-primary`}>
              Pedir um link novo
            </NavLink>
          </p>
        )}
      </PageHead>

      {token ? (
        <div className="card mt-12 max-w-md">
          <ResetPasswordForm token={token} />
        </div>
      ) : null}
    </>
  );
}
