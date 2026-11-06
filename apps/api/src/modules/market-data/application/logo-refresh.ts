import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { Listing } from '../domain/instruments.js';
import { LOGO_MAX_BYTES, svgRefusal } from '../domain/svg-check.js';
import { describeError } from '../infrastructure/brapi.client.js';
import type { MarketRepository } from '../infrastructure/market.repository.js';

// Os logos das ações (ADR 0036; docs/DADOS.md, seção 3a): a cópia própria do SVG que a lista da brapi aponta em icons.brapi.dev, guardada no
// banco para o site servir do próprio domínio. Roda no fim da atualização semanal (weekly-refresh.ts), com a lista que ela já buscou, e no
// market:logos.
//  1. Antes de baixar, reconfere TODO SVG guardado com o validador de hoje (svg-check.ts) e apaga o que ele recusa, com o ticker e o motivo no
//     log: a tabela só guarda o que passa na regra de hoje, e é por isso que as rotas internas leem o banco como está. Depois de mudar o
//     validador, roda-se o market:logos (RUNBOOK).
//  2. Para cada papel do banco que a lista traz com logo, baixa só o que precisa: sem logo guardado, endereço trocado ou guardado há mais de
//     30 dias. Um pedido por vez, só no endereço que o cliente da lista conferiu (logoUrl), sem token, sem seguir redirecionamento, com prazo
//     de 10 s, teto de 200 KB e o tipo conferido, e o SVG passa pelo validador. O mesmo SHA-256 não regrava o SVG (só a data da busca anda).
//     O recusado vira "sem logo" nesta passada, com o motivo e o ticker no log (nunca o conteúdo), e não apaga o guardado antes, que passou
//     no passo 1. 5 falhas seguidas são o host fora do ar e param a passada. Nada aqui sobe exceção de rede: o que falhou fica para a próxima.
// ponytail: sem a trava consultiva da brapi. O icons.brapi.dev é estático e não gasta cota (a lista também não); um pedido por vez é o
// laço desta passada. Se a brapi passar a contar os SVG no limite de 1 requisição por vez da conta, a trava entra aqui como no BrapiClient.

export const LOGO_TIMEOUT_MS = 10_000;
export const LOGO_MAX_AGE_MS = 30 * 86_400_000;
const OUTAGE_AFTER_FAILURES = 5;
const SVG_TYPE = 'image/svg+xml';

export interface LogoSummary {
  // os SVG guardados que o validador de hoje recusou, e foram apagados (passo 1)
  purged: Array<{ ticker: string; reason: string }>;
  // os papéis do banco que a lista traz com logo, e os que precisavam de busca
  listed: number;
  asked: number;
  // pedidos ao icons.brapi.dev
  requests: number;
  // SVG gravado (novo ou com outro SHA-256) e o mesmo SHA-256 (só a data andou)
  stored: number;
  unchanged: number;
  refused: Array<{ ticker: string; reason: string }>;
  failed: Array<{ ticker: string; reason: string }>;
  // os bytes dos SVG que passaram
  bytes: number;
  stopped: 'time' | 'outage' | null;
}

type Download =
  | { kind: 'ok'; svg: string; bytes: number; sha256: string }
  | { kind: 'refused'; reason: string }
  | { kind: 'failed'; reason: string }
  | { kind: 'time' };

const cancel = (response: Response) => response.body?.cancel().catch(() => undefined);

// O corpo até o teto: passou dele, a leitura para ali e o corpo é recusado (undefined), sem ler o resto.
async function readCapped(response: Response): Promise<Uint8Array | undefined> {
  // os tipos do Node dão o corpo como ReadableStream<any>; o do fetch é de bytes
  const reader = (response.body as ReadableStream<Uint8Array> | null)?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks);
    total += value.byteLength;
    if (total > LOGO_MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      return undefined;
    }
    chunks.push(value);
  }
}

export class LogoRefresh {
  private readonly logger = new Logger(LogoRefresh.name);

  constructor(
    private readonly market: Pick<
      MarketRepository,
      'storedLogos' | 'deleteLogo' | 'logoTargets' | 'saveLogo' | 'touchLogo'
    >,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly clock: () => number = Date.now,
  ) {}

