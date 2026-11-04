import type { EmailClient } from '@azure/communication-email';
import type { EmailMessage, EmailSender } from './email-sender.js';

// O envio pelo Azure Communication Services (produção). O SDK devolve um poller: o envio só vale quando termina como Succeeded.
// ponytail: a autenticação é a connection string (segredo acs-connection-string no Key Vault). O EmailClient também aceita um
// TokenCredential (identidade gerenciada), mas a documentação do Communication Services não diz qual papel do Azure RBAC basta
// para enviar e-mail (docs/CONTA.md, "Identidade gerenciada no e-mail"); sem isso, trocar seria chute.
//
// O envio todo (começar e esperar o resultado) leva um prazo de 30 s: uma operação travada no Communication Services deixaria uma
// promessa pendente por e-mail, e o desligamento da API (AccountMailer.idle) esperaria por ela até o SIGKILL do Container Apps. Estourou o
// prazo, o erro cai no log do AccountMailer (só o nome e o código) e quem não recebeu pede de novo.
export class AcsEmailSender implements EmailSender {
  constructor(
    private readonly client: Pick<EmailClient, 'beginSend'>,
    private readonly senderAddress: string,
    // o prazo só varia no teste
    private readonly timeoutMs = 30_000,
  ) {}

  async send(message: EmailMessage): Promise<void> {
    const abortSignal = AbortSignal.timeout(this.timeoutMs);
    const poller = await this.client.beginSend(
      {
        senderAddress: this.senderAddress,
        content: { subject: message.subject, plainText: message.plainText, html: message.html },
        recipients: { to: [{ address: message.to }] },
        // sem pixel de rastreamento no e-mail de verificação
        disableUserEngagementTracking: true,
      },
      { abortSignal },
    );
    const result = await poller.pollUntilDone({ abortSignal });
    // a mensagem de erro não leva o endereço do destinatário
    if (result.status !== 'Succeeded') {
      throw new Error(`Communication Services: o envio terminou como ${result.status}`);
    }
  }
}
