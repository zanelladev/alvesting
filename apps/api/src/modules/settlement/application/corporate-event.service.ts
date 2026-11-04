import { corporateEventBodySchema } from '@alvesting/contracts';
import type { IsoDate } from '../../market-data/domain/dates.js';
import { JobBusyError, type JobRunStore } from '../../messaging/infrastructure/job-run.store.js';
import { MissingCdiError } from '../domain/cdi.js';
import type { EventInput, SettlementRepository } from '../infrastructure/settlement.repository.js';
import { IncompleteDataError } from './settlement-plan.js';
import type { SettleHandler } from './settle.handler.js';

// O comando settle:event (plano 8 e 9; docs/JOBS.md) e a rota POST /admin/corporate-events (etapa 10, parte 2; docs/API.md, seção 8):
// registram um desdobramento, grupamento ou bonificação em ações e reliquidam as temporadas que já passaram da data ex. O comando (e o
// ensaio) liquida na hora, aqui mesmo; a rota enfileira a liquidação para o worker (a api não escreve nas tabelas de resultado). Proventos
// em dinheiro estão fora da v2.0. O corpo é o mesmo nos dois (`corporateEventBodySchema`, em packages/contracts).

export class CorporateEventInputError extends Error {
  constructor(problems: string[]) {
    super(`Evento corporativo inválido:\n  - ${problems.join('\n  - ')}`);
    this.name = 'CorporateEventInputError';
  }
}

// O evento ficou registrado, mas a reliquidação de alguma temporada falhou (dado incompleto, em geral): não é falha do servidor, e o
// admin repete depois de corrigir o dado. O comando mostra a `message` (tudo, para quem opera no terminal). A rota responde 409 com a
// `safe`: o dado que falta (erros de domínio da liquidação, de mensagem nossa) e, para qualquer outro erro, uma frase fixa, porque o texto
// de um erro do Prisma, do pg ou da rede pode trazer host, trecho de SQL ou texto do driver. A rota manda a `message` ao log, limpa.
export class SettlementFailedError extends Error {
  constructor(
    message: string,
    readonly safe: string,
  ) {
    super(message);
    this.name = 'SettlementFailedError';
  }
}

const isDomainError = (error: unknown): error is Error =>
  error instanceof IncompleteDataError ||
  error instanceof MissingCdiError ||
  error instanceof JobBusyError;

const KINDS = { split: 'SPLIT', 'reverse-split': 'REVERSE_SPLIT', bonus: 'BONUS' } as const;

