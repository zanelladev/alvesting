import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../common/id.js';
import type { PrismaService } from '../infrastructure/database/prisma.service.js';
import {
  integrationTitle,
  openTestDatabase,
  testDatabaseUrl,
} from '../infrastructure/database/test-database.fixture.js';
import { FreezeHandler } from '../modules/briefing/application/freeze.handler.js';
import { BriefingRepository } from '../modules/briefing/infrastructure/briefing.repository.js';
import { brasiliaInstant, type IsoDate } from '../modules/market-data/domain/dates.js';
import { loadTradingCalendar } from '../modules/market-data/domain/trading-calendar.js';
import { JobRunStore } from '../modules/messaging/infrastructure/job-run.store.js';
import { cvmDraft } from '../modules/news/domain/draft.js';
import { NewsRepository } from '../modules/news/infrastructure/news.repository.js';
import { cvmSeenAt, retroBriefingReads } from './visibility.js';

// A regra de visibilidade do arena:retroativo (ADR 0038) de ponta a ponta: o freeze de verdade, com as leituras do retroativo, sobre um banco
// que já tem o que saiu DEPOIS de cada pregão (como o banco da temporada, que é preenchido semanas depois). Para cada fonte, o que o pipeline
// ao vivo só veria depois do corte das 07:30 de D não entra no briefing de D.
beforeAll(() => {
  Logger.overrideLogger(false);
});

const calendar = loadTradingCalendar();
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
// a semana de 19/10 (2026-W43) e a de 26/10 (2026-W44), na Temporada 1
const DAYS = ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-26', '2026-10-27'];
const TICKERS = ['PETR4', 'VALE3', 'ITUB4', 'BBDC4', 'WEGE3'];
// as barras vão de 30 pregões antes do primeiro briefing até DEPOIS do último (o banco do retroativo já tem o futuro)
const BAR_DAYS = calendar.tradingDaysBetween(
  calendar.tradingDaysBefore('2026-10-20', 30)[0]!,
  '2026-10-29',
);

interface Doc {
  data_through: string;
  macro: Record<string, { date: string; value: string } | null>;
  bars: { by_ticker: Record<string, Array<[string, ...number[]]>> };
  news: { items: Array<{ title: string }> };
}

