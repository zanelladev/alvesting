import type { LeaderboardRow, PublicCompetitor } from '@alvesting/contracts';
import { formatBps, formatPercentile } from '../lib/format';
import { labOf } from '../lib/laboratorio';
import { LINK, NavLink, SimulatedTag, direction, isSimulated } from './ui';

// O competidor como o Rallies mostra um modelo (ADR 0035; plano, g.4): o logo do laboratório num círculo, o nome e a etiqueta "simulado"
// do modelo da arena simulada. O logo é decorativo (aria-hidden), monocromático por máscara (globals.css, `.logo`); sem laboratório (o
// Sorteio, as referências, um laboratório sem logo), a inicial, pelo atributo e não por texto: o textContent e o innerText do nome, que o
// e2e lê, continuam "Nome" e "Nome simulado". Nada aqui é flex: o logo e o nome correm em linha (um item flex quebraria o innerText em
// linhas).
type CompetidorData = Pick<PublicCompetitor, 'slug' | 'name' | 'type' | 'provider' | 'modelId'>;

export function Logo({
  competitor,
  className,
}: {
  competitor: CompetidorData;
  // o tamanho (size-6 é o padrão; size-8 nos ladrilhos, size-10 no cabeçalho do modelo) e o respiro
  className?: string;
}) {
  const lab = labOf(competitor);
  const classes = className ? `logo ${className}` : 'logo';
  return lab ? (
    <span aria-hidden="true" data-lab={lab} className={classes} />
  ) : (
    <span
      aria-hidden="true"
      data-inicial={competitor.name.trim().charAt(0).toUpperCase()}
      className={classes}
    />
  );
}

// O logo, o nome (como link para a página do competidor, ou texto quando o que está em volta já é o link) e a etiqueta. Sem caixa própria:
// quem chama dá o contêiner (a célula, o título, o item da lista).
export function Competidor({
  competitor,
  link = true,
}: {
  competitor: CompetidorData;
  link?: boolean;
}) {
  return (
    <>
      <Logo competitor={competitor} className="mr-2" />
      {link ? (
        <NavLink href={`/modelos/${competitor.slug}`} className={LINK}>
          {competitor.name}
        </NavLink>
      ) : (
        competitor.name
      )}
      {isSimulated(competitor) ? <SimulatedTag /> : null}
    </>
  );
}

// A faixa dos modelos do Rallies (plano, e.3): um cartão de uns 160 px por competidor, separados por fio, na ordem do ranking, com o logo,
// o nome, o retorno (Geist, com o glifo ▲ ▼ ■ e o sinal) e o percentil, cada um levando à página do competidor. A rolagem é da própria
// lista (com nome e foco de teclado, como a TableScroll), nunca da página; o botão "›" do Rallies sai (pediria JavaScript). Usada pela
// landing e pela arena. Todo cartão tem a altura do mais alto (o nome comprido quebra em mais linhas), com o retorno e o percentil no pé, e
// o contorno do foco vai por dentro dele: a caixa que rola cortaria o de fora.
export function FaixaDeModelos({
  rows,
  label,
}: {
  rows: readonly Pick<LeaderboardRow, 'competitor' | 'returnBps' | 'percentileBps'>[];
  // o nome da caixa que rola, para o leitor de tela
  label: string;
}) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="overflow-x-auto border-y border-hairline"
    >
      <ul className="flex w-max divide-x divide-hairline">
        {rows.map((row) => (
          <li key={row.competitor.slug} className="w-40 shrink-0">
            <NavLink
              href={`/modelos/${row.competitor.slug}`}
              className="flex h-full min-h-11 flex-col gap-1.5 px-4 py-4 hover:bg-surface-card focus-visible:-outline-offset-4"
            >
              <span className="text-13 text-ink">
                <Competidor competitor={row.competitor} link={false} />
              </span>
              <span
                data-dir={direction(row.returnBps)}
                className="mt-auto font-display text-base text-ink tabular-nums"
              >
                {formatBps(row.returnBps)}
              </span>
              <span className="text-xs text-muted">
                percentil {row.percentileBps === null ? '—' : formatPercentile(row.percentileBps)}
              </span>
            </NavLink>
          </li>
        ))}
      </ul>
    </div>
  );
}
