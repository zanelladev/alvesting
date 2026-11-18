import type { ReactNode } from 'react';
import { ThemeSelector } from './beui/theme-selector';
import { IconeMenu, Marca } from './icones';
import { Rodape } from './rodape';
import { NavLink } from './ui';

// A casca do site (ADR 0041): a landing, o Como funciona, os textos legais e a 404 (as telas de entrar e criar conta moram na casca do app,
// no grupo (auth)). A página regrada: o cabeçalho numa faixa, com a marca e os links à esquerda e o tema e "Entrar" à direita; o
// principal é uma folha de faixas (cada página monta as dela; `Faixa`, em ui.tsx, é a de uma coluna só); e o rodapé na faixa escura. O
// painel de admin, a carteira e a conta ficam na casca do app; o cabeçalho não lê a sessão (as páginas públicas não a leem: protege o LCP
// da home e o cache de dados delas), então os links são os mesmos para quem entrou ou não.
const NAV = [
  ['Arena', '/arena'],
  ['Ranking', '/ranking'],
  ['Explorar', '/explorar'],
  ['Como funciona', '/como-funciona'],
] as const;

// O cabeçalho do site: 68 px, preso no topo, numa faixa da página regrada (os fios verticais da coluna passam por ele). Uma `nav` só, com os
// links e "Entrar": a partir de 1024 px, os links logo depois da marca e "Entrar" à direita; abaixo disso, uma folha `popover` aberta pelo
// botão "Menu" (que vira um ✕), sem JavaScript. A folha vai até o pé da tela, e o resto dela, embaixo dos links, é o botão "Fechar o
// menu": o toque ali fecha a folha e não chega à página de baixo, que sai de vista e da ordem do Tab enquanto a folha está aberta
// (globals.css). O Esc também fecha.
// Os links do menu são `<a>` comuns, e não o `Link` do Next: a folha aberta continuaria aberta sobre a página nova numa navegação suave
// (fechá-la pediria JavaScript). A navegação inteira a fecha, e o leitor de tela anuncia a página nova.
export function SiteHeader() {
  return (
    <header className="topo linha">
      <div className="coluna">
        <div className="cabecalho">
          <NavLink
            href="/"
            className="inline-flex min-h-11 items-center gap-2.5 font-marca text-lg font-semibold text-ink"
          >
            <Marca size={22} />
            Alvesting
          </NavLink>
          <button
            type="button"
            popoverTarget="menu"
            className="btn-menu btn size-11 px-0 lg:hidden"
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
            {/* o seletor de tema antes de "Entrar" (na folha, a linha "Tema"); ele não carrega biblioteca nenhuma: a landing segue sem
                JavaScript de cliente acima da dobra (components/beui/theme-selector.tsx) */}
            <div className="menu-acoes">
              <ThemeSelector name="tema-site" label />
              <a href="/entrar" className="btn">
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
      </div>
    </header>
  );
}

// O rodapé do site, na faixa escura: o mapa do site em colunas (a navegação "Mapa do site") com a marca; embaixo, o `<footer>` com o aviso
// fixo, as atribuições e o aviso de marca (rodape.tsx, o mesmo do app) e o ©.
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

// A casca inteira do site: o cabeçalho, o principal (a folha das faixas de cada página) e o rodapé na faixa escura. O `overflow-x: clip`
// corta o que passaria da largura (a janela do produto do topo da landing sai pela borda da coluna).
export function SiteShell({ children }: { children: ReactNode }) {
  return (
    <>
      <SiteHeader />
      <div className="site-coluna folha min-w-0 flex-1 overflow-x-clip">
        <main className="folha">{children}</main>
        <div className="linha escura">
          <div className="coluna rodape-site">
            <nav aria-label="Mapa do site" className="mapa">
              <div className="col-span-2 flex flex-col gap-3.5 md:col-span-1">
                <span className="inline-flex items-center gap-2.5 font-marca text-lg font-semibold text-escuro-tinta">
                  <Marca size={22} />
                  Alvesting
                </span>
                <p className="max-w-[30ch] text-13 text-escuro-tinta/62">
                  Arena acadêmica de modelos de linguagem na B3, com dinheiro fictício.
                </p>
              </div>
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
            </nav>
            <Rodape className="space-y-4 pt-8">
              <p>© 2026 Alvesting · projeto de TCC</p>
            </Rodape>
          </div>
        </div>
      </div>
    </>
  );
}
