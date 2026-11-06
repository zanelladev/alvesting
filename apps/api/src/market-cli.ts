import { Logger } from '@nestjs/common';
import { parseEnv, type Env } from './config/env.js';
import { PrismaService } from './infrastructure/database/prisma.service.js';
import { databaseLabel, parseBackfillArgs, parseLogosArgs } from './market-cli-args.js';
import { JobRunStore } from './modules/messaging/infrastructure/job-run.store.js';
import { BarLoader } from './modules/market-data/application/bar-loader.js';
import { BrapiBackfill } from './modules/market-data/application/backfill.js';
import { LOGO_MAX_AGE_MS, LogoRefresh } from './modules/market-data/application/logo-refresh.js';
import { UniverseHandler } from './modules/market-data/application/universe.handler.js';
import { brasiliaDate } from './modules/market-data/domain/dates.js';
import { loadTradingCalendar } from './modules/market-data/domain/trading-calendar.js';
import { BrapiClient } from './modules/market-data/infrastructure/brapi.client.js';
import { BrapiLock } from './modules/market-data/infrastructure/brapi.lock.js';
import { MarketRepository } from './modules/market-data/infrastructure/market.repository.js';
import { UniverseRepository } from './modules/market-data/infrastructure/universe.repository.js';

// Linha de comando dos dados de mercado (docs/DADOS.md). Usa o banco do ambiente (DATABASE_URL), sem fila.
//   pnpm --filter @alvesting/api market:backfill [opções]   carga de barras pela brapi (3 meses, só o que falta)
//   pnpm --filter @alvesting/api market:universe <AAAA-Www> monta o universo da semana (ex.: 2026-W45)
//   pnpm --filter @alvesting/api market:logos [opções]      os logos das ações (a lista da brapi e os SVG do icons.brapi.dev)
const USAGE = `Uso:
  market:backfill [--papeis A,B] [--de AAAA-MM-DD] [--ate AAAA-MM-DD] [--confirmo-banco <nome>]
      Carga pela brapi: 3 meses de barras de todo papel da lista mais o BOVA11 (de uns 380 pedidos num banco novo a uns 440 no dev), só inserção e
      retomável. Sem --confirmo-banco NÃO usa a rede: mostra o banco de destino e quantas requisições faria.
      Com ele (o nome do banco que o modo sem rede mostrou), busca de verdade. --papeis e as datas recuperam um papel
      ou uma janela. Não publica liquidação.
  market:universe <AAAA-Www>
      Monta e congela o universo da semana ISO (ex.: 2026-W45) sobre as barras do banco, sem rede.
  market:logos [--confirmo-banco <nome>]
      Os logos das ações (ADR 0036): a lista da brapi (1 pedido, fora da cota) e o SVG de cada papel do banco que ela traz com
      logo, do icons.brapi.dev, só o que falta, mudou de endereço ou tem mais de 30 dias. Sem --confirmo-banco NÃO usa a rede:
      mostra o banco de destino e quantos pedidos faria. Com ele (o nome que o modo sem rede mostrou), busca de verdade.`;

const brl = (cents: bigint): string =>
  `R$ ${(cents / 100n).toLocaleString('pt-BR')},${String(cents % 100n).padStart(2, '0')}`;

