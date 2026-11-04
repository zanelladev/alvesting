// Busca de fonte externa (RSS, CVM, BCB). É a fronteira de confiança do worker (docs/DADOS.md, seção 16):
// - só https, só os hosts da lista fixa da fonte, sem usuário nem porta; o redirecionamento não é seguido pelo fetch:
//   cada salto passa pela mesma conferência (um feed que redireciona para http://169.254.169.254 não leva o worker junto);
// - prazo total (AbortSignal.timeout) que vale também para o corpo;
// - teto de bytes contado no corpo já descomprimido (o fetch do Node descomprime gzip e br antes de entregar): uma
//   resposta que infla sem fim é cortada no teto;
// - nenhum corpo, cabeçalho ou URL com query vai para mensagem de erro ou log: só o status e o host.

export interface Validators {
  etag?: string;
  lastModified?: string;
}

export type FetchOutcome =
  | { status: 'ok'; body: Buffer; validators: Validators }
  | { status: 'not_modified' }
  // o corpo do 404 (limitado e sem repetir em log): o SGS do BCB usa 404 para "nenhum valor nesta janela", e só o corpo
  // distingue isso de uma série que não existe
  | { status: 'not_found'; body: Buffer };

export interface FetchLimitedOptions {
  allowedHosts: readonly string[];
  maxBytes: number;
  timeoutMs?: number;
  accept?: string;
  // GET condicional: o que a resposta anterior trouxe
  validators?: Validators;
  fetchFn?: typeof fetch;
}

// Sem e-mail nem endereço de contato: o repositório pode ficar público.
export const USER_AGENT = 'Alvesting/0.1 (projeto academico; leitor de feeds e dados abertos)';

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function assertAllowed(text: string, hosts: readonly string[]): string {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error('endereço inválido na busca de fonte externa');
  }
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    url.port !== '' ||
    !hosts.includes(url.hostname)
  ) {
    throw new Error(`endereço fora da lista fixa de fontes: ${url.hostname || '(sem host)'}`);
  }
  return url.toString();
}

const tooBig = (maxBytes: number): Error =>
  new Error(`resposta grande demais (mais de ${maxBytes} bytes)`);

async function readBody(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw tooBig(maxBytes);
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
  // cancelar uma leitura pendente a encerra como "fim": quem decide o que isso significa é o `signal.aborted` abaixo
  const onAbort = () => void reader.cancel(signal.reason).catch(() => undefined);
  signal.addEventListener('abort', onAbort, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw tooBig(maxBytes);
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  if (signal.aborted) throw signal.reason;
  return Buffer.concat(chunks);
}

export async function fetchLimited(
  url: string,
  options: FetchLimitedOptions,
): Promise<FetchOutcome> {
  const fetchFn = options.fetchFn ?? fetch;
  const signal = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const headers = new Headers({ 'user-agent': USER_AGENT, accept: options.accept ?? '*/*' });
  if (options.validators?.etag) headers.set('if-none-match', options.validators.etag);
  if (options.validators?.lastModified) {
    headers.set('if-modified-since', options.validators.lastModified);
  }

  let current = assertAllowed(url, options.allowedHosts);
  for (let hop = 0; ; hop += 1) {
    const response = await fetchFn(current, { method: 'GET', redirect: 'manual', headers, signal });
    const host = new URL(current).hostname;

    if (REDIRECTS.has(response.status)) {
      await response.body?.cancel().catch(() => undefined);
      const location = response.headers.get('location');
      if (hop >= MAX_REDIRECTS || !location) {
        throw new Error(`redirecionamentos demais ou sem destino em ${host}`);
      }
      current = assertAllowed(new URL(location, current).toString(), options.allowedHosts);
      continue;
    }
    if (response.status === 304) {
      await response.body?.cancel().catch(() => undefined);
      return { status: 'not_modified' };
    }
    if (response.status === 404) {
      const body = await readBody(response, options.maxBytes, signal).catch(() => Buffer.alloc(0));
      return { status: 'not_found', body };
    }
    if (response.status !== 200) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`HTTP ${response.status} de ${host}`);
    }
    const body = await readBody(response, options.maxBytes, signal);
    const etag = response.headers.get('etag') ?? undefined;
    const lastModified = response.headers.get('last-modified') ?? undefined;
    return {
      status: 'ok',
      body,
      validators: {
        ...(etag === undefined ? {} : { etag }),
        ...(lastModified === undefined ? {} : { lastModified }),
      },
    };
  }
}
