// Mede se um endpoint SSE entrega os eventos aos poucos ou bufferizados (plano 5.4 e 5.15, ADR 0017).
// Alvo: GET /api/v1/health/stream, que manda 5 eventos, um por segundo, cada um com a hora em que o servidor o
// gerou. O probe compara essa hora com a de chegada: se cada evento chega no ritmo em que foi gerado, o
// caminho entrega o stream; se chegam de uma vez, algo no meio (Front Door, proxy, compressão) bufferizou.
//
// Uso: node scripts/sse-probe.mjs <url> [--header "Nome: valor"]...
//      --header serve para a trava de origem (X-Azure-FDID) quando o alvo é a origem direto, não o Front Door.
// Saída: 0 espaçados · 1 parcial ou bufferizado · 2 erro (rede, status, tipo, poucos eventos, tempo, uso).
// ponytail: uma medição por execução. Rode mais de uma vez em horários diferentes antes de fechar a decisão
// sobre o chat (etapa 13); o veredito é por lote de chegada, sem estatística.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const EXPECTED_EVENTS = 5;
// Eventos gerados com menos de 100 ms entre eles não dizem nada sobre buffer.
const MIN_SERVER_GAP_MS = 100;
// Dois eventos cujas chegadas distam menos de 30% do intervalo do servidor contam como uma só leva.
const BATCH_GAP_RATIO = 0.3;

/** @typedef {{ seq: number, generatedMs: number, arrivedMs: number }} Arrival */

/**
 * Agrupa as chegadas em levas e dá o veredito. Puro, para testar sem rede.
 * @param {Array<{generatedMs: number, arrivedMs: number}>} events
 */
export function classify(events) {
  if (events.length < 2) return { verdict: 'inconclusivo', batches: events.length };
  const gaps = events.slice(1).map((e, i) => e.generatedMs - events[i].generatedMs);
  const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
  if (median < MIN_SERVER_GAP_MS) return { verdict: 'inconclusivo', batches: events.length };

  const arrivals = events.map((e) => e.arrivedMs).sort((a, b) => a - b);
  let batches = 1;
  for (let i = 1; i < arrivals.length; i++) {
    if (arrivals[i] - arrivals[i - 1] > median * BATCH_GAP_RATIO) batches++;
  }
  const verdict =
    batches === events.length ? 'espacados' : batches === 1 ? 'bufferizado' : 'parcial';
  return { verdict, batches };
}

const describe = (error) => {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError')
    return 'tempo limite esgotado';
  const code = error?.cause?.code ?? error?.code;
  return code ? `${error.message} (${code})` : String(error?.message ?? error);
};

/**
 * Abre o stream, anota a chegada de cada evento e classifica. Lança Error se não der para medir.
 * @param {string} url
 * @param {{ headers?: Record<string, string>, timeoutMs?: number, log?: (line: string) => void }} [options]
 */
export async function probe(url, { headers = {}, timeoutMs = 30_000, log = console.log } = {}) {
  const started = performance.now();
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'text/event-stream', 'Cache-Control': 'no-cache', ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new Error(`não conseguiu conectar a ${url}: ${describe(error)}`, { cause: error });
  }
  const contentType = response.headers.get('content-type') ?? '';
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error(`status ${response.status} em vez de 200`);
  }
  if (!contentType.startsWith('text/event-stream')) {
    await response.body?.cancel();
    throw new Error(`content-type "${contentType}" em vez de text/event-stream`);
  }
  log(
    `HTTP ${response.status} ${contentType}, cabeçalhos em ${Math.round(performance.now() - started)} ms`,
  );

  /** @type {Arrival[]} */
  const events = [];
  const decoder = new TextDecoder();
  let pending = '';
  try {
    for await (const chunk of response.body) {
      const arrivedMs = performance.now() - started;
      pending += decoder.decode(chunk, { stream: true });
      let end;
      while ((end = pending.indexOf('\n\n')) !== -1) {
        const block = pending.slice(0, end);
        pending = pending.slice(end + 2);
        const data = block
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('\n');
        if (!data) continue;
        const parsed = JSON.parse(data);
        const generatedMs = Date.parse(parsed.at);
        if (Number.isNaN(generatedMs)) throw new Error(`evento sem a hora do servidor: ${data}`);
        events.push({ seq: parsed.seq, generatedMs, arrivedMs });
        log(
          `  evento ${parsed.seq}: gerado às ${parsed.at.slice(11, 23)}, chegou +${Math.round(arrivedMs)} ms depois do pedido`,
        );
      }
    }
  } catch (error) {
    throw new Error(`o stream falhou: ${describe(error)}`, { cause: error });
  }
  if (events.length < EXPECTED_EVENTS) {
    throw new Error(
      `o stream terminou com ${events.length} evento(s) em vez de ${EXPECTED_EVENTS}`,
    );
  }

  const { verdict, batches } = classify(events);
  const last = events.length - 1;
  return {
    verdict,
    batches,
    status: response.status,
    contentType,
    events,
    serverSpanMs: events[last].generatedMs - events[0].generatedMs,
    clientSpanMs: Math.round(events[last].arrivedMs - events[0].arrivedMs),
  };
}

const USAGE = 'Uso: node scripts/sse-probe.mjs <url> [--header "Nome: valor"]...';

/** @returns {Promise<number>} código de saída */
export async function main(argv, io = {}) {
  const log = io.log ?? console.log;
  const error = io.error ?? console.error;

  const headers = {};
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] !== '--header') {
      positional.push(argv[i]);
      continue;
    }
    const raw = argv[++i] ?? '';
    const colon = raw.indexOf(':');
    if (colon < 1) {
      error(`--header precisa de "Nome: valor", recebi "${raw}"\n${USAGE}`);
      return 2;
    }
    headers[raw.slice(0, colon).trim()] = raw.slice(colon + 1).trim();
  }

  let url;
  try {
    url = new URL(positional[0] ?? '');
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocolo');
  } catch {
    error(USAGE);
    return 2;
  }

  log(`SSE ${url}`);
  let report;
  try {
    report = await probe(url.href, { headers, log });
  } catch (cause) {
    error(`erro: ${cause.message}`);
    return 2;
  }

  const n = report.events.length;
  const sobre = `${report.clientSpanMs} ms entre o primeiro e o último evento na chegada; o servidor os gerou em ${report.serverSpanMs} ms`;
  if (report.verdict === 'espacados') {
    log(
      `resultado: ESPAÇADOS. Os ${n} eventos chegaram um a um (${sobre}). O caminho entrega o stream.`,
    );
    return 0;
  }
  if (report.verdict === 'parcial') {
    log(
      `resultado: PARCIAL. Os ${n} eventos chegaram em ${report.batches} levas (${sobre}). Há buffer no caminho.`,
    );
  } else {
    log(
      `resultado: BUFFERIZADO. Os ${n} eventos chegaram de uma vez (${sobre}). O caminho segura a resposta.`,
    );
  }
  return 1;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await main(process.argv.slice(2));
}
