import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseEnv } from '../../../config/env.js';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import {
  integrationTitle,
  openTestDatabase,
  testDatabaseUrl,
} from '../../../infrastructure/database/test-database.fixture.js';
import { BrapiLock } from './brapi.lock.js';

// Uma requisição por vez na conta da brapi, entre réplicas do worker-data e a carga manual: duas réplicas são dois PrismaService (dois pools,
// duas conexões) dividindo o mesmo Postgres.
describe.skipIf(!testDatabaseUrl)(integrationTitle('BrapiLock'), () => {
  let first: PrismaService;
  let second: PrismaService;

  beforeAll(async () => {
    first = await openTestDatabase(testDatabaseUrl!);
    second = new PrismaService(parseEnv({ DATABASE_URL: testDatabaseUrl! }));
  }, 120_000);

  afterAll(async () => {
    await first.onModuleDestroy();
    await second.onModuleDestroy();
  });

  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  it('requisições de duas réplicas ao mesmo tempo rodam uma por vez, nunca duas juntas', async () => {
    const locks = [new BrapiLock(first), new BrapiLock(second)];
    let active = 0;
    let peak = 0;
    const order: number[] = [];
    const task = (n: number) => async () => {
      active += 1;
      peak = Math.max(peak, active);
      await pause(25);
      order.push(n);
      active -= 1;
      return n;
    };
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, n) => locks[n % 2]!.run(task(n))),
    );
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(1);
    expect(order).toHaveLength(8);
  });

  it('a tarefa que falha solta a trava: a seguinte roda, e o erro sobe para quem pediu', async () => {
    const lock = new BrapiLock(first);
    await expect(
      lock.run(() => Promise.reject(new Error('rede caiu no meio da requisição'))),
    ).rejects.toThrow('rede caiu');
    await expect(new BrapiLock(second).run(() => Promise.resolve('seguinte'))).resolves.toBe(
      'seguinte',
    );
  });
});
