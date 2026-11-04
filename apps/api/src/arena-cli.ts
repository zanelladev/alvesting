import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ulidSchema } from '@alvesting/contracts';
import { Logger } from '@nestjs/common';
import { parseEnv } from './config/env.js';
import { PrismaService } from './infrastructure/database/prisma.service.js';
import { SeasonService } from './modules/arena/application/season.service.js';
import { ArenaRepository } from './modules/arena/infrastructure/arena.repository.js';
import { CycleViewRepository } from './modules/arena/infrastructure/cycle-view.repository.js';
import { formatCycle } from './modules/arena/presentation/cycle-format.js';
import { isIsoDate } from './modules/market-data/domain/dates.js';
import { loadTradingCalendar } from './modules/market-data/domain/trading-calendar.js';

// Linha de comando da arena (docs/ARENA.md). Usa o banco do ambiente (DATABASE_URL), sem fila e sem LLM.
//   pnpm --filter @alvesting/api season:create <arquivo.json>      cria a temporada (rascunho) com o elenco do arquivo
//   pnpm --filter @alvesting/api season:start <id>                 DRAFT -> RUNNING, com início no próximo pregão
//   pnpm --filter @alvesting/api cycle:show <AAAA-MM-DD> [slug]    mostra o ciclo de um pregão (ou <id do ciclo>)
const USAGE = `Uso:
  season:create <arquivo.json>        cria a temporada (DRAFT) com o elenco do arquivo, validando tudo. Exemplos versionados em
                                      apps/api/seasons/ (o ensaio com provedores fake e o rascunho da Temporada 1)
  season:start <id>                   passa a temporada de DRAFT para RUNNING; a data de início é o próximo pregão
  cycle:show <AAAA-MM-DD> [slug]      mostra o ciclo do pregão (status, hashes do prompt e do briefing, decisões); com o slug da
                                      temporada se houver mais de uma. Também aceita o id do ciclo no lugar da data`;

async function main(argv: string[]): Promise<number> {
  const [command, first, second] = argv;
  if (!command || !first || !['season-create', 'season-start', 'cycle-show'].includes(command)) {
    console.error(USAGE);
    return 2;
  }

  Logger.overrideLogger(['warn', 'error']); // o resultado sai por console.log
  const env = parseEnv();
  const prisma = new PrismaService(env);
  try {
    const repo = new ArenaRepository(prisma);
    const seasons = new SeasonService(repo, loadTradingCalendar());

    if (command === 'season-create') {
      // pnpm roda o script dentro de apps/api; o caminho que o usuário digitou vale a partir de onde ele estava
      const file = path.resolve(process.env.INIT_CWD ?? process.cwd(), first);
      let raw: unknown;
      try {
        raw = JSON.parse(await readFile(file, 'utf8'));
      } catch {
        throw new Error(`Não consegui ler ${file} como JSON`);
      }
      const created = await seasons.create(raw);
      console.log(
        `temporada ${created.slug} criada (DRAFT) com ${created.models} modelos. id ${created.id}\n` +
          `  para começar: pnpm --filter @alvesting/api season:start ${created.id}`,
      );
      return 0;
    }

    if (command === 'season-start') {
      if (!ulidSchema.safeParse(first).success)
        throw new Error(`Id de temporada inválido: ${first}`);
      const started = await seasons.start(first, new Date());
      console.log(
        `temporada ${started.slug} em andamento (RUNNING). Primeiro pregão: ${started.startDate}`,
      );
      return 0;
    }

    // cycle-show
    const views = new CycleViewRepository(prisma);
    const ids = ulidSchema.safeParse(first).success
      ? [first]
      : isIsoDate(first)
        ? await views.idsByDate(first, second)
        : null;
    if (ids === null)
      throw new Error(`Informe uma data AAAA-MM-DD ou o id do ciclo (veio ${first})`);
    if (ids.length === 0) {
      console.log(`nenhum ciclo em ${first}${second ? ` na temporada ${second}` : ''}`);
      return 1;
    }
    for (const id of ids) {
      const view = await views.find(id);
      console.log(view ? formatCycle(view) : `ciclo ${id} não encontrado`);
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
