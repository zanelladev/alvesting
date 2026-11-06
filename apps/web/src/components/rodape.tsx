import { Suspense, type ReactNode } from 'react';
import { connection } from 'next/server';
import { formatDate } from '../lib/format';
import { REFERENCE_TICKER, readBars } from '../lib/quotes';
import { LINK } from './ui';

// O rodapé de toda tela (plano §12), nas duas cascas (a do site e a do app, que o põe compacto no pé da coluna principal): o aviso fixo, as
// atribuições que as fontes pedem e o aviso de marca dos logos dos laboratórios (ADR 0035). Nada aqui depende da api, menos a data do dado
// das cotações, que chega por streaming e some (sem data) se a api falhar: o aviso não pode depender de dado.

// ponytail: as fontes de notícia estão escritas aqui à mão, e a lista de verdade é a da api (apps/api/src/modules/news/domain/sources.ts).
// Fonte nova no worker exige uma linha aqui. Se passar de umas poucas, a api passa a mandar a lista.
const NEWS_SOURCES = [
  ['InfoMoney', 'https://www.infomoney.com.br/'],
  ['Money Times', 'https://www.moneytimes.com.br/'],
  ['Seu Dinheiro', 'https://www.seudinheiro.com/'],
  ['Agência Brasil', 'https://agenciabrasil.ebc.com.br/'],
] as const;

// O pregão do último fechamento que a base tem (o mesmo do BOVA11 da home: a leitura é a mesma, da rota interna de cotações e do cache de
// dados do site, src/lib/quotes.ts). `connection()` tira o componente da pré-renderização: sem ele a página 404, estática, guardaria o rodapé
// do build, sem data. A data some se a leitura falhar (o aviso fixo não pode depender de dado), mas a falta vai para o log do servidor: sem
// ele, o segredo das cotações ausente, curto ou recusado derrubaria em silêncio a data do rodapé de toda página que não lê cotação
// (/ranking, /noticias, /termos...), que seguiriam 200. O erro não carrega o segredo nem o corpo da resposta.
export async function QuotesDate() {
  await connection();
  try {
    const last = (await readBars(REFERENCE_TICKER)).at(-1);
    return last ? `, pregão de ${formatDate(last.date)}` : null;
  } catch (error) {
    console.error('[web] rodapé sem a data das cotações:', error);
    return null;
  }
}

const external = { target: '_blank', rel: 'noopener noreferrer' } as const;
const Source = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} className={LINK} {...external}>
    {children}
  </a>
);

// O aviso de marca (plano, g.3): o logo ao lado do modelo é uso nominativo, monocromático e sem alterar o desenho. A frase da arena simulada
// fica onde há dado para saber se ela vale (o hero, a arena, a página do modelo): o rodapé não lê a api, e quando os modelos de verdade
// entrarem ela ficaria errada em toda tela.
export const AVISO_DE_MARCA =
  'Os nomes e os logos dos modelos são marcas dos seus donos (OpenAI, Anthropic, Google, xAI, DeepSeek e Alibaba Cloud); a Alvesting não tem relação com eles.';

// `children`: o que a casca põe no fim do mesmo `<footer>` (o rodapé grande do site: o © e o nome gigante), para tudo ficar num contentinfo
// só (o axe acusa o texto fora de um marco, e dois `<footer>` seriam dois contentinfo). O app não passa nada.
export function Rodape({ className, children }: { className: string; children?: ReactNode }) {
  return (
    <footer className={className}>
      <p className="max-w-[72ch]">
        <strong>Aviso.</strong> Arena acadêmica com dinheiro fictício, projeto de TCC. Isto não é
        recomendação de investimento, consultoria nem análise de valores mobiliários, atividades
        reguladas pelas Resoluções CVM 19 e 20, que a Alvesting não presta. O software não se
        responsabiliza pelas decisões do usuário.
      </p>
      <p className="max-w-[72ch]">{AVISO_DE_MARCA}</p>
      <h2 className="text-sm font-semibold">
        Fontes e atribuições
        <span className="sr-only"> (os links abrem em outra aba)</span>
      </h2>
      {/* O texto corre em linha (nada de item flex): a pontuação nunca fica sozinha na linha de baixo. Todo link tem 44 px de largura
          mínima com o texto à esquerda, então o link de uma palavra curta ("brapi.dev") deixaria um vão antes da vírgula: por isso o link é
          a frase inteira ("brapi.dev, pregão de 09/11/2026") ou fica no fim da linha. */}
      <ul className="space-y-1">
        <li>
          Cotações:{' '}
          <Source href="https://brapi.dev/">
            brapi.dev
            <Suspense fallback={null}>
              <QuotesDate />
            </Suspense>
          </Source>
        </li>
        <li>
          Macro (CDI, Selic, IPCA e dólar).{' '}
          <Source href="https://www.bcb.gov.br/">Fonte: Banco Central do Brasil</Source>
        </li>
        <li>
          Fatos relevantes e comunicados.{' '}
          {/* a vírgula colada ao link de antes: entre um link (bloco em linha) e o texto há sempre onde quebrar, e a linha de baixo
              começaria por ela */}
          <span className="whitespace-nowrap">
            <Source href="https://dados.cvm.gov.br/">Contém dados da CVM</Source>,
          </span>{' '}
          <Source href="https://opendatacommons.org/licenses/odbl/1-0/">licença ODbL</Source>
        </li>
        <li>
          {/* a margem fica depois de cada fonte: quando a linha quebra, a de baixo começa na margem do rodapé, e não 8 px para dentro */}
          Notícias (só título, fonte e link):{' '}
          {NEWS_SOURCES.map(([name, href]) => (
            <span key={name} className="mr-2">
              <Source href={href}>{name}</Source>
            </span>
          ))}
        </li>
      </ul>
      {children}
    </footer>
  );
}
