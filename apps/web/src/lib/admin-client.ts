import { formatDate } from './format';

// O que o navegador faz ao falar com as rotas /admin (etapa 10, parte 2; docs/TELAS.md, seção 8). Sempre na mesma origem: na Azure o
// Front Door manda `/api/*` para a api, e em dev o `rewrites` do next.config.ts faz o mesmo, então o cookie da sessão (HttpOnly, SameSite=Lax) e
// o `Origin` que a api confere nas mutações chegam sozinhos. Este módulo vai ao navegador: nada dele importa valor do pacote de contratos
// (o índice leva o zod junto; o conta-layout.spec.ts e o admin-layout.spec.ts conferem que o zod não vai para a tela), e a leitura do
// envelope é à mão. Os textos da tela, o que cada resposta quer dizer, são funções puras daqui.

export interface AdminReply {
  ok: boolean;
  // 0 = a requisição nem chegou (rede) ou o prazo estourou
  status: number;
  // o corpo de sucesso (o `data` do envelope)
  data?: unknown;
  // o erro do envelope: o código, a mensagem (em português, escrita por nós) e, no 400 de validação, o caminho e a regra de cada campo
  code?: string;
  message?: string;
  issues?: string[];
}

// Abaixo do limite de 60 s do Front Door à origem. Nenhuma ação do painel liquida na requisição (o evento corporativo só registra e enfileira),
// então 55 s é folga: a mais lenta é o reenvio da DLQ, que abre um receiver por id.
export const ADMIN_SEND_TIMEOUT_MS = 55_000;
const MAX_ISSUES = 8;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// "competitors: o elenco precisa de exatamente um Sorteio": o caminho e a regra, nunca o valor que veio na requisição.
function issuesOf(details: unknown): string[] | undefined {
  if (!Array.isArray(details)) return undefined;
  const lines = details.flatMap((issue: unknown) => {
    if (!isRecord(issue) || typeof issue.message !== 'string') return [];
    const path = Array.isArray(issue.path) ? issue.path.map(String).join('.') : '';
    return [path ? `${path}: ${issue.message}` : issue.message];
  });
  return lines.length > 0 ? lines.slice(0, MAX_ISSUES) : undefined;
}

