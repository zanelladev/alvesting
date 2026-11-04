import { Logger } from '@nestjs/common';
import type { MessagingService } from '../../messaging/infrastructure/messaging.service.js';
import {
  JobBusyError,
  type JobClaim,
  type JobRunStore,
} from '../../messaging/infrastructure/job-run.store.js';
import type { SettlementPublisher } from '../../settlement/application/settlement-publisher.js';
import { ALERT_LOG } from '../../../telemetry/alert-logs.js';
import { missingTooMuch, planRequests, quoteTargets, windowOf } from '../domain/bar-plan.js';
import { isoWeek, type IsoDate } from '../domain/dates.js';
import { planMissingFile } from '../domain/eod-plan.js';
import { REFERENCE_TICKER } from '../domain/instruments.js';
import type { TradingCalendar } from '../domain/trading-calendar.js';
import { FETCH_BUDGET_MS } from '../infrastructure/brapi.client.js';
import type { MarketRepository } from '../infrastructure/market.repository.js';
import type { UniverseRepository } from '../infrastructure/universe.repository.js';
import type { BarLoader } from './bar-loader.js';

export type EodOutcome =
  | 'complete' // todo papel do conjunto obrigatório tem a barra do pregão
  | 'closed_incomplete' // o prazo das 00:30 chegou: segue com o que tem
  | 'rescheduled' // falta papel: a mesma mensagem foi agendada para daqui a 60 minutos
  | 'already_done' // mensagem repetida: nada a fazer
  | 'not_trading_day';

// A mensagem `eod {pregão}` (plano 5.5 e 7; docs/DADOS.md, seção 7): busca na brapi as barras que o banco não tem, grava cada papel assim
// que ele chega, confirma o dia e pede a liquidação.
//  - Conjunto obrigatório: o universo da semana ISO do pregão, o BOVA11 e os papéis em posição de temporada em andamento. O pregão só
//    conclui com a barra de todos eles, ou no prazo das 00:30 de Brasília, quando segue com o que tem (planMissingFile). Um papel que a
//    brapi não devolve (suspenso, sem negócio) mantém as novas tentativas até o prazo, e só ele é pedido de novo.
//  - Conjunto opcional: os papéis das carteiras dos usuários fora do obrigatório. Pedido uma vez, na tentativa que conclui, sem segurá-la.
//  - A falta sai do banco (daily_bar): nova entrega ou nova tentativa pede só o que falta, e a segunda entrega de um pregão concluído não
//    pede nada. A janela é de 5 pregões: a noite em que a brapi esteve fora é recuperada na seguinte, e os pregões anteriores da janela
//    que ficam confirmados agora são liquidados junto, em ordem de data.
//  - O que já foi liquidado não muda sozinho: barra que chega atrasada para pregão já confirmado é gravada e não reabre a liquidação.
// O encadeamento eod -> settle: `settlement.afterEod` publica a liquidação ANTES de a linha de job_run concluir, então uma publicação que
// falhe repete o eod. O 7º argumento é opcional só para os testes do eod que não tratam da liquidação: o MarketDataModule sempre o passa.
// Não existe comando manual do eod, e o market:backfill carrega barras sem publicar settle.
export class EodHandler {
  private readonly logger = new Logger(EodHandler.name);

  constructor(
    private readonly jobs: Pick<JobRunStore, 'claim' | 'succeed' | 'fail' | 'wait'>,
    private readonly calendar: Pick<
      TradingCalendar,
      'isTradingDay' | 'tradingDaysBefore' | 'tradingDaysBetween' | 'lastDay'
    >,
    private readonly market: Pick<
      MarketRepository,
      | 'barDates'
      | 'confirmedDays'
      | 'confirmTradingDays'
      | 'seedCalendar'
      | 'heldTickers'
      | 'portfolioTickers'
    >,
    private readonly universe: Pick<UniverseRepository, 'tickersOf'>,
    private readonly loader: Pick<BarLoader, 'load'>,
    private readonly messaging: Pick<MessagingService, 'publishScheduled'>,
    private readonly settlement?: Pick<SettlementPublisher, 'afterEod'>,
  ) {}

  async execute(date: IsoDate, now: Date = new Date()): Promise<EodOutcome> {
    if (!this.calendar.isTradingDay(date)) {
      this.logger.warn({ date }, 'eod de um dia sem pregão: ignorado');
      return 'not_trading_day';
    }
    const message = { type: 'eod', date } as const;
    const claimed = await this.jobs.claim(message);
    if (claimed.status === 'done') {
      // Mensagem repetida: não pede nada à brapi. A publicação do settle da entrega anterior pode ter se perdido entre gravar as barras e
      // concluir a linha; publicar de novo é barato (o job_run do settle barra a repetição).
      await this.settlement?.afterEod([date]);
      return 'already_done';
    }
    if (claimed.status === 'busy') throw new JobBusyError(message);

    try {
      const outcome = await this.process(date, now, claimed.claim);
      if (outcome !== 'rescheduled') await this.jobs.succeed(claimed.claim);
      return outcome;
    } catch (error) {
      await this.jobs.fail(claimed.claim, error);
      throw error;
    }
  }

