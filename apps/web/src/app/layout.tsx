import type { Metadata, Viewport } from 'next';
import { Geist } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';

// O next/font baixa a fonte no build e a serve do nosso domínio: o navegador não fala com o Google. Uma fonte só, num peso (ADR 0035): a
// Geist no 600 (títulos, nomes, números grandes e o nome gigante do rodapé), no lugar da FK Grotesk do Rallies, que é paga; com dois pesos o
// Google serviria a fonte variável, com o dobro do tamanho, no caminho do LCP. O texto, as células, os botões e os rótulos usam a fonte do
// sistema, e a mono também (globals.css): cada fonte baixada é um pedido de alta prioridade no caminho crítico da home (docs/TELAS.md,
// seção 5).
const display = Geist({
  subsets: ['latin'],
  weight: ['600'],
  variable: '--font-geist',
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

// Sem maximumScale nem userScalable: o usuário pode dar zoom. Os dois temas seguem o sistema (globals.css): o `color-scheme` deixa o
// navegador pintar o fundo e os controles nativos no tema certo antes do CSS, e a cor da barra do navegador acompanha o canvas de cada um.
// `viewportFit: 'cover'`: a barra de abas do app fica no pé, e no iPhone ela usa a área segura (`env(safe-area-inset-bottom)`).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#171717' },
  ],
};

// O layout raiz não tem casca: cada grupo de rota tem a dele (o site em (site), a tela dividida em (entrar) e (auth), o app nas áreas de
// (app); a 404 traz a do site).
// Um layout raiz só (o html, o body e a fonte) deixa a navegação suave entre os grupos funcionando.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={display.variable}>
      <body className="flex min-h-dvh flex-col antialiased">{children}</body>
    </html>
  );
}
