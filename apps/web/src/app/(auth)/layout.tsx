import type { ReactNode } from 'react';
import { AppShell } from '../../components/app-shell';

// Entrar, criar conta, verificar o e-mail, esqueci a senha e redefinir a senha (docs/CONTA.md): na casca do app, na área "conta" (o trilho
// no desktop, a barra de abas no celular, com a "Conta" marcada), a pedido do Artur em 06/11/2026; antes eram a tela dividida do cadastro do
// Rallies, com a escadaria à direita, em dois grupos de rota. O formulário numa coluna de até 448 px, no centro do principal.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell area="conta">
      <div className="mx-auto w-full max-w-md pb-10 lg:pt-[6vh]">{children}</div>
    </AppShell>
  );
}