async function backfill(args: string[], prisma: PrismaService, env: Env): Promise<void> {
  const options = parseBackfillArgs(args);
  const calendar = loadTradingCalendar();
  const today = brasiliaDate(new Date());
  const market = new MarketRepository(prisma);
  const brapi = new BrapiClient(env.BRAPI_TOKEN?.reveal(), undefined, {
    exclusive: new BrapiLock(prisma).run,
  });
  const backfiller = new BrapiBackfill(brapi, new BarLoader(brapi, market), market, calendar);
  const input = {
    tickers: options.tickers,
    from: options.from,
    to: options.to ?? calendar.previousTradingDay(today),
    today,
    fetch: false,
  };

  const database = databaseLabel(env.DATABASE_URL);
  const plan = await backfiller.plan(input);
  console.log(`banco de destino: ${database.host}/${database.name}`);
  console.log(
    `janela: ${plan.from} a ${plan.to} (${plan.sessions} pregões); ${plan.papers} papéis com barra faltando; ` +
      `${plan.requests} requisições previstas${options.tickers ? '' : ' (a da lista da brapi inclusive; papel novo da lista soma uma cada)'}`,
  );
  if (options.confirmDatabase !== database.name) {
    console.log(
      `Sem rede, nada foi buscado. Para buscar de verdade, repita o comando com --confirmo-banco ${database.name}`,
    );
    return;
  }

  const started = Date.now();
  const summary = await backfiller.run({ ...input, fetch: true });
  console.log(
    `${summary.inserted} barras gravadas e ${summary.confirmedDays} pregões confirmados em ${((Date.now() - started) / 1000).toFixed(1)} s`,
  );
  if (summary.divergent > 0) {
    console.warn(
      `  ATENÇÃO: ${summary.divergent} barras vieram com valor diferente do gravado (nada foi alterado)`,
    );
  }
  if (summary.failed.length > 0) {
    console.warn(
      `  ${summary.failed.length} papéis sem resposta (rode de novo: só a falta é pedida): ${summary.failed.slice(0, 20).join(', ')}`,
    );
  }
  if (summary.stopped)
    console.warn(
      `  A busca parou antes do fim (${summary.stopped}); rode de novo para pedir o resto`,
    );
  if (!summary.complete) {
    console.warn(
      '  Carga parcial: nenhum pregão foi confirmado. Só a carga completa os confirma (sem --papeis, sem parada, com o BOVA11 e no máximo 10% dos papéis sem resposta); rode de novo para pedir só a falta',
    );
  }
  console.log(
    `requisições feitas: ${summary.requestsMade}; cota restante informada pela brapi: ${summary.remaining ?? 'não informada'}`,
  );
}

// Os logos das ações (ADR 0036; docs/DADOS.md, seção 3a). Nenhum pedido ao histórico: a lista não gasta cota, e o icons.brapi.dev é outro
// host, sem token.
async function logos(args: string[], prisma: PrismaService, env: Env): Promise<void> {
  const options = parseLogosArgs(args);
  const database = databaseLabel(env.DATABASE_URL);
  const stocks = await prisma.instrument.count({ where: { kind: 'STOCK' } });
  const stored = await prisma.instrumentLogo.count();
  const stale = await prisma.instrumentLogo.count({
    where: { fetchedAt: { lt: new Date(Date.now() - LOGO_MAX_AGE_MS) } },
  });
  console.log(`banco de destino: ${database.host}/${database.name}`);
  console.log(
    `${stocks} ações no banco; ${stored} com logo guardado (${stale} com mais de 30 dias). Pedidos previstos: 1 à lista da brapi ` +
      `(fora da cota) e até ${stocks - stored + stale} SVG ao icons.brapi.dev (o endereço trocado, só a lista diz)`,
  );
  if (options.confirmDatabase !== database.name) {
    console.log(
      `Sem rede, nada foi buscado. Para buscar de verdade, repita o comando com --confirmo-banco ${database.name}`,
    );
    return;
  }

  const started = Date.now();
  const brapi = new BrapiClient(env.BRAPI_TOKEN?.reveal(), undefined, {
    exclusive: new BrapiLock(prisma).run,
  });
  const list = await brapi.listStocks();
  if (list.listings === null) {
    throw new Error(
      `a lista da brapi não veio (${list.stopped ?? 'formato ou resposta'}); nada foi buscado do icons.brapi.dev`,
    );
  }
  const summary = await new LogoRefresh(new MarketRepository(prisma)).run(list.listings, Infinity);
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.log(
    `lista da brapi: ${list.listings.length} ações, ${list.listings.filter((l) => l.logo).length} com logo ` +
      `(o ícone padrão e o endereço fora da forma contam como sem logo); ${summary.listed} delas estão no banco e ` +
      `${summary.asked} precisavam de busca`,
  );
  console.log(
    `${summary.stored} logos gravados, ${summary.unchanged} iguais (só a data andou), ${summary.refused.length} recusados e ` +
      `${summary.failed.length} sem resposta; ${summary.bytes} bytes em ${seconds} s`,
  );
  for (const { ticker, reason } of summary.purged) {
    console.warn(`  guardado e recusado pelo validador de hoje, apagado: ${ticker} (${reason})`);
  }
  const byReason = new Map<string, string[]>();
  for (const { ticker, reason } of summary.refused) {
    byReason.set(reason, [...(byReason.get(reason) ?? []), ticker]);
  }
  for (const [reason, tickers] of byReason) {
    console.warn(`  recusado (${reason}): ${tickers.length}: ${tickers.slice(0, 20).join(', ')}`);
  }
  if (summary.failed.length > 0) {
    console.warn(
      `  sem resposta (rode de novo: só a falta é pedida): ${summary.failed
        .slice(0, 20)
        .map((f) => `${f.ticker} (${f.reason})`)
        .join(', ')}`,
    );
  }
  if (summary.stopped) console.warn(`  A busca parou antes do fim (${summary.stopped})`);
  console.log(
    `pedidos: ${list.requests} à lista da brapi (/api/quote/list) e ${summary.requests} ao icons.brapi.dev; nenhum ao histórico. ` +
      `Cota informada pela lista: ${list.remaining ?? 'nenhuma (a lista não traz o X-RateLimit-Remaining e não gasta cota)'}`,
  );
}

