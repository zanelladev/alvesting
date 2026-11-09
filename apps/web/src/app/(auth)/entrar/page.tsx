import type { Metadata } from 'next';
import { SignInForm } from '../../../components/account-forms';
import { Icone } from '../../../components/icones';
import { CAIXA_ERRO, LINK, NavLink, PageHead } from '../../../components/ui';
import { readProviders } from '../../../lib/account';
import { first, type SearchParams } from '../../../lib/page';
import { safeInternalPath } from '../../../lib/safe-path';
import { withApiDown } from '../../../lib/with-api-down';

// Entrar (plano §3, §9; etapa 11, parte 2; docs/CONTA.md). E-mail e senha, e o Google só quando a api o tem. Lê da api só quais logins ela
// oferece (sem cache). Depois do login a pessoa vai para o `proximo` da URL, que só vale se for um caminho deste site (safeInternalPath);
// sem ele, para a conta. A tela não lê a sessão: quem já entrou pode entrar de novo, e a conta é que manda quem não entrou para cá.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Entrar', robots: { index: false, follow: false } };

// Os avisos que as outras telas deixam na URL (?aviso=). Uma lista fechada: o que não está aqui não aparece, e nada da URL vira texto.
const NOTICES: Readonly<Record<string, string>> = {
  saiu: 'Você saiu da conta.',
  'conta-excluida': 'Sua conta foi excluída. Os dados foram apagados.',
  'senha-redefinida': 'Senha redefinida. Entre com a nova senha.',
};

// Os erros do Google, que o Better Auth devolve em ?error= (docs/CONTA.md, seção 2). Também uma lista fechada; o resto é a frase geral.
const GOOGLE_ERRORS: Readonly<Record<string, string>> = {
  signup_disabled:
    'Não encontramos uma conta com o e-mail desse Google. Crie a conta antes, aceitando os termos.',
  account_not_linked:
    'Já existe uma conta com esse e-mail, criada com senha. Entre com o e-mail e a senha.',
  email_not_verified: 'O Google não confirmou o seu e-mail, e sem isso não dá para entrar.',
  access_denied: 'O login com o Google foi cancelado.',
};
const GOOGLE_FALLBACK = 'Não foi possível entrar com o Google. Tente de novo.';

const lookup = (table: Readonly<Record<string, string>>, key: string | undefined) =>
  key !== undefined && Object.hasOwn(table, key) ? table[key] : undefined;

export default withApiDown(async function SignInPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const providers = await readProviders();
  const next = safeInternalPath(first(params.proximo), '/conta');
  const notice = lookup(NOTICES, first(params.aviso));
  const googleError = first(params.error);

  return (
    <>
      <PageHead title="Entrar">
        <p className="text-15 text-pretty">
          Entre com o e-mail e a senha da sua conta. A arena pública pode ser lida sem conta.
        </p>
        {/* O aviso sai do servidor, logo abaixo do título e na ordem de leitura: a confirmação de uma ação sem volta (a exclusão da conta)
            não pode ficar abaixo do botão, fora da tela no celular, nem numa região viva que já nasce com texto (o leitor de tela não a
            anuncia ao carregar a página). */}
        {/* a confirmação, sem caixa: o ícone do que deu certo e a frase na tinta (a cor nunca anda sozinha) */}
        {notice ? (
          <p className="flex max-w-md gap-2.5 pt-2 text-15 text-ink">
            <span aria-hidden="true" className="mt-0.5 shrink-0 text-semantic-success">
              <Icone size={16}>
                <path d="M5.5 10.5l3 3 6-7" />
              </Icone>
            </span>
            <span className="min-w-0">{notice}</span>
          </p>
        ) : null}
        {googleError ? (
          <p role="alert" className={`max-w-md ${CAIXA_ERRO}`}>
            {lookup(GOOGLE_ERRORS, googleError) ?? GOOGLE_FALLBACK}
          </p>
        ) : null}
      </PageHead>

      {/* o formulário na coluna do layout (auth), na casca do app: o campo de 44 px, a pílula primária larga no envio, o DotSpinner
          enquanto envia */}
      <SignInForm next={next} google={providers.google} />

      <ul className="mt-6 flex flex-wrap gap-x-6">
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
});