  // `listings`: a lista da brapi (o logo já conferido pelo cliente; nulo é sem logo). `budgetMs`: o que sobra do orçamento de quem chama
  // (a atualização semanal roda dentro da trava da fila market); a carga manual passa Infinity.
  async run(listings: readonly Listing[], budgetMs: number): Promise<LogoSummary> {
    const deadline = this.clock() + budgetMs;
    const urls = new Map<string, string>();
    for (const listing of listings) if (listing.logo) urls.set(listing.ticker, listing.logo);
    const summary: LogoSummary = {
      purged: [],
      listed: 0,
      asked: 0,
      requests: 0,
      stored: 0,
      unchanged: 0,
      refused: [],
      failed: [],
      bytes: 0,
      stopped: null,
    };
    for (const { instrumentId, ticker, svg } of await this.market.storedLogos()) {
      const reason = svgRefusal(svg);
      if (reason === null) continue;
      await this.market.deleteLogo(instrumentId);
      summary.purged.push({ ticker, reason });
      this.logger.warn(
        { ticker, reason },
        'logo guardado recusado pelo validador de hoje; apagado',
      );
    }
    if (urls.size === 0) return this.finish(summary);

    const targets = await this.market.logoTargets([...urls.keys()]);
    const now = this.clock();
    const due = targets.filter(({ ticker, stored }) => {
      const url = urls.get(ticker)!;
      return (
        !stored || stored.sourceUrl !== url || now - stored.fetchedAt.getTime() > LOGO_MAX_AGE_MS
      );
    });
    summary.listed = targets.length;
    summary.asked = due.length;

    let failuresInARow = 0;
    for (const { instrumentId, ticker, stored } of due) {
      const url = urls.get(ticker)!;
      const download = await this.download(url, deadline);
      if (download.kind === 'time') {
        summary.stopped = 'time';
        this.logger.warn('logos: o orçamento de tempo acabou; o resto fica para a próxima passada');
        break;
      }
      summary.requests += 1;
      if (download.kind === 'failed') {
        summary.failed.push({ ticker, reason: download.reason });
        this.logger.warn(
          { ticker, reason: download.reason },
          'logo sem resposta do icons.brapi.dev',
        );
        failuresInARow += 1;
        if (failuresInARow >= OUTAGE_AFTER_FAILURES) {
          summary.stopped = 'outage';
          this.logger.warn(
            { failures: OUTAGE_AFTER_FAILURES },
            'icons.brapi.dev: logos seguidos sem resposta; a passada para e o resto fica para a próxima',
          );
          break;
        }
        continue;
      }
      failuresInARow = 0;
      if (download.kind === 'refused') {
        summary.refused.push({ ticker, reason: download.reason });
        this.logger.warn(
          { ticker, reason: download.reason },
          'logo recusado; o papel fica sem logo',
        );
        continue;
      }
      const fetchedAt = new Date(this.clock());
      if (stored?.sha256 === download.sha256) {
        await this.market.touchLogo(instrumentId, url, fetchedAt);
        summary.unchanged += 1;
      } else {
        const { svg, sha256, bytes } = download;
        await this.market.saveLogo({ instrumentId, sourceUrl: url, svg, sha256, bytes, fetchedAt });
        summary.stored += 1;
      }
      summary.bytes += download.bytes;
    }
    return this.finish(summary);
  }

  private finish(summary: LogoSummary): LogoSummary {
    this.logger.log(
      {
        ...summary,
        purged: summary.purged.length,
        refused: summary.refused.length,
        failed: summary.failed.length,
      },
      'logos das ações',
    );
    return summary;
  }

  private async download(url: string, deadline: number): Promise<Download> {
    const left = deadline - this.clock();
    if (left <= 0) return { kind: 'time' };
    try {
      const response = await this.fetchFn(url, {
        // sem token nem cookie: o SVG é público, e o token da brapi nunca vai a este host
        headers: { accept: SVG_TYPE },
        // nenhum redirecionamento, nem para outro host: o endereço é o que a lista deu e o logoUrl conferiu
        redirect: 'error',
        // o prazo vale para a leitura do corpo também
        signal: AbortSignal.timeout(Math.min(LOGO_TIMEOUT_MS, left)),
      });
      if (response.status !== 200) {
        await cancel(response);
        return { kind: 'failed', reason: `HTTP ${response.status}` };
      }
      const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
      if (type !== SVG_TYPE) {
        await cancel(response);
        return { kind: 'failed', reason: `tipo de conteúdo diferente de ${SVG_TYPE}` };
      }
      if (Number(response.headers.get('content-length')) > LOGO_MAX_BYTES) {
        await cancel(response);
        return { kind: 'refused', reason: 'passa do teto de 200 KB' };
      }
      const body = await readCapped(response);
      if (body === undefined) return { kind: 'refused', reason: 'passa do teto de 200 KB' };
      let svg: string;
      try {
        // o BOM fica no texto: o que se guarda e serve é o que veio, byte a byte (o SHA-256 e o tamanho são dos bytes)
        svg = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body);
      } catch {
        return { kind: 'refused', reason: 'não é UTF-8' };
      }
      const refusal = svgRefusal(svg);
      if (refusal) return { kind: 'refused', reason: refusal };
      return {
        kind: 'ok',
        svg,
        bytes: body.byteLength,
        sha256: createHash('sha256').update(body).digest('hex'),
      };
    } catch (error) {
      // rede, DNS, redirecionamento recusado, tempo esgotado: só o nome e o código (a mensagem pode trazer o endereço)
      const { error: name, code } = describeError(error);
      return { kind: 'failed', reason: `sem resposta (${name}${code ? `, ${code}` : ''})` };
    }
  }
}
