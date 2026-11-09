import { seasonFileSchema } from '@alvesting/contracts';
import type { AuditEntry } from '../../../common/audit.js';
import { brasiliaDate, type IsoDate } from '../../market-data/domain/dates.js';
import type { TradingCalendar } from '../../market-data/domain/trading-calendar.js';
import type { ArenaRepository } from '../infrastructure/arena.repository.js';

// O arquivo da temporada não passou na validação. A mensagem lista o caminho e a regra de cada campo, nunca o valor: um segredo
// posto no arquivo por engano não pode ir parar no terminal nem no log.
export class SeasonFileError extends Error {
  constructor(problems: string[]) {
    super(`Arquivo da temporada inválido:\n  - ${problems.join('\n  - ')}`);
    this.name = 'SeasonFileError';
  }
}

// A temporada não existe, já saiu do rascunho, ou outra está em andamento: as rotas /admin respondem 404 e 409 por estes tipos, sem
// comparar texto.
export class SeasonNotFoundError extends Error {
  constructor(id: string) {
    super(`A temporada ${id} não existe`);
    this.name = 'SeasonNotFoundError';
  }
}
export class SeasonNotDraftError extends Error {
  constructor() {
    super('A temporada já foi iniciada: só o rascunho (DRAFT) pode começar');
    this.name = 'SeasonNotDraftError';
  }
}
export class SeasonRunningExistsError extends Error {
  constructor() {
    super('Já há outra temporada em andamento');
    this.name = 'SeasonRunningExistsError';
  }
}

// Os comandos season:create e season:start (docs/ARENA.md) e as rotas POST e PATCH /admin/seasons (docs/API.md, seção 8), que passam
// o `audit` para a linha de audit_log entrar na mesma transação da mudança. O comando não passa.
export class SeasonService {
  constructor(
    private readonly repo: Pick<ArenaRepository, 'createSeason' | 'startSeason' | 'seasonById'>,
    private readonly calendar: Pick<TradingCalendar, 'nextTradingDay' | 'isTradingDay'>,
  ) {}

  // Cria a temporada (DRAFT) com o elenco, validando tudo. Os padrões do plano (2) entram onde o arquivo não diz.
  async create(
    raw: unknown,
    audit?: AuditEntry,
  ): Promise<{ id: string; slug: string; models: number }> {
    // O arquivo com a data fixa do primeiro pregão (a Temporada 1, temporada-1.json) não é do season:create: quem o cria e o inicia na data
    // dele é o arena:retroativo (ADR 0038). Dizer isso é melhor que o "chave desconhecida" do schema estrito.
    if (typeof raw === 'object' && raw !== null && Object.hasOwn(raw, 'startDate')) {
      throw new SeasonFileError([
        'startDate: este arquivo começa numa data fixa; crie e inicie a temporada pelo arena:retroativo (docs/ARENA.md, seção 1)',
      ]);
    }
    const parsed = seasonFileSchema.safeParse(raw);
    if (!parsed.success) {
      throw new SeasonFileError(
        parsed.error.issues.map(
          (issue) => `${issue.path.join('.') || '(arquivo)'}: ${issue.message}`,
        ),
      );
    }
    const file = parsed.data;
    const id = await this.repo.createSeason(file, audit);
    return {
      id,
      slug: file.slug,
      models: file.competitors.filter((c) => c.kind === 'MODEL').length,
    };
  }

  // DRAFT -> RUNNING, com a data de início no próximo pregão depois de hoje (de Brasília). Hoje nunca é o início: o briefing
  // das 07:30 e o ciclo das 08:00 de hoje podem já ter passado ou estar para passar sem a temporada. `options.exclusive` (as rotas
  // /admin) recusa o início se outra temporada está em andamento, atomicamente (ArenaRepository.startSeason); o comando não passa.
  // `options.startDate` e `options.promptSha256` são só do arena:retroativo (ADR 0038): a Temporada 1 começa na data do arquivo, que já
  // passou, e fixa o SHA-256 do prompt com que começou. A data tem de ser pregão.
  async start(
    id: string,
    now: Date,
    audit?: AuditEntry,
    options?: { exclusive?: boolean; startDate?: IsoDate; promptSha256?: string },
  ): Promise<{ id: string; slug: string; startDate: IsoDate }> {
    const { startDate: fixed, ...rest } = options ?? {};
    if (fixed !== undefined && !this.calendar.isTradingDay(fixed)) {
      throw new SeasonFileError([`startDate: ${fixed} não é pregão da B3`]);
    }
    const startDate = fixed ?? this.calendar.nextTradingDay(brasiliaDate(now));
    const result = await this.repo.startSeason(id, startDate, now, audit, options && rest);
    if (result === 'not_found') throw new SeasonNotFoundError(id);
    if (result === 'not_draft') throw new SeasonNotDraftError();
    if (result === 'running_exists') throw new SeasonRunningExistsError();
    const season = await this.repo.seasonById(id);
    return { id, slug: season?.slug ?? id, startDate };
  }
}
