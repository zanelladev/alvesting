import { Module } from '@nestjs/common';
import { JobRunStore } from '../messaging/infrastructure/job-run.store.js';
import { MessagingService } from '../messaging/infrastructure/messaging.service.js';
import { MessagingModule } from '../messaging/messaging.module.js';
import { BcbFetcher } from './application/bcb-fetcher.js';
import { CvmFetcher } from './application/cvm-fetcher.js';
import { FetchHandler } from './application/fetch.handler.js';
import { NewsSchedulers } from './application/news-schedulers.js';
import { RssFetcher } from './application/rss-fetcher.js';
import { MacroRepository } from './infrastructure/macro.repository.js';
import { NewsRepository } from './infrastructure/news.repository.js';

// Notícias, documentos da CVM e macro do BCB (etapa 5): o worker-data consome a fila `news` com o FetchHandler, uma
// mensagem por fonte da lista fixa; o sched-news só publica (NewsSchedulers). Os buscadores usam o `fetch` global.
@Module({
  imports: [MessagingModule],
  providers: [
    NewsRepository,
    MacroRepository,
    {
      provide: RssFetcher,
      inject: [NewsRepository],
      useFactory: (news: NewsRepository) => new RssFetcher(news),
    },
    {
      provide: CvmFetcher,
      inject: [NewsRepository],
      useFactory: (news: NewsRepository) => new CvmFetcher(news),
    },
    {
      provide: BcbFetcher,
      inject: [MacroRepository],
      useFactory: (macro: MacroRepository) => new BcbFetcher(macro),
    },
    {
      provide: FetchHandler,
      inject: [JobRunStore, RssFetcher, CvmFetcher, BcbFetcher],
      useFactory: (...deps: ConstructorParameters<typeof FetchHandler>) =>
        new FetchHandler(...deps),
    },
    {
      provide: NewsSchedulers,
      inject: [MessagingService],
      useFactory: (messaging: MessagingService) => new NewsSchedulers(messaging),
    },
  ],
  exports: [FetchHandler, NewsSchedulers],
})
export class NewsModule {}
