'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react';
import { BUTTON, CAIXA, CAIXA_ERRO, INPUT } from './ui';

// As peças dos formulários da conta (etapa 11, parte 2): campo com rótulo, erro ligado ao campo por aria-describedby, foco no primeiro
// erro, aviso de status e o botão. Os campos são não controlados (o valor mora no DOM), o envio lê o FormData, e quem manda é a api: a
// conferência daqui só poupa a ida. O sistema visual ascii-ui (src/app/globals.css; ADR 0034).
//
// Sem JavaScript o formulário não pode se enviar: um <form> sem handler faria um GET com a senha na URL (histórico, log da borda). Por isso o
// <fieldset> nasce desativado e só é ativado depois da hidratação (os campos e o botão ficam inertes), e o <noscript> diz por quê.
//
// O erro de um campo some assim que a pessoa mexe nele (senão o leitor de tela seguiria anunciando "inválido" para um campo já corrigido, e
// a frase velha contradiria o que ela acabou de fazer); volta no próximo envio, se o valor ainda não servir.

export interface Outcome {
  // erros por campo (a chave é o `name` do campo): o foco vai ao primeiro
  fields?: Record<string, string>;
  // erro que não é de um campo só: o aviso no topo do formulário, com o foco nele
  form?: ReactNode;
  // mensagem de sucesso que mantém a pessoa na tela (o link foi enviado): o foco vai a ela, que também rola a tela até ela no celular
  status?: string;
}

const noop = () => () => undefined;
// false no servidor e na hidratação, true depois: o JavaScript chegou. Os botões de editar e apagar da carteira esperam por ele, como o
// formulário (um botão sem handler não faz nada, e a pessoa não saberia por quê).
export const useHydrated = () =>
  useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );

interface FieldErrors {
  errors: Record<string, string>;
  // tira o erro de um campo (a pessoa mexeu nele)
  clear: (name: string) => void;
}
const Errors = createContext<FieldErrors>({ errors: {}, clear: () => undefined });

export function AccountForm({
  submit,
  run,
  children,
  actions,
  labelledBy,
  noscript = true,
  primary = false,
}: {
  submit: string;
  // `via` é o `value` do botão que enviou (o do Google), ou null para o botão principal. Devolve o resultado de uma falha ou de um aviso;
  // sem retorno, a tela está saindo (a navegação já começou) e o formulário continua desativado.
  run: (data: FormData, via: string | null) => Promise<Outcome | void>;
  children?: ReactNode;
  actions?: ReactNode;
  labelledBy?: string;
  noscript?: boolean;
  // o envio é a ação principal da superfície: a pílula branca (uma por superfície). Sair, excluir a conta e as ações do painel ficam no
  // botão escuro
  primary?: boolean;
}) {
  const hydrated = useHydrated();
  const form = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<ReactNode>(null);
  const [status, setStatus] = useState('');
  // sobe a cada envio que termina com erro ou aviso: o foco vai ao primeiro erro (ou ao aviso) mesmo quando é o mesmo de antes
  const [attempt, setAttempt] = useState(0);

  const clear = useCallback(
    (name: string) =>
      setErrors((current) =>
        name in current
          ? Object.fromEntries(Object.entries(current).filter(([key]) => key !== name))
          : current,
      ),
    [],
  );

  useEffect(() => {
    if (attempt === 0) return;
    // o erro do aviso no topo, o do primeiro campo inválido ou, num envio que deu certo, o aviso de status (nessa ordem no documento)
    form.current
      ?.querySelector<HTMLElement>('[data-form-error], [aria-invalid="true"], [data-form-status]')
      ?.focus();
  }, [attempt]);

  // O botão "voltar" pode devolver a página do cache de ida e volta do navegador (bfcache) no estado em que ela saiu: o formulário
  // desativado, com "Enviando…" e a senha que a pessoa digitou. Ao voltar assim, destrava e limpa os campos.
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      form.current?.reset();
      setBusy(false);
    };
    window.addEventListener('pageshow', restored);
    return () => window.removeEventListener('pageshow', restored);
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    setBusy(true);
    let outcome: Outcome | void;
    try {
      outcome = await run(data, submitter?.getAttribute('value') ?? null);
    } catch {
      outcome = { form: 'Não foi possível concluir agora. Tente de novo em alguns minutos.' };
    }
    if (!outcome) return; // saindo da tela: o formulário fica desativado até a navegação terminar
    setErrors(outcome.fields ?? {});
    setFormError(outcome.form ?? null);
    setStatus(outcome.status ?? '');
    setBusy(false);
    if (outcome.fields || outcome.form || outcome.status) setAttempt((n) => n + 1);
  }

  return (
    <form
      ref={form}
      method="post"
      noValidate
      onSubmit={(event) => void onSubmit(event)}
      aria-labelledby={labelledBy}
      aria-busy={busy}
      // flex com vão, e não space-y: a região de status vazia (sr-only, fora do fluxo) não deixa uma margem sobrando abaixo do botão
      className="flex max-w-md flex-col gap-3"
    >
      {noscript ? (
        <noscript>
          <p className={CAIXA}>
            Esta tela precisa de JavaScript para enviar o formulário. Ative o JavaScript no
            navegador e recarregue a página.
          </p>
        </noscript>
      ) : null}
      {formError ? (
        <p role="alert" tabIndex={-1} data-form-error="" className={CAIXA_ERRO}>
          {formError}
        </p>
      ) : null}
      <fieldset disabled={!hydrated || busy} className="min-w-0 space-y-4">
        <Errors.Provider value={{ errors, clear }}>{children}</Errors.Provider>
        <div className="flex flex-wrap gap-3">
          <button type="submit" className={primary ? `${BUTTON} btn-primary` : BUTTON}>
            {busy ? (
              <>
                <DotSpinner />
                Enviando…
              </>
            ) : (
              submit
            )}
          </button>
          {actions}
        </div>
      </fieldset>
      {/* a região existe desde o começo, para o leitor de tela anunciar o aviso que chega depois; com texto, o foco vai a ela */}
      <p
        role="status"
        tabIndex={status ? -1 : undefined}
        data-form-status={status ? '' : undefined}
        className={status ? `max-w-prose ${CAIXA}` : 'sr-only'}
      >
        {status}
      </p>
    </form>
  );
}

