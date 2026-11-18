import type { ReactNode } from 'react';
import { ThemeSelector } from './beui/theme-selector';
import {
  IconeArena,
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

// A casca do app (ADR 0041): a arena, o explorar, a carteira, o chat e a conta. Um componente de servidor, sem JavaScript: cada área tem
// um layout (app/(app)/(área)/layout.tsx) que diz qual é ela, e o item dela leva `aria-current="page"`. A troca de área remonta a casca (é
// de servidor, custa pouco).
// Uma `nav "Principal"` só, dentro do `<header>` (o banner, com o link "Alvesting"), desenhada de dois jeitos pelo CSS (globals.css): a
// partir de 1024 px, a lateral de 248 px, com o ícone ao lado do rótulo em cada item, e o tema e a conta no pé; abaixo disso, a marca numa
// linha no topo e a barra de abas fixa no pé, com seis itens (Arena, Explorar, Carteira, Chat, Mais e Conta: 60 × 56 px em 360; o tema mora
// no "Mais"). O "Mais" abre um `popover` com as telas de apoio. Os itens e os links da folha são `<a>` comuns: numa navegação suave dentro
// da mesma área a casca não remonta, e a folha aberta ficaria aberta sobre a página nova. A marca fica fora da folha (o toque nela a fecha
// antes) e usa o Link do Next, como a marca do site. A busca mora nas telas (o Explorar e as Ações), e não na casca.
// O principal é a página regrada: a partir de 1024 px, a lateral e a coluna de até 1.040 px ficam juntas, com um fio só entre as duas, e o
// conjunto fica no centro, entre as duas células de fora (o ::before e o ::after de `.app`); o rodapé, na mesma coluna, embaixo.
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
    <div className="app">
      <header className="app-topo">
        <NavLink
          href="/"
          className="app-marca inline-flex min-h-11 min-w-11 items-center gap-2.5 font-marca text-lg font-semibold text-ink"
        >
          <Marca size={22} />
          Alvesting
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
            {/* o seletor de tema no pé da lateral, acima de "Conta" (no celular ele mora na folha "Mais") */}
            <li className="app-tema">
              <ThemeSelector name="tema-trilho" label />
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
              a folha do site; a página coberta sai de vista e da ordem do Tab); no desktop, um menu curto ao lado do item "Mais", que deixa a
              coluna à vista. O Esc e o toque fora dela também fecham. */}
          <div id="mais" popover="auto" className="mais">
            <div className="mais-topo">
              <p className="text-20 font-semibold text-ink">Mais</p>
              <button
                type="button"
                popoverTarget="mais"
                popoverTargetAction="hide"
                aria-label="Fechar o menu"
                className="btn size-11 px-0"
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
        <main className="app-principal">
          <div className="coluna-app">{children}</div>
        </main>
        <div className="app-rodape">
          <Rodape className="space-y-3 px-5 pt-8 pb-10 text-xs text-muted lg:px-6" />
        </div>
      </div>
    </div>
  );
}