  private async process(
    date: IsoDate,
    now: Date,
    claim: JobClaim,
  ): Promise<Exclude<EodOutcome, 'already_done' | 'not_trading_day'>> {
    const startedAt = Date.now();
    const sessions = windowOf(this.calendar, date);
    const { required, optional } = quoteTargets({
      universe: await this.universe.tickersOf(isoWeek(date)),
      held: await this.market.heldTickers(),
      portfolio: await this.market.portfolioTickers(),
    });

    // Só o que falta: o papel que já tem a barra do pregão não é pedido. O BOVA11 vai primeiro: é a sonda de "o dia saiu". Se a brapi
    // responde e o BOVA11 não tem a barra do pregão, nenhum outro papel terá, e a passada acaba com uma requisição só.
    const have = await this.market.barDates(required, sessions[0]!, date);
    const report = await this.loader.load(planRequests(required, sessions, have, date), {
      stopAfter: (result) =>
        result.status === 'ok' &&
        result.ticker === REFERENCE_TICKER &&
        !result.bars.some((bar) => bar.date === date),
    });
    this.logger.log(
      {
        date,
        asked: report.asked,
        requests: report.requests,
        inserted: report.inserted,
        failed: report.failed.length,
        stopped: report.stopped,
      },
      'eod: barras do conjunto obrigatório pedidas à brapi',
    );

    const today = await this.market.barDates(required, date, date);
    const missing = required.filter((ticker) => !today.get(ticker)?.has(date));
    const plan = planMissingFile(date, now);
    if (missing.length > 0 && plan.action === 'retry') {
      // Publica a cópia antes de liberar a linha: se o processo cair no meio, o pior é uma cópia a mais, que a chave única barra. Ao
      // contrário, a mensagem se perderia.
      await this.messaging.publishScheduled({ type: 'eod', date }, plan.at);
      // Espera, não falha: WAITING (job_run), que o alerta de job falho não conta; a cópia agendada reassume a linha.
      await this.jobs.wait(
        claim,
        `faltam ${missing.length} de ${required.length} papéis do conjunto obrigatório em ${date}; nova tentativa agendada para ${plan.at.toISOString()}`,
      );
      this.logger.log(
        { date, missing: missing.length, retryAt: plan.at },
        'eod reagendado: falta papel do conjunto obrigatório',
      );
      return 'rescheduled';
    }

    // Conclui: completo, ou no prazo com o que tem.
    if (optional.length > 0) {
      // sem segurar a conclusão: o que não vier hoje a janela de amanhã pede. Divide o orçamento de tempo da trava da fila com o obrigatório.
      const left = Math.max(0, FETCH_BUDGET_MS - (Date.now() - startedAt));
      const haveOptional = await this.market.barDates(optional, sessions[0]!, date);
      await this.loader.load(planRequests(optional, sessions, haveOptional, date), {
        budgetMs: left,
      });
    }
    if (missing.length > 0) this.logMissing(date, missing, required.length);

    const confirmedBefore = await this.market.confirmedDays(sessions);
    const confirmed = await this.market.confirmTradingDays(
      sessions.filter((day) => !confirmedBefore.has(day)),
    );
    // os dias futuros saem da lista de feriados (previsão, ver TradingDaySource no schema)
    await this.market.seedCalendar(this.calendar.tradingDaysBetween(date, this.calendar.lastDay));
    // Liquida o pregão e os anteriores da janela que acabam de ser confirmados (a noite em que a brapi esteve fora), em ordem de data. Um
    // pregão que já estava confirmado não entra: barra atrasada dele foi gravada, mas a liquidação não reabre.
    const settle = [
      ...new Set([...confirmed, ...(confirmedBefore.has(date) ? [date] : [])]),
    ].sort();
    if (settle.length > 0) await this.settlement?.afterEod(settle);
    this.logger.log({ date, confirmed, settle }, 'eod concluído');
    return missing.length === 0 ? 'complete' : 'closed_incomplete';
  }

  // No prazo, com papel faltando: a contagem e os 20 primeiros vão ao log. Faltou o BOVA11, ou mais que MISSING_ALERT_PERCENT do obrigatório:
  // é o alerta eod-barras-ausentes (docs/INFRA.md, seção 5); o resto é só registro, porque papel sem negócio no dia é o normal.
  private logMissing(date: IsoDate, missing: string[], required: number): void {
    const context = { date, missing: missing.length, required, first: missing.slice(0, 20) };
    if (missingTooMuch(missing, required)) this.logger.error(context, ALERT_LOG.eodBarsMissing);
    else this.logger.log(context, 'eod concluído no prazo com papéis sem a barra do dia');
  }
}
