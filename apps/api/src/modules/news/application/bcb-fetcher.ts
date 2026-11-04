import { Logger } from '@nestjs/common';
import { brasiliaDate, type IsoDate } from '../../market-data/domain/dates.js';
import {
  BCB_HOST,
  MACRO_SERIES,
  isNoValuesResponse,
  missingWindow,
  parseSgs,
  sgsUrl,
  type MacroSeries,
} from '../domain/bcb.js';
import type { MacroRepository } from '../infrastructure/macro.repository.js';
import { fetchLimited } from '../infrastructure/source-http.js';

// Uma série tem no máximo uns 400 pontos por busca; 1 MB sobra.
const MAX_BYTES = 1024 * 1024;

// A fonte `bcb-sgs` (docs/DADOS.md, seção 15): CDI, meta Selic, IPCA e dólar PTAX do SGS, em macro_daily. Busca só o
// que falta (do dia seguinte ao último valor guardado até hoje), então a cada 30 minutos o normal é pedir pouco ou
// nada. Uma série que falha não impede as outras de gravar; a busca falha no fim, e a fila repete.
export class BcbFetcher {
  private readonly logger = new Logger(BcbFetcher.name);

  constructor(
    private readonly macro: Pick<MacroRepository, 'lastDates' | 'savePoints'>,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  // Devolve, por série, quantas linhas foram criadas ou alteradas (só das que foram pedidas).
  async run(now: Date): Promise<Record<string, number>> {
    const today = brasiliaDate(now);
    const last = await this.macro.lastDates();
    const written: Record<string, number> = {};
    const failed: string[] = [];
    for (const series of MACRO_SERIES) {
      const window = missingWindow(last.get(series.id) ?? null, today);
      if (!window) continue;
      try {
        written[series.id] = await this.macro.savePoints(
          series.id,
          await this.points(series, window.from, window.to),
        );
      } catch (error) {
        // a mensagem do erro não tem corpo de resposta (source-http e parseSgs só dizem o que falhou)
        this.logger.warn({ series: series.id, err: error }, 'série do BCB não buscada');
        failed.push(series.id);
      }
    }
    if (failed.length > 0) {
      throw new Error(`BCB: ${failed.length} série(s) falharam: ${failed.join(', ')}`);
    }
    this.logger.log({ written }, 'macro do BCB buscada');
    return written;
  }

  private async points(series: MacroSeries, from: IsoDate, to: IsoDate) {
    const outcome = await fetchLimited(sgsUrl(series, from, to), {
      allowedHosts: [BCB_HOST],
      maxBytes: MAX_BYTES,
      accept: 'application/json',
      fetchFn: this.fetchFn,
    });
    if (outcome.status === 'not_found' && isNoValuesResponse(outcome.body)) return []; // janela sem valor novo
    if (outcome.status !== 'ok') {
      throw new Error(
        `SGS ${series.code}: ${outcome.status === 'not_found' ? '404' : '304 sem pedido condicional'}`,
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(outcome.body.toString('utf8'));
    } catch {
      // sem a mensagem do JSON.parse, que cita pedaço do corpo
      throw new Error(`SGS ${series.code}: a resposta não é JSON`);
    }
    return parseSgs(series, body, { from, to });
  }
}
