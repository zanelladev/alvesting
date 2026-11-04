import { EmailClient } from '@azure/communication-email';
import type { EmailConfig } from '../account-config.js';
import { AcsEmailSender } from './acs-email-sender.js';
import { OutboxEmailSender } from './outbox-email-sender.js';

// O e-mail transacional da conta (verificação e redefinição de senha). Dois remetentes e nenhuma outra abstração: o do Azure
// Communication Services (produção) e o falso, que grava cada mensagem num arquivo (dev e teste). Em produção o falso não liga:
// o account-config recusa subir com EMAIL_OUTBOX_DIR.
export interface EmailMessage {
  to: string;
  subject: string;
  plainText: string;
  html: string;
}

export interface EmailSender {
  send(message: EmailMessage): Promise<void>;
}

export function createEmailSender(config: EmailConfig): EmailSender {
  return config.kind === 'outbox'
    ? new OutboxEmailSender(config.dir)
    : new AcsEmailSender(new EmailClient(config.connectionString.reveal()), config.sender);
}
