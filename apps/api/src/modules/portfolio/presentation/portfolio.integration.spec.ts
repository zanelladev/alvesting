import {
  PORTFOLIO_LIMITS,
  envelopeSchema,
  lotDeletedSchema,
  lotSchema,
  meSchema,
  portfolioSchema,
  type Lot,
  type Portfolio,
} from '@alvesting/contracts';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { newId } from '../../../common/id.js';
import {
  integrationTitle,
  openApiTestDatabase,
  openTestDatabase,
  testDatabaseUrl,
} from '../../../infrastructure/database/test-database.fixture.js';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import {
  asSite,
  createLoggedInUser,
  startAccountApp,
  type AccountApp,
} from '../../account/testing/account-app.fixture.js';
import { ConsentGuard } from '../../account/presentation/consent.guard.js';
import { SessionGuard } from '../../account/presentation/session.guard.js';
import { brasiliaDate } from '../../market-data/domain/dates.js';
import { PortfolioModule } from '../portfolio.module.js';
import { PortfolioController } from './portfolio.controller.js';

// As rotas /api/v1/me/portfolio (etapa 12; docs/API.md, seção 9), de ponta a ponta: a api de verdade (Better Auth, guards, o módulo da
// carteira), com o login de MENOR PRIVILÉGIO do Postgres (ADR 0028: o banco recusa o que a api não pode) e dois usuários. Tudo sintético:
// e-mails @example.test, tickers de teste (TCR*) e números inventados.
beforeAll(() => {
  Logger.overrideLogger(false);
});

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const TODAY = brasiliaDate(new Date());
const tomorrow = () => brasiliaDate(new Date(Date.now() + 86_400_000 * 1.5));

// A resposta no envelope, validada pelo schema do contrato (o mesmo que o site usa): lança se for erro ou se sair do formato.
const envelope = <S extends z.ZodType>(schema: S, body: unknown): z.output<S> => {
  const parsed = envelopeSchema(schema).parse(body) as {
    success: boolean;
    data: z.output<S>;
    error: unknown;
  };
  if (!parsed.success) throw new Error(`a resposta é um erro: ${JSON.stringify(parsed.error)}`);
  return parsed.data;
};

// Os papéis do preço: o custo de 100 ações a R$ 35,50 cada, nos dois modos
const UNIT = {
  ticker: 'TCRA3',
  quantity: 100,
  mode: 'unit',
  valueCents: 3_550,
  boughtOn: '2026-10-15',
};
const TOTAL = { ...UNIT, mode: 'total', valueCents: 355_000 };

