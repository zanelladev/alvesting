import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import type { PublicCompetitor } from '@alvesting/contracts';
import { IconeBuscar } from './icones';

// As peças comuns das telas (o sistema visual do Rallies, ADR 0035): o link, o cabeçalho de página, a seção, o par termo/valor, a faixa de
// números, o texto de estado vazio, a rolagem da tabela, e a navegação de dentro das telas (o segmentado, as abas e a trilha). Server
// Components: o único JavaScript que levam ao navegador é o `Link` do Next, no NavLink. As classes que se repetem estão em
// src/app/globals.css (@layer components).

// Todo link e todo botão tem alvo de toque de pelo menos 44 px (plano §13), na altura e na largura. Por isso o link é um bloco em linha
// (inline-flex), e o texto corrido não leva link no meio da frase.
export const LINK = 'link';
export const BUTTON = 'btn';
export const INPUT = 'field';

// O link interno. Sem prefetch: toda tela da arena é dinâmica, e pré-carregar as dezenas de links de uma página só geraria pedidos à
// api que ninguém fez. O endereço é um <a href> comum, então funciona sem JavaScript.
export const NavLink = (props: ComponentProps<typeof Link>) => <Link prefetch={false} {...props} />;

// O cabeçalho de página do Rallies: o h1 na Geist de 26 e o que o explica em muted, embaixo (a descrição herda a cor).
export const PageHead = ({ title, children }: { title: ReactNode; children?: ReactNode }) => (
  <header className="space-y-2 pb-6 text-muted">
    <h1 className="max-w-[24ch] font-display text-26 text-balance">{title}</h1>
    {children}
  </header>
);

