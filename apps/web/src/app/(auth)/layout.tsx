import type { ReactNode } from 'react';
import { TelaDividida } from '../../components/tela-dividida';

// Criar conta, verificar o e-mail, esqueci a senha e redefinir a senha: a tela dividida do cadastro do Rallies (components/tela-dividida.tsx),
// com a pílula "Entrar" no canto. A de entrar mora no grupo (entrar), com a pílula "Criar conta".
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <TelaDividida pilula="entrar">{children}</TelaDividida>;
}
