import { Logger } from '@nestjs/common';
import {
  parseLlmDecision,
  type HoldReason,
  type LlmUsage,
  type ParsedLlmDecision,
  type QueueMessage,
} from '@alvesting/contracts';
import type { Env } from '../../../config/env.js';
import { ALERT_LOG } from '../../../telemetry/alert-logs.js';
import { recordInvalid, recordLlmUsage } from '../../../telemetry/instruments.js';
import { LIMITS } from '../../briefing/domain/briefing.js';
import { sha256Hex } from '../../briefing/domain/canonical-json.js';
import {
  BriefingIntegrityError,
  type BriefingArchive,
} from '../../briefing/infrastructure/briefing.archive.js';
import type { BriefingRepository } from '../../briefing/infrastructure/briefing.repository.js';
import type { TradingCalendar } from '../../market-data/domain/trading-calendar.js';
import type { Delivery } from '../../messaging/application/handle-delivery.js';
import { JobBusyError, type JobRunStore } from '../../messaging/infrastructure/job-run.store.js';
import { MIN_CALL_MS, MIN_REPAIR_MS, callBudget } from '../domain/call-timeout.js';
import { buildDecisionItems } from '../domain/decision-items.js';
import { forcedHold, type DecisionRecord } from '../domain/decision-record.js';
import type { SemanticContext } from '../domain/decision-validation.js';
import { createLeakFilter, hasCanary, type LeakFilter } from '../domain/leak-filter.js';
import { readBriefing } from '../domain/briefing-view.js';
import { repairMessage, userMessage } from '../domain/llm-messages.js';
import { buildOwnPart } from '../domain/own-part.js';
import type {
  ArenaRepository,
  CompetitorRow,
  CycleRow,
} from '../infrastructure/arena.repository.js';
import {
  LlmCallError,
  LlmConfigError,
  buildRequestBody,
  type GatewayCompetitor,
  type LlmGateway,
  type LlmResult,
  type Turn,
} from '../infrastructure/llm-gateway.js';
import type { LlmIoArchive } from '../infrastructure/llm-io.archive.js';
import type { ReadPortfolio } from './portfolio.js';

type DecideMessage = Extract<QueueMessage, { type: 'decide' }>;

export type DecideOutcome = 'decided' | 'already_done' | 'already_decided' | `hold:${HoldReason}`;

export interface DecideDeps {
  jobs: Pick<JobRunStore, 'claim' | 'succeed' | 'fail'>;
  repo: Pick<
    ArenaRepository,
    | 'seasonById'
    | 'competitorById'
    | 'cycleById'
    | 'decisionExists'
    | 'registerPromptSha256'
    | 'saveDecision'
    | 'closeIfComplete'
  >;
  briefings: Pick<BriefingArchive, 'read'>;
  bars: Pick<BriefingRepository, 'bars'>;
  calendar: Pick<TradingCalendar, 'tradingDaysBefore'>;
  readPortfolio: ReadPortfolio;
  gateway: Pick<LlmGateway, 'call'>;
  io: Pick<LlmIoArchive, 'save'>;
  // O prompt e a versão do segredo, do ambiente do job (por referência ao Key Vault). Só este job os tem.
  env: Pick<Env, 'PROMPT_ARENA' | 'PROMPT_ARENA_VERSION'>;
  clock?: () => Date;
  // O relógio da MÁQUINA, para as horas do pedido e da resposta HTTP de cada chamada no meta do IO bruto. Em produção é o mesmo do `clock`;
  // no arena:retroativo o `clock` é o do pregão simulado, e estas horas são a prova de quando a chamada aconteceu de verdade (ADR 0038).
  wallClock?: () => Date;
  // abaixo disto não vale começar uma chamada, nem um reparo (os testes baixam para não esperar segundos nem minutos)
  minCallMs?: number;
  minRepairMs?: number;
}

const FIRST_DELIVERY: Delivery = { attempt: 1, lastAttempt: false };
// Erros que o código já escreve sem texto do provedor, da requisição nem do prompt: sobem como estão.
const OWN_ERRORS = [LlmCallError, LlmConfigError, BriefingIntegrityError, JobBusyError];
// No lugar do turno do assistente quando a primeira resposta veio vazia (o limite de saída consumido pelo raciocínio): alguns
// provedores recusam mensagem vazia.
const EMPTY_ANSWER = '(resposta sem texto)';

