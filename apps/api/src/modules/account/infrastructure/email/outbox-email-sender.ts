import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { newId } from '../../../../common/id.js';
import type { EmailMessage, EmailSender } from './email-sender.js';

// O remetente falso (dev e teste): grava cada mensagem num arquivo JSON da pasta EMAIL_OUTBOX_DIR, para o teste ler o link. Nada sai
// da máquina. O nome é um ULID (ordem de envio, e nada do que o destinatário digitou); a gravação é num arquivo temporário e um
// rename, então quem lê a pasta nunca vê meio arquivo.
export interface OutboxMessage extends EmailMessage {
  sentAt: string;
}

export class OutboxEmailSender implements EmailSender {
  constructor(private readonly dir: string) {}

  async send(message: EmailMessage): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const name = newId();
    const entry: OutboxMessage = { ...message, sentAt: new Date().toISOString() };
    await writeFile(path.join(this.dir, `${name}.tmp`), JSON.stringify(entry, null, 2), 'utf8');
    await rename(path.join(this.dir, `${name}.tmp`), path.join(this.dir, `${name}.json`));
  }
}

export async function readOutbox(dir: string): Promise<OutboxMessage[]> {
  let files: string[];
  try {
    files = (await readdir(dir)).filter((file) => file.endsWith('.json')).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return Promise.all(
    files.map(
      async (file) => JSON.parse(await readFile(path.join(dir, file), 'utf8')) as OutboxMessage,
    ),
  );
}