export async function adminSend(
  path: string,
  options: { method: 'POST' | 'PATCH'; body?: unknown },
  doFetch: typeof fetch = fetch,
  timeoutMs = ADMIN_SEND_TIMEOUT_MS,
): Promise<AdminReply> {
  let response: Response;
  try {
    response = await doFetch(path, {
      signal: AbortSignal.timeout(timeoutMs),
      method: options.method,
      headers: {
        accept: 'application/json',
        ...(options.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
      // a api não redireciona resposta de POST nem de PATCH; um redirecionamento aqui seria um erro, não um caminho a seguir
      redirect: 'error',
    });
  } catch {
    return { ok: false, status: 0 };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // a borda caiu, ou a resposta é um HTML de erro: só o status importa
    return { ok: response.ok, status: response.status };
  }
  if (response.ok) {
    return { ok: true, status: response.status, data: isRecord(body) ? body.data : undefined };
  }
  const reply: AdminReply = { ok: false, status: response.status };
  const error = isRecord(body) ? body.error : undefined;
  if (isRecord(error)) {
    if (typeof error.code === 'string') reply.code = error.code;
    if (typeof error.message === 'string') reply.message = error.message;
    const issues = issuesOf(error.details);
    if (issues) reply.issues = issues;
  }
  return reply;
}

// Os códigos de erro de servidor cuja mensagem é nossa e diz o que fazer; o resto de um 5xx é genérico (a mensagem de um erro inesperado
// nunca chega à tela).
const SAFE_SERVER_CODES = new Set(['SERVICE_BUS_UNAVAILABLE', 'NOT_CONFIGURED', 'PUBLISH_FAILED']);

export function describeAdminError(reply: AdminReply): string {
  if (reply.status === 0) return 'Sem conexão com o servidor. Confira a internet e tente de novo.';
  if (reply.status === 401) return 'Sua sessão acabou. Entre de novo.';
  if (reply.status === 403) {
    return reply.code === 'CONSENT_REQUIRED'
      ? 'Os termos mudaram: aceite a versão nova na sua conta e tente de novo.'
      : 'Sem permissão para esta ação. Recarregue a página.';
  }
  if (reply.status >= 500 && !(reply.code && SAFE_SERVER_CODES.has(reply.code))) {
    return 'Erro do servidor. Tente de novo em alguns minutos.';
  }
  const message = reply.message ?? 'Não foi possível concluir. Confira os dados e tente de novo.';
  return reply.issues ? `${message}. ${reply.issues.join(' ')}` : message;
}

// --- o que cada resposta quer dizer, em frases ---------------------------------------------------------------------------------

const SKIP_REASONS: Record<string, string> = {
  orcamento: 'teto de custo do mês',
  sem_briefing: 'sem o briefing do pregão',
};

function rerunLine(item: Record<string, unknown>): string {
  const season = String(item.season);
  switch (item.result) {
    case 'published': {
      const n = Number(item.published);
      return `${season}: ${n} ${n === 1 ? 'decisão publicada' : 'decisões publicadas'} na fila.`;
    }
    // a janela do reprocesso fecha 5 minutos antes do prazo (RERUN_MARGIN_MS, apps/api/src/modules/arena/application/cycle-schedulers.ts)
    case 'past_deadline':
      return `${season}: fora da janela do reprocesso, que fecha 5 minutos antes do prazo das 09:30; nada foi publicado.`;
    case 'not_open_yet':
      return `${season}: ainda não é a hora da decisão (08:00); nada foi publicado.`;
    case 'already_closed':
      return `${season}: o ciclo já está fechado; nada a publicar.`;
    case 'no_pending':
      return `${season}: todo modelo já tem decisão gravada; nada a publicar.`;
    case 'skipped': {
      const reason = SKIP_REASONS[String(item.reason)] ?? String(item.reason);
      return `${season}: ciclo pulado (${reason}); nada foi publicado.`;
    }
    case 'not_started':
      return `${season}: a temporada ainda não começou neste pregão.`;
    case 'season_over':
      return `${season}: a temporada já passou do último pregão.`;
    default:
      return `${season}: ${String(item.result)}.`;
  }
}

export function summarizeRerun(data: unknown): string {
  if (!isRecord(data) || !Array.isArray(data.seasons)) return 'Ciclo reprocessado.';
  if (data.seasons.length === 0) return 'Nenhuma temporada em andamento neste pregão.';
  return data.seasons.filter(isRecord).map(rerunLine).join(' ');
}

export function summarizeDlq(data: unknown): string {
  const first =
    isRecord(data) && Array.isArray(data.results) ? data.results.find(isRecord) : undefined;
  switch (first?.result) {
    case 'resubmitted':
      return 'Mensagem reenviada para a fila. Recarregue a página para ver a lista atualizada.';
    case 'not_found':
      return 'A mensagem não está mais na DLQ (talvez já tenha sido reenviada). Nada foi publicado.';
    case 'invalid':
      return 'A mensagem continua inválida ou é de outra fila: ficou na DLQ.';
    default:
      return 'Pedido de reenvio concluído.';
  }
}

const CHANGES: Record<string, string> = {
  created: 'registrado',
  updated: 'fator corrigido',
  unchanged: 'já estava registrado',
};
const KINDS: Record<string, string> = {
  SPLIT: 'desdobramento',
  REVERSE_SPLIT: 'grupamento',
  BONUS: 'bonificação',
};

export function summarizeEvent(data: unknown): string {
  if (!isRecord(data) || !isRecord(data.event)) return 'Evento registrado.';
  const e = data.event;
  const exDate = typeof e.exDate === 'string' ? formatDate(e.exDate) : '?';
  const parts = [
    `${String(e.ticker)}: ${KINDS[String(e.kind)] ?? String(e.kind)} ${String(e.ratioFrom)}:${String(e.ratioTo)} com data ex ${exDate}, ${CHANGES[String(e.change)] ?? String(e.change)}.`,
  ];
  const queued = Array.isArray(data.queued) ? data.queued.filter(isRecord) : [];
  if (queued.length > 0) {
    parts.push(
      `Reliquidação enfileirada: ${queued.map((s) => `${String(s.season)} até ${typeof s.through === 'string' ? formatDate(s.through) : '?'}`).join('; ')}. O resultado publicado só muda quando o worker liquidar, em alguns minutos.`,
    );
  }
  const pending = Array.isArray(data.pending) ? data.pending.map(String) : [];
  if (pending.length > 0) {
    parts.push(`Entra quando a temporada chegar à data ex: ${pending.join(', ')}.`);
  }
  if (queued.length + pending.length === 0) {
    parts.push('Nenhuma temporada liquidada ainda: o evento vale na primeira liquidação.');
  }
  return parts.join(' ');
}