const sum = (calls: Call[], pick: (usage: LlmResult['usage']) => number): number =>
  calls.reduce((total, call) => total + pick(call.result.usage), 0);

interface Call {
  turns: Turn[];
  result: LlmResult;
  // as horas reais do pedido e da resposta HTTP (ISO, UTC), pelo relógio da máquina
  http: { requestedAt: string; respondedAt: string };
}

interface Run {
  // o filtro de vazamento da execução: nasce quando o prompt é lido, e então limpa até as mensagens de erro
  filter?: LeakFilter;
}

// O que se sabe depois de conferir o prompt e o briefing, e que os passos seguintes usam. Nada aqui é opcional.
interface Attempt {
  cycle: CycleRow;
  competitor: CompetitorRow;
  gatewayCompetitor: GatewayCompetitor;
  filter: LeakFilter;
  version: string;
  promptSha: string;
  briefingSha: string;
  // as chamadas ao modelo já feitas (a original e, se houve, o reparo)
  calls: Call[];
}

// O papel `decide` (plano 5.5 e 7): cada execução do job recebe UMA mensagem `decide {ciclo, competidor}`, decide e sai. Passos:
// job_run; ciclo e competidor; o prazo das 09:30; a igualdade do prompt (versão e SHA-256 contra os do ciclo); o briefing do Blob
// contra o SHA-256 da linha; a parte própria do competidor; o gateway; a validação (1 reparo, depois o domínio); o filtro de
// vazamento; o IO bruto no Blob e a decisão no banco. Cada falha vira HOLD registrado, nunca um ciclo travado (docs/ARENA.md).
export class DecideHandler {
  private readonly logger = new Logger(DecideHandler.name);
  private readonly clock: () => Date;
  private readonly wallClock: () => Date;
  private readonly minCallMs: number;
  private readonly minRepairMs: number;

  constructor(private readonly deps: DecideDeps) {
    this.clock = deps.clock ?? (() => new Date());
    this.wallClock = deps.wallClock ?? (() => new Date());
    this.minCallMs = deps.minCallMs ?? MIN_CALL_MS;
    this.minRepairMs = deps.minRepairMs ?? MIN_REPAIR_MS;
  }

  // A função da fila: o MessagingService passa a mensagem e a entrega (a tentativa e se é a última).
  readonly handle = async (
    message: QueueMessage,
    delivery: Delivery = FIRST_DELIVERY,
  ): Promise<void> => {
    if (message.type !== 'decide') {
      // handleDelivery já manda para a DLQ o que é de outra fila; isto é só a rede de segurança
      throw new Error(`A fila decisions não trata mensagens ${message.type}`);
    }
    await this.execute(message, delivery);
  };

  async execute(
    message: DecideMessage,
    delivery: Delivery = FIRST_DELIVERY,
    now: Date = this.clock(),
  ): Promise<DecideOutcome> {
    const claimed = await this.deps.jobs.claim(message, now);
    if (claimed.status === 'done') return 'already_done';
    if (claimed.status === 'busy') throw new JobBusyError(message);

    const run: Run = {};
    try {
      const outcome = await this.process(message, now, run);
      await this.deps.jobs.succeed(claimed.claim);
      return outcome;
    } catch (error) {
      const safe = this.scrub(error, run);
      // DLQ vira HOLD: na última entrega a mensagem iria para a DLQ, e a decisão ficaria sem registro. O handler grava o HOLD
      // "falha" e conclui a mensagem (o job_run guarda o erro). Se nem o HOLD dá para gravar, o erro sobe e a DLQ pega; a
      // varredura (CycleCloser) fecha o ciclo depois.
      // A exceção é o erro de configuração (chave ausente, recusada ou sem crédito; prompt ausente ou sem canário): não é uma
      // decisão do modelo, e o HOLD "falha" mancharia a temporada. A mensagem vai para a DLQ (o alerta enxerga) e o par fica sem
      // decisão: o arena:retroativo para no pregão e, corrigida a causa, decide o que falta; ao vivo, a varredura grava "sem_resposta".
      if (
        delivery.lastAttempt &&
        !(error instanceof LlmConfigError) &&
        (await this.holdAfterLastAttempt(message))
      ) {
        await this.deps.jobs.fail(claimed.claim, safe);
        return 'hold:falha';
      }
      await this.deps.jobs.fail(claimed.claim, safe);
      throw safe;
    }
  }

