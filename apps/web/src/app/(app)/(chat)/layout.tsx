import type { ReactNode } from 'react';
import { AppShell } from '../../../components/app-shell';

// A área "chat" do app: a casca com o item dela marcado (aria-current), sem JavaScript.
export default function AreaLayout({ children }: { children: ReactNode }) {
  return <AppShell area="chat">{children}</AppShell>;
}
