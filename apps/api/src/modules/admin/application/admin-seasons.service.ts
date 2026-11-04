import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  adminSeasonSchema,
  adminSeasonsSchema,
  seasonFileSchema,
  type AdminSeason,
  type AdminSeasons,
  type SeasonFile,
  type SeasonPatchBody,
} from '@alvesting/contracts';
import { AUDIT_ACTIONS } from '../../../common/audit.js';
import { ValidationException } from '../../../common/zod-validation.pipe.js';
import {
  SeasonNotDraftError,
  SeasonNotFoundError,
  SeasonRunningExistsError,
  SeasonService,
} from '../../arena/application/season.service.js';
import {
  ArenaRepository,
  SeasonSlugTakenError,
  type SeasonDetail,
} from '../../arena/infrastructure/arena.repository.js';
import { ADMIN_CLOCK, type AdminClock } from '../admin.tokens.js';

const locked = () =>
  new ConflictException({
    code: 'SEASON_LOCKED',
    message:
      'A temporada já saiu do rascunho: regras, elenco e prompt ficam fixos em uma temporada em andamento ou encerrada.',
  });
const notFound = () => new NotFoundException('Temporada não encontrada');

export const toAdminSeason = (season: SeasonDetail): AdminSeason =>
  adminSeasonSchema.parse({
    id: season.id,
    slug: season.slug,
    name: season.name,
    status: season.status,
    startDate: season.startDate,
    createdAt: season.createdAt.toISOString(),
    startedAt: season.startedAt?.toISOString() ?? null,
    finishedAt: season.finishedAt?.toISOString() ?? null,
    params: season.params,
    competitors: season.competitors,
  });

// As temporadas do admin (POST, PATCH e GET /admin/seasons; docs/API.md, seção 8). Criar e iniciar são o que o season:create e o
// season:start fazem (SeasonService), com a linha de auditoria na mesma transação da mudança. Editar é só do rascunho: uma temporada em
// andamento ou encerrada não muda nada, e o UPDATE condicional do repositório é a barreira de verdade (esta conferência só poupa a ida).
@Injectable()
export class AdminSeasonsService {
  constructor(
    private readonly repo: ArenaRepository,
    private readonly seasons: SeasonService,
    @Inject(ADMIN_CLOCK) private readonly clock: AdminClock,
  ) {}

  async list(): Promise<AdminSeasons> {
    return adminSeasonsSchema.parse({
      seasons: (await this.repo.listSeasons()).map(toAdminSeason),
    });
  }

  async create(file: SeasonFile, actor: string): Promise<AdminSeason> {
    const models = file.competitors.filter((competitor) => competitor.kind === 'MODEL').length;
    try {
      const { id } = await this.seasons.create(file, {
        actor,
        action: AUDIT_ACTIONS.seasonCreate,
        detail: { slug: file.slug, models },
      });
      return await this.get(id);
    } catch (error) {
      if (error instanceof SeasonSlugTakenError) {
        throw new ConflictException({ code: 'SEASON_SLUG_TAKEN', message: error.message });
      }
      throw error;
    }
  }

  async update(id: string, body: SeasonPatchBody, actor: string): Promise<AdminSeason> {
    const current = await this.repo.seasonDetail(id);
    if (!current) throw notFound();
    if (current.status !== 'DRAFT') throw locked();
    if ('status' in body) return this.start(current, actor);

    // O que foi enviado substitui o campo inteiro; o conjunto (um Sorteio, as três referências...) só vale depois de juntar com o resto.
    const merged = seasonFileSchema.safeParse({
      slug: current.slug,
      name: body.name ?? current.name,
      params: body.params ?? current.params,
      competitors: body.competitors ?? current.competitors,
    });
    if (!merged.success) throw new ValidationException(merged.error.issues);
    const fields = (['name', 'params', 'competitors'] as const).filter(
      (field) => body[field] !== undefined,
    );
    const outcome = await this.repo.replaceDraft(id, merged.data, {
      actor,
      action: AUDIT_ACTIONS.seasonUpdate,
      detail: { slug: current.slug, fields },
    });
    if (outcome === 'not_found') throw notFound();
    if (outcome === 'not_draft') throw locked();
    return this.get(id);
  }

  // O season:start. Duas temporadas em andamento ao mesmo tempo com regras diferentes fazem o `freeze` falhar todo dia (o briefing é um
  // por pregão, docs/ARENA.md, seção 10), então não se inicia uma enquanto outra está em andamento. O comando não confere isso. A
  // conferência é do repositório (`exclusive`), dentro da transação do início e sob trava: lê-la aqui, antes, deixava dois inícios
  // juntos passarem os dois.
  private async start(current: SeasonDetail, actor: string): Promise<AdminSeason> {
    try {
      await this.seasons.start(
        current.id,
        this.clock(),
        { actor, action: AUDIT_ACTIONS.seasonStart, detail: { slug: current.slug } },
        { exclusive: true },
      );
    } catch (error) {
      if (error instanceof SeasonNotDraftError) throw locked();
      if (error instanceof SeasonNotFoundError) throw notFound();
      if (error instanceof SeasonRunningExistsError) throw await this.runningExists(current.id);
      throw error;
    }
    return this.get(current.id);
  }

  // O slug da que está em andamento só entra na mensagem (lido depois da recusa: se ela acabou de encerrar, a mensagem sai sem ele).
  private async runningExists(except: string): Promise<ConflictException> {
    const running = (await this.repo.runningSeasons()).find((season) => season.id !== except);
    return new ConflictException({
      code: 'SEASON_RUNNING_EXISTS',
      message: `Já há uma temporada em andamento${running ? ` (${running.slug})` : ''}. O briefing é um por pregão, e duas temporadas em andamento com regras diferentes o impedem: espere a atual encerrar.`,
    });
  }

  private async get(id: string): Promise<AdminSeason> {
    const season = await this.repo.seasonDetail(id);
    if (!season) throw notFound();
    return toAdminSeason(season);
  }
}
