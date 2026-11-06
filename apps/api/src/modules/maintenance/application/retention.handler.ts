import { Logger } from '@nestjs/common';
import type { QueueMessage } from '@alvesting/contracts';
import { JobBusyError, type JobRunStore } from '../../messaging/infrastructure/job-run.store.js';
import {
  RETENTION_TABLES,
  type RetentionStore,
  type RetentionTable,
} from '../infrastructure/retention.repository.js';

const DAY_MS = 86_400_000;

// Há quantos dias a linha passa a ser apagada, contados do relógio injetado. A limpeza é DIÁRIA (10:00 de Brasília, cron `0 13 * * *` do
// sched-retention), então o tempo que a linha de fato fica é o corte MAIS até 1 dia de espera pela limpeza seguinte. A política de privacidade
// (item 5) promete esse PIOR CASO, item a item, e o JOBS.md 8.1 e o CONTA.md 5 têm a conta (o teste de integração roda o relógio de limpeza
// em limpeza e confere cada promessa). O pior caso é o de um relógio perfeito e de nenhuma limpeza perdida: o texto da política também diz que,
// se uma limpeza falhar ou não rodar, o prazo cresce pelos dias sem limpeza (o legal-documents.spec.ts confere o "6 dias" do texto contra o
// RETENTION_DAYS abaixo):
//  - user: cadastro NUNCA confirmado criado há mais de 6 dias (6 + até 1 = some em até 7 dias depois de criado); o nome e o e-mail de um
//    cadastro que ninguém confirmou podem ocupar o endereço de outra pessoa. A cascata do usuário leva session, account e consent.
//  - session: já vencida, sem folga (some em até 1 dia depois de vencer). A sessão vale 7 dias desde o último uso (Better Auth), então o
//    registro de uma que você deixou de usar fica até 8 dias. O Better Auth só apaga a vencida quando ela é apresentada de novo.
//  - verification: vencida, sem folga (o link de 60 e de 30 minutos já não vale; some em até 1 dia depois de vencer).
//  - job_run do tipo fetch: mais de 30 dias. A fila news grava um por fonte e por slot de 30 minutos (uns 290 por dia) e a chave não volta.
// Mudar o corte do `user` ou a cadência do cron muda a promessa: o texto da política, a versão dela e o teste andam juntos.
// ponytail: news_item NÃO tem retenção, de propósito. É o histórico público (a lista de notícias e a página da ação) e o que mantém a arena
// reprodutível (o briefing congelado cita as notícias). Tamanho: até uns 700 itens por dia (docs/API.md, seção 4), 255 mil por ano; medido
// em 250 mil linhas sintéticas a tabela tem 58 MB e os índices uns 40 MB, e com o trecho de 300 caracteres de verdade chega a uns 250 MB
// por ano no pior caso, contra 32 GB de disco (estimativa, não medida). Teto: 1 milhão de linhas (uns 4 anos no pior caso), onde o API.md já
// manda rever a consulta por ticker. Caminho: arquivar no Blob o que passar de N anos e apagar do banco, ou limitar a lista por janela.
// A retenção de 180 dias de chat_thread e chat_message entra com a etapa 13.
export const RETENTION_DAYS: Readonly<Record<RetentionTable, number>> = {
  user: 6,
  session: 0,
  verification: 0,
  job_run: 30,
};

// Lote pequeno: o comando segura o lock por milissegundos. O teto de lotes por tabela (500 mil linhas) vem do mesmo cuidado: uma tabela
// que cresceu absurdamente é terminada no dia seguinte, e não numa entrega de horas.
const BATCH_SIZE = 500;
const MAX_BATCHES = 1000;

export type RetentionResult =
  { outcome: 'done'; deleted: Record<RetentionTable, number> } | { outcome: 'already_done' };

// A mensagem `retention {data}` da fila `maintenance` (plano 5.5): a limpeza periódica, todo dia. Idempotente pela linha de job_run
// (retention + data) e porque o que apaga é "o que passou do corte", que um segundo DELETE não acha. O relógio é injetado (o corte sai
// dele, e não da máquina); cada DELETE vai ao log com a tabela, o lote, quantas linhas e o corte, e nunca com uma linha (dado pessoal).
export class RetentionHandler {
  private readonly logger = new Logger(RetentionHandler.name);
  private readonly batchSize: number;

  constructor(
    private readonly jobs: Pick<JobRunStore, 'claim' | 'succeed' | 'fail'>,
    private readonly store: RetentionStore,
    private readonly clock: () => Date = () => new Date(),
    options: { batchSize?: number } = {},
  ) {
    this.batchSize = options.batchSize ?? BATCH_SIZE;
  }

  readonly handle = async (message: QueueMessage): Promise<void> => {
    if (message.type !== 'retention') {
      throw new Error(`A retenção não trata mensagens ${message.type}`);
    }
    await this.execute(message.date);
  };

  async execute(date: string): Promise<RetentionResult> {
    const message = { type: 'retention', date } as const;
    const claimed = await this.jobs.claim(message);
    if (claimed.status === 'done') return { outcome: 'already_done' };
    if (claimed.status === 'busy') throw new JobBusyError(message);
    try {
      const deleted = await this.run(this.clock());
      await this.jobs.succeed(claimed.claim);
      this.logger.log({ date, ...deleted }, 'retenção concluída');
      return { outcome: 'done', deleted };
    } catch (error) {
      await this.jobs.fail(claimed.claim, error);
      throw error;
    }
  }

  private async run(now: Date): Promise<Record<RetentionTable, number>> {
    const deleted = { user: 0, session: 0, verification: 0, job_run: 0 };
    for (const table of RETENTION_TABLES) {
      const cutoff = new Date(now.getTime() - RETENTION_DAYS[table] * DAY_MS);
      for (let batch = 1; batch <= MAX_BATCHES; batch += 1) {
        const count = await this.store.deleteBatch(table, cutoff, this.batchSize);
        deleted[table] += count;
        this.logger.log(
          { table, batch, deleted: count, cutoff: cutoff.toISOString() },
          'retenção: linhas apagadas',
        );
        // lote incompleto: acabou o que passou do corte
        if (count < this.batchSize) break;
        if (batch === MAX_BATCHES) {
          this.logger.warn(
            { table, batches: MAX_BATCHES },
            'retenção: teto de lotes; segue na próxima',
          );
        }
      }
    }
    return deleted;
  }
}
