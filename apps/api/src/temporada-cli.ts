import { appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { BlobServiceClient } from '@azure/storage-blob';
import { Logger } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { parseEnv } from './config/env.js';
import { Secret } from './config/secret.js';
import { createSimClock } from './ensaio/bus.js';
import { installNetworkGuard } from './ensaio/network-guard.js';
import { assembleWorld } from './ensaio/world.js';
import { PrismaService } from './infrastructure/database/prisma.service.js';
import { formatUsd } from './modules/arena/domain/cost.js';
import { brasiliaDate, isIsoDate } from './modules/market-data/domain/dates.js';
import { loadTradingCalendar } from './modules/market-data/domain/trading-calendar.js';
import { openRouterRemainingMicroUsd } from './temporada/credit.js';
import { createOperator, runOperator, type OperatorOptions } from './temporada/operator.js';
import {
  OPERATOR_HOSTS,
  RETRO_HOSTS,
  loadPrompt,
  localPieces,
  realClock,
  retroFetchers,
  type LoadedPrompt,
} from './temporada/pieces.js';
import { parseDatedSeasonFile, sessionCostMicro, type DatedSeasonFile } from './temporada/plan.js';
import { assertSeasonDatabase, prepareSeasonDatabase } from './temporada/prepare.js';
import { planRetro, planText, runRetro } from './temporada/retro.js';

// A Temporada 1 na máquina, até a Azure (ADR 0038; RUNBOOK, "Operador local"):
//   pnpm --filter @alvesting/api temporada:preparar
//   pnpm --filter @alvesting/api arena:retroativo [--ate AAAA-MM-DD] [--teto-usd 30] [--dry-run] [--arquivo <temporada.json>]
//   pnpm --filter @alvesting/api arena:operar [--so-dados] [--arquivo <temporada.json>]
// O banco é sempre o de TEMPORADA_DATABASE_URL (alvesting_temporada), nunca deduzido do DATABASE_URL (o de dev, que o temporada:preparar só lê).
const USAGE = `Uso:
  preparar                      cria o banco da temporada se faltar, aplica as migrations, roda o db:roles e copia o mercado do banco de dev
  retroativo [opções]           roda os pregões que já passaram, como RETROATIVO
      --ate AAAA-MM-DD          o último pregão (padrão: o último com barras confirmadas antes de hoje)
      --teto-usd N              o teto de custo desta execução, em dólares (padrão 30)
      --dry-run                 só o plano: pregões, chamadas e custo estimado; nenhuma chamada e nenhuma escrita
      --arquivo <caminho>       o arquivo da temporada (padrão apps/api/seasons/temporada-1.json)
  operar [--so-dados] [--arquivo <caminho>]
                                o operador ao vivo nos horários de produção; --so-dados só coleta (sem briefing, ciclo nem liquidação)
Variáveis: TEMPORADA_DATABASE_URL (o banco da temporada); no preparar, DATABASE_URL (o de dev, só lido) e API_DATABASE_URL (a senha do
login da api); no retroativo e no operador, STORAGE_CONNECTION_STRING (o Azurite), BRAPI_TOKEN, OPENROUTER_API_KEY, PROMPT_ARENA ou
PROMPT_ARENA_FILE (fora do git) e ARENA_MONTHLY_COST_CAP_USD.`;

const repoRoot = path.resolve(import.meta.dirname, '../../..');
const DEFAULT_FILE = path.resolve(import.meta.dirname, '../seasons/temporada-1.json');

interface Args {
  command: string;
  until?: string;
  capUsd: string;
  dryRun: boolean;
  dataOnly: boolean;
  file: string;
}

function parseArgs(argv: string[]): Args | string {
  const [command, ...rest] = argv;
  if (!command || !['preparar', 'retroativo', 'operar'].includes(command)) return USAGE;
  const args: Args = { command, capUsd: '30', dryRun: false, dataOnly: false, file: DEFAULT_FILE };
  for (let i = 0; i < rest.length; i += 1) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (flag === '--dry-run' && command === 'retroativo') args.dryRun = true;
    else if (flag === '--so-dados' && command === 'operar') args.dataOnly = true;
    else if (flag === '--ate' && command === 'retroativo' && value && isIsoDate(value)) {
      args.until = value;
      i += 1;
    } else if (
      flag === '--teto-usd' &&
      command === 'retroativo' &&
      value &&
      /^\d{1,6}(\.\d{1,6})?$/.test(value)
    ) {
      args.capUsd = value;
      i += 1;
    } else if (flag === '--arquivo' && command !== 'preparar' && value) {
      args.file = path.resolve(process.env.INIT_CWD ?? process.cwd(), value);
      i += 1;
    } else return `argumento inválido: ${flag ?? ''}\n${USAGE}`;
  }
  return args;
}

