'use client';

import {
  adminSend,
  describeAdminError,
  summarizeDlq,
  summarizeEvent,
  summarizeRerun,
} from '../lib/admin-client';
import { checked } from '../lib/account-validation';
import { formatDate } from '../lib/format';
import {
  AccountForm,
  CheckField,
  SelectField,
  TextAreaField,
  TextField,
  type Outcome,
} from './form-kit';

// Os formulários do painel de admin (etapa 10, parte 2; docs/TELAS.md, seção 8). Cada ação pede a confirmação explícita: uma caixa de
// marcar, nunca marcada, com a frase do que vai acontecer; sem ela nada é enviado. Reusam o molde dos formulários da conta (form-kit.tsx):
// o fieldset nasce desativado e só liga depois da hidratação (um <form> sem handler faria um GET), o erro vai ligado ao campo e o foco vai
// ao primeiro erro. O resultado (o que a api fez) fica na tela, sem navegar: a lista abaixo mostra o estado de antes até recarregar. Este
// módulo e o que ele importa vão ao navegador: nenhum valor do pacote de contratos (leva o zod), só tipos. A api valida tudo de novo.

const MISSING_CONFIRM = 'Marque a caixa para confirmar esta ação.';
const API = '/api/v1/admin';

const text = (data: FormData, name: string): string => {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
};

// O JSON de um campo de texto: um objeto, e nada além.
function parseObject(raw: string): { ok: true; value: Record<string, unknown> } | { ok: false } {
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? { ok: true, value: value as Record<string, unknown> }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}

// Reenviar UMA mensagem da DLQ para a fila de origem. Idempotente: se já saiu da DLQ, a api diz.
export function ResubmitDlqForm({
  queue,
  messageId,
  labelledBy,
}: {
  queue: string;
  messageId: string;
  labelledBy: string;
}) {
  async function run(data: FormData): Promise<Outcome | void> {
    if (!checked(data, 'confirm')) return { fields: { confirm: MISSING_CONFIRM } };
    const out = await adminSend(`${API}/dlq/${encodeURIComponent(queue)}/resubmit`, {
      method: 'POST',
      body: { messageIds: [messageId] },
    });
    return out.ok ? { status: summarizeDlq(out.data) } : { form: describeAdminError(out) };
  }
  return (
    <AccountForm submit="Reenviar para a fila" run={run} labelledBy={labelledBy} noscript={false}>
      <CheckField name="confirm">{`Confirmo: reenviar a mensagem ${messageId} para a fila ${queue}.`}</CheckField>
    </AccountForm>
  );
}

// Reprocessar o ciclo de um pregão: só publica a decisão de quem falta, até 5 minutos antes do prazo das 09:30 (a api impõe).
export function RerunCycleForm({
  defaultDate,
  labelledBy,
}: {
  defaultDate: string;
  labelledBy: string;
}) {
  async function run(data: FormData): Promise<Outcome | void> {
    const fields: Record<string, string> = {};
    const date = text(data, 'date');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) fields.date = 'Informe o pregão (dia, mês e ano).';
    if (!checked(data, 'confirm')) fields.confirm = MISSING_CONFIRM;
    if (Object.keys(fields).length > 0) return { fields };
    const out = await adminSend(`${API}/cycles/${date}/rerun`, { method: 'POST' });
    return out.ok ? { status: summarizeRerun(out.data) } : { form: describeAdminError(out) };
  }
  return (
    <AccountForm submit="Reprocessar o ciclo" run={run} labelledBy={labelledBy} noscript={false}>
      <TextField
        name="date"
        label="Pregão"
        type="date"
        autoComplete="off"
        defaultValue={defaultDate}
        hint="Publica a decisão de quem ainda não decidiu. Nunca nos últimos 5 minutos antes do prazo das 09:30 nem depois dele, e nunca muda uma decisão já gravada."
      />
      <CheckField name="confirm">
        Confirmo: reprocessar o ciclo deste pregão, publicando na fila o que falta.
      </CheckField>
    </AccountForm>
  );
}

const EVENT_KINDS = [
  ['split', 'Desdobramento (split)'],
  ['reverse-split', 'Grupamento (reverse-split)'],
  ['bonus', 'Bonificação em ações (bonus)'],
] as const;

// Registrar um desdobramento, grupamento ou bonificação em ações. Enfileira a reliquidação das temporadas que já passaram da data ex (o worker
// liquida, e então muda resultado publicado).
export function CorporateEventForm({ labelledBy }: { labelledBy: string }) {
  async function run(data: FormData): Promise<Outcome | void> {
    const fields: Record<string, string> = {};
    const ticker = text(data, 'ticker').trim();
    const exDate = text(data, 'exDate');
    const factor = text(data, 'factor').trim();
    if (ticker === '') fields.ticker = 'Informe o ticker (ex.: BBDC4).';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(exDate)) fields.exDate = 'Informe a data ex (dia, mês e ano).';
    if (!/^\d+:\d+$/.test(factor)) fields.factor = 'Informe o fator no formato de:para (ex.: 1:2).';
    if (!checked(data, 'confirm')) fields.confirm = MISSING_CONFIRM;
    if (Object.keys(fields).length > 0) return { fields };
    const out = await adminSend(`${API}/corporate-events`, {
      method: 'POST',
      body: { ticker, exDate, kind: text(data, 'kind'), factor },
    });
    return out.ok ? { status: summarizeEvent(out.data) } : { form: describeAdminError(out) };
  }
  return (
    <AccountForm submit="Registrar o evento" run={run} labelledBy={labelledBy} noscript={false}>
      <TextField
        name="ticker"
        label="Ticker"
        autoComplete="off"
        capitalize="characters"
        maxLength={12}
      />
      <TextField name="exDate" label="Data ex" type="date" autoComplete="off" />
      <SelectField name="kind" label="Tipo" options={EVENT_KINDS} />
      <TextField
        name="factor"
        label="Fator (de:para)"
        autoComplete="off"
        maxLength={13}
        hint="Cada 'de' ações antigas viram 'para' novas: desdobramento 1:2, grupamento 10:1, bonificação de 10% 10:11."
      />
      <CheckField name="confirm">
        Confirmo: registrar o evento e enfileirar a reliquidação das temporadas que já passaram da
        data ex. Quando o worker liquidar, isto muda resultados já publicados.
      </CheckField>
    </AccountForm>
  );
}

