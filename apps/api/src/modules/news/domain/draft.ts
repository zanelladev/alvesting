import { brasiliaInstant } from '../../market-data/domain/dates.js';
import type { CvmDocument } from './cvm.js';
import type { RssItem } from './rss.js';
import type { RssSource } from './sources.js';
import { SNIPPET_MAX, TITLE_MAX, cleanText } from './text.js';
import { findTickers } from './tickers.js';
import { hashOfNormalized, normalizeUrl } from './url.js';

// A notícia pronta para gravar (news_item): tudo que veio de fora já passou por cleanText, a URL já foi normalizada
// e os tickers já foram validados contra os instrumentos conhecidos.
export interface NewsDraft {
  url: string;
  urlHash: string;
  source: string;
  title: string;
  snippet: string;
  tickers: string[];
  publishedAt: Date;
}

// Nenhuma fonte publica no futuro: data adiante do relógio (fuso errado no feed) vale a hora da busca. Sem data, também.
const publishedAt = (reported: Date | null, now: Date): Date =>
  reported === null || reported > now ? now : reported;

// A hora em que o worker "viu" o lote (news_item.first_seen_at) é a da gravação, não a do começo da busca. Entre as duas
// passam até 20 s de rede e o processamento do ZIP, e o briefing lê o banco nesse meio-tempo: um lote carimbado com a
// hora de antes do corte, mas gravado depois da leitura, não entraria neste briefing nem no seguinte (a janela do
// seguinte começa no corte). Nunca antes de `now`, porque published_at nunca passa de `now` e published_at <= first_seen_at
// é regra do banco.
export const seenNow = (now: Date): Date => new Date(Math.max(now.getTime(), Date.now()));

export function rssDraft(
  source: RssSource,
  item: RssItem,
  known: ReadonlySet<string>,
  now: Date,
): NewsDraft | null {
  const url = normalizeUrl(item.link);
  const title = cleanText(item.title, TITLE_MAX);
  if (url === null || title === '') return null;
  const snippet = cleanText(item.summary, SNIPPET_MAX);
  return {
    url,
    urlHash: hashOfNormalized(url),
    source: source.id,
    title,
    snippet,
    // só o que ficou guardado é marcado: quem lê o item vê por que o ticker está lá
    tickers: findTickers(`${title} ${snippet}`, known),
    publishedAt: publishedAt(item.publishedAt, now),
  };
}

// Documento da CVM. Os tickers vêm do CNPJ da companhia, não do texto: o assunto de uma empresa pode citar outra.
// Documento de companhia sem ticker conhecido não é notícia da arena.
export function cvmDraft(
  doc: CvmDocument,
  tickers: readonly string[],
  now: Date,
): NewsDraft | null {
  const url = normalizeUrl(doc.link);
  if (url === null || tickers.length === 0) return null;
  const subject = cleanText(doc.subject);
  const title = cleanText(
    `${doc.category}: ${doc.company}${subject === '' ? '' : ` - ${subject}`}`,
    TITLE_MAX,
  );
  if (title === '') return null;
  // o tipo do comunicado ("Esclarecimentos sobre questionamentos da CVM/B3") diz algo; o genérico não
  const type = cleanText(doc.type, SNIPPET_MAX);
  return {
    url,
    urlHash: hashOfNormalized(url),
    source: 'cvm-ipe',
    title,
    snippet: type.startsWith('Outros Comunicados') ? '' : type,
    tickers: [...new Set(tickers)].sort(),
    // a CVM informa só o dia da entrega: meia-noite de Brasília
    publishedAt: publishedAt(brasiliaInstant(doc.deliveredOn, '00:00'), now),
  };
}
