import type { Metadata } from 'next';
import { LINK, NavLink } from '../components/ui';

// A página 404 (o endereço não existe, ou o dado ainda não foi publicado: temporada, modelo, ciclo ou ação que a api não conhece). Diz o
// que fazer em vez de largar o leitor num beco. Nenhum dado entra aqui, então o texto sai mesmo com a api fora do ar. Dinâmica, e não
// estática: o rodapé do layout lê a data do último pregão das cotações (`connection()`), por streaming. Com a api pendurada a resposta fica aberta até o prazo de
// leitura (10 s) por causa dessa data, mas o texto já chegou ao leitor.
export const metadata: Metadata = { title: 'Página não encontrada' };

export default function NotFound() {
  return (
    <section className="space-y-4">
      <h1 className="font-mono text-2xl font-semibold sm:text-3xl">Página não encontrada</h1>
      <p className="max-w-prose">
        Este endereço não existe, ou o dado ainda não foi publicado: um ciclo só aparece depois do
        pregão, e um modelo só depois de a temporada começar. Confira o endereço ou volte por um
        destes caminhos.
      </p>
      <ul className="flex flex-wrap gap-x-6">
        <li>
          <NavLink href="/" className={LINK}>
            Voltar ao início
          </NavLink>
        </li>
        <li>
          <NavLink href="/ranking" className={LINK}>
            Ver o ranking
          </NavLink>
        </li>
        <li>
          <NavLink href="/acoes" className={LINK}>
            Buscar uma ação
          </NavLink>
        </li>
      </ul>
    </section>
  );
}
