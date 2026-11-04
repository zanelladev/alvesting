import { addDays, addMonths, type IsoDate } from './dates.js';
import { REFERENCE_TICKER } from './instruments.js';
import type { TradingCalendar } from './trading-calendar.js';

// O que pedir à brapi (plano 5.5; docs/DADOS.md, seção 6). O banco é o cache: cada barra é pedida uma vez, e o pedido de hoje é a falta
// do que o banco já tem. Aqui só a conta, sem rede e sem banco.

// Plano gratuito (preços de 03/11/2026): 15 mil requisições numa janela móvel de 30 dias (o cabeçalho X-RateLimit-Window diz `rolling-30d`; a
// prova controlada de 04/11/2026 viu a cota cair de 1 em 1 e o 400 e o 404 não gastarem), um papel por requisição, histórico de 3 meses (na
// prática, no máximo 90 dias entre startDate e endDate em cada pedido: `historyStart`, abaixo).
export const BRAPI_PLAN = { requestsPerWindow: 15_000, windowDays: 30, historyMonths: 3 } as const;

// A janela de cada noite: os 5 últimos pregões até D, para o dia que falhou ser recuperado na noite seguinte.
export const WINDOW_SESSIONS = 5;

// ponytail: 500 requisições de reserva, uns 1,6 conjunto obrigatório (310 papéis) por noite. O consumo planejado é de uns 8 mil por mês
// (docs/DADOS.md, seção 6), então a reserva só é tocada por um erro (laço, carga em dobro). Abaixo dela o eod, a atualização semanal e a
// carga inicial param e deixam o resto como falta, em vez de zerar a conta e impedir a recuperação de um papel ou de uma janela à mão.
// Se o plano mudar (Startup tem 150 mil), a reserva continua valendo e pode subir junto.
export const QUOTA_RESERVE = 500;

// ponytail: o eod-barras-ausentes dispara se faltar o BOVA11 ou mais de 10% do conjunto obrigatório no prazo. Um dia comum deixa de 3% a 5%
// dos papéis sem negócio (ilíquidos), e o briefing pula o ciclo quando menos de 80% do universo tem fechamento: 10% avisa com folga, antes de
// o ciclo parar. Com o universo real, ajustar depois do primeiro mês.
export const MISSING_ALERT_PERCENT = 10;

export function windowOf(
  calendar: Pick<TradingCalendar, 'tradingDaysBefore'>,
  date: IsoDate,
): IsoDate[] {
  return [...calendar.tradingDaysBefore(date, WINDOW_SESSIONS - 1), date];
}

// A carga de papel novo e a carga inicial: três meses atrás, que é o histórico do plano gratuito, mais 3 dias de folga. A doc diz só "até 3
// meses"; a brapi de verdade recusa o pedido que passa de 90 dias entre startDate e endDate (400 DATE_WINDOW_EXCEEDED, "no máximo 90 dias",
// prova controlada de 04/11/2026: 88 dias passaram, 274 não), e não olha a idade do início. Três meses de calendário vão de 89 a 92 dias, e a
// folga de 3 dias deixa o pedido em 86 a 89, abaixo do teto em qualquer data, ao custo de 2 pregões de histórico.
const HISTORY_MARGIN_DAYS = 3;
export const historyStart = (date: IsoDate): IsoDate =>
  addDays(addMonths(date, -BRAPI_PLAN.historyMonths), HISTORY_MARGIN_DAYS);

export interface BarRequest {
  ticker: string;
  from: IsoDate;
  to: IsoDate;
}

// O pedido de cada papel é um só, do pregão mais antigo que lhe falta até o fim da janela: pedir a janela inteira ou só o buraco custa a
// mesma requisição, e pedir só o que falta evita trazer de volta barra que o banco já tem.
//  - `require`: o pregão que tem de existir (a noite do eod pede D). O papel que já o tem não é pedido, mesmo com um buraco mais atrás: é
//    pregão sem negócio, e pedi-lo de novo a cada nova tentativa da noite gastaria a cota por nada.
//  - sem `require`, qualquer pregão faltando pede o papel (a carga inicial e a atualização semanal).
export function planRequests(
  tickers: readonly string[],
  sessions: readonly IsoDate[],
  have: ReadonlyMap<string, ReadonlySet<IsoDate>>,
  require?: IsoDate,
): BarRequest[] {
  const to = sessions.at(-1);
  if (to === undefined) return [];
  const requests: BarRequest[] = [];
  for (const ticker of tickers) {
    const got = have.get(ticker);
    if (require !== undefined && got?.has(require)) continue;
    const from = sessions.find((day) => !got?.has(day));
    if (from !== undefined) requests.push({ ticker, from, to });
  }
  return requests;
}

export interface QuoteTargets {
  // sem eles o pregão não conclui: o universo da semana ISO, o BOVA11 (primeiro, é a sonda de "o dia saiu") e os papéis em posição
  required: string[];
  // as carteiras dos usuários fora do obrigatório: pedidas uma vez, na tentativa que conclui o pregão, e sem segurar a conclusão
  optional: string[];
}

export function quoteTargets(input: {
  universe: readonly string[];
  held: readonly string[];
  portfolio: readonly string[];
}): QuoteTargets {
  const required = [...new Set([REFERENCE_TICKER, ...input.universe, ...input.held])];
  const has = new Set(required);
  const optional = [...new Set(input.portfolio)].filter((ticker) => !has.has(ticker));
  return { required, optional };
}

// Faltou o BOVA11 ou mais que MISSING_ALERT_PERCENT do obrigatório: o eod-barras-ausentes.
export function missingTooMuch(missing: readonly string[], requiredCount: number): boolean {
  return (
    missing.includes(REFERENCE_TICKER) ||
    missing.length * 100 > requiredCount * MISSING_ALERT_PERCENT
  );
}
