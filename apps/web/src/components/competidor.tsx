import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { LeaderboardRow, PublicCompetitor } from '@alvesting/contracts';
import { formatBps, formatPercentile } from '../lib/format';
import { labOf } from '../lib/laboratorio';
import { LINK, NavLink, NotaSimulada, SimulatedTag, direction, isSimulated } from './ui';

// O competidor como o Rallies mostra um modelo (ADR 0035; plano, g.4): o logo do laboratório num círculo, o nome e a etiqueta "simulado"
// do modelo da arena simulada. O logo é decorativo (aria-hidden), monocromático por máscara (globals.css, `.logo`); sem laboratório (o
// Sorteio, as referências, um laboratório sem logo), a inicial, pelo atributo e não por texto: o textContent e o innerText do nome, que o
// e2e lê, continuam "Nome" e "Nome simulado". Nada aqui é flex: o logo e o nome correm em linha (um item flex quebraria o innerText em
// linhas).
type CompetidorData = Pick<PublicCompetitor, 'slug' | 'name' | 'type' | 'provider' | 'modelId'>;

export function Logo({
  competitor,
  className,
  style,
}: {
  competitor: CompetidorData;
  // o tamanho (size-6 é o padrão; size-8 nos ladrilhos, size-10 no cabeçalho do modelo) e o respiro
  className?: string;
  // o anel da cor da série no fim da linha dos gráficos (a cor por `var()`, que segue o tema)
  style?: CSSProperties;
}) {
  const lab = labOf(competitor);
  const classes = className ? `logo ${className}` : 'logo';
  return lab ? (
    <span aria-hidden="true" data-lab={lab} className={classes} style={style} />
  ) : (
    <span
      aria-hidden="true"
      data-inicial={competitor.name.trim().charAt(0).toUpperCase()}
      className={classes}
      style={style}
    />
  );
}

// O nome curto: nos lugares apertados (o cartão da faixa, a carteira, a linha do ranking, a legenda e o fim das linhas dos gráficos) fica o
// curto à vista, e o resto vai para o leitor de tela, o tooltip e a página do competidor. No modelo, o resto é o sufixo de versão do fim do
// nome do elenco ("Qwen3.8 Max (0902)" → "Qwen3.8 Max" e " (0902)", o "(dígitos)" do fim). Nas referências, o curto vem do tipo
// ("Igual-peso do universo (só preço)" → "Igual-peso" e " do universo (só preço)"; "BOVA11 (contexto)" → "BOVA11"), quando o nome começa por
// ele.
const CURTO_DA_REFERENCIA: Readonly<Record<string, string>> = {
  EQUAL_WEIGHT: 'Igual-peso',
  BOVA11: 'BOVA11',
  CDI: 'CDI',
};
export function partesDoNome(name: string, type?: string): { curto: string; resto: string } {
  const curto = type === undefined ? undefined : CURTO_DA_REFERENCIA[type];
  if (curto && name.length > curto.length && name.startsWith(curto))
    return { curto, resto: name.slice(curto.length) };
  const match = /^(.*\S)(\s+\(\d+\))$/.exec(name);
  return match ? { curto: match[1]!, resto: match[2]! } : { curto: name, resto: '' };
}

// O logo, o nome (como link para a página do competidor, ou texto quando o que está em volta já é o link) e a etiqueta. Sem caixa própria:
// quem chama dá o contêiner (a célula, o título, o item da lista). `etiqueta={false}`: o lugar já tem a nota "simulado" uma vez por contexto
// (a tabela do ranking, a barra das carteiras; docs/DESIGN.md). `curto`: lugar apertado, o nome sem o sufixo de versão à vista, e o sufixo
// para o leitor de tela (o texto e o nome acessível continuam o nome inteiro).
export function Competidor({
  competitor,
  link = true,
  etiqueta = true,
  curto = false,
}: {
  competitor: CompetidorData;
  link?: boolean;
  etiqueta?: boolean;
  curto?: boolean;
}) {
  const nome = curto ? (
    <NomeCurto name={competitor.name} type={competitor.type} />
  ) : (
    competitor.name
  );
  return (
    <>
      <Logo competitor={competitor} className="mr-2" />
      {link ? (
        <NavLink href={`/modelos/${competitor.slug}`} className={LINK}>
          {nome}
        </NavLink>
      ) : (
        nome
      )}
      {etiqueta && isSimulated(competitor) ? <SimulatedTag /> : null}
    </>
  );
}

