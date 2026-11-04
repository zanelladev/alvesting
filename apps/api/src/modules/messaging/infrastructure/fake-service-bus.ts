import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// O Service Bus FALSO (SERVICEBUS_FAKE_DIR; só fora de produção, service-bus-client.ts): o pedaço do cliente do SDK que as rotas de admin
// usam, em arquivos. Existe para o e2e do painel (o emulador do Service Bus não cabe na máquina do Artur, e nenhum teste fala com a
// Azure): a DLQ e a publicação do MessagingService de verdade rodam sobre ele, então o que o teste prova é o mesmo código da Azure.
// Cada mensagem é um arquivo, e o teste (que roda noutro processo) semeia a DLQ escrevendo um:
//   <pasta>/<fila>/dead/<nome>.json    uma mensagem na DLQ: { messageId, body, deliveryCount?, deadLetterReason?,
//                                      deadLetterErrorDescription?, enqueuedTimeUtc? (ISO) }
//   <pasta>/<fila>/active/<nome>.json  o que foi publicado: { messageId, body, contentType, scheduledEnqueueTimeUtc? }
// Sem lock, sem entrega e sem consumo: quem tentar consumir uma fila recebe o erro. Síncrono de propósito: cada operação é atômica no
// laço de eventos da api, e dois cliques juntos no painel não se atropelam. ponytail: serve a DLQ e a publicação; consumir a fila (o
// worker) é do ensaio (ensaio/bus.ts) e do emulador, não daqui.

type Box = 'dead' | 'active';
// O contador é do módulo, e não da instância, de propósito: duas instâncias na mesma pasta (dois apps de teste no mesmo processo) não se
// sobrescrevem no mesmo milissegundo, porque o nome do arquivo leva o contador.
let counter = 0;

const unsupported = (what: string): Error =>
  new Error(`O Service Bus falso (SERVICEBUS_FAKE_DIR) não faz isto: ${what}`);

export class FakeServiceBus {
  constructor(private readonly dir: string) {}

  private folder(queue: string, box: Box): string {
    return path.join(this.dir, queue, box);
  }

  private write(queue: string, box: Box, record: Record<string, unknown>): void {
    mkdirSync(this.folder(queue, box), { recursive: true });
    counter += 1;
    const id = typeof record.messageId === 'string' ? record.messageId : 'sem-id';
    const name = `${Date.now()}-${String(counter).padStart(6, '0')}-${encodeURIComponent(id)}.json`;
    writeFileSync(path.join(this.folder(queue, box), name), JSON.stringify(record));
  }

  // As mensagens da DLQ, na ordem dos nomes. Um arquivo que ainda está sendo escrito (JSON pela metade) fica para a próxima leitura.
  private dead(queue: string, max: number) {
    let names: string[];
    try {
      names = readdirSync(this.folder(queue, 'dead')).filter((name) => name.endsWith('.json'));
    } catch {
      return [];
    }
    const messages = [];
    for (const name of names.sort()) {
      if (messages.length >= max) break;
      const file = path.join(this.folder(queue, 'dead'), name);
      try {
        const record = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
        messages.push({
          messageId: record.messageId,
          body: record.body,
          deliveryCount: record.deliveryCount,
          deadLetterReason: record.deadLetterReason,
          deadLetterErrorDescription: record.deadLetterErrorDescription,
          enqueuedTimeUtc:
            typeof record.enqueuedTimeUtc === 'string'
              ? new Date(record.enqueuedTimeUtc)
              : undefined,
          sequenceNumber: { toString: () => String(messages.length + 1) },
          applicationProperties: record.applicationProperties,
          file,
        });
      } catch {
        // arquivo pela metade
      }
    }
    return messages;
  }

  createSender(queue: string) {
    return {
      sendMessages: (message: Record<string, unknown>) => {
        this.write(queue, 'active', message);
        return Promise.resolve();
      },
      scheduleMessages: (message: Record<string, unknown>, at: Date) => {
        this.write(queue, 'active', { ...message, scheduledEnqueueTimeUtc: at.toISOString() });
        return Promise.resolve([]);
      },
      close: () => Promise.resolve(),
    };
  }

  createReceiver(queue: string, options?: { subQueueType?: string }) {
    const isDead = options?.subQueueType === 'deadLetter';
    const read = (max: number) => {
      if (!isDead) throw unsupported('ler a fila (só a DLQ)');
      return Promise.resolve(this.dead(queue, max));
    };
    return {
      peekMessages: (max: number) => read(max),
      receiveMessages: (max: number) => read(max),
      completeMessage: (message: { file: string }) => {
        rmSync(message.file, { force: true });
        return Promise.resolve();
      },
      abandonMessage: () => Promise.resolve(),
      deadLetterMessage: () => Promise.reject(unsupported('mandar para a DLQ')),
      subscribe: () => {
        throw unsupported('consumir a fila');
      },
      close: () => Promise.resolve(),
    };
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