describe.skipIf(!testDatabaseUrl)(integrationTitle('As rotas /me/portfolio'), () => {
  // `prisma` é o administrador (semeia e confere); `apiPrisma` é o login de MENOR PRIVILÉGIO da api, com o qual a api sob teste atende as rotas
  let prisma: PrismaService;
  let apiPrisma: PrismaService;
  let account: AccountApp;
  let a: Awaited<ReturnType<typeof createLoggedInUser>>;
  let b: Awaited<ReturnType<typeof createLoggedInUser>>;
  const instrumentIds: string[] = [];

  async function seedInstrument(
    ticker: string,
    kind: 'STOCK' | 'REFERENCE',
    bars: Array<[string, number]>,
  ) {
    const id = newId();
    instrumentIds.push(id);
    await prisma.instrument.create({
      data: {
        id,
        ticker,
        name: `EMPRESA ${ticker}`,
        spec: 'ON',
        kind,
        lastSeen: day('2026-11-03'),
      },
    });
    for (const [date, closeCents] of bars) {
      await prisma.dailyBar.create({
        data: {
          id: newId(),
          instrumentId: id,
          date: day(date),
          openCents: BigInt(closeCents),
          highCents: BigInt(closeCents),
          lowCents: BigInt(closeCents),
          closeCents: BigInt(closeCents),
          volumeCents: 1_000_000n,
          source: 'BRAPI',
        },
      });
    }
    return id;
  }

  beforeAll(async () => {
    prisma = await openTestDatabase(testDatabaseUrl!);
    apiPrisma = await openApiTestDatabase(testDatabaseUrl!);
    // limpa o que um teste interrompido deixou
    await prisma.dailyBar.deleteMany({ where: { instrument: { ticker: { startsWith: 'TCR' } } } });
    await prisma.instrument.deleteMany({ where: { ticker: { startsWith: 'TCR' } } });
    // TCRA3: a barra mais recente (03/11) é a que vale; TCRB4: o fechamento caiu; TCRC3: sem barra; TREF11: referência, não é ação
    await seedInstrument('TCRA3', 'STOCK', [
      ['2026-10-30', 3_700],
      ['2026-11-03', 3_800],
    ]);
    await seedInstrument('TCRB4', 'STOCK', [
      ['2026-10-29', 2_000],
      ['2026-11-02', 1_050],
    ]);
    await seedInstrument('TCRC3', 'STOCK', []);
    await seedInstrument('TREF11', 'REFERENCE', [['2026-11-03', 12_000]]);
    // TCRE3: barra absurda (10^15 centavos, dado ruim, o daily_bar só exige close_cents >= 0); TCRF3: fechamento de R$ 10.000,00, que com
    // 1 centavo de custo tira o percentual do inteiro seguro
    await seedInstrument('TCRE3', 'STOCK', [['2026-11-03', 10 ** 15]]);
    await seedInstrument('TCRF3', 'STOCK', [['2026-11-03', 1_000_000]]);

    account = await startAccountApp(apiPrisma, { extraImports: [PortfolioModule] });
    a = await createLoggedInUser(account, prisma);
    b = await createLoggedInUser(account, prisma);
  }, 120_000);

  afterAll(async () => {
    await account?.stop();
    await prisma?.user.deleteMany({ where: { email: { endsWith: '@example.test' } } });
    await prisma?.dailyBar.deleteMany({ where: { instrumentId: { in: instrumentIds } } });
    await prisma?.instrument.deleteMany({ where: { id: { in: instrumentIds } } });
    await prisma?.verification.deleteMany();
    await prisma?.auditLog.deleteMany({ where: { action: { startsWith: 'account.' } } });
    await apiPrisma?.onModuleDestroy();
    await prisma?.onModuleDestroy();
  });

  // --- ajudantes -------------------------------------------------------------------------------------------------------
  type Who = { agent: ReturnType<AccountApp['agent']> };
  const get = (who: Who, path = '') => who.agent.get(`/api/v1/me/portfolio${path}`);
  const post = (who: Who, body: unknown) =>
    asSite(who.agent.post('/api/v1/me/portfolio/lots')).send(body as object);
  const patch = (who: Who, id: string, body: unknown) =>
    asSite(who.agent.patch(`/api/v1/me/portfolio/lots/${id}`)).send(body as object);
  const del = (who: Who, id: string) => asSite(who.agent.delete(`/api/v1/me/portfolio/lots/${id}`));
  const lotsOf = (userId: string) =>
    prisma.portfolioLot.findMany({ where: { portfolio: { userId } }, orderBy: { id: 'asc' } });
  const created = async (who: Who, body: unknown): Promise<Lot> => {
    const res = await post(who, body);
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return envelope(lotSchema, res.body);
  };
  const load = async (who: Who): Promise<Portfolio> =>
    envelope(portfolioSchema, (await get(who)).body);

  // Uma carteira sem nada do que outros testes deixaram: cada teste usa um usuário só dele quando conta linhas.
  const freshUser = () => createLoggedInUser(account, prisma);

  describe('sessão, origem e aceite', () => {
    const SOME = '01JZZZZZZZZZZZZZZZZZZZZZZZ';
    it.each([
      ['GET', '/api/v1/me/portfolio'],
      ['POST', '/api/v1/me/portfolio/lots'],
      ['PATCH', `/api/v1/me/portfolio/lots/${SOME}`],
      ['DELETE', `/api/v1/me/portfolio/lots/${SOME}`],
    ])('%s %s sem sessão: 401 no envelope, sem cache', async (method, path) => {
      const res = await asSite(account.http()[method.toLowerCase() as 'get'](path)).send(UNIT);
      expect(res.status).toBe(401);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toMatchObject({
        success: false,
        data: null,
        error: { code: 'UNAUTHORIZED' },
      });
    });

    it('as mutações pedem a origem do site: sem Origin ou com Origin de fora, 403, e nada é gravado', async () => {
      const user = await freshUser();
      for (const origin of [undefined, 'https://outro-site.example.test']) {
        const withOrigin = <T extends { set: (k: string, v: string) => T }>(req: T) =>
          origin ? req.set('Origin', origin) : req;
        const posted = await withOrigin(user.agent.post('/api/v1/me/portfolio/lots')).send(UNIT);
        expect(posted.status, String(origin)).toBe(403);
        expect(posted.body).toMatchObject({ success: false, error: { code: 'FORBIDDEN' } });
        expect(
          (await withOrigin(user.agent.patch(`/api/v1/me/portfolio/lots/${SOME}`)).send(UNIT))
            .status,
        ).toBe(403);
        expect(
          (await withOrigin(user.agent.delete(`/api/v1/me/portfolio/lots/${SOME}`))).status,
        ).toBe(403);
      }
      expect(await lotsOf(user.userId)).toEqual([]);
    });

    it('os guards da classe, nesta ordem: a sessão (que confere o Origin) e depois o aceite dos termos; nenhuma rota fica de fora', () => {
      expect(Reflect.getMetadata(GUARDS_METADATA, PortfolioController)).toEqual([
        SessionGuard,
        ConsentGuard,
      ]);
      // nenhuma rota do controlador sobrescreve a lista de guards (uma rota nova nasce atrás dos dois)
      const proto = PortfolioController.prototype as unknown as Record<string, unknown>;
      const handlers = Object.getOwnPropertyNames(proto).filter(
        (name) => name !== 'constructor' && typeof proto[name] === 'function',
      );
      expect(handlers.length).toBeGreaterThanOrEqual(4);
      for (const name of handlers) {
        expect(Reflect.getMetadata(GUARDS_METADATA, proto[name] as object), name).toBeUndefined();
        expect(Reflect.getMetadata(PATH_METADATA, proto[name] as object), name).toBeDefined();
      }
    });

    // Quem aceitou os textos de antes fica sem a carteira até aceitar os vigentes: a 0.1 (os da conta, etapa 11) e a 0.2 (os que descrevem a
    // carteira, etapa 12; a política foi para a 0.3 em 04/11/2026, com o pior caso da limpeza diária, e os termos seguem na 0.2). As rotas dos
    // direitos do titular (GET /me, exportar e excluir) não dependem do aceite novo. Os hashes são os congelados em legal-documents.spec.ts.
    const OLD_TEXTS = {
      '0.1 (a da conta)': {
        TERMS: {
          version: '0.1',
          sha256: '8b7dce70705a94a18cde089b1dbc241d0a1fd92b3d954eecb74db828a104b221',
        },
        PRIVACY: {
          version: '0.1',
          sha256: 'e1568adee4a666bd0bd0c68ab490ba59aeb721124b1b30315d7be9c09ecf93b4',
        },
      },
      '0.2 (a da carteira)': {
        TERMS: {
          version: '0.2',
          sha256: '54c7213262ea7215a922bbb000023240f09527a2f77640bd5f8dc0dd63622133',
        },
        PRIVACY: {
          version: '0.2',
          sha256: 'cef4099255991531928b40d9ec2afeeb628949f5cb14be31a5db51fdc717ef4c',
        },
      },
    } as const;

    it.each(Object.keys(OLD_TEXTS) as Array<keyof typeof OLD_TEXTS>)(
      'quem aceitou os textos %s recebe 403 CONSENT_REQUIRED em todas as rotas da carteira até aceitar os vigentes',
      async (which) => {
        const vigentes = account.docs.map((doc) => ({ ...doc }));
        const antigos = OLD_TEXTS[which];
        // o usuário nasce quando as versões vigentes ainda eram aquelas
        account.docs.forEach((doc, index) => {
          account.docs[index] = { ...doc, ...antigos[doc.document] };
        });
        let old: Awaited<ReturnType<typeof createLoggedInUser>>;
        try {
          old = await freshUser();
        } finally {
          vigentes.forEach((doc, index) => {
            account.docs[index] = doc;
          });
        }
        // o teste só vale se ao menos um dos textos vigentes é outro (a política 0.3 ou, para a 0.1, os dois)
        expect(vigentes.some((doc) => doc.version !== antigos[doc.document].version)).toBe(true);

        const me = envelope(meSchema, (await old.agent.get('/api/v1/me')).body);
        expect(me.consent.upToDate).toBe(false);
        // quem aceitou a 0.2 só precisa aceitar de novo a política (a 0.3): os termos, que não mudaram, seguem aceitos
        const accepted = (document: 'TERMS' | 'PRIVACY') =>
          me.consent.documents.find((doc) => doc.document === document)!.acceptedAt !== null;
        expect(accepted('PRIVACY')).toBe(false);
        expect(accepted('TERMS')).toBe(which === '0.2 (a da carteira)');

        const blocked = [
          await get(old),
          await post(old, UNIT),
          await patch(old, newId(), UNIT),
          await del(old, newId()),
        ];
        for (const res of blocked) {
          expect(res.status).toBe(403);
          expect(res.body).toMatchObject({ success: false, error: { code: 'CONSENT_REQUIRED' } });
          expect(res.headers['cache-control']).toBe('no-store');
        }
        expect(await lotsOf(old.userId)).toEqual([]);
        // exportar e excluir seguem abertos
        expect((await old.agent.get('/api/v1/me/export')).status).toBe(200);

        // aceitar os textos vigentes reabre
        expect(
          (await asSite(old.agent.post('/api/v1/me/consents')).send(account.consent())).status,
        ).toBe(200);
        expect((await get(old)).status).toBe(200);
        expect((await post(old, UNIT)).status).toBe(201);
      },
    );
  });

  describe('GET /api/v1/me/portfolio', () => {
    it('a carteira vazia: nada, o custo zero e os totais nulos; não cria a linha da carteira, e sai sem cache', async () => {
      const user = await freshUser();
      const res = await get(user);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(envelope(portfolioSchema, res.body)).toEqual({
        lots: [],
        positions: [],
        totals: {
          costCents: 0,
          pricedCostCents: 0,
          valueCents: null,
          pnlCents: null,
          pnlBps: null,
          unpriced: 0,
        },
      });
      expect(await prisma.portfolio.count({ where: { userId: user.userId } })).toBe(0);
    });

    // O dono é sempre a sessão, e o parâmetro desconhecido nunca vira chave de cache: vale nas QUATRO rotas, e a escrita recusada não toca no
    // lançamento (CLAUDE.md: parâmetro de query é 400 em toda rota da carteira).
    it('parâmetro de query é 400 nas quatro rotas (GET, POST, PATCH e DELETE), sem cache, e o lançamento fica como estava', async () => {
      const user = await freshUser();
      const lot = await created(user, UNIT);
      const before = (await lotsOf(user.userId))[0]!;
      for (const query of [`?userId=${b.userId}`, '?x=1', '?x=a&x=b']) {
        const responses: Array<[string, Awaited<ReturnType<typeof get>>]> = [
          ['GET', await get(user, query)],
          ['POST', await asSite(user.agent.post(`/api/v1/me/portfolio/lots${query}`)).send(UNIT)],
          [
            'PATCH',
            await asSite(user.agent.patch(`/api/v1/me/portfolio/lots/${lot.id}${query}`)).send({
              ...UNIT,
              quantity: 1,
            }),
          ],
          [
            'DELETE',
            await asSite(user.agent.delete(`/api/v1/me/portfolio/lots/${lot.id}${query}`)),
          ],
        ];
        for (const [method, res] of responses) {
          expect(res.status, `${method} ${query}`).toBe(400);
          expect(res.headers['cache-control'], `${method} ${query}`).toBe('no-store');
          expect(res.body, `${method} ${query}`).toMatchObject({
            success: false,
            error: { code: 'VALIDATION_ERROR' },
          });
        }
      }
      expect(await lotsOf(user.userId)).toEqual([before]);
    });

    it('lançamentos e posições: preço médio, o último fechamento (a barra mais recente) com a data, valor de mercado e P&L, exatos', async () => {
      const user = await freshUser();
      // TCRA3: dois lançamentos (um por ação, outro pelo total) -> 150 ações, custo R$ 5.550,01; TCRB4: perde; TCRC3: sem barra
      const first = await created(user, UNIT);
      const second = await created(user, {
        ticker: 'TCRA3',
        quantity: 50,
        mode: 'total',
        valueCents: 200_001,
        boughtOn: '2026-10-20',
      });
      const lost = await created(user, {
        ticker: 'TCRB4',
        quantity: 10,
        mode: 'unit',
        valueCents: 2_000,
      });
      const unpriced = await created(user, {
        ticker: 'TCRC3',
        quantity: 7,
        mode: 'total',
        valueCents: 7_001,
      });

      const portfolio = await load(user);
      // pela data da compra, do mais recente ao mais antigo; sem data, no fim (e entre eles, o criado por último primeiro)
      expect(portfolio.lots.map((lot) => lot.id)).toEqual([
        second.id,
        first.id,
        unpriced.id,
        lost.id,
      ]);
      expect(portfolio.positions).toEqual([
        {
          ticker: 'TCRA3',
          quantity: 150,
          costCents: 555_001,
          // 555.001 ÷ 150 = 3.700,0066...
          avgPriceCents: 3_700,
          closeCents: 3_800,
          closeDate: '2026-11-03',
          valueCents: 570_000,
          pnlCents: 14_999,
          pnlBps: 270,
        },
        {
          ticker: 'TCRB4',
          quantity: 10,
          costCents: 20_000,
          avgPriceCents: 2_000,
          closeCents: 1_050,
          closeDate: '2026-11-02',
          valueCents: 10_500,
          pnlCents: -9_500,
          pnlBps: -4_750,
        },
        {
          ticker: 'TCRC3',
          quantity: 7,
          costCents: 7_001,
          avgPriceCents: 1_000,
          closeCents: null,
          closeDate: null,
          valueCents: null,
          pnlCents: null,
          pnlBps: null,
        },
      ]);
      expect(portfolio.totals).toEqual({
        costCents: 555_001 + 20_000 + 7_001,
        pricedCostCents: 555_001 + 20_000,
        valueCents: 570_000 + 10_500,
        pnlCents: 570_000 + 10_500 - 555_001 - 20_000,
        // 5.499 × 10.000 ÷ 575.001 = 95,6...
        pnlBps: 96,
        unpriced: 1,
      });
    });

    it('uma consulta só para as barras da carteira inteira, e não uma por ticker', async () => {
      const user = await freshUser();
      for (const ticker of ['TCRA3', 'TCRB4', 'TCRC3']) {
        await created(user, { ticker, quantity: 1, mode: 'total', valueCents: 1_000 });
      }
      const spy = vi.spyOn(apiPrisma, '$queryRaw');
      try {
        expect((await get(user)).status).toBe(200);
        expect(spy).toHaveBeenCalledTimes(1);
      } finally {
        spy.mockRestore();
      }
    });

    it('a resposta não leva o id do usuário nem o da carteira, nem coluna que o contrato não tem', async () => {
      const user = await freshUser();
      await created(user, UNIT);
      const res = await get(user);
      expect(res.text).not.toContain(user.userId);
      const portfolioId = (
        await prisma.portfolio.findFirstOrThrow({ where: { userId: user.userId } })
      ).id;
      expect(res.text).not.toContain(portfolioId);
      expect(res.text).not.toMatch(/"(userId|portfolioId|user_id|portfolio_id)"/);
    });

    it('um ticker que saiu de instrument não trava a limpeza dele (sem chave estrangeira) e a posição sai sem fechamento', async () => {
      const user = await freshUser();
      const id = await seedInstrument('TCRD3', 'STOCK', [['2026-11-03', 500]]);
      await created(user, { ticker: 'TCRD3', quantity: 4, mode: 'unit', valueCents: 400 });
      expect((await load(user)).positions[0]).toMatchObject({ ticker: 'TCRD3', closeCents: 500 });

      await prisma.dailyBar.deleteMany({ where: { instrumentId: id } });
      await prisma.instrument.delete({ where: { id } });
      const after = await load(user);
      expect(after.positions).toHaveLength(1);
      expect(after.positions[0]).toMatchObject({
        ticker: 'TCRD3',
        costCents: 1_600,
        closeCents: null,
        valueCents: null,
        pnlCents: null,
      });
      expect(after.totals.unpriced).toBe(1);
    });

    // Dado ruim no `daily_bar` não derruba a leitura de quem tem o papel: era um 500 (RangeError do inteiro seguro) para todo detentor.
    it('uma barra absurda (acima de R$ 450.000,00) deixa só aquela posição sem fechamento: o GET segue 200 e o resto da carteira vale', async () => {
      const user = await freshUser();
      await created(user, UNIT);
      await created(user, { ticker: 'TCRE3', quantity: 1_000_000, mode: 'total', valueCents: 1 });
      const res = await get(user);
      expect(res.status).toBe(200);
      const portfolio = envelope(portfolioSchema, res.body);
      expect(portfolio.positions.map((p) => [p.ticker, p.closeCents])).toEqual([
        ['TCRA3', 3_800],
        ['TCRE3', null],
      ]);
      expect(portfolio.totals).toMatchObject({ valueCents: 380_000, unpriced: 1 });
    });

    it('o percentual que passa do inteiro seguro sai nulo, e o GET segue 200 com o valor e o P&L em centavos exatos', async () => {
      const user = await freshUser();
      await created(user, { ticker: 'TCRF3', quantity: 1_000_000, mode: 'total', valueCents: 1 });
      const res = await get(user);
      expect(res.status).toBe(200);
      const portfolio = envelope(portfolioSchema, res.body);
      expect(portfolio.positions[0]).toMatchObject({
        ticker: 'TCRF3',
        closeCents: 1_000_000,
        valueCents: 1_000_000_000_000,
        pnlCents: 999_999_999_999,
        pnlBps: null,
      });
      expect(portfolio.totals).toMatchObject({ valueCents: 1_000_000_000_000, pnlBps: null });
    });
  });

  describe('POST /api/v1/me/portfolio/lots', () => {
    it('cria o lançamento no modo "preço por ação": 201, o custo é quantidade × preço, e o dono é o da sessão', async () => {
      const user = await freshUser();
      const res = await post(user, UNIT);
      expect(res.status).toBe(201);
      expect(res.headers['cache-control']).toBe('no-store');
      const lot = envelope(lotSchema, res.body);
      expect(lot).toMatchObject({
        ticker: 'TCRA3',
        quantity: 100,
        costCents: 355_000,
        boughtOn: '2026-10-15',
      });
      expect(lot.createdAt).toBe(lot.updatedAt);
      const rows = await lotsOf(user.userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: lot.id,
        ticker: 'TCRA3',
        quantity: 100,
        costCents: 355_000n,
      });
      expect(rows[0]!.boughtOn?.toISOString().slice(0, 10)).toBe('2026-10-15');
      expect((await prisma.portfolio.findFirstOrThrow({ where: { userId: user.userId } })).id).toBe(
        rows[0]!.portfolioId,
      );
    });

    // Aceite da etapa 12: os dois modos geram o mesmo custo total para os mesmos números.
    it('os dois modos de preço gravam o mesmo custo total para os mesmos números', async () => {
      const user = await freshUser();
      const pairs: Array<[number, number]> = [
        [100, 3_550],
        [1, 1],
        [3, 3_333],
        [250, 1_999],
        [999_999, 100_000],
        [1_000_000, 100_000],
        [12_345, 8_765],
      ];
      for (const [quantity, price] of pairs) {
        const unit = await created(user, {
          ticker: 'TCRA3',
          quantity,
          mode: 'unit',
          valueCents: price,
        });
        const total = await created(user, {
          ticker: 'TCRA3',
          quantity,
          mode: 'total',
          valueCents: quantity * price,
        });
        expect(unit.costCents, `${quantity} × ${price}`).toBe(quantity * price);
        expect(total.costCents, `${quantity} total`).toBe(unit.costCents);
      }
      const rows = await lotsOf(user.userId);
      expect(rows).toHaveLength(pairs.length * 2);
      for (let i = 0; i < rows.length; i += 2) {
        expect(rows[i]!.costCents, `par ${i / 2}`).toBe(rows[i + 1]!.costCents);
      }
    });

    it('o ticker em minúsculas é aceito e gravado em maiúsculas; a data é opcional', async () => {
      const user = await freshUser();
      const lot = await created(user, {
        ticker: 'tcra3',
        quantity: 5,
        mode: 'total',
        valueCents: 1_000,
      });
      expect(lot).toMatchObject({ ticker: 'TCRA3', boughtOn: null });
      expect(
        (
          await created(user, {
            ticker: 'TCRA3',
            quantity: 5,
            mode: 'total',
            valueCents: 1_000,
            boughtOn: null,
          })
        ).boughtOn,
      ).toBeNull();
      expect((await created(user, { ...UNIT, boughtOn: TODAY })).boughtOn).toBe(TODAY);
    });

    it('o dono vem sempre da sessão: o corpo não aceita id de usuário, de carteira nem de lançamento, e nada é gravado', async () => {
      const user = await freshUser();
      for (const extra of [
        { userId: b.userId },
        { user_id: b.userId },
        { portfolioId: newId() },
        { id: newId() },
        { costCents: 1 },
        { owner: 'b' },
      ]) {
        const res = await post(user, { ...UNIT, ...extra });
        expect(res.status, JSON.stringify(extra)).toBe(400);
        expect(res.body).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
      }
      expect(
        (await asSite(user.agent.post(`/api/v1/me/portfolio/lots?userId=${b.userId}`)).send(UNIT))
          .status,
      ).toBe(400);
      expect(await lotsOf(user.userId)).toEqual([]);
      expect(await lotsOf(b.userId)).toEqual([]);
    });

    it.each([
      ['sem o ticker', { ticker: undefined }],
      ['ticker com lixo', { ticker: "TCRA3'; DROP TABLE portfolio_lot;--" }],
      ['ticker curto', { ticker: 'TC3' }],
      ['ticker que não é texto', { ticker: 3 }],
      ['quantidade zero', { quantity: 0 }],
      ['quantidade negativa', { quantity: -1 }],
      ['quantidade fracionada', { quantity: 1.5 }],
      ['quantidade acima do teto', { quantity: PORTFOLIO_LIMITS.maxQuantity + 1 }],
      ['quantidade em texto', { quantity: '100' }],
      ['valor zero', { valueCents: 0 }],
      ['valor negativo', { valueCents: -1 }],
      ['valor fracionado', { valueCents: 35.5 }],
      ['valor em texto', { valueCents: '3550' }],
      ['valor acima do teto', { valueCents: PORTFOLIO_LIMITS.maxCostCents + 1 }],
      ['valor que perde precisão', { valueCents: 2 ** 53 }],
      ['modo desconhecido', { mode: 'both' }],
      ['sem o modo', { mode: undefined }],
      ['data com hora', { boughtOn: '2026-10-15T10:00:00Z' }],
      ['data que não existe', { boughtOn: '2026-02-30' }],
      ['data do ano zero', { boughtOn: '0000-01-01' }],
      ['data antes de 1900', { boughtOn: '1899-12-31' }],
      ['data em formato brasileiro', { boughtOn: '15/10/2026' }],
    ])('corpo inválido (%s): 400 e nada é gravado', async (_what, change) => {
      const user = await freshUser();
      const res = await post(user, { ...UNIT, ...change });
      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
      expect(res.headers['cache-control']).toBe('no-store');
      expect(await lotsOf(user.userId)).toEqual([]);
    });

    it('o custo total acima do teto (os dois números dentro do teto, o produto não) é 400 no campo do valor', async () => {
      const user = await freshUser();
      const res = await post(user, {
        ...UNIT,
        quantity: PORTFOLIO_LIMITS.maxQuantity,
        valueCents: 100_001,
      });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('valueCents');
      // no limite exato passa: 1.000.000 de ações a R$ 1.000,00 = R$ 1.000.000.000,00
      const exact = await created(user, {
        ...UNIT,
        quantity: PORTFOLIO_LIMITS.maxQuantity,
        valueCents: 100_000,
      });
      expect(exact.costCents).toBe(PORTFOLIO_LIMITS.maxCostCents);
    });

    it('corpo que não é um objeto JSON: 400, nunca 500', async () => {
      const user = await freshUser();
      for (const body of [null, 'texto', 12, [UNIT], []]) {
        const res = await asSite(user.agent.post('/api/v1/me/portfolio/lots'))
          .set('Content-Type', 'application/json')
          .send(JSON.stringify(body));
        expect(res.status, JSON.stringify(body)).toBe(400);
      }
      const broken = await asSite(user.agent.post('/api/v1/me/portfolio/lots'))
        .set('Content-Type', 'application/json')
        .send('{"ticker": ');
      expect(broken.status).toBe(400);
      const empty = await asSite(user.agent.post('/api/v1/me/portfolio/lots'));
      expect(empty.status).toBe(400);
      expect(await lotsOf(user.userId)).toEqual([]);
    });

    it('o ticker tem de ser uma ação que a api conhece (o mesmo conjunto da busca): desconhecido e referência são 400 no campo do ticker', async () => {
      const user = await freshUser();
      for (const ticker of ['TCRX3', 'TREF11']) {
        const res = await post(user, { ...UNIT, ticker });
        expect(res.status, ticker).toBe(400);
        expect(res.body).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
        expect(JSON.stringify(res.body)).toContain('ticker');
        expect(JSON.stringify(res.body)).not.toContain(ticker);
      }
      expect(await lotsOf(user.userId)).toEqual([]);
    });

    it('a data da compra não pode ser futura (em Brasília): hoje passa, amanhã não', async () => {
      const user = await freshUser();
      expect((await post(user, { ...UNIT, boughtOn: TODAY })).status).toBe(201);
      const res = await post(user, { ...UNIT, boughtOn: tomorrow() });
      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('boughtOn');
      expect(
        await prisma.portfolioLot.count({ where: { portfolio: { userId: user.userId } } }),
      ).toBe(1);
    });

    it('a carteira tem no máximo 200 lançamentos: o 201º é 409 LOT_LIMIT e nada é gravado', async () => {
      const user = await freshUser();
      const portfolioId = newId();
      await prisma.portfolio.create({ data: { id: portfolioId, userId: user.userId } });
      await prisma.portfolioLot.createMany({
        data: Array.from({ length: PORTFOLIO_LIMITS.maxLots - 1 }, () => ({
          id: newId(),
          portfolioId,
          ticker: 'TCRA3',
          quantity: 1,
          costCents: 100n,
        })),
      });
      expect((await post(user, UNIT)).status).toBe(201);
      const res = await post(user, UNIT);
      expect(res.status).toBe(409);
      expect(res.body).toMatchObject({ success: false, error: { code: 'LOT_LIMIT' } });
      expect(res.headers['cache-control']).toBe('no-store');
      expect(await prisma.portfolioLot.count({ where: { portfolioId } })).toBe(
        PORTFOLIO_LIMITS.maxLots,
      );
      // apagar um abre o lugar
      const [one] = await prisma.portfolioLot.findMany({ where: { portfolioId }, take: 1 });
      expect((await del(user, one!.id)).status).toBe(200);
      expect((await post(user, UNIT)).status).toBe(201);
      // a carteira cheia lê normalmente
      expect((await load(user)).lots).toHaveLength(PORTFOLIO_LIMITS.maxLots);
    });

    // Sem corrida no teto: seis POST ao mesmo tempo com três lugares livres, e só três passam. Quem garante é a trava por usuário na transação
    // da api (e, atrás dela, o gatilho do banco, testado no api-role.integration.spec.ts).
    it('sem corrida: POST simultâneos não passam do teto de 200 lançamentos', async () => {
      const user = await freshUser();
      const portfolioId = newId();
      await prisma.portfolio.create({ data: { id: portfolioId, userId: user.userId } });
      await prisma.portfolioLot.createMany({
        data: Array.from({ length: PORTFOLIO_LIMITS.maxLots - 3 }, () => ({
          id: newId(),
          portfolioId,
          ticker: 'TCRA3',
          quantity: 1,
          costCents: 100n,
        })),
      });
      const statuses = (await Promise.all(Array.from({ length: 6 }, () => post(user, UNIT)))).map(
        (res) => res.status,
      );
      expect(statuses.sort()).toEqual([201, 201, 201, 409, 409, 409]);
      expect(await prisma.portfolioLot.count({ where: { portfolioId } })).toBe(
        PORTFOLIO_LIMITS.maxLots,
      );
    });

    it('os primeiros POST simultâneos de um usuário novo criam UMA carteira só (a trava cobre a criação)', async () => {
      const user = await freshUser();
      const statuses = (await Promise.all(Array.from({ length: 4 }, () => post(user, UNIT)))).map(
        (res) => res.status,
      );
      expect(statuses).toEqual([201, 201, 201, 201]);
      expect(await prisma.portfolio.count({ where: { userId: user.userId } })).toBe(1);
      expect(await lotsOf(user.userId)).toHaveLength(4);
    });
  });

  describe('PATCH /api/v1/me/portfolio/lots/:id', () => {
    it('troca o lançamento inteiro com o mesmo corpo do POST: ticker, quantidade, custo e data; o id e a criação ficam', async () => {
      const user = await freshUser();
      const lot = await created(user, UNIT);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const res = await patch(user, lot.id, {
        ticker: 'TCRB4',
        quantity: 10,
        mode: 'unit',
        valueCents: 2_001,
        boughtOn: '2026-10-01',
      });
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const changed = envelope(lotSchema, res.body);
      expect(changed).toMatchObject({
        id: lot.id,
        ticker: 'TCRB4',
        quantity: 10,
        costCents: 20_010,
        boughtOn: '2026-10-01',
        createdAt: lot.createdAt,
      });
      expect(Date.parse(changed.updatedAt)).toBeGreaterThan(Date.parse(lot.updatedAt));
      const rows = await lotsOf(user.userId);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        id: lot.id,
        ticker: 'TCRB4',
        quantity: 10,
        costCents: 20_010n,
      });
      // o PATCH é o lançamento INTEIRO: sem data no corpo, a data some
      const cleared = envelope(
        lotSchema,
        (
          await patch(user, lot.id, {
            ticker: 'TCRB4',
            quantity: 10,
            mode: 'total',
            valueCents: 20_010,
          })
        ).body,
      );
      expect(cleared.boughtOn).toBeNull();
      expect(cleared.costCents).toBe(20_010);
    });

    it('os dois modos de preço também dão o mesmo custo no PATCH', async () => {
      const user = await freshUser();
      const lot = await created(user, UNIT);
      const unit = envelope(
        lotSchema,
        (await patch(user, lot.id, { ...UNIT, quantity: 7, valueCents: 1_234 })).body,
      );
      const total = envelope(
        lotSchema,
        (await patch(user, lot.id, { ...TOTAL, quantity: 7, valueCents: 7 * 1_234 })).body,
      );
      expect(unit.costCents).toBe(7 * 1_234);
      expect(total.costCents).toBe(unit.costCents);
    });

    it('corpo inválido, campo a mais, ticker desconhecido e data futura: 400, e o lançamento fica como estava', async () => {
      const user = await freshUser();
      const lot = await created(user, UNIT);
      const before = (await lotsOf(user.userId))[0]!;
      for (const change of [
        { quantity: 0 },
        { userId: b.userId },
        { portfolioId: newId() },
        { id: newId() },
        { ticker: 'TCRX3' },
        { ticker: 'TREF11' },
        { boughtOn: tomorrow() },
        { valueCents: PORTFOLIO_LIMITS.maxCostCents + 1 },
      ]) {
        const res = await patch(user, lot.id, { ...UNIT, ...change });
        expect(res.status, JSON.stringify(change)).toBe(400);
      }
      expect((await lotsOf(user.userId))[0]).toEqual(before);
    });

    it('o :id que não é ULID é 400; o ULID que não existe é 404', async () => {
      for (const id of ['abc', '123', "1'OR'1'='1", `${newId()}x`, newId().toLowerCase()]) {
        const res = await patch(a, id, UNIT);
        expect(res.status, id).toBe(400);
        expect((await del(a, id)).status, id).toBe(400);
      }
      const missing = newId();
      expect((await patch(a, missing, UNIT)).status).toBe(404);
      expect((await patch(a, missing, UNIT)).body).toMatchObject({
        success: false,
        error: { code: 'NOT_FOUND' },
      });
    });

    it('sem corpo ou com o PATCH parcial, 400: o lançamento inteiro é obrigatório', async () => {
      const user = await freshUser();
      const lot = await created(user, UNIT);
      expect((await asSite(user.agent.patch(`/api/v1/me/portfolio/lots/${lot.id}`))).status).toBe(
        400,
      );
      expect((await patch(user, lot.id, { quantity: 5 })).status).toBe(400);
      expect((await lotsOf(user.userId))[0]).toMatchObject({ quantity: 100 });
    });
  });

  describe('DELETE /api/v1/me/portfolio/lots/:id', () => {
    it('apaga o lançamento do dono: 200, a linha some, e apagar de novo é 404', async () => {
      const user = await freshUser();
      const keep = await created(user, UNIT);
      const gone = await created(user, TOTAL);
      const res = await del(user, gone.id);
      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(envelope(lotDeletedSchema, res.body)).toEqual({ deleted: true });
      expect((await lotsOf(user.userId)).map((row) => row.id)).toEqual([keep.id]);
      const again = await del(user, gone.id);
      expect(again.status).toBe(404);
      expect(again.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
      expect((await load(user)).lots.map((lot) => lot.id)).toEqual([keep.id]);
    });

    it('sem corpo é o normal de um DELETE; a carteira esvaziada lê como vazia', async () => {
      const user = await freshUser();
      const lot = await created(user, UNIT);
      expect((await del(user, lot.id)).status).toBe(200);
      const empty = await load(user);
      expect(empty.lots).toEqual([]);
      expect(empty.positions).toEqual([]);
      expect(empty.totals.costCents).toBe(0);
    });
  });

  // Aceite da etapa 12: o usuário A não vê a carteira do B.
  describe('o dono: A nunca vê, muda nem apaga nada de B', () => {
    it('cada um lê só os próprios lançamentos e totais; nenhuma rota aceita o id de outro usuário', async () => {
      const x = await freshUser();
      const y = await freshUser();
      const lotX = await created(x, { ...UNIT, ticker: 'TCRA3' });
      const lotY1 = await created(y, {
        ticker: 'TCRB4',
        quantity: 3,
        mode: 'total',
        valueCents: 999,
      });
      const lotY2 = await created(y, {
        ticker: 'TCRC3',
        quantity: 4,
        mode: 'total',
        valueCents: 888,
      });

      const seenX = await get(x);
      const seenY = await get(y);
      const portfolioX = envelope(portfolioSchema, seenX.body);
      const portfolioY = envelope(portfolioSchema, seenY.body);
      expect(portfolioX.lots.map((lot) => lot.id)).toEqual([lotX.id]);
      expect(portfolioY.lots.map((lot) => lot.id).sort()).toEqual([lotY1.id, lotY2.id].sort());
      expect(portfolioX.positions.map((p) => p.ticker)).toEqual(['TCRA3']);
      expect(portfolioY.positions.map((p) => p.ticker)).toEqual(['TCRB4', 'TCRC3']);
      expect(portfolioX.totals.costCents).toBe(355_000);
      expect(portfolioY.totals.costCents).toBe(999 + 888);
      // o corpo cru de X não tem nada de Y
      for (const fromY of [lotY1.id, lotY2.id, y.userId, y.email]) {
        expect(seenX.text).not.toContain(fromY);
      }

      // rotas com o id de outro usuário não existem
      for (const path of [`/${y.userId}`, `/users/${y.userId}`, `/lots`, `/lots/`]) {
        expect([404, 400].includes((await get(x, path)).status), path).toBe(true);
      }
      expect((await get(x, `?userId=${y.userId}`)).status).toBe(400);
    });

    it('o lançamento de B: PATCH e DELETE de A dão 404 (e não 403), e o lançamento de B fica intacto', async () => {
      const user = await freshUser();
      const victim = await freshUser();
      const lot = await created(victim, UNIT);
      const before = (await lotsOf(victim.userId))[0]!;

      const patched = await patch(user, lot.id, { ...TOTAL, ticker: 'TCRB4', valueCents: 1 });
      expect(patched.status).toBe(404);
      expect(patched.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
      const deleted = await del(user, lot.id);
      expect(deleted.status).toBe(404);
      expect(deleted.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
      // a mesma resposta de um id que não existe: não revela que o lançamento é de outro
      const unknown = await del(user, newId());
      expect(unknown.status).toBe(404);
      expect(unknown.body).toEqual(deleted.body);

      expect((await lotsOf(victim.userId))[0]).toEqual(before);
      expect(await lotsOf(user.userId)).toEqual([]);
      expect(envelope(portfolioSchema, (await get(victim)).body).lots).toHaveLength(1);
      // e o dono ainda muda e apaga o que é dele
      expect((await patch(victim, lot.id, { ...UNIT, quantity: 1 })).status).toBe(200);
      expect((await del(victim, lot.id)).status).toBe(200);
    });

    it('A cria na própria carteira mesmo sabendo o id da carteira de B; apagar A não toca B', async () => {
      const x = await freshUser();
      const y = await freshUser();
      await created(y, UNIT);
      const portfolioOfY = (
        await prisma.portfolio.findFirstOrThrow({ where: { userId: y.userId } })
      ).id;
      const res = await post(x, { ...UNIT, portfolioId: portfolioOfY });
      expect(res.status).toBe(400);
      await created(x, UNIT);
      expect(await prisma.portfolioLot.count({ where: { portfolioId: portfolioOfY } })).toBe(1);
      expect(await prisma.portfolioLot.count({ where: { portfolio: { userId: x.userId } } })).toBe(
        1,
      );
    });
  });

  describe('Swagger e o envelope', () => {
    it('as quatro rotas estão no Swagger, com a tag da carteira e as respostas documentadas', async () => {
      const spec = (await account.http().get('/api/docs-json')).body as {
        paths: Record<
          string,
          Record<string, { tags?: string[]; responses?: Record<string, unknown> }>
        >;
      };
      const expected: Array<[string, string, string]> = [
        ['/api/v1/me/portfolio', 'get', '200'],
        ['/api/v1/me/portfolio/lots', 'post', '201'],
        ['/api/v1/me/portfolio/lots/{id}', 'patch', '200'],
        ['/api/v1/me/portfolio/lots/{id}', 'delete', '200'],
      ];
      for (const [path, method, ok] of expected) {
        const operation = spec.paths[path]?.[method];
        expect(operation, `${method} ${path}`).toBeDefined();
        expect(operation!.tags).toEqual(['carteira']);
        expect(Object.keys(operation!.responses ?? {})).toEqual(
          expect.arrayContaining([ok, '401', '403']),
        );
      }
    });

    it('erro de rota da carteira continua no envelope', async () => {
      const res = await get(a, '?x=1');
      expect(res.body).toMatchObject({
        success: false,
        data: null,
        error: { code: 'VALIDATION_ERROR' },
      });
    });
  });
});
