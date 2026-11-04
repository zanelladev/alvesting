import { addDays, brasiliaDate, isIsoDate, type IsoDate } from '../../market-data/domain/dates.js';
import { isTickerShape } from './tickers.js';

// CVM, dados abertos (docs/DADOS.md, seção 14). Dois arquivos ZIP por ano:
// - IPE: os documentos que as companhias entregam (fato relevante, comunicado ao mercado...), um por linha;
// - FCA, arquivo de valor mobiliário: os códigos de negociação de cada companhia, com o CNPJ.
// O documento vai para o ticker certo pelo CNPJ: CNPJ do IPE -> códigos do FCA -> instrumentos da etapa 4.

export const CVM_HOST = 'dados.cvm.gov.br';
const BASE = `https://${CVM_HOST}/dados/CIA_ABERTA/DOC`;

const assertYear = (year: number): void => {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new RangeError(`Ano inválido: ${year}`);
  }
};
export function ipeUrl(year: number): string {
  assertYear(year);
  return `${BASE}/IPE/DADOS/ipe_cia_aberta_${year}.zip`;
}
export function fcaUrl(year: number): string {
  assertYear(year);
  return `${BASE}/FCA/DADOS/fca_cia_aberta_${year}.zip`;
}

// O arquivo que interessa dentro de cada ZIP (o do FCA traz dez CSV).
export const IPE_ENTRY = /^ipe_cia_aberta_\d{4}\.csv$/i;
export const FCA_ENTRY = /^fca_cia_aberta_valor_mobiliario_\d{4}\.csv$/i;

// As colunas que cvmDocument e fcaPair leem. A CVM renomear uma delas deixaria toda linha "torta" (vira null), e o arquivo
// passaria por processado sem nenhum documento: o leitor confere o cabeçalho antes (infrastructure/zip-csv.ts).
export const IPE_COLUMNS = [
  'CNPJ_Companhia',
  'Nome_Companhia',
  'Categoria',
  'Tipo',
  'Assunto',
  'Data_Entrega',
  'Link_Download',
] as const;
export const FCA_COLUMNS = ['CNPJ_Companhia', 'Codigo_Negociacao'] as const;

// Quantos dias para trás um documento ainda entra. O arquivo do ano é regenerado uma vez por dia (por volta de 07:00
// em Brasília): a janela cobre uns dias sem o worker e o atraso da CVM. O que já entrou não entra de novo (url_hash).
// ponytail: 7 dias fixos. Parada do worker por mais que isso perde documento; nesse caso, ampliar a janela e rodar
// `news:fetch cvm-ipe` uma vez.
export const IPE_WINDOW_DAYS = 7;

export const ipeWindowStart = (now: Date): IsoDate => addDays(brasiliaDate(now), -IPE_WINDOW_DAYS);

// Os anos que a janela toca: na virada do ano, o arquivo do ano anterior também.
export function ipeYears(now: Date): number[] {
  const start = Number(ipeWindowStart(now).slice(0, 4));
  const end = Number(brasiliaDate(now).slice(0, 4));
  return start === end ? [end] : [start, end];
}

// O arquivo do ano novo pode não existir nas primeiras semanas de janeiro (a CVM o cria depois). Passada a metade de
// janeiro, a falta é erro. O do ano anterior tem de existir sempre.
export function mayBeMissing(year: number, now: Date): boolean {
  const today = brasiliaDate(now);
  return today.startsWith(`${year}-`) && today < `${year}-01-15`;
}

const CNPJ = /^\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}$/;
const cnpjDigits = (value: string | undefined): string | null => {
  const text = (value ?? '').trim();
  return CNPJ.test(text) ? text.replace(/\D/g, '') : null;
};

export type CvmCategory = 'Fato Relevante' | 'Comunicado ao Mercado';
const CATEGORIES: ReadonlySet<string> = new Set<CvmCategory>([
  'Fato Relevante',
  'Comunicado ao Mercado',
]);

export interface CvmDocument {
  cnpj: string; // 14 dígitos
  company: string;
  category: CvmCategory;
  type: string;
  subject: string;
  deliveredOn: IsoDate;
  link: string;
}

type CsvRecord = Readonly<Record<string, string | undefined>>;

