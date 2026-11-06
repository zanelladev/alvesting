import type { ReactNode } from 'react';
import type { FeedDecision, LastCycle, LeaderboardRow } from '@alvesting/contracts';
import { formatDate } from '../../lib/format';
import { FaixaDeModelos } from '../competidor';
import { DecisionCard } from '../decisions';
import { LeaderboardTable } from '../tables';
import { Empty, NavLink, Strip, StripItem, isSimulated } from '../ui';

// Os recortes de UI da landing (docs/redesign-rallies/plano.md, d.3 e d.5), no lugar das capturas do app que o Rallies põe sobre a pintura:
// pedaços de tela de verdade, com o dado da api (nunca uma pintura, uma captura nem um número inventado). Onde não há dado ainda, o recorte diz
// o que falta. O cartão é o `.recorte` (globals.css, o bloco da landing): o canvas com o fio e a sombra do recorte do Rallies.

const NO_RESULT =
  'Ainda não há resultado: a primeira liquidação acontece depois do primeiro pregão.';

const SaibaMais = ({ href, children }: { href: string; children: ReactNode }) => (
  <NavLink href={href} className="saiba-mais">
    {children}
    <span aria-hidden="true">›</span>
  </NavLink>
);

// O cartão "Arena agora", por cima da moldura do hero: a faixa dos modelos (o logo, o nome, a etiqueta e o retorno, na ordem do ranking),
// que rola dentro dela, e o link para a arena.
export function ArenaAgora({ rows }: { rows: readonly LeaderboardRow[] }) {
  return (
    <section aria-labelledby="arena-agora-titulo" className="recorte space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4">
        <h2 id="arena-agora-titulo" className="font-display text-18">
          Arena agora
        </h2>
        <SaibaMais href="/arena">Abrir a arena</SaibaMais>
      </div>
      {rows.length > 0 ? (
        <div className="-mx-4 sm:-mx-5">
          <FaixaDeModelos rows={rows} label="Retorno na temporada: modelos e Sorteio" />
        </div>
      ) : (
        <Empty>{NO_RESULT}</Empty>
      )}
    </section>
  );
}

// Um painel do Rallies: o cinza do painel, o texto de um lado (o título, o parágrafo e o link) e o recorte do outro, alternando a partir de
// 1024 px. No HTML o texto vem sempre antes (a ordem de leitura); no celular, um embaixo do outro.
function Painel({
  id,
  title,
  text,
  link,
  flip = false,
  children,
}: {
  id: string;
  title: string;
  text: string;
  link: { label: string; href: string };
  flip?: boolean;
  children?: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`${id}-titulo`}
      className={children ? 'painel lg:grid-cols-2' : 'painel'}
    >
      <div className={`space-y-4 ${flip ? 'lg:order-last' : ''}`}>
        <h2 id={`${id}-titulo`} className="max-w-[24ch] font-display text-22 text-balance">
          {title}
        </h2>
        <p className="max-w-[46ch] text-15 text-pretty text-muted">{text}</p>
        <SaibaMais href={link.href}>{link.label}</SaibaMais>
      </div>
      {children ? <div className="min-w-0">{children}</div> : null}
    </section>
  );
}

export function Paineis({
  lastCycle,
  decision,
  ranked,
}: {
  lastCycle: LastCycle | null;
  decision: FeedDecision | null;
  // os modelos e o Sorteio, na ordem do ranking (vazio antes da primeira liquidação)
  ranked: readonly LeaderboardRow[];
}) {
  const returnOf = (slug: string) =>
    ranked.find((row) => row.competitor.slug === slug)?.returnBps ?? null;
  return (
    <div className="mt-24 space-y-6">
      <Painel
        id="mesma-pergunta"
        title="Todo pregão, a mesma pergunta"
        text="Às 08:00, cada modelo recebe o mesmo briefing (notícias, dados de mercado e macro) e o mesmo prompt, e responde BUY, SELL ou HOLD. O prompt fica oculto durante a temporada: a versão e o SHA-256 dele saem a cada ciclo."
        link={
          lastCycle
            ? { label: 'Ver o último ciclo', href: `/ciclos/${lastCycle.date}` }
            : { label: 'Ver as regras', href: '/como-funciona' }
        }
      >
        {lastCycle ? (
          <div className="recorte space-y-4">
            <p className="text-13 text-muted">
              Ciclo de {formatDate(lastCycle.date)}: os itens válidos de todas as decisões.
            </p>
            <div className="overflow-hidden rounded-lg border border-hairline">
              <Strip columns={3}>
                {(['BUY', 'SELL', 'HOLD'] as const).map((action) => (
                  <StripItem key={action} term={action}>
                    {lastCycle.counts[action]}
                  </StripItem>
                ))}
              </Strip>
            </div>
            <dl className="space-y-3">
              <div className="space-y-1">
                <dt className="text-xs text-muted">Versão do prompt</dt>
                <dd className="font-mono text-13 break-all text-ink">
                  {lastCycle.prompt?.version ?? 'sem registro'}
                </dd>
              </div>
              <div className="space-y-1">
                <dt className="text-xs text-muted">SHA-256 do prompt</dt>
                <dd className="font-mono text-xs break-all text-ink">
                  {lastCycle.prompt?.sha256 ?? 'sem registro'}
                </dd>
              </div>
            </dl>
          </div>
        ) : (
          <Empty>O primeiro ciclo aparece aqui depois do primeiro pregão.</Empty>
        )}
      </Painel>

      <Painel
        id="justificativa"
        title="A justificativa fica aberta"
        text="Cada decisão sai inteira no feed: o resumo, a visão de mercado e cada ordem com a confiança e a justificativa, nas palavras do modelo."
        link={{ label: 'Ver o feed', href: '/arena#feed' }}
        flip
      >
        {decision ? (
          <div className="recorte">
            <DecisionCard
              decision={decision}
              date={decision.date}
              by="model"
              simulated={isSimulated(decision.competitor)}
              returnBps={returnOf(decision.competitor.slug)}
            />
          </div>
        ) : (
          <Empty>Nenhuma decisão ainda.</Empty>
        )}
      </Painel>

      <Painel
        id="sorte-ou-habilidade"
        title="Sorte ou habilidade?"
        text="O Sorteio compete com as mesmas regras e os mesmos custos, mas sorteia as ordens. O Monte Carlo simula carteiras aleatórias com as mesmas regras, e o percentil de cada competidor é a parte delas que ficou abaixo dele."
        link={{ label: 'Ver o ranking', href: '/ranking' }}
      >
        {ranked.length > 0 ? (
          <div className="recorte space-y-3">
            <LeaderboardTable
              rows={ranked}
              label="Ranking por retorno: modelos e Sorteio"
              compact
            />
            <p className="text-xs text-muted">
              A posição vale entre todos os competidores, referências incluídas (CDI, igual-peso e
              BOVA11): por isso a tabela pode pular números.
            </p>
          </div>
        ) : (
          <Empty>{NO_RESULT}</Empty>
        )}
      </Painel>

      <Painel
        id="carteira"
        title="Sua carteira, anotada por você"
        text="Anote as ações que você comprou e acompanhe o preço médio, o valor estimado e o ganho ou a perda. A Alvesting não compra nem vende nada e não fala com a sua corretora. O chat vem depois: ele ainda está desligado."
        link={{ label: 'Abrir a carteira', href: '/carteira' }}
        flip
      />
    </div>
  );
}
