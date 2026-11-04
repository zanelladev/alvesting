import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '../../../common/id.js';
import {
  integrationTitle,
  openTestDatabase,
  testDatabaseUrl,
} from '../../../infrastructure/database/test-database.fixture.js';
import type { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import type { NewsDraft } from '../domain/draft.js';
import { urlHash } from '../domain/url.js';
import { NewsRepository } from './news.repository.js';

const draft = (path: string, overrides: Partial<NewsDraft> = {}): NewsDraft => {
  const url = `https://exemplo.com.br/${path}`;
  return {
    url,
    urlHash: urlHash(url)!,
    source: 'infomoney',
    title: `Título ${path}`,
    snippet: 'Resumo.',
    tickers: ['PETR4'],
    publishedAt: new Date('2026-11-01T15:00:00Z'),
    ...overrides,
  };
};
const SEEN = new Date('2026-11-01T16:00:00Z');

describe.skipIf(!testDatabaseUrl)(integrationTitle('NewsRepository'), () => {
  let prisma: PrismaService;
  let repo: NewsRepository;

  beforeAll(async () => {
    prisma = await openTestDatabase(testDatabaseUrl!);
    repo = new NewsRepository(prisma);
  }, 120_000);

  beforeEach(async () => {
    await prisma.newsItem.deleteMany();
    await prisma.fetchState.deleteMany();
    await prisma.universeMember.deleteMany();
    await prisma.universeSnapshot.deleteMany();
    await prisma.dailyBar.deleteMany();
    await prisma.instrument.deleteMany();
  });

  afterAll(async () => {
    await prisma.onModuleDestroy();
  });

  const instrument = (ticker: string, cnpj?: string) =>
    prisma.instrument.create({
      data: {
        id: newId(),
        ticker,
        name: ticker,
        spec: 'ON',
        kind: 'STOCK',
        lastSeen: new Date('2026-10-30T00:00:00Z'),
        cnpj: cnpj ?? null,
      },
    });

  describe('saveNews', () => {
    it('grava a notícia com a hora em que foi vista e os tickers', async () => {
      await expect(
        repo.saveNews([draft('a', { tickers: ['PETR4', 'VALE3'] })], SEEN),
      ).resolves.toBe(1);
      const row = await prisma.newsItem.findFirstOrThrow();
      expect(row).toMatchObject({
        url: 'https://exemplo.com.br/a',
        source: 'infomoney',
        title: 'Título a',
        snippet: 'Resumo.',
        tickers: ['PETR4', 'VALE3'],
      });
      expect(row.firstSeenAt).toEqual(SEEN);
      expect(row.publishedAt).toEqual(new Date('2026-11-01T15:00:00Z'));
      expect(row.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    });

    it('a mesma notícia buscada de novo não duplica, e a primeira hora vista se mantém', async () => {
      await repo.saveNews([draft('a')], SEEN);
      await expect(repo.saveNews([draft('a')], new Date('2026-11-01T17:00:00Z'))).resolves.toBe(0);
      expect(await prisma.newsItem.count()).toBe(1);
      expect((await prisma.newsItem.findFirstOrThrow()).firstSeenAt).toEqual(SEEN);
    });

    it('a mesma URL duas vezes no mesmo lote, ou duas cargas ao mesmo tempo, dão uma linha só', async () => {
      await repo.saveNews([draft('a'), draft('a'), draft('b')], SEEN);
      expect(await prisma.newsItem.count()).toBe(2);
      await Promise.all(
        Array.from({ length: 5 }, () => repo.saveNews([draft('c'), draft('d')], SEEN)),
      );
      expect(await prisma.newsItem.count()).toBe(4);
    });

    it('lote vazio não faz nada', async () => {
      await expect(repo.saveNews([], SEEN)).resolves.toBe(0);
    });

    it('o banco recusa o que o código já recusa: link javascript:, título vazio ou longo, hash torto', async () => {
      const bad: Array<Partial<NewsDraft>> = [
        { url: 'javascript:alert(1)' },
        { url: 'data:text/html,x' },
        { title: '' },
        { title: 'T'.repeat(301) },
        { snippet: 'S'.repeat(301) },
        { urlHash: 'ZZ' },
        { source: 'Fonte Inválida' },
      ];
      for (const [index, override] of bad.entries()) {
        await expect(
          repo.saveNews([draft(`ruim-${index}`, override)], SEEN),
          JSON.stringify(override),
        ).rejects.toThrow();
      }
      expect(await prisma.newsItem.count()).toBe(0);
    });

    it('aceita título e trecho no limite de 300 caracteres, com acento e emoji', async () => {
      await repo.saveNews(
        [draft('limite', { title: 'ç'.repeat(300), snippet: '😀'.repeat(300) })],
        SEEN,
      );
      expect(await prisma.newsItem.count()).toBe(1);
    });

    // A migration 20261101190000 (revisões de banco e de segurança): rede de segurança para o caminho que esquecer a limpeza
    // ou o carimbo de hora.
    it('o banco recusa tag no título ou no trecho, hora de publicação depois da vista e URL de mais de 2048', async () => {
      const bad: Array<Partial<NewsDraft>> = [
        { title: '<b>negrito</b>' },
        { title: 'texto </script>' },
        { snippet: 'x <script>alert(1)</script>' },
        { snippet: 'declaração <!DOCTYPE html>' },
        { title: 'xml <?php echo 1 ?>' },
        { publishedAt: new Date(SEEN.getTime() + 1) },
        { url: `https://exemplo.com.br/${'a'.repeat(2030)}` },
      ];
      for (const [index, override] of bad.entries()) {
        await expect(
          repo.saveNews([draft(`ruim-${index}`, override)], SEEN),
          JSON.stringify(override).slice(0, 80),
        ).rejects.toThrow();
      }
      expect(await prisma.newsItem.count()).toBe(0);
    });

    it('o "<" solto, a hora igual à da vista e a URL no teto passam', async () => {
      await repo.saveNews(
        [
          draft('menor', { title: 'Lucro < 5% e 3 < 4 -> ok', snippet: 'a < b e c > d' }),
          draft('igual', { publishedAt: SEEN }),
          draft('x'.repeat(2048 - 'https://exemplo.com.br/'.length), { title: 'URL no teto' }),
        ],
        SEEN,
      );
      expect(await prisma.newsItem.count()).toBe(3);
    });

    it('tickers nunca é NULL: o INSERT que esquece a coluna ganha lista vazia, e NULL explícito é recusado', async () => {
      const id = newId();
      await prisma.$executeRaw`INSERT INTO news_item (id, url_hash, url, source, title, snippet, published_at, first_seen_at)
        VALUES (${id}, ${'a'.repeat(64)}, 'https://exemplo.com.br/sql', 'infomoney', 'T', '', ${SEEN}::timestamptz, ${SEEN}::timestamptz)`;
      expect((await prisma.newsItem.findUniqueOrThrow({ where: { id } })).tickers).toEqual([]);

      await expect(
        prisma.$executeRaw`INSERT INTO news_item (id, url_hash, url, source, title, snippet, tickers, published_at, first_seen_at)
          VALUES (${newId()}, ${'b'.repeat(64)}, 'https://exemplo.com.br/sql2', 'infomoney', 'T', '', NULL, ${SEEN}::timestamptz, ${SEEN}::timestamptz)`,
      ).rejects.toThrow();
    });
  });

  describe('instrumentos e CNPJ', () => {
    it('knownTickers devolve os tickers dos instrumentos', async () => {
      await instrument('PETR4');
      await instrument('VALE3');
      expect(await repo.knownTickers()).toEqual(new Set(['PETR4', 'VALE3']));
    });

    it('applyCnpj grava o CNPJ nos instrumentos citados e só conta o que mudou', async () => {
      await instrument('PETR3');
      await instrument('PETR4');
      await instrument('VALE3');
      const map = new Map([
        ['PETR3', '33000167000101'],
        ['PETR4', '33000167000101'],
        ['XXXX3', '11111111000111'], // sem instrumento: ignorado
      ]);
      await expect(repo.applyCnpj(map)).resolves.toBe(2);
      await expect(repo.applyCnpj(map)).resolves.toBe(0); // segunda vez: nada muda
      const rows = await prisma.instrument.findMany({ orderBy: { ticker: 'asc' } });
      expect(rows.map((r) => [r.ticker, r.cnpj])).toEqual([
        ['PETR3', '33000167000101'],
        ['PETR4', '33000167000101'],
        ['VALE3', null],
      ]);
    });

    it('applyCnpj com o FCA corrigindo um CNPJ troca o valor; mapa vazio não faz nada', async () => {
      await instrument('PETR4', '11111111000111');
      await expect(repo.applyCnpj(new Map([['PETR4', '33000167000101']]))).resolves.toBe(1);
      expect((await prisma.instrument.findFirstOrThrow()).cnpj).toBe('33000167000101');
      await expect(repo.applyCnpj(new Map())).resolves.toBe(0);
    });

    it('o banco recusa CNPJ que não tem 14 dígitos', async () => {
      await instrument('PETR4');
      await expect(repo.applyCnpj(new Map([['PETR4', '33.000.167/0001-01']]))).rejects.toThrow();
      await expect(repo.applyCnpj(new Map([['PETR4', '123']]))).rejects.toThrow();
    });

    it('tickersByCnpj agrupa os tickers por companhia, em ordem', async () => {
      await instrument('PETR4', '33000167000101');
      await instrument('PETR3', '33000167000101');
      await instrument('VALE3', '33592510000154');
      await instrument('ITUB4');
      const map = await repo.tickersByCnpj(['33000167000101', '33592510000154', '99999999000199']);
      expect(map.get('33000167000101')).toEqual(['PETR3', 'PETR4']);
      expect(map.get('33592510000154')).toEqual(['VALE3']);
      expect(map.has('99999999000199')).toBe(false);
      expect((await repo.tickersByCnpj([])).size).toBe(0);
    });
  });

  describe('estado do GET condicional', () => {
    it('não tem nada antes da primeira vez; guarda e troca os validadores', async () => {
      expect(await repo.fetchState('cvm-ipe:2026')).toBeUndefined();
      await repo.saveFetchState(
        'cvm-ipe:2026',
        { etag: '"a"', lastModified: 'Sun, 01 Nov 2026 10:00:17 GMT' },
        SEEN,
      );
      expect(await repo.fetchState('cvm-ipe:2026')).toEqual({
        etag: '"a"',
        lastModified: 'Sun, 01 Nov 2026 10:00:17 GMT',
      });
      await repo.saveFetchState('cvm-ipe:2026', { etag: '"b"' }, SEEN);
      expect(await repo.fetchState('cvm-ipe:2026')).toEqual({ etag: '"b"' });
      expect(await prisma.fetchState.count()).toBe(1);
    });

    // A checagem que deu 304 só anda o relógio: checked_at diz "última checagem" (o painel da etapa 10 lê daqui), e os
    // validadores continuam os da última carga.
    it('touchFetchState atualiza só a hora da checagem; sem linha, não cria nada', async () => {
      await repo.saveFetchState(
        'cvm-ipe:2026',
        { etag: '"a"', lastModified: 'Sun, 01 Nov 2026' },
        SEEN,
      );
      const later = new Date('2026-11-01T17:30:00Z');
      await repo.touchFetchState('cvm-ipe:2026', later);
      const row = await prisma.fetchState.findUniqueOrThrow({ where: { source: 'cvm-ipe:2026' } });
      expect(row.checkedAt).toEqual(later);
      expect(row.etag).toBe('"a"');
      expect(row.lastModified).toBe('Sun, 01 Nov 2026');

      await repo.touchFetchState('cvm-ipe:2027', later);
      expect(await prisma.fetchState.count()).toBe(1);
    });
  });
});
