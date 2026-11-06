import type { Metadata, Viewport } from 'next';
import { Geist } from 'next/font/google';
import type { ReactNode } from 'react';
import { SiteFooter, SiteHeader } from '../components/site-chrome';
import { Rule } from '../components/ui';
import './globals.css';

// O next/font baixa a fonte no build e a serve do nosso domínio: o navegador não fala com o Google. Uma fonte só, num peso (ADR 0034): a
// Geist no 500 (títulos, números grandes, botões, a cápsula do menu, o negrito); com dois pesos o Google serveria a fonte variável, com o
// dobro do tamanho. O texto, as células e os rótulos usam a fonte do sistema, e a mono também (globals.css): a Inter 400 do plano saiu
// porque o LCP simulado da home passou do teto com ela (cada fonte baixada é um pedido de alta prioridade no caminho crítico; a medida está
// em docs/TELAS.md, seção 5).
const display = Geist({
  subsets: ['latin'],
  weight: ['500'],
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

// Sem maximumScale nem userScalable: o usuário pode dar zoom. O site é escuro (o canvas preto): o navegador já pinta o fundo e os controles
// nativos no escuro antes do CSS.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#000000',
  colorScheme: 'dark',
};

// A casca de toda tela, sem JavaScript: o cabeçalho, a moldura (as laterais de 1 px na coluna de 1200, a partir de 1202 px, por cima do
// conteúdo para cruzar a arte e as faixas de largura total, e abaixo do cabeçalho), o main na coluna e a linha da moldura antes do rodapé.
// As laterais são duas linhas de 1 px, e não uma caixa de 1202 px com borda: a caixa ficava por cima de todo o texto da coluna, e o axe não
// achava o fundo dele (o contraste do desktop virava "incompleto", sem violação nem aprovação). O `overflow-x: clip` corta o que passa da
// barra de rolagem nas linhas de ponta a ponta (a Rule e o hero têm 100vw).
const MOLDURA =
  'pointer-events-none absolute inset-y-0 z-20 hidden w-px bg-hairline min-[75.125rem]:block';
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" className={display.variable}>
      <body className="flex min-h-dvh flex-col antialiased">
        <SiteHeader />
        <div className="relative flex min-w-0 flex-1 flex-col overflow-x-clip">
          <div aria-hidden="true" data-moldura="" className={`${MOLDURA} left-[calc(50%-601px)]`} />
          <div aria-hidden="true" data-moldura="" className={`${MOLDURA} left-[calc(50%+600px)]`} />
          <main className="mx-auto w-full max-w-[1200px] flex-1 space-y-8 px-(--calha) pt-6 pb-12">
            {children}
          </main>
          <Rule />
          <SiteFooter />
        </div>
      </body>
    </html>
  );
}
