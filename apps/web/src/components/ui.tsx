import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

// As peças comuns das telas da arena (etapa 9, parte 2): o link, a seção, o par termo/valor, o texto de estado vazio e a rolagem da
// tabela. Estética crua (src/app/globals.css). Server Components: o único JavaScript que levam ao navegador é o `Link` do Next, no NavLink.

// Todo link e todo botão tem alvo de toque de pelo menos 44 px (plano §13), na altura e na largura. Por isso o link é um bloco em linha
// (inline-flex), e o texto corrido não leva link no meio da frase. As classes estão em src/app/globals.css (@layer components).
export const LINK = 'link';
export const BUTTON = 'btn';
export const INPUT = 'field';

// O link interno. Sem prefetch: toda tela da arena é dinâmica, e pré-carregar as dezenas de links de uma página só geraria pedidos à
// api que ninguém fez. O endereço é um <a href> comum, então funciona sem JavaScript.
export const NavLink = (props: ComponentProps<typeof Link>) => <Link prefetch={false} {...props} />;

// Uma seção da página: a região tem o nome do título, que é como o leitor de tela e o e2e a encontram.
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
    <section id={id} aria-labelledby={`${id}-titulo`} className="border-t-2 border-ink pt-4">
      <h2 id={`${id}-titulo`} className="font-mono text-lg font-semibold">
        {title}
      </h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  );
}

// Os pares termo/valor. Em tela estreita o termo fica em cima do valor; `dense` põe dois pares por linha (resultado com muitos números),
// e a partir de sm os dois ficam lado a lado.
export const Facts = ({ children, dense = false }: { children: ReactNode; dense?: boolean }) => (
  <dl
    className={`grid gap-y-3 sm:grid-cols-[max-content_1fr] sm:gap-x-6 sm:gap-y-2 ${dense ? 'grid-cols-2 gap-x-4' : 'grid-cols-1'}`}
  >
    {children}
  </dl>
);

// `prose`: o valor é texto corrido (regra, frase), em fonte de texto; o resto é número ou código, em fonte mono.
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
  <div className={`flex flex-col sm:contents ${wide ? 'col-span-2' : ''}`}>
    <dt className="muted">{term}</dt>
    <dd className={prose ? 'max-w-prose' : 'font-mono tabular-nums'}>{children}</dd>
  </div>
);

// A faixa: os pares lado a lado em células separadas por uma linha preta (as cotações da home, a contagem do último ciclo). O fundo preto
// aparece pelo vão de 1 px entre as células de papel.
export const Strip = ({ children, columns }: { children: ReactNode; columns: 3 | 6 }) => (
  <dl
    className={`grid gap-px border-2 border-ink bg-ink ${columns === 3 ? 'grid-cols-3' : 'grid-cols-2 md:grid-cols-3 lg:grid-cols-6 lg:[&_dd]:text-sm'}`}
  >
    {children}
  </dl>
);
export const StripItem = ({ term, children }: { term: string; children: ReactNode }) => (
  <div className="bg-paper p-3">
    <dt className="muted">{term}</dt>
    <dd className="font-mono tabular-nums">{children}</dd>
  </div>
);

// Nada para mostrar ainda: a tela diz o que falta em vez de ficar em branco.
export const Empty = ({ children }: { children: ReactNode }) => (
  <p className="border-2 border-dashed border-ink p-3">{children}</p>
);

// A tabela larga rola dentro da própria caixa, nunca a página (WCAG 1.4.10 deixa a tabela de dados em duas dimensões). A caixa recebe
// o foco do teclado e tem nome, para quem não usa o mouse poder rolar.
export const TableScroll = ({ label, children }: { label: string; children: ReactNode }) => (
  <div
    role="region"
    aria-label={label}
    tabIndex={0}
    className="overflow-x-auto border-2 border-ink"
  >
    {children}
  </div>
);

// Um campo de busca que é um formulário GET comum: funciona sem JavaScript, e a URL guarda o que foi buscado. `capitalize`: o campo que
// só aceita ticker põe o teclado do celular em caixa alta; o que também aceita nome, não. `invalidId`: o id do aviso (role="alert", na
// página) que diz por que o valor digitado não vale, ligado ao campo para o leitor de tela.
export function SearchForm({
  action,
  name,
  label,
  button,
  defaultValue,
  maxLength,
  capitalize = 'off',
  invalidId,
}: {
  action: string;
  name: string;
  label: string;
  button: string;
  defaultValue?: string | undefined;
  maxLength: number;
  capitalize?: 'characters' | 'off';
  invalidId?: string | undefined;
}) {
  const id = `campo-${name}`;
  return (
    <form action={action} method="get" role="search" className="flex items-end gap-2">
      <div className="flex min-w-0 flex-1 flex-col sm:max-w-xs">
        <label htmlFor={id} className="muted">
          {label}
        </label>
        {/* a chave é o valor da URL: o campo não controlado recomeça quando o filtro muda (o "Limpar filtro" é uma navegação suave, e
            sem ela o que o leitor digitou ficaria no campo, com a lista já sem filtro) */}
        <input
          key={defaultValue ?? ''}
          id={id}
          name={name}
          defaultValue={defaultValue}
          maxLength={maxLength}
          autoComplete="off"
          autoCapitalize={capitalize}
          enterKeyHint="search"
          spellCheck={false}
          aria-invalid={invalidId ? true : undefined}
          aria-describedby={invalidId}
          className={INPUT}
        />
      </div>
      <button type="submit" className={BUTTON}>
        {button}
      </button>
    </form>
  );
}

export const TABLE = 'tbl';
export const TH = 'th';
export const TD = 'td';
export const ROW = 'row';
