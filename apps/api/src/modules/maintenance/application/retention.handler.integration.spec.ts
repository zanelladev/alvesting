import { Logger } from '@nestjs/common';
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
import { parseEnv } from '../../../config/env.js';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import {
  integrationTitle,
  openTestDatabase,
  testDatabaseUrl,
} from '../../../infrastructure/database/test-database.fixture.js';
import { ALERT_LOG } from '../../../telemetry/alert-logs.js';
import { JobRunStore } from '../../messaging/infrastructure/job-run.store.js';
import { RetentionRepository } from '../infrastructure/retention.repository.js';
import { RETENTION_DAYS, RetentionHandler } from './retention.handler.js';

// A retenção que a política de privacidade promete (legal/politica-de-privacidade.md, item 5; docs/CONTA.md, seção 5) e a dos job_run do
// `fetch`, de verdade, no Postgres: o que é apagado e o que NÃO é, com linhas de cada lado de cada limite, o relógio injetado, lotes
// pequenos e a contagem de cada DELETE no log, sem dado pessoal. Todo dado é sintético (@example.test). Mais dois cuidados do SQL: a
// linha que muda no meio do lote não é apagada, e o corte não depende do fuso horário da sessão do banco. E a promessa em si: o pior caso
// de cada item (o corte MAIS a espera até a próxima limpeza, que roda todo dia), provado com o relógio andando de limpeza em limpeza.
const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = new Date('2026-11-04T13:00:00Z'); // 10:00 em Brasília, o horário do sched-retention; o dia da semana não importa (a limpeza é diária)
const ago = (ms: number) => new Date(NOW.getTime() - ms);