async function universe(week: string | undefined, prisma: PrismaService): Promise<void> {
  if (!week || !/^\d{4}-W\d{2}$/.test(week))
    throw new Error(`Semana ISO inválida: ${week ?? '(nenhuma)'}`);
  const handler = new UniverseHandler(
    new JobRunStore(prisma),
    loadTradingCalendar(),
    new MarketRepository(prisma),
    new UniverseRepository(prisma),
  );
  const outcome = await handler.execute(week);
  const snapshot = await prisma.universeSnapshot.findUniqueOrThrow({
    where: { week },
    include: {
      _count: { select: { members: true } },
      members: { orderBy: { position: 'asc' }, take: 10, include: { instrument: true } },
    },
  });
  const day = (date: Date) => date.toISOString().slice(0, 10);
  console.log(
    `universo ${week}: ${outcome}. Janela de ${snapshot.windowDays} pregões (${day(snapshot.windowStart)} a ` +
      `${day(snapshot.windowEnd)}); ${snapshot.candidates} ações negociaram, ${snapshot.eligible} passaram na presença ` +
      `de 90%, ${snapshot._count.members} no universo (teto de 500).`,
  );
  console.log('As 10 primeiras, por volume financeiro médio por pregão:');
  for (const member of snapshot.members) {
    console.log(
      `  ${String(member.position).padStart(2)}. ${member.instrument.ticker.padEnd(7)} ${brl(member.avgVolumeCents).padStart(22)}  presença ${member.presenceDays}/${snapshot.windowDays}  ${member.instrument.name}`,
    );
  }
}

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  if (command !== 'backfill' && command !== 'universe' && command !== 'logos') {
    console.error(USAGE);
    return 2;
  }
  Logger.overrideLogger(['warn', 'error']); // o resumo sai por console.log
  const env = parseEnv();
  const prisma = new PrismaService(env);
  try {
    if (command === 'backfill') await backfill(args, prisma, env);
    else if (command === 'logos') await logos(args, prisma, env);
    else await universe(args[0], prisma);
    return 0;
  } finally {
    await prisma.onModuleDestroy();
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
