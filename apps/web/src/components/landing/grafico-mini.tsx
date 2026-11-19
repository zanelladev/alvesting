import type { PublicCompetitor } from '@alvesting/contracts';
import { serieDe, spreadLabels } from '../../lib/chart';
import { formatBRL } from '../../lib/format';
import { Logo } from '../competidor';

// O gráfico do patrimônio pequeno, de servidor (a landing: a janela do topo, o placar e a cena das referências; ADR 0041): as linhas como
// caminhos SVG, sem cursor, sem legenda que se clica e sem JavaScript (o gráfico que se lê pelo teclado é o da arena, line-chart.tsx). É
// decorativo (`aria-hidden`): o mesmo dado está em texto ao lado (a tabela do placar). A cor de cada linha é a do laboratório (`serieDe`,
// por var(): segue o tema); o Sorteio é tracejado. O desenho estica na largura da caixa (`preserveAspectRatio="none"`, com o traço que não
// estica: `vector-effect` no globals.css) e tem a altura dada em px. `rotulos`: o logo e o patrimônio final no fim de cada linha, na calha
// da direita (quem usa dá a calha), sem se encavalar. `desenha`: as linhas se desenham em laço, cada uma 70 ms depois da anterior, como no
// desenho (a cena das referências; paradas com movimento reduzido).
export interface SerieMini {
  competitor: Pick<PublicCompetitor, 'slug' | 'name' | 'type' | 'provider' | 'modelId'>;
  cents: readonly number[];
}

const LARGURA = 1000;

export function GraficoMini({
  series,
  altura,
  rotulos = false,
  desenha = false,
}: {
  series: readonly SerieMini[];
  altura: number;
  rotulos?: boolean;
  desenha?: boolean;
}) {
  const valores = series.flatMap((s) => s.cents);
  if (valores.length === 0) return null;
  // um respiro de 6% em cima e embaixo, para o traço e o logo do fim não encostarem na borda
  const min = Math.min(...valores);
  const max = Math.max(...valores);
  const folga = Math.max((max - min) * 0.06, 1);
  const y = (v: number) => ((max + folga - v) / (max - min + 2 * folga)) * altura;
  const caminho = (cents: readonly number[]) =>
    cents
      .map((v, i) => {
        const x = cents.length === 1 ? LARGURA / 2 : (i * LARGURA) / (cents.length - 1);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y(v).toFixed(1)}`;
      })
      .join(' ');
  const finais = series.map((s) => s.cents.at(-1)!);
  const alturas = rotulos ? spreadLabels(finais.map(y), 22, 10, altura - 10) : [];
  return (
    <div aria-hidden="true" className={desenha ? 'grafico-mini cena-grafico' : 'grafico-mini'}>
      <svg viewBox={`0 0 ${LARGURA} ${altura}`} preserveAspectRatio="none" height={altura}>
        {[0.25, 0.5, 0.75].map((f) => (
          <path key={f} className="grade" d={`M0 ${altura * f} H${LARGURA}`} />
        ))}
        {series.map((s, i) => {
          const { cor, traco } = serieDe(s.competitor);
          return (
            <path
              key={s.competitor.slug}
              d={caminho(s.cents)}
              pathLength={desenha ? 1 : undefined}
              className={traco && !desenha ? 'tracejada' : undefined}
              style={{ stroke: cor, animationDelay: desenha ? `${120 + i * 70}ms` : undefined }}
            />
          );
        })}
      </svg>
      {rotulos ? (
        <ul className="grafico-fins">
          {series.map((s, i) => (
            <li key={s.competitor.slug} style={{ top: `${alturas[i]!}px` }}>
              <Logo
                competitor={s.competitor}
                className="size-5 border-[1.5px] bg-canvas"
                style={{ borderColor: serieDe(s.competitor).cor }}
              />
              {formatBRL(finais[i]!)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