function parse(raw: unknown): EventInput {
  // o terminal digita o ticker em minúsculas: o schema do contrato o põe em maiúsculas antes de conferir a forma
  const parsed = corporateEventBodySchema.safeParse(raw);
  if (!parsed.success) {
    throw new CorporateEventInputError(
      parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || '(entrada)'}: ${issue.message}`,
      ),
    );
  }
  const { ticker, exDate, kind, factor } = parsed.data;
  const [ratioFrom, ratioTo] = factor.split(':').map(Number) as [number, number];
  // A direção do fator é a do tipo: sem esta conferência, um desdobramento digitado ao contrário (2:1) viraria um grupamento e
  // cortaria o patrimônio de todo mundo pela metade, com cara de certo.
  const grows = kind !== 'reverse-split';
  if (grows ? ratioTo <= ratioFrom : ratioTo >= ratioFrom) {
    throw new CorporateEventInputError([
      `factor: desdobramento e bonificação aumentam as ações (de < para) e grupamento reduz (de > para); veio ${kind} ${factor}`,
    ]);
  }
  return { ticker, exDate, kind: KINDS[kind], ratioFrom, ratioTo };
}

export interface RegisterResult {
  event: EventInput & { change: 'created' | 'updated' | 'unchanged' };
  // as temporadas reliquidadas, até o último pregão que cada uma tinha liquidado
  settled: Array<{ season: string; through: IsoDate; finished: boolean }>;
  // as que liquidaram só até antes da data ex: o evento entra quando chegarem lá
  pending: string[];
}

export interface RecordedEvent {
  event: EventInput & { change: 'created' | 'updated' | 'unchanged' };
  // as temporadas que já liquidaram até a data ex ou além: o evento muda o resultado delas, que precisa ser liquidado de novo (até `through`)
  due: Array<{ seasonId: string; slug: string; through: IsoDate }>;
  // as que liquidaram só até antes da data ex: o evento entra quando chegarem lá
  pending: string[];
}

// O passo comum ao comando e à rota do admin: valida o corpo, confere que o ticker existe, registra o evento (ou corrige o fator do
// mesmo ticker, data ex e tipo, com a linha de auditoria na mesma transação) e separa as temporadas pelo que o evento pede delas. NÃO liquida
// nada: o comando liquida na hora (`CorporateEventService.register`), e a api, cujo papel do Postgres não escreve nas tabelas de resultado,
// enfileira (`SettlementPublisher.resettle`; ADR 0028). `actor` é quem pediu ('cli' no comando, 'admin:<ULID>' na rota).
export async function recordCorporateEvent(
  repo: Pick<SettlementRepository, 'instrumentExists' | 'upsertEvent' | 'settledThrough'>,
  raw: unknown,
  actor: string,
): Promise<RecordedEvent> {
  const input = parse(raw);
  if (!(await repo.instrumentExists(input.ticker))) {
    throw new CorporateEventInputError([
      `ticker: ${input.ticker} não está no banco; carregue os preços dele (market:backfill) antes de registrar o evento`,
    ]);
  }
  const { change } = await repo.upsertEvent(input, actor);
  const due: RecordedEvent['due'] = [];
  const pending: string[] = [];
  for (const season of await repo.settledThrough()) {
    if (season.through < input.exDate) pending.push(season.slug);
    else due.push(season);
  }
  return { event: { ...input, change }, due, pending };
}

export class CorporateEventService {
  constructor(
    private readonly deps: {
      repo: Pick<SettlementRepository, 'instrumentExists' | 'upsertEvent' | 'settledThrough'>;
      jobs: Pick<JobRunStore, 'reopen'>;
      settle: Pick<SettleHandler, 'execute'>;
    },
  ) {}

  // Registra o evento (ou corrige o fator do mesmo ticker, data ex e tipo) e reliquida, direto e sem a fila, cada temporada que
  // já liquidou até a data ex. Repetir o comando reliquida de novo: se a anterior falhou no meio, esta termina. Se a
  // reliquidação falha, o evento fica registrado (a próxima liquidação da temporada o aplica) e o erro diz onde. `actor` é quem
  // pediu ('cli' no comando; o ensaio passa o dele): vai para a trilha de auditoria do registro. A rota do admin NÃO usa este método:
  // ela só registra e enfileira (recordCorporateEvent).
  async register(raw: unknown, now: Date, actor: string): Promise<RegisterResult> {
    const { jobs, settle } = this.deps;
    const { event, due, pending } = await recordCorporateEvent(this.deps.repo, raw, actor);

    const settled: RegisterResult['settled'] = [];
    const failures: Array<{ season: string; error: unknown }> = [];
    for (const season of due) {
      const message = { type: 'settle', seasonId: season.seasonId, date: season.through } as const;
      try {
        await jobs.reopen(
          message,
          `evento corporativo ${event.ticker} (${event.exDate}): liquidar de novo`,
        );
        const outcome = await settle.execute(message, now);
        if (outcome.status === 'settled') {
          settled.push({
            season: season.slug,
            through: outcome.through,
            finished: outcome.finished,
          });
        }
      } catch (error) {
        failures.push({ season: season.slug, error });
      }
    }
    if (failures.length > 0) {
      const report = (cause: (error: unknown) => string) =>
        `O evento foi registrado, mas a reliquidação falhou em ${failures.length} temporada(s):\n  - ` +
        failures.map((f) => `${f.season}: ${cause(f.error)}`).join('\n  - ') +
        '\nCorrija o dado e rode o comando de novo (ou reenvie o settle da temporada).';
      throw new SettlementFailedError(
        report((error) => (error instanceof Error ? error.message : String(error))),
        report((error) =>
          isDomainError(error) ? error.message : 'erro inesperado (veja o log da api)',
        ),
      );
    }
    return { event, settled, pending };
  }
}
