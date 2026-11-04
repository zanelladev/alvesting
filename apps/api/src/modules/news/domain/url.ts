import { createHash } from 'node:crypto';

// A URL da notícia vira a chave única (news_item.url_hash) e o link da página pública. Por isso:
// - só http e https passam (javascript:, data: e file: seriam link malicioso na página);
// - usuário e senha na URL são recusados;
// - a normalização tira o que muda sem a matéria mudar: fragmento, parâmetros de rastreio, ordem dos parâmetros,
//   porta padrão, barra final e caixa do esquema e do host.
// ponytail: o esquema http não vira https (a matéria pode não ter versão segura) e o caminho mantém a caixa. Duas URLs
// da mesma matéria que diferem nisso viram duas notícias; para a arena, uma duplicata é inofensiva.

const MAX_URL_LENGTH = 2048;

// Os parâmetros de rastreio mais comuns de feed e de rede social. utm_* entra por prefixo.
const TRACKING = new Set([
  'fbclid',
  'gclid',
  'dclid',
  'msclkid',
  'yclid',
  'twclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  '_ga',
  '_gl',
  'ref',
  'ref_src',
  'cmpid',
  'xtor',
]);

const isTracking = (name: string): boolean => {
  const lower = name.toLowerCase();
  return lower.startsWith('utm_') || TRACKING.has(lower);
};

const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function normalizeUrl(input: string): string | null {
  const text = input.trim();
  if (text === '' || text.length > MAX_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '' || url.hostname === '') return null;

  url.hash = '';
  const kept = [...url.searchParams]
    .filter(([name]) => !isTracking(name))
    .sort(([nameA, valueA], [nameB, valueB]) => compare(nameA, nameB) || compare(valueA, valueB));
  url.search = new URLSearchParams(kept).toString(); // vazio tira o "?"
  if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
    url.pathname = url.pathname.slice(0, -1);
  }
  const normalized = url.toString();
  return normalized.length > MAX_URL_LENGTH ? null : normalized;
}

// SHA-256 em hexadecimal de uma URL que JÁ foi normalizada (a saída de normalizeUrl). Quem tem só a URL do feed usa urlHash.
export const hashOfNormalized = (normalized: string): string =>
  createHash('sha256').update(normalized).digest('hex');

// SHA-256 em hexadecimal da URL normalizada; null se a URL não passa.
export function urlHash(input: string): string | null {
  const normalized = normalizeUrl(input);
  return normalized === null ? null : hashOfNormalized(normalized);
}
