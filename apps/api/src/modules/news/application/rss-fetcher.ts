import { Logger } from '@nestjs/common';
import { rssDraft, seenNow, type NewsDraft } from '../domain/draft.js';
import { parseRss } from '../domain/rss.js';
import type { RssSource } from '../domain/sources.js';
import type { NewsRepository } from '../infrastructure/news.repository.js';
import { fetchLimited } from '../infrastructure/source-http.js';

// Os feeds têm de 25 a 130 KB (conferido em 01/11/2026); 2 MB só impede uma resposta errada de lotar a memória.
const MAX_BYTES = 2 * 1024 * 1024;

export interface RssResult {
  // itens que o feed trouxe, os aproveitáveis (URL http(s) e título que sobrou na limpeza) e os gravados agora
  items: number;
  usable: number;
  created: number;
}

// Uma busca de feed RSS (mensagem `fetch` de uma fonte RSS): baixa o feed da lista fixa, limpa o texto, marca os
// tickers e grava. A mesma notícia buscada de novo não duplica (url_hash).
// Nenhum conteúdo do feed vai para log ou mensagem de erro: só contagens.
export class RssFetcher {
  private readonly logger = new Logger(RssFetcher.name);

  constructor(
    private readonly news: Pick<NewsRepository, 'knownTickers' | 'saveNews'>,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async run(source: RssSource, now: Date): Promise<RssResult> {
    const outcome = await fetchLimited(source.url, {
      allowedHosts: [new URL(source.url).hostname],
      maxBytes: MAX_BYTES,
      accept: 'application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
      fetchFn: this.fetchFn,
    });
    if (outcome.status !== 'ok') {
      throw new Error(
        `${source.id}: o feed ${outcome.status === 'not_found' ? 'não existe mais (404)' : 'respondeu 304 sem pedido condicional'}`,
      );
    }
    return this.ingest(source, outcome.body.toString('utf8'), now);
  }

  // O que acontece com o texto do feed, venha da rede ou de um arquivo salvo (news:import, o replay de um feed): lê,
  // limpa, marca os tickers e grava. `now` é a hora da busca (nenhuma notícia é publicada depois dela); a hora em que o
  // lote passa a valer como "visto" é a da gravação (seenNow), ou `seenAt` quando quem chama manda uma (o replay).
  async ingest(source: RssSource, text: string, now: Date, seenAt?: Date): Promise<RssResult> {
    const xml = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // BOM
    const items = parseRss(xml);
    const known = await this.news.knownTickers();
    const drafts = items
      .map((item) => rssDraft(source, item, known, now))
      .filter((draft): draft is NewsDraft => draft !== null);
    const created = await this.news.saveNews(drafts, seenAt ?? seenNow(now));
    this.logger.log(
      { source: source.id, items: items.length, usable: drafts.length, created },
      'feed RSS lido',
    );
    return { items: items.length, usable: drafts.length, created };
  }
}
