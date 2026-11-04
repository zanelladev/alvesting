import { BlobServiceClient } from '@azure/storage-blob';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaService } from '../infrastructure/database/prisma.service.js';
import {
  openTestDatabase,
  testDatabaseUrl,
} from '../infrastructure/database/test-database.fixture.js';
import { ALERT_LOG } from '../telemetry/alert-logs.js';
import {
  ENSAIO_CANARY,
  FIRST_DAY,
  assertDisposableDatabase,
  runEnsaio,
  truncateAll,
} from './driver.js';
import { buildMarket } from './market.js';
import { plannedBrapiRequests } from './report.js';
import { loadTradingCalendar } from '../modules/market-data/domain/trading-calendar.js';
import { clearEnsaioBlobs } from './world.js';

// O ensaio da Temporada 0 (arena:ensaio) com o mesmo driver do comando, em escala menor: 3 pregões e 12 ações. Postgres (alvesting_test)
// e Azurite de verdade; sem Service Bus (o barramento é o do processo), sem LLM e sem rede (o guarda de rede do driver falha o ensaio
// se algo sair). Nenhum dado de terceiro: o mercado, as notícias e o macro saem do código.
const storage = process.env.STORAGE_CONNECTION_STRING;
const ready = Boolean(testDatabaseUrl && storage);
const title = ready
  ? 'ensaio da Temporada 0 (Postgres + Azurite)'
  : 'ensaio da Temporada 0 (Postgres + Azurite) [pulado: defina TEST_DATABASE_URL e STORAGE_CONNECTION_STRING com o Postgres e o Azurite no ar, ver .env.example]';

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const D1 = '2026-11-03';
const D2 = '2026-11-04';
const D3 = '2026-11-05';

