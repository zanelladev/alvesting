import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import type { PublicCompetitor } from '@alvesting/contracts';
import { IconeBuscar } from './icones';

// As peças comuns das telas (o sistema visual, ADR 0041): o link, o cabeçalho de página, a seção, o par termo/valor, a faixa de
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

// O cabeçalho de página: o h1 de 34 px na sans 500 e, quando a tela tem, a segunda linha no apoio (`sub`: "Quem está ganhando depois de 17
// pregões."), em dois tons como os títulos da landing; o que explica vem embaixo, no apoio (a descrição herda a cor). `logo`: o logo do
// competidor ao lado do título, fora do texto dele, para a linha que quebrar no celular começar embaixo do nome e não embaixo do logo; o
// teto de 32 ch deixa "DeepSeek V4 Pro (0813)" numa linha no desktop.
export const PageHead = ({
  title,
  sub,
  logo,
  children,
}: {
  title: ReactNode;
  sub?: ReactNode;
  logo?: ReactNode;
  children?: ReactNode;
}) => (
  <header className="space-y-3 pb-6 text-muted">
    <div className={logo ? 'flex items-start gap-3' : undefined}>
      {logo ? <span className="shrink-0 pt-1">{logo}</span> : null}
      <div className="min-w-0">
        <h1 className="max-w-[32ch] text-pagina font-medium text-balance">{title}</h1>
        {sub ? (
          <p className="mt-1 text-xl tracking-[-0.02em] text-pretty text-muted lg:text-2xl">
            {sub}
          </p>
        ) : null}
      </div>
    </div>
    {children}
  </header>
);

// Uma faixa da página regrada com uma coluna só (globals.css, `.linha`): as páginas do site que não montam faixas próprias (o Como funciona,
// os textos legais, a 404) entram nela, com o respiro da coluna.
export const Faixa = ({ children }: { children: ReactNode }) => (
  <div className="linha">
    <div className="coluna px-5 pt-10 pb-16 lg:px-12 lg:pt-14 lg:pb-20">{children}</div>
  </div>
);

// A seção da página regrada (ADR 0041; a da arena é a mesma, arena/page.tsx, Bloco): uma faixa, com o fio de 1 px em cima e o título de
// 18 px na tinta (globals.css, `.secao`). No app o fio vai de uma borda à outra da coluna ou do painel (come o respiro: 20 px no celular, 24
// no desktop); nas páginas de leitura do site, ele acompanha a largura do texto.
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
    <section id={id} aria-labelledby={`${id}-titulo`} className="secao">
      <h2 id={`${id}-titulo`} className="secao-titulo">
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

// A faixa de números: os pares lado a lado em células separadas pelos fios da página regrada, que aparecem pelo vão de 1 px entre as
// células de canvas, de uma borda à outra da coluna (come o respiro dela, como a grade das cotações da arena).
export const Strip = ({ children, columns }: { children: ReactNode; columns: 3 | 6 }) => (
  <dl
    className={`-mx-5 grid gap-px border-y border-folha bg-folha lg:-mx-6 ${columns === 3 ? 'grid-cols-3 [&_dd]:text-26' : 'grid-cols-2 md:grid-cols-3 xl:grid-cols-6'}`}
  >
    {children}
  </dl>
);
export const StripItem = ({ term, children }: { term: string; children: ReactNode }) => (
  <div className="flex min-w-0 flex-col gap-2 bg-canvas px-5 py-5 lg:px-6">
    <dt className="text-sm text-muted">{term}</dt>
    <dd className="font-display text-lg font-semibold text-ink tabular-nums">{children}</dd>
  </div>
);

// Nada para mostrar ainda: a tela diz o que falta em vez de ficar em branco.
export const Empty = ({ children }: { children: ReactNode }) => <p className="vazio">{children}</p>;

// A caixa de erro, com o fio vermelho (o erro do formulário, a leitura que falhou): o mesmo desenho em toda tela, num lugar só (docs/TELAS.md,
// seção 10).
export const CAIXA_ERRO = 'rounded-lg border border-semantic-error/60 bg-surface-card p-4 text-ink';

// O aviso de página: o `[!]` em cinza numa linha discreta, sem caixa nem fundo (docs/DESIGN.md: a honestidade é obrigatória, o peso não), lido
// pelo leitor de tela como o parágrafo que é. Não há cor de aviso no sistema visual: a primária leria como "escolhido".
export const Aviso = ({ children, className }: { children: ReactNode; className?: string }) => (
  <p
    className={`${className ? `${className} ` : ''}flex max-w-2xl gap-2.5 text-sm text-pretty text-body`}
  >
    <span aria-hidden="true" className="shrink-0 font-medium text-muted">
      [!]
    </span>
    <span className="min-w-0">{children}</span>
  </p>
);

