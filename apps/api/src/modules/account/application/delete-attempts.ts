// O freio da senha em DELETE /api/v1/me: a rota é uma chamada direta ao Better Auth (auth.api), que não passa pelo limitador de
// tentativas dele, então quem tivesse uma sessão roubada poderia testar senhas aqui sem limite. Cinco erros em 15 minutos bloqueiam
// a conta daquele usuário por esse prazo. Só a senha errada conta; a sessão recente não gasta tentativa.
// ponytail: em memória, por réplica (até 5 réplicas, então no máximo 25 erros por prazo) e some no reinício. Se a conta precisar de
// um limite de verdade, a saída é uma tabela no Postgres ou o Redis da fase 7 do plano.
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;

export class DeleteAttempts {
  private readonly failures = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly now: () => number = Date.now) {}

  blocked(userId: string): boolean {
    const entry = this.failures.get(userId);
    if (!entry) return false;
    if (this.now() >= entry.resetAt) {
      this.failures.delete(userId);
      return false;
    }
    return entry.count >= MAX_FAILURES;
  }

  fail(userId: string): void {
    const entry = this.failures.get(userId);
    if (!entry || this.now() >= entry.resetAt) {
      this.failures.set(userId, { count: 1, resetAt: this.now() + WINDOW_MS });
    } else {
      entry.count += 1;
    }
  }

  clear(userId: string): void {
    this.failures.delete(userId);
  }
}
