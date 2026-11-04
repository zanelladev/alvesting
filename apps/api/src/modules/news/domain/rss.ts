import { XMLParser, XMLValidator } from 'fast-xml-parser';

// Leitura de feed RSS 2.0 (docs/DADOS.md, seção 13). O feed é texto de terceiro: o XML é validado antes de ser lido,
// e DTD e declaração de entidade são recusados antes de qualquer análise (XXE e bomba de entidades precisam de
// <!DOCTYPE> ou <!ENTITY>; sem eles o parser só decodifica as cinco entidades do XML e as referências numéricas).
// As entidades de HTML (&nbsp;, &hellip;) ficam no texto e quem decodifica é cleanText. Este módulo só dá forma;
// limpar o texto é com text.ts.
// ponytail: só RSS 2.0. Os quatro feeds da lista fixa são RSS 2.0 (conferido em 01/11/2026); Atom entra quando uma
// fonte precisar.

export const MAX_FEED_ITEMS = 100;

export class FeedFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FeedFormatError';
  }
}

export interface RssItem {
  title: string;
  link: string;
  // o <description> bruto (HTML); o corpo inteiro do <content:encoded> não é lido
  summary: string;
  // null quando o feed não informa a data ou a informa sem fuso (o fuso do servidor não pode decidir a hora)
  publishedAt: Date | null;
}

// ponytail: a conferência olha o documento inteiro, CDATA e comentário incluídos. Um item cujo texto traz literalmente
// "<!DOCTYPE" derruba a fonte (falha fechada) até sair do feed, de 1 a 2 dias, e nas notícias de mercado isso quase não
// acontece. Poupar o CDATA exigiria um leitor igual ao do parser: um desvio entre os dois (um "<![CDATA[" escondido num
// comentário, por exemplo) esconderia um DOCTYPE de verdade, que é XXE. Se um feed de assunto técnico entrar na lista, trocar
// por um parser que recuse DTD sozinho (fast-xml-parser sem processEntities) em vez de afrouxar esta expressão.
const DTD = /<!(?:DOCTYPE|ENTITY)\b/i;

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true, // content:encoded -> encoded, atom:link -> link
  parseTagValue: false, // tudo texto: "2026" não vira número
  trimValues: true,
  htmlEntities: false,
  maxNestedTags: 20, // um RSS tem uns 5 níveis
  isArray: (tag) => tag === 'item',
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// O primeiro valor que é texto não vazio: <link> repetido (o do atom dentro do item) vira lista.
function firstText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string' && entry.trim() !== '') return entry.trim();
    }
  }
  return '';
}

// Só data com fuso explícito: RFC 822 ("Sun, 01 Nov 2026 16:45:00 +0000", "-0300", "GMT") e ISO 8601 com Z ou
// deslocamento. "2026-11-01 16:51:17" (Investing.com) seria lida no fuso do servidor, que muda de máquina para máquina.
const HAS_ZONE = /(?:Z|GMT|UTC?|[+-]\d{2}:?\d{2})$/i;

export function parseFeedDate(text: string | undefined): Date | null {
  const value = text?.trim();
  if (!value || !HAS_ZONE.test(value)) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time);
}

export function parseRss(xml: string): RssItem[] {
  if (DTD.test(xml))
    throw new FeedFormatError('o feed traz DTD ou declaração de entidade: recusado');
  const valid = XMLValidator.validate(xml);
  if (valid !== true) throw new FeedFormatError(`XML mal formado (linha ${valid.err.line})`);

  let document: unknown;
  try {
    document = parser.parse(xml);
  } catch {
    throw new FeedFormatError('XML inválido (estrutura profunda demais ou fora do esperado)');
  }
  const rss = isRecord(document) ? document.rss : undefined;
  const channel = isRecord(rss) ? rss.channel : undefined;
  if (!isRecord(channel)) throw new FeedFormatError('não é um feed RSS 2.0 (sem rss/channel)');

  const items: RssItem[] = [];
  for (const entry of Array.isArray(channel.item) ? (channel.item as unknown[]) : []) {
    if (items.length >= MAX_FEED_ITEMS) break;
    if (!isRecord(entry)) continue;
    const title = firstText(entry.title);
    const link = firstText(entry.link);
    if (title === '' || link === '') continue;
    items.push({
      title,
      link,
      summary: firstText(entry.description),
      publishedAt: parseFeedDate(firstText(entry.pubDate)),
    });
  }
  return items;
}