describe.skipIf(!ready)(title, () => {
  let prisma: PrismaService;
  let blob: BlobServiceClient;
  const run = (overrides: Partial<Parameters<typeof runEnsaio>[0]> = {}) =>
    runEnsaio({ prisma, blob, seed: 1, sessions: 3, stocks: 12, ...overrides });

  beforeAll(async () => {
    prisma = await openTestDatabase(testDatabaseUrl!);
    blob = BlobServiceClient.fromConnectionString(storage!);
  }, 120_000);

  afterAll(async () => {
    Logger.overrideLogger(false);
    // não deixa o mercado do ensaio no banco de teste nem os arquivos no Azurite: os outros testes de integração começam do zero
    await truncateAll(prisma);
    await clearEnsaioBlobs(blob);
    await prisma.onModuleDestroy();
  });

  describe('3 pregões seguidos, sem intervenção e sem nenhuma mensagem na DLQ', () => {
    it('todas as verificações do relatório passam e a DLQ fica vazia', async () => {
      const result = await run();
      for (const check of result.checks) {
        expect(check.ok, `${check.label}: ${check.detail}`).toBe(true);
      }
      expect(result.ok).toBe(true);
      expect(result.bus.deadLettered).toBe(0);
      expect(result.blockedNetwork).toEqual([]);
      // o relatório fala dos três pregões e traz o ranking e o Monte Carlo
      expect(result.text).toContain(`PREGÃO ${D1}`);
      expect(result.text).toContain(`PREGÃO ${D3}`);
      expect(result.text).toContain('RANKING');
      expect(result.text).toContain('Monte Carlo');
      // o texto do prompt nunca sai (regra 4): nem o canário
      expect(result.text).not.toContain(ENSAIO_CANARY);
      expect(result.json).not.toContain(ENSAIO_CANARY);
    }, 180_000);

    it('cada competidor tem decisão (ou HOLD registrado) e patrimônio em cada pregão; a temporada fecha', async () => {
      await run();
      const season = await prisma.season.findFirstOrThrow({ where: { slug: 'ensaio' } });
      expect(season.status).toBe('FINISHED');
      expect(season.finishedAt).not.toBeNull();

      const competitors = await prisma.competitor.findMany({ where: { seasonId: season.id } });
      expect(competitors).toHaveLength(8);
      const models = competitors.filter((c) => c.kind === 'MODEL');
      expect(models).toHaveLength(4);

      const cycles = await prisma.cycle.findMany({
        where: { seasonId: season.id },
        orderBy: { date: 'asc' },
        include: { decisions: true },
      });
      expect(cycles.map((c) => [c.date.toISOString().slice(0, 10), c.status])).toEqual([
        [D1, 'CLOSED'],
        [D2, 'CLOSED'],
        [D3, 'CLOSED'],
      ]);
      for (const cycle of cycles) {
        expect(cycle.decisions.map((d) => d.competitorId).sort()).toEqual(
          models.map((m) => m.id).sort(),
        );
        // sem HOLD forçado: nada falhou de verdade
        expect(cycle.decisions.every((d) => d.status === 'DECIDED')).toBe(true);
      }

      for (const date of [D1, D2, D3]) {
        const snapshots = await prisma.equitySnapshot.findMany({
          where: { seasonId: season.id, date: day(date) },
        });
        expect(snapshots.map((s) => s.competitorId).sort(), date).toEqual(
          competitors.map((c) => c.id).sort(),
        );
      }
      expect(await prisma.jobRun.count({ where: { status: { not: 'SUCCEEDED' } } })).toBe(0);
    }, 180_000);

    it('o reparo do JSON aparece: o fake/flaky-json erra o primeiro e acerta o segundo (duas chamadas)', async () => {
      await run();
      const flaky = await prisma.competitor.findFirstOrThrow({ where: { slug: 'fake-flaky' } });
      const decisions = await prisma.decision.findMany({
        where: { competitorId: flaky.id },
        include: { cycle: true },
        orderBy: { cycle: { date: 'asc' } },
      });
      const calls = decisions.map((d) => (d.usage as { calls: number }).calls);
      // dia ímpar do mês (03/11 e 05/11): o JSON quebra e o reparo conserta; 04/11 acerta de primeira
      expect(calls).toEqual([2, 1, 2]);
      expect(decisions.every((d) => d.status === 'DECIDED')).toBe(true);
    }, 180_000);

    it('a falha passageira do provedor vira nova tentativa agendada (10 minutos depois), não DLQ nem HOLD', async () => {
      const result = await run();
      expect(result.bus.retried).toBeGreaterThanOrEqual(1);
      expect(result.bus.deadLettered).toBe(0);
      const contrarian = await prisma.competitor.findFirstOrThrow({
        where: { slug: 'fake-contrarian' },
      });
      const job = await prisma.jobRun.findFirstOrThrow({
        where: { type: 'decide', idempotencyKey: { endsWith: `:${contrarian.id}` } },
        orderBy: { attempts: 'desc' },
      });
      expect(job).toMatchObject({ status: 'SUCCEEDED', attempts: 2 });
      // A tentativa que falhou escreveu a linha do alerta de job falho (etapa 10). Ela fica anotada para quem lê a saída do comando, mas
      // fora da contagem de erros do relatório: repete um fato que o relatório já conta (a nova tentativa agendada), e o relatório da
      // Temporada 0 não pode mudar por causa de um sinal que existe para a Azure.
      expect(result.logLines.some((line) => line.includes(ALERT_LOG.jobFailed))).toBe(true);
      expect(result.text).toContain('avisos nos logs: 0 | erros nos logs: 0');
    }, 180_000);

    it('o dia sem negócio: SECA3 não negocia em 04/11, e a compra dela não executa nem mexe no caixa', async () => {
      await run();
      expect(
        await prisma.dailyBar.count({ where: { date: day(D2), instrument: { ticker: 'SECA3' } } }),
      ).toBe(0);
      expect(
        await prisma.dailyBar.count({ where: { date: day(D1), instrument: { ticker: 'SECA3' } } }),
      ).toBe(1);

      const orders = await prisma.order.findMany({
        where: { ticker: 'SECA3', date: day(D2) },
        include: { fill: true, competitor: true },
      });
      expect(orders.length).toBeGreaterThan(0); // o momentum compra a maior alta do dia anterior
      for (const order of orders) {
        expect(order).toMatchObject({ status: 'NOT_EXECUTED', reason: 'no_bar', priceCents: null });
        expect(order.filledQuantity).toBe(0n);
        expect(order.fill).toBeNull();
      }
    }, 180_000);

    it('a ação suspensa: PAUS3 some em 05/11; a venda dela não executa e a posição fica marcada pelo último fechamento', async () => {
      await run();
      expect(
        await prisma.dailyBar.count({ where: { date: day(D3), instrument: { ticker: 'PAUS3' } } }),
      ).toBe(0);
      const orders = await prisma.order.findMany({
        where: { ticker: 'PAUS3', date: day(D3) },
        include: { fill: true, competitor: true },
      });
      // nenhuma ordem sobre ela executa (compra ou venda, de modelo ou do Sorteio), e o contrário tenta realizar o ganho de 5% do dia anterior
      for (const order of orders) {
        expect(order).toMatchObject({ status: 'NOT_EXECUTED', reason: 'no_bar' });
        expect(order.fill).toBeNull();
      }
      expect(
        orders.some((o) => o.action === 'SELL' && o.competitor.slug === 'fake-contrarian'),
      ).toBe(true);
      const stale = await prisma.position.findMany({ where: { ticker: 'PAUS3', date: day(D3) } });
      expect(stale.length).toBeGreaterThan(0);
      const before = await prisma.position.findMany({ where: { ticker: 'PAUS3', date: day(D2) } });
      for (const position of stale) {
        expect(position.stale).toBe(true);
        const previous = before.find((p) => p.competitorId === position.competitorId)!;
        expect(position.markCents).toBe(previous.markCents); // o último fechamento conhecido
      }
    }, 180_000);

    it('o desdobramento 1:2 de DOBR4 na data ex (05/11): a quantidade dobra, o custo não muda, e o patrimônio não perde a metade', async () => {
      await run();
      const event = await prisma.corporateEvent.findFirstOrThrow({ where: { ticker: 'DOBR4' } });
      expect(event).toMatchObject({ kind: 'SPLIT', ratioFrom: 1, ratioTo: 2 });
      expect(event.exDate).toEqual(day(D3));

      const holders = await prisma.position.findMany({
        where: { ticker: 'DOBR4', date: day(D2) },
      });
      expect(holders.length).toBeGreaterThan(0); // o contrário compra a maior queda do histórico e segura
      for (const holder of holders) {
        const fills = await prisma.order.findMany({
          where: { competitorId: holder.competitorId, ticker: 'DOBR4', date: day(D3) },
          include: { fill: true },
        });
        const net = fills.reduce(
          (sum, order) =>
            sum +
            (order.fill
              ? order.action === 'BUY'
                ? order.fill.quantity
                : -order.fill.quantity
              : 0n),
          0n,
        );
        const after = await prisma.position.findFirst({
          where: { competitorId: holder.competitorId, ticker: 'DOBR4', date: day(D3) },
        });
        // as ações antigas viram o dobro; só as ordens do próprio dia mexem além disso
        expect(after?.quantity ?? 0n).toBe(holder.quantity * 2n + net);

        // o patrimônio do dia não cai pela metade da posição: sem o ajuste a posição valeria metade e o patrimônio cairia
        const equityBefore = await prisma.equitySnapshot.findFirstOrThrow({
          where: { competitorId: holder.competitorId, date: day(D2) },
        });
        const equityAfter = await prisma.equitySnapshot.findFirstOrThrow({
          where: { competitorId: holder.competitorId, date: day(D3) },
        });
        const drop = equityBefore.equityCents - equityAfter.equityCents;
        expect(
          drop < holder.valueCents / 4n,
          `queda de ${drop} contra a posição de ${holder.valueCents}`,
        ).toBe(true);
      }
    }, 180_000);

    it('o modelo que só segura rende como o CDI, centavo a centavo, todos os dias', async () => {
      await run();
      const hold = await prisma.equitySnapshot.findMany({
        where: { competitor: { slug: 'fake-hold' } },
        orderBy: { date: 'asc' },
      });
      const cdi = await prisma.equitySnapshot.findMany({
        where: { competitor: { slug: 'cdi' } },
        orderBy: { date: 'asc' },
      });
      expect(hold).toHaveLength(3);
      expect(hold.map((s) => s.equityCents)).toEqual(cdi.map((s) => s.equityCents));
    }, 180_000);
  });

  it('determinismo: a mesma semente dá o mesmo relatório (hashes, ordens, patrimônio e percentis); outra semente dá outro', async () => {
    const first = await run();
    const again = await run();
    expect(again.text).toBe(first.text);
    expect(again.json).toBe(first.json);

    const other = await run({ seed: 2 });
    expect(other.text).not.toBe(first.text);
    expect(other.ok).toBe(true);
  }, 300_000);

  it('escreve só em containers com o prefixo ensaio-: o Azurite de dev (briefings, llm-io) não é tocado', async () => {
    const count = async (name: string): Promise<number> => {
      const container = blob.getContainerClient(name);
      if (!(await container.exists())) return 0;
      let total = 0;
      for await (const _item of container.listBlobsFlat()) total += 1;
      return total;
    };
    const plain = ['briefings', 'llm-io'];
    const before = await Promise.all(plain.map(count));
    await run();
    expect(await Promise.all(plain.map(count))).toEqual(before);
    // o que o ensaio gravou: 3 briefings e 4 modelos x 3 arquivos de IO bruto por pregão; as cotações não vão ao Blob
    expect(await count('ensaio-briefings')).toBe(3);
    expect(await count('ensaio-llm-io')).toBe(3 * 4 * 3);
  }, 180_000);

  it('a brapi falsa é servida pelo cliente de verdade, e as requisições seguem o plano: uma por papel que falta, só quem não veio é pedido de novo', async () => {
    const result = await run();
    const check = result.checks.find((c) => c.id === 'requisicoes');
    expect(check?.ok, check?.detail).toBe(true);

    // o plano, recalculado aqui do mercado sintético (o mesmo que o driver monta) e comparado com o relatório
    const calendar = loadTradingCalendar();
    const market = buildMarket({ seed: 1, stocks: 12, firstDay: FIRST_DAY, sessions: 3, calendar });
    const planned = plannedBrapiRequests(market, market.sessionDays[1]);
    expect(check?.detail).toBe(
      market.sessionDays.map((d) => `${planned.get(d)}/${planned.get(d)}`).join(' · '),
    );
    // 13 papéis no obrigatório (12 ações e o BOVA11): a 1ª noite pede 13; a do 2º pregão (barra atrasada) pede 1 de sonda, 13, e repete o SECA3
    // até o prazo; a do 3º repete o PAUS3 (suspenso) nas três novas tentativas
    expect([...planned.values()].every((n) => n >= 13)).toBe(true);
    expect(result.text).toContain('BRAPI FALSA');
    expect(result.text).toMatch(
      /carga inicial 13 \(uma por papel e o BOVA11\) \| listas de ações 2/,
    );
  }, 180_000);

  it('o eod do pregão atrasado na brapi se reagenda +60 min e completa às 22:30; o dos outros completa de primeira', async () => {
    const result = await run();
    const entries = (await prisma.jobRun.findMany({ where: { type: 'eod' } })).map(
      (j) => j.idempotencyKey,
    );
    expect(entries.sort()).toEqual([D1, D2, D3]);
    const check = result.checks.find((c) => c.id === 'eod-reagendado');
    expect(check?.ok, check?.detail).toBe(true);
    // a barra do 2º pregão só sai às 22:10: a 1ª passada (21:30) é a sonda do BOVA11, e a 2ª (22:30) busca o conjunto
    expect(check?.detail).toMatch(/o atrasado \(2026-11-04\) teve [4-9] entregas/);
  }, 180_000);
});

// Não precisa de banco: o nome vem de uma consulta falsa. Roda mesmo sem TEST_DATABASE_URL.
describe('assertDisposableDatabase: só um banco descartável pode ser esvaziado', () => {
  const asPrisma = (name: string) =>
    ({ $queryRaw: () => Promise.resolve([{ name }]) }) as unknown as Pick<
      PrismaService,
      '$queryRaw'
    >;

  it('aceita bancos que terminam em _ensaio ou _test', async () => {
    await expect(assertDisposableDatabase(asPrisma('alvesting_ensaio'))).resolves.toBeUndefined();
    await expect(assertDisposableDatabase(asPrisma('alvesting_test'))).resolves.toBeUndefined();
  });

  it('recusa o banco de dev e qualquer outro, sem tocar em nada', async () => {
    for (const name of ['alvesting_dev', 'alvesting', 'postgres', 'alvesting_test_dev', 'ensaio']) {
      await expect(assertDisposableDatabase(asPrisma(name))).rejects.toThrow(/_ensaio ou _test/);
    }
  });
});