  private async process(message: DecideMessage, now: Date, run: Run): Promise<DecideOutcome> {
    const { repo } = this.deps;
    const cycle = await repo.cycleById(message.cycleId);
    if (!cycle) throw new Error('Ciclo inexistente');
    const competitor = await repo.competitorById(message.competitorId);
    if (
      !competitor ||
      competitor.kind !== 'MODEL' ||
      competitor.seasonId !== cycle.seasonId ||
      !competitor.provider ||
      !competitor.modelId
    ) {
      throw new Error('Competidor inválido para este ciclo');
    }
    // execução duplicada (a cópia agendada de uma que já terminou): a primeira decisão vale. Quem a gravou pode ter caído antes
    // de fechar o ciclo (são duas instruções, de propósito: closeIfComplete fecha quem commita por último), então a repetição
    // tenta fechar também; é um UPDATE condicional e idempotente.
    if (await repo.decisionExists(cycle.id, competitor.id)) {
      await repo.closeIfComplete(cycle.id, this.clock());
      return 'already_decided';
    }
    if (cycle.status !== 'OPEN')
      throw new Error(
        `Ciclo ${cycle.status === 'SKIPPED' ? 'pulado' : 'fechado'}: o modelo não é chamado`,
      );

    // 1. o prazo: depois das 09:30 não se chama o modelo
    if (now >= cycle.deadlineAt) return this.hold(cycle, competitor, 'prazo');

    // 2. a igualdade do prompt: a versão e o SHA-256 do texto têm de ser os fixados no ciclo
    const secret = this.deps.env.PROMPT_ARENA;
    const version = this.deps.env.PROMPT_ARENA_VERSION;
    if (!secret || !version) {
      throw new LlmConfigError(
        'PROMPT_ARENA e PROMPT_ARENA_VERSION são obrigatórias no job de decisões (docs/INFRA.md, 2.7)',
      );
    }
    const prompt = secret.reveal();
    // Sem a linha de canário o filtro perde o alarme mais forte, em silêncio (um texto de marcação como "TODO" rodaria). O
    // erro diz a regra, nunca o texto, e vem antes de registrar o SHA-256 e de chamar o modelo.
    if (!hasCanary(prompt)) {
      throw new LlmConfigError(
        'PROMPT_ARENA sem a linha de canário (alv-canary-<16 a 64 letras minúsculas ou dígitos>): o filtro de vazamento perderia o alarme mais forte (docs/ARENA.md, seção 6)',
      );
    }
    const filter = createLeakFilter(prompt);
    run.filter = filter;
    const promptSha = sha256Hex(Buffer.from(prompt, 'utf8'));
    const pinned = cycle.promptVersion;
    if (!pinned || pinned.version !== version) {
      this.logger.warn(
        { cycleId: cycle.id, cycleVersion: pinned?.version ?? null, envVersion: version },
        'a versão do prompt deste job não é a fixada no ciclo: HOLD, o modelo não é chamado',
      );
      return this.hold(cycle, competitor, 'prompt_divergente');
    }
    const registered = await repo.registerPromptSha256(pinned.id, promptSha, now);
    if (registered !== promptSha) {
      this.logger.warn(
        { cycleId: cycle.id, version },
        'o SHA-256 do prompt deste job não é o registrado para a versão: HOLD, o modelo não é chamado',
      );
      return this.hold(cycle, competitor, 'prompt_divergente');
    }

    // 3. o briefing do Blob contra o SHA-256 da linha de briefing: divergência é erro alto e o fluxo nunca segue
    if (!cycle.briefing) throw new Error('Ciclo sem briefing');
    const briefingSha = cycle.briefing.sha256;
    const briefingBytes = await this.deps.briefings.read(cycle.date, briefingSha);
    const briefing = readBriefing(briefingBytes);
    if (briefing.date !== cycle.date) {
      throw new BriefingIntegrityError(`O briefing lido não é o do pregão ${cycle.date}`);
    }

    // 4. a parte própria: caixa, posições e as barras de 30 pregões delas
    const season = await repo.seasonById(cycle.seasonId);
    if (!season) throw new Error('Temporada inexistente');
    const sessions = this.deps.calendar.tradingDaysBefore(cycle.date, LIMITS.sessions);
    const portfolio = await this.deps.readPortfolio({
      seasonId: season.id,
      competitorId: competitor.id,
      date: cycle.date,
      startDate: season.startDate,
      capitalCents: season.params.capitalCents,
    });
    const bars = await this.deps.bars.bars(
      portfolio.positions.map((position) => position.ticker),
      sessions[0]!,
      sessions[sessions.length - 1]!,
    );
    const own = buildOwnPart({ date: cycle.date, sessions, portfolio, bars });

    // 5. o modelo, com 1 reparo
    const attempt: Attempt = {
      cycle,
      competitor,
      gatewayCompetitor: {
        provider: competitor.provider,
        modelId: competitor.modelId,
        capabilities: competitor.capabilities,
        pricingUsdPerMTok: competitor.pricingUsdPerMTok,
      },
      filter,
      version,
      promptSha,
      briefingSha,
      calls: [],
    };
    const turns: Turn[] = [
      {
        role: 'user',
        content: userMessage([
          { name: 'BRIEFING', bytes: briefingBytes, sha256: briefingSha },
          { name: 'CARTEIRA', bytes: own.bytes, sha256: own.sha256 },
        ]),
      },
    ];
    // 'deadline': o tempo que resta é o do prazo e não dá (ou acabou durante a chamada); 'no_time': é o do job
    const consult = async (
      callTurns: Turn[],
      minMs: number,
    ): Promise<LlmResult | 'deadline' | 'no_time'> => {
      const budget = callBudget({
        now: this.clock(),
        jobStartedAt: now,
        deadlineAt: cycle.deadlineAt,
      });
      if (budget.ms < minMs) return budget.bound === 'deadline' ? 'deadline' : 'no_time';
      try {
        const requestedAt = this.wallClock().toISOString();
        const result = await this.deps.gateway.call({
          competitor: attempt.gatewayCompetitor,
          system: prompt,
          turns: callTurns,
          timeoutMs: budget.ms,
        });
        const http = { requestedAt, respondedAt: this.wallClock().toISOString() };
        attempt.calls.push({ turns: callTurns, result, http });
        return result;
      } catch (error) {
        // estourou o tempo: se o limite desta chamada era o prazo (o orçamento sabe), o motivo é o prazo, não uma falha do
        // provedor, mesmo que o timer tenha disparado um instante antes das 09:30 no relógio de parede. O relógio fica de reforço.
        if (
          error instanceof LlmCallError &&
          error.kind === 'timeout' &&
          (budget.bound === 'deadline' || this.clock() >= cycle.deadlineAt)
        ) {
          return 'deadline';
        }
        throw error;
      }
    };

    const first = await consult(turns, this.minCallMs);
    if (first === 'deadline') return this.hold(cycle, competitor, 'prazo');
    if (first === 'no_time') {
      throw new Error('Sem tempo no job para chamar o modelo (o replicaTimeout está perto)');
    }
    let parsed = parseLlmDecision(first.text, { applyOrderCap: false });
    if (!parsed.success) {
      // O reparo só começa com tempo para terminar: sem ele a primeira resposta, já paga, vira HOLD com o IO e o custo.
      const second = await consult(
        [
          ...turns,
          { role: 'assistant', content: first.text === '' ? EMPTY_ANSWER : first.text },
          { role: 'user', content: repairMessage(parsed) },
        ],
        Math.max(this.minCallMs, this.minRepairMs),
      );
      if (second === 'deadline') return this.holdWithCalls(attempt, 'prazo');
      if (second === 'no_time') return this.holdWithCalls(attempt, 'resposta_invalida');
      parsed = parseLlmDecision(second.text, { applyOrderCap: false });
      if (!parsed.success) return this.holdWithCalls(attempt, 'resposta_invalida');
    }

    // 6. o domínio, o filtro de vazamento e a gravação
    return this.decided(attempt, parsed.data, own.sha256, {
      universe: briefing.tickers,
      holdings: own.holdings,
      maxPositions: season.params.maxPositions,
      maxOrders: season.params.maxOrdersPerCycle,
    });
  }

