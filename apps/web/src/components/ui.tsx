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

// O cabeçalho de página do Rallies: o h1 na sans 600 de 26 e o que o explica em muted, embaixo (a descrição herda a cor). `logo`: o logo do
// competidor ao lado do título, fora do texto dele, para a linha que quebrar no celular começar embaixo do nome e não embaixo do logo (o QA do
// fechamento, achado 5); o teto de 32 ch deixa "DeepSeek V4 Pro (0813)" numa linha no desktop.
export const PageHead = ({
  title,
  logo,
  children,
}: {
  title: ReactNode;
  logo?: ReactNode;
  children?: ReactNode;
}) => (
  <header className="space-y-2 pb-6 text-muted">
    {logo ? (
      <div className="flex items-start gap-3">
        <span className="shrink-0 pt-0.5">{logo}</span>
        <h1 className="max-w-[32ch] min-w-0 font-display text-26 text-balance">{title}</h1>
      </div>
    ) : (
      <h1 className="max-w-[32ch] font-display text-26 text-balance">{title}</h1>
    )}
    {children}
  </header>
);

// Uma seção da página: 48 px de respiro, o título na sans 600 de 22 e o conteúdo. A região tem o nome do título, que é como o leitor de tela e
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
// (globals.css, `.tabela-rola`): a borda da direita esmaece enquanto há mais para lá, e com o mouse o "›" redondo da faixa rola a tabela. O
// botão se põe sobre a caixa pela casca de fora (`.tabela`).
export const TableScroll = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="tabela">
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="tabela-rola overflow-x-auto rounded-lg border border-hairline bg-canvas"
    >
      {children}
    </div>
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
