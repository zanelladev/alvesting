import type { ReactNode } from 'react';
import { AppShell } from '../../components/app-shell';

// Entrar, criar conta, verificar o e-mail, esqueci a senha e redefinir a senha (docs/CONTA.md): na casca do app, na área "conta" (a lateral
// no desktop, a barra de abas no celular, com a "Conta" marcada), a pedido do Artur em 06/11/2026; antes eram uma tela dividida, com a
// escadaria à direita, em dois grupos de rota. O formulário numa coluna de até 448 px, no centro da coluna do app.
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell area="conta">
      <div className="mx-auto w-full max-w-md pb-10 lg:pt-[6vh]">{children}</div>
    </AppShell>
  );
}
