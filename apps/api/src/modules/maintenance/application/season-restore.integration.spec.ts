import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BlobServiceClient, type ContainerClient } from '@azure/storage-blob';
import { Logger } from '@nestjs/common';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId } from '../../../common/id.js';
import { runEnsaio, truncateAll } from '../../../ensaio/driver.js';
import { clearEnsaioBlobs } from '../../../ensaio/world.js';
import { applyMigrations, databaseName } from '../../../infrastructure/database/database-admin.js';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import { POLICY_TABLES, personalTables } from '../../../infrastructure/database/table-policy.js';
import {
  openTestDatabase,
  testDatabaseUrl,
} from '../../../infrastructure/database/test-database.fixture.js';
import { collect, connectionArgs, databaseTarget } from '../infrastructure/pg-tools.js';
import { localPgTools, noPgToolsReason } from '../testing/pg-tools.fixture.js';
import { TEMPORADA_CONTAINER_PREFIX } from '../../../temporada/pieces.js';
import {
  TEMPORADA_BLOB_CONTAINERS,
  countTables,
  exportBlobs,
  restoreSeason,
} from './season-restore.js';

// A restauração da temporada na Azure (ADR 0039; docs/RUNBOOK.md, 13.6), de verdade: um banco de origem com uma temporada inteira (o driver
// do ensaio, sintético), o dump SÓ DE DADOS que o RUNBOOK manda fazer (sem as tabelas pessoais e sem o `_prisma_migrations`), o container do
// Blob, e um banco de destino cujo DONO NÃO É SUPERUSUÁRIO (como o administrador do Flexible Server), com o esquema das migrations aplicado por
// ele. Postgres, Azurite e o pg_restore e o psql 17 (do PATH ou de dentro do contêiner do projeto: testing/pg-tools.fixture.ts). Todo dado
// pessoal é sintético (@example.test).
const STORAGE = process.env.STORAGE_CONNECTION_STRING;
const skipReason = !testDatabaseUrl
  ? 'defina TEST_DATABASE_URL, ex.: docker compose up -d postgres'
  : !STORAGE
    ? 'defina STORAGE_CONNECTION_STRING (Azurite: docker compose up -d azurite)'
    : !localPgTools
      ? noPgToolsReason
      : undefined;
const title = `restauração da temporada (Postgres, Azurite, pg_restore e psql 17, destino sem superusuário)${skipReason ? ` [pulado: ${skipReason}]` : ''}`;

// As exclusões do dump do RUNBOOK (13.6): o dado das tabelas pessoais não vai para o container backups (a política de privacidade promete
// cópia com dado pessoal só pelo ponto de restauração de 7 dias), e o controle das migrations é do destino.
const EXCLUDE = [
  '--exclude-table-data=public._prisma_migrations',
  ...personalTables().map((table) => `--exclude-table-data=public.${table}`),
];