// Campo de texto com rótulo. A dica e o erro ficam ligados ao campo por aria-describedby; o erro marca o campo como inválido.
// `defaultValue`, `capitalize` e `maxLength` e o tipo `date` são do painel de admin (etapa 10, parte 2): a conta não os usa. `inputMode` (o teclado
// do celular: números para a quantidade, números com vírgula para o valor) e `max` (o último dia que o seletor de data deixa escolher) são da
// carteira (etapa 12, parte 2); `max` é só dica do seletor, a api é quem confere a data. Em caixa alta (`capitalize`) o texto também SAI em caixa
// alta na tela, e não só no teclado do celular: o ticker aparece como o código que ele é.
export function TextField({
  name,
  label,
  type = 'text',
  autoComplete,
  hint,
  defaultValue,
  capitalize,
  maxLength,
  inputMode,
  max,
}: {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'password' | 'date';
  autoComplete: string;
  hint?: string;
  defaultValue?: string;
  capitalize?: 'characters';
  maxLength?: number;
  inputMode?: 'numeric' | 'decimal';
  max?: string;
}) {
  const id = useId();
  const { errors, clear } = useContext(Errors);
  const error = errors[name];
  const hintId = `${id}-dica`;
  const errorId = `${id}-erro`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-display text-sm font-medium text-ink">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="muted">
          {hint}
        </p>
      ) : null}
      <input
        id={id}
        name={name}
        type={type}
        autoComplete={autoComplete}
        defaultValue={defaultValue}
        maxLength={maxLength}
        inputMode={inputMode}
        max={max}
        // e-mail, senha e o resto vão em minúsculas como o teclado do celular os digitou; só o nome ganha a inicial maiúscula
        autoCapitalize={capitalize ?? (autoComplete === 'name' ? 'words' : 'none')}
        autoCorrect="off"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        onChange={() => clear(name)}
        className={`${INPUT} w-full${capitalize ? ' uppercase' : ''}`}
      />
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}

// Área de texto com rótulo (o JSON da temporada no painel de admin). Mesma ligação de dica e erro do TextField. O texto é mono, sem
// correção automática nem capitalização: é JSON. Os 16 px do campo ficam (o Safari do iPhone dá zoom abaixo disso).
export function TextAreaField({
  name,
  label,
  hint,
  rows = 12,
  defaultValue,
}: {
  name: string;
  label: string;
  hint?: string;
  rows?: number;
  defaultValue?: string;
}) {
  const id = useId();
  const { errors, clear } = useContext(Errors);
  const error = errors[name];
  const hintId = `${id}-dica`;
  const errorId = `${id}-erro`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-display text-sm font-medium text-ink">
        {label}
      </label>
      {hint ? (
        <p id={hintId} className="muted">
          {hint}
        </p>
      ) : null}
      <textarea
        id={id}
        name={name}
        rows={rows}
        defaultValue={defaultValue}
        autoCapitalize="none"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        onChange={() => clear(name)}
        className={`${INPUT} w-full py-2 font-mono`}
      />
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}

