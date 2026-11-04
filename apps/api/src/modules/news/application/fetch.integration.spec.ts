import { Logger } from '@nestjs/common';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { newId } from '../../../common/id.js';
import {
  integrationTitle,
  openTestDatabase,
  testDatabaseUrl,
} from '../../../infrastructure/database/test-database.fixture.js';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import { JobBusyError, JobRunStore } from '../../messaging/infrastructure/job-run.store.js';
import { zipOf } from '../../../infrastructure/zip/zip.fixture.js';
import { MacroRepository } from '../infrastructure/macro.repository.js';
import { NewsRepository } from '../infrastructure/news.repository.js';
import { zipOfEntries } from '../testing/zip.fixture.js';
import { urlOf } from '../testing/http.fixture.js';
import { BcbFetcher } from './bcb-fetcher.js';
import { CvmFetcher } from './cvm-fetcher.js';
import { FetchHandler } from './fetch.handler.js';
import { RssFetcher } from './rss-fetcher.js';

// A fila news de ponta a ponta, com o Postgres de verdade (alvesting_test): a idempotência é a do banco. Fora do
// processo, só o que não é nosso: as fontes (um fetch falso) e a fila.
beforeAll(() => {
  Logger.overrideLogger(false);
});

const SLOT = '2026-11-01T17:30:00Z';
const NOW = new Date('2026-11-01T17:30:04Z');
const msg = (source: string, slot = SLOT) => ({ type: 'fetch', source, slot }) as const;
const latin1 = (text: string): Buffer => Buffer.from(text, 'latin1');

const RSS = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>x</title><link>https://www.infomoney.com.br/</link>
<item><title>Petrobras (PETR4) sobe</title><link>https://www.infomoney.com.br/mercados/a/?utm_source=rss</link><pubDate>Sun, 01 Nov 2026 16:00:00 +0000</pubDate><description><![CDATA[<p>Texto. VALE3 cai.</p>]]></description></item>
<item><title>Segunda matéria</title><link>https://www.infomoney.com.br/mercados/b/</link><pubDate>Sun, 01 Nov 2026 16:10:00 +0000</pubDate><description>Sem ticker.</description></item>
</channel></rss>`;

const PETROBRAS = '33.000.167/0001-01';
const IPE_HEADER =
  'CNPJ_Companhia;Nome_Companhia;Codigo_CVM;Data_Referencia;Categoria;Tipo;Especie;Assunto;Data_Entrega;Tipo_Apresentacao;Protocolo_Entrega;Versao;Link_Download';
const ipeRow = (cnpj: string, name: string, subject: string, date: string, protocol: string) =>
  [
    cnpj,
    name,
    '1',
    date,
    'Fato Relevante',
    '',
    '',
    subject,
    date,
    'AP - Apresentação',
    protocol,
    '1',
    `https://www.rad.cvm.gov.br/ENET/frmDownloadDocumento.aspx?Tela=ext&descTipo=IPE&numProtocolo=${protocol}&numVersao=1`,
  ].join(';');
const IPE_ZIP = zipOf(
  'ipe_cia_aberta_2026.csv',
  latin1(
    `${[
      IPE_HEADER,
      ipeRow(
        PETROBRAS,
        'PETRÓLEO BRASILEIRO S.A. - PETROBRAS',
        'Relatório de Produção e Vendas 3T26',
        '2026-10-28',
        '1001',
      ),
      ipeRow('33.592.510/0001-54', 'VALE S.A.', 'Atualização de projeções', '2026-10-30', '1002'),
      ipeRow(
        '11.111.111/0001-11',
        'EMPRESA SEM TICKER S.A.',
        'Sem instrumento',
        '2026-10-30',
        '1003',
      ),
    ].join('\r\n')}\r\n`,
  ),
);
const FCA_ZIP = zipOfEntries([
  { name: 'fca_cia_aberta_2026.csv', content: latin1('x;y\r\n1;2\r\n') },
  {
    name: 'fca_cia_aberta_valor_mobiliario_2026.csv',
    content: latin1(
      `CNPJ_Companhia;Valor_Mobiliario;Codigo_Negociacao\r\n${PETROBRAS};Ações;PETR3\r\n${PETROBRAS};Ações;PETR4\r\n33.592.510/0001-54;Ações;VALE3\r\n`,
    ),
  },
]);

