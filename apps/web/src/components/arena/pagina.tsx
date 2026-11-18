import type { ReactNode } from 'react';
import type { PublicCompetitor } from '@alvesting/contracts';
import { Abas, Aviso, NavLink, Segmentado, Trilha, quemSimula, type ItemDeNavegacao } from '../ui';

// As peças das telas da arena e do explorar (plano do redesenho, c.2): a grade com a barra secundária e a navegação de dentro da área.

// A barra secundária (a "Carteiras" da arena e do ranking, de 380 px; a "Explorar", de 300 px): a partir de 1280 px ela é a célula da
// direita de uma faixa da coluna, com o fio de 1 px entre ela e o conteúdo (a folha no vão da grade). Com `junto`, ela fica ao lado só dele (na
// arena, as decisões: as carteiras ao lado do feed), e o resto (`children`) vai em cima, na largura inteira; sem `junto`, ela fica ao lado
// de tudo. Abaixo de 1280 px ela desce para depois do conteúdo. No DOM ela vem DEPOIS (o leitor de tela chega ao conteúdo primeiro).
// `vista` (a arena): abaixo de 1280 px só uma das duas fica à vista, as decisões (o conteúdo, que a página marca com `vista-decisoes`, e o
// `junto`) ou as carteiras (a barra), pela URL (globals.css, `[data-vista]`); a partir de 1280 px, as duas. Sozinha, a barra vem logo abaixo
// das abas, sem o fio e o respiro que a separam do conteúdo (as classes escolhidas aqui, no servidor, e não uma regra a mais no CSS que a
// landing baixa). `embaixo` (a página da ação): a barra fica embaixo do conteúdo em toda largura, de uma borda à outra da coluna, porque ao
// lado ela deixaria o terminal sem os 52rem das duas colunas.
const BARRA = 'vista-carteiras min-w-0 bg-canvas xl:px-5 xl:pb-6';
export function ComBarra({
  barra,
  largura,
  vista,
  junto,
  embaixo,
  children,
}: {
  barra: ReactNode;
  largura: 400 | 300;
  vista?: 'decisoes' | 'carteiras';
  junto?: ReactNode;
  embaixo?: boolean;
  children: ReactNode;
}) {
  if (embaixo) {
    return (
      <div>
        {children}
        <div className="-mx-5 mt-12 border-t border-folha px-5 pt-6 lg:-mx-6 lg:px-6 xl:px-5 xl:pt-0">
          {barra}
        </div>
      </div>
    );
  }
  const grade = `xl:-mx-6 xl:grid xl:gap-px xl:bg-folha ${largura === 400 ? 'xl:grid-cols-[minmax(0,1fr)_380px]' : 'xl:grid-cols-[minmax(0,1fr)_300px]'}`;
  const celulaBarra =
    vista === 'carteiras'
      ? `mt-6 xl:mt-0 ${BARRA}`
      : `mt-12 border-t border-folha pt-6 xl:mt-0 xl:border-t-0 xl:pt-0 ${BARRA}`;
  return junto ? (
    <div data-vista={vista}>
      {children}
      <div className={`xl:mt-10 xl:-mb-6 xl:border-t xl:border-folha ${grade}`}>
        <div className="vista-decisoes min-w-0 bg-canvas xl:px-6 xl:pb-6 xl:[&>section]:mt-0 xl:[&>section]:border-t-0">
          {junto}
        </div>
        <div className={celulaBarra}>{barra}</div>
      </div>
    </div>
  ) : (
    <div data-vista={vista} className={`xl:-my-6 ${grade}`}>
      <div className="min-w-0 bg-canvas xl:px-6 xl:py-6">{children}</div>
      <div className={celulaBarra}>{barra}</div>
    </div>
  );
}

// A navegação da área (plano, c.2 e e.1). No celular, a trilha ("Início › Arena") e o segmentado das telas; a partir de 1024 px, a linha de
// abas no topo da coluna, com o botão de contorno à direita. São dois desenhos do mesmo conteúdo, um escondido em cada largura (o
// `display: none` tira o de lá da árvore de acessibilidade): o nome da `nav` é o mesmo nos dois. A linha de abas é a primeira faixa da
// coluna: 56 px e o fio embaixo, de uma borda à outra dela (come o respiro da coluna, -mx-6 e -mt-6).
export function NavegacaoDaArea({
  label,
  area,
  trilha,
  telas,
  acao,
}: {
  // o nome das telas da área ("Telas da arena")
  label: string;
  // a área na trilha ("Arena", com o endereço dela); a trilha termina na tela atual, em texto
  area: { label: string; href: string };
  trilha: string;
  telas: readonly ItemDeNavegacao[];
  // o botão de contorno à direita das abas ("Regras da arena")
  acao?: { label: string; href: string };
}) {
  const caminho = [
    { label: 'Início', href: '/' },
    ...(trilha === area.label ? [] : [area]),
    { label: trilha },
  ];
  return (
    <>
      <div className="mb-5 space-y-3 lg:hidden">
        <Trilha items={caminho} />
        {telas.length > 1 ? <Segmentado label={label} items={telas} /> : null}
      </div>
      {telas.length > 0 ? (
        <div className="mb-8 hidden h-14 items-center justify-between gap-4 border-b border-folha lg:-mx-6 lg:-mt-6 lg:flex lg:pr-4 lg:pl-3">
          <Abas label={label} items={telas} />
          {acao ? (
            <NavLink href={acao.href} className="btn">
              {acao.label}
            </NavLink>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

// As telas da área da arena: a arena, o ranking e o último ciclo (quando há), com a atual marcada.
export function telasDaArena(
  atual: 'arena' | 'ranking' | 'ciclo' | null,
  ultimoCiclo: string | null,
): ItemDeNavegacao[] {
  const mark = (tela: typeof atual) => (tela === atual ? ('page' as const) : undefined);
  return [
    { label: 'Arena', href: '/arena', atual: mark('arena') },
    { label: 'Ranking', href: '/ranking', atual: mark('ranking') },
    ...(ultimoCiclo
      ? [{ label: 'Último ciclo', href: `/ciclos/${ultimoCiclo}`, atual: mark('ciclo') }]
      : []),
  ];
}

export const AREA_ARENA = { label: 'Arena', href: '/arena' };
export const REGRAS = { label: 'Regras da arena', href: '/como-funciona' };

// O aviso da arena simulada nas páginas que mostram muitos modelos (a arena, o ciclo): uma linha discreta, sem caixa (ui.tsx, Aviso), que
// cobre a página inteira, e por isso as peças dela (a faixa, o feed, as carteiras) tiram a nota delas (`avisoNaPagina`; docs/DESIGN.md: o
// "simulado" uma vez por contexto). Quem ele cobre é o da nota (ui.tsx, quemSimula): todos os modelos, ou os nomes dos simulados numa
// temporada mista. Nenhum simulado: nada.
export function AvisoSimulado({
  competitors,
  parcial = false,
}: {
  competitors: ReadonlyArray<Pick<PublicCompetitor, 'name' | 'type' | 'provider'>>;
  // a lista é só uma parte do elenco (o feed filtrado antes da primeira liquidação): o aviso nomeia os simulados (ui.tsx, quemSimula)
  parcial?: boolean;
}) {
  const frase = quemSimula(competitors, parcial);
  if (!frase) return null;
  return (
    <Aviso>
      <strong>Decisões simuladas: {frase.replace(/^Os modelos/, 'os modelos')}</strong> Os nomes são
      os do elenco, mas quem decide por cada modelo simulado é uma estratégia fixa e simples. O
      resultado não diz nada sobre os modelos de verdade.
    </Aviso>
  );
}
