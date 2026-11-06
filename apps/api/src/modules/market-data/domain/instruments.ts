// Os papéis que a arena conhece: as ações à vista (candidatas ao universo) e a referência. As cotações vêm da brapi (docs/DADOS.md): ela
// não informa ISIN nem a espécie da B3, então a classe do papel sai do sufixo do código, e o ISIN de um papel semeado pela lista fica nulo.

export type InstrumentKind = 'STOCK' | 'REFERENCE';

// O ETF do Ibovespa: fora do universo, mas sempre buscado e gravado, porque o briefing e o ranking o usam (plano, seção 2).
export const REFERENCE_TICKER = 'BOVA11';
export const REFERENCE_TICKERS: ReadonlySet<string> = new Set([REFERENCE_TICKER]);

export interface InstrumentSeed {
  ticker: string;
  name: string;
  // classe da espécie: ON, PN, PNA a PND, UNT (CI para o ETF), sem os sufixos de evento e de segmento
  spec: string;
  kind: InstrumentKind;
}

export const REFERENCE_SEED: InstrumentSeed = {
  ticker: REFERENCE_TICKER,
  name: 'ISHARES BOVA',
  spec: 'CI',
  kind: 'REFERENCE',
};

// Código de ação da B3: quatro caracteres, o primeiro uma letra (PETR4, B3SA3, BPAC11), e o número da classe.
const STOCK_CODE = /^[A-Z][A-Z0-9]{3}(\d{1,2})$/;
// O número que fecha o código diz a classe: 3 é ON, 4 a 8 são PN (PNA a PND no 5 a 8) e 11 é a unit. O resto (1, 2, 9, 10, 12...) é
// direito, recibo ou fundo, e fica de fora.
const CLASS_OF_SUFFIX: Readonly<Record<string, string>> = {
  '3': 'ON',
  '4': 'PN',
  '5': 'PNA',
  '6': 'PNB',
  '7': 'PNC',
  '8': 'PND',
  '11': 'UNT',
};
const MAX_NAME_LENGTH = 60;

export interface Listing {
  // o código negociado, como a lista da brapi o chama (`stock`)
  ticker: string;
  name?: string | null;
  // `subType` da lista da brapi: stock, unit, fii, etf, bdr...
  subType?: string | null;
  // o SVG do logo em icons.brapi.dev, já conferido (`logoUrl`, brapi.client.ts); nulo é "sem logo" (ADR 0036)
  logo?: string | null;
}

// Uma linha da lista de ações da brapi vira o papel a semear, ou nada se não for ação à vista do lote padrão. O tipo da brapi e o sufixo têm
// de concordar: unit só no 11, e o 11 só com subtipo unit (ETF e FII também terminam em 11, e o `subType` da lista é nulo para alguns
// ativos). `explicit`: o código foi digitado por quem opera (market:backfill --papeis), e sem subtipo vale o sufixo.
export function seedOf(listing: Listing, explicit = false): InstrumentSeed | undefined {
  const ticker = listing.ticker.trim().toUpperCase();
  const suffix = STOCK_CODE.exec(ticker)?.[1];
  if (suffix === undefined) return undefined;
  const spec = CLASS_OF_SUFFIX[suffix];
  if (spec === undefined) return undefined;
  const subType = listing.subType ?? undefined;
  if (subType !== undefined && subType !== 'stock' && subType !== 'unit') return undefined;
  if (subType === 'unit' && spec !== 'UNT') return undefined;
  if (spec === 'UNT' && subType !== 'unit' && !(explicit && subType === undefined))
    return undefined;
  if (REFERENCE_TICKERS.has(ticker)) return undefined;
  // o nome é dado de terceiro: sem caractere de controle e com teto; sem nome, vale o código
  const name = (listing.name ?? '').replace(/\p{C}/gu, ' ').trim().slice(0, MAX_NAME_LENGTH);
  return { ticker, name: name === '' ? ticker : name, spec, kind: 'STOCK' };
}
