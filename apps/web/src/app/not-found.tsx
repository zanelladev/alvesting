import type { Metadata } from 'next';
import { Arte } from '../components/arte';
import { SiteShell } from '../components/site-chrome';
import { BUTTON, NavLink } from '../components/ui';

// A página 404, uma só para o site inteiro (ADR 0035): o endereço não existe, ou o dado ainda não foi publicado
// (temporada, modelo, ciclo ou ação que a api não conhece). Diz o que fazer em vez de largar o leitor num beco. Nenhum dado entra aqui, então
// o texto sai mesmo com a api fora do ar. O título no vazio e a arte embaixo, nunca atrás do texto: o urso derrubando as colunas (a página que
// caiu, numa arena de bolsa), na moldura escura nos dois temas.
// Ela vale para a URL que não existe (o Next a desenha no servidor, como página) e para o `notFound()` das páginas, que cai aqui porque o
// layout raiz não tem casca (por isso ela traz a do site). O Next serializa esta árvore no payload de TODA página, duas vezes, então ela não
// leva o quadro do urso (17 KB): só o quadro de espera, e o quadro 0 chega no navegador depois do load (components/arte.tsx). A casca fica
// (a 404 desenhada no servidor precisa dela): um not-found por grupo com um pega-tudo `[...resto]` a tiraria da raiz, mas o `notFound()`
// lançado por uma página sai do servidor como documento vazio no Next 16.4.3 (a 404 só aparece com JavaScript), e a URL que não existe
// perderia o HTML. Dinâmica, e não estática: o rodapé lê a data do último pregão das cotações
// (`connection()`), por streaming.
export const metadata: Metadata = { title: 'Página não encontrada' };

export default function NotFound() {
  return (
    <SiteShell>
      <section className="pt-12 text-center max-[560px]:pt-6">
        <h1 className="mx-auto max-w-[20ch] font-display text-30 text-balance lg:text-40">
          Página não encontrada
        </h1>
        <p className="mx-auto mt-4 max-w-[560px] text-15 text-pretty text-muted">
          Este endereço não existe, ou o dado ainda não foi publicado: um ciclo só aparece depois do
          pregão, e um modelo só depois de a temporada começar. Confira o endereço ou volte por um
          destes caminhos.
        </p>
        <ul className="mt-8 flex flex-wrap justify-center gap-2">
          <li>
            <NavLink href="/" className={`${BUTTON} btn-primary`}>
              Voltar ao início
            </NavLink>
          </li>
          <li>
            <NavLink href="/ranking" className={BUTTON}>
              Ver o ranking
            </NavLink>
          </li>
          <li>
            <NavLink href="/acoes" className={BUTTON}>
              Buscar uma ação
            </NavLink>
          </li>
        </ul>
        <div className="moldura relative mt-10 h-[min(75vw,420px)] overflow-hidden rounded-lg">
          <Arte nome="urso" />
        </div>
      </section>
    </SiteShell>
  );
}
