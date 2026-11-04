import type { SeasonParams } from '@alvesting/contracts';
import type { PrismaService } from '../infrastructure/database/prisma.service.js';
import { isoWeek, type IsoDate } from '../modules/market-data/domain/dates.js';
import type { BusDeadLetter, BusDelivery } from './bus.js';
import type { FakeBrapiRequest } from './fake-brapi.js';
import { REFERENCE, type SyntheticMarket } from './market.js';

// O relatório do ensaio (arena:ensaio, docs/ENSAIO.md): por pregão, os hashes (briefing e prompt), as decisões, as ordens e o
// patrimônio de cada competidor; no fim, o ranking com o percentil no Monte Carlo, a fila e as verificações. É uma função só do que
// ficou no banco e no barramento: nada de hora da máquina, de ULID nem de caminho de arquivo, para duas execuções com a mesma semente
// darem o mesmo texto, byte a byte (é a prova de determinismo). O hash do prompt é público (o SHA-256 do texto); o texto não sai.

export interface EnsaioCheck {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
}

export interface ReportInput {
  prisma: PrismaService;
  seasonSlug: string;
  seed: number;
  market: SyntheticMarket;
  deliveries: readonly BusDelivery[];
  deadLetters: readonly BusDeadLetter[];
  blockedNetwork: readonly string[];
  logs: { warn: number; error: number };
  // o texto que não pode aparecer no relatório (o canário do prompt)
  canary: string;
  // as requisições que a brapi falsa recebeu, e o pregão cuja barra sai atrasada nela
  brapiRequests: readonly FakeBrapiRequest[];
  lateDay?: IsoDate;
}

export interface BuiltReport {
  text: string;
  json: string;
  checks: EnsaioCheck[];
  ok: boolean;
  bus: {
    delivered: number;
    retried: number;
    deadLettered: number;
    byQueue: Record<string, number>;
  };
}

const iso = (date: Date): IsoDate => date.toISOString().slice(0, 10);