function fakeWorld() {
  const requests: string[] = [];
  const urls: URL[] = [];
  const etags = new Map<string, string>([
    ['dados.cvm.gov.br/dados/CIA_ABERTA/DOC/IPE/DADOS/ipe_cia_aberta_2026.zip', '"ipe-1"'],
    ['dados.cvm.gov.br/dados/CIA_ABERTA/DOC/FCA/DADOS/fca_cia_aberta_2026.zip', '"fca-1"'],
  ]);
  const fn = vi.fn((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(urlOf(input));
    urls.push(url);
    requests.push(`${url.host}${url.pathname}`);
    const key = `${url.host}${url.pathname}`;
    const etag = etags.get(key);
    if (etag && new Headers(init?.headers).get('if-none-match') === etag) {
      return Promise.resolve(new Response(null, { status: 304 }));
    }
    if (url.host === 'www.infomoney.com.br') return Promise.resolve(new Response(RSS));
    if (url.pathname.includes('/IPE/')) {
      return Promise.resolve(new Response(new Uint8Array(IPE_ZIP), { headers: { etag: etag! } }));
    }
    if (url.pathname.includes('/FCA/')) {
      return Promise.resolve(new Response(new Uint8Array(FCA_ZIP), { headers: { etag: etag! } }));
    }
    if (url.host === 'api.bcb.gov.br') {
      const code = /sgs\.(\d+)/.exec(url.pathname)![1];
      const value = code === '1' ? '5.3744' : code === '12' ? '0.050788' : '13.75';
      return Promise.resolve(new Response(JSON.stringify([{ data: '29/10/2026', valor: value }])));
    }
    return Promise.resolve(new Response('?', { status: 404 }));
  });
  return { fetchFn: fn as unknown as typeof fetch, requests, urls };
}

