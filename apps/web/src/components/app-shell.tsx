import type { ReactNode } from 'react';
import { ThemeSelector } from './beui/theme-selector';
import {
  IconeArena,
  IconeBuscar,
  IconeCarteira,
  IconeChat,
  IconeConta,
  IconeExplorar,
  IconeFechar,
  IconeMais,
  Marca,
} from './icones';
import { Rodape } from './rodape';
import { NavLink } from './ui';

// A casca do app (ADR 0035; docs/redesign-rallies/plano.md, c.2): a arena, o explorar, a carteira, o chat e a conta. Um componente de
// servidor, sem JavaScript: cada área tem um layout (app/(app)/(área)/layout.tsx) que diz qual é ela, e o item dela leva
// `aria-current="page"`. A troca de área remonta a casca (é de servidor, custa pouco).
// Uma `nav "Principal"` só, dentro do `<header>` (o banner, com o link "Alvesting"), desenhada de dois jeitos pelo CSS (globals.css): a
// partir de 1024 px, o trilho de ícones de 80 px à esquerda, com "Buscar" e "Conta" embaixo; abaixo disso, a marca numa linha no topo e a
// barra de abas fixa no pé, com seis itens (Arena, Explorar, Carteira, Chat, Mais e Conta: 60 × 56 px em 360). O "Mais" abre um `popover`
// com as telas de apoio. Os itens e os links da folha são `<a>` comuns: numa navegação suave dentro da mesma área a casca não
// remonta, e a folha aberta ficaria aberta sobre a página nova. A marca e o "Buscar" ficam fora da folha (o toque neles a fecha antes) e
// usam o Link do Next, como a marca do site.
// O cabeçalho não lê a sessão (não há avatar): a carteira e a conta mandam quem não entrou para a entrada.
export type Area = 'arena' | 'explorar' | 'carteira' | 'chat' | 'conta';

const ITENS = [
  ['arena', 'Arena', '/arena', IconeArena],
  ['explorar', 'Explorar', '/explorar', IconeExplorar],
  ['carteira', 'Carteira', '/carteira', IconeCarteira],
  ['chat', 'Chat', '/chat', IconeChat],
] as const;

// as telas que não têm item próprio (a folha "Mais")
const MAIS = [
  ['Como funciona', '/como-funciona'],
  ['Notícias', '/noticias'],
  ['Ações', '/acoes'],
  ['Termos de uso', '/termos'],
  ['Política de privacidade', '/privacidade'],
] as const;

export function AppShell({ area, children }: { area: Area; children: ReactNode }) {
  const atual = (id: Area) => (id === area ? 'page' : undefined);
  return (
    <div className="app flex min-w-0 flex-1 flex-col">
      <header className="app-topo">
        <NavLink
          href="/"
          className="inline-flex min-h-11 min-w-11 items-center justify-center gap-2"
        >
          <Marca size={24} />
          <span className="font-display text-base font-semibold text-ink lg:sr-only">
            Alvesting
          </span>
        </NavLink>
        <nav aria-label="Principal" className="app-nav">
          <ul className="app-itens">
            {ITENS.map(([id, label, href, Icone]) => (
              <li key={id}>
                <a href={href} aria-current={atual(id)} className="app-item">
                  <span className="app-icone">
                    <Icone />
                  </span>
                  {label}
                </a>
              </li>
            ))}
            <li>
              <button type="button" popoverTarget="mais" className="app-item app-mais">
                <span className="app-icone">
                  <IconeMais />
                </span>
                Mais
              </button>
            </li>
            <li className="app-buscar">
              <NavLink href="/acoes" className="app-item">
                <span className="app-icone">
                  <IconeBuscar />
                </span>
                Buscar
              </NavLink>
            </li>
            {/* o seletor de tema no pé do trilho, perto de "Conta" (no celular ele mora na folha "Mais") */}
            <li className="app-tema">
              <ThemeSelector name="tema-trilho" vertical label />
            </li>
            <li>
              <a href="/conta" aria-current={atual('conta')} className="app-item">
                <span className="app-icone">
                  <IconeConta />
                </span>
                Conta
              </a>
            </li>
          </ul>
          {/* A folha "Mais" (globals.css): no celular, a tela inteira acima da barra de abas, com o título, o ✕ e a lista dentro dela (como
              a folha do site; a página coberta sai de vista e da ordem do Tab); no desktop, um menu curto ancorado no item "Mais", que deixa a
              coluna à vista. O Esc e o toque fora dela também fecham. */}
          <div id="mais" popover="auto" className="mais">
            <div className="mais-topo">
              <p className="font-display text-20 font-semibold text-ink">Mais</p>
              <button
                type="button"
                popoverTarget="mais"
                popoverTargetAction="hide"
                aria-label="Fechar o menu"
                className="inline-flex size-11 items-center justify-center rounded-xl bg-surface-strong text-ink hover:bg-hairline"
              >
                <IconeFechar />
              </button>
            </div>
            <ul className="mais-folha">
              {MAIS.map(([label, href]) => (
                <li key={href}>
                  <a href={href}>{label}</a>
                </li>
              ))}
            </ul>
            <div className="mais-tema">
              <ThemeSelector name="tema-mais" label />
            </div>
          </div>
        </nav>
      </header>
      <div className="app-coluna flex min-w-0 flex-1 flex-col">
        {/* sem teto até a coluna do app (1.550 px, centrada, com o fio de cada lado: globals.css, `.app`): o Discover e a Arena do Rallies
            enchem a tela; cada tela diz a largura do próprio texto */}
        <main className="w-full flex-1 px-5 py-6 lg:px-6">{children}</main>
        <Rodape className="space-y-3 border-t border-hairline px-5 pt-8 pb-10 text-xs text-muted lg:px-6" />
      </div>
    </div>
  );
}