describe.skipIf(!testDatabaseUrl)(integrationTitle('RetentionHandler (retenção)'), () => {
  let prisma: PrismaService;
  let jobs: JobRunStore;
  let handler: RetentionHandler;
  let log: MockInstance<Logger['log']>;
  let counter = 0;

  const user = (verified: boolean, createdAt: Date, name = `u${counter++}`) =>
    prisma.user.create({
      data: {
        id: newId(),
        name: `Pessoa ${name}`,
        email: `${name}-${Date.now().toString(36)}@example.test`,
        emailVerified: verified,
        createdAt,
      },
    });
  const session = (userId: string, expiresAt: Date) =>
    prisma.session.create({
      data: { id: newId(), userId, token: `tok-${newId()}`, expiresAt },
    });
  const verification = (expiresAt: Date) =>
    prisma.verification.create({
      data: { id: newId(), identifier: `id-${newId()}`, value: newId(), expiresAt },
    });
  const fetchJob = (
    startedAt: Date,
    type = 'fetch',
    status: 'SUCCEEDED' | 'RUNNING' = 'SUCCEEDED',
  ) =>
    prisma.jobRun.create({
      data: {
        id: newId(),
        queue: type === 'fetch' ? 'news' : 'market',
        type,
        idempotencyKey: `${type}:${newId()}`,
        status,
        startedAt,
      },
    });
  const ids = async (table: 'user' | 'session' | 'verification' | 'jobRun') =>
    ((await (prisma[table] as { findMany(): Promise<Array<{ id: string }>> }).findMany()) ?? [])
      .map((row) => row.id)
      .sort();

  async function clean() {
    await prisma.session.deleteMany();
    await prisma.verification.deleteMany();
    await prisma.jobRun.deleteMany();
    await prisma.newsItem.deleteMany();
    await prisma.auditLog.deleteMany({ where: { action: { startsWith: 'account.' } } });
    // o gatilho do aceite só deixa o DELETE passar em cascata (apagar o usuário leva o aceite junto)
    await prisma.user.deleteMany({ where: { email: { endsWith: '@example.test' } } });
  }

  beforeAll(async () => {
    Logger.overrideLogger(false);
    prisma = await openTestDatabase(testDatabaseUrl!);
    jobs = new JobRunStore(prisma);
  }, 120_000);

  beforeEach(async () => {
    await clean();
    log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    handler = new RetentionHandler(jobs, new RetentionRepository(prisma), () => NOW);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await clean();
    await prisma.onModuleDestroy();
  });

  // 6 de corte + 1 dia até a próxima limpeza diária = os 7 dias que a política promete para o cadastro nunca confirmado
  it('os cortes são os da política de privacidade (cadastro de 6 dias, sessão e pedido vencidos) e o do job_run do fetch (30 dias)', () => {
    expect(RETENTION_DAYS).toEqual({ user: 6, session: 0, verification: 0, job_run: 30 });
  });

  describe('sessão vencida', () => {
    it('apaga a vencida (há muito ou há 1 ms) e guarda a que vence agora, a que vence daqui a 1 ms e a que ainda vale', async () => {
      const owner = await user(true, ago(60 * DAY));
      const old = await session(owner.id, ago(30 * DAY));
      const justExpired = await session(owner.id, ago(1));
      const edge = await session(owner.id, NOW);
      const justValid = await session(owner.id, new Date(NOW.getTime() + 1));
      const valid = await session(owner.id, new Date(NOW.getTime() + DAY));

      const result = await handler.execute('2026-11-04');

      expect(result).toMatchObject({ outcome: 'done', deleted: { session: 2 } });
      expect(await ids('session')).toEqual([edge.id, justValid.id, valid.id].sort());
      expect(await ids('session')).not.toContain(old.id);
      expect(await ids('session')).not.toContain(justExpired.id);
    });
  });

  describe('pedido de uso único (verification) vencido', () => {
    it('apaga o vencido (há 1 ms) e guarda o que vence agora, o que vence daqui a 1 ms e o que ainda vale', async () => {
      const expired = await verification(ago(1));
      const now = await verification(NOW);
      const justValid = await verification(new Date(NOW.getTime() + 1));
      const valid = await verification(new Date(NOW.getTime() + 3_600_000));

      const result = await handler.execute('2026-11-04');

      expect(result).toMatchObject({ deleted: { verification: 1 } });
      expect(await ids('verification')).toEqual([now.id, justValid.id, valid.id].sort());
      expect(await ids('verification')).not.toContain(expired.id);
    });
  });

  describe('cadastro nunca confirmado há mais de 6 dias', () => {
    it('apaga o não verificado criado há mais de 6 dias, com a sessão, a conta e o aceite em cascata, e guarda o resto', async () => {
      // um milissegundo de cada lado do corte (a coluna é timestamptz(3)): passou, está exatamente nele, ainda não chegou
      const stale = await user(false, ago(6 * DAY + 1), 'velho');
      const edge = await user(false, ago(6 * DAY), 'borda');
      const fresh = await user(false, ago(6 * DAY - 1), 'novo');
      const verified = await user(true, ago(90 * DAY), 'confirmado');
      for (const owner of [stale, verified]) {
        await session(owner.id, new Date(NOW.getTime() + DAY));
        await prisma.account.create({
          data: { id: newId(), userId: owner.id, accountId: owner.id, providerId: 'credential' },
        });
        await prisma.consent.create({
          data: {
            id: newId(),
            userId: owner.id,
            document: 'TERMS',
            version: '0.1',
            sha256: 'c'.repeat(64),
          },
        });
      }

      const result = await handler.execute('2026-11-04');

      expect(result).toMatchObject({ deleted: { user: 1 } });
      expect(await ids('user')).toEqual([edge.id, fresh.id, verified.id].sort());
      // a cascata levou tudo do usuário apagado (o gatilho do aceite deixa passar o DELETE em cascata) e nada do que ficou
      expect(await prisma.session.count({ where: { userId: stale.id } })).toBe(0);
      expect(await prisma.account.count({ where: { userId: stale.id } })).toBe(0);
      expect(await prisma.consent.count({ where: { userId: stale.id } })).toBe(0);
      expect(await prisma.session.count({ where: { userId: verified.id } })).toBe(1);
      expect(await prisma.account.count({ where: { userId: verified.id } })).toBe(1);
      expect(await prisma.consent.count({ where: { userId: verified.id } })).toBe(1);
    });
  });

  describe('job_run do tipo fetch com mais de 30 dias', () => {
    it('apaga o fetch de mais de 30 dias (qualquer estado) e guarda o de 30 dias exatos, o recente e os outros tipos, por mais velhos que sejam', async () => {
      const old = await fetchJob(ago(30 * DAY + 1000));
      const oldRunning = await fetchJob(ago(45 * DAY), 'fetch', 'RUNNING');
      const edge = await fetchJob(ago(30 * DAY));
      const recent = await fetchJob(ago(30 * DAY - 1000));
      const eod = await fetchJob(ago(400 * DAY), 'eod');

      const result = await handler.execute('2026-11-04');

      expect(result).toMatchObject({ deleted: { job_run: 2 } });
      const left = await ids('jobRun');
      expect(left).toContain(edge.id);
      expect(left).toContain(recent.id);
      expect(left).toContain(eod.id);
      expect(left).not.toContain(old.id);
      expect(left).not.toContain(oldRunning.id);
      // a linha da própria retenção (type retention) fica
      expect(await prisma.jobRun.count({ where: { type: 'retention' } })).toBe(1);
    });
  });

  it('news_item NÃO tem retenção: é o histórico público e a reprodutibilidade da arena (estimativa de tamanho em retention.handler.ts)', async () => {
    await prisma.newsItem.create({
      data: {
        id: newId(),
        urlHash: 'd'.repeat(64),
        url: 'https://exemplo.com.br/velha',
        source: 'infomoney',
        title: 'Notícia de mais de um ano',
        snippet: 'Resumo.',
        tickers: ['PETR4'],
        publishedAt: ago(400 * DAY),
        firstSeenAt: ago(400 * DAY),
      },
    });
    await handler.execute('2026-11-04');
    expect(await prisma.newsItem.count()).toBe(1);
  });

  // A PROMESSA da política (item 5 de legal/politica-de-privacidade.md) é o PIOR CASO de cada item: o corte MAIS a espera até a próxima
  // limpeza. O sched-retention roda todo dia às 13:00 UTC (`0 13 * * *`, infra/modules/containerapps.bicep), então o relógio injetado anda de
  // limpeza em limpeza (a 0 é 01/11/2026 13:00:00.000Z) e o teste lê, de cada linha, em qual delas ela sumiu. Cada linha nasce (ou vence) num
  // instante diferente em torno da limpeza 0: 1 ms antes, EXATAMENTE nela (o pior caso de verdade, porque o corte é "antes de", estrito), 1 ms
  // depois ("logo depois de uma limpeza"), 6, 12 e 18 horas depois, e 1 ms antes da limpeza seguinte.
  describe('a promessa da política: o pior caso da limpeza diária', () => {
    const FIRST = new Date('2026-11-01T13:00:00Z');
    const runAt = (k: number) => new Date(FIRST.getTime() + k * DAY);
    const OFFSETS = [-1, 0, 1, 6 * HOUR, 12 * HOUR, 18 * HOUR, DAY - 1];
    const RUNS = 9; // as limpezas 0 a 8 cobrem os 7 dias do cadastro com folga
    const at = (offset: number) => new Date(FIRST.getTime() + offset);

    // Roda as limpezas e devolve, de cada linha, o tempo que ela esperou até sumir: entre o instante dela e a limpeza que a apagou.
    async function waited(
      table: 'user' | 'session' | 'verification',
      rows: Array<{ id: string; at: Date }>,
    ): Promise<number[]> {
      const gone = new Map<string, number>();
      for (let k = 0; k < RUNS; k += 1) {
        const now = runAt(k);
        await new RetentionHandler(jobs, new RetentionRepository(prisma), () => now).execute(
          now.toISOString().slice(0, 10),
        );
        const left = new Set(await ids(table));
        for (const row of rows) if (!left.has(row.id) && !gone.has(row.id)) gone.set(row.id, k);
      }
      return rows.map((row) => {
        const k = gone.get(row.id);
        expect(k, `a linha de ${row.at.toISOString()} nunca foi apagada`).toBeDefined();
        return runAt(k!).getTime() - row.at.getTime();
      });
    }

    it('o cadastro nunca confirmado criado logo depois de uma limpeza é apagado por uma limpeza em até 7 dias, e nenhum fica mais que isso', async () => {
      const rows = [];
      for (const [i, offset] of OFFSETS.entries()) {
        rows.push({ id: (await user(false, at(offset), `pior${i}`)).id, at: at(offset) });
      }

      const ages = await waited('user', rows);

      // nenhum fica mais de 7 dias depois de criado (a promessa), e nenhum some antes de passar dos 6 (o corte)
      for (const age of ages) {
        expect(age).toBeLessThanOrEqual(7 * DAY);
        expect(age).toBeGreaterThan(6 * DAY);
      }
      // o pior caso é exatamente 7 dias: a conta criada na hora da limpeza só sai na limpeza de 7 dias depois
      expect(Math.max(...ages)).toBe(7 * DAY);
      // a criada 1 ms depois de uma limpeza sai na limpeza de 7 dias depois dela: 1 ms antes de completar os 7
      expect(ages[OFFSETS.indexOf(1)]).toBe(7 * DAY - 1);
      expect(await ids('user')).toEqual([]);
    });

    it('a sessão vencida logo depois de uma limpeza é apagada pela seguinte: até 1 dia depois de vencer, e nenhuma fica mais que isso', async () => {
      const owner = await user(true, ago(60 * DAY));
      const rows = [];
      for (const offset of OFFSETS) {
        rows.push({ id: (await session(owner.id, at(offset))).id, at: at(offset) });
      }

      const ages = await waited('session', rows);

      for (const age of ages) {
        expect(age).toBeLessThanOrEqual(DAY);
        expect(age).toBeGreaterThan(0);
      }
      // a que vence exatamente na hora da limpeza só sai na seguinte (o corte é "antes de"): 1 dia exato
      expect(Math.max(...ages)).toBe(DAY);
      expect(await ids('session')).toEqual([]);
    });

    it('o pedido de uso único vencido logo depois de uma limpeza é apagado pela seguinte: até 1 dia depois de vencer', async () => {
      const rows = [];
      for (const offset of OFFSETS) {
        rows.push({ id: (await verification(at(offset))).id, at: at(offset) });
      }

      const ages = await waited('verification', rows);

      for (const age of ages) {
        expect(age).toBeLessThanOrEqual(DAY);
        expect(age).toBeGreaterThan(0);
      }
      expect(Math.max(...ages)).toBe(DAY);
      expect(await ids('verification')).toEqual([]);
    });
  });

  describe('lotes pequenos, contagem no log, repetição', () => {
    it('apaga em lotes (a contagem de cada DELETE vai ao log) e termina quando um lote vem incompleto', async () => {
      const owner = await user(true, ago(60 * DAY));
      for (let i = 0; i < 5; i += 1) await session(owner.id, ago(8 * DAY + i * 1000));
      handler = new RetentionHandler(jobs, new RetentionRepository(prisma), () => NOW, {
        batchSize: 2,
      });

      const result = await handler.execute('2026-11-04');

      expect(result).toMatchObject({ deleted: { session: 5 } });
      expect(await prisma.session.count()).toBe(0);
      const batches = log.mock.calls
        .map((call) => call[0] as { table?: string; deleted?: number })
        .filter((line) => line.table === 'session');
      expect(batches.map((line) => line.deleted)).toEqual([2, 2, 1]);
    });

    it('lote cheio seguido de lote vazio: o último DELETE (que apaga zero) também é contado, e o laço para', async () => {
      const owner = await user(true, ago(60 * DAY));
      for (let i = 0; i < 4; i += 1) await session(owner.id, ago(8 * DAY + i * 1000));
      handler = new RetentionHandler(jobs, new RetentionRepository(prisma), () => NOW, {
        batchSize: 2,
      });
      await handler.execute('2026-11-04');
      const batches = log.mock.calls
        .map((call) => call[0] as { table?: string; deleted?: number })
        .filter((line) => line.table === 'session');
      expect(batches.map((line) => line.deleted)).toEqual([2, 2, 0]);
    });

    it('o log leva tabela, quantas linhas e o corte, e nenhum dado pessoal (nem e-mail, nem nome, nem ULID de usuário)', async () => {
      const stale = await user(false, ago(8 * DAY), 'pessoaprivada');
      await handler.execute('2026-11-04');
      const text = JSON.stringify(log.mock.calls);
      expect(text).toContain('"table":"user"');
      expect(text).toContain('"deleted":1');
      expect(text).toContain('2026-10-29T13:00:00.000Z'); // o corte de 6 dias: 04/11 menos 6 dias
      for (const personal of ['pessoaprivada', '@example.test', 'Pessoa ', stale.id]) {
        expect(text, personal).not.toContain(personal);
      }
    });

    it('roda duas vezes sem erro: a segunda (outro dia) não acha nada, e a mesma mensagem repetida é barrada pelo job_run', async () => {
      const owner = await user(true, ago(60 * DAY));
      await session(owner.id, ago(8 * DAY));

      const first = await handler.execute('2026-11-04');
      expect(first).toMatchObject({ outcome: 'done', deleted: { session: 1 } });

      // mensagem repetida (a mesma data): a linha de job_run já está concluída, e nada é consultado de novo
      log.mockClear();
      await expect(handler.execute('2026-11-04')).resolves.toEqual({ outcome: 'already_done' });
      expect(log).not.toHaveBeenCalled();

      // outro dia: roda, e não acha nada para apagar
      await expect(handler.execute('2026-11-05')).resolves.toMatchObject({
        outcome: 'done',
        deleted: { user: 0, session: 0, verification: 0, job_run: 0 },
      });
    });

    it('é pelo handle (a função da fila) que a mensagem chega, e o relógio é o injetado, não o da máquina', async () => {
      const owner = await user(true, ago(60 * DAY));
      const old = await session(owner.id, ago(30_000));
      // um relógio 1 minuto antes: a sessão que venceu há 30 segundos ainda não tinha vencido, então fica
      const early = new RetentionHandler(
        jobs,
        new RetentionRepository(prisma),
        () => new Date(NOW.getTime() - 60_000),
      );
      await early.execute('2026-11-03');
      expect(await ids('session')).toEqual([old.id]);
      await handler.handle({ type: 'retention', date: '2026-11-04' });
      expect(await ids('session')).toEqual([]);
    });
  });

  // A subconsulta (`id IN (SELECT ... LIMIT n)`) escolhe as linhas num instante e o DELETE as trava depois. Se a linha muda nesse intervalo,
  // o Postgres reavalia só o WHERE do DELETE de fora (READ COMMITTED): sem a regra repetida ali, a conta que acabou de ser confirmada, ou a
  // sessão que acabou de ser renovada, seria apagada. O teste segura a linha numa transação aberta, espera o DELETE chegar à trava dela e só
  // então confirma a mudança.
  describe('a linha que muda no meio do lote não é apagada', () => {
    // `other` segura a linha numa transação aberta; `monitor` olha o servidor FORA de transação (o pg_stat_activity é uma fotografia por
    // transação: lido de dentro da transação aberta, nunca mostraria o DELETE chegando à trava)
    let other: pg.Client;
    let monitor: pg.Client;

    beforeEach(async () => {
      other = new pg.Client({ connectionString: testDatabaseUrl });
      monitor = new pg.Client({ connectionString: testDatabaseUrl });
      await Promise.all([other.connect(), monitor.connect()]);
    });
    afterEach(async () => {
      await other.query('ROLLBACK').catch(() => undefined);
      await Promise.all([other.end(), monitor.end()]);
    });

    async function deleteWhileLocked(
      table: 'user' | 'session',
      cutoff: Date,
      mutate: { sql: string; params: unknown[] },
    ): Promise<number> {
      await other.query('BEGIN');
      await other.query(mutate.sql, mutate.params);
      // a consulta do Prisma é preguiçosa (só sai quando alguém a espera): o Promise.resolve a dispara já
      const deleting = Promise.resolve(
        new RetentionRepository(prisma).deleteBatch(table, cutoff, 500),
      );
      // o DELETE só avança depois do COMMIT: espera até ele estar parado na trava da linha (é aí que o WHERE de fora é reavaliado)
      await vi.waitFor(
        async () => {
          const { rows } = await monitor.query<{ waiting: number }>(
            `SELECT count(*)::int AS waiting FROM pg_stat_activity
             WHERE datname = current_database() AND pid <> pg_backend_pid()
               AND wait_event_type = 'Lock' AND query ILIKE $1`,
            [`%DELETE FROM "${table}"%`],
          );
          expect(rows[0]!.waiting).toBe(1);
        },
        { timeout: 10_000, interval: 25 },
      );
      await other.query('COMMIT');
      return deleting;
    }

    it('o cadastro que confirmou o e-mail durante o lote fica, com a conta, a sessão e o aceite', async () => {
      const racing = await user(false, ago(7 * DAY), 'confirmou');
      await session(racing.id, new Date(NOW.getTime() + DAY));
      await prisma.consent.create({
        data: {
          id: newId(),
          userId: racing.id,
          document: 'TERMS',
          version: '0.1',
          sha256: 'e'.repeat(64),
        },
      });

      const deleted = await deleteWhileLocked('user', ago(6 * DAY), {
        sql: 'UPDATE "user" SET email_verified = true WHERE id = $1',
        params: [racing.id],
      });

      expect(deleted).toBe(0);
      expect(await prisma.user.count({ where: { id: racing.id, emailVerified: true } })).toBe(1);
      expect(await prisma.session.count({ where: { userId: racing.id } })).toBe(1);
      expect(await prisma.consent.count({ where: { userId: racing.id } })).toBe(1);
    }, 20_000);

    it('a sessão renovada durante o lote fica', async () => {
      const owner = await user(true, ago(60 * DAY));
      const racing = await session(owner.id, ago(DAY));

      const deleted = await deleteWhileLocked('session', NOW, {
        sql: 'UPDATE "session" SET expires_at = $2 WHERE id = $1',
        params: [racing.id, new Date(NOW.getTime() + 7 * DAY)],
      });

      expect(deleted).toBe(0);
      expect(await ids('session')).toEqual([racing.id]);
    }, 20_000);
  });

  // O Prisma manda o Date sem fuso, e o Postgres o leria no TimeZone da SESSÃO: num servidor em horário de Brasília todo corte andaria 3
  // horas (e num em Tóquio, 9). O corte vai como texto ISO com `Z` e vira timestamptz no SQL. Os testes acima rodam em UTC e não veriam isso.
  describe('o corte não depende do fuso horário do banco', () => {
    it.each(['America/Sao_Paulo', 'Asia/Tokyo', 'Pacific/Kiritimati', 'UTC'])(
      'com a sessão do banco em %s, apaga o vencido há 2 horas e guarda o que vence daqui a 2 horas (corte de agora)',
      async (zone) => {
        const url = new URL(testDatabaseUrl!);
        url.searchParams.set('options', `-c timezone=${zone}`);
        const zoned = new PrismaService(parseEnv({ DATABASE_URL: url.toString() }));
        try {
          // a premissa do teste: a sessão do banco está mesmo nesse fuso (senão ele passaria à toa)
          expect(await zoned.$queryRaw`SELECT current_setting('TimeZone') AS zone`).toEqual([
            { zone },
          ]);
          const owner = await user(true, ago(60 * DAY));
          const expired = await session(owner.id, ago(2 * 3_600_000));
          const valid = await session(owner.id, new Date(NOW.getTime() + 2 * 3_600_000));

          const deleted = await new RetentionRepository(zoned).deleteBatch('session', NOW, 500);

          expect(deleted).toBe(1);
          expect(await ids('session')).toEqual([valid.id]);
          expect(await ids('session')).not.toContain(expired.id);
        } finally {
          await zoned.$disconnect();
        }
      },
    );
  });

  describe('falha', () => {
    it('um DELETE que falha deixa o job_run FAILED, escreve a linha do alerta job-falhou e propaga o erro para a fila repetir', async () => {
      const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const broken = new RetentionHandler(
        jobs,
        { deleteBatch: () => Promise.reject(new Error('banco fora')) },
        () => NOW,
      );

      await expect(broken.execute('2026-11-04')).rejects.toThrow(/banco fora/);

      const row = await prisma.jobRun.findFirstOrThrow({ where: { type: 'retention' } });
      expect(row.status).toBe('FAILED');
      expect(row.error).toMatch(/banco fora/);
      const alert = error.mock.calls.find((call) => call[1] === ALERT_LOG.jobFailed);
      expect(alert?.[0]).toMatchObject({ queue: 'maintenance', type: 'retention' });
      // a próxima entrega reassume a linha FAILED e conclui
      await expect(handler.execute('2026-11-04')).resolves.toMatchObject({ outcome: 'done' });
    });
  });
});
