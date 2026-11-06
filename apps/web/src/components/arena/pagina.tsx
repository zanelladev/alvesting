import type { ReactNode } from 'react';
import { Abas, NavLink, Segmentado, Trilha, type ItemDeNavegacao } from '../ui';

// As peças das telas da arena e do explorar (plano do redesenho, c.2): a grade com a barra secundária e a navegação de dentro da área.

// A barra secundária (a "Carteiras" da arena, de 400 px; a "Explorar", de 300 px): a partir de 1280 px ela fica à esquerda do conteúdo,
// presa no topo e com a própria rolagem, como a do Rallies; abaixo disso ela desce para depois do conteúdo. No DOM ela vem DEPOIS (o leitor
// de tela chega ao conteúdo primeiro); a grade a põe à esquerda. Como a do Rallies, ela encosta no trilho (a grade come o respiro esquerdo
// do `main` da casca, -ml-6) e sobe até o topo dele (-mt-6), com o fio da direita de cima a baixo; o conteúdo fica a 24 px do fio. Em 1440 px
// o principal tem os 960 px do Rallies (800 em 1280), contando o respiro.
export function ComBarra({
  barra,
  largura,
  children,
}: {
  barra: ReactNode;
  largura: 400 | 300;
  children: ReactNode;
}) {
  return (
    <div
      className={`xl:-ml-6 xl:grid ${largura === 400 ? 'xl:grid-cols-[400px_minmax(0,1fr)]' : 'xl:grid-cols-[300px_minmax(0,1fr)]'}`}
    >
      <div className="min-w-0 xl:col-start-2 xl:row-start-1 xl:pl-6">{children}</div>
      <div className="mt-12 min-w-0 border-t border-hairline pt-6 xl:sticky xl:top-0 xl:col-start-1 xl:row-start-1 xl:-mt-6 xl:max-h-dvh xl:self-start xl:overflow-y-auto xl:border-t-0 xl:border-r xl:px-5 xl:pt-6 xl:pb-6">
        {barra}
      </div>
    </div>
  );
}

// A navegação da área (plano, c.2 e e.1). No celular, a trilha ("Início › Arena") e o segmentado das telas; a partir de 1024 px, a linha de
// abas no topo do principal, com a pílula de contorno à direita. São dois desenhos do mesmo conteúdo, um escondido em cada largura (o
// `display: none` tira o de lá da árvore de acessibilidade): o nome da `nav` é o mesmo nos dois.
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
        <div className="mb-4 hidden items-center justify-between gap-4 lg:flex">
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
