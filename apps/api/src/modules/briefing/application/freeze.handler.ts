import { Logger } from '@nestjs/common';
import type { QueueMessage } from '@alvesting/contracts';
import { JobBusyError, type JobRunStore } from '../../messaging/infrastructure/job-run.store.js';
import { brasiliaInstant, isoWeek, type IsoDate } from '../../market-data/domain/dates.js';
import type { TradingCalendar } from '../../market-data/domain/trading-calendar.js';
import { LIMITS, buildBriefing, type BuiltBriefing } from '../domain/briefing.js';
import type { BriefingArchive } from '../infrastructure/briefing.archive.js';
import { rulesOfSeasons } from '../domain/rules.js';
import type { BriefingRepository } from '../infrastructure/briefing.repository.js';

export type FreezeResult =
  | { outcome: 'frozen'; sha256: string; uri: string; stats: BuiltBriefing['stats'] }
  | { outcome: 'already_done' }
  | { outcome: 'not_trading_day' };

// O briefing é congelado às 07:30 de Brasília; as notícias vistas até esse instante entram, e as seguintes ficam para o
// próximo. O corte é fixo (não é a hora em que o worker rodou), então o briefing é uma função do banco e do pregão:
// refeito mais tarde com os mesmos dados dá os mesmos bytes.
const CUTOFF_BRT = '07:30';
// Quanto uma lacuna entre briefings pode puxar de notícia para trás.
const MAX_LOOKBACK_MS = 7 * 86_400_000;
const REFERENCE_TICKER = 'BOVA11';
// Folga entre o corte e a leitura do banco. O buscador carimba a notícia na hora da gravação (draft.ts, seenNow), então uma
// carimbada até o corte já terminou de gravar quando a leitura começa, a não ser que a confirmação demore mais que isto.
// Sem a folga, a leitura em 07:30:00,01 podia perder uma notícia carimbada 07:29:59,99 e ainda não confirmada: ela ficaria
// com hora de antes do corte e fora do briefing seguinte (que começa nele). O 08:00 do ciclo está a 30 minutos.
const READ_GRACE_MS = 10_000;
// Um briefing deste tamanho (uns 90 mil tokens) já aperta o contexto de um modelo de 128 mil. O de hoje tem 43 KB; no pior
// caso, 100 notícias de cada uma das cinco fontes, passa de 300 KB. Só avisa: cortar notícia é decisão da etapa 6, que sabe
// o orçamento de tokens de cada modelo.
const WARN_BYTES = 300_000;

const cutoffOf = (date: IsoDate): Date => brasiliaInstant(date, CUTOFF_BRT);

// A mensagem `freeze {pregão}` da fila `briefing` (plano 5.5 e 7): congela a entrada comum a todos os modelos, grava os
// bytes no Blob e registra pregão, SHA-256 e URI em `briefing`. Idempotente: a linha de job_run (freeze + pregão) e a
// linha de briefing (pregão único) barram a repetição, que não remonta nem regrava o Blob.
export class FreezeHandler {
  private readonly logger = new Logger(FreezeHandler.name);

  constructor(
    private readonly jobs: Pick<JobRunStore, 'claim' | 'succeed' | 'fail'>,
    private readonly calendar: Pick<
      TradingCalendar,
      'isTradingDay' | 'tradingDaysBefore' | 'previousTradingDay'
    >,
    private readonly repo: Pick<
      BriefingRepository,
      | 'find'
      | 'latestBefore'
      | 'firstAfter'
      | 'universe'
      | 'bars'
      | 'macro'
      | 'news'
      | 'runningSeasons'
      | 'save'
    >,
    private readonly archive: Pick<BriefingArchive, 'save'>,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
    // só o ensaio (arena:ensaio) o passa, para a função da fila usar a hora do dia simulado; em produção vale o relógio da máquina
    private readonly clock: () => Date = () => new Date(),
  ) {}

  readonly handle = async (message: QueueMessage): Promise<void> => {
    if (message.type !== 'freeze') {
      // handleDelivery já manda para a DLQ o que é de outra fila; isto é só a rede de segurança
      throw new Error(`A fila briefing não trata mensagens ${message.type}`);
    }
    await this.execute(message.date, this.clock());
  };