const SEASON_HINT =
  'O mesmo arquivo do comando season:create (nome, parâmetros e elenco), em JSON. Nunca ponha segredo aqui: o arquivo é recusado se tiver campo desconhecido.';

// Criar a temporada (rascunho) a partir do arquivo JSON.
export function CreateSeasonForm({ labelledBy }: { labelledBy: string }) {
  async function run(data: FormData): Promise<Outcome | void> {
    const fields: Record<string, string> = {};
    const file = parseObject(text(data, 'file'));
    if (!file.ok) fields.file = 'O texto não é um objeto JSON válido.';
    if (!checked(data, 'confirm')) fields.confirm = MISSING_CONFIRM;
    if (!file.ok || Object.keys(fields).length > 0) return { fields };
    const out = await adminSend(`${API}/seasons`, { method: 'POST', body: file.value });
    if (!out.ok) return { form: describeAdminError(out) };
    const slug = (out.data as { slug?: unknown } | undefined)?.slug;
    return {
      status: `Temporada ${typeof slug === 'string' ? slug : ''} criada como rascunho. Recarregue a página para vê-la na lista.`,
    };
  }
  return (
    <AccountForm submit="Criar a temporada" run={run} labelledBy={labelledBy} noscript={false}>
      <TextAreaField name="file" label="Arquivo da temporada (JSON)" hint={SEASON_HINT} rows={14} />
      <CheckField name="confirm">
        Confirmo: criar a temporada como rascunho. Ela só começa quando eu a iniciar.
      </CheckField>
    </AccountForm>
  );
}

// Editar o rascunho: nome, parâmetros e elenco. O que for enviado substitui o campo inteiro; o slug não muda.
export function EditSeasonForm({
  id,
  initialJson,
  labelledBy,
}: {
  id: string;
  initialJson: string;
  labelledBy: string;
}) {
  async function run(data: FormData): Promise<Outcome | void> {
    const fields: Record<string, string> = {};
    const file = parseObject(text(data, 'file'));
    if (!file.ok) fields.file = 'O texto não é um objeto JSON válido.';
    if (!checked(data, 'confirm')) fields.confirm = MISSING_CONFIRM;
    if (!file.ok || Object.keys(fields).length > 0) return { fields };
    const out = await adminSend(`${API}/seasons/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: file.value,
    });
    return out.ok
      ? { status: 'Rascunho salvo. Recarregue a página para ver a lista atualizada.' }
      : { form: describeAdminError(out) };
  }
  return (
    <AccountForm submit="Salvar o rascunho" run={run} labelledBy={labelledBy} noscript={false}>
      <TextAreaField
        name="file"
        label="Nome, parâmetros e elenco (JSON)"
        hint="Cada campo enviado substitui o atual por inteiro. O slug não muda."
        rows={14}
        defaultValue={initialJson}
      />
      <CheckField name="confirm">
        Confirmo: substituir o conteúdo do rascunho pelo texto acima.
      </CheckField>
    </AccountForm>
  );
}

// Iniciar a temporada (o season:start): DRAFT para RUNNING, com início no próximo pregão. Depois disso, regras, elenco e prompt ficam fixos.
export function StartSeasonForm({
  id,
  slug,
  labelledBy,
}: {
  id: string;
  slug: string;
  labelledBy: string;
}) {
  async function run(data: FormData): Promise<Outcome | void> {
    if (!checked(data, 'confirm')) return { fields: { confirm: MISSING_CONFIRM } };
    const out = await adminSend(`${API}/seasons/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: { status: 'RUNNING' },
    });
    if (!out.ok) return { form: describeAdminError(out) };
    const start = (out.data as { startDate?: unknown } | undefined)?.startDate;
    return {
      status: `Temporada em andamento.${typeof start === 'string' ? ` Primeiro pregão: ${formatDate(start)}.` : ''} Recarregue a página para ver a lista atualizada.`,
    };
  }
  return (
    <AccountForm submit="Iniciar a temporada" run={run} labelledBy={labelledBy} noscript={false}>
      <CheckField name="confirm">{`Confirmo: iniciar a temporada ${slug}. O início será o próximo pregão depois de hoje, e a partir daí regras, elenco e prompt ficam fixos.`}</CheckField>
    </AccountForm>
  );
}