describe.skipIf(!testDatabaseUrl)(integrationTitle('fila news: fetch de ponta a ponta'), () => {
  let prisma: PrismaService;
  let jobs: JobRunStore;
  let news: NewsRepository;
  let macro: MacroRepository;

  beforeAll(async () => {
    prisma = await openTestDatabase(testDatabaseUrl!);
    jobs = new JobRunStore(prisma);
    news = new NewsRepository(prisma);
    macro = new MacroRepository(prisma);
  }, 120_000);

  beforeEach(async () => {
    await prisma.newsItem.deleteMany();
    await prisma.macroDaily.deleteMany();
    await prisma.fetchState.deleteMany();
    await prisma.jobRun.deleteMany();
    await prisma.universeMember.deleteMany();
    await prisma.universeSnapshot.deleteMany();
    await prisma.dailyBar.deleteMany();
    await prisma.instrument.deleteMany();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  const instrument = (ticker: string) =>
    prisma.instrument.create({
      data: {
        id: newId(),
        ticker,
        name: ticker,
        spec: 'ON',
        kind: 'STOCK',
        lastSeen: new Date('2026-10-30T00:00:00Z'),
      },
    });

  function handler(world = fakeWorld()) {
    return {
      world,
      handler: new FetchHandler(
        jobs,
        new RssFetcher(news, world.fetchFn),
        new CvmFetcher(news, world.fetchFn),
        new BcbFetcher(macro, world.fetchFn),
      ),
    };
  }

  describe('RSS', () => {
    it('grava as notícias limpas com os tickers conhecidos e a hora em que foram vistas', async () => {
      await instrument('PETR4');
      await instrument('VALE3');
      const t = handler();
      const before = Date.now();
      await expect(t.handler.execute(msg('infomoney'), NOW)).resolves.toBe('fetched');
      const after = Date.now();

      const rows = await prisma.newsItem.findMany({ orderBy: { title: 'asc' } });
      expect(rows.map((r) => [r.title, r.tickers, r.url, r.source])).toEqual([
        [
          'Petrobras (PETR4) sobe',
          ['PETR4', 'VALE3'],
          'https://www.infomoney.com.br/mercados/a',
          'infomoney',
        ],
        ['Segunda matéria', [], 'https://www.infomoney.com.br/mercados/b', 'infomoney'],
      ]);
      expect(rows[0]?.snippet).toBe('Texto. VALE3 cai.');
      // a hora vista é a da gravação (o relógio do processo), nunca antes do começo da busca (NOW): é ela que decide o briefing
      for (const row of rows) {
        const seen = row.firstSeenAt.getTime();
        expect(seen).toBeGreaterThanOrEqual(Math.max(NOW.getTime(), before));
        expect(seen).toBeLessThanOrEqual(after);
        expect(row.publishedAt.getTime()).toBeLessThanOrEqual(seen);
      }
      const job = await prisma.jobRun.findFirstOrThrow();
      expect(job).toMatchObject({
        queue: 'news',
        type: 'fetch',
        idempotencyKey: `infomoney:${SLOT}`,
        status: 'SUCCEEDED',
      });
    });

    it('a mesma mensagem duas vezes não duplica nada', async () => {
      const t = handler();
      await t.handler.execute(msg('infomoney'), NOW);
      await expect(t.handler.execute(msg('infomoney'), NOW)).resolves.toBe('already_done');
      expect(await prisma.newsItem.count()).toBe(2);
      expect(await prisma.jobRun.count()).toBe(1);
      expect(t.world.requests.filter((r) => r.includes('infomoney'))).toHaveLength(1);
    });

    it('o slot seguinte busca o mesmo feed de novo e a notícia repetida não duplica, nem muda a primeira hora vista', async () => {
      const t = handler();
      await t.handler.execute(msg('infomoney'), NOW);
      const first = await prisma.newsItem.findMany({ orderBy: { urlHash: 'asc' } });
      await t.handler.execute(
        msg('infomoney', '2026-11-01T18:00:00Z'),
        new Date('2026-11-01T18:00:05Z'),
      );
      expect(await prisma.newsItem.count()).toBe(2);
      const rows = await prisma.newsItem.findMany({ orderBy: { urlHash: 'asc' } });
      expect(rows.map((r) => r.firstSeenAt)).toEqual(first.map((r) => r.firstSeenAt));
      expect(await prisma.jobRun.count()).toBe(2);
    });

    it('cinco entregas ao mesmo tempo: uma busca, o resto vê já feito ou espera (JobBusyError); nada duplica', async () => {
      const t = handler();
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () => t.handler.execute(msg('infomoney'), NOW)),
      );
      for (const result of results) {
        if (result.status === 'rejected') expect(result.reason).toBeInstanceOf(JobBusyError);
      }
      expect(results.some((r) => r.status === 'fulfilled' && r.value === 'fetched')).toBe(true);
      expect(await prisma.newsItem.count()).toBe(2);
      expect(await prisma.jobRun.count()).toBe(1);
    });

    it('feed fora do ar: o job fica FAILED com o motivo (sem corpo) e a nova tentativa funciona', async () => {
      const down = vi.fn(() => Promise.resolve(new Response('SEGREDO-DA-PAGINA', { status: 503 })));
      const broken = new FetchHandler(
        jobs,
        new RssFetcher(news, down),
        new CvmFetcher(news, down),
        new BcbFetcher(macro, down),
      );
      await expect(broken.execute(msg('infomoney'), NOW)).rejects.toThrow(/503/);
      const failed = await prisma.jobRun.findFirstOrThrow();
      expect(failed.status).toBe('FAILED');
      expect(failed.error).toContain('503');
      expect(failed.error).not.toContain('SEGREDO');

      // a fila repete: a linha FAILED é reassumida
      const t = handler();
      await expect(t.handler.execute(msg('infomoney'), NOW)).resolves.toBe('fetched');
      expect(await prisma.jobRun.count()).toBe(1);
      expect((await prisma.jobRun.findFirstOrThrow()).attempts).toBe(2);
    });

    it('fonte fora da lista fixa falha e não deixa linha de job', async () => {
      const t = handler();
      await expect(t.handler.execute(msg('atacante'), NOW)).rejects.toThrow(/Fonte desconhecida/);
      expect(await prisma.jobRun.count()).toBe(0);
      expect(t.world.requests).toEqual([]);
    });
  });

  describe('aceite 3: fato relevante da CVM fica no ticker certo', () => {
    it('o FCA liga o CNPJ aos instrumentos e o IPE leva cada documento ao ticker da companhia', async () => {
      await instrument('PETR3');
      await instrument('PETR4');
      await instrument('VALE3');
      await instrument('ITUB4');
      const t = handler();
      await t.handler.execute(msg('cvm-ipe'), NOW);

      const cnpjs = await prisma.instrument.findMany({ orderBy: { ticker: 'asc' } });
      expect(cnpjs.map((i) => [i.ticker, i.cnpj])).toEqual([
        ['ITUB4', null],
        ['PETR3', '33000167000101'],
        ['PETR4', '33000167000101'],
        ['VALE3', '33592510000154'],
      ]);
      const rows = await prisma.newsItem.findMany({ orderBy: { title: 'asc' } });
      expect(rows.map((r) => [r.title, r.tickers])).toEqual([
        [
          'Fato Relevante: PETRÓLEO BRASILEIRO S.A. - PETROBRAS - Relatório de Produção e Vendas 3T26',
          ['PETR3', 'PETR4'],
        ],
        ['Fato Relevante: VALE S.A. - Atualização de projeções', ['VALE3']],
      ]); // a empresa sem instrumento não vira notícia
      expect(rows.every((r) => r.source === 'cvm-ipe')).toBe(true);
      expect(rows[0]?.publishedAt).toEqual(new Date('2026-10-28T03:00:00Z'));
      expect(
        (await prisma.fetchState.findMany({ orderBy: { source: 'asc' } })).map((s) => [
          s.source,
          s.etag,
        ]),
      ).toEqual([
        ['cvm-fca:2026', '"fca-1"'],
        ['cvm-ipe:2026', '"ipe-1"'],
      ]);
    });

    it('na busca seguinte (30 minutos depois) a CVM responde 304 e nada é baixado nem regravado', async () => {
      await instrument('PETR4');
      const t = handler();
      await t.handler.execute(msg('cvm-ipe'), NOW);
      const before = await prisma.newsItem.count();
      t.world.requests.length = 0;
      const second = new Date('2026-11-01T18:00:03Z');
      await t.handler.execute(msg('cvm-ipe', '2026-11-01T18:00:00Z'), second);
      expect(await prisma.newsItem.count()).toBe(before);
      // duas requisições, as duas condicionais (a fake só devolve o corpo se o ETag não bater)
      expect(t.world.requests).toHaveLength(2);
      // o 304 anda a hora da checagem e deixa os validadores como estavam (o painel da etapa 10 lê daqui)
      const states = await prisma.fetchState.findMany({ orderBy: { source: 'asc' } });
      expect(states.map((s) => [s.source, s.etag, s.checkedAt])).toEqual([
        ['cvm-fca:2026', '"fca-1"', second],
        ['cvm-ipe:2026', '"ipe-1"', second],
      ]);
    });
  });

  describe('BCB (macro)', () => {
    it('grava a série com a data do valor; a segunda busca só pede o que falta', async () => {
      const t = handler();
      await t.handler.execute(msg('bcb-sgs'), NOW);
      expect(await prisma.macroDaily.count()).toBe(5);
      const cdi = await prisma.macroDaily.findFirstOrThrow({ where: { series: 'cdi_daily_pct' } });
      expect(cdi.date.toISOString().slice(0, 10)).toBe('2026-10-29');
      expect(cdi.value.toFixed(6)).toBe('0.050788');

      // a primeira busca pediu cerca de um ano de histórico
      expect(t.world.urls.map((u) => u.searchParams.get('dataInicial'))).toEqual(
        Array(5).fill('27/09/2025'),
      );

      t.world.urls.length = 0;
      await t.handler.execute(
        msg('bcb-sgs', '2026-11-01T18:00:00Z'),
        new Date('2026-11-01T18:00:03Z'),
      );
      // a segunda pede só do último valor guardado (29/10) até hoje: ninguém refaz o histórico
      expect(
        t.world.urls.map((u) => [
          u.searchParams.get('dataInicial'),
          u.searchParams.get('dataFinal'),
        ]),
      ).toEqual(Array(5).fill(['29/10/2026', '01/11/2026']));
      expect(await prisma.macroDaily.count()).toBe(5);
    });
  });
});