  private async decided(
    attempt: Attempt,
    parsed: ParsedLlmDecision,
    ownSha: string,
    context: SemanticContext,
  ): Promise<DecideOutcome> {
    const { cycle, competitor } = attempt;
    const built = buildDecisionItems(parsed, context, attempt.filter);
    const io = await this.saveIo(attempt, {
      ownSha,
      outcome: 'DECIDED',
      extraMeta: { dropped: built.dropped, leakFields: built.leakFields },
    });
    this.warnLeak(attempt, built.leakFields, io.leakPaths);
    return this.commit(
      attempt,
      {
        cycleId: cycle.id,
        competitorId: competitor.id,
        status: 'DECIDED',
        holdReason: null,
        marketView: parsed.market_view,
        summary: built.summary,
        ...io.fields,
        leakFields: built.leakFields,
        items: built.items,
      },
      'decided',
      'DECIDED',
      built.dropped.length,
    );
  }

  // HOLD depois de gastar uma chamada (a resposta não serviu, ou o prazo chegou no reparo): guarda o IO bruto e o custo.
  private async holdWithCalls(attempt: Attempt, reason: HoldReason): Promise<DecideOutcome> {
    const io = await this.saveIo(attempt, {
      ownSha: null,
      outcome: reason,
      extraMeta: { dropped: [], leakFields: [] },
    });
    this.warnLeak(attempt, [], io.leakPaths);
    return this.commit(
      attempt,
      forcedHold(attempt.cycle.id, attempt.competitor.id, reason, io.fields),
      `hold:${reason}`,
      reason,
      0,
    );
  }

