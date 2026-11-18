import { IconeAdicionar, IconePergunta } from '../icones';
import { LINK, NavLink } from '../ui';
// O FAQ da landing (ADR 0041): seis perguntas, com as respostas tiradas do Como funciona e da carteira (o texto de lá, encurtado; quem quiser
// a regra inteira vai ao Como funciona). O título numa célula e as perguntas na outra, cada uma um `details` do navegador (sem JavaScript;
// a primeira aberta), com o "+" que gira até o "×". A resposta sobre os modelos depende de a arena estar simulada.
const MODELOS_SIMULADOS =
  'Ainda não. Os nomes são os do elenco da temporada, mas, enquanto os modelos não estão conectados, quem decide por cada modelo marcado como simulado é uma estratégia fixa e simples. O resultado não diz nada sobre os modelos de verdade.';
const MODELOS_DE_VERDADE =
  'Sim. Cada modelo responde pela API do laboratório, com os mesmos parâmetros para todos e sem ferramentas nem busca na web; o que o provedor aplicou fica gravado em cada decisão.';

export function Faq({ simulated }: { simulated: boolean }) {
  const perguntas = [
    [
      'O que é a arena?',
      'Modelos de linguagem operam ações da B3 numa carteira fictícia. Antes de cada pregão, todos recebem o mesmo briefing e o mesmo prompt e respondem BUY, HOLD ou SELL. As ordens executam no preço oficial de abertura, o caixa rende o CDI, e o ranking tem um controle aleatório para separar habilidade de sorte.',
    ],
    ['Os modelos são de verdade?', simulated ? MODELOS_SIMULADOS : MODELOS_DE_VERDADE],
    [
      'De onde vêm os preços?',
      'Da brapi.dev, em cotações diárias (a brapi não é distribuidora licenciada da B3). O CDI, a Selic, o IPCA e o dólar vêm do Banco Central. Cada valor aparece com a data do dado, e as atribuições completas estão no rodapé.',
    ],
    [
      'O prompt é igual para todos?',
      'Sim: o mesmo prompt e o mesmo briefing, na mesma hora e com os mesmos limites; só a carteira de cada um muda. O texto fica oculto durante a temporada: a versão e o SHA-256 saem a cada ciclo, e o texto é revelado no fim, para o hash conferir.',
    ],
    [
      'Isto é recomendação de investimento?',
      'Não. A Alvesting é uma arena acadêmica com dinheiro fictício, um projeto de TCC. Nada aqui é recomendação, consultoria nem análise de valores mobiliários, e as decisões dos modelos não são sugestões para ninguém.',
    ],
    [
      'Dá para acompanhar a minha carteira?',
      'Sim, anotada por você: você lança as ações que comprou, e a Alvesting calcula o preço médio, o valor estimado e o ganho ou a perda. Ela não fala com a sua corretora nem confere os lançamentos: valem os números que você digita.',
    ],
  ] as const;
  return (
    <section aria-labelledby="faq-titulo" className="linha">
      <div className="coluna">
        <div className="faq">
          <div className="flex flex-col items-start gap-5 px-5 pt-10 pb-6 lg:px-12 lg:pt-14 lg:pb-12">
            <span className="selo">
              <IconePergunta />
              Perguntas
            </span>
            <h2 id="faq-titulo" className="text-secao font-medium">
              Perguntas frequentes <span className="tom2">sobre a arena.</span>
            </h2>
            <NavLink href="/como-funciona" className={`${LINK} gap-1.5 font-medium no-underline`}>
              Ler como funciona
              <span aria-hidden="true" className="seta">
                ›
              </span>
            </NavLink>
          </div>
          <div>
            {perguntas.map(([pergunta, resposta], i) => (
              <details key={pergunta} open={i === 0}>
                <summary>
                  <h3>{pergunta}</h3>
                  <IconeAdicionar />
                </summary>
                <p>{resposta}</p>
              </details>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
