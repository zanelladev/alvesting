import { Logger } from '@nestjs/common';
import { parseEnv } from './config/env.js';
import { PrismaService } from './infrastructure/database/prisma.service.js';
import { CycleCloser } from './modules/arena/application/cycle-closer.js';
import { ArenaRepository } from './modules/arena/infrastructure/arena.repository.js';
import { loadTradingCalendar } from './modules/market-data/domain/trading-calendar.js';
import { JobRunStore } from './modules/messaging/infrastructure/job-run.store.js';
import { CorporateEventService } from './modules/settlement/application/corporate-event.service.js';
import { SettleHandler } from './modules/settlement/application/settle.handler.js';
import { SettlementRepository } from './modules/settlement/infrastructure/settlement.repository.js';

// Linha de comando da liquidação (docs/JOBS.md). Usa o banco do ambiente (DATABASE_URL), sem fila e sem Blob.
//   pnpm --filter @alvesting/api settle:event <TICKER> <AAAA-MM-DD> <split|reverse-split|bonus> <de:para>
const USAGE = `Uso:
  event <TICKER> <AAAA-MM-DD> <tipo> <de:para>
      registra um evento corporativo em ações e reliquida as temporadas que já passaram da data ex. Cada "de" ações antigas
      viram "para" ações novas. O tipo confere com o fator (desdobramento e bonificação aumentam as ações; grupamento reduz).
        split          desdobramento     1:2 (cada ação vira 2)
        reverse-split  grupamento       10:1 (cada 10 ações viram 1)
        bonus          bonificação      10:11 (bonificação de 10%)
      Repetir o comando não muda o evento e refaz a liquidação; o mesmo ticker, data ex e tipo com outro fator corrige o evento.
      O registro e a correção (com o fator antigo e o novo) ficam na trilha de auditoria (audit_log, ator "cli").`;

async function main(argv: string[]): Promise<number> {
  const [command, ticker, exDate, kind, factor] = argv;
  if (command !== 'event' || !ticker || !exDate || !kind || !factor || argv.length !== 5) {
    console.error(USAGE);
    return 2;
  }

  Logger.overrideLogger(['warn', 'error']); // o resultado sai por console.log
  const env = parseEnv();
  const prisma = new PrismaService(env);
  try {
    const arena = new ArenaRepository(prisma);
    const repo = new SettlementRepository(prisma);
    const jobs = new JobRunStore(prisma);
    const settle = new SettleHandler({
      jobs,
      arena,
      closer: new CycleCloser(arena),
      repo,
      calendar: loadTradingCalendar(),
    });
    const service = new CorporateEventService({ repo, jobs, settle });

    const result = await service.register({ ticker, exDate, kind, factor }, new Date(), 'cli');
    const { event } = result;
    console.log(
      `evento ${event.ticker} ${kind} ${event.ratioFrom}:${event.ratioTo}, data ex ${event.exDate}: ` +
        { created: 'registrado', updated: 'fator corrigido', unchanged: 'já estava registrado' }[
          event.change
        ],
    );
    for (const season of result.settled) {
      console.log(
        `  temporada ${season.season}: liquidada de novo até ${season.through}${season.finished ? ' (encerrada agora)' : ''}`,
      );
    }
    for (const slug of result.pending) {
      console.log(
        `  temporada ${slug}: só liquidou até antes da data ex; o evento entra quando ela chegar lá`,
      );
    }
    if (result.settled.length + result.pending.length === 0) {
      console.log('  nenhuma temporada liquidada ainda: o evento vale na primeira liquidação');
    }
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
