import type { QueueMessage } from '@alvesting/contracts';
import { JobBusyError, type JobRunStore } from '../../messaging/infrastructure/job-run.store.js';
import { sourceById } from '../domain/sources.js';
import type { BcbFetcher } from './bcb-fetcher.js';
import type { CvmFetcher } from './cvm-fetcher.js';
import type { RssFetcher } from './rss-fetcher.js';

type FetchMessage = Extract<QueueMessage, { type: 'fetch' }>;

export type FetchOutcome = 'fetched' | 'already_done';

// A mensagem `fetch {fonte, slot}` da fila `news` (plano 5.5): uma por fonte, a cada 30 minutos. A fonte tem de estar
// na lista fixa do código (domain/sources.ts): nenhuma URL vem da mensagem. Idempotente por job_run (fetch + fonte +
// slot): a mesma entrega repetida não busca de novo; a busca em si também é idempotente (url_hash único, macro por
// série e data, GET condicional), então uma cópia a mais é inofensiva.
export class FetchHandler {
  constructor(
    private readonly jobs: Pick<JobRunStore, 'claim' | 'succeed' | 'fail'>,
    private readonly rss: Pick<RssFetcher, 'run'>,
    private readonly cvm: Pick<CvmFetcher, 'run'>,
    private readonly bcb: Pick<BcbFetcher, 'run'>,
    // só o ensaio (arena:ensaio) o passa, para a função da fila usar a hora do dia simulado; em produção vale o relógio da máquina
    private readonly clock: () => Date = () => new Date(),
  ) {}

  readonly handle = async (message: QueueMessage): Promise<void> => {
    if (message.type !== 'fetch') {
      // handleDelivery já manda para a DLQ o que é de outra fila; isto é só a rede de segurança
      throw new Error(`A fila news não trata mensagens ${message.type}`);
    }
    await this.execute(message, this.clock());
  };

  // `now` é a hora do começo da busca: dela saem as janelas da CVM e do BCB e o teto de published_at. A hora em que as
  // notícias passam a valer como vistas (first_seen_at) é a da gravação, carimbada pelos buscadores (draft.ts, seenNow).
  async execute(message: FetchMessage, now: Date = new Date()): Promise<FetchOutcome> {
    // antes de assumir: uma fonte que não existe não deixa linha de job para trás
    const source = sourceById(message.source);
    if (!source) throw new Error(`Fonte desconhecida: ${message.source}`);

    const claimed = await this.jobs.claim(message);
    if (claimed.status === 'done') return 'already_done';
    if (claimed.status === 'busy') throw new JobBusyError(message);

    try {
      switch (source.kind) {
        case 'rss':
          await this.rss.run(source, now);
          break;
        case 'cvm':
          await this.cvm.run(now);
          break;
        case 'bcb':
          await this.bcb.run(now);
          break;
      }
      await this.jobs.succeed(claimed.claim);
      return 'fetched';
    } catch (error) {
      await this.jobs.fail(claimed.claim, error);
      throw error;
    }
  }
}
