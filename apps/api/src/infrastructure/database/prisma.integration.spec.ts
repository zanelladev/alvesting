import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../common/id.js';
import { parseEnv } from '../../config/env.js';
import { PrismaService } from './prisma.service.js';

// Integração com o Postgres de teste. Sem TEST_DATABASE_URL aparece como pulado, com o motivo no nome.
// O banco de teste é sempre separado do de dev (alvesting_test x alvesting_dev) e só ele é tocado aqui.
const url = process.env.TEST_DATABASE_URL;
const title = url
  ? 'banco de teste (Postgres)'
  : 'banco de teste (Postgres) [pulado: defina TEST_DATABASE_URL, ex.: docker compose up -d postgres]';

const apiRoot = fileURLToPath(new URL('../../../', import.meta.url));

// Cria o banco de teste se faltar e aplica as migrations (migrate deploy: só avança, nunca apaga).
async function prepareTestDatabase(testUrl: string) {
  const name = decodeURIComponent(new URL(testUrl).pathname.slice(1));
  if (!/^[a-z0-9_]+_test$/.test(name)) {
    throw new Error(
      `TEST_DATABASE_URL deve apontar para um banco que termina em _test (veio "${name}")`,
    );
  }
  const maintenanceUrl = new URL(testUrl);
  maintenanceUrl.pathname = '/postgres';
  const client = new pg.Client({ connectionString: maintenanceUrl.toString() });
  await client.connect();
  try {
    const found = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (found.rowCount === 0) await client.query(`CREATE DATABASE "${name}"`);
  } finally {
    await client.end();
  }
  execFileSync('pnpm', ['exec', 'prisma', 'migrate', 'deploy'], {
    cwd: apiRoot,
    // CHECKPOINT_DISABLE: o CLI do Prisma consulta checkpoint.prisma.io; teste não usa rede
    env: { ...process.env, DATABASE_URL: testUrl, CHECKPOINT_DISABLE: '1' },
    stdio: 'pipe',
  });
}

describe.skipIf(!url)(title, () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    await prepareTestDatabase(url!);
    prisma = new PrismaService(parseEnv({ DATABASE_URL: url }));
  }, 90_000);

  beforeEach(async () => {
    await prisma.jobRun.deleteMany();
    await prisma.auditLog.deleteMany();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  it('job_run nasce RUNNING, com 1 tentativa e data de início', async () => {
    const row = await prisma.jobRun.create({
      data: { id: newId(), queue: 'market', type: 'eod', idempotencyKey: '2026-10-30' },
    });
    expect(row).toMatchObject({ status: 'RUNNING', attempts: 1, error: null, finishedAt: null });
    expect(row.startedAt).toBeInstanceOf(Date);
    expect(row.id).toHaveLength(26);
  });

  it('a mesma mensagem (tipo + chave) não entra duas vezes', async () => {
    const data = { queue: 'market', type: 'eod', idempotencyKey: '2026-10-30' };
    await prisma.jobRun.create({ data: { id: newId(), ...data } });
    await expect(prisma.jobRun.create({ data: { id: newId(), ...data } })).rejects.toMatchObject({
      code: 'P2002',
    });
  });

  it('a mesma chave em tipos diferentes convive', async () => {
    await prisma.jobRun.create({
      data: { id: newId(), queue: 'market', type: 'eod', idempotencyKey: '2026-10-30' },
    });
    await prisma.jobRun.create({
      data: { id: newId(), queue: 'briefing', type: 'freeze', idempotencyKey: '2026-10-30' },
    });
    expect(await prisma.jobRun.count()).toBe(2);
  });

  it('com 5 inserções concorrentes da mesma mensagem, só uma vence', async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        prisma.jobRun.create({
          data: {
            id: newId(),
            queue: 'settlement',
            type: 'settle',
            idempotencyKey: 'T1:2026-10-30',
          },
        }),
      ),
    );
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
    const losers = attempts.filter((a) => a.status === 'rejected');
    expect(losers).toHaveLength(4);
    for (const loser of losers) expect(loser.reason).toMatchObject({ code: 'P2002' });
  });

  it('registra o fim do processamento e o erro, com emoji e aspas', async () => {
    const id = newId();
    await prisma.jobRun.create({
      data: { id, queue: 'market', type: 'eod', idempotencyKey: '2026-10-30' },
    });
    const error = 'brapi ausente 📉 "404" \'quase\'; DROP TABLE job_run;--';
    await prisma.jobRun.update({
      where: { id },
      data: { status: 'FAILED', attempts: 2, error, finishedAt: new Date() },
    });
    const row = await prisma.jobRun.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: 'FAILED', attempts: 2, error });
    expect(row.finishedAt).toBeInstanceOf(Date);
  });

  // docs/INFRA.md (2.2): o Postgres B1ms tem na casa de 50 conexões para api, worker, jobs e migrate. O pool padrão
  // do pg abre 10 por processo e não tem prazo nenhum: uma consulta pendurada nunca expira.
  it('o pool abre no máximo 4 conexões por processo', async () => {
    const pids = await Promise.all(
      Array.from(
        { length: 12 },
        () =>
          prisma.$queryRaw<
            Array<{ pid: number }>
          >`SELECT pg_backend_pid() AS pid FROM pg_sleep(0.2)`,
      ),
    );
    const distinct = new Set(pids.map(([row]) => row!.pid));
    expect(distinct.size).toBeGreaterThan(1); // houve concorrência de verdade
    expect(distinct.size).toBeLessThanOrEqual(4);
  });

  it('a conexão leva prazo de consulta e de transação ociosa, impostos pelo servidor', async () => {
    const [row] = await prisma.$queryRaw<Array<{ statement: string; idle: string }>>`
      SELECT current_setting('statement_timeout') AS statement,
             current_setting('idle_in_transaction_session_timeout') AS idle`;
    expect(row).toEqual({ statement: '1min', idle: '30s' });
  });

  it('rejeita id maior que 26 caracteres', async () => {
    await expect(
      prisma.jobRun.create({
        data: { id: 'X'.repeat(27), queue: 'market', type: 'eod', idempotencyKey: 'k' },
      }),
    ).rejects.toThrow();
  });

  it('audit_log guarda o detalhe em JSON e a data de criação', async () => {
    const detail = { motivo: 'reprocessar', ciclos: ['2026-10-30'], nested: { ok: true } };
    const id = newId();
    await prisma.auditLog.create({ data: { id, actor: 'system', action: 'cycle.rerun', detail } });
    const row = await prisma.auditLog.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ actor: 'system', action: 'cycle.rerun', target: null, detail });
    expect(row.createdAt).toBeInstanceOf(Date);
  });
});
