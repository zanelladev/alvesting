import type { ReactNode } from 'react';
import { AppShell } from '../../../components/app-shell';

// A área "carteira" do app: a casca com o item dela marcado (aria-current), sem JavaScript.
export default function AreaLayout({ children }: { children: ReactNode }) {
  return <AppShell area="carteira">{children}</AppShell>;
}