  // O IO bruto no Blob (requisição sem o prompt, resposta crua e metadados) e o que a decisão guarda dele. Tudo o que vai ao
  // Blob passa pelo filtro de vazamento antes: o worker-data lê este container (docs/INFRA.md, 3.2). O n-grama olha só o texto
  // que o modelo escreveu: o briefing e a carteira (turnos do usuário) são dado nosso e dividem vocabulário com o prompt (só o
  // canário os confere), e o JSON da resposta é lido como documento, para as chaves e os números do formato de saída que o
  // prompt descreve não marcarem toda resposta comum.
  private async saveIo(
    attempt: Attempt,
    input: { ownSha: string | null; outcome: string; extraMeta: Record<string, unknown> },
  ): Promise<{
    fields: Pick<
      DecisionRecord,
      | 'usage'
      | 'costMicroUsd'
      | 'applied'
      | 'inputSha256'
      | 'outputSha256'
      | 'metaSha256'
      | 'ioUris'
    >;
    leakPaths: { request: string[]; response: string[] };
  }> {
    const { cycle, competitor, calls, filter } = attempt;
    // no lugar do texto do prompt, a versão e o SHA-256
    const placeholder = `[prompt-arena versão ${attempt.version} sha256 ${attempt.promptSha}]`;
    const requestLeaks: string[] = [];
    const requestBodies = calls.map((call, c) =>
      buildRequestBody(
        attempt.gatewayCompetitor,
        placeholder,
        call.turns.map((turn, t) => {
          const redacted =
            turn.role === 'assistant'
              ? filter.redactModelOutput(turn.content)
              : filter.redactCanary(turn.content);
          // a mensagem 0 da requisição é a do sistema (o marcador); os turnos vêm depois
          if (redacted.leaked) requestLeaks.push(`calls.${c}.messages.${t + 1}.content`);
          return { ...turn, content: redacted.text };
        }),
      ),
    );
    const request = {
      format: 'alvesting-llm-request/1',
      cycleId: cycle.id,
      competitorId: competitor.id,
      prompt: { version: attempt.version, sha256: attempt.promptSha },
      calls: requestBodies,
    };
    const response = filter.redactDeep({
      format: 'alvesting-llm-response/1',
      calls: calls.map((call) => call.result.response),
    });

    const usage: LlmUsage = {
      calls: calls.length,
      promptTokens: sum(calls, (u) => u.promptTokens),
      completionTokens: sum(calls, (u) => u.completionTokens),
      reasoningTokens: sum(calls, (u) => u.reasoningTokens),
      totalTokens: sum(calls, (u) => u.totalTokens),
    };
    const costMicroUsd = calls.reduce((total, call) => total + call.result.costMicroUsd, 0n);
    const last = calls[calls.length - 1]!.result.applied;
    const applied = { ...last, calls: calls.length };

    const leakPaths = { request: requestLeaks, response: response.paths };
    const meta = {
      format: 'alvesting-llm-meta/1',
      date: cycle.date,
      competitor: {
        id: competitor.id,
        slug: competitor.slug,
        provider: competitor.provider,
        modelId: competitor.modelId,
      },
      prompt: { version: attempt.version, sha256: attempt.promptSha },
      briefingSha256: attempt.briefingSha,
      ownSha256: input.ownSha,
      outcome: input.outcome,
      usage,
      costMicroUsd: costMicroUsd.toString(),
      applied: calls.map((call) => call.result.applied),
      // as horas reais do pedido e da resposta HTTP de cada chamada (no retroativo, dias depois do pregão)
      http: calls.map((call) => call.http),
      ioLeakPaths: leakPaths,
      ...input.extraMeta,
    };
    const saved = await this.deps.io.save({
      date: cycle.date,
      cycleId: cycle.id,
      competitorId: competitor.id,
      request,
      response: response.value,
      meta,
    });
    return {
      fields: {
        usage,
        costMicroUsd,
        applied,
        inputSha256: saved.sha256.request,
        outputSha256: saved.sha256.response,
        metaSha256: saved.sha256.meta,
        ioUris: saved.uris,
      },
      leakPaths,
    };
  }

