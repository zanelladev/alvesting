import { Logger } from '@nestjs/common';
import { parseEnv } from './config/env.js';
import { PrismaService } from './infrastructure/database/prisma.service.js';
import { FreezeHandler } from './modules/briefing/application/freeze.handler.js';
import { BriefingArchive } from './modules/briefing/infrastructure/briefing.archive.js';
import { BriefingRepository } from './modules/briefing/infrastructure/briefing.repository.js';
import { isIsoDate } from './modules/market-data/domain/dates.js';
import { loadTradingCalendar } from './modules/market-data/domain/trading-calendar.js';
import { createBlobServiceClient } from './infrastructure/storage/blob-client.js';
import { JobRunStore } from './modules/messaging/infrastructure/job-run.store.js';

// Linha de comando do briefing (docs/DADOS.md). Usa o banco e o Blob do ambiente (DATABASE_URL e
// STORAGE_CONNECTION_STRING ou STORAGE_BLOB_ENDPOINT), sem fila.
//   pnpm --filter @alvesting/api briefing:freeze <AAAA-MM-DD>     congela o briefing do pregão (idempotente)
const USAGE = `Uso:
  briefing:freeze <AAAA-MM-DD>     congela o briefing do pregão: monta, grava no Blob e registra pregão, SHA-256 e URI.
                                   Repetir não muda nada. Precisa do universo da semana (market:universe) e das barras
                                   do pregão anterior (market:backfill ou o eod).`;

async function main(argv: string[]): Promise<number> {
  const [command, date] = argv;
  if (command !== 'freeze' || !date || !isIsoDate(date)) {
    console.error(USAGE);
    return 2;
  }

  Logger.overrideLogger(['warn', 'error']); // o resumo sai por console.log
  const env = parseEnv();
  const prisma = new PrismaService(env);
  try {
    const repo = new BriefingRepository(prisma);
    const handler = new FreezeHandler(
      new JobRunStore(prisma),
      loadTradingCalendar(),
      repo,
      new BriefingArchive(createBlobServiceClient(env)),
    );
    const result = await handler.execute(date);
    if (result.outcome === 'frozen') {
      const { stats } = result;
      console.log(
        `briefing ${date}: congelado. SHA-256 ${result.sha256}\n  ${result.uri}\n` +
          `  ${stats.bytes} bytes; ${stats.universeRows} linhas no universo; triagem de ${stats.screening}; ` +
          `${stats.citedTickers} ações citadas; ${stats.barsTickers} ações com barras (${stats.barRows} barras); ` +
          `${stats.newsItems} notícias`,
      );
    } else if (result.outcome === 'already_done') {
      const stored = await repo.find(date);
      console.log(
        `briefing ${date}: já congelado${stored ? `. SHA-256 ${stored.sha256}\n  ${stored.uri}` : ''}`,
      );
    } else {
      console.log(`briefing ${date}: não é pregão, nada a congelar`);
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