// Lista de escolha com rótulo (o tipo do evento corporativo). A primeira opção vale se a pessoa não mexer.
export function SelectField({
  name,
  label,
  options,
}: {
  name: string;
  label: string;
  options: ReadonlyArray<readonly [value: string, label: string]>;
}) {
  const id = useId();
  const { errors, clear } = useContext(Errors);
  const error = errors[name];
  const errorId = `${id}-erro`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="font-display text-sm font-medium text-ink">
        {label}
      </label>
      {/* appearance-none: o <select> nativo do WebKit (iPhone) ignora a altura mínima de 44 px (medido: 27 px); sem a seta nativa, o
          triângulo é um caractere à parte, que não recebe o toque */}
      <div className="relative">
        <select
          id={id}
          name={name}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={() => clear(name)}
          className={`${INPUT} w-full appearance-none pr-10`}
        >
          {options.map(([value, text]) => (
            <option key={value} value={value}>
              {text}
            </option>
          ))}
        </select>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 font-mono text-muted"
        >
          ▾
        </span>
      </div>
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}

// Escolha de uma opção entre poucas (o modo de preço da carteira), com radios nativos de 44 por 44 px e o texto no rótulo, num grupo com legenda
// (o leitor de tela diz o nome do grupo e a opção). Controlado de fora: quem renderiza guarda a escolha, porque ela muda o rótulo e a dica de outro
// campo. Mudar a escolha apaga o erro do campo `clears`, se houver (o valor digitado quer dizer outra coisa no outro modo). A `hint` fica ligada ao
// grupo por aria-describedby: o leitor de tela a lê ao entrar nele, que é onde a troca de opção avisa o que vai acontecer.
export function RadioField({
  name,
  legend,
  hint,
  value,
  options,
  onChange,
  clears,
}: {
  name: string;
  legend: string;
  hint?: string;
  value: string;
  options: ReadonlyArray<readonly [value: string, label: string]>;
  onChange: (value: string) => void;
  clears?: string;
}) {
  const { clear } = useContext(Errors);
  const hintId = `${useId()}-dica`;
  return (
    <fieldset aria-describedby={hint ? hintId : undefined} className="min-w-0 space-y-1">
      <legend className="font-display text-sm font-medium text-ink">{legend}</legend>
      {hint ? (
        <p id={hintId} className="muted">
          {hint}
        </p>
      ) : null}
      {options.map(([optionValue, label]) => (
        <label key={optionValue} className="flex items-center gap-3">
          <input
            type="radio"
            name={name}
            value={optionValue}
            checked={value === optionValue}
            onChange={() => {
              if (clears) clear(clears);
              onChange(optionValue);
            }}
            className="radio"
          />
          <span className="min-w-0">{label}</span>
        </label>
      ))}
    </fieldset>
  );
}

// Caixa de marcar de 44 por 44 px (o alvo de toque do projeto), com o texto no rótulo. Nunca vem marcada. O texto leva `min-w-0`: é item
// de um rótulo flex, e o tamanho mínimo de um item flex é o da maior palavra sem espaço (o `overflow-wrap` do html não entra nessa conta),
// então um MessageId (`decide:<ULID>:<ULID>`, 60 caracteres) ou um slug de 64 alargaria a PÁGINA em 360 px.
export function CheckField({ name, children }: { name: string; children: ReactNode }) {
  const id = useId();
  const { errors, clear } = useContext(Errors);
  const error = errors[name];
  const errorId = `${id}-erro`;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="flex items-start gap-3">
        <input
          id={id}
          name={name}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={() => clear(name)}
          className="check"
        />
        <span className="min-w-0 pt-2.5">{children}</span>
      </label>
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}

function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="border-l-2 border-semantic-error pl-2 text-sm text-ink">
      {children}
    </p>
  );
}

// A espera: a matriz 3 × 3 da v1, cada ponto ligando e desligando inteiro (o `@keyframes dot` de globals.css), ao lado do verbo. Nunca o
// único sinal (o texto "Enviando…" é o nome do botão) e nunca um círculo girando; sob movimento reduzido, parada.
const DotSpinner = () => (
  <span aria-hidden="true" className="grid grid-cols-3 gap-0.5">
    {[0, 7, 5, 3, 1, 8, 6, 4, 2].map((step) => (
      <i
        key={step}
        className="block size-1 rounded-[1px] bg-dot-off-card [animation:dot_1.35s_steps(1,end)_infinite]"
        style={{ animationDelay: `${step * 0.09}s` }}
      />
    ))}
  </span>
);