  // HOLD sem chamar o modelo (prazo, prompt divergente).
  private async hold(
    cycle: CycleRow,
    competitor: CompetitorRow,
    reason: HoldReason,
  ): Promise<DecideOutcome> {
    const saved = await this.write(forcedHold(cycle.id, competitor.id, reason), competitor);
    if (saved === 'exists') return this.lostRace(cycle, competitor, []);
    this.logger.warn(
      { cycleId: cycle.id, competitorId: competitor.id, reason },
      'decisão registrada como HOLD forçado, sem chamar o modelo',
    );
    return `hold:${reason}`;
  }

  // Grava a decisão desta execução. 'exists': outra execução gravou primeiro, e a primeira decisão vale.
  private async commit(
    attempt: Attempt,
    record: DecisionRecord,
    outcome: DecideOutcome,
    label: string,
    dropped: number,
  ): Promise<DecideOutcome> {
    const saved = await this.write(record, attempt.competitor, dropped);
    if (saved === 'exists') return this.lostRace(attempt.cycle, attempt.competitor, attempt.calls);
    this.logDecision(attempt.cycle, attempt.competitor, label, attempt.calls, dropped);
    return outcome;
  }

  // A decisão no banco e o fechamento do ciclo se todos os MODEL já decidiram. A telemetria só conta a decisão que valeu: a que perdeu
  // a corrida ('exists') não entra (o aviso de lostRace já diz o custo dela).
  private async write(
    record: DecisionRecord,
    competitor: CompetitorRow,
    dropped = 0,
  ): Promise<'created' | 'exists'> {
    const saved = await this.deps.repo.saveDecision(record);
    await this.deps.repo.closeIfComplete(record.cycleId, this.clock());
    if (saved === 'created') this.observe(record, competitor, dropped);
    return saved;
  }

  // As métricas próprias (llm.tokens, llm.cost_usd, decision.invalid; plano 5.9) e a linha do alerta de HOLD por falha ou resposta
  // inválida. Só o slug do competidor e o provedor como atributo: nunca um ULID por série.
  private observe(record: DecisionRecord, competitor: CompetitorRow, dropped: number): void {
    const who = { competitor: competitor.slug, provider: competitor.provider ?? 'desconhecido' };
    if (record.usage) {
      recordLlmUsage({
        ...who,
        promptTokens: record.usage.promptTokens,
        completionTokens: record.usage.completionTokens,
        costMicroUsd: record.costMicroUsd,
      });
    }
    if (record.holdReason) {
      recordInvalid({ reason: record.holdReason, ...who });
      if (record.holdReason === 'falha' || record.holdReason === 'resposta_invalida') {
        // O alerta soma estas linhas por pregão (HOLD_FORCED_MAX_PER_SESSION): o prazo e o prompt divergente não entram, a causa deles
        // é outra e já aparece no log de cada um.
        this.logger.warn(
          {
            cycleId: record.cycleId,
            competitorId: record.competitorId,
            reason: record.holdReason,
          },
          ALERT_LOG.holdForced,
        );
      }
    }
    if (dropped > 0) recordInvalid({ reason: 'item_descartado', ...who, count: dropped });
  }

