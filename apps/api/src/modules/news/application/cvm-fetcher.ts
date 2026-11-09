import { Logger } from '@nestjs/common';
import { brasiliaDate, type IsoDate } from '../../market-data/domain/dates.js';
import {
  CVM_HOST,
  FCA_COLUMNS,
  FCA_ENTRY,
  IPE_COLUMNS,
  IPE_ENTRY,
  buildTickerCnpj,
  cvmDocument,
  fcaPair,
  fcaUrl,
  ipeUrl,
  ipeWindowStart,
  ipeYears,
  mayBeMissing,
  type CvmDocument,
  type FcaPair,
} from '../domain/cvm.js';
import { cvmDraft, seenNow, type NewsDraft } from '../domain/draft.js';
import type { NewsRepository } from '../infrastructure/news.repository.js';
import { fetchLimited, type FetchOutcome, type Validators } from '../infrastructure/source-http.js';
import { csvRecords } from '../infrastructure/zip-csv.js';

// Tetos de quem vem da rede. Hoje o IPE de 2026 tem 1,8 MB compactado e 15,8 MB de CSV; o FCA, 0,4 MB e 1,7 MB (o CSV de
// valor mobiliário, 0,2 MB). Folga grande, mas finita: o ZIP pode ser uma bomba.
const MAX_ZIP_BYTES = { IPE: 30 * 1024 * 1024, FCA: 10 * 1024 * 1024 };
const MAX_INFLATED_BYTES = { IPE: 128 * 1024 * 1024, FCA: 32 * 1024 * 1024 };
// O que fica na memória e o que se lê: o IPE de 2026 tem 38 mil linhas, e a janela de 7 dias, uns 130 documentos. Cinco
// vezes e quarenta vezes isso. Passar daqui é arquivo errado ou hostil (cada documento guardado custa uns 0,8 KB de heap, e o
// worker tem 1 GiB), e a busca falha sem repetir nada do conteúdo.
const MAX_IPE_ROWS = 200_000;
const MAX_WINDOW_DOCS = 5_000;

// O que o arena:retroativo lê da CVM (ADR 0038): os documentos entregues em [from, to], cada um gravado como visto na hora em que o pipeline ao
// vivo o teria visto (`seenAt`), e só os que já teriam sido vistos até `horizon` (o corte do último pregão que o retroativo vai rodar).
export interface CvmBackfillWindow {
  from: IsoDate;
  to: IsoDate;
  horizon: Date;
  seenAt: (deliveredOn: IsoDate) => Date;
}

// Como uma leitura do IPE grava: a busca ao vivo é condicional, guarda os validadores e carimba o lote com a hora da gravação; o retroativo
// lê sem condição, não toca nos validadores (eles são da busca ao vivo, que passaria a responder 304 a um arquivo que ela nunca leu) e carimba
// cada documento com a hora da regra.
interface IpeRead {
  years: number[];
  from: IsoDate;
  to: IsoDate;
  conditional: boolean;
  saveState: boolean;
  backfill?: Pick<CvmBackfillWindow, 'horizon' | 'seenAt'>;
}

export interface CvmResult {
  // instrumentos cujo CNPJ o FCA acrescentou ou corrigiu
  mappingChanged: number;
  // documentos da janela (fato relevante e comunicado), os que viraram notícia (têm ticker) e os gravados agora
  documents: number;
  mapped: number;
  created: number;
}

// A fonte `cvm-ipe` (docs/DADOS.md, seção 14). Uma busca faz duas coisas, nesta ordem:
// 1. FCA: o cadastro de valores mobiliários da CVM dá os códigos de negociação de cada CNPJ; cruzados com os
//    instrumentos da etapa 4, vão para instrument.cnpj;
// 2. IPE: os documentos da janela de 7 dias (fato relevante e comunicado ao mercado) vão para o ticker da companhia.
// Os dois arquivos são ZIP do ano que a CVM refaz uma vez por dia (por volta de 07:00 em Brasília), e a busca é
// condicional (ETag e Last-Modified guardados em fetch_state): em 47 de 48 buscas do dia a resposta é um 304 de poucos
// bytes. Cada validador só é guardado depois de o arquivo ser processado por inteiro, e o do FCA por último, depois do
// IPE. Quando o FCA é lido de novo o IPE também é, sem condição, porque um documento antes sem ticker pode ter passado a
// ter; como o validador do FCA só vai depois do IPE, uma falha entre os dois faz a repetição ler os dois de novo.
export class CvmFetcher {
  private readonly logger = new Logger(CvmFetcher.name);

