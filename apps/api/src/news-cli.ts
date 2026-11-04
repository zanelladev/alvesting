import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Logger } from '@nestjs/common';
import { parseEnv } from './config/env.js';
import { PrismaService } from './infrastructure/database/prisma.service.js';
import { BcbFetcher } from './modules/news/application/bcb-fetcher.js';
import { CvmFetcher } from './modules/news/application/cvm-fetcher.js';
import { RssFetcher } from './modules/news/application/rss-fetcher.js';
import { parseFeedDate } from './modules/news/domain/rss.js';
import { sourceById } from './modules/news/domain/sources.js';
import { MacroRepository } from './modules/news/infrastructure/macro.repository.js';
import { NewsRepository } from './modules/news/infrastructure/news.repository.js';

// Linha de comando das notícias, da CVM e do macro (docs/DADOS.md). Usa o banco do ambiente (DATABASE_URL), sem fila.
//   pnpm --filter @alvesting/api news:fetch <fonte>                       busca a fonte agora, na rede de verdade
//   pnpm --filter @alvesting/api news:import <fonte-rss> <arquivo.xml> [--at <instante ISO>]
//                                                                         lê um feed RSS salvo (fixture, replay)
// As fontes são as da lista fixa (domain/sources.ts); o arquivo do `import` é do disco, nunca uma URL.
const USAGE = `Uso:
  news:fetch <fonte>                                    busca a fonte agora (infomoney, money-times, seu-dinheiro,
                                                        agencia-brasil, cvm-ipe ou bcb-sgs)
  news:import <fonte-rss> <arquivo.xml> [--at <ISO>]    grava os itens de um feed RSS salvo; --at é a hora em que
                                                        passam a valer como "vistos", com fuso (2026-10-30T00:00:00Z;
                                                        padrão: agora)`;

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  if (command !== 'fetch' && command !== 'import') {
    console.error(USAGE);
    return 2;
  }
  const source = sourceById(args[0] ?? '');
  if (!source || (command === 'import' && source.kind !== 'rss')) {
    console.error(
      command === 'import' ? 'O import vale só para fonte RSS.' : 'Fonte desconhecida.',
    );
    console.error(USAGE);
    return 2;
  }

  Logger.overrideLogger(['warn', 'error']); // o resumo sai por console.log
  const prisma = new PrismaService(parseEnv());
  try {
    const news = new NewsRepository(prisma);
    const now = new Date();
    if (command === 'import') {
      if (source.kind !== 'rss') return 2;
      const file = args[1];
      if (!file) {
        console.error(USAGE);
        return 2;
      }
      const atIndex = args.indexOf('--at');
      // com fuso explícito (Z ou +00:00): sem ele a hora seria lida no fuso da máquina, e o briefing em que a notícia entra
      // depende dessa hora
      const at = atIndex >= 0 ? parseFeedDate(args[atIndex + 1]) : now;
      if (at === null) throw new Error('--at: instante ISO com fuso (Z ou +00:00) inválido');
      // pnpm roda o script dentro de apps/api; o caminho que o usuário digitou vale a partir de onde ele estava
      const text = await readFile(
        path.resolve(process.env.INIT_CWD ?? process.cwd(), file),
        'utf8',
      );
      const result = await new RssFetcher(news).ingest(source, text, at, at);
      console.log(`${source.id}: ${JSON.stringify(result)} (vistos em ${at.toISOString()})`);
    } else if (source.kind === 'rss') {
      console.log(`${source.id}: ${JSON.stringify(await new RssFetcher(news).run(source, now))}`);
    } else if (source.kind === 'cvm') {
      console.log(`${source.id}: ${JSON.stringify(await new CvmFetcher(news).run(now))}`);
    } else {
      console.log(
        `${source.id}: ${JSON.stringify(await new BcbFetcher(new MacroRepository(prisma)).run(now))}`,
      );
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
