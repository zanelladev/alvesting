import type { Metadata } from 'next';
import { ACCOUNT_LIMITS } from '@alvesting/contracts/account-constants';
import { ResendVerificationForm } from '../../../components/account-forms';
import { BUTTON, LINK, NavLink, PageHead } from '../../../components/ui';
import { first, type SearchParams } from '../../../lib/page';

// Verificar o e-mail (plano §3; etapa 11, parte 2; docs/CONTA.md). Três estados, pela URL:
//   sem parâmetro      depois do cadastro: o link foi mandado, e dá para pedir outro;
//   ?retorno=1         o link do e-mail foi aberto e a api confirmou o endereço (o cadastro manda este caminho como callbackURL);
//   ?retorno=1&error=  o link não valeu (venceu, ou já foi usado): o Better Auth acrescenta o código ao callbackURL.
// Não lê a api nem a sessão. O que vem da URL só escolhe entre as frases daqui (uma lista fechada), nunca vira texto.
// O estado sem parâmetro serve a quem acabou de se cadastrar e a quem digitou um e-mail que já tem conta: o cadastro responde igual aos
// dois e não manda nada ao segundo (docs/CONTA.md, seção 11). Por isso a frase diz "se o e-mail ainda não tinha cadastro" e aponta
// "entrar" e "esqueci a senha", e não afirma que o link saiu.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Verificar o e-mail',
  robots: { index: false, follow: false },
};

const VALIDITY_MINUTES = ACCOUNT_LIMITS.verificationMinutes;

export default async function VerifyEmailPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const back = first(params.retorno) === '1';
  const error = first(params.error);

  if (back && error === undefined) {
    return (
      <PageHead title="E-mail confirmado">
        <p className="text-15 text-pretty">
          O seu e-mail está confirmado. Agora você já pode entrar.
        </p>
        {/* a única ação da tela: a pílula preta */}
        <p className="pt-4">
          <NavLink href="/entrar" className={`${BUTTON} btn-primary`}>
            Entrar
          </NavLink>
        </p>
      </PageHead>
    );
  }

  return (
    <>
      <PageHead title={back ? 'Não foi possível confirmar o e-mail' : 'Confirme o seu e-mail'}>
        {back ? (
          <p className="text-15 text-pretty">
            {error === 'TOKEN_EXPIRED'
              ? `O link venceu: ele vale por ${VALIDITY_MINUTES} minutos.`
              : 'O link não vale: já foi usado, ou está incompleto.'}{' '}
            Peça um novo abaixo.
          </p>
        ) : (
          <>
            <p className="text-15 text-pretty">
              Se o e-mail ainda não tinha cadastro, mandamos um link de confirmação para ele. Abra o
              link para confirmar o endereço; ele vale por {VALIDITY_MINUTES} minutos. Só depois
              disso dá para entrar.
            </p>
            <p className="text-15 text-pretty">
              Não chegou? Confira o spam e, se precisar, peça um novo link abaixo (o mesmo tipo de
              e-mail só sai de novo depois de 1 minuto). Se você já tem conta, use um dos caminhos
              abaixo: entrar ou esqueci a senha.
            </p>
          </>
        )}
      </PageHead>

      <ResendVerificationForm />

      <ul className="mt-6 flex flex-wrap gap-x-6">
        <li>
          <NavLink href="/entrar" className={LINK}>
            Entrar
          </NavLink>
        </li>
        <li>
          <NavLink href="/esqueci-senha" className={LINK}>
            Esqueci a senha
          </NavLink>
        </li>
        <li>
          <NavLink href="/cadastro" className={LINK}>
            Criar conta
          </NavLink>
        </li>
      </ul>
    </>
  );
}