  async execute(date: IsoDate, now: Date = new Date()): Promise<FreezeResult> {
    if (!this.calendar.isTradingDay(date)) {
      this.logger.warn({ date }, 'freeze de um dia sem pregão: ignorado');
      return { outcome: 'not_trading_day' };
    }
    const message = { type: 'freeze', date } as const;
    const claimed = await this.jobs.claim(message);
    if (claimed.status === 'done') return { outcome: 'already_done' };
    if (claimed.status === 'busy') throw new JobBusyError(message);

    try {
      const result = await this.freeze(date, now);
      await this.jobs.succeed(claimed.claim);
      return result;
    } catch (error) {
      await this.jobs.fail(claimed.claim, error);
      throw error;
    }
  }

  private async freeze(date: IsoDate, now: Date): Promise<FreezeResult> {
    // Já congelado (o processo caiu entre gravar a linha e concluir o job): nada a refazer.
    if (await this.repo.find(date)) return { outcome: 'already_done' };

    // Fora de ordem: o briefing de um pregão posterior começa a janela no corte anterior a ele, que é o deste (ou antes). Se
    // este fosse congelado agora, as mesmas notícias entrariam nos dois, contra "exatamente um briefing" (DADOS.md, 18).
    const later = await this.repo.firstAfter(date);
    if (later !== null) {
      throw new Error(
        `Já existe o briefing de ${later}: congelar ${date} agora repetiria notícias dele (os briefings são congelados em ordem)`,
      );
    }

    const until = cutoffOf(date);
    if (now < until) {
      // Congelar antes das 07:30 trancaria dado velho para o pregão inteiro, porque o congelado nunca é refeito.
      throw new Error(
        `Cedo demais para congelar ${date}: o briefing é das ${CUTOFF_BRT} de Brasília`,
      );
    }
    const readyAt = until.getTime() + READ_GRACE_MS;
    if (now.getTime() < readyAt) await this.sleep(readyAt - now.getTime());

    const sessions = this.calendar.tradingDaysBefore(date, LIMITS.sessions);
    const last = sessions[sessions.length - 1]!;
    const week = isoWeek(date);
    const universe = await this.repo.universe(week);
    if (universe === null) {
      throw new Error(
        `Sem universo congelado para a semana ${week}: o briefing de ${date} não tem de onde sair`,
      );
    }

    // Notícias vistas em (corte do briefing anterior, corte deste]. Sem briefing anterior, vale o corte do pregão
    // anterior; uma lacuna longa não puxa mais que 7 dias.
    const previous = await this.repo.latestBefore(date);
    const startOfWindow = cutoffOf(previous ?? this.calendar.previousTradingDay(date));
    const oldest = new Date(until.getTime() - MAX_LOOKBACK_MS);
    const from = startOfWindow < oldest ? oldest : startOfWindow;

    const [bars, macro, news, seasons] = await Promise.all([
      this.repo.bars(
        [...universe.map((member) => member.ticker), REFERENCE_TICKER],
        sessions[0]!,
        last,
      ),
      this.repo.macro(last),
      this.repo.news(from, until),
      this.repo.runningSeasons(date),
    ]);
    const built = buildBriefing({
      date,
      sessions,
      week,
      universe,
      bars,
      macro,
      news,
      newsWindow: { from, until },
      // capital, duração, posições, custo e horários da temporada em curso (as da Temporada 1 se não há nenhuma)
      rules: rulesOfSeasons(seasons),
    });

    // O Blob primeiro, a linha depois: a linha só existe se o arquivo existe. O nome carrega o SHA-256, então uma
    // corrida entre duas montagens não deixa o hash de uma apontando para os bytes de outra.
    const uri = await this.archive.save(date, built.bytes, built.sha256);
    const saved = await this.repo.save({
      date,
      sha256: built.sha256,
      uri,
      bytes: built.bytes.length,
    });
    if (saved === 'exists') return { outcome: 'already_done' };

    this.logger.log({ date, sha256: built.sha256, ...built.stats }, 'briefing congelado');
    if (built.stats.bytes > WARN_BYTES) {
      this.logger.warn(
        { date, bytes: built.stats.bytes, newsItems: built.stats.newsItems },
        'briefing grande: pode apertar o contexto dos modelos',
      );
    }
    return { outcome: 'frozen', sha256: built.sha256, uri, stats: built.stats };
  }
}
