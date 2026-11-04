import { Injectable } from '@nestjs/common';
import { newId } from '../../../common/id.js';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import type { NewsDraft } from '../domain/draft.js';
import type { Validators } from './source-http.js';

// Notícias, CNPJ dos instrumentos e o estado do GET condicional da CVM. Tudo idempotente: a mesma busca duas vezes
// (ou duas ao mesmo tempo) dá o mesmo banco. news_item.url_hash é único e o INSERT ignora o que já existe.
@Injectable()
export class NewsRepository {
  constructor(private readonly prisma: PrismaService) {}

  // Os tickers que a notícia pode citar: os instrumentos que a etapa 4 conhece (ações e a referência BOVA11).
  async knownTickers(): Promise<Set<string>> {
    const rows = await this.prisma.instrument.findMany({ select: { ticker: true } });
    return new Set(rows.map((row) => row.ticker));
  }

  // seenAt é a primeira vez que o worker viu o lote. Devolve quantas linhas entraram; as que já existiam ficam como
  // estão (inclusive a primeira hora vista, que decide em qual briefing a notícia entra).
  async saveNews(drafts: readonly NewsDraft[], seenAt: Date): Promise<number> {
    if (drafts.length === 0) return 0;
    const { count } = await this.prisma.newsItem.createMany({
      data: drafts.map((item) => ({
        id: newId(),
        urlHash: item.urlHash,
        url: item.url,
        source: item.source,
        title: item.title,
        snippet: item.snippet,
        tickers: item.tickers,
        publishedAt: item.publishedAt,
        firstSeenAt: seenAt,
      })),
      skipDuplicates: true,
    });
    return count;
  }

  // ticker -> CNPJ nos instrumentos que já existem. Devolve quantos mudaram (0 na repetição).
  async applyCnpj(map: ReadonlyMap<string, string>): Promise<number> {
    if (map.size === 0) return 0;
    const tickers = [...map.keys()];
    const cnpjs = tickers.map((ticker) => map.get(ticker)!);
    return this.prisma.$executeRaw`
      UPDATE instrument SET cnpj = m.cnpj
      FROM unnest(${tickers}::text[], ${cnpjs}::text[]) AS m(ticker, cnpj)
      WHERE instrument.ticker = m.ticker AND instrument.cnpj IS DISTINCT FROM m.cnpj`;
  }

  // CNPJ -> tickers (em ordem) dos instrumentos da companhia.
  async tickersByCnpj(cnpjs: readonly string[]): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (cnpjs.length === 0) return result;
    const rows = await this.prisma.instrument.findMany({
      where: { cnpj: { in: [...cnpjs] } },
      select: { ticker: true, cnpj: true },
      orderBy: { ticker: 'asc' },
    });
    for (const { ticker, cnpj } of rows) {
      if (cnpj === null) continue;
      const list = result.get(cnpj);
      if (list) list.push(ticker);
      else result.set(cnpj, [ticker]);
    }
    return result;
  }

  async fetchState(source: string): Promise<Validators | undefined> {
    const row = await this.prisma.fetchState.findUnique({ where: { source } });
    if (!row) return undefined;
    return {
      ...(row.etag === null ? {} : { etag: row.etag }),
      ...(row.lastModified === null ? {} : { lastModified: row.lastModified }),
    };
  }

  // A checagem que deu 304: o arquivo não mudou, mas foi conferido agora. É o que faz `checked_at` dizer "última checagem",
  // e não "última carga" (o painel da etapa 10 lê daqui). Sem linha, o arquivo nunca foi processado: nada a atualizar.
  async touchFetchState(source: string, at: Date): Promise<void> {
    await this.prisma.fetchState.updateMany({ where: { source }, data: { checkedAt: at } });
  }

  // Só depois de o arquivo ter sido processado por inteiro: validador gravado antes faria uma falha no meio pular o
  // arquivo na próxima busca.
  async saveFetchState(source: string, validators: Validators, at: Date): Promise<void> {
    const data = {
      etag: validators.etag ?? null,
      lastModified: validators.lastModified ?? null,
      checkedAt: at,
    };
    await this.prisma.fetchState.upsert({
      where: { source },
      create: { source, ...data },
      update: data,
    });
  }
}
