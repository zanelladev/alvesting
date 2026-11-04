import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { QUEUES, type QueueMessage } from '@alvesting/contracts';
import {
  integrationTitle,
  openTestDatabase,
  testDatabaseUrl,
} from '../../../infrastructure/database/test-database.fixture.js';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import { JobRunStore } from './job-run.store.js';

const eod: QueueMessage = { type: 'eod', date: '2026-10-30' };
const freeze: QueueMessage = { type: 'freeze', date: '2026-10-30' };

describe.skipIf(!testDatabaseUrl)(integrationTitle('JobRunStore: idempotência da fila'), () => {
  let prisma: PrismaService;
  let store: JobRunStore;

  beforeAll(async () => {
    prisma = await openTestDatabase(testDatabaseUrl!);
    store = new JobRunStore(prisma);
  }, 120_000);

  beforeEach(async () => {
    await prisma.jobRun.deleteMany();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  const rowOf = (message: QueueMessage) =>
    prisma.jobRun.findFirstOrThrow({ where: { type: message.type } });

  it('a primeira entrega assume a mensagem: linha RUNNING com a fila, o tipo e a chave natural', async () => {
    const result = await store.claim(eod);
    expect(result).toMatchObject({ status: 'claimed', claim: { attempt: 1 } });
    expect(await rowOf(eod)).toMatchObject({
      queue: 'market',
      type: 'eod',
      idempotencyKey: '2026-10-30',
      status: 'RUNNING',
      attempts: 1,
    });
  });

  it('uma segunda entrega enquanto a primeira trabalha fica de fora (busy), sem criar linha', async () => {
    await store.claim(eod);
    expect(await store.claim(eod)).toEqual({ status: 'busy' });
    expect(await prisma.jobRun.count()).toBe(1);
  });

  it('depois de concluída, a mesma mensagem não faz nada (done)', async () => {
    const first = await store.claim(eod);
    if (first.status !== 'claimed') throw new Error('devia assumir');
    await store.succeed(first.claim);
    expect(await store.claim(eod)).toEqual({ status: 'done' });
    expect(await rowOf(eod)).toMatchObject({ status: 'SUCCEEDED', attempts: 1, error: null });
    expect((await rowOf(eod)).finishedAt).toBeInstanceOf(Date);
  });

  it('depois de uma falha, a nova tentativa assume de novo e conta mais uma tentativa', async () => {
    const first = await store.claim(eod);
    if (first.status !== 'claimed') throw new Error('devia assumir');
    await store.fail(first.claim, new Error('brapi fora do ar'));
    expect(await rowOf(eod)).toMatchObject({ status: 'FAILED', error: 'brapi fora do ar' });

    const second = await store.claim(eod);
    expect(second).toMatchObject({ status: 'claimed', claim: { attempt: 2 } });
    expect(await rowOf(eod)).toMatchObject({
      status: 'RUNNING',
      attempts: 2,
      error: null,
      finishedAt: null,
    });
  });

  it('uma espera (WAITING) não é falha: a cópia agendada reassume a linha como nova tentativa', async () => {
    const first = await store.claim(eod);
    if (first.status !== 'claimed') throw new Error('devia assumir');
    await store.wait(first.claim, 'brapi sem todas as barras de 2026-10-30');
    expect(await rowOf(eod)).toMatchObject({
      status: 'WAITING',
      error: 'brapi sem todas as barras de 2026-10-30',
    });
    expect((await rowOf(eod)).finishedAt).toBeInstanceOf(Date);
    // a espera não tem dono: o dono antigo não consegue marcar FAILED por cima dela
    await store.fail(first.claim, 'tarde demais');
    expect(await rowOf(eod)).toMatchObject({ status: 'WAITING' });

    expect(await store.claim(eod)).toMatchObject({ status: 'claimed', claim: { attempt: 2 } });
    expect(await rowOf(eod)).toMatchObject({ status: 'RUNNING', attempts: 2, error: null });
  });

  it('o claim traz a fila, o tipo e a chave para a linha de log do alerta', async () => {
    const result = await store.claim(eod);
    expect(result).toMatchObject({
      status: 'claimed',
      claim: { label: { queue: 'market', type: 'eod', key: 'eod:2026-10-30' } },
    });
  });

  it('um RUNNING mais velho que a renovação da trava foi deixado por um processo que caiu: assume', async () => {
    await store.claim(eod);
    const staleMs = QUEUES.market.lockRenewalMs;
    await prisma.jobRun.updateMany({ data: { startedAt: new Date(Date.now() - staleMs - 1_000) } });
    expect(await store.claim(eod)).toMatchObject({ status: 'claimed', claim: { attempt: 2 } });
  });

  it('a linha nasce com a hora do `now` de quem chama, não com a do banco: com o relógio fixado, duas entregas simultâneas não assumem as duas', async () => {
    // 03/11/2026 está no futuro do relógio do banco; se a linha nascesse com a hora do banco, "velha" seria verdade
    const future = new Date('2026-11-03T11:05:00Z');
    const results = await Promise.all(Array.from({ length: 6 }, () => store.claim(eod, future)));
    expect(results.filter((r) => r.status === 'claimed')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'busy')).toHaveLength(5);
    expect((await rowOf(eod)).startedAt).toEqual(future);
    // e a conferência de "velha" usa o mesmo relógio: 27 minutos depois a dona é considerada caída
    const later = new Date(future.getTime() + QUEUES.market.lockRenewalMs + 1_000);
    expect(await store.claim(eod, later)).toMatchObject({
      status: 'claimed',
      claim: { attempt: 2 },
    });
    expect((await rowOf(eod)).startedAt).toEqual(later);
  });

  it('um RUNNING recente ainda é de quem está trabalhando: busy', async () => {
    await store.claim(eod);
    await prisma.jobRun.updateMany({
      data: { startedAt: new Date(Date.now() - QUEUES.market.lockRenewalMs + 60_000) },
    });
    expect(await store.claim(eod)).toEqual({ status: 'busy' });
  });

  it('dez entregas simultâneas da mesma mensagem: só uma assume', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => store.claim(eod)));
    expect(results.filter((r) => r.status === 'claimed')).toHaveLength(1);
    expect(results.filter((r) => r.status === 'busy')).toHaveLength(9);
    expect(await prisma.jobRun.count()).toBe(1);
  });

  it('dez entregas simultâneas sobre uma falha: só uma reassume', async () => {
    const first = await store.claim(eod);
    if (first.status !== 'claimed') throw new Error('devia assumir');
    await store.fail(first.claim, 'falhou');
    const results = await Promise.all(Array.from({ length: 10 }, () => store.claim(eod)));
    expect(results.filter((r) => r.status === 'claimed')).toHaveLength(1);
    expect((await rowOf(eod)).attempts).toBe(2);
  });

  it('o dono antigo, que perdeu a mensagem por travar, não apaga o trabalho do novo dono', async () => {
    const old = await store.claim(eod);
    if (old.status !== 'claimed') throw new Error('devia assumir');
    await prisma.jobRun.updateMany({
      data: { startedAt: new Date(Date.now() - QUEUES.market.lockRenewalMs - 1_000) },
    });
    const current = await store.claim(eod);
    if (current.status !== 'claimed') throw new Error('devia assumir');

    await store.succeed(old.claim); // chega tarde: a tentativa 1 já não é a dona
    await store.fail(old.claim, 'tarde demais');
    expect(await rowOf(eod)).toMatchObject({ status: 'RUNNING', attempts: 2, error: null });

    await store.succeed(current.claim);
    expect(await rowOf(eod)).toMatchObject({ status: 'SUCCEEDED', attempts: 2 });
  });

  it('a mesma chave em tipos diferentes convive (eod e freeze do mesmo pregão)', async () => {
    expect(await store.claim(eod)).toMatchObject({ status: 'claimed' });
    expect(await store.claim(freeze)).toMatchObject({ status: 'claimed' });
    expect(await prisma.jobRun.count()).toBe(2);
  });

  it('guarda o erro com emoji e aspas, cortado em 2000 caracteres', async () => {
    const first = await store.claim(eod);
    if (first.status !== 'claimed') throw new Error('devia assumir');
    await store.fail(
      first.claim,
      new Error(`falha 📉 "quase" '; DROP TABLE job_run;-- ${'x'.repeat(5000)}`),
    );
    const { error } = await rowOf(eod);
    expect(error).toHaveLength(2000);
    expect(error?.startsWith(`falha 📉 "quase" '; DROP TABLE job_run;--`)).toBe(true);
  });

  // reopen: pedir de novo o que já foi tratado (a liquidação refeita porque o dado mudou). A mensagem repetida da fila não passa
  // por aqui: continua barrada pela linha SUCCEEDED.
  describe('reopen: a mensagem tratada volta a ser tratável', () => {
    it('a linha concluída vira FAILED com o motivo, e a próxima entrega a reassume como nova tentativa', async () => {
      const first = await store.claim(eod);
      if (first.status !== 'claimed') throw new Error('devia assumir');
      await store.succeed(first.claim);
      expect(await store.claim(eod)).toEqual({ status: 'done' });

      await expect(store.reopen(eod, 'barras de 2026-10-30 corrigidas')).resolves.toBe(true);
      expect(await rowOf(eod)).toMatchObject({
        status: 'FAILED',
        error: 'barras de 2026-10-30 corrigidas',
      });
      expect(await store.claim(eod)).toMatchObject({ status: 'claimed', claim: { attempt: 2 } });
    });

    it('sem a mensagem tratada não há o que reabrir: nenhuma linha é criada', async () => {
      await expect(store.reopen(eod, 'nada')).resolves.toBe(false);
      expect(await prisma.jobRun.count()).toBe(0);
    });

    it('só a mensagem pedida: o mesmo pregão em outro tipo de mensagem fica como está', async () => {
      for (const message of [eod, freeze]) {
        const claimed = await store.claim(message);
        if (claimed.status !== 'claimed') throw new Error('devia assumir');
        await store.succeed(claimed.claim);
      }
      await store.reopen(eod, 'só o eod');
      expect(await prisma.jobRun.findFirstOrThrow({ where: { type: 'freeze' } })).toMatchObject({
        status: 'SUCCEEDED',
      });
    });

    it('uma linha em processamento também: o dono antigo perde a posse, e quem assume depois refaz com o dado novo', async () => {
      const old = await store.claim(eod);
      if (old.status !== 'claimed') throw new Error('devia assumir');
      await store.reopen(eod, 'dado novo');

      await store.succeed(old.claim); // o dono antigo termina tarde: a linha já não é dele
      expect(await rowOf(eod)).toMatchObject({ status: 'FAILED', attempts: 1 });
      const current = await store.claim(eod);
      if (current.status !== 'claimed') throw new Error('devia assumir');
      expect(current.claim.attempt).toBe(2);
      await store.succeed(current.claim);
      expect(await rowOf(eod)).toMatchObject({ status: 'SUCCEEDED', attempts: 2 });
    });

    it('corta o motivo para caber na coluna', async () => {
      const first = await store.claim(eod);
      if (first.status !== 'claimed') throw new Error('devia assumir');
      await store.succeed(first.claim);
      await store.reopen(eod, 'y'.repeat(5000));
      expect((await rowOf(eod)).error).toHaveLength(2000);
    });
  });
});
