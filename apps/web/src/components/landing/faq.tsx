// O FAQ da landing (docs/redesign-rallies/plano.md, d.6): seis perguntas, com as respostas tiradas do Como funciona e da carteira (o texto de
// lá, encurtado; quem quiser a regra inteira vai ao Como funciona). Texto estático, sem `details`: três colunas a partir de 1024 px, duas a
// partir de 768, uma no celular. A resposta sobre os modelos depende de a arena estar simulada.
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
    <section aria-labelledby="faq-titulo" className="mt-24">
      <h2 id="faq-titulo" className="font-display text-22">
        Perguntas frequentes
      </h2>
      <div className="mt-8 grid gap-x-12 gap-y-10 md:grid-cols-2 lg:grid-cols-3">
        {perguntas.map(([pergunta, resposta]) => (
          <div key={pergunta} className="space-y-3">
            <h3 className="text-base font-semibold">{pergunta}</h3>
            <p className="text-sm leading-relaxed text-pretty text-muted">{resposta}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
