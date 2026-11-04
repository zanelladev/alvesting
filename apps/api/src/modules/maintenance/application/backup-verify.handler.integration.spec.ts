import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { BlobServiceClient } from '@azure/storage-blob';
import pg from 'pg';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import { newId } from '../../../common/id.js';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import {
  openTestDatabase,
  testDatabaseUrl,
} from '../../../infrastructure/database/test-database.fixture.js';
import { personalTables, POLICY_TABLES } from '../../../infrastructure/database/table-policy.js';
import { ALERT_LOG } from '../../../telemetry/alert-logs.js';
import { createBlobServiceClient } from '../../../infrastructure/storage/blob-client.js';
import { JobRunStore } from '../../messaging/infrastructure/job-run.store.js';
import {
  collect,
  spawnProcess,
  type SpawnOptions,
  type SpawnTool,
} from '../infrastructure/pg-tools.js';
import { localPgTools, noPgToolsReason } from '../testing/pg-tools.fixture.js';
import { BackupVerifyHandler } from './backup-verify.handler.js';

// A restauração de teste (plano 5.8 e a etapa 10): o backup-verify mensal, de verdade. Postgres, Azurite e o pg_dump/pg_restore 17 (do PATH
// ou de dentro do contêiner do projeto: testing/pg-tools.fixture.ts). O que se prova: o dump vai para o Blob `backups`, é restaurado num banco
// temporário do mesmo servidor, as contagens batem com as da origem no MESMO instante do dump (snapshot), o dado das tabelas pessoais NÃO
// está no dump, e o banco temporário some, inclusive quando algo falha. Todo dado pessoal é sintético (@example.test).
const STORAGE = process.env.STORAGE_CONNECTION_STRING;
const skipReason = !testDatabaseUrl
  ? 'defina TEST_DATABASE_URL, ex.: docker compose up -d postgres'
  : !STORAGE
    ? 'defina STORAGE_CONNECTION_STRING (Azurite: docker compose up -d azurite)'
    : !localPgTools
      ? noPgToolsReason
      : undefined;
const title = `BackupVerifyHandler (Postgres, Azurite e pg_dump 17)${skipReason ? ` [pulado: ${skipReason}]` : ''}`;

const CANARY = 'canario-pessoal-do-backup';

