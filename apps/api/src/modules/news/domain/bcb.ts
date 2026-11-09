import { addDays, isIsoDate, type IsoDate } from '../../market-data/domain/dates.js';

// Macro do Banco Central pelo SGS (docs/DADOS.md, seção 15): CDI (série 12), meta Selic, IPCA e dólar PTAX. É a mesma
// fonte do CDI que rende o caixa dos modelos. O valor fica como texto decimal fixo (nunca float) e vira NUMERIC no
// banco. A data guardada é a do valor, não a da busca: o IPCA de setembro é 01/09/2026 mesmo buscado em outubro.

export interface MacroSeries {
  // nome na lista fixa, na tabela macro_daily e no briefing
  id: string;
  // código da série no SGS
  code: number;
  name: string;
  // casas decimais com que o BCB publica a série
  scale: number;
  // série mensal: o SGS data cada valor no dia 1 do mês e devolve o mês que contém a dataInicial (parseSgs)
  monthly?: true;
}

export const BCB_HOST = 'api.bcb.gov.br';

export const MACRO_SERIES: readonly MacroSeries[] = [
  { id: 'cdi_daily_pct', code: 12, name: 'CDI, taxa do dia (% ao dia)', scale: 6 },
  {
    id: 'selic_target_pct_year',
    code: 432,
    name: 'Meta Selic definida pelo Copom (% ao ano)',
    scale: 2,
  },
  { id: 'ipca_month_pct', code: 433, name: 'IPCA, variação do mês (%)', scale: 2, monthly: true },
  {
    id: 'ipca_12m_pct',
    code: 13522,
    name: 'IPCA, acumulado em 12 meses (%)',
    scale: 2,
    monthly: true,
  },
  // a série 1 é o PTAX de venda: conferida em 01/11/2026 contra o PTAX oficial (OData do BCB) em 29 e 30/10/2026
  { id: 'usd_brl_ptax_sell', code: 1, name: 'Dólar PTAX de venda (R$ por US$)', scale: 4 },
];

const ddmmyyyy = (date: IsoDate): string => {
  const [year, month, day] = date.split('-');
  return `${day}/${month}/${year}`;
};

export function sgsUrl(series: MacroSeries, from: IsoDate, to: IsoDate): string {
  const url = new URL(`https://${BCB_HOST}/dados/serie/bcdata.sgs.${series.code}/dados`);
  url.searchParams.set('formato', 'json');
  url.searchParams.set('dataInicial', ddmmyyyy(from));
  url.searchParams.set('dataFinal', ddmmyyyy(to));
  return url.toString();
}

export interface MacroPoint {
  date: IsoDate;
  // texto decimal com exatamente `scale` casas
  value: string;
}

// Nenhuma série pedida numa janela de pouco mais de um ano passa disto; o teto só impede resposta enorme.
const MAX_POINTS = 5000;
const DATE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const VALUE = /^(-?)(\d+)(?:\.(\d+))?$/;

function point(series: MacroSeries, raw: unknown): MacroPoint | null {
  if (typeof raw !== 'object' || raw === null)
    throw new Error(`SGS ${series.code}: ponto fora do formato`);
  const { data, valor } = raw as { data?: unknown; valor?: unknown };
  const dateMatch = typeof data === 'string' ? DATE.exec(data) : null;
  if (!dateMatch || typeof valor !== 'string')
    throw new Error(`SGS ${series.code}: ponto fora do formato`);
  const date = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
  if (!isIsoDate(date)) throw new Error(`SGS ${series.code}: data inexistente`);

  const text = valor.trim();
  if (text === '') return null; // dia sem dado
  const match = VALUE.exec(text);
  if (!match) throw new Error(`SGS ${series.code}: valor fora do formato`);
  const [, sign, whole, fraction = ''] = match;
  // zeros além das casas da série são o mesmo número; dígito além delas é a fonte que mudou de precisão
  if (/[1-9]/.test(fraction.slice(series.scale))) {
    throw new Error(`SGS ${series.code}: valor com mais casas que as ${series.scale} da série`);
  }
  const digits = fraction.slice(0, series.scale).padEnd(series.scale, '0');
  const unsigned = series.scale > 0 ? `${whole}.${digits}` : whole!;
  return { date, value: /[1-9]/.test(unsigned) ? `${sign}${unsigned}` : unsigned };
}

// A resposta do SGS: lista de { data: "dd/MM/aaaa", valor: "texto" }. Ordena por data; na data repetida vale o último.
// Com `window` (a que foi pedida), ponto datado fora dela falha: um ponto de 2099 faria lastDates() devolver 2099 e a série
// nunca mais seria buscada (missingWindow dá null), sem erro nenhum. O SGS respeita dataFinal, então isso só acontece com
// resposta errada ou hostil. A exceção é o começo da série mensal: o SGS data o valor no dia 1 do mês e devolve o mês que
// contém a dataInicial (conferido em 06/11/2026: o 433 e o 13522 pedidos a partir de 02/10/2025 começam em 01/10/2025), então
// ali a janela começa no dia 1 do mês. O fim continua estrito: o perigo é o ponto no futuro.
export function parseSgs(
  series: MacroSeries,
  body: unknown,
  window?: { from: IsoDate; to: IsoDate },
): MacroPoint[] {
  if (!Array.isArray(body)) throw new Error(`SGS ${series.code}: a resposta não é uma lista`);
  if (body.length > MAX_POINTS) throw new Error(`SGS ${series.code}: mais de ${MAX_POINTS} pontos`);
  const start = window && (series.monthly ? `${window.from.slice(0, 7)}-01` : window.from);
  const byDate = new Map<IsoDate, MacroPoint>();
  for (const raw of body as unknown[]) {
    const parsed = point(series, raw);
    if (parsed && window && start && (parsed.date < start || parsed.date > window.to)) {
      throw new Error(`SGS ${series.code}: ponto fora da janela pedida`);
    }
    if (parsed) byDate.set(parsed.date, parsed);
  }
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// Quase um ano e meio de histórico na primeira carga: cobre uma temporada inteira e a comparação com o ano anterior.
const FIRST_LOAD_DAYS = 400;

// O que falta de uma série: do último valor guardado até hoje. null se já tem até hoje (a meta Selic vem projetada
// para os dias seguintes, então o último guardado pode estar no futuro). Nunca refaz o histórico.
// A janela começa NO último dia guardado, e não no seguinte, por causa do SGS (conferido em 01/11/2026): ele recusa
// janela de um dia só com HTTP 400 ("DataFinal deve ser maior que dataInicial") e responde 404 à janela sem dado.
// Começando no último dia guardado, a janela tem sempre mais de um dia, traz de volta o último ponto (que não muda
// nada) e ainda pega uma revisão dele.
export function missingWindow(
  lastStored: IsoDate | null,
  today: IsoDate,
): { from: IsoDate; to: IsoDate } | null {
  const from = lastStored === null ? addDays(today, -FIRST_LOAD_DAYS) : lastStored;
  return from >= today ? null : { from, to: today };
}

// O SGS responde 404 com { erro: { statusCode: 404, detail: "...Value(s) not found" } } quando a janela não tem valor.
// Isso é "nada de novo", não falha; um 404 com outro corpo (série que não existe) continua sendo falha.
export function isNoValuesResponse(body: Uint8Array): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body).toString('utf8'));
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null) return false;
  const error = (parsed as { erro?: unknown }).erro;
  if (typeof error !== 'object' || error === null) return false;
  const detail = (error as { detail?: unknown }).detail;
  return typeof detail === 'string' && /Value\(s\) not found|não encontrado/i.test(detail);
}