// Uma linha por evento, com a hora; o operador grava também no arquivo do dia de Brasília (.data/operador/AAAA-MM-DD.log).
function logger(dir: string | undefined) {
  if (dir) mkdirSync(dir, { recursive: true });
  return (line: string) => {
    const now = new Date();
    const text = `${now.toISOString()} ${line}`;
    console.log(text);
    if (dir) appendFileSync(path.join(dir, `${brasiliaDate(now)}.log`), `${text}\n`);
  };
}

// Os handlers escrevem pelo Logger do Nest: tudo vai para o mesmo arquivo; o aviso e o erro também para a tela. Nenhum handler escreve o prompt
// (ele não sai do DecideHandler) nem segredo.
function captureNestLogs(write: (line: string) => void) {
  const text = (level: string, message: unknown, rest: unknown[]) =>
    `${level} ${[message, ...rest]
      .map((part) =>
        typeof part === 'string'
          ? part
          : JSON.stringify(part, (_key, value: unknown) =>
              typeof value === 'bigint'
                ? value.toString()
                : value instanceof Error
                  ? value.message
                  : value,
            ),
      )
      .join(' ')}`;
  const at =
    (level: string) =>
    (message: unknown, ...rest: unknown[]) =>
      write(text(level, message, rest));
  Logger.overrideLogger({
    log: at('log'),
    debug: () => undefined,
    verbose: () => undefined,
    warn: at('aviso'),
    error: at('erro'),
    fatal: at('erro'),
  });
}