// o nome curto à vista e o resto (o sufixo de versão, ou o resto do nome de uma referência) só para o leitor de tela
export function NomeCurto({ name, type }: { name: string; type?: string }) {
  const { curto, resto } = partesDoNome(name, type);
  return (
    <>
      {curto}
      {resto ? <span className="sr-only">{resto}</span> : null}
    </>
  );
}

// A faixa dos modelos do Rallies (plano, e.3): um cartão de 176 px por competidor, separados por fio, na ordem do ranking, com o logo e o
// nome numa linha (o nome curto: o sufixo de versão vai para o leitor de tela e para o tooltip da arena), o retorno (com o glifo ▲ ▼ ■ e o
// sinal) e o percentil, cada um levando à página do competidor. A rolagem é da própria lista (com nome e foco de teclado, como a
// TableScroll), nunca da página, sem barra à vista; com o mouse, o botão redondo "›" do Rallies rola, só por CSS (globals.css, `.faixa`: os
// `::scroll-button()` do Chromium). Usada pela landing e pela arena; no app ela vai de uma borda à outra do principal (globals.css). Todo
// cartão tem a mesma altura, com o retorno e o percentil no pé, o fundo que acende no hover e no toque em 150 ms, e o contorno do foco por
// dentro: a caixa que rola cortaria o de fora. A nota "simulado" vem uma vez, antes da faixa (`avisoNaPagina` a tira, quando a página já
// avisa). `envolver`: quem usa a peça envolve cada cartão (a arena põe o tooltip da Arc, que é de cliente: a peça fica de servidor, e a
// landing não carrega o Motion por ela).
export function FaixaDeModelos({
  rows,
  label,
  avisoNaPagina = false,
  envolver,
}: {
  rows: readonly Pick<LeaderboardRow, 'competitor' | 'returnBps' | 'percentileBps'>[];
  // o nome da caixa que rola, para o leitor de tela
  label: string;
  avisoNaPagina?: boolean;
  envolver?: (
    cartao: ReactElement,
    row: Pick<LeaderboardRow, 'competitor' | 'returnBps' | 'percentileBps'>,
  ) => ReactNode;
}) {
  return (
    <>
      {avisoNaPagina ? null : (
        <NotaSimulada competitors={rows.map((row) => row.competitor)} className="px-4 pb-3" />
      )}
      <div
        role="region"
        aria-label={label}
        tabIndex={0}
        className="faixa overflow-x-auto border-y border-hairline"
      >
        <ul className="flex w-max divide-x divide-hairline">
          {rows.map((row) => {
            const cartao = (
              <NavLink
                href={`/modelos/${row.competitor.slug}`}
                className="faixa-cartao flex h-full min-h-11 flex-col gap-1.5 py-4 focus-visible:-outline-offset-4"
              >
                <span className="flex min-w-0 items-center gap-2 text-13 font-medium text-ink">
                  <Logo competitor={row.competitor} className="size-5" />
                  <span className="min-w-0 truncate">
                    <NomeCurto name={row.competitor.name} type={row.competitor.type} />
                  </span>
                </span>
                <span
                  data-dir={direction(row.returnBps)}
                  className="mt-auto text-base font-semibold text-ink tabular-nums"
                >
                  {formatBps(row.returnBps)}
                </span>
                <span className="text-xs text-muted">
                  percentil {row.percentileBps === null ? '—' : formatPercentile(row.percentileBps)}
                </span>
              </NavLink>
            );
            return (
              // `relative`: o sufixo de versão do nome é `sr-only` (absoluto); sem um ancestral posicionado dentro da caixa que rola, ele
              // escaparia do corte dela e alargaria a página no celular (a posição dele seria a do cartão, centenas de px à direita)
              <li key={row.competitor.slug} className="relative w-44 shrink-0">
                {envolver ? envolver(cartao, row) : cartao}
              </li>
            );
          })}
        </ul>
      </div>
    </>
  );
}