  // Outra execução da mesma mensagem gravou a decisão antes (a trava da fila venceu com a dona ainda viva, o que a regra
  // lockRenewalMs > replicaTimeout impede em produção). A decisão desta não vale, e o custo das chamadas, já pago, não entra na
  // soma do teto do mês: o aviso diz quanto foi.
  private lostRace(cycle: CycleRow, competitor: CompetitorRow, calls: Call[]): DecideOutcome {
    this.logger.warn(
      {
        cycleId: cycle.id,
        competitorId: competitor.id,
        calls: calls.length,
        costMicroUsd: calls
          .reduce((total, call) => total + call.result.costMicroUsd, 0n)
          .toString(),
      },
      'outra execução gravou a decisão primeiro: a desta não vale, e o custo das chamadas pagas não entra no teto do mês',
    );
    return 'already_decided';
  }

  private async holdAfterLastAttempt(message: DecideMessage): Promise<boolean> {
    try {
      const cycle = await this.deps.repo.cycleById(message.cycleId);
      const competitor = await this.deps.repo.competitorById(message.competitorId);
      if (
        !cycle ||
        !competitor ||
        competitor.kind !== 'MODEL' ||
        competitor.seasonId !== cycle.seasonId
      ) {
        return false;
      }
      await this.write(forcedHold(cycle.id, competitor.id, 'falha'), competitor);
      this.logger.error(
        { cycleId: cycle.id, competitorId: competitor.id },
        'última entrega falhou: a decisão foi registrada como HOLD (falha) e a mensagem não vai para a DLQ',
      );
      return true;
    } catch (error) {
      this.logger.error(
        { err: error instanceof Error ? error.name : 'erro desconhecido' },
        'última entrega falhou e o HOLD também não pôde ser gravado: a mensagem vai para a DLQ',
      );
      return false;
    }
  }

  // Nenhum erro, log nem job_run leva o prompt: o erro de fora do nosso código passa pelo filtro de vazamento antes de
  // subir (mensagem e pilha), e sem a causa encadeada.
  private scrub(error: unknown, run: Run): Error {
    if (OWN_ERRORS.some((type) => error instanceof type)) return error as Error;
    if (!(error instanceof Error)) return new Error('Falha desconhecida na decisão');
    const clean = (text: string): string => (run.filter ? run.filter.redact(text).text : text);
    const copy = new Error(clean(error.message));
    copy.name = error.name;
    if (error.stack) copy.stack = clean(error.stack);
    return copy;
  }

  // O evento de segurança "o filtro agiu" fica em decision.leak_fields e no meta do Blob, e aqui no log para o alerta da
  // etapa 10 ter por onde pegar: só os NOMES dos campos e dos caminhos, nunca o texto.
  private warnLeak(
    attempt: Attempt,
    leakFields: string[],
    ioLeakPaths: { request: string[]; response: string[] },
  ): void {
    if (leakFields.length + ioLeakPaths.request.length + ioLeakPaths.response.length === 0) return;
    this.logger.warn(
      {
        cycleId: attempt.cycle.id,
        competitorId: attempt.competitor.id,
        leakFields,
        ioLeakPaths,
      },
      ALERT_LOG.leakFilter,
    );
  }

  private logDecision(
    cycle: CycleRow,
    competitor: CompetitorRow,
    outcome: string,
    calls: Call[],
    dropped: number,
  ): void {
    this.logger.log(
      {
        cycleId: cycle.id,
        competitorId: competitor.id,
        outcome,
        calls: calls.length,
        totalTokens: sum(calls, (u) => u.totalTokens),
        // bigint não vai ao Pino: o custo em micro-dólares como texto
        costMicroUsd: calls
          .reduce((total, call) => total + call.result.costMicroUsd, 0n)
          .toString(),
        dropped,
      },
      'decisão gravada',
    );
  }
}
