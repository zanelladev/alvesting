import type { ReactNode } from 'react';
import { TelaDividida } from '../../components/tela-dividida';

// Entrar: a tela dividida do cadastro do Rallies (components/tela-dividida.tsx), com a pílula "Criar conta" no canto. As outras telas da
// conta (criar conta, verificar o e-mail, esqueci e redefinir a senha) moram no grupo (auth), com a pílula "Entrar".
export default function EntrarLayout({ children }: { children: ReactNode }) {
  return <TelaDividida pilula="cadastro">{children}</TelaDividida>;
}