describe.skipIf(!testDatabaseUrl)(
  integrationTitle('a visibilidade do retroativo, fonte por fonte'),
  () => {
    let prisma: PrismaService;
    let repo: BriefingRepository;
    let news: NewsRepository;
    const frozen = new Map<IsoDate, Doc>();

    beforeAll(async () => {
      prisma = await openTestDatabase(testDatabaseUrl!);
      repo = new BriefingRepository(prisma);
      news = new NewsRepository(prisma);
    }, 120_000);

    afterAll(async () => {
      await clean();
      await prisma.onModuleDestroy();
    });

    async function clean() {
      await prisma.briefing.deleteMany();
      await prisma.newsItem.deleteMany();
      await prisma.macroDaily.deleteMany();
      await prisma.jobRun.deleteMany();
      await prisma.universeMember.deleteMany();
      await prisma.universeSnapshot.deleteMany();
      await prisma.dailyBar.deleteMany();
      await prisma.instrument.deleteMany();
    }

    beforeEach(async () => {
      await clean();
      frozen.clear();
      const ids = new Map<string, string>();
      for (const ticker of [...TICKERS, 'BOVA11']) {
        const row = await prisma.instrument.create({
          data: {
            id: newId(),
            ticker,
            name: `EMPRESA ${ticker}`,
            spec: 'ON',
            kind: ticker === 'BOVA11' ? 'REFERENCE' : 'STOCK',
            lastSeen: day('2026-10-29'),
          },
        });
        ids.set(ticker, row.id);
      }
      for (const week of ['2026-W43', '2026-W44']) {
        const snapshot = await prisma.universeSnapshot.create({
          data: {
            id: newId(),
            week,
            windowStart: day('2026-07-20'),
            windowEnd: day('2026-10-16'),
            windowDays: 60,
            candidates: 5,
            eligible: 5,
          },
        });
        await prisma.universeMember.createMany({
          data: TICKERS.map((ticker, index) => ({
            id: newId(),
            snapshotId: snapshot.id,
            instrumentId: ids.get(ticker)!,
            position: index + 1,
            avgVolumeCents: BigInt(1_000_000_000 - index * 1000),
            presenceDays: 60,
          })),
        });
      }
      await prisma.dailyBar.createMany({
        data: [...TICKERS, 'BOVA11'].flatMap((ticker, t) =>
          BAR_DAYS.map((date, index) => ({
            id: newId(),
            instrumentId: ids.get(ticker)!,
            date: day(date),
            openCents: 10_000n + BigInt(index),
            highCents: 11_000n,
            lowCents: 9_000n,
            // o fechamento muda todo dia (e por papel), para a variação ter sentido
            closeCents: 10_000n + BigInt(index * 7 + t),
            volumeCents: 1_000_000_000n,
            source: 'BRAPI' as const,
          })),
        ),
      });
    });

    // O macro do BCB como o banco do retroativo o tem: todo valor que JÁ saiu, inclusive os que às 07:30 do pregão ainda não tinham saído.
    async function seedMacro() {
      await prisma.$executeRaw`
        INSERT INTO macro_daily (series, date, value) VALUES
          ('cdi_daily_pct', '2026-10-19', 0.050100), ('cdi_daily_pct', '2026-10-20', 0.050200),
          ('cdi_daily_pct', '2026-10-21', 0.050300), ('cdi_daily_pct', '2026-10-22', 0.050400),
          ('usd_brl_ptax_sell', '2026-10-20', 5.3000), ('usd_brl_ptax_sell', '2026-10-21', 5.3100),
          ('selic_target_pct_year', '2026-10-21', 13.75), ('selic_target_pct_year', '2026-10-22', 13.50),
          ('ipca_month_pct', '2026-08-01', 0.20), ('ipca_month_pct', '2026-09-01', 0.82),
          ('ipca_12m_pct', '2026-08-01', 4.40), ('ipca_12m_pct', '2026-09-01', 4.58)`;
    }

    // Uma notícia de RSS com a hora REAL em que o operador local a viu (first_seen_at), como o retroativo a encontra no banco.
    async function rss(path: string, seenAt: Date) {
      await prisma.newsItem.create({
        data: {
          id: newId(),
          urlHash: createHash('sha256').update(path).digest('hex'),
          url: `https://exemplo.com.br/${path}`,
          source: 'agencia-brasil',
          title: `RSS ${path}`,
          snippet: '',
          tickers: [],
          publishedAt: seenAt,
          firstSeenAt: seenAt,
        },
      });
    }

    // Um documento da CVM entregue no dia, gravado como o CvmFetcher.backfill grava: visto na hora da regra (cvmSeenAt).
    async function cvm(deliveredOn: IsoDate, subject: string) {
      const draft = cvmDraft(
        {
          cnpj: '33000167000101',
          company: 'PETROBRAS',
          category: 'Fato Relevante',
          type: '',
          subject,
          deliveredOn,
          link: `https://www.rad.cvm.gov.br/ENET/frmDownloadDocumento.aspx?numProtocolo=${subject.length}${deliveredOn.replaceAll('-', '')}`,
        },
        ['PETR4'],
        cvmSeenAt(deliveredOn),
      );
      await news.saveNews([draft!], cvmSeenAt(deliveredOn));
    }

    // Congela os briefings em ordem, cada um às 07:30:30 do pregão (o freeze espera até 07:30:10 e lê o banco), com as leituras do retroativo.
    async function freezeAll(reads = retroBriefingReads(repo, calendar)) {
      const handler = new FreezeHandler(
        new JobRunStore(prisma),
        calendar,
        reads,
        {
          save: (date: string, bytes: Buffer) => {
            frozen.set(date, JSON.parse(bytes.toString('utf8')) as Doc);
            return Promise.resolve(`http://127.0.0.1/briefings/${date}.json`);
          },
        },
        () => Promise.resolve(),
      );
      for (const date of DAYS) {
        const at = new Date(brasiliaInstant(date, '07:30').getTime() + 30_000);
        await handler.execute(date, at);
      }
    }
    const titles = (date: IsoDate) => frozen.get(date)!.news.items.map((item) => item.title);

    it('barras: o briefing de D só tem até D-1, mesmo com as barras de D e de depois no banco', async () => {
      await seedMacro();
      await freezeAll();
      for (const date of DAYS) {
        const doc = frozen.get(date)!;
        const last = calendar.previousTradingDay(date);
        expect(doc.data_through).toBe(last);
        const dates = Object.values(doc.bars.by_ticker).flatMap((bars) =>
          bars.map((bar) => bar[0]),
        );
        expect(dates.length).toBeGreaterThan(0);
        expect(
          dates.every((barDate) => barDate <= last),
          date,
        ).toBe(true);
      }
    });

    it('BCB: cada valor só entra depois de público pela regra da série; o ao vivo (valor até D-1) veria mais', async () => {
      await seedMacro();
      await freezeAll();
      // quinta 22/10: o CDI e o PTAX de 21/10 só saem no dia útil seguinte (22/10, sem hora conhecida), então valem os de 20/10; a meta Selic
      // de 21/10 já vale; o IPCA de setembro (divulgado em outubro) só a partir de 01/11, então vale o de agosto
      expect(frozen.get('2026-10-22')!.macro).toMatchObject({
        cdi_daily_pct: { date: '2026-10-20' },
        usd_brl_ptax_sell: { date: '2026-10-20' },
        selic_target_pct_year: { date: '2026-10-21' },
        ipca_month_pct: { date: '2026-08-01' },
        ipca_12m_pct: { date: '2026-08-01' },
      });
      // terça 27/10: o CDI de sexta 23/10 sai na segunda 26/10, e só vale no dia seguinte; o mais novo publicado no banco é o de 22/10
      expect(frozen.get('2026-10-27')!.macro).toMatchObject({
        cdi_daily_pct: { date: '2026-10-22' },
        selic_target_pct_year: { date: '2026-10-22' },
      });
      // a prova do contrário: o freeze ao vivo, sobre o mesmo banco, já mostraria o CDI de 21/10 e o IPCA de setembro em 22/10
      await prisma.briefing.deleteMany();
      await prisma.jobRun.deleteMany();
      frozen.clear();
      await freezeAll(repo);
      expect(frozen.get('2026-10-22')!.macro).toMatchObject({
        cdi_daily_pct: { date: '2026-10-21' },
        ipca_month_pct: { date: '2026-09-01' },
      });
    });

    it('RSS: só a notícia vista até o corte das 07:30 entra no briefing do dia; a vista um segundo depois fica para o seguinte', async () => {
      await seedMacro();
      const cutoff = brasiliaInstant('2026-10-22', '07:30');
      await rss('antes-do-corte', new Date(cutoff.getTime() - 1000));
      await rss('no-corte', cutoff);
      await rss('depois-do-corte', new Date(cutoff.getTime() + 1000));
      await freezeAll();
      expect(titles('2026-10-22')).toEqual(['RSS antes-do-corte', 'RSS no-corte']);
      expect(titles('2026-10-23')).toEqual(['RSS depois-do-corte']);
    });

    it('CVM: o documento entregue em X entra no primeiro pregão depois de X+1; a sexta e o sábado vão para a segunda, o domingo para a terça', async () => {
      await seedMacro();
      await cvm('2026-10-20', 'Entregue na terça');
      await cvm('2026-10-23', 'Entregue na sexta');
      await cvm('2026-10-24', 'Entregue no sábado');
      await cvm('2026-10-25', 'Entregue no domingo');
      await freezeAll();
      const has = (date: IsoDate, subject: string) => titles(date).some((t) => t.endsWith(subject));
      // terça 20/10: está no arquivo de quarta, visto na quarta depois do corte, e vai no briefing de quinta (dois pregões depois)
      expect(has('2026-10-21', 'Entregue na terça')).toBe(false);
      expect(has('2026-10-22', 'Entregue na terça')).toBe(true);
      // sexta e sábado: vistos no sábado e no domingo, entram na segunda (um pregão depois)
      expect(has('2026-10-26', 'Entregue na sexta')).toBe(true);
      expect(has('2026-10-26', 'Entregue no sábado')).toBe(true);
      expect(has('2026-10-23', 'Entregue na sexta')).toBe(false);
      // domingo: visto na segunda depois do corte, entra na terça
      expect(has('2026-10-26', 'Entregue no domingo')).toBe(false);
      expect(has('2026-10-27', 'Entregue no domingo')).toBe(true);
      // cada documento em exatamente um briefing
      const all = DAYS.flatMap((date) => titles(date));
      expect(all.filter((t) => t.includes('Entregue'))).toHaveLength(4);
    });
  },
);
