import Link from 'next/link';
import type { ComponentProps, CSSProperties, ReactNode } from 'react';
import type { PublicCompetitor } from '@alvesting/contracts';
import type { BlockChart } from '../lib/ascii';

// As peças comuns das telas (etapa 9, parte 2; o sistema visual ascii-ui, ADR 0034): o link, a linha da moldura, o cabeçalho de página, a
// seção, o par termo/valor, a faixa de números, o texto de estado vazio e a rolagem da tabela. Server Components: o único JavaScript que
// levam ao navegador é o `Link` do Next, no NavLink. As classes que se repetem estão em src/app/globals.css (@layer components).

// Todo link e todo botão tem alvo de toque de pelo menos 44 px (plano §13), na altura e na largura. Por isso o link é um bloco em linha
// (inline-flex), e o texto corrido não leva link no meio da frase.
export const LINK = 'link';
export const BUTTON = 'btn';
export const INPUT = 'field';

// O link interno. Sem prefetch: toda tela da arena é dinâmica, e pré-carregar as dezenas de links de uma página só geraria pedidos à
// api que ninguém fez. O endereço é um <a href> comum, então funciona sem JavaScript.
export const NavLink = (props: ComponentProps<typeof Link>) => <Link prefetch={false} {...props} />;

// A linha da moldura (globals.css, `.rule`): de ponta a ponta da tela, com o losango onde cruza as laterais. Só como filho de quem ocupa a
// coluna inteira (o main, o layout ou uma seção dele).
export const Rule = () => <div aria-hidden="true" className="rule" />;

// O título do hero da home e o da 404 (a mesma gramática): de 36 a 56 px com a tela, a linha de 1,1, a Geist 500.
export const HERO_TITLE =
  'max-w-[17ch] font-display text-[clamp(2.25rem,1.1rem+3.4vw,3.5rem)] leading-[1.1] font-medium tracking-[-0.03em] text-balance';

// O cabeçalho de página: o h1 e o que o explica, fechado pela linha da moldura (a seção seguinte abre 48 px abaixo: a faixa vazia).
export const PageHead = ({ title, children }: { title: ReactNode; children?: ReactNode }) => (
  <div>
    <header className="space-y-3 pt-6 pb-12">
      <h1 className="max-w-[24ch] font-display text-display-lg text-balance">{title}</h1>
      {children}
    </header>
    <Rule />
  </div>
);

// Uma seção da página: a linha da moldura que fecha a de cima, 48 px, o título e o conteúdo. A região tem o nome do título, que é como o
// leitor de tela e o e2e a encontram.
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
      <Rule />
      <h2 id={`${id}-titulo`} className="pt-12 pb-6 font-display text-display-md">
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

// A faixa de números (a `stats-band` do Arc, dividida): os pares lado a lado em células separadas por um fio, que aparece pelo vão de 1 px
// entre as células de canvas. Sem borda de fora: na home ela fica entre duas linhas da moldura.
export const Strip = ({ children, columns }: { children: ReactNode; columns: 3 | 6 }) => (
  <dl
    className={`grid gap-px bg-hairline ${columns === 3 ? 'grid-cols-3 [&_dd]:text-display-md' : 'grid-cols-2 md:grid-cols-3 xl:grid-cols-6'}`}
  >
    {children}
  </dl>
);
export const StripItem = ({ term, children }: { term: string; children: ReactNode }) => (
  <div className="flex min-w-0 flex-col gap-2 bg-canvas px-(--calha) py-6 xl:px-5">
    <dt className="text-sm text-muted">{term}</dt>
    <dd className="font-display text-lg font-medium text-ink tabular-nums">{children}</dd>
  </div>
);

// O gráfico em blocos (lib/ascii.ts) com as camadas na mesma grade, a de cima cobrindo a de baixo. A fonte enche a largura (`cqi`) a 0,61 em
// por coluna (o avanço da mono do sistema, com folga), arredondada para baixo em pixel inteiro: fileira em fração de pixel deixa fresta entre
// os blocos. Decorativo: o mesmo dado está em texto ao lado.
const TONE = { ink: 'text-body', soft: 'text-hairline-strong' } as const;
export function AsciiChart({ chart }: { chart: BlockChart }) {
  const cols = Math.max(1, ...chart.layers.flatMap((l) => l.lines.map((s) => s.length)));
  return (
    <div aria-hidden="true" className="@container w-full">
      <div
        className="grid text-[calc(100cqi/var(--cols))] [font-size:round(down,calc(100cqi/var(--cols)),1px)]"
        style={{ '--cols': (cols * 0.61).toFixed(2) } as CSSProperties}
      >
        {chart.layers.map((layer, i) => (
          <pre key={i} className={`ascii-block [grid-area:1/1] ${TONE[layer.tone]}`}>
            {layer.lines.join('\n')}
          </pre>
        ))}
      </div>
    </div>
  );
}

// Nada para mostrar ainda: a tela diz o que falta em vez de ficar em branco.
export const Empty = ({ children }: { children: ReactNode }) => <p className="vazio">{children}</p>;

// A caixa de recado (o status de um formulário, o aviso de página) e a de erro, com o fio vermelho (o erro do formulário, a leitura que
// falhou): o mesmo desenho em toda tela, num lugar só (docs/TELAS.md, seção 10).
export const CAIXA = 'rounded-control border border-hairline-strong bg-surface-card p-4 text-ink';
export const CAIXA_ERRO =
  'rounded-control border border-semantic-error/60 bg-surface-card p-4 text-ink';

// O aviso de página: `[!]` em cinza numa caixa. Não há cor de aviso no sistema visual: o âmbar leria como "escolhido".
export const Aviso = ({ children, className }: { children: ReactNode; className?: string }) => (
  <p className={`${className ? `${className} ` : ''}flex max-w-2xl gap-3 ${CAIXA}`}>
    <span aria-hidden="true" className="font-mono text-muted">
      [!]
    </span>
    <span className="min-w-0">{children}</span>
  </p>
);

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
    className="overflow-x-auto rounded-panel border border-hairline bg-surface-card"
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
      <div className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-xs">
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
