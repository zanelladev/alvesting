import { ALERT_LOG } from '../../../../telemetry/alert-logs.js';
import type { EmailSender } from './email-sender.js';
import {
  PASSWORD_RESET_VALIDITY_MINUTES,
  VERIFICATION_VALIDITY_MINUTES,
  passwordResetEmail,
  verificationEmail,
} from './email-templates.js';

// Quem o Better Auth chama para mandar e-mail. O envio NÃO é esperado: se a resposta do cadastro esperasse o Communication Services,
// o tempo dela diria se o e-mail já tinha conta (e-mail novo manda mensagem, e-mail repetido não), e o Better Auth recomenda não
// esperar por isso. Também por isso uma falha de envio nunca vira erro de requisição: vai ao log só com o nome e o código do erro
// (a mensagem de um SDK costuma levar o destinatário), e quem não recebeu pede o reenvio (o login de e-mail não verificado manda de novo).
// ponytail: sem fila nem nova tentativa; o e-mail que falhou se perde. Com volume de verdade, a saída é a fila `notifications` do Service Bus.
//
// Quem pede o e-mail não prova ser o dono do endereço (o cadastro e o "esqueci a senha" são anônimos), então o mesmo destinatário não
// recebe o mesmo tipo de e-mail duas vezes em 60 s: sem isso, qualquer um enche a caixa de uma pessoa e gasta a cota do Communication
// Services (no domínio gerenciado pela Azure, 5 por minuto e 10 por hora para todos: docs/CONTA.md, 6). O e-mail anterior continua válido
// (60 e 30 minutos), então o descarte não tira de ninguém o acesso. O descarte vai ao log só com o tipo, nunca com o endereço.
// ponytail: a memória é por réplica (até 5, então o teto real é 5 e-mails por minuto por destinatário) e some no reinício; o limite que
// vale para a cota é o do WAF (30 por minuto por IP). Se virar abuso de verdade, a saída é o limite por destinatário numa tabela do
// Postgres, junto com a fila acima.
const MIN_INTERVAL_MS = 60_000;
// acima disto a lista varre os registros vencidos; com todos recentes ela passa do teto, limitada pelo ritmo do WAF
const MAX_TRACKED = 1_000;

type Kind = 'verificação' | 'redefinição de senha';

export class AccountMailer {
  private readonly pending = new Set<Promise<void>>();
  // quando saiu o último e-mail de cada (tipo, destinatário em minúsculas)
  private readonly lastSent = new Map<string, number>();

  constructor(
    private readonly sender: EmailSender,
    private readonly log: (line: string) => void,
    // lido na hora (não `Date.now` solto): um teste que adianta o relógio com vi.useFakeTimers é obedecido
    private readonly now: () => number = () => Date.now(),
  ) {}

  sendVerification(to: string, url: string): void {
    this.dispatch('verificação', to, () => ({
      to,
      ...verificationEmail({ url, validityMinutes: VERIFICATION_VALIDITY_MINUTES }),
    }));
  }

  sendPasswordReset(to: string, url: string): void {
    this.dispatch('redefinição de senha', to, () => ({
      to,
      ...passwordResetEmail({ url, validityMinutes: PASSWORD_RESET_VALIDITY_MINUTES }),
    }));
  }

  // Espera os envios em andamento (os testes e o desligamento da API: o SIGTERM do Container Apps não corta um e-mail no meio).
  async idle(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }

  onApplicationShutdown(): Promise<void> {
    return this.idle();
  }

  private allowed(kind: Kind, to: string): boolean {
    const now = this.now();
    const key = `${kind}:${to.trim().toLowerCase()}`;
    const last = this.lastSent.get(key);
    if (last !== undefined && now - last < MIN_INTERVAL_MS) return false;
    if (this.lastSent.size >= MAX_TRACKED) {
      for (const [other, at] of this.lastSent)
        if (now - at >= MIN_INTERVAL_MS) this.lastSent.delete(other);
    }
    this.lastSent.set(key, now);
    return true;
  }

  private dispatch(kind: Kind, to: string, build: () => Parameters<EmailSender['send']>[0]): void {
    if (!this.allowed(kind, to)) {
      // outro texto de propósito: o descarte por repetição é o sistema funcionando, e o alerta de e-mail que falhou
      // (ALERT_LOG.emailFailed) não pode contá-lo
      this.log(
        `e-mail da conta descartado: ${kind} repetida em menos de 60 s para o mesmo destinatário`,
      );
      return;
    }
    const task = (async () => {
      try {
        await this.sender.send(build());
      } catch (error) {
        const e = error as { name?: string; code?: unknown };
        this.log(
          `${ALERT_LOG.emailFailed} ${e.name ?? 'Error'}${typeof e.code === 'string' ? `:${e.code}` : ''}`,
        );
      }
    })().finally(() => this.pending.delete(task));
    this.pending.add(task);
  }
}