// R$ 1.014.694,12, só com inteiros
export function brl(cents: bigint): string {
  const abs = cents < 0n ? -cents : cents;
  const reais = (abs / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${cents < 0n ? '-' : ''}R$ ${reais},${(abs % 100n).toString().padStart(2, '0')}`;
}

// pontos-base como porcentagem: 1234 -> 12,34%, -90 -> -0,90%
export function pct(bps: number | null): string {
  if (bps === null) return '-';
  const abs = Math.abs(bps);
  return `${bps < 0 ? '-' : ''}${Math.trunc(abs / 100)},${String(abs % 100).padStart(2, '0')}%`;
}

const pad = (text: string, width: number): string => text.padEnd(width, ' ');
const lpad = (text: string, width: number): string => text.padStart(width, ' ');
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

// Quantas requisições o plano prevê para cada pregão do ensaio (docs/ENSAIO.md): uma por papel do conjunto obrigatório (as ações do universo,
// que no ensaio são todas, e o BOVA11) na primeira passada; o papel sem negócio no dia (ou suspenso) é pedido de novo nas novas tentativas
// até o prazo das 00:30 (22:30, 23:30 e 00:30); no pregão atrasado a primeira passada é só a sonda do BOVA11, e as novas tentativas começam
// às 22:30 com o conjunto inteiro. O teste do ensaio e a verificação do relatório falham se o número fugir daqui.
export function plannedBrapiRequests(
  market: SyntheticMarket,
  lateDay?: IsoDate,
): Map<IsoDate, number> {
  const required = [REFERENCE, ...market.stocks.map((stock) => stock.ticker)];
  const planned = new Map<IsoDate, number>();
  for (const day of market.sessionDays) {
    const traded = new Set((market.bars.get(day) ?? []).map((bar) => bar.ticker));
    const stragglers = required.filter((ticker) => !traded.has(ticker)).length;
    const late = day === lateDay;
    planned.set(day, (late ? 1 : 0) + required.length + stragglers * (late ? 2 : 3));
  }
  return planned;
}

export async function buildReport(input: ReportInput): Promise<BuiltReport> {
  const { prisma, market, seed } = input;
  const season = await prisma.season.findFirstOrThrow({
    where: { slug: input.seasonSlug },
    include: { competitors: { orderBy: { position: 'asc' } } },
  });
  const params = season.params as unknown as SeasonParams;
  const competitors = season.competitors;
  const slugOf = new Map(competitors.map((c) => [c.id, c.slug]));
  const rank = new Map(competitors.map((c, i) => [c.id, i]));
  const byCompetitor = <T extends { competitorId: string }>(a: T, b: T) =>
    (rank.get(a.competitorId) ?? 0) - (rank.get(b.competitorId) ?? 0);
  const models = competitors.filter((c) => c.kind === 'MODEL');
  const shown = new Set(competitors.filter((c) => c.kind !== 'BENCHMARK').map((c) => c.id));
  const sessions = market.sessionDays;

  const cycles = await prisma.cycle.findMany({
    where: { seasonId: season.id },
    orderBy: { date: 'asc' },
    include: {
      briefing: true,
      promptVersion: true,
      decisions: { include: { items: { orderBy: { position: 'asc' } } } },
    },
  });
  const orders = await prisma.order.findMany({
    where: { seasonId: season.id },
    include: { fill: true },
    orderBy: [{ date: 'asc' }, { itemIndex: 'asc' }],
  });
  const snapshots = await prisma.equitySnapshot.findMany({ where: { seasonId: season.id } });
  const positions = await prisma.position.findMany({
    where: { seasonId: season.id },
    orderBy: { ticker: 'asc' },
  });
  const stats = await prisma.seasonStat.findMany({ where: { seasonId: season.id } });
  const baselines = await prisma.randomBaseline.findMany({
    where: { seasonId: season.id },
    orderBy: { date: 'asc' },
  });
  const universes = await prisma.universeSnapshot.findMany({
    orderBy: { week: 'asc' },
    include: { _count: { select: { members: true } } },
  });
  const event = await prisma.corporateEvent.findFirst({ where: { ticker: market.split.ticker } });
  const jobs = await prisma.jobRun.count();
  const unfinishedJobs = await prisma.jobRun.count({ where: { status: { not: 'SUCCEEDED' } } });

  const lines: string[] = [];
  const out = (line = '') => lines.push(line);

  // --- cabeçalho ---
  const prompt = cycles[0]?.promptVersion;
  out('ENSAIO DA TEMPORADA 0');
  out(
    `semente ${seed} | ${sessions.length} pregões (${sessions[0]} a ${sessions.at(-1)}) | ${market.stocks.length} ações e o BOVA11 | capital ${brl(BigInt(params.capitalCents))} por competidor`,
  );
  out(
    `histórico: ${market.historyDays.length} pregões (${market.historyDays[0]} a ${market.historyDays.at(-1)}) | universo: ${universes.map((u) => `${u.week} ${u._count.members} ações`).join(', ')}`,
  );
  out(
    `prompt: versão ${prompt?.version ?? '?'} | sha256 ${prompt?.sha256 ?? '?'} (o texto nunca sai do código)`,
  );

  // --- por pregão ---
  for (const date of sessions) {
    const cycle = cycles.find((c) => iso(c.date) === date);
    out();
    out(`PREGÃO ${date} (semana ${isoWeek(date)})`);
    out(
      `  briefing sha256 ${cycle?.briefing?.sha256 ?? '-'} (${cycle?.briefing?.bytes ?? 0} bytes) | prompt sha256 ${cycle?.promptVersion?.sha256 ?? '-'} | ciclo ${cycle?.status ?? '-'}`,
    );
    out('  decisões (08:00):');
    for (const decision of (cycle?.decisions ?? []).slice().sort(byCompetitor)) {
      const what =
        decision.status === 'FORCED_HOLD'
          ? `HOLD forçado (${decision.holdReason ?? '?'})`
          : decision.items
              .map(
                (item) =>
                  `${item.action ?? '?'} ${item.ticker ?? '?'}${item.percent === null ? '' : ` ${item.percent.toString()}%`}${item.dropped ? ` (descartado: ${item.dropReason ?? '?'})` : ''}`,
              )
              .join(' | ');
      const calls = (decision.usage as { calls?: number } | null)?.calls ?? 0;
      out(
        `    ${pad(slugOf.get(decision.competitorId) ?? '?', 16)} ${pad(decision.status, 11)} ${pad(decision.marketView ?? '-', 10)} ${plural(calls, 'chamada ', 'chamadas')}  ${what}`,
      );
    }
    out(
      '  ordens no preço de abertura (modelos e Sorteio; as referências só entram no patrimônio):',
    );
    const ofDay = orders.filter((o) => iso(o.date) === date && shown.has(o.competitorId));
    for (const o of ofDay.slice().sort(byCompetitor)) {
      const result = o.fill
        ? `${o.status} ${o.filledQuantity} de ${o.requestedQuantity ?? '?'} a ${brl(o.fill.priceCents)}`
        : `não executou (${o.reason ?? '?'})`;
      out(
        `    ${pad(slugOf.get(o.competitorId) ?? '?', 16)} ${o.action} ${pad(o.ticker, 6)} ${result}`,
      );
    }
    if (ofDay.length === 0) out('    (nenhuma)');
    out('  patrimônio no fechamento:');
    for (const s of snapshots.filter((x) => iso(x.date) === date).sort(byCompetitor)) {
      out(
        `    ${pad(slugOf.get(s.competitorId) ?? '?', 16)} ${lpad(brl(s.equityCents), 17)}  caixa ${lpad(brl(s.cashCents), 16)}  posições ${lpad(brl(s.positionsValueCents), 16)}  percentil ${lpad(pct(s.percentileBps), 7)}`,
      );
    }
    out('  posições dos modelos (* = ação sem negócio no dia, marcada pelo último fechamento):');
    for (const model of models) {
      const held = positions.filter((p) => p.competitorId === model.id && iso(p.date) === date);
      out(
        `    ${pad(model.slug, 16)} ${held.length === 0 ? '(sem posições)' : held.map((p) => `${p.ticker} ${p.quantity}${p.stale ? '*' : ''}`).join(' · ')}`,
      );
    }
  }

  // --- ranking e Monte Carlo ---
  const last = sessions.at(-1)!;
  out();
  out(`RANKING FINAL (${last})`);
  out(
    `  ${pad('#', 3)}${pad('competidor', 17)}${lpad('patrimônio', 17)}${lpad('retorno', 10)}${lpad('percentil', 11)}${lpad('vs igual-peso', 15)}${lpad('vs CDI', 10)}${lpad('drawdown', 10)}${lpad('operações', 11)}${lpad('acerto', 9)}`,
  );
  const ranking = stats
    .slice()
    .sort(
      (a, b) =>
        b.returnBps - a.returnBps ||
        ((slugOf.get(a.competitorId) ?? '') < (slugOf.get(b.competitorId) ?? '') ? -1 : 1),
    );
  ranking.forEach((s, i) => {
    const equity = snapshots.find((x) => x.competitorId === s.competitorId && iso(x.date) === last);
    out(
      `  ${pad(String(i + 1), 3)}${pad(slugOf.get(s.competitorId) ?? '?', 17)}${lpad(equity ? brl(equity.equityCents) : '-', 17)}${lpad(pct(s.returnBps), 10)}${lpad(pct(s.percentileBps), 11)}${lpad(pct(s.excessEqualWeightBps), 15)}${lpad(pct(s.excessCdiBps), 10)}${lpad(pct(s.maxDrawdownBps), 10)}${lpad(String(s.trades), 11)}${lpad(pct(s.winRateBps), 9)}`,
    );
  });
  out();
  out(
    `Monte Carlo (${baselines[0]?.runs ?? 0} carteiras aleatórias, semente "${baselines[0]?.seed ?? '?'}"): patrimônio nos percentis 5 / 50 / 95`,
  );
  for (const b of baselines) {
    out(
      `  ${iso(b.date)}  ${lpad(brl(b.equityP5Cents), 16)} / ${lpad(brl(b.equityP50Cents), 16)} / ${lpad(brl(b.equityP95Cents), 16)}`,
    );
  }

  // --- a fila ---
  const byQueue: Record<string, number> = {};
  for (const d of input.deliveries) byQueue[d.queue] = (byQueue[d.queue] ?? 0) + 1;
  const retried = input.deliveries.filter((d) => d.action === 'retry').length;
  const bus = {
    delivered: input.deliveries.length,
    retried,
    deadLettered: input.deadLetters.length,
    byQueue,
  };
  // o eod reagendado volta com o mesmo MessageId: duas entregas do mesmo `eod:<pregão>`
  const eodDeliveries = new Map<string, number>();
  for (const d of input.deliveries) {
    if (d.messageId.startsWith('eod:'))
      eodDeliveries.set(d.messageId, (eodDeliveries.get(d.messageId) ?? 0) + 1);
  }
  const eodRescheduled = [...eodDeliveries.values()].filter((n) => n > 1).length;
  out();
  out('FILA (barramento em processo, a mesma regra do MessagingService)');
  out(
    `  entregas: ${Object.entries(byQueue)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([queue, n]) => `${queue} ${n}`)
      .join(', ')}`,
  );
  out(
    `  novas tentativas agendadas: ${retried} | eod reagendado (a brapi ainda sem o BOVA11 ou algum papel do dia): ${eodRescheduled} | mensagens na DLQ: ${bus.deadLettered}`,
  );
  out(
    `  jobs gravados: ${jobs} (não concluídos: ${unfinishedJobs}) | avisos nos logs: ${input.logs.warn} | erros nos logs: ${input.logs.error}`,
  );

  // --- a brapi falsa: as requisições por pregão (o `to` do pedido é o pregão buscado) ---
  const lastHistory = market.historyDays.at(-1);
  const historical = input.brapiRequests.filter((r) => r.kind === 'historical');
  const lists = input.brapiRequests.length - historical.length;
  const bySession = new Map<IsoDate, number>(sessions.map((day) => [day, 0]));
  for (const request of historical) {
    if (request.to !== undefined && bySession.has(request.to)) {
      bySession.set(request.to, (bySession.get(request.to) ?? 0) + 1);
    }
  }
  const loadRequests = historical.filter((r) => r.to === lastHistory).length;
  const planned = plannedBrapiRequests(market, input.lateDay);
  const weeks = new Set(sessions.map(isoWeek)).size;
  out();
  out('BRAPI FALSA (o fetch do ensaio, no formato dos docs; nenhuma rede)');
  out(
    `  requisições: ${input.brapiRequests.length} | carga inicial ${loadRequests} (uma por papel e o BOVA11) | listas de ações ${lists} (a da carga e uma por domingo)`,
  );
  out(`  por pregão: ${sessions.map((day) => `${day} ${bySession.get(day)}`).join(' · ')}`);

  // --- verificações ---
  const checks: EnsaioCheck[] = [];
  const check = (id: string, label: string, ok: boolean, detail: string) =>
    checks.push({ id, label, ok, detail });
  const num = (n: number | bigint) => String(n);

  check(
    'dlq',
    'DLQ vazia',
    input.deadLetters.length === 0,
    plural(input.deadLetters.length, 'mensagem', 'mensagens'),
  );
  check(
    'rede',
    'nenhum acesso à rede (fetch global e TCP fora do loopback bloqueados)',
    input.blockedNetwork.length === 0,
    `${input.blockedNetwork.length} tentativas${input.blockedNetwork.length > 0 ? `: ${input.blockedNetwork.join(', ')}` : ''}`,
  );
  const cyclesOk = sessions.every((date) => {
    const cycle = cycles.find((c) => iso(c.date) === date);
    return cycle?.status === 'CLOSED' && cycle.decisions.length === models.length;
  });
  check(
    'ciclos',
    'um ciclo fechado por pregão, com uma decisão de cada modelo',
    cyclesOk,
    `${cycles.length} ciclos para ${sessions.length} pregões e ${models.length} modelos`,
  );
  const forced = cycles.flatMap((c) => c.decisions).filter((d) => d.status === 'FORCED_HOLD');
  check(
    'holds',
    'nenhum HOLD forçado (prazo, falha ou resposta inválida)',
    forced.length === 0,
    plural(forced.length, 'HOLD', 'HOLDs'),
  );
  const have = new Set(snapshots.map((s) => `${s.competitorId}|${iso(s.date)}`));
  const missing = competitors.flatMap((c) =>
    sessions.filter((d) => !have.has(`${c.id}|${d}`)).map((d) => `${c.slug} ${d}`),
  );
  check(
    'patrimonio',
    'patrimônio de cada competidor em cada pregão',
    missing.length === 0,
    missing.length === 0
      ? `${snapshots.length} snapshots (${competitors.length} competidores x ${sessions.length} pregões)`
      : `faltam ${missing.join(', ')}`,
  );
  check(
    'jobs',
    'todos os jobs concluídos (nenhum FAILED nem RUNNING no fim)',
    unfinishedJobs === 0,
    `${jobs} jobs, ${unfinishedJobs} não concluídos`,
  );
  const repaired = cycles
    .flatMap((c) => c.decisions)
    .filter((d) => ((d.usage as { calls?: number } | null)?.calls ?? 0) === 2);
  check(
    'reparo',
    'o reparo de JSON aparece (resposta quebrada na 1ª chamada, certa na 2ª)',
    repaired.length >= 1,
    plural(repaired.length, 'decisão', 'decisões'),
  );
  check(
    'nova-tentativa',
    'falha passageira do provedor: a fila reentrega depois e a decisão sai, sem DLQ',
    retried >= 1 && input.deadLetters.length === 0,
    plural(retried, 'nova tentativa agendada', 'novas tentativas agendadas'),
  );
  const lateDeliveries = input.lateDay
    ? input.deliveries.filter((d) => d.messageId === `eod:${input.lateDay}`).length
    : 0;
  check(
    'eod-reagendado',
    'brapi atrasada: o eod vê o BOVA11 sem a barra do dia, se reagenda e completa na tentativa seguinte',
    eodRescheduled >= 1 && lateDeliveries >= 2,
    `${plural(eodRescheduled, 'pregão', 'pregões')} reagendados; o atrasado (${input.lateDay ?? '-'}) teve ${lateDeliveries} entregas`,
  );
  const onPlan = sessions.every((day) => bySession.get(day) === planned.get(day));
  check(
    'requisicoes',
    'requisições à brapi falsa dentro do plano (uma por papel que falta; só quem não veio é pedido de novo)',
    onPlan && loadRequests === market.stocks.length + 1 && lists === 1 + weeks,
    sessions.map((day) => `${bySession.get(day)}/${planned.get(day)}`).join(' · '),
  );

  const noBar = orders.filter((o) => o.reason === 'no_bar');
  const noBarOk = noBar.every(
    (o) =>
      o.status === 'NOT_EXECUTED' &&
      o.fill === null &&
      o.priceCents === null &&
      o.filledQuantity === 0n,
  );
  check(
    'sem-barra',
    'ação sem negócio no dia: a ordem não executa, sem preço e sem execução',
    noBar.length >= 1 && noBarOk,
    plural(noBar.length, 'ordem', 'ordens'),
  );

  const stale = positions.filter((p) => p.stale);
  const staleOk = stale.every((p) => {
    const index = sessions.indexOf(iso(p.date));
    const before = positions.find(
      (q) =>
        q.competitorId === p.competitorId &&
        q.ticker === p.ticker &&
        iso(q.date) === sessions[index - 1],
    );
    return before !== undefined && before.markCents === p.markCents;
  });
  check(
    'suspensa',
    'ação suspensa: a posição segue marcada pelo último fechamento',
    stale.length >= 1 && staleOk,
    plural(stale.length, 'posição marcada', 'posições marcadas'),
  );

  const exDate = market.split.exDate;
  const exIndex = sessions.indexOf(exDate);
  const holders = positions.filter(
    (p) => p.ticker === market.split.ticker && iso(p.date) === sessions[exIndex - 1],
  );
  const doubled = holders.map((holder) => {
    const net = orders
      .filter(
        (o) =>
          o.competitorId === holder.competitorId &&
          o.ticker === market.split.ticker &&
          iso(o.date) === exDate &&
          o.fill,
      )
      .reduce((sum, o) => sum + (o.action === 'BUY' ? o.fill!.quantity : -o.fill!.quantity), 0n);
    const after = positions.find(
      (p) =>
        p.competitorId === holder.competitorId &&
        p.ticker === market.split.ticker &&
        iso(p.date) === exDate,
    );
    return (after?.quantity ?? 0n) === holder.quantity * 2n + net;
  });
  check(
    'desdobramento',
    `desdobramento 1:2 de ${market.split.ticker} na data ex (${exDate}): a quantidade dobra`,
    event !== null && holders.length >= 1 && doubled.every(Boolean),
    `${event ? 'evento registrado' : 'evento ausente'}; ${plural(holders.length, 'carteira', 'carteiras')} com a ação`,
  );

  const hold = models.find((m) => m.modelId === 'fake/hold-only');
  const cdi = competitors.find((c) => c.benchmark === 'CDI');
  if (hold && cdi) {
    const same = sessions.every((d) => {
      const a = snapshots.find((s) => s.competitorId === hold.id && iso(s.date) === d);
      const b = snapshots.find((s) => s.competitorId === cdi.id && iso(s.date) === d);
      return a !== undefined && b !== undefined && a.equityCents === b.equityCents;
    });
    check(
      'cdi',
      'o modelo que só segura rende como o CDI, centavo a centavo',
      same,
      `${hold.slug} contra ${cdi.slug}`,
    );
  }

  check(
    'encerramento',
    'a temporada encerra no último pregão (FINISHED, com a hora do encerramento)',
    season.status === 'FINISHED' && season.finishedAt !== null,
    season.status,
  );
  const percentilesOk =
    stats.length === competitors.length &&
    stats.every(
      (s) => s.percentileBps !== null && s.percentileBps >= 0 && s.percentileBps <= 10_000,
    );
  check(
    'percentis',
    'todo competidor tem percentil no Monte Carlo (0 a 10.000 pontos-base)',
    percentilesOk,
    `${stats.length} de ${competitors.length}`,
  );
  const promptHashes = new Set(cycles.map((c) => c.promptVersion?.sha256 ?? null));
  const briefingHashes = new Set(cycles.map((c) => c.briefing?.sha256 ?? null));
  check(
    'hashes',
    'o mesmo prompt em todos os ciclos (SHA-256 registrado) e um briefing diferente por pregão',
    promptHashes.size === 1 &&
      !promptHashes.has(null) &&
      briefingHashes.size === sessions.length &&
      !briefingHashes.has(null),
    `${promptHashes.size} prompt, ${briefingHashes.size} briefings`,
  );
  check(
    'universo',
    'universo semanal congelado para cada semana do ensaio',
    new Set(sessions.map(isoWeek)).size ===
      universes.filter((u) => sessions.some((d) => isoWeek(d) === u.week)).length,
    universes.map((u) => `${u.week}: ${num(u._count.members)}`).join(', '),
  );
  check(
    'segredo',
    'o texto do prompt não aparece no relatório',
    !lines.join('\n').includes(input.canary),
    'o canário do prompt fica de fora',
  );

  out();
  out('VERIFICAÇÕES');
  for (const c of checks) out(`  [${c.ok ? 'ok' : 'FALHOU'}] ${c.label}: ${c.detail}`);
  const ok = checks.every((c) => c.ok);
  out();
  out(`RESULTADO: ${ok ? 'OK' : 'FALHOU'}`);

  const json = JSON.stringify(
    {
      seed,
      sessions,
      days: sessions.map((date) => {
        const cycle = cycles.find((c) => iso(c.date) === date);
        return {
          date,
          briefing: cycle?.briefing?.sha256 ?? null,
          prompt: cycle?.promptVersion?.sha256 ?? null,
        };
      }),
      ranking: ranking.map((s) => ({
        competitor: slugOf.get(s.competitorId),
        returnBps: s.returnBps,
        percentileBps: s.percentileBps,
        trades: s.trades,
      })),
      bus,
      checks,
    },
    null,
    2,
  );
  return { text: `${lines.join('\n')}\n`, json: `${json}\n`, checks, ok, bus };
}
