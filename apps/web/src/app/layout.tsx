import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import { SiteFooter, SiteHeader } from '../components/site-chrome';
import './globals.css';

// O next/font baixa as fontes no build e as serve do nosso domínio: o navegador não fala com o Google. A Sans só no peso 400: com mais de um
// peso o Google serve a fonte variável (wdth e wght), de 40 KB contra 18 KB da estática, e o texto em negrito já é da Mono 600.
const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '600'],
  variable: '--font-plex-mono',
  display: 'swap',
});
const sans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400'],
  variable: '--font-plex-sans',
  display: 'swap',
});

// O título da home é só "Alvesting"; as outras telas levam o nome delas na frente ("Ranking · Alvesting").
// `formatDetection` desligado: o Safari do iPhone transforma uma corrida de dígitos em link de telefone, e os SHA-256 do ciclo e do
// Como funciona (64 hexadecimais, quase sempre com trechos só de dígitos) viriam com link e cor que não são nossos. O ícone é o
// src/app/icon.svg (o Next o liga sozinho); sem ele todo navegador pede /favicon.ico e leva a página 404 inteira.
export const metadata: Metadata = {
  title: { default: 'Alvesting', template: '%s · Alvesting' },
  description: 'Arena pública de LLMs operando ações da B3 com dinheiro fictício.',
  formatDetection: { telephone: false, address: false, email: false },
};

// Sem maximumScale nem userScalable: o usuário pode dar zoom.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#f2efe6',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={`${mono.variable} ${sans.variable}`}>
      <body className="flex min-h-dvh flex-col bg-paper font-sans text-ink antialiased">
        <SiteHeader />
        <main className="mx-auto w-full max-w-5xl flex-1 space-y-8 px-4 py-6">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
