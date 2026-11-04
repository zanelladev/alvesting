import type { QueueMessage } from '@alvesting/contracts';
import type { EodHandler } from './eod.handler.js';
import type { UniverseHandler } from './universe.handler.js';

// O handler da fila `market` (plano 5.5): roteia eod e universe. É uma função comum (message) => Promise<void>,
// como o MessagingService espera: testável sem fila.
export class MarketQueueHandler {
  // clock: só o ensaio (arena:ensaio) o passa, para o eod e o universo usarem a hora do dia simulado; em produção fica de fora e eles usam o
  // relógio da máquina
  constructor(
    private readonly eod: Pick<EodHandler, 'execute'>,
    private readonly universe: Pick<UniverseHandler, 'execute'>,
    private readonly clock?: () => Date,
  ) {}

  readonly handle = async (message: QueueMessage): Promise<void> => {
    switch (message.type) {
      case 'eod':
        await (this.clock
          ? this.eod.execute(message.date, this.clock())
          : this.eod.execute(message.date));
        return;
      case 'universe':
        await (this.clock
          ? this.universe.execute(message.week, this.clock())
          : this.universe.execute(message.week));
        return;
      default:
        // handleDelivery já manda para a DLQ o que é de outra fila; isto é só a rede de segurança
        throw new Error(`A fila market não trata mensagens ${message.type}`);
    }
  };
}
