import type { Metadata } from 'next';
import { ForgotPasswordForm } from '../../components/account-forms';
import { LINK, NavLink } from '../../components/ui';

// Esqueci a senha (plano §3; etapa 11, parte 2; docs/CONTA.md). Pede o e-mail e a api manda o link da redefinição (vale por 30 minutos).
// A resposta é a mesma para e-mail cadastrado ou não: a tela não revela quem tem conta. Não lê a api nem a sessão.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Esqueci a senha',
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <>
      <header className="space-y-2">
        <h1 className="font-mono text-2xl font-semibold sm:text-3xl">Esqueci a senha</h1>
        <p className="max-w-prose">
          Informe o e-mail da conta. Se ele estiver cadastrado, mandamos um link para escolher uma
          senha nova.
        </p>
      </header>

      <ForgotPasswordForm />

      <ul className="flex flex-wrap gap-x-6">
        <li>
          <NavLink href="/entrar" className={LINK}>
            Voltar para entrar
          </NavLink>
        </li>
      </ul>
    </>
  );
}
