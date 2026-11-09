import type { ReactNode } from 'react';
import { ThemeSelector } from './beui/theme-selector';
import { IconeMenu, Marca } from './icones';
import { Rodape } from './rodape';
import { NavLink } from './ui';

// A casca do site (ADR 0035): a landing, o Como funciona, os textos legais e a 404 (as telas de
// entrar e criar conta moram na casca do app, no grupo (auth)). O cabeçalho do Rallies: a marca à esquerda, os links no meio e a pílula de
// contorno "Entrar" à direita. O painel de admin, a carteira e a conta ficam na casca do app; o cabeçalho não lê a sessão (as páginas
// públicas não a leem: protege o LCP da home e o cache de dados delas), então os links são os mesmos para quem entrou ou não.
const NAV = [
  ['Arena', '/arena'],
  ['Ranking', '/ranking'],
  ['Explorar', '/explorar'],
  ['Como funciona', '/como-funciona'],
] as const;

// O cabeçalho do site: 64 px, preso no topo. Uma `nav` só, com os links e a pílula "Entrar": a partir de 1024 px no meio e à direita; abaixo
// disso, uma folha `popover` aberta pelo botão "Menu" (que vira um ✕), sem JavaScript. A folha vai até o pé da tela, e o resto dela, embaixo
// dos links, é o botão "Fechar o menu": o toque ali fecha a folha e não chega à página de baixo, que sai de vista e da ordem do Tab enquanto a
// folha está aberta (globals.css). O Esc também fecha.
// Os links do menu são `<a>` comuns, e não o `Link` do Next: a folha aberta continuaria aberta sobre a página nova numa navegação suave
// (fechá-la pediria JavaScript). A navegação inteira a fecha, e o leitor de tela anuncia a página nova.
export function SiteHeader() {
  return (
    <header className="topo sticky top-0 z-30 bg-canvas">
      <div className="cabecalho mx-auto flex h-16 max-w-7xl items-center justify-between gap-2 px-(--calha) lg:grid lg:grid-cols-[1fr_auto_1fr]">
        <NavLink
          href="/"
          className="inline-flex min-h-11 items-center gap-2 justify-self-start font-marca text-base font-semibold text-ink"
        >
          <Marca />
          Alvesting
        </NavLink>
        <button
          type="button"
          popoverTarget="menu"
          className="btn-menu inline-flex size-11 items-center justify-center rounded-xl bg-surface-strong text-ink hover:bg-hairline lg:hidden"
        >
          <IconeMenu />
          <span className="sr-only">Menu</span>
        </button>
        <nav id="menu" popover="auto" aria-label="Principal" className="menu">
          <ul className="menu-links">
            {NAV.map(([label, href]) => (
              <li key={href}>
                <a href={href}>{label}</a>
              </li>
            ))}
          </ul>
          {/* o seletor de tema antes de "Entrar" (na folha, a linha "Tema"); ele não carrega biblioteca nenhuma: a landing segue sem JavaScript
              de cliente acima da dobra (components/beui/theme-selector.tsx) */}
          <div className="menu-acoes">
            <ThemeSelector name="tema-site" label />
            <a href="/entrar" className="pill">
              Entrar
            </a>
          </div>
          <button
            type="button"
            popoverTarget="menu"
            popoverTargetAction="hide"
            aria-label="Fechar o menu"
            className="menu-fechar lg:hidden"
          />
        </nav>
      </div>
    </header>
  );
}

// O rodapé grande do Rallies (plano, d.8): as colunas de links (a navegação "Mapa do site") e a marca à direita; depois, no mesmo `<footer>`,
// o aviso fixo, as atribuições e o aviso de marca (rodape.tsx, o mesmo do app), o © e, cortado no pé, o nome gigante (a sans 600 na tinta a
// 6%, decorativo: o texto mora no CSS, `.nome-gigante`, fora do que o leitor de tela e o axe leem).
const COLUNAS = [
  [
    'Arena',
    [
      ['Arena', '/arena'],
      ['Ranking', '/ranking'],
      ['Explorar', '/explorar'],
      ['Ações', '/acoes'],
      ['Notícias', '/noticias'],
    ],
  ],
  [
    'Projeto',
    [
      ['Como funciona', '/como-funciona'],
      ['Chat', '/chat'],
    ],
  ],
  [
    'Conta',
    [
      ['Entrar', '/entrar'],
      ['Criar conta', '/cadastro'],
      ['Carteira', '/carteira'],
      ['Minha conta', '/conta'],
    ],
  ],
  [
    'Legal',
    [
      ['Termos de uso', '/termos'],
      ['Política de privacidade', '/privacidade'],
    ],
  ],
] as const;

// A casca inteira do site: o cabeçalho, o principal na coluna de 1280 px com a calha (a largura do Rallies: 1216 px de conteúdo) e o rodapé
// grande. O `overflow-x: clip` corta o que passaria da largura.
export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <div className="site-coluna flex min-w-0 flex-1 flex-col overflow-x-clip">
        <main className="mx-auto w-full max-w-7xl flex-1 space-y-8 px-(--calha) pt-6 pb-12">
          {children}
        </main>
        <div className="mx-auto w-full max-w-7xl px-(--calha) pt-20">
          <nav aria-label="Mapa do site" className="mapa">
            {COLUNAS.map(([title, links]) => (
              <div key={title}>
                <h2>{title}</h2>
                <ul>
                  {links.map(([label, href]) => (
                    <li key={href}>
                      <NavLink href={href}>{label}</NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <span className="mapa-marca">
              <Marca size={28} />
            </span>
          </nav>
          <Rodape className="mt-16 space-y-4 text-sm text-muted">
            <p>© 2026 Alvesting · projeto de TCC</p>
            <span aria-hidden="true" className="nome-gigante" />
          </Rodape>
        </div>
      </div>
    </>
  );
}
