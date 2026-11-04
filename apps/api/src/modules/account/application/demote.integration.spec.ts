import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../common/id.js';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import {
  integrationTitle,
  openTestDatabase,
  testDatabaseUrl,
} from '../../../infrastructure/database/test-database.fixture.js';
import { demoteFromAdmin } from './demote.js';
import { promoteToAdmin } from './promote.js';

// O comando account:demote <e-mail> (docs/CONTA.md, seção 4): rebaixa o admin a usuário, encerra as sessões dele e grava a auditoria.
// A etapa 10 o cria ANTES de abrir as rotas /admin: sem ele não haveria como tirar o papel nem derrubar a sessão de um admin.
describe.skipIf(!testDatabaseUrl)(integrationTitle('demoteFromAdmin (account:demote)'), () => {
  let prisma: PrismaService;

  beforeAll(async () => {
    prisma = await openTestDatabase(testDatabaseUrl!);
  }, 120_000);

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.user.deleteMany({ where: { email: { endsWith: '@demote.example.test' } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { endsWith: '@demote.example.test' } } });
    await prisma.auditLog.deleteMany();
    await prisma.onModuleDestroy();
  });

  let counter = 0;
  async function user(role: 'USER' | 'ADMIN', sessions = 2) {
    counter += 1;
    const id = newId();
    const email = `pessoa-${counter}-${id.toLowerCase()}@demote.example.test`;
    await prisma.user.create({
      data: { id, name: 'Pessoa de Teste', email, emailVerified: true, role },
    });
    for (let i = 0; i < sessions; i++) {
      await prisma.session.create({
        data: {
          id: newId(),
          userId: id,
          token: `token-sintetico-${id}-${i}`,
          expiresAt: new Date(Date.now() + 86_400_000),
        },
      });
    }
    return { id, email };
  }

  it('rebaixa o admin, encerra TODAS as sessões dele e grava a auditoria só com o ULID', async () => {
    const admin = await user('ADMIN', 3);
    const other = await user('USER', 1);

    const result = await demoteFromAdmin(prisma, admin.email.toUpperCase());

    expect(result).toEqual({ userId: admin.id, changed: true, sessionsEnded: 3 });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).role).toBe('USER');
    expect(await prisma.session.count({ where: { userId: admin.id } })).toBe(0);
    // a sessão de outra pessoa não é tocada
    expect(await prisma.session.count({ where: { userId: other.id } })).toBe(1);

    const audit = await prisma.auditLog.findMany({ where: { action: 'account.demoted' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor: 'cli',
      target: admin.id,
      detail: { role: 'USER', sessionsEnded: 3 },
    });
    expect(JSON.stringify(audit)).not.toContain(admin.email);
  });

  it('é idempotente: repetir não muda nada, não grava de novo e não derruba a sessão de um usuário comum', async () => {
    const admin = await user('ADMIN', 1);
    await demoteFromAdmin(prisma, admin.email);
    // a pessoa entrou de novo depois de rebaixada: o segundo comando não a desloga
    await prisma.session.create({
      data: {
        id: newId(),
        userId: admin.id,
        token: `token-sintetico-novo-${admin.id}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    const again = await demoteFromAdmin(prisma, admin.email);
    expect(again).toEqual({ userId: admin.id, changed: false, sessionsEnded: 0 });
    expect(await prisma.session.count({ where: { userId: admin.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: 'account.demoted' } })).toBe(1);
  });

  it('usuário comum: nada muda, nem a sessão', async () => {
    const common = await user('USER', 2);
    expect(await demoteFromAdmin(prisma, common.email)).toEqual({
      userId: common.id,
      changed: false,
      sessionsEnded: 0,
    });
    expect(await prisma.session.count({ where: { userId: common.id } })).toBe(2);
    expect(await prisma.auditLog.count()).toBe(0);
  });

  it('promover e rebaixar de novo é um ciclo: cada passo deixa a sua linha', async () => {
    const admin = await user('USER', 1);
    await promoteToAdmin(prisma, admin.email);
    await demoteFromAdmin(prisma, admin.email);
    const actions = (await prisma.auditLog.findMany({ orderBy: { id: 'asc' } })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(['account.promoted', 'account.demoted']);
  });

  it('a execução do job do Container Apps (quem rodou o comando na Azure) entra no detalhe da auditoria, e no promote também', async () => {
    const admin = await user('USER', 0);
    await promoteToAdmin(prisma, admin.email, { execution: 'job-migrate-ab12cd3' });
    await demoteFromAdmin(prisma, admin.email, { execution: 'job-migrate-ef45gh6' });
    const rows = await prisma.auditLog.findMany({ orderBy: { id: 'asc' } });
    expect(rows.map((r) => r.detail)).toEqual([
      { role: 'ADMIN', execution: 'job-migrate-ab12cd3' },
      { role: 'USER', sessionsEnded: 0, execution: 'job-migrate-ef45gh6' },
    ]);
  });

  it('e-mail que não existe: erro claro, sem repetir o endereço', async () => {
    const error = await demoteFromAdmin(prisma, 'ninguem@demote.example.test').catch(
      (e: Error) => e,
    );
    expect((error as Error).message).toMatch(/não encontrado/i);
    expect((error as Error).message).not.toContain('ninguem@demote.example.test');
  });

  it.each(['', 'sem-arroba', 'a@b'])('argumento inválido (%j): erro', async (value) => {
    await expect(demoteFromAdmin(prisma, value)).rejects.toThrow(/e-mail/i);
  });

  it('se a auditoria falha, o papel e as sessões ficam como estavam (uma transação só)', async () => {
    const admin = await user('ADMIN', 2);
    await expect(demoteFromAdmin(prisma, admin.email, { execution: '\u0000' })).rejects.toThrow();
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).role).toBe('ADMIN');
    expect(await prisma.session.count({ where: { userId: admin.id } })).toBe(2);
  });
});