describe.skipIf(skipReason !== undefined)(title, () => {
  let prisma: PrismaService;
  let jobs: JobRunStore;
  let blob: BlobServiceClient;
  let admin: pg.Client;
  let log: MockInstance<Logger['log']>;
  let errorLog: MockInstance<Logger['error']>;
  const tools = localPgTools!;

  const handler = (overrides: Partial<ConstructorParameters<typeof BackupVerifyHandler>[0]> = {}) =>
    new BackupVerifyHandler({
      jobs,
      blob,
      databaseUrl: testDatabaseUrl!,
      spawn: tools.spawn,
      ...overrides,
    });
  const dumpOf = (month: string) =>
    blob.getContainerClient('backups').getBlockBlobClient(`alvesting-${month}.dump`);
  const tempDatabases = async () =>
    (
      await admin.query<{ datname: string }>(
        `SELECT datname FROM pg_database WHERE datname LIKE 'alvesting\\_verify\\_%' ORDER BY 1`,
      )
    ).rows.map((row) => row.datname);
  const jobOf = (month: string) =>
    prisma.jobRun.findUniqueOrThrow({
      where: { type_idempotencyKey: { type: 'backup-verify', idempotencyKey: month } },
    });

  // O conteúdo do dump pelo pg_restore --list: as entradas "TABLE DATA" são as tabelas que levaram linhas.
  async function listing(month: string): Promise<string[]> {
    const bytes = await dumpOf(month).downloadToBuffer();
    const options: SpawnOptions = {
      env: { PATH: process.env.PATH },
      signal: AbortSignal.timeout(60_000),
      timeoutMs: 60_000,
    };
    const child = tools.spawn('pg_restore', ['--list'], options);
    child.stdin?.end(bytes);
    // a saída inteira (o `collect` guarda só o fim, que basta para a mensagem de erro e não para a lista de entradas do dump)
    const chunks: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
    const exit = await collect(child, { stdout: false });
    expect(exit.code, exit.stderr).toBe(0);
    return Buffer.concat(chunks).toString('utf8').split('\n');
  }
  const dataOf = (lines: string[]) =>
    lines
      .filter((line) => line.includes(' TABLE DATA public '))
      .map((line) => line.split(' TABLE DATA public ')[1]!.split(' ')[0]!)
      .sort();

  async function seed() {
    const owner = await prisma.user.create({
      data: {
        id: newId(),
        name: `Pessoa ${CANARY}`,
        email: `${CANARY}-${Date.now().toString(36)}@example.test`,
        emailVerified: true,
      },
    });
    await prisma.session.create({
      data: { id: newId(), userId: owner.id, token: `tok-${CANARY}`, expiresAt: new Date() },
    });
    await prisma.account.create({
      data: {
        id: newId(),
        userId: owner.id,
        accountId: `conta-${CANARY}`,
        providerId: 'credential',
      },
    });
    await prisma.consent.create({
      data: {
        id: newId(),
        userId: owner.id,
        document: 'TERMS',
        version: '0.1',
        sha256: 'e'.repeat(64),
      },
    });
    await prisma.verification.create({
      data: {
        id: newId(),
        identifier: `id-${CANARY}`,
        value: `v-${CANARY}`,
        expiresAt: new Date(),
      },
    });
    // a carteira (etapa 12) é dado pessoal: a quantidade e o custo abaixo só existem aqui, e não podem estar no dump
    const portfolio = await prisma.portfolio.create({ data: { id: newId(), userId: owner.id } });
    await prisma.portfolioLot.create({
      data: {
        id: newId(),
        portfolioId: portfolio.id,
        ticker: 'PETR4',
        quantity: 424_242,
        costCents: 987_654_321n,
      },
    });
    for (let i = 0; i < 3; i += 1) {
      await prisma.newsItem.create({
        data: {
          id: newId(),
          urlHash: `${i}`.repeat(64),
          url: `https://exemplo.com.br/backup-${i}`,
          source: 'infomoney',
          title: `Notícia pública ${i}`,
          snippet: 'Resumo.',
          tickers: ['PETR4'],
          publishedAt: new Date('2026-11-01T15:00:00Z'),
          firstSeenAt: new Date('2026-11-01T16:00:00Z'),
        },
      });
    }
    await prisma.auditLog.create({ data: { id: newId(), actor: 'cli', action: 'teste.backup' } });
    await prisma.jobRun.create({
      data: { id: newId(), queue: 'news', type: 'fetch', idempotencyKey: `fetch:${newId()}` },
    });
  }

  async function clean() {
    await prisma.session.deleteMany();
    await prisma.verification.deleteMany();
    await prisma.jobRun.deleteMany();
    await prisma.newsItem.deleteMany();
    await prisma.auditLog.deleteMany({ where: { action: 'teste.backup' } });
    await prisma.user.deleteMany({ where: { email: { endsWith: '@example.test' } } });
    for (const month of ['2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04']) {
      await dumpOf(month).deleteIfExists();
    }
  }

  beforeAll(async () => {
    Logger.overrideLogger(false);
    prisma = await openTestDatabase(testDatabaseUrl!);
    jobs = new JobRunStore(prisma);
    blob = createBlobServiceClient({ STORAGE_CONNECTION_STRING: STORAGE })!;
    await blob.getContainerClient('backups').createIfNotExists();
    const maintenance = new URL(testDatabaseUrl!);
    maintenance.pathname = '/postgres';
    admin = new pg.Client({ connectionString: maintenance.toString() });
    await admin.connect();
  }, 120_000);

  beforeEach(async () => {
    await clean();
    log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    errorLog = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  }, 60_000);

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await clean();
    await admin?.end();
    await prisma?.onModuleDestroy();
  }, 60_000);

  it('faz o dump para o Blob, restaura num banco temporário, as contagens batem, o dado pessoal não está no dump e o banco temporário some', async () => {
    await seed();

    const result = await handler().execute('2026-11');

    expect(result).toMatchObject({
      outcome: 'verified',
      month: '2026-11',
      blob: 'alvesting-2026-11.dump',
    });
    if (result.outcome !== 'verified') throw new Error('esperava verified');
    expect(result.bytes).toBeGreaterThan(1000);
    expect(result.sha256).toMatch(/^[0-9a-f]{64}$/);

    // o Blob tem o dump, com o SHA-256 e o tamanho nos metadados
    const properties = await dumpOf('2026-11').getProperties();
    expect(properties.contentLength).toBe(result.bytes);
    expect(properties.metadata).toMatchObject({
      month: '2026-11',
      sha256: result.sha256,
      bytes: String(result.bytes),
      personal_data: 'excluded',
    });

    // as contagens: toda tabela da matriz, igual à origem; as pessoais restauradas vazias
    expect(Object.keys(result.counts).sort()).toEqual([...POLICY_TABLES].sort());
    const personal = new Set(personalTables());
    for (const table of POLICY_TABLES) {
      const { origin, restored } = result.counts[table]!;
      expect(restored, table).toBe(personal.has(table) ? 0 : origin);
    }
    expect(result.counts['news_item']).toEqual({ origin: 3, restored: 3 });
    expect(result.counts['user']!.origin).toBeGreaterThan(0);
    expect(result.counts['user']!.restored).toBe(0);
    // a carteira do usuário também fica de fora do dump (a política de privacidade 0.2 promete)
    expect(result.counts['portfolio']).toEqual({ origin: 1, restored: 0 });
    expect(result.counts['portfolio_lot']).toEqual({ origin: 1, restored: 0 });

    // o dump: o esquema de TODAS as tabelas (inclusive as pessoais e o gatilho do aceite), os dados de todas MENOS as pessoais
    const lines = await listing('2026-11');
    const withData = dataOf(lines);
    for (const table of personalTables()) {
      expect(withData, `dados de ${table} no dump`).not.toContain(table);
      expect(
        lines.some((line) => line.includes(` TABLE public ${table} `)),
        `esquema de ${table}`,
      ).toBe(true);
    }
    expect(withData).toEqual(
      expect.arrayContaining(['news_item', 'audit_log', 'job_run', '_prisma_migrations']),
    );
    expect(lines.some((line) => line.includes('consent_no_update'))).toBe(true);
    // e, por garantia, o canário pessoal nem nos bytes do dump
    const bytes = (await dumpOf('2026-11').downloadToBuffer()).toString('latin1');
    expect(bytes).not.toContain(CANARY);
    expect(bytes).not.toContain('987654321');

    expect(await tempDatabases()).toEqual([]);
    expect((await jobOf('2026-11')).status).toBe('SUCCEEDED');
  }, 120_000);

  it('o snapshot garante a contagem: a linha gravada DEPOIS do snapshot e ANTES do pg_dump não entra no dump nem derruba a conferência', async () => {
    await seed();
    // roda no meio: o snapshot já foi exportado e contado (3 notícias), o pg_dump ainda não começou. Sem `--snapshot` o dump levaria 4.
    const insertAfterSnapshot: SpawnTool = (tool, args, options) => {
      if (tool === 'pg_dump' && !args.includes('--version')) {
        const script = `
          const pg = require('pg');
          (async () => {
            const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
            await client.connect();
            await client.query("INSERT INTO news_item (id, url_hash, url, source, title, snippet, tickers, published_at, first_seen_at) VALUES ('${newId()}', '${'f'.repeat(64)}', 'https://exemplo.com.br/depois', 'infomoney', 'Depois do snapshot', 'x', '{}', now(), now())");
            await client.end();
          })().catch((error) => { console.error(error); process.exit(1); });`;
        const inserted = spawnSync(process.execPath, ['-e', script], {
          env: { ...process.env, TEST_DATABASE_URL: testDatabaseUrl },
          timeout: 30_000,
          encoding: 'utf8',
        });
        expect(inserted.status, inserted.stderr).toBe(0);
      }
      return tools.spawn(tool, args, options);
    };

    const result = await handler({ spawn: insertAfterSnapshot }).execute('2026-11');

    if (result.outcome !== 'verified') throw new Error('esperava verified');
    expect(result.counts['news_item']).toEqual({ origin: 3, restored: 3 });
    // a linha existe no banco (4), e não está no dump
    expect(await prisma.newsItem.count()).toBe(4);
  }, 120_000);

  it('um dump maior que um bloco de envio (4 MiB) vai em vários blocos, sem arquivo, e a restauração confere', async () => {
    await seed();
    // texto aleatório não comprime: ~12 MB de dado, uns 9 MB no dump
    await prisma.jobRun.createMany({
      data: Array.from({ length: 150 }, () => ({
        id: newId(),
        queue: 'market',
        type: 'eod',
        idempotencyKey: `grande:${newId()}`,
        status: 'FAILED' as const,
        error: randomBytes(60_000).toString('base64'),
      })),
    });

    const result = await handler().execute('2026-11');

    if (result.outcome !== 'verified') throw new Error('esperava verified');
    expect(result.bytes).toBeGreaterThan(4 * 1024 * 1024);
    expect(result.counts['job_run']!.restored).toBe(result.counts['job_run']!.origin);
    expect(result.counts['job_run']!.origin).toBeGreaterThanOrEqual(150);
    expect((await dumpOf('2026-11').getProperties()).contentLength).toBe(result.bytes);
    expect(await tempDatabases()).toEqual([]);
  }, 180_000);

  it('repetir o mês é barrado pelo job_run: já feito, e o Blob não é tocado', async () => {
    await seed();
    await handler().execute('2026-12');
    const etag = (await dumpOf('2026-12').getProperties()).etag;

    await expect(handler().execute('2026-12')).resolves.toEqual({ outcome: 'already_done' });

    expect((await dumpOf('2026-12').getProperties()).etag).toBe(etag);
    expect(await tempDatabases()).toEqual([]);
  }, 120_000);

  it('é pelo handle (a função da fila) que a mensagem chega', async () => {
    await seed();
    await handler().handle({ type: 'backup-verify', month: '2027-01' });
    expect((await jobOf('2027-01')).status).toBe('SUCCEEDED');
    await expect(handler().handle({ type: 'retention', date: '2027-01-03' })).rejects.toThrow(
      /não trata mensagens retention/,
    );
  }, 120_000);

  describe('falha forçada: o job_run vira FAILED, a linha do job-falhou sai, o banco temporário e o dump estragado somem', () => {
    async function expectFailed(month: string, reason: RegExp) {
      const row = await jobOf(month);
      expect(row.status).toBe('FAILED');
      expect(row.error).toMatch(reason);
      const alert = errorLog.mock.calls.find((call) => call[1] === ALERT_LOG.jobFailed);
      expect(alert?.[0]).toMatchObject({
        queue: 'maintenance',
        type: 'backup-verify',
        key: `backup-verify:${month}`,
      });
      expect(await tempDatabases()).toEqual([]);
      expect(await dumpOf(month).exists()).toBe(false);
    }

    it('dump truncado (o pg_dump é cortado, e o pipeline sai com 0): a restauração percebe', async () => {
      await seed();
      const truncated = tools.spawnThrough('head -c 3000');
      const spawn: SpawnTool = (tool, args, options) =>
        tool === 'pg_dump' && !args.includes('--version')
          ? truncated(tool, args, options)
          : tools.spawn(tool, args, options);

      await expect(handler({ spawn }).execute('2027-02')).rejects.toThrow(/pg_restore/);

      await expectFailed('2027-02', /pg_restore/);
    }, 120_000);

    it('contagem diferente: o dump deixa de fora o dado de uma tabela que a matriz diz que NÃO é pessoal', async () => {
      await seed();

      await expect(
        handler({ personalTables: ['news_item', ...personalTables()] }).execute('2027-03'),
      ).rejects.toThrow(/Contagem diferente.*news_item/s);

      await expectFailed('2027-03', /Contagem diferente.*news_item/s);
    }, 120_000);

    it('depois da falha a próxima entrega reassume o job e conclui (o job_run FAILED é reassumido)', async () => {
      await seed();
      await expect(handler({ personalTables: ['news_item'] }).execute('2027-04')).rejects.toThrow();
      await expect(handler().execute('2027-04')).resolves.toMatchObject({ outcome: 'verified' });
      expect((await jobOf('2027-04')).status).toBe('SUCCEEDED');
      expect((await jobOf('2027-04')).attempts).toBe(2);
    }, 120_000);

    it('pg_dump pendurado: é morto no prazo, e o banco temporário e o snapshot não ficam', async () => {
      await seed();
      const hang: SpawnTool = (tool, args, options) =>
        tool === 'pg_dump' && !args.includes('--version')
          ? spawnProcess('node', ['-e', 'setTimeout(() => {}, 60000)'], options)
          : tools.spawn(tool, args, options);
      const started = Date.now();

      await expect(
        handler({ spawn: hang, deadlineMs: 3_000 }).execute('2026-11'),
      ).rejects.toThrow();

      expect(Date.now() - started).toBeLessThan(30_000);
      expect((await jobOf('2026-11')).status).toBe('FAILED');
      expect(await tempDatabases()).toEqual([]);
      expect(await dumpOf('2026-11').exists()).toBe(false);
      // a transação do snapshot foi encerrada: nenhuma sessão fica "idle in transaction" no banco de teste
      const stuck = await admin.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_stat_activity WHERE state LIKE 'idle in transaction%' AND datname = $1`,
        [new URL(testDatabaseUrl!).pathname.slice(1)],
      );
      expect(stuck.rows[0]!.n).toBe(0);
    }, 120_000);

    it('tabela nova sem decisão na matriz: recusa ANTES de dumpar (o dump poderia levar dado pessoal), sem criar banco nem tocar no Blob', async () => {
      await seed();
      await prisma.$executeRawUnsafe('CREATE TABLE "portfolio_sem_decisao" (id text PRIMARY KEY)');
      try {
        await expect(handler().execute('2026-11')).rejects.toThrow(/portfolio_sem_decisao/);
        await expectFailed('2026-11', /sem classificação.*portfolio_sem_decisao/s);
      } finally {
        await prisma.$executeRawUnsafe('DROP TABLE IF EXISTS "portfolio_sem_decisao"');
      }
    }, 120_000);

    it('pg_dump de outro major (16 para um servidor 17): recusa antes de dumpar, dizendo qual instalar', async () => {
      await seed();
      const wrong: SpawnTool = (tool, args, options) =>
        args.includes('--version')
          ? spawnProcess('node', ['-e', `console.log('${tool} (PostgreSQL) 16.9')`], options)
          : tools.spawn(tool, args, options);

      await expect(handler({ spawn: wrong }).execute('2026-11')).rejects.toThrow(
        /PostgreSQL 16.*servidor é o 17.*postgresql-client-17/s,
      );

      await expectFailed('2026-11', /PostgreSQL 16/);
    }, 120_000);

    it('pg_dump que não existe no PATH: o erro diz qual executável falta', async () => {
      const missing: SpawnTool = (_tool, _args, options) =>
        spawnProcess('pg_dump_que_nao_existe', ['--version'], options);
      await expect(handler({ spawn: missing }).execute('2026-11')).rejects.toThrow(/pg_dump/);
      expect((await jobOf('2026-11')).status).toBe('FAILED');
    }, 120_000);

    it('sem Blob configurado: falha dizendo o que falta, e não cria banco temporário', async () => {
      await expect(handler({ blob: undefined }).execute('2026-11')).rejects.toThrow(
        /Blob Storage não configurado/,
      );
      expect((await jobOf('2026-11')).status).toBe('FAILED');
      expect(await tempDatabases()).toEqual([]);
    }, 120_000);
  });

  describe('o banco temporário: só o do padrão exato é apagado', () => {
    it('varre o órfão de uma execução que caiu e deixa em paz o banco que não é do padrão', async () => {
      await seed();
      const orphan = 'alvesting_verify_202601_aaaaaaaa';
      const lookalikes = [
        'alvesting_verify_notmine',
        'alvesting_scratch_keepme',
        'alvesting_verify_202601',
      ];
      for (const name of [orphan, ...lookalikes]) {
        await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
        await admin.query(`CREATE DATABASE "${name}"`);
      }
      try {
        await handler().execute('2026-11');

        const left = (
          await admin.query<{ datname: string }>(
            `SELECT datname FROM pg_database WHERE datname LIKE 'alvesting\\_%' ORDER BY 1`,
          )
        ).rows.map((row) => row.datname);
        expect(left).not.toContain(orphan);
        for (const name of lookalikes) expect(left, name).toContain(name);
        // os bancos de verdade do projeto seguem de pé
        expect(left).toEqual(expect.arrayContaining(['alvesting_dev', 'alvesting_test']));
      } finally {
        for (const name of [orphan, ...lookalikes]) {
          await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
        }
      }
    }, 120_000);

    it('não varre o banco temporário de uma execução em andamento (com sessão aberta): o DROP sem FORCE falha e ele fica', async () => {
      await seed();
      const live = 'alvesting_verify_202601_bbbbbbbb';
      await admin.query(`DROP DATABASE IF EXISTS "${live}" WITH (FORCE)`);
      await admin.query(`CREATE DATABASE "${live}"`);
      const url = new URL(testDatabaseUrl!);
      url.pathname = `/${live}`;
      const session = new pg.Client({ connectionString: url.toString() });
      await session.connect();
      try {
        await handler().execute('2026-11');
        expect(await tempDatabases()).toEqual([live]);
      } finally {
        await session.end();
        await admin.query(`DROP DATABASE IF EXISTS "${live}" WITH (FORCE)`);
      }
    }, 120_000);
  });

  describe('a senha e o log', () => {
    it('a senha vai só no PGPASSWORD do filho, nunca em argumento, e nada do que vai ao log tem a URL do banco', async () => {
      await seed();
      const seen: Array<{ tool: string; args: string[]; env: NodeJS.ProcessEnv }> = [];
      const spy: SpawnTool = (tool, args, options) => {
        seen.push({ tool, args, env: options.env });
        return tools.spawn(tool, args, options);
      };

      await handler({ spawn: spy }).execute('2026-11');

      const password = decodeURIComponent(new URL(testDatabaseUrl!).password);
      expect(seen.map((call) => call.tool)).toEqual([
        'pg_dump',
        'pg_restore',
        'pg_dump',
        'pg_restore',
      ]);
      for (const call of seen) {
        expect(call.env['PGPASSWORD'], call.tool).toBe(password);
        for (const arg of call.args) {
          expect(arg, call.tool).not.toMatch(/PGPASSWORD|postgres(ql)?:\/\//);
          expect(arg === password, call.tool).toBe(false);
        }
        expect(Object.keys(call.env).every((key) => key === 'PATH' || key.startsWith('PG'))).toBe(
          true,
        );
      }
      const logged = JSON.stringify(log.mock.calls);
      expect(logged).not.toMatch(/postgres(ql)?:\/\/|PGPASSWORD/);
      expect(logged).not.toContain(CANARY);
    }, 120_000);
  });
});
