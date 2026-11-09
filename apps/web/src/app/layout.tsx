import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { themeScript } from '../components/beui/theme-selector';
import './globals.css';

// Uma sans só no texto, a do sistema (ADR 0037; docs/DESIGN.md). A Geist dos títulos saiu (era um pedido de alta prioridade no caminho
// crítico da home, docs/TELAS.md, seção 5), e o texto, os títulos, os números e os rótulos usam a mesma pilha do globals.css.
// A exceção é o nome da marca: a Exo 2 (a tipografia da logo, escolhida pelo Artur em 06/11/2026), só no "Alvesting" do cabeçalho, do topo
// do app, da tela de entrar e do nome gigante do rodapé (o `font-marca`). Ela não passa pelo next/font: as nove letras do nome vêm em linha
// no globals.css (1,7 KB), sem requisição no caminho do LCP.

// O título da home é só "Alvesting"; as outras telas levam o nome delas na frente ("Ranking · Alvesting").
// `formatDetection` desligado: o Safari do iPhone transforma uma corrida de dígitos em link de telefone, e os SHA-256 do ciclo e do
// Como funciona (64 hexadecimais, quase sempre com trechos só de dígitos) viriam com link e cor que não são nossos. O ícone é o
// src/app/icon.svg (o Next o liga sozinho); sem ele todo navegador pede /favicon.ico e leva a página 404 inteira.
export const metadata: Metadata = {
  title: { default: 'Alvesting', template: '%s · Alvesting' },
  description: 'Arena pública de LLMs operando ações da B3 com dinheiro fictício.',
  formatDetection: { telephone: false, address: false, email: false },
};

// Sem maximumScale nem userScalable: o usuário pode dar zoom. O tema segue o sistema até o usuário escolher outro (o seletor, ADR 0037): o
// `color-scheme` deixa o navegador pintar o fundo e os controles nativos no tema certo antes do CSS, e a cor da barra do navegador
// acompanha o canvas de cada um (com uma escolha guardada, o script do tema troca as duas metas para a cor dela).
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

// O script do tema vai em linha no <head>, antes de qualquer pintura: ele põe a escolha guardada no <html> (`data-tema` e a classe
// `dark`), e a página já nasce no tema certo, sem piscar e sem esperar a hidratação. Por isso o <html> leva o
// `suppressHydrationWarning`: os atributos que o script escreve não são do React.
const THEME_SCRIPT = `(${themeScript.toString()})()`;

// O layout raiz não tem casca: cada grupo de rota tem a dele (o site em (site); o app nas áreas de (app) e, na área "conta", também em
// (auth), as telas de entrar e criar conta; a 404 traz a do site).
// Um layout raiz só (o html, o body e o script do tema) deixa a navegação suave entre os grupos funcionando.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="flex min-h-dvh flex-col antialiased">{children}</body>
    </html>
  );
}