  constructor(
    private readonly news: Pick<
      NewsRepository,
      | 'knownTickers'
      | 'applyCnpj'
      | 'tickersByCnpj'
      | 'saveNews'
      | 'fetchState'
      | 'saveFetchState'
      | 'touchFetchState'
    >,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  async run(now: Date): Promise<CvmResult> {
    // Ambiente novo, sem nenhum instrumento (a carga inicial da brapi ainda não rodou): não há a que ligar um CNPJ, e guardar o
    // ETag agora faria o arquivo de hoje ser dado por processado. Espera, sem erro: o primeiro eod/backfill resolve.
    const known = await this.news.knownTickers();
    if (known.size === 0) {
      this.logger.warn(
        'CVM: nenhum instrumento conhecido ainda (rode a carga inicial da brapi); nada a fazer',
      );
      return { mappingChanged: 0, documents: 0, mapped: 0, created: 0 };
    }
    const mapping = await this.refreshMapping(now, known, true);
    const ingested = await this.ingest(now, {
      years: ipeYears(now),
      from: ipeWindowStart(now),
      to: brasiliaDate(now),
      conditional: !mapping.read,
      saveState: true,
    });
    // por último: com o IPE já processado, o FCA pode ser dado como lido
    if (mapping.validators) await this.news.saveFetchState(mapping.key, mapping.validators, now);
    this.logger.log({ mappingChanged: mapping.changed, ...ingested }, 'CVM buscada');
    return { mappingChanged: mapping.changed, ...ingested };
  }

  // O arena:retroativo (ADR 0038): o FCA e o IPE do ano lidos sem condição, uma vez, e os documentos da janela gravados com a hora em que o
  // pipeline ao vivo os teria visto. Nada de fetch_state: os validadores continuam os da busca ao vivo (a do operador local).
  async backfill(window: CvmBackfillWindow, now: Date): Promise<CvmResult> {
    const known = await this.news.knownTickers();
    if (known.size === 0) {
      throw new Error('CVM: nenhum instrumento conhecido (prepare o banco da temporada antes)');
    }
    const mapping = await this.refreshMapping(now, known, false);
    const first = Number(window.from.slice(0, 4));
    const last = Number(window.to.slice(0, 4));
    const ingested = await this.ingest(now, {
      years: first === last ? [last] : [first, last],
      from: window.from,
      to: window.to,
      conditional: false,
      saveState: false,
      backfill: window,
    });
    this.logger.log({ mappingChanged: mapping.changed, ...ingested }, 'CVM lida para o retroativo');
    return { mappingChanged: mapping.changed, ...ingested };
  }

  // `conditional`: mandar os validadores guardados (GET condicional). Um 304 só atualiza a hora da checagem.
  private async download(
    kind: 'IPE' | 'FCA',
    year: number,
    now: Date,
    key: string,
    conditional: boolean,
  ): Promise<FetchOutcome> {
    const outcome = await fetchLimited(kind === 'IPE' ? ipeUrl(year) : fcaUrl(year), {
      allowedHosts: [CVM_HOST],
      maxBytes: MAX_ZIP_BYTES[kind],
      accept: 'application/zip, */*;q=0.5',
      validators: conditional ? await this.news.fetchState(key) : undefined,
      fetchFn: this.fetchFn,
    });
    if (outcome.status === 'not_modified') {
      await this.news.touchFetchState(key, now);
      return outcome;
    }
    if (outcome.status !== 'not_found') return outcome;
    // O arquivo do ano novo só aparece depois do começo de janeiro; no resto do ano a falta é um erro.
    if (mayBeMissing(year, now)) {
      this.logger.warn({ kind, year }, 'o arquivo do ano novo ainda não existe na CVM');
      return { status: 'not_modified' };
    }
    throw new Error(`CVM: o arquivo do ${kind} de ${year} não existe (404)`);
  }

  // `read`: o FCA veio de novo (200), então o IPE tem de ser lido sem condição. `validators` é o que guardar quando tudo
  // terminar; fica de fora no 304.
  private async refreshMapping(
    now: Date,
    known: ReadonlySet<string>,
    conditional: boolean,
  ): Promise<{ changed: number; read: boolean; key: string; validators?: Validators }> {
    const year = Number(brasiliaDate(now).slice(0, 4));
    const key = `cvm-fca:${year}`;
    const outcome = await this.download('FCA', year, now, key, conditional);
    if (outcome.status !== 'ok') return { changed: 0, read: false, key };

    const pairs: FcaPair[] = [];
    for await (const record of csvRecords(outcome.body, FCA_ENTRY, {
      label: 'fca_cia_aberta_valor_mobiliario_AAAA.csv',
      maxInflatedBytes: MAX_INFLATED_BYTES.FCA,
      requiredColumns: FCA_COLUMNS,
    })) {
      const pair = fcaPair(record);
      if (pair) pairs.push(pair);
    }
    // um FCA sem código nenhum é arquivo no formato errado, não uma companhia sem ticker
    if (pairs.length === 0) {
      throw new Error(`CVM: o FCA de ${year} não trouxe nenhum código de negociação válido`);
    }
    const changed = await this.news.applyCnpj(buildTickerCnpj(pairs, known));
    return { changed, read: true, key, validators: outcome.validators };
  }

  private async ingest(
    now: Date,
    read: IpeRead,
  ): Promise<Pick<CvmResult, 'documents' | 'mapped' | 'created'>> {
    const { from, to } = read;
    let documents = 0;
    let mapped = 0;
    let created = 0;
    for (const year of read.years) {
      const key = `cvm-ipe:${year}`;
      const outcome = await this.download('IPE', year, now, key, read.conditional);
      if (outcome.status !== 'ok') continue;

      // as linhas são lidas em fluxo e só as da janela ficam na memória
      const docs: CvmDocument[] = [];
      let rows = 0;
      let accepted = 0;
      for await (const record of csvRecords(outcome.body, IPE_ENTRY, {
        label: 'ipe_cia_aberta_AAAA.csv',
        maxInflatedBytes: MAX_INFLATED_BYTES.IPE,
        requiredColumns: IPE_COLUMNS,
      })) {
        rows += 1;
        if (rows > MAX_IPE_ROWS) {
          throw new Error(`CVM: o IPE de ${year} tem mais de ${MAX_IPE_ROWS} linhas`);
        }
        const doc = cvmDocument(record);
        if (!doc) continue;
        accepted += 1;
        if (
          doc.deliveredOn >= from &&
          doc.deliveredOn <= to &&
          (!read.backfill || read.backfill.seenAt(doc.deliveredOn) <= read.backfill.horizon)
        ) {
          docs.push(doc);
          if (docs.length > MAX_WINDOW_DOCS) {
            throw new Error(
              `CVM: o IPE de ${year} tem mais de ${MAX_WINDOW_DOCS} documentos na janela`,
            );
          }
        }
      }
      // Um IPE de ano inteiro tem milhares de fatos relevantes e comunicados. Sem nenhuma linha aceita, a CVM mudou o
      // formato (valor de Categoria, de data ou de link) e o arquivo não pode ser dado por processado. No começo do ano o
      // arquivo novo ainda pode estar vazio ou só com outras categorias: espera, como se não existisse.
      if (rows === 0 || accepted === 0) {
        if (mayBeMissing(year, now)) {
          this.logger.warn({ year, rows }, 'o IPE do ano novo ainda não tem documento utilizável');
          continue;
        }
        throw new Error(
          rows === 0
            ? `CVM: o arquivo do IPE de ${year} veio sem nenhuma linha`
            : `CVM: nenhuma das ${rows} linhas do IPE de ${year} é fato relevante ou comunicado ao mercado (o formato mudou?)`,
        );
      }

      const tickers = await this.news.tickersByCnpj([...new Set(docs.map((doc) => doc.cnpj))]);
      const pairs = docs.flatMap((doc) => {
        const draft = cvmDraft(doc, tickers.get(doc.cnpj) ?? [], now);
        return draft ? [{ doc, draft }] : [];
      });
      const drafts: NewsDraft[] = pairs.map((pair) => pair.draft);
      if (read.backfill) {
        // um lote por dia de entrega, em ordem de data, cada um com a hora em que o pipeline ao vivo o teria visto
        const byDay = new Map<IsoDate, NewsDraft[]>();
        for (const { doc, draft } of pairs) {
          byDay.set(doc.deliveredOn, [...(byDay.get(doc.deliveredOn) ?? []), draft]);
        }
        for (const [day, batch] of [...byDay].sort(([a], [b]) => (a < b ? -1 : 1))) {
          created += await this.news.saveNews(batch, read.backfill.seenAt(day));
        }
      } else {
        created += await this.news.saveNews(drafts, seenNow(now));
      }
      // só agora: validador guardado antes faria uma falha acima pular o arquivo na próxima busca
      if (read.saveState) await this.news.saveFetchState(key, outcome.validators, now);
      this.logger.log({ year, rows, accepted, inWindow: docs.length }, 'IPE lido');
      documents += docs.length;
      mapped += drafts.length;
    }
    return { documents, mapped, created };
  }
}
