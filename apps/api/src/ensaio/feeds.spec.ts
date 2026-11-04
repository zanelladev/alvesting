import { describe, expect, it } from 'vitest';
import { loadTradingCalendar } from '../modules/market-data/domain/trading-calendar.js';
import { MACRO_SERIES, isNoValuesResponse, parseSgs, sgsUrl } from '../modules/news/domain/bcb.js';
import { cvmDraft } from '../modules/news/domain/draft.js';
import { parseRss } from '../modules/news/domain/rss.js';
import { NEWS_SOURCES } from '../modules/news/domain/sources.js';
import { createSgsFetch, cvmDocuments, buildNews, rssFeedXml } from './feeds.js';
import { buildMarket } from './market.js';

const calendar = loadTradingCalendar();
const market = buildMarket({
  seed: 1,
  stocks: 40,
  firstDay: '2026-11-03',
  sessions: 5,
  calendar,
});
const rssSources = NEWS_SOURCES.flatMap((source) => (source.kind === 'rss' ? [source] : []));
const news = buildNews(market, 1);

describe('buildNews e rssFeedXml: os quatro feeds RSS do ensaio', () => {
  it('cada feed é um RSS 2.0 que o parser de verdade lê, só com o que já foi publicado, do mais novo para o mais velho, em até 10 itens', () => {
    const upTo = new Date('2026-11-03T10:00:00Z'); // 07:00 de Brasília no 1º pregão
    for (const source of rssSources) {
      const items = parseRss(rssFeedXml(source, news, upTo));
      expect(items.length, source.id).toBeGreaterThan(0);
      expect(items.length, source.id).toBeLessThanOrEqual(10);
      for (const item of items) {
        expect(item.publishedAt, source.id).not.toBeNull();
        expect(item.publishedAt!.getTime(), source.id).toBeLessThanOrEqual(upTo.getTime());
        expect(item.link).toMatch(/^https:\/\/noticias\.invalid\//);
      }
      const times = items.map((item) => item.publishedAt!.getTime());
      expect(times).toEqual([...times].sort((a, b) => b - a));
    }
  });

  it('é determinístico pela semente, e outra semente muda os títulos', () => {
    const upTo = new Date('2026-11-04T10:00:00Z');
    const source = rssSources[0]!;
    expect(rssFeedXml(source, buildNews(market, 1), upTo)).toBe(rssFeedXml(source, news, upTo));
    expect(rssFeedXml(source, buildNews(market, 2), upTo)).not.toBe(rssFeedXml(source, news, upTo));
  });

  it('marca ações do universo pelo ticker no título (o buscador marca só o que está escrito)', () => {
    const tickers = new Set(market.stocks.map((s) => s.ticker));
    const withTicker = news.filter((item) => [...tickers].some((t) => item.title.includes(t)));
    expect(withTicker.length).toBeGreaterThan(news.length / 4);
  });

  it('traz uma notícia com instrução embutida na Agência Brasil, que chega aos modelos só como dado', () => {
    const injected = news.filter((item) => /ignore as instruções/i.test(item.title));
    expect(injected).toHaveLength(1);
    expect(injected[0]!.source).toBe('agencia-brasil');
    // sai antes do corte das 07:30 do 1º pregão, para entrar no primeiro briefing
    expect(injected[0]!.publishedAt.getTime()).toBeLessThan(
      new Date('2026-11-03T10:30:00Z').getTime(),
    );
  });
});

describe('cvmDocuments: o fato relevante sintético', () => {
  it('é aceito pelo montador de notícia da CVM e cai no ticker certo', () => {
    const docs = cvmDocuments(market);
    expect(docs.length).toBeGreaterThan(0);
    for (const doc of docs) {
      const draft = cvmDraft(doc, [doc.ticker], new Date('2026-11-03T10:00:00Z'));
      expect(draft).not.toBeNull();
      expect(draft!.tickers).toEqual([doc.ticker]);
      expect(draft!.source).toBe('cvm-ipe');
    }
  });
});

describe('createSgsFetch: o SGS do BCB sintético, com a defasagem de um dia', () => {
  const at = (iso: string) => new Date(iso);
  const call = async (now: Date, code: number, from: string, to: string) => {
    const series = MACRO_SERIES.find((s) => s.code === code)!;
    const response = await createSgsFetch({ now: () => now, calendar, seed: 1 })(
      sgsUrl(series, from, to),
    );
    return { series, response };
  };

  it('devolve só os pontos da janela pedida, no formato que o parser de verdade lê', async () => {
    const { series, response } = await call(
      at('2026-11-04T10:00:00Z'),
      12,
      '2026-10-26',
      '2026-11-04',
    );
    expect(response.status).toBe(200);
    const points = parseSgs(series, await response.json(), {
      from: '2026-10-26',
      to: '2026-11-04',
    });
    expect(points.length).toBeGreaterThan(0);
    for (const point of points) expect(point.value).toMatch(/^0\.0\d{5}$/); // 6 casas
  });

  it('o CDI de um dia só aparece no dia seguinte, e só nos dias de pregão (o 02/11 é Finados)', async () => {
    const { series, response } = await call(
      at('2026-11-04T10:00:00Z'),
      12,
      '2026-10-26',
      '2026-11-04',
    );
    const dates = parseSgs(series, await response.json()).map((p) => p.date);
    expect(dates).toContain('2026-11-03');
    expect(dates).not.toContain('2026-11-04'); // o de hoje só sai amanhã
    expect(dates).not.toContain('2026-11-02');
    expect(dates).not.toContain('2026-10-31'); // sábado
  });

  it('janela sem valor é o 404 do SGS ("Value(s) not found"), que o buscador trata como nada de novo', async () => {
    const { response } = await call(at('2026-11-03T10:00:00Z'), 12, '2026-11-03', '2026-11-03');
    expect(response.status).toBe(404);
    expect(isNoValuesResponse(new Uint8Array(await response.arrayBuffer()))).toBe(true);
  });

  it('cada série respeita as casas dela (Selic 2, IPCA 2, dólar 4) e é determinística', async () => {
    for (const series of MACRO_SERIES) {
      const a = await call(at('2026-11-04T10:00:00Z'), series.code, '2026-09-01', '2026-11-04');
      const points = parseSgs(series, await a.response.json());
      expect(points.length, series.id).toBeGreaterThan(0);
      for (const point of points) {
        expect(point.value.split('.')[1]).toHaveLength(series.scale);
      }
      const b = await call(at('2026-11-04T10:00:00Z'), series.code, '2026-09-01', '2026-11-04');
      expect(JSON.stringify(parseSgs(series, await b.response.json()))).toBe(
        JSON.stringify(points),
      );
    }
  });

  it('recusa host e série fora do SGS (o buscador real já restringe; aqui é a rede de segurança do ensaio)', async () => {
    const fetchFn = createSgsFetch({ now: () => at('2026-11-04T10:00:00Z'), calendar, seed: 1 });
    await expect(fetchFn('https://example.com/dados/serie/bcdata.sgs.12/dados')).rejects.toThrow(
      /fora do SGS/,
    );
    await expect(
      fetchFn(
        'https://api.bcb.gov.br/dados/serie/bcdata.sgs.999/dados?formato=json&dataInicial=01/11/2026&dataFinal=04/11/2026',
      ),
    ).rejects.toThrow(/série/);
  });
});