async function main(argv: string[]): Promise<number> {
  const parsed = parseArgs(argv);
  if (typeof parsed === 'string') {
    console.error(parsed);
    return 2;
  }
  if (process.env.NODE_ENV === 'production') {
    console.error('A temporada local roda na máquina (dev), não com NODE_ENV=production.');
    return 2;
  }
  const url = process.env.TEMPORADA_DATABASE_URL;
  if (!url) {
    console.error('Defina TEMPORADA_DATABASE_URL, o banco da temporada (alvesting_temporada).');
    return 2;
  }
  try {
    assertSeasonDatabase(url);
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : String(error)}. Nada foi tocado.`);
    return 2;
  }

  if (parsed.command === 'preparar') {
    const source = process.env.DATABASE_URL;
    const api = process.env.API_DATABASE_URL;
    if (!source || !api) {
      console.error(
        'Defina DATABASE_URL (o banco de dev, de onde vem o mercado) e API_DATABASE_URL.',
      );
      return 2;
    }
    await prepareSeasonDatabase({
      targetUrl: url,
      sourceUrl: source,
      apiUrl: api,
      log: logger(undefined),
    });
    return 0;
  }

  const calendar = loadTradingCalendar();
  const dated = parseDatedSeasonFile(JSON.parse(await readFile(parsed.file, 'utf8')));
  const env = parseEnv();
  const prisma = new PrismaService(parseEnv({ DATABASE_URL: url }));
  try {
    if (parsed.command === 'retroativo')
      return await retro(parsed, { prisma, calendar, dated, env });
    return await operate(parsed, { prisma, calendar, dated, env });
  } finally {
    await prisma.onModuleDestroy();
  }
}

type Context = {
  prisma: PrismaService;
  calendar: ReturnType<typeof loadTradingCalendar>;
  dated: ReturnType<typeof parseDatedSeasonFile>;
  env: ReturnType<typeof parseEnv>;
};

// O último pregão com barras confirmadas antes de hoje (Brasília): o padrão do --ate.
async function lastConfirmed(prisma: PrismaService): Promise<string | undefined> {
  const today = brasiliaDate(new Date());
  const row = await prisma.tradingDay.findFirst({
    where: { source: 'BRAPI', date: { lt: new Date(`${today}T00:00:00Z`) } },
    orderBy: { date: 'desc' },
    select: { date: true },
  });
  return row?.date.toISOString().slice(0, 10);
}

async function retro(args: Args, { prisma, calendar, dated, env }: Context): Promise<number> {
  const dir = path.join(repoRoot, '.data/temporada');
  if (args.dryRun) {
    // o banco pode ainda não existir: o plano vale para a temporada inteira
    const reachable = await prisma.$queryRaw`SELECT 1`.then(
      () => true,
      () => false,
    );
    const until =
      args.until ??
      (reachable ? await lastConfirmed(prisma) : undefined) ??
      calendar.previousTradingDay(brasiliaDate(new Date()));
    const plan = await planRetro({ prisma: reachable ? prisma : null, calendar, dated, until });
    console.log(`${planText(plan)}\n(até ${until}; teto desta execução US$ ${args.capUsd})`);
    return 0;
  }
  const log = logger(dir);
  const guard = installNetworkGuard({
    allow: RETRO_HOSTS,
    onBlocked: (entry) => log(`rede bloqueada: ${entry}`),
  });
  captureNestLogs((line) =>
    appendFileSync(
      path.join(dir, `${brasiliaDate(new Date())}.log`),
      `${new Date().toISOString()} ${line}\n`,
    ),
  );
  const abort = new AbortController();
  const stop = () => {
    log('pedido de parada: termina a entrega em curso e para');
    abort.abort();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const until = args.until ?? (await lastConfirmed(prisma));
    if (!until) {
      log(
        'nenhum pregão confirmado no banco da temporada: rode o temporada:preparar, ou passe --ate',
      );
      return 1;
    }
    const prompt = await loadPrompt({ env, file: process.env.PROMPT_ARENA_FILE, repoRoot });
    const storage = process.env.STORAGE_CONNECTION_STRING;
    if (!storage) {
      log('Defina STORAGE_CONNECTION_STRING (o Azurite do docker compose)');
      return 2;
    }
    const world = assembleWorld(
      localPieces({
        prisma,
        calendar,
        clock: createSimClock(new Date(0)),
        blob: BlobServiceClient.fromConnectionString(storage),
        env,
        prompt,
        mode: 'retroativo',
      }),
    );
    const today = brasiliaDate(new Date());
    const fetchers = retroFetchers(world);
    log(
      `retroativo de ${dated.startDate} até ${until} (teto US$ ${args.capUsd}; prompt SHA-256 ${prompt.sha256})`,
    );
    const summary = await runRetro({
      prisma,
      world,
      calendar,
      dated,
      prompt,
      until,
      capUsd: args.capUsd,
      sources: {
        bars: (from, to) => world.backfill.run({ from, to, today, fetch: true }),
        bcb: fetchers.bcb,
        cvm: fetchers.cvm,
      },
      signal: abort.signal,
      log,
      reportDir: dir,
    });
    log(
      `fim: ${summary.outcome}${summary.stoppedAt ? ` em ${summary.stoppedAt}` : ''}; gasto desta execução US$ ${formatUsd(summary.spentMicroUsd)}`,
    );
    if (guard.blocked.length > 0)
      log(`a guarda bloqueou ${guard.blocked.length} tentativas de rede`);
    return summary.outcome === 'done' ? 0 : 3;
  } finally {
    guard.restore();
    Logger.overrideLogger(false);
  }
}

async function operate(args: Args, { prisma, calendar, dated, env }: Context): Promise<number> {
  const dir = path.join(repoRoot, '.data/operador');
  const log = logger(dir);
  const guard = installNetworkGuard({
    allow: OPERATOR_HOSTS,
    onBlocked: (entry) => log(`rede bloqueada: ${entry}`),
  });
  captureNestLogs((line) =>
    appendFileSync(
      path.join(dir, `${brasiliaDate(new Date())}.log`),
      `${new Date().toISOString()} ${line}\n`,
    ),
  );
  const abort = new AbortController();
  const stop = () => {
    log('pedido de parada: termina a volta em curso e sai');
    abort.abort();
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    const storage = process.env.STORAGE_CONNECTION_STRING;
    if (!storage) {
      log('Defina STORAGE_CONNECTION_STRING (o Azurite do docker compose)');
      return 2;
    }
    // no --so-dados nenhum modelo é chamado, e o prompt pode ainda não estar pronto
    const prompt: LoadedPrompt =
      args.dataOnly && !env.PROMPT_ARENA && !process.env.PROMPT_ARENA_FILE
        ? { text: new Secret(''), sha256: '0'.repeat(64), version: '0'.repeat(32) }
        : await loadPrompt({ env, file: process.env.PROMPT_ARENA_FILE, repoRoot });
    const world = assembleWorld(
      localPieces({
        prisma,
        calendar,
        clock: realClock,
        blob: BlobServiceClient.fromConnectionString(storage),
        env,
        prompt,
        mode: args.dataOnly ? 'so-dados' : 'ao-vivo',
      }),
    );
    log(
      `operador ${args.dataOnly ? 'só dados' : 'ao vivo'}, temporada ${dated.file.slug} (pid ${process.pid})`,
    );
    const operator = createOperator({
      prisma,
      world,
      calendar,
      seasonSlug: dated.file.slug,
      prompt,
      dataOnly: args.dataOnly,
      log,
      ...(args.dataOnly ? {} : creditCheck(env, dated)),
    });
    await runOperator(operator, { signal: abort.signal, log });
    log('operador parado');
    return 0;
  } finally {
    guard.restore();
    Logger.overrideLogger(false);
  }
}

// A regra 5 do operador: com modelo do OpenRouter na temporada, o saldo tem de cobrir o pior caso de um pregão antes de abrir o ao vivo.
// Sem a chave, a leitura falha e o pregão não abre (o log diz o porquê).
function creditCheck(env: Context['env'], dated: DatedSeasonFile): Pick<OperatorOptions, 'credit'> {
  const paid = dated.file.competitors.filter(
    (c) => c.kind === 'MODEL' && c.provider === 'openrouter',
  );
  if (paid.length === 0) return {};
  const key = env.OPENROUTER_API_KEY?.reveal();
  return {
    credit: {
      remainingMicroUsd: () =>
        key
          ? openRouterRemainingMicroUsd(key)
          : Promise.reject(new Error('OPENROUTER_API_KEY ausente')),
      worstMicroUsd: sessionCostMicro(paid, 'worst'),
    },
  };
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
