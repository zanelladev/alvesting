import { redactPii } from '../../../common/redact.js';

// O logger do Better Auth (option `logger`), sem dado pessoal (LGPD nos logs, etapa 11). A biblioteca chama
// `log(nível, mensagem, ...argumentos)`, e os argumentos são objetos de erro, de usuário ou de requisição, que levam e-mail, IP,
// cookie e token. Aqui sai só a mensagem (limpa por redactPii) e, de cada argumento que é erro, o nome e o código; o resto é
// descartado. Só aviso e erro chegam ao log (info e debug do Better Auth são ruído, e o debug despeja o contexto).
export type AuthLogSink = (level: 'warn' | 'error', line: string) => void;

export function createAuthLogger(sink: AuthLogSink) {
  return {
    disabled: false,
    disableColors: true,
    level: 'warn' as const,
    log(level: string, message: string, ...args: unknown[]): void {
      if (level !== 'warn' && level !== 'error') return;
      const errors = args
        .filter((arg): arg is Error => arg instanceof Error)
        .map((error) => {
          const code = (error as { code?: unknown }).code;
          return `[${error.name}${typeof code === 'string' || typeof code === 'number' ? `:${String(code)}` : ''}]`;
        });
      sink(level, [redactPii(String(message)), ...errors].join(' '));
    },
  };
}
