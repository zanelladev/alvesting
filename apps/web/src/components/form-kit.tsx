'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Icone } from './icones';
import { NativeSelect, NativeSelectOption } from './reui/native-select';
import { BUTTON, CAIXA_ERRO, INPUT } from './ui';

// As peças dos formulários da conta (etapa 11, parte 2): campo com rótulo, erro ligado ao campo por aria-describedby, foco no primeiro
// erro, aviso de status e o botão. Os campos são não controlados (o valor mora no DOM), o envio lê o FormData, e quem manda é a api: a
// conferência daqui só poupa a ida. O sistema visual do Rallies (src/app/globals.css; ADR 0035): o campo do cadastro deles (44 px, raio 8, o
// cinza do painel, com o fio de controle) e o envio na pílula primária. O campo com erro troca o fio pelo vermelho do erro (`aria-invalid`, no
// globals.css), e a frase do erro vem embaixo dele, ligada por aria-describedby e lida pelo leitor de tela (`role="alert"`).
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
let quieto = false;
// false no servidor e na hidratação, true depois: o JavaScript chegou. Os botões de editar e apagar da carteira esperam por ele, como o
// formulário (um botão sem handler não faz nada, e a pessoa não saberia por quê). Quando ele chega, o que estava desativado vira ativo (o botão
// cinza vira a primária): nada transiciona nesse quadro, senão a ação principal esmaeceria na abertura da página (o QA do fechamento, achado 6).
// A troca é a do tema (beui/theme-selector.tsx): uma folha com `transition: none` entra antes de o navegador recalcular o estilo e sai dois
// quadros depois, uma vez por página; o hover e o toque continuam a andar em 150 ms.
export const useHydrated = () => {
  const hydrated = useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
  useLayoutEffect(() => {
    if (!hydrated || quieto) return;
    quieto = true;
    const style = document.createElement('style');
    style.textContent = '*,*::before,*::after{transition:none!important}';
    document.head.appendChild(style);
    requestAnimationFrame(() => requestAnimationFrame(() => style.remove()));
  }, [hydrated]);
  return hydrated;
};

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
  largo = false,
}: {
  submit: string;
  // `via` é o `value` do botão que enviou (o do Google), ou null para o botão principal. Devolve o resultado de uma falha ou de um aviso;
  // sem retorno, a tela está saindo (a navegação já começou) e o formulário continua desativado.
  run: (data: FormData, via: string | null) => Promise<Outcome | void>;
  children?: ReactNode;
  actions?: ReactNode;
  labelledBy?: string;
  noscript?: boolean;
  // o envio é a ação principal da superfície: a pílula primária (uma por superfície). Sair, excluir a conta e as ações do painel ficam na
  // pílula cinza
  primary?: boolean;
  // os botões na largura da coluna, um embaixo do outro: o envio do cadastro do Rallies, nas telas de entrar e criar conta (a tela dividida)
  largo?: boolean;
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
          <p className="text-body">
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
        <div className={largo ? 'flex flex-col gap-3 *:w-full' : 'flex flex-wrap gap-3'}>
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
      {/* a região existe desde o começo, para o leitor de tela anunciar o aviso que chega depois; com texto, o foco vai a ela. O desenho é o
          painel cinza sem fio, com o ícone do que deu certo (a cor nunca anda sozinha: a frase diz o mesmo) */}
      <p
        role="status"
        tabIndex={status ? -1 : undefined}
        data-form-status={status ? '' : undefined}
        className={
          status
            ? 'flex max-w-prose gap-2.5 rounded-lg bg-surface-card p-4 text-pretty text-ink'
            : 'sr-only'
        }
      >
        {status ? (
          <>
            <span aria-hidden="true" className="mt-0.5 shrink-0 text-semantic-success">
              <Icone size={16}>
                <path d="M5.5 10.5l3 3 6-7" />
              </Icone>
            </span>
            <span className="min-w-0">{status}</span>
          </>
        ) : null}
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
      <label htmlFor={id} className="text-sm font-medium text-ink">
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
      <label htmlFor={id} className="text-sm font-medium text-ink">
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

// Lista de escolha com rótulo (o tipo do evento corporativo), no `<select>` do navegador com o desenho do campo (o Native select da ReUI, ADR
// 0037: no celular, o seletor do sistema). A primeira opção vale se a pessoa não mexer.
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
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      {/* appearance-none (na peça): o <select> nativo do WebKit (iPhone) ignora a altura mínima de 44 px (medido: 27 px); a seta é um ícone à
          parte, que não recebe o toque */}
      <NativeSelect
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={() => clear(name)}
      >
        {options.map(([value, text]) => (
          <NativeSelectOption key={value} value={value}>
            {text}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}

// Escolha de uma opção entre poucas (o modo de preço da carteira), com radios nativos de 44 por 44 px e o texto no rótulo, num grupo com legenda
// (o leitor de tela diz o nome do grupo e a opção). Controlado de fora: quem renderiza guarda a escolha, porque ela muda o rótulo e a dica de outro
// campo. Mudar a escolha apaga o erro do campo `clears`, se houver (o valor digitado quer dizer outra coisa no outro modo). A `hint` fica ligada ao
// grupo por aria-describedby: o leitor de tela a lê ao entrar nele, que é onde a troca de opção avisa o que vai acontecer. `describe` dá a uma
// opção a explicação que o leitor de tela ouve com ela (a descrição do radio), e `wrap` envolve o rótulo dela (o tooltip da Arc, que mostra a
// mesma explicação no hover e no foco: o foco do radio sobe até o rótulo).
export function RadioField({
  name,
  legend,
  hint,
  value,
  options,
  onChange,
  clears,
  describe = {},
  wrap = (_value, option) => option,
}: {
  name: string;
  legend: string;
  hint?: string;
  value: string;
  options: ReadonlyArray<readonly [value: string, label: string]>;
  onChange: (value: string) => void;
  clears?: string;
  describe?: Readonly<Record<string, string>>;
  wrap?: (value: string, option: ReactElement) => ReactNode;
}) {
  const { clear } = useContext(Errors);
  const baseId = useId();
  const hintId = `${baseId}-dica`;
  return (
    <fieldset aria-describedby={hint ? hintId : undefined} className="min-w-0 space-y-1">
      <legend className="text-sm font-medium text-ink">{legend}</legend>
      {hint ? (
        <p id={hintId} className="muted">
          {hint}
        </p>
      ) : null}
      {options.map(([optionValue, label]) => {
        const description = describe[optionValue];
        const descriptionId = `${baseId}-${optionValue}`;
        return (
          <div key={optionValue}>
            {wrap(
              optionValue,
              // o alvo de 44 px é o rótulo inteiro (o radio de 20 px e o texto): o toque no texto marca o radio
              <label className="flex min-h-11 w-fit max-w-full cursor-pointer items-center gap-3">
                <input
                  type="radio"
                  name={name}
                  value={optionValue}
                  checked={value === optionValue}
                  aria-describedby={description ? descriptionId : undefined}
                  onChange={() => {
                    if (clears) clear(clears);
                    onChange(optionValue);
                  }}
                  className="radio"
                />
                <span className={description ? 'termo min-w-0' : 'min-w-0'}>{label}</span>
              </label>,
            )}
            {description ? (
              <span id={descriptionId} className="sr-only">
                {description}
              </span>
            ) : null}
          </div>
        );
      })}
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

// `role="alert"`: o erro que aparece depois do envio é anunciado, cada um, e não só o do primeiro campo (o foco vai a ele, e o leitor de
// tela lê o erro dele pelo aria-describedby); sem isso, quem usa leitor de tela acharia os outros andando campo a campo. O sinal do erro é o fio
// do campo no vermelho (`aria-invalid`) e o ícone ao lado da frase, que fica na tinta: nada de faixa colorida ao lado (docs/DESIGN.md), e a cor
// nunca anda sozinha (o ícone e a frase dizem o mesmo).
function FieldError({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} role="alert" className="flex gap-1.5 text-sm text-ink">
      <span aria-hidden="true" className="mt-0.5 shrink-0 text-semantic-error">
        <Icone size={16}>
          <circle cx="10" cy="10" r="7" />
          <path d="M10 6.5V10.5M10 13.5v.01" />
        </Icone>
      </span>
      <span className="min-w-0">{children}</span>
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