// Uma linha do IPE. Só fato relevante e comunicado ao mercado (o resto, como assembleia, demonstração financeira e
// reunião da administração, são 90% das linhas e não mudam o preço do dia seguinte). Linha torta vira null.
export function cvmDocument(record: CsvRecord): CvmDocument | null {
  const category = (record.Categoria ?? '').trim();
  const cnpj = cnpjDigits(record.CNPJ_Companhia);
  const deliveredOn = (record.Data_Entrega ?? '').trim();
  const company = (record.Nome_Companhia ?? '').trim();
  const link = (record.Link_Download ?? '').trim();
  if (!CATEGORIES.has(category) || cnpj === null) return null;
  if (!isIsoDate(deliveredOn) || company === '' || link === '') return null;
  return {
    cnpj,
    company,
    category: category as CvmCategory,
    type: (record.Tipo ?? '').trim(),
    subject: (record.Assunto ?? '').trim(),
    deliveredOn,
    link,
  };
}

export interface FcaPair {
  code: string;
  cnpj: string;
}

// Uma linha do cadastro de valores mobiliários do FCA. O campo de código vem com "NÃO HÁ", "N/A", "000000" e até
// "PETR3, PETR4" quando a companhia não preenche direito, e minúsculo (tgma3): só vale o que tem o formato de ticker
// da B3 depois de maiúsculas.
export function fcaPair(record: CsvRecord): FcaPair | null {
  const code = (record.Codigo_Negociacao ?? '').trim().toUpperCase();
  const cnpj = cnpjDigits(record.CNPJ_Companhia);
  return isTickerShape(code) && cnpj !== null ? { code, cnpj } : null;
}

// Companhias que o cadastro da CVM deixa sem o código de negociação (conferido no FCA e no IPE de 01/11/2026; o nome
// da companhia no IPE bate com o do instrumento). Chave: a raiz de quatro letras do ticker. O CNPJ é o do
// IPE. Só entram as que estão no universo e negociam de verdade; o resto do cadastro fica como está.
// ponytail: lista curada à mão, revista quando o universo mudar muito. O FCA corrigido por conta própria vale mais.
export const FCA_GAPS = {
  BPAC: '30306294000145', // Banco BTG Pactual S/A (o FCA cita o código "000000")
  CSNA: '33042730000104', // Companhia Siderúrgica Nacional
  MBRF: '03853896000140', // Marfrig Global Foods / MBRF (o IPE ainda usa o nome Marfrig)
  CMIN: '08902291000115', // CSN Mineração
  EQPA: '04895728000180', // Equatorial Pará Distribuidora de Energia
} as const satisfies Record<string, string>;
const GAPS = new Map<string, string>(Object.entries(FCA_GAPS));

const addTo = (map: Map<string, Set<string>>, key: string, value: string): void => {
  const set = map.get(key);
  if (set) set.add(value);
  else map.set(key, new Set([value]));
};

// ticker -> CNPJ, só para os instrumentos conhecidos. Na ordem:
// 1. o código que o FCA cita (se citar para dois CNPJ, é ambíguo e fica sem);
// 2. as outras séries da mesma companhia, pela raiz de quatro letras (o FCA lista a unit KLBN11, e KLBN3 e KLBN4
//    herdam o CNPJ); raiz que o FCA atribui a dois CNPJ não herda;
// 3. as lacunas conhecidas do cadastro (FCA_GAPS).
export function buildTickerCnpj(
  pairs: readonly FcaPair[],
  known: ReadonlySet<string>,
): Map<string, string> {
  const byCode = new Map<string, Set<string>>();
  const byPrefix = new Map<string, Set<string>>();
  for (const { code, cnpj } of pairs) {
    addTo(byCode, code, cnpj);
    addTo(byPrefix, code.slice(0, 4), cnpj);
  }
  const result = new Map<string, string>();
  for (const ticker of [...known].sort()) {
    const direct = byCode.get(ticker);
    if (direct) {
      if (direct.size === 1) result.set(ticker, [...direct][0]!);
      continue;
    }
    const family = byPrefix.get(ticker.slice(0, 4));
    if (family?.size === 1) {
      result.set(ticker, [...family][0]!);
      continue;
    }
    const gap = GAPS.get(ticker.slice(0, 4));
    if (gap) result.set(ticker, gap);
  }
  return result;
}
