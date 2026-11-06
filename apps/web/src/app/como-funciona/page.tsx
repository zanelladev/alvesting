import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import type { SeasonParams } from '@alvesting/contracts';
import { Empty, Fact, Facts, PageHead, Section } from '../../components/ui';
import { api } from '../../lib/api';
import { formatBRL, formatBps, formatDate, formatQuantity } from '../../lib/format';

// Como funciona (plano §3, §10 e §12; docs/METODOLOGIA.md; o desenho é o das páginas de texto da v1, ADR 0034): as regras, o prompt oculto com o hash publicado, a igualdade das entradas, o
// Sorteio, o Monte Carlo, as referências, as fontes e as limitações. Os números da temporada (capital, pregões, limites, horários, custo,
// carteiras do Monte Carlo) são os da temporada atual, lidos da api; sem temporada valem os do plano (a Temporada 1). O hash vem do último
// ciclo. Se a api falhar a página sai com o texto e sem esses números: explicar a regra não pode depender de dado.
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Como funciona' };

// Os parâmetros da Temporada 1 (docs/PLANO.md, seção 2), para quando não há temporada para ler.
const PLAN: SeasonParams = {
  capitalCents: 10_000_000,
  sessions: 20,
  maxPositions: 10,
  maxOrdersPerCycle: 5,
  buyPercentOfEquity: [5, 25],
  sellPercentOfPosition: [1, 100],
  tradeCostBps: 3,
  decisionTimeBrt: '08:00',
  deadlineTimeBrt: '09:30',
  randomSeed: '',
  monteCarloSeed: '',
  monteCarloRuns: 1000,
};

// a prosa: até uns 64 caracteres por linha, com a entrelinha de leitura
const P = ({ children }: { children: ReactNode }) => (
  <p className="max-w-prose text-prose-md">{children}</p>
);

async function loadSeason() {
  try {
    return await api.arenaCurrent();
  } catch {
    return null;
  }
}

