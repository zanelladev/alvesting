import type { Metadata } from 'next';
import { Arte } from '../components/arte';
import { BUTTON, HERO_TITLE, NavLink } from '../components/ui';

// A página 404 (o endereço não existe, ou o dado ainda não foi publicado: temporada, modelo, ciclo ou ação que a api não conhece). Diz o
// que fazer em vez de largar o leitor num beco. Nenhum dado entra aqui, então o texto sai mesmo com a api fora do ar. Dinâmica, e não
// estática: o rodapé do layout lê a data do último pregão das cotações (`connection()`), por streaming. Com a api pendurada a resposta fica
// aberta até o prazo de leitura (10 s) por causa dessa data, mas o texto já chegou ao leitor.
// O desenho é o da 404 da v1 (ADR 0034): a gramática do hero, com o título no vazio e a arte embaixo, nunca atrás do texto. A arte é o urso
// derrubando as colunas (a página que caiu, numa arena de bolsa): o quadro 0 vem no HTML, com a brasa, e o laço só toca a partir de 1024 px
// (components/arte.tsx). A arte fica na coluna, entre as linhas da moldura.
export const metadata: Metadata = { title: 'Página não encontrada' };

export default function NotFound() {
  return (
    <section className="pt-12 text-center max-[560px]:pt-6">
      <h1 className={`mx-auto ${HERO_TITLE}`}>Página não encontrada</h1>
      <p className="mx-auto mt-5 max-w-[560px] text-lead text-pretty max-[560px]:text-base">
        Este endereço não existe, ou o dado ainda não foi publicado: um ciclo só aparece depois do
        pregão, e um modelo só depois de a temporada começar. Confira o endereço ou volte por um
        destes caminhos.
      </p>
      <ul className="mt-8 flex flex-wrap justify-center gap-3">
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
      <div className="relative mt-4 h-[min(75vw,420px)]">
        <Arte nome="urso" />
      </div>
    </section>
  );
}
