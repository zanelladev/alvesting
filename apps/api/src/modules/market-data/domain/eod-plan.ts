import { missingTooMuch, type FailCause } from './bar-plan.js';
import { addDays, brasiliaInstant, type IsoDate } from './dates.js';

// A brapi ainda não tem a barra de todo papel do conjunto obrigatório (plano, 5.5 e 7; docs/DADOS.md, seção 7): o eod publica a mesma
// mensagem agendada para daqui a 60 minutos, até 00:30 de Brasília do dia seguinte, e pede de novo só o que falta. Na tentativa que cai
// nesse prazo ou depois dele o pregão conclui com o que tem. Conclui antes, na hora, quando a falta é toda definitiva e pequena: com a
// barra do BOVA11 gravada o dia saiu na brapi, e a falta definitiva não muda numa nova tentativa (as noites de 16 e 17/11/2026: os papéis
// que faltavam às 21:35 não vieram até as 00:30).
export const RETRY_MINUTES = 60;
const DEADLINE_TIME = '00:30';

// Por que um papel do obrigatório ficou sem a barra do pregão nesta tentativa (vai ao log): `no-bar` (a brapi respondeu bem e sem ela: o
// papel não negociou no dia, ou está suspenso), a causa da falha do papel (FailCause, em bar-plan.ts) ou `not-asked` (a passada parou antes
// dele: cota, tempo, queda, ou a sonda do BOVA11 sem a barra do dia).
export type MissingReason = 'no-bar' | 'not-asked' | FailCause;

// A falta definitiva naquele pregão: a resposta boa sem a barra, o 404 (só pela situação HTTP, o corpo de erro nunca é lido: para um papel
// do universo diz o mesmo que a resposta sem a barra) e o ticker trocado. O resto (outro 4xx, formato torto, rede, timeout, 5xx, 429, o
// papel não alcançado) espera a nova tentativa, como antes.
const DEFINITIVE: ReadonlySet<MissingReason> = new Set(['no-bar', 'not-found', 'changed']);

// O motivo, a partir do que a passada deu ao papel (LoadReport.outcomes): nada é `not-asked`, e a resposta boa é `no-bar` (o papel continua
// sem a barra depois dela).
export const reasonOf = (outcome: 'ok' | FailCause | undefined): MissingReason =>
  outcome === undefined ? 'not-asked' : outcome === 'ok' ? 'no-bar' : outcome;

export type MissingFilePlan =
  | { action: 'retry'; at: Date }
  // a falta é toda definitiva, com o BOVA11 gravado e dentro do limite do alerta: conclui agora, pelo mesmo caminho do prazo
  | { action: 'definitive' }
  | { action: 'deadline' };

// `missing`: os papéis do obrigatório que seguem sem a barra de D depois desta passada, com o motivo de cada um; `required`: quantos são.
export function planMissingFile(
  date: IsoDate,
  now: Date,
  missing: ReadonlyMap<string, MissingReason>,
  required: number,
): MissingFilePlan {
  // Sem esperar o prazo só dentro do limite do alerta eod-barras-ausentes (missingTooMuch: a barra do BOVA11 gravada e no máximo
  // MISSING_ALERT_PERCENT do obrigatório faltando). A falta que passa dele espera o prazo, como antes: a brapi que publicasse o BOVA11
  // antes do resto fecharia o dia com boa parte do universo sem barra.
  if (
    !missingTooMuch([...missing.keys()], required) &&
    [...missing.values()].every((reason) => DEFINITIVE.has(reason))
  ) {
    return { action: 'definitive' };
  }
  const deadline = brasiliaInstant(addDays(date, 1), DEADLINE_TIME);
  if (now.getTime() >= deadline.getTime()) return { action: 'deadline' };
  const next = new Date(now.getTime() + RETRY_MINUTES * 60_000);
  // atraso na fila empurraria a tentativa final para depois do prazo: encaixa no prazo
  return { action: 'retry', at: next.getTime() <= deadline.getTime() ? next : deadline };
}