export default async function HowItWorksPage() {
  const current = await loadSeason();
  const season = current?.season ?? null;
  const params = season?.params ?? PLAN;
  const prompt = current?.lastCycle?.prompt ?? null;

  return (
    <>
      <PageHead title="Como funciona">
        <p className="max-w-prose text-lead text-pretty">
          A Alvesting é um projeto acadêmico (TCC). Tudo é com dinheiro fictício e nada aqui é
          recomendação de investimento.
        </p>
      </PageHead>

      <Section id="o-que-e" title="O que é a arena">
        <P>
          Modelos de linguagem (LLMs) operam ações da B3 numa carteira fictícia. Antes de cada
          pregão, todos recebem o mesmo briefing (notícias, dados de mercado e macro) e o mesmo
          prompt, e respondem BUY, HOLD ou SELL em JSON estrito. O sistema executa as ordens no
          preço oficial de abertura, rende o caixa no CDI e publica o ranking, com um controle
          aleatório para separar habilidade de sorte.
        </P>
        <P>
          A pergunta de pesquisa: com as mesmas notícias, os mesmos dados e o mesmo prompt, LLMs de
          ponta tomam decisões de compra e venda na B3 melhores do que o acaso e do que o CDI?
        </P>
      </Section>

      <Section id="regras" title="Regras da temporada">
        <Facts>
          <Fact term="Capital" prose>
            {formatBRL(params.capitalCents)} por competidor
          </Fact>
          <Fact term="Duração" prose>
            {params.sessions} pregões
          </Fact>
          <Fact term="Universo" prose>
            até 500 ações (ON, PN e UNIT) com maior volume financeiro médio nos 60 pregões
            anteriores e presença em pelo menos 90% deles; sem FII, ETF, BDR nem opções; refeito
            todo domingo e congelado na semana
          </Fact>
          <Fact term="Ações" prose>
            BUY ({params.buyPercentOfEquity[0]}% a {params.buyPercentOfEquity[1]}% do patrimônio),
            SELL ({params.sellPercentOfPosition[0]}% a {params.sellPercentOfPosition[1]}% da
            posição) e HOLD (com motivo); só posição comprada, sem alavancagem e sem day trade
          </Fact>
          <Fact term="Limites" prose>
            até {params.maxPositions} posições e {params.maxOrdersPerCycle} ordens por ciclo
          </Fact>
          <Fact term="Decisão" prose>
            {params.decisionTimeBrt} (Brasília), com dados até o fechamento anterior; prazo até{' '}
            {params.deadlineTimeBrt}; sem resposta, HOLD
          </Fact>
          <Fact term="Execução" prose>
            preço oficial de abertura do mesmo pregão; vendas antes das compras; ações inteiras
          </Fact>
          <Fact term="Custo" prose>
            {formatBps(params.tradeCostBps, { signed: false })} por operação; sem slippage
          </Fact>
          <Fact term="Caixa" prose>
            rende o CDI diário (Banco Central, SGS 12)
          </Fact>
          <Fact term="Proventos" prose>
            não são creditados
          </Fact>
          <Fact term="Validação" prose>
            JSON estrito; item inválido é descartado e os outros valem; JSON inválido ganha um
            reparo; se falhar, HOLD
          </Fact>
        </Facts>
        <p className="max-w-prose muted">
          {season
            ? `Valores de ${season.name}.`
            : 'Valores previstos para a Temporada 1; ainda não há temporada em andamento.'}{' '}
          A Temporada 0 é um ensaio com provedores fake e não entra no resultado.
        </p>
      </Section>

      <Section id="prompt-oculto" title="O prompt oculto">
        <P>
          O prompt fica oculto durante a temporada: o público vê a versão e o SHA-256 dele e do
          briefing a cada ciclo, junto dos parâmetros e dos horários. O texto nunca aparece no site,
          na API nem nos registros, e um filtro de vazamento barra qualquer trecho dele nas
          respostas públicas dos modelos. Padrão adotado: o texto é revelado no fim da temporada, e
          o hash publicado confere.
        </P>
        {/* o hash é dado, não código: inteiro, na mono, num cartão (nada de bloco de código; o texto do prompt nunca aparece) */}
        {prompt ? (
          <dl className="card space-y-4">
            <div className="space-y-1">
              <dt className="text-sm text-muted">Versão do prompt atual</dt>
              <dd className="font-mono text-sm break-all text-ink">{prompt.version}</dd>
            </div>
            <div className="space-y-1">
              <dt className="text-sm text-muted">SHA-256 do prompt atual</dt>
              <dd className="font-mono text-sm break-all text-ink">
                {prompt.sha256 ?? 'sem registro'}
              </dd>
            </div>
            {current?.lastCycle ? (
              <div className="space-y-1">
                <dt className="text-sm text-muted">Do ciclo de</dt>
                <dd className="text-ink tabular-nums">{formatDate(current.lastCycle.date)}</dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <Empty>O hash do prompt aparece aqui depois do primeiro ciclo.</Empty>
        )}
      </Section>

      <Section id="igualdade" title="Igualdade das entradas">
        <P>
          Todos os modelos recebem o mesmo prompt e o mesmo briefing, os dois com SHA-256 público,
          na mesma hora e com os mesmos limites, sem ferramentas nem busca na web. A única parte
          diferente é a carteira de cada um. A tabela do universo vem em ordem embaralhada por uma
          semente do pregão, igual para todos. Os parâmetros também são iguais: limite de tokens de
          saída, esforço de raciocínio médio onde existir e JSON Schema onde o provedor aceita; o
          que o provedor aplicou fica gravado em cada decisão.
        </P>
        <P>
          O briefing é congelado às 07:30 em JSON canônico, e o SHA-256 é o dos bytes gravados: a
          mesma entrada dá o mesmo hash. Notícia é dado de terceiro, nunca instrução.
        </P>
      </Section>

      <Section id="sorteio-e-monte-carlo" title="Sorteio e Monte Carlo">
        <P>
          O Sorteio é um competidor obrigatório no ranking: uma carteira que sorteia de 0 a 5 ordens
          por pregão, com as mesmas regras e os mesmos custos dos modelos. O Monte Carlo simula{' '}
          {formatQuantity(params.monteCarloRuns)} carteiras aleatórias com as mesmas regras e uma
          semente fixa, e o percentil de cada competidor é a parcela delas que ficou abaixo dele
          (mais metade das empatadas).
        </P>
        <P>
          Com poucos pregões o ranking diz pouco sozinho, e por isso as hipóteses do trabalho são
          sobre o percentil: H1, pelo menos um modelo termina acima do percentil 95; H2, a média dos
          modelos supera o CDI e o igual-peso. As sementes são públicas e a conta é reproduzível. A
          faixa cinza do gráfico do patrimônio vai do percentil 5 ao 95 das carteiras aleatórias.
        </P>
      </Section>

      <Section id="referencias" title="Referências">
        <P>
          O igual-peso do universo, só preço, é a referência principal: compra todas as ações do
          universo com pesos iguais na abertura do primeiro pregão e segura, com as mesmas regras e
          custos. O CDI é o que o caixa renderia sem decisão nenhuma. O BOVA11 é só contexto: inclui
          proventos, que os modelos não recebem.
        </P>
      </Section>

      <Section id="fontes" title="De onde vêm os dados">
        <ul className="max-w-prose list-disc pl-6 space-y-2 text-prose-md">
          <li>
            Preços de abertura e de fechamento: brapi.dev (cotações diárias; a brapi não é
            distribuidora licenciada da B3).
          </li>
          <li>CDI, Selic, IPCA e dólar: Banco Central do Brasil (SGS).</li>
          <li>Fatos relevantes e comunicados: CVM (dados abertos, licença ODbL).</li>
          <li>
            Notícias: feeds RSS de InfoMoney, Money Times, Seu Dinheiro e Agência Brasil. O site
            mostra só título, fonte, hora e link; os modelos recebem o trecho apenas das fontes
            cujos termos permitem.
          </li>
        </ul>
        <p className="max-w-prose muted">
          Cada valor de cotação e de macro aparece com a data do dado. A lista completa de
          atribuições, com o link de cada fonte, está no rodapé.
        </p>
      </Section>

      <Section id="limitacoes" title="Limitações">
        <ul className="max-w-prose list-disc pl-6 space-y-2 text-prose-md">
          <li>
            Amostra pequena: poucos pregões têm pouco poder estatístico; por isso o Sorteio e o
            Monte Carlo.
          </li>
          <li>Sem slippage: a execução é no preço de abertura, só com o custo por operação.</li>
          <li>Sem proventos: a referência principal é só preço.</li>
          <li>
            Uma decisão por pregão por modelo, e quantidades fracionárias usam o preço do lote
            padrão.
          </li>
          <li>Universo filtrado por liquidez: ações pouco negociadas ficam de fora.</li>
          <li>Sem web e sem ferramentas: o modelo conhece só o briefing congelado às 07:30.</li>
          <li>
            Falha vira HOLD: resposta inválida ou fora do prazo conta como manter, e o registro
            mostra quando acontece.
          </li>
          <li>
            Um provedor pode trocar o modelo por trás do mesmo nome; por isso o que ele aplicou é
            gravado.
          </li>
          <li>
            Resultado provisório: o dia pode ser recalculado quando o dado oficial de preços chega.
          </li>
          <li>
            O resultado vale para esse período e essas condições; não generaliza para outros
            mercados.
          </li>
        </ul>
      </Section>

      <Section id="aviso" title="Aviso">
        <P>
          A Alvesting é uma arena acadêmica com dinheiro fictício. Isto não é recomendação de
          investimento, consultoria nem análise de valores mobiliários (atividades reguladas pelas
          Resoluções CVM 19 e 20, que este projeto não presta), e as decisões dos modelos não são
          sugestões para ninguém. O software não se responsabiliza pelas decisões do usuário.
        </P>
      </Section>
    </>
  );
}
