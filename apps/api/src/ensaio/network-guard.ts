import net from 'node:net';

// O guarda de rede do ensaio (arena:ensaio): prova, na própria execução, que nada saiu da máquina. O fetch global falha, e toda
// conexão TCP para fora do loopback também (o SDK da OpenAI, o undici, o SDK do Azure, o pg e o http do Node passam por
// net.Socket.connect). O Postgres e o Azurite do ensaio estão no loopback e passam. A tentativa fica anotada em `blocked`, e o
// relatório a mostra; um ensaio que tocou a rede não vale.
//
// O arena:retroativo e o operador local (ADR 0038) usam o mesmo guarda com uma LISTA BRANCA (`allow`): só os hosts da lista, exatos, e o
// loopback passam; o resto é bloqueado e anotado do mesmo jeito (e `onBlocked` o leva ao log de quem roda).
export interface NetworkGuard {
  // o que foi tentado e bloqueado ("fetch https://host/caminho", "tcp host:porta")
  blocked: string[];
  restore(): void;
}

const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|::1|\[::1\]|0\.0\.0\.0)$/i;

// A decisão do guarda: o loopback sempre passa; fora dele, só um host da lista, pelo nome exato (sem curinga: `brapi.dev` não libera
// `icons.brapi.dev`, nem `evil-brapi.dev`). Sem lista, nada de fora passa (o ensaio).
export function isAllowedHost(host: string, allow: readonly string[] = []): boolean {
  if (LOOPBACK.test(host)) return true;
  const name = host.toLowerCase().replace(/\.$/, '');
  return allow.some((allowed) => allowed.toLowerCase() === name);
}

const hostOf = (raw: string): string => {
  try {
    return new URL(raw).hostname;
  } catch {
    return '';
  }
};

// Para onde o connect vai: [host, porta], ou undefined para socket de arquivo (unix), que não é rede. As formas do net:
// connect(opções), connect(porta, host?) e o vetor normalizado [opções, callback] que net.connect repassa por dentro.
function targetOf(args: unknown[]): { host: string; port: number | string } | undefined {
  const first = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
  if (typeof first === 'number') {
    return { host: typeof args[1] === 'string' ? args[1] : 'localhost', port: first };
  }
  if (typeof first === 'object' && first !== null) {
    const options = first as { host?: unknown; port?: unknown; path?: unknown };
    if (typeof options.path === 'string') return undefined;
    return {
      host: typeof options.host === 'string' ? options.host : 'localhost',
      port:
        typeof options.port === 'number' || typeof options.port === 'string' ? options.port : '?',
    };
  }
  return undefined;
}

// o endereço sem a query, que pode carregar segredo
function withoutQuery(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    return '(endereço inválido)';
  }
}

export function installNetworkGuard(
  options: { allow?: readonly string[]; onBlocked?: (entry: string) => void } = {},
): NetworkGuard {
  const { allow = [], onBlocked } = options;
  const blocked: string[] = [];
  const block = (entry: string): void => {
    blocked.push(entry);
    onBlocked?.(entry);
  };
  const originalFetch = globalThis.fetch;
  // o descritor, e não o método solto: devolve exatamente o que havia (e o lint não vê um método sem `this`)
  const original = Object.getOwnPropertyDescriptor(net.Socket.prototype, 'connect');
  const connect = original?.value as
    ((this: net.Socket, ...args: unknown[]) => net.Socket) | undefined;
  if (!original || !connect) throw new Error('net.Socket.prototype.connect não existe');

  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (allow.length > 0 && isAllowedHost(hostOf(raw), allow)) return originalFetch(input, init);
    const shown = withoutQuery(raw);
    block(`fetch ${shown}`);
    return Promise.reject(new Error(`rede bloqueada pelo guarda: fetch ${shown}`));
  };

  Object.defineProperty(net.Socket.prototype, 'connect', {
    ...original,
    value: function (this: net.Socket, ...args: unknown[]) {
      const target = targetOf(args);
      if (target && !isAllowedHost(target.host, allow)) {
        const shown = `${target.host}:${target.port}`;
        block(`tcp ${shown}`);
        throw new Error(`rede bloqueada pelo guarda: tcp ${shown}`);
      }
      return connect.apply(this, args);
    },
  });

  return {
    blocked,
    restore: () => {
      globalThis.fetch = originalFetch;
      Object.defineProperty(net.Socket.prototype, 'connect', original);
    },
  };
}
