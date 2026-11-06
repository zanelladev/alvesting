import type { ReactNode } from 'react';
import type { PublicCompetitor } from '@alvesting/contracts';
import { Abas, Aviso, NavLink, Segmentado, Trilha, quemSimula, type ItemDeNavegacao } from '../ui';

// As peças das telas da arena e do explorar (plano do redesenho, c.2): a grade com a barra secundária e a navegação de dentro da área.

// A barra secundária (a "Carteiras" da arena, de 400 px; a "Explorar", de 300 px): a partir de 1280 px ela fica à esquerda do conteúdo,
// presa no topo e com a própria rolagem (sem barra à vista, globals.css), como a do Rallies; abaixo disso ela desce para depois do conteúdo.
// No DOM ela vem DEPOIS (o leitor de tela chega ao conteúdo primeiro); a grade a põe à esquerda. Como a do Rallies, ela encosta no trilho (a
// grade come o respiro esquerdo do `main` da casca, -ml-6), sobe até o topo dele (-mt-6) e tem a altura da janela, com o fio da direita de
// cima a baixo; o conteúdo fica a 24 px do fio. O título dela é a linha de 45 px do topo, com o fio embaixo na altura do da linha de abas do
// principal (carteiras.tsx e explorar.tsx). Em 1440 px o principal tem os 960 px do Rallies (800 em 1280), contando o respiro.
// `vista` (a arena): abaixo de 1280 px só uma das duas fica à vista, as decisões (o conteúdo, que a página marca com `vista-decisoes`) ou as
// carteiras (a barra), pela URL (globals.css, `[data-vista]`); a partir de 1280 px, as duas. Sozinha, a barra vem logo abaixo das abas, sem o
// fio e o respiro que a separam do conteúdo (as classes escolhidas aqui, no servidor, e não uma regra a mais no CSS que a landing baixa).
const BARRA =
  'vista-carteiras min-w-0 border-hairline xl:sticky xl:top-0 xl:col-start-1 xl:row-start-1 xl:-mt-6 xl:h-dvh xl:self-start xl:overflow-y-auto xl:border-t-0 xl:border-r xl:px-5 xl:pt-0 xl:pb-6';
export function ComBarra({
  barra,
  largura,
  vista,
  children,
}: {
  barra: ReactNode;
  largura: 400 | 300;
  vista?: 'decisoes' | 'carteiras';
  children: ReactNode;
}) {
  return (
    <div
      data-vista={vista}
      className={`xl:-ml-6 xl:grid ${largura === 400 ? 'xl:grid-cols-[400px_minmax(0,1fr)]' : 'xl:grid-cols-[300px_minmax(0,1fr)]'}`}
    >
      <div className="min-w-0 xl:col-start-2 xl:row-start-1 xl:pl-6">{children}</div>
      <div className={vista === 'carteiras' ? `mt-6 ${BARRA}` : `mt-12 border-t pt-6 ${BARRA}`}>
        {barra}
      </div>
    </div>
  );
}

// A navegação da área (plano, c.2 e e.1). No celular, a trilha ("Início › Arena") e o segmentado das telas; a partir de 1024 px, a linha de
// abas no topo do principal, com a pílula de contorno à direita. São dois desenhos do mesmo conteúdo, um escondido em cada largura (o
// `display: none` tira o de lá da árvore de acessibilidade): o nome da `nav` é o mesmo nos dois. A linha de abas é a barra do topo do
// Rallies: 44 px e o fio embaixo (45 no total), de uma borda à outra do principal (ela come o respiro do `main`, -mx-6 e -mt-6), na mesma
// altura do fio embaixo do título da barra secundária.
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
  // a pílula de contorno à direita das abas ("Regras da arena")
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
        <div className="mb-6 hidden h-[45px] items-center justify-between gap-4 border-b border-hairline lg:-mx-6 lg:-mt-6 lg:flex lg:px-6">
          <Abas label={label} items={telas} />
          {acao ? (
            <NavLink href={acao.href} className="pill">
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