// A direção de um número com sinal, para o glifo ▲ ▼ ■ que o CSS põe antes dele (`[data-dir]` em globals.css): fora do texto, que o leitor de
// tela e o e2e leem. Só no número principal da linha (a Regra do Glifo, docs/DESIGN.md): o outro número com sinal da mesma linha leva só o
// sinal, na cor do texto. O que não existe ("—") fica sem.
export const direction = (value: number) => (value > 0 ? 'up' : value < 0 ? 'down' : 'flat');

// A arena simulada: o modelo cujas decisões vêm do provedor fake (os modelos ainda não estão conectados). O "simulado" aparece visível,
// discreto e uma vez por contexto (docs/DESIGN.md): a nota no cabeçalho da faixa, da tabela e da barra das carteiras, a etiqueta junto do
// título na página do modelo e no item de decisão sozinho, e o `Aviso` da página que mostra muitos. Quando o elenco passa ao provedor de
// verdade, tudo some sozinho. A etiqueta é a pílula cinza sem borda, de 20 px; o espaço antes dela vai junto (o texto lê "Nome simulado").
export const isSimulated = (competitor: Pick<PublicCompetitor, 'type' | 'provider'>): boolean =>
  competitor.type === 'MODEL' && competitor.provider === 'fake';
export const SimulatedTag = () => (
  <>
    {' '}
    <span className="inline-flex h-5 shrink-0 items-center rounded-full bg-surface-strong px-2 align-middle text-xs leading-none font-medium whitespace-nowrap text-muted">
      simulado
    </span>
  </>
);

// Quem a nota cobre: todos os modelos (a arena de hoje) ou os nomes dos simulados (uma temporada mista), para a nota nunca dizer que um modelo
// de verdade é simulado; a frase concorda com quantos são. Nenhum simulado: nada. `parcial`: a lista é só uma parte do elenco (o feed
// filtrado, antes da primeira liquidação), e então a nota nomeia os simulados que vê, sem concluir que são todos.
export function quemSimula(
  competitors: ReadonlyArray<Pick<PublicCompetitor, 'name' | 'type' | 'provider'>>,
  parcial = false,
): string | null {
  // um modelo por nome: o feed repete o modelo em cada decisão dele
  const models = [
    ...new Map(competitors.filter((c) => c.type === 'MODEL').map((c) => [c.name, c])).values(),
  ];
  const nomes = models.filter(isSimulated).map((c) => c.name);
  if (nomes.length === 0) return null;
  if (!parcial && nomes.length === models.length) return 'Os modelos ainda não estão conectados.';
  return nomes.length === 1
    ? `${nomes[0]} ainda não está conectado.`
    : `${nomes.slice(0, -1).join(', ')} e ${nomes.at(-1)} ainda não estão conectados.`;
}
// A nota do cabeçalho de uma peça (a faixa, a tabela, a barra das carteiras): a etiqueta e uma frase curta, numa linha.
export function NotaSimulada({
  competitors,
  className,
}: {
  competitors: ReadonlyArray<Pick<PublicCompetitor, 'name' | 'type' | 'provider'>>;
  className?: string;
}) {
  const frase = quemSimula(competitors);
  return frase ? (
    <p className={className ? `nota-simulada ${className}` : 'nota-simulada'}>
      <SimulatedTag /> {frase}
    </p>
  ) : null;
}

// A tabela larga rola dentro da própria caixa, nunca a página (WCAG 1.4.10 deixa a tabela de dados em duas dimensões). A caixa recebe
// o foco do teclado e tem nome, para quem não usa o mouse poder rolar. Sem a barra de rolagem à vista, a pista de que há mais colunas é só CSS
// (globals.css, `.tabela-rola`): a borda da direita esmaece enquanto há mais para lá. A caixa é a da página regrada: um fio em cima e outro
// embaixo, sem cantos (ADR 0041).
export const TableScroll = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="tabela">
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="tabela-rola overflow-x-auto border-y border-hairline bg-canvas"
    >
      {children}
    </div>
  </div>
);

// Um campo de busca que é um formulário GET comum: funciona sem JavaScript, e a URL guarda o que foi buscado. O desenho é o da busca do
// o mesmo em toda tela que busca (o Explorar, as ações, as notícias): a lupa e o texto de exemplo à vista, o rótulo para
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
// `page` para a tela, `true` para o filtro). O segmentado são as sub-telas de uma área no celular ("Arena | Ranking | Último ciclo") e as vistas
// da arena ("Decisões | Carteiras"); o `preto` é o filtro do feed, na sans 12/500 e com a pílula da primária. As abas são a linha do topo do
// principal, e a trilha é o "Início › Arena" do celular, que a própria página escreve (a casca não sabe o caminho).
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
export const Abas = ({ label, items }: { label: string; items: readonly ItemDeNavegacao[] }) => (
  <nav aria-label={label}>
    <ul className="abas">
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
