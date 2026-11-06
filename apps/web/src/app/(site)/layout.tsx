import type { ReactNode } from 'react';
import { SiteShell } from '../../components/site-chrome';

// O site (a landing, o Como funciona e os textos legais): o cabeçalho de links e o rodapé (components/site-chrome.tsx).
export default function SiteLayout({ children }: { children: ReactNode }) {
  return <SiteShell>{children}</SiteShell>;
}