// Uma seção da página: 48 px de respiro, o título na Geist de 22 e o conteúdo. A região tem o nome do título, que é como o leitor de tela e
// o e2e a encontram.
export function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-titulo`} className="mt-12">
      <h2 id={`${id}-titulo`} className="pb-4 font-display text-22">
        {title}
      </h2>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

// Os pares termo/valor, uma linha cada, divididas por um fio (o `Dl` da v1): o termo à esquerda, o valor à direita. `dense` põe dois pares
// por linha a partir de sm (resultado com muitos números).
export const Facts = ({ children, dense = false }: { children: ReactNode; dense?: boolean }) => (
  <dl className={`grid gap-x-8 ${dense ? 'sm:grid-cols-2' : ''}`}>{children}</dl>
);

// `prose`: o valor é texto corrido (regra, frase), embaixo do termo e alinhado à esquerda; o resto é número ou nome, à direita, tabular.
export const Fact = ({
  term,
  children,
  prose = false,
  wide = false,
}: {
  term: string;
  children: ReactNode;
  prose?: boolean;
  // numa lista `dense`, o par ocupa a linha inteira (um nome comprido)
  wide?: boolean;
}) => (
  <div
    className={`flex min-w-0 gap-x-4 gap-y-1 border-b border-hairline py-3 ${prose ? 'flex-col' : 'items-baseline justify-between'} ${wide ? 'sm:col-span-2' : ''}`}
  >
    <dt className="shrink-0 text-sm text-muted">{term}</dt>
    <dd className={`min-w-0 text-ink ${prose ? 'max-w-prose' : 'text-right tabular-nums'}`}>
      {children}
    </dd>
  </div>
);

// A faixa de números (a faixa dos modelos do Rallies): os pares lado a lado em células separadas por um fio, que aparece pelo vão de 1 px
// entre as células de canvas.
export const Strip = ({ children, columns }: { children: ReactNode; columns: 3 | 6 }) => (
  <dl
    className={`grid gap-px bg-hairline ${columns === 3 ? 'grid-cols-3 [&_dd]:text-26' : 'grid-cols-2 md:grid-cols-3 xl:grid-cols-6'}`}
  >
    {children}
  </dl>
);
export const StripItem = ({ term, children }: { term: string; children: ReactNode }) => (
  <div className="flex min-w-0 flex-col gap-2 bg-canvas px-(--calha) py-6 xl:px-5">
    <dt className="text-sm text-muted">{term}</dt>
    <dd className="font-display text-lg font-semibold text-ink tabular-nums">{children}</dd>
  </div>
);

// Nada para mostrar ainda: a tela diz o que falta em vez de ficar em branco.
export const Empty = ({ children }: { children: ReactNode }) => <p className="vazio">{children}</p>;

// A caixa de recado (o status de um formulário, o aviso de página) e a de erro, com o fio vermelho (o erro do formulário, a leitura que
// falhou): o mesmo desenho em toda tela, num lugar só (docs/TELAS.md, seção 10).
export const CAIXA = 'rounded-lg border border-hairline bg-surface-card p-4 text-ink';
export const CAIXA_ERRO = 'rounded-lg border border-semantic-error/60 bg-surface-card p-4 text-ink';

// O aviso de página: `[!]` em cinza numa caixa. Não há cor de aviso no sistema visual: o âmbar leria como "escolhido".
export const Aviso = ({ children, className }: { children: ReactNode; className?: string }) => (
  <p className={`${className ? `${className} ` : ''}flex max-w-2xl gap-3 ${CAIXA}`}>
    <span aria-hidden="true" className="font-mono text-muted">
      [!]
    </span>
    <span className="min-w-0">{children}</span>
  </p>
);

// A direção de um número com sinal, para o glifo ▲ ▼ ■ que o CSS põe antes dele (`[data-dir]` em globals.css): fora do texto, que o leitor de
// tela e o e2e leem. Só em valor com sinal; o que não existe ("—") fica sem.
export const direction = (value: number) => (value > 0 ? 'up' : value < 0 ? 'down' : 'flat');

// A arena simulada: o modelo cujas decisões vêm do provedor fake (os modelos ainda não estão conectados) leva a etiqueta "simulado"
// logo depois do nome, onde o nome aparece. A borda tracejada, como a do HOLD, se lê sem cor. Quando o elenco passa ao provedor de
// verdade, a etiqueta some sozinha. O espaço antes dela vai junto: o leitor de tela e o texto da linha leem "Nome simulado".
export const isSimulated = (competitor: Pick<PublicCompetitor, 'type' | 'provider'>): boolean =>
  competitor.type === 'MODEL' && competitor.provider === 'fake';
export const SimulatedTag = () => (
  <>
    {' '}
    <span className="badge border-dashed">simulado</span>
  </>
);

// A tabela larga rola dentro da própria caixa, nunca a página (WCAG 1.4.10 deixa a tabela de dados em duas dimensões). A caixa recebe
// o foco do teclado e tem nome, para quem não usa o mouse poder rolar.
export const TableScroll = ({ label, children }: { label: string; children: ReactNode }) => (
  <div
    role="region"
    aria-label={label}
    tabIndex={0}
    className="overflow-x-auto rounded-lg border border-hairline bg-canvas"
  >
    {children}
  </div>
);

// Um campo de busca que é um formulário GET comum: funciona sem JavaScript, e a URL guarda o que foi buscado. O desenho é o da busca do
// Discover do Rallies, o mesmo em toda tela que busca (o Explorar, as ações, as notícias): a lupa e o texto de exemplo à vista, o rótulo para
// o leitor de tela. `capitalize`: o campo que só aceita ticker põe o teclado do celular em caixa alta; o que também aceita nome, não.
// `invalidId`: o id do aviso (role="alert", na página) que diz por que o valor digitado não vale, ligado ao campo para o leitor de tela.
export function SearchForm({
  action,
  name,
  label,
  placeholder,
  button,
  defaultValue,
  maxLength,
  capitalize = 'off',
  invalidId,
}: {
  action: string;
  name: string;
  label: string;
  placeholder: string;
  button: string;
  defaultValue?: string | undefined;
  maxLength: number;
  capitalize?: 'characters' | 'off';
  invalidId?: string | undefined;
}) {
  const id = `campo-${name}`;
  return (
    <form action={action} method="get" role="search" className="flex items-center gap-2">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="relative min-w-0 flex-1 sm:max-w-sm">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted">
          <IconeBuscar />
        </span>
        {/* a chave é o valor da URL: o campo não controlado recomeça quando o filtro muda (o "Limpar filtro" é uma navegação suave, e
            sem ela o que o leitor digitou ficaria no campo, com a lista já sem filtro) */}
        <input
          key={defaultValue ?? ''}
          id={id}
          name={name}
          defaultValue={defaultValue}
          maxLength={maxLength}
          placeholder={placeholder}
          autoComplete="off"
          autoCapitalize={capitalize}
          enterKeyHint="search"
          spellCheck={false}
          aria-invalid={invalidId ? true : undefined}
          aria-describedby={invalidId}
          className={`${INPUT} w-full rounded-xl pl-10`}
        />
      </div>
      <button type="submit" className={BUTTON}>
        {button}
      </button>
    </form>
  );
}

// A navegação de dentro das telas (plano, c.2). Os itens são links com a caixa de 44 px; o escolhido leva `aria-current` (o valor de cada um:
// `page` para a tela, `true` para o filtro). O segmentado são as sub-telas de uma área no celular ("Arena | Ranking | Último ciclo"; o
// `preto` é o filtro do feed, mono e com a pílula preta), as abas são a linha do topo do principal (as `grandes`, os títulos de aba do
// celular, na Geist de 20) e a trilha é o "Início › Arena" do celular, que a própria página escreve (a casca não sabe o caminho).
export interface ItemDeNavegacao {
  label: string;
  href: string;
  atual?: 'page' | 'true' | undefined;
}
export const Segmentado = ({
  label,
  items,
  preto = false,
}: {
  label: string;
  items: readonly ItemDeNavegacao[];
  preto?: boolean;
}) => (
  <nav aria-label={label}>
    <ul className={preto ? 'segmentado segmentado-preto' : 'segmentado'}>
      {items.map((item) => (
        <li key={item.href}>
          <NavLink href={item.href} aria-current={item.atual}>
            {item.label}
          </NavLink>
        </li>
      ))}
    </ul>
  </nav>
);
export const Abas = ({
  label,
  items,
  grandes = false,
}: {
  label: string;
  items: readonly ItemDeNavegacao[];
  grandes?: boolean;
}) => (
  <nav aria-label={label}>
    <ul className={grandes ? 'abas abas-grandes' : 'abas'}>
      {items.map((item) => (
        <li key={item.href}>
          <NavLink href={item.href} aria-current={item.atual}>
            {item.label}
          </NavLink>
        </li>
      ))}
    </ul>
  </nav>
);
// o último item é a tela atual, em texto
export const Trilha = ({ items }: { items: readonly { label: string; href?: string }[] }) => (
  <nav aria-label="Trilha">
    <ol className="trilha">
      {items.map((item, i) => (
        <li key={item.label} className="flex items-center gap-x-1.5">
          {i > 0 ? <span aria-hidden="true">›</span> : null}
          {item.href ? (
            <NavLink href={item.href}>{item.label}</NavLink>
          ) : (
            <span aria-current="page" className="text-ink">
              {item.label}
            </span>
          )}
        </li>
      ))}
    </ol>
  </nav>
);

export const TABLE = 'tbl';
export const TH = 'th';
export const TD = 'td';
export const ROW = 'row';
