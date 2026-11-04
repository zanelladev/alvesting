import { Logger } from '@nestjs/common';
import { ALERT_LOG } from '../../../telemetry/alert-logs.js';
import type { BarRequest } from '../domain/bar-plan.js';
import type { BrapiClient, BrapiRun, PaperResult } from '../infrastructure/brapi.client.js';
import type { BarDivergence, MarketRepository } from '../infrastructure/market.repository.js';

export interface LoadReport extends BrapiRun {
  asked: number;
  // papéis sem resposta que sirva: viram falta, e a próxima passada os pede de novo
  failed: string[];
  inserted: number;
  divergent: BarDivergence[];
  // papéis que a brapi respondeu e que não têm linha em instrument: a barra foi descartada
  unknown: string[];
}

export interface LoadOptions {
  // encerra a passada depois de gravar este papel (a sonda do eod)
  stopAfter?: (result: PaperResult) => boolean;
  budgetMs?: number;
}

// Pede à brapi, um papel por vez, as barras que o banco não tem e grava cada papel assim que ele chega: o que já veio não se perde se um 401
// ou o fim do orçamento interromper a passada, e a nova tentativa pede só a falta. É o caminho comum do eod, da atualização semanal e da
// carga inicial. A barra que o banco já tem nunca muda; se chegou com valor diferente, o sinal barras-divergentes sai no log (papel, data e
// campos, os 20 primeiros). O papel sem linha em instrument (o BOVA11 antes da carga inicial, por exemplo) tem a barra descartada: sem o aviso
// o eod gastaria uma requisição por noite com ele sem ninguém ver o motivo.
export class BarLoader {
  private readonly logger = new Logger(BarLoader.name);

  constructor(
    private readonly brapi: Pick<BrapiClient, 'fetchBars'>,
    private readonly market: Pick<MarketRepository, 'insertBars'>,
  ) {}

  async load(requests: readonly BarRequest[], options: LoadOptions = {}): Promise<LoadReport> {
    const report: LoadReport = {
      requests: 0,
      remaining: null,
      stopped: null,
      asked: requests.length,
      failed: [],
      inserted: 0,
      divergent: [],
      unknown: [],
    };
    try {
      const run = await this.brapi.fetchBars(
        requests,
        async (result) => {
          if (result.status === 'failed') {
            report.failed.push(result.ticker);
            return;
          }
          const saved = await this.market.insertBars(result.bars);
          report.inserted += saved.inserted;
          report.divergent.push(...saved.divergent);
          report.unknown.push(...saved.unknown);
          return options.stopAfter?.(result) ? 'stop' : undefined;
        },
        options.budgetMs,
      );
      Object.assign(report, run);
    } finally {
      // também quando a passada acaba em erro de configuração: o que já foi visto não some
      if (report.divergent.length > 0) {
        this.logger.warn(
          { count: report.divergent.length, first: report.divergent.slice(0, 20) },
          ALERT_LOG.barsDiverged,
        );
      }
      if (report.unknown.length > 0) {
        this.logger.warn(
          { count: report.unknown.length, first: report.unknown.slice(0, 20) },
          'brapi: barras de papel sem linha em instrument foram descartadas (a carga inicial semeia o BOVA11)',
        );
      }
    }
    return report;
  }
}