describe.skipIf(skipReason !== undefined)(title, () => {
  const tools = localPgTools!;
  const hex = randomBytes(4).toString('hex');
  const stem = databaseName(testDatabaseUrl ?? 'postgresql://x/x_test').replace(/_test$/, '');
  const destination = `${stem}_destino_test`;
  const owner = `${stem}_dono`;
  const ownerPassword = randomBytes(16).toString('hex');
  const destinationUrl = (() => {
    const url = new URL(testDatabaseUrl ?? 'postgresql://x/x_test');
    url.username = owner;
    url.password = ownerPassword;
    url.pathname = `/${destination}`;
    return url.toString();
  })();
  const containerName = `azure-teste-backups-${hex}`;

  let prisma: PrismaService;
  let blob: BlobServiceClient;
  let container: ContainerClient;
  let admin: pg.Client;
  const dumps: Record<string, { name: string; sha256: string }> = {};
  let origin: Record<string, number>;

  // O pg_dump da origem (o administrador do teste), com as opções do RUNBOOK. Devolve os bytes.
  async function dump(args: string[]): Promise<Buffer> {
    const target = databaseTarget(testDatabaseUrl!);
    const child = tools.spawn(
      'pg_dump',
      [...connectionArgs(target), `--dbname=${target.database}`, '--format=custom', ...args],
      {
        env: { PATH: process.env.PATH, PGPASSWORD: target.password },
        signal: AbortSignal.timeout(120_000),
        timeoutMs: 120_000,
      },
    );
    const chunks: Buffer[] = [];
    child.stdout?.on('data', (chunk: Buffer) => chunks.push(chunk));
    const exit = await collect(child, { stdout: false });
    expect(exit.code, exit.stderr).toBe(0);
    return Buffer.concat(chunks);
  }

  async function upload(name: string, bytes: Buffer) {
    await container.getBlockBlobClient(name).uploadData(bytes);
    dumps[name] = { name, sha256: createHash('sha256').update(bytes).digest('hex') };
  }

  const restore = (name: string, sha256 = dumps[name]!.sha256) =>
    restoreSeason({
      databaseUrl: destinationUrl,
      blob,
      container: containerName,
      blobName: name,
      sha256,
      spawn: tools.spawn,
    });

  const ident = (name: string) => `"${name.replaceAll('"', '""')}"`;

  beforeAll(async () => {
    Logger.overrideLogger(false);
    prisma = await openTestDatabase(testDatabaseUrl!);
    blob = BlobServiceClient.fromConnectionString(STORAGE!);
    container = blob.getContainerClient(containerName);
    await container.createIfNotExists();

    const maintenance = new URL(testDatabaseUrl!);
    maintenance.pathname = '/postgres';
    admin = new pg.Client({ connectionString: maintenance.toString() });
    await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${ident(destination)} WITH (FORCE)`);
    await admin.query(`DROP ROLE IF EXISTS ${ident(owner)}`);
    // como o administrador do Flexible Server: cria banco e papel, e NÃO é superusuário
    await admin.query(
      `CREATE ROLE ${ident(owner)} LOGIN NOSUPERUSER CREATEDB CREATEROLE PASSWORD '${ownerPassword}'`,
    );
    await admin.query(`CREATE DATABASE ${ident(destination)} OWNER ${ident(owner)}`);
    // o esquema do destino é o das migrations, aplicadas pelo dono (o job-migrate da Azure)
    applyMigrations(destinationUrl);

    // a origem: uma temporada inteira e sintética, mais uma pessoa (que o dump não pode levar)
    await runEnsaio({ prisma, blob, seed: 1, sessions: 3, stocks: 12 });
    await prisma.user.create({
      data: { id: newId(), name: 'Pessoa da origem', email: `origem-${hex}@example.test` },
    });
    origin = await countTables(testDatabaseUrl!);

    await upload('temporada.dump', await dump(['--data-only', ...EXCLUDE]));
    await upload('com-dado-pessoal.dump', await dump(['--data-only']));
    await upload('com-esquema.dump', await dump(EXCLUDE));
  }, 300_000);

  afterAll(async () => {
    await container?.deleteIfExists();
    if (prisma) {
      await truncateAll(prisma);
      await prisma.onModuleDestroy();
    }
    if (blob) await clearEnsaioBlobs(blob);
    if (admin) {
      await admin.query(`DROP DATABASE IF EXISTS ${ident(destination)} WITH (FORCE)`);
      await admin.query(`DROP ROLE IF EXISTS ${ident(owner)}`);
      await admin.end();
    }
  }, 120_000);

  it('o dono do destino não é superusuário, e o destino nasce só com o esquema das migrations', async () => {
    const client = new pg.Client({ connectionString: destinationUrl });
    await client.connect();
    try {
      const { rows } = await client.query<{ super: boolean }>(
        'SELECT rolsuper AS super FROM pg_roles WHERE rolname = current_user',
      );
      expect(rows[0]!.super).toBe(false);
    } finally {
      await client.end();
    }
    const empty = await countTables(destinationUrl);
    for (const table of POLICY_TABLES) expect(empty[table], table).toBe(0);
    expect(origin.season).toBe(1);
    expect(origin.cycle).toBeGreaterThan(0);
  });

  it('nome de blob e SHA-256 fora do formato: recusa sem tocar em nada', async () => {
    await expect(restore('../segredo.dump', 'a'.repeat(64))).rejects.toThrow(/nome do dump/);
    await expect(restore('temporada.dump', 'nao-e-sha')).rejects.toThrow(/SHA-256/);
  });

  it('o SHA-256 que não bate: recusa antes de escrever qualquer coisa', async () => {
    const before = await countTables(destinationUrl);
    await expect(restore('temporada.dump', '0'.repeat(64))).rejects.toThrow(
      /SHA-256 do dump .* não é o esperado/,
    );
    expect(await countTables(destinationUrl)).toEqual(before);
  });

  it('o dump com dado pessoal (feito sem as exclusões do RUNBOOK): recusa, e nada muda', async () => {
    const before = await countTables(destinationUrl);
    await expect(restore('com-dado-pessoal.dump')).rejects.toThrow(/tabelas pessoais/);
    expect(await countTables(destinationUrl)).toEqual(before);
  });

  it('o dump com o esquema junto (sem o --data-only): recusa, e nada muda', async () => {
    const before = await countTables(destinationUrl);
    await expect(restore('com-esquema.dump')).rejects.toThrow(/só de dados/);
    expect(await countTables(destinationUrl)).toEqual(before);
  });

  it('restaura só os dados, tabela a tabela com a contagem do dump: o que a Azure já coletou dá lugar à temporada, e a conta e a trilha do destino ficam', async () => {
    // o que o destino já tem antes da restauração: o que um agendador da Azure gravou (job_run), a conta de quem se cadastrou no site novo e a
    // linha da trilha da promoção dela (audit_log)
    const client = new pg.Client({ connectionString: destinationUrl });
    await client.connect();
    let migrations: number;
    try {
      await client.query(
        `INSERT INTO job_run (id, queue, type, idempotency_key, status) VALUES ($1, 'news', 'fetch', 'rss:infomoney:2026-11-07T00:00', 'SUCCEEDED')`,
        [newId()],
      );
      await client.query(
        `INSERT INTO "user" (id, name, email) VALUES ($1, 'Pessoa do destino', $2)`,
        [newId(), `destino-${hex}@example.test`],
      );
      await client.query(
        `INSERT INTO audit_log (id, actor, action, target) VALUES ($1, 'cli:account', 'account.promoted', $2)`,
        [newId(), newId()],
      );
      migrations = Number(
        (await client.query<{ n: string }>('SELECT count(*)::text AS n FROM _prisma_migrations'))
          .rows[0]!.n,
      );
    } finally {
      await client.end();
    }
    const before = await countTables(destinationUrl);

    const result = await restore('temporada.dump');

    const after = await countTables(destinationUrl);
    const personal = new Set(personalTables());
    for (const table of POLICY_TABLES) {
      if (personal.has(table)) {
        // o dado pessoal não veio do dump, e o que o destino tinha ficou
        expect(after[table], table).toBe(before[table]);
        expect(result.tables[table], table).toBeUndefined();
      } else if (table === 'audit_log') {
        // a trilha só cresce: a do dump soma à do destino
        expect(after[table]).toBe(before[table]! + origin[table]!);
        expect(result.tables[table]).toEqual({ dump: origin[table], restored: after[table] });
      } else {
        // as contagens batem com as da origem
        expect(after[table], table).toBe(origin[table]);
        expect(result.tables[table], table).toEqual({
          dump: origin[table],
          restored: origin[table],
        });
      }
    }
    expect(after.user).toBe(1);
    expect(result.sha256).toBe(dumps['temporada.dump']!.sha256);
    const check = new pg.Client({ connectionString: destinationUrl });
    await check.connect();
    try {
      expect(
        Number(
          (await check.query<{ n: string }>('SELECT count(*)::text AS n FROM _prisma_migrations'))
            .rows[0]!.n,
        ),
        'o controle das migrations do destino não muda',
      ).toBe(migrations);
    } finally {
      await check.end();
    }
  });

  it('o destino que já tem temporada: recusa, e nada muda', async () => {
    const before = await countTables(destinationUrl);
    await expect(restore('temporada.dump')).rejects.toThrow(/já tem temporada/);
    expect(await countTables(destinationUrl)).toEqual(before);
  });

  // A outra metade (RUNBOOK, 13.6): os arquivos do Blob da temporada local para uma pasta, com os mesmos nomes (o briefing é lido pelo pregão e
  // pelo SHA-256 do nome). Containers `azure-teste-*` no lugar dos `temporada-*` (que são da temporada de verdade).
  it('exportar o Blob da temporada: cada arquivo dos containers da temporada na pasta do container da conta, com o mesmo nome e os mesmos bytes', async () => {
    expect(
      Object.keys(TEMPORADA_BLOB_CONTAINERS).every((name) =>
        name.startsWith(TEMPORADA_CONTAINER_PREFIX),
      ),
    ).toBe(true);
    expect(Object.values(TEMPORADA_BLOB_CONTAINERS).sort()).toEqual(['briefings', 'llm-io']);
    const prefix = `azure-teste-${hex}-`;
    const files: Record<string, Record<string, string>> = {
      briefings: { '2026-10-13/7ccc20294fca.json': '{"pregao":"2026-10-13"}' },
      'llm-io': {
        '2026-10-13/modelo-a/9f1.json': '{"io":1}',
        '2026-10-14/modelo-b/a02.json': '{"io":2}',
      },
    };
    for (const [to, blobs] of Object.entries(files)) {
      const source = blob.getContainerClient(`${prefix}${to}`);
      await source.createIfNotExists();
      for (const [name, body] of Object.entries(blobs)) {
        await source.getBlockBlobClient(name).upload(body, Buffer.byteLength(body));
      }
    }
    const dir = await mkdtemp(path.join(tmpdir(), 'alvesting-exportar-'));
    try {
      const counts = await exportBlobs(blob, dir, {
        [`${prefix}briefings`]: 'briefings',
        [`${prefix}llm-io`]: 'llm-io',
      });
      expect(counts).toEqual({ briefings: 1, 'llm-io': 2 });
      for (const [to, blobs] of Object.entries(files)) {
        for (const [name, body] of Object.entries(blobs)) {
          expect(await readFile(path.join(dir, to, name), 'utf8')).toBe(body);
        }
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
      for (const to of Object.keys(files))
        await blob.getContainerClient(`${prefix}${to}`).deleteIfExists();
    }
  });
});
