import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BlobServiceClient } from '@azure/storage-blob';
import { parseEnv } from './config/env.js';
import { ensaioDatabaseUrl, parseArgs } from './ensaio/cli-args.js';
import { runEnsaio } from './ensaio/driver.js';
import { MAX_SESSIONS, MIN_SESSIONS } from './ensaio/market.js';
import { seedSyntheticLogos } from './ensaio/synthetic-logos.js';
import {
  applyMigrations,
  assertDisposable,
  databaseName,
  recreateDatabase,
} from './infrastructure/database/database-admin.js';
import { PrismaService } from './infrastructure/database/prisma.service.js';
import { MarketRepository } from './modules/market-data/infrastructure/market.repository.js';

// O ensaio da Temporada 0 (etapa 8, a parte local; docs/ENSAIO.md): a arena rodando sozinha por N pregões seguidos, com provedores fake,
// os handlers de verdade, o relógio simulado e nenhuma rede.
//   pnpm --filter @alvesting/api arena:ensaio [--pregoes 5] [--semente N] [--logos-sinteticos]
// O banco é o de ENSAIO_DATABASE_URL (alvesting_ensaio no .env.example): recriado e migrado a cada execução, e nunca deduzido do
// DATABASE_URL, então o de dev não entra. O Azurite (STORAGE_CONNECTION_STRING) guarda o que o ensaio escreve, em containers com o
// prefixo "ensaio-". Recusa rodar com NODE_ENV=production.
const USAGE = `Uso: arena:ensaio [--pregoes N] [--semente N] [--logos-sinteticos]
  --pregoes N          quantos pregões seguidos (${MIN_SESSIONS} a ${MAX_SESSIONS}; padrão 5)
  --semente N          a semente do mercado, das notícias e do macro sintéticos (inteiro; padrão 1)
  --logos-sinteticos   depois do relatório, os dois logos sintéticos que o e2e lê (o e2e:seed a passa)
Variáveis (o .env.example traz as do docker compose): ENSAIO_DATABASE_URL, o banco que o ensaio recria (o nome tem de terminar em
_ensaio ou _test), e STORAGE_CONNECTION_STRING, o Azurite. O relatório sai na tela e em .data/ensaio/ (fora do git).`;

const STOCKS = 40;

async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.kind === 'help') {
    console.log(USAGE);
    return 0;
  }
  if (parsed.kind === 'error') {
    console.error(`${parsed.message}\n${USAGE}`);
    return 2;
  }
  const { sessions, seed, syntheticLogos } = parsed;

  if (process.env.NODE_ENV === 'production') {
    console.error('O ensaio esvazia um banco e não roda com NODE_ENV=production.');
    return 2;
  }
  let url: string;
  try {
    url = ensaioDatabaseUrl(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  const name = databaseName(url);
  // o nome (_ensaio ou _test) e o servidor (a própria máquina): a mesma guarda que o recreateDatabase repete antes do DROP
  try {
    assertDisposable(url);
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}. Nada foi tocado.`);
    return 2;
  }
  const storage = process.env.STORAGE_CONNECTION_STRING;
  if (!storage) {
    console.error(
      'Defina STORAGE_CONNECTION_STRING (o Azurite do docker compose, ver .env.example).',
    );
    return 2;
  }
  const blob = BlobServiceClient.fromConnectionString(storage);
  try {
    // uma tentativa só: o SDK repete com espera, e quem rodou sem o Azurite não precisa esperar minuto para saber
    await BlobServiceClient.fromConnectionString(storage, {
      retryOptions: { maxTries: 1 },
    }).getProperties();
  } catch {
    console.error(
      'O Azurite não respondeu em STORAGE_CONNECTION_STRING. Ele está no ar? (docker compose up -d azurite)',
    );
    return 2;
  }

  try {
    await recreateDatabase(url);
  } catch (error) {
    // o pg devolve um AggregateError sem mensagem quando recusam a conexão (localhost resolve para IPv4 e IPv6): vale o código
    const reason =
      (error as { code?: string }).code ?? (error instanceof Error ? error.message : String(error));
    console.error(
      `Não consegui recriar o banco ${name} (${reason}). O Postgres está no ar? (docker compose up -d postgres)`,
    );
    return 2;
  }
  console.log(`ensaio: banco ${name} recriado; ${sessions} pregões, semente ${seed}`);
  applyMigrations(url);

  // parseEnv com origem explícita: só o que o ensaio usa. O .env.local (com o prompt e a chave de verdade) nem é carregado pelo script.
  const prisma = new PrismaService(parseEnv({ DATABASE_URL: url }));
  try {
    const dir = path.resolve(import.meta.dirname, '../../../.data/ensaio');
    await mkdir(dir, { recursive: true });
    const result = await runEnsaio({
      prisma,
      blob,
      seed,
      sessions,
      stocks: STOCKS,
      log: (line) => console.log(`  ${line}`),
    });

    const base = path.join(dir, `relatorio-s${seed}-p${sessions}`);
    await writeFile(`${base}.txt`, result.text);
    await writeFile(`${base}.json`, result.json);
    console.log(`\n${result.text}`);
    console.log(`relatório gravado em ${base}.txt e .json`);
    // o seed do e2e: depois do relatório, que não os vê (o mesmo relatório com ou sem a bandeira)
    if (syntheticLogos) {
      const saved = await seedSyntheticLogos(new MarketRepository(prisma), new Date());
      console.log(`logos sintéticos do e2e gravados: ${saved.join(', ')}`);
    }

    console.log('\nmedidas desta máquina (fora do relatório, mudam a cada execução):');
    for (const [queue, m] of Object.entries(result.measures).sort(([a], [b]) => (a < b ? -1 : 1))) {
      console.log(
        `  ${queue.padEnd(11)} ${String(m.count).padStart(4)} entregas, ${m.totalMs} ms no total, a mais lenta ${m.maxMs} ms`,
      );
    }
    if (result.logLines.length > 0) {
      console.error('\navisos e erros dos handlers:');
      for (const line of result.logLines) console.error(`  ${line}`);
    }
    return result.ok ? 0 : 1;
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
