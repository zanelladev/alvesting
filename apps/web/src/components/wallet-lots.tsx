'use client';

import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from 'react';
import { flushSync } from 'react-dom';
// Só tipos do pacote de contratos: este módulo vai ao navegador, e o que ele lê por valor (a regra do dinheiro e os tetos) vem de
// lib/wallet-client.ts, pelo subcaminho sem zod (CLAUDE.md; o carteira-layout.spec.ts confere que nenhum script da tela leva o zod).
import type { Lot } from '@alvesting/contracts';
import type { PriceMode } from '@alvesting/contracts/portfolio-rules';
import { send, type Reply } from '../lib/account-client';
import { formatBRL, formatDate, formatQuantity } from '../lib/format';
import {
  LOTS_PATH,
  PORTFOLIO_LIMITS,
  centsText,
  checkLot,
  createdMessage,
  describeLot,
  lotFailure,
  lotSummary,
  pastedCents,
  removedMessage,
  savedMessage,
  typedCents,
  type LotFailure,
} from '../lib/wallet-client';
import { DatePicker } from './arc/date-picker/date-picker';
import { dateKey, fromKey } from './arc/lib/use-today';
import { NumberField } from './arc/number-field/number-field';
import { PilhaDeAvisos, useAvisar } from './avisos';
import {
  AccountForm,
  FieldError,
  RadioField,
  TextField,
  useCampo,
  useHydrated,
  type Outcome,
} from './form-kit';
import { IconeAdicionar, IconeFechar } from './icones';
import { LogoDoPapel } from './logo-do-papel';
import { BUTTON, CAIXA_ERRO, Empty, Fact, Facts, INPUT, LINK, NavLink } from './ui';
import { Dinheiro } from './wallet-charts';
import styles from './wallet-lots.module.css';

// Os lançamentos da carteira e o modal que os cria e edita (etapa 12, parte 2; docs/TELAS.md, seção 9). É o único pedaço da tela que roda no
// navegador: o resumo e as posições são Server Components. Lançar, editar e apagar falam com `/api/v1/me/portfolio/lots` na mesma origem (o
// cookie e o Origin chegam sozinhos) e, no sucesso, pedem ao servidor que renderize a página de novo (`router.refresh()`): o resumo, as posições e
// esta lista mostram o que a api guardou. A pessoa escolhe de novo o que está em tela, e o foco vai para onde ela estava (ver `Focus`).
//
// Lançar e editar acontecem num modal só (o <dialog> do navegador com showModal(): a camada de cima já dá o Esc, o foco preso dentro e o resto
// da página inerte; ADR 0037, "Folha e diálogo"), aberto pelo "Lançar compra" (no cabeçalho da seção e na coluna do resumo) e pelo "Editar" de
// cada lançamento. Apagar pede a confirmação no próprio item, sem `window.confirm`: a pergunta recebe o foco, e "Sim, apagar" só aparece depois
// dela. O que acabou de acontecer (lançado, salvo, apagado) é um aviso da pilha da página (components/avisos.tsx, o toast da beUI): anunciado
// pela região viva dela, com o fechar pelo teclado, e com o foco nele quando o botão que enviou sumiu (lançar e apagar).

const MODES = [
  ['unit', 'Preço por ação'],
  ['total', 'Valor total pago'],
] as const;
// o rótulo do campo de valor (o "em reais" vai só para o leitor de tela: o "R$" do campo diz o mesmo à vista)
const VALUE_LABEL: Record<PriceMode, string> = {
  unit: 'Preço por ação',
  total: 'Valor total pago',
};
// a explicação do "valor total pago": a dica visível do campo de valor no modo total, e a descrição do radio para o leitor de tela (o balão do
// tooltip numa metade do segmentado não abre no toque)
const TOTAL_EXPLICADO =
  'O total da nota desta compra, com todas as ações: é o custo do lançamento. Use quando o preço por ação tem mais de 2 casas, como uma média da corretora.';
const VALUE_HINT: Record<PriceMode, string> = {
  unit: 'O preço de uma ação. Os centavos entram pela direita: 3550 vira 35,50.',
  total: TOTAL_EXPLICADO,
};
// Na edição o campo já vem com o custo guardado, que é o total de TODAS as ações: quem muda só a quantidade e não o total muda o preço médio.
const EDIT_TOTAL_HINT = `${VALUE_HINT.total} Mudou a quantidade? Confira este total.`;
const MODE_HINT = 'Ao trocar a opção, o valor digitado é apagado.';
const QUANTITY_HINT = 'Ações inteiras: use − e + ou digite.';
const DATE_HINT = 'Pode ficar em branco. Não pode ser no futuro.';
const quantityLimit = (edge: 'min' | 'max', limit: number) =>
  edge === 'max' ? `Máx. ${formatQuantity(limit)} ações` : `Mín. ${formatQuantity(limit)} ação`;
// "15 de out. de 2026"
const DATE_FORMAT: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
const MIN_BOUGHT_ON = fromKey(PORTFOLIO_LIMITS.minBoughtOn);
const LINKS = {
  entrar: { href: '/entrar?proximo=%2Fcarteira', text: 'Entrar de novo' },
  conta: { href: '/conta', text: 'Abrir a minha conta' },
} as const;
// o pedido de abrir o modal de lançar, que o botão da coluna do resumo (de outra ilha da página) manda ao WalletLots
const ABRIR = 'alvesting:lancar';
// o título do modal: dá o nome ao <dialog> e ao formulário que ele mostra
const TITULO = 'lancamento-titulo';

// O que a tela usa de cada lançamento (a página só entrega isto: os instantes de criação e de edição ficam no servidor)
export type LotView = Pick<Lot, 'id' | 'ticker' | 'quantity' | 'costCents' | 'boughtOn'>;

const text = (data: FormData, name: string): string => {
  const value = data.get(name);
  return typeof value === 'string' ? value : '';
};

// A frase do erro, com o caminho de volta quando há um (a sessão acabou, o aceite venceu).
function FailureText({ failure }: { failure: LotFailure }) {
  const link = failure.link ? LINKS[failure.link] : null;
  return (
    <>
      {failure.message}
      {link ? (
        <>
          {' '}
          <NavLink href={link.href} className={LINK}>
            {link.text}
          </NavLink>
        </>
      ) : null}
    </>
  );
}

const outcomeOf = (failure: LotFailure): Outcome =>
  failure.fields ? { fields: failure.fields } : { form: <FailureText failure={failure} /> };

// O botão que abre o modal de lançar: no cabeçalho da seção (a pílula primária com o "+": a ação principal da tela; dentro do modal, a primária
// é o envio) e na coluna do resumo (a pílula cinza; wallet-panels.tsx, de servidor, o põe como ilha). Ele avisa o WalletLots por um evento no
// `window`, sem mudar a árvore da página, e se passa junto, para o foco voltar a ele quando o modal fechar. Antes do JavaScript fica desativado
// (um botão sem handler não faria nada), e o <noscript> ao lado diz por quê.
export function BotaoLancar({ primary = false }: { primary?: boolean }) {
  const hydrated = useHydrated();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        type="button"
        className={primary ? `${BUTTON} btn-primary` : BUTTON}
        disabled={!hydrated}
        onClick={(event) =>
          window.dispatchEvent(new CustomEvent(ABRIR, { detail: event.currentTarget }))
        }
      >
        {primary ? <IconeAdicionar size={18} /> : null}
        Lançar compra
      </button>
      <noscript>
        <span className="muted">Lançar uma compra precisa de JavaScript.</span>
      </noscript>
    </div>
  );
}

// A quantidade: o Number field da Arc, só ações inteiras (o passo é 1 e a vírgula não entra: meia ação não existe), de 1 ao teto, com o − e
// o + e os algarismos que rolam. A peça não tem `name`: o campo escondido leva o inteiro ao formulário (o checkLot lê `quantity` como sempre).
function QuantityField({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { error, errorId, clear } = useCampo('quantity');
  return (
    <div className="flex flex-col gap-1">
      <NumberField
        label="Quantidade"
        value={value}
        onValueChange={(next) => {
          clear();
          onChange(next);
        }}
        min={1}
        max={PORTFOLIO_LIMITS.maxQuantity}
        step={1}
        locale="pt-BR"
        description={QUANTITY_HINT}
        limitHint={quantityLimit}
        invalid={Boolean(error)}
        describedBy={error ? errorId : undefined}
      />
      <input type="hidden" name="quantity" value={value} />
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}

// O valor, no padrão dos bancos brasileiros (o campo de dinheiro é nosso; ADR 0037): o "R$" dentro do campo, à esquerda, e os centavos
// entrando pela direita (lib/wallet-client.ts, `typedCents`): só algarismos contam, o Backspace tira o último, o milhar aparece enquanto
// digita e o cursor fica no fim. Colar passa pela regra do contrato (`pastedCents`). O campo leva `name="value"` com o texto que mostra
// ("1.234,56"), que o parseBrl do envio lê. Controlado de fora: o modo zera o valor, e o resumo acima dos botões o lê.
function MoneyField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number | null;
  onChange: (value: number | null) => void;
}) {
  const { id, error, hintId, errorId, describedBy, clear } = useCampo('value', hint);
  const input = useRef<HTMLInputElement>(null);
  const shown = centsText(value === null ? '' : String(value));
  // null: passou do máximo de algarismos, ou o que se colou o parseBrl recusa; o campo fica como estava
  const put = (digits: string | null) => {
    if (digits === null) return;
    clear();
    onChange(digits === '' ? null : Number(digits));
  };
  const toEnd = (field: HTMLInputElement) =>
    field.setSelectionRange(field.value.length, field.value.length);
  useLayoutEffect(() => {
    if (input.current && document.activeElement === input.current) toEnd(input.current);
  }, [shown]);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
        <span className="sr-only"> em reais</span>
      </label>
      <p id={hintId} className="muted">
        {hint}
      </p>
      <div className={styles.dinheiro}>
        <span aria-hidden="true" className={styles.moeda}>
          R$
        </span>
        <input
          ref={input}
          id={id}
          name="value"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="0,00"
          value={shown}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) => put(typedCents(event.currentTarget.value))}
          onPaste={(event) => {
            event.preventDefault();
            put(pastedCents(event.clipboardData.getData('text')));
          }}
          // o cursor no meio (o toque, as setas) volta para o fim; a seleção (para trocar tudo) fica
          onSelect={(event) => {
            const field = event.currentTarget;
            if (
              field.selectionStart === field.selectionEnd &&
              field.selectionEnd !== field.value.length
            )
              toEnd(field);
          }}
          className={`${INPUT} w-full ${styles.valor}`}
        />
      </div>
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}

// A data da compra: o Date picker e o Calendar da Arc, em português, com o mês e o ano nos <select> do título, até hoje em Brasília e desde o
// piso do contrato, e o botão "Hoje". A peça não tem `name`: o campo escondido leva AAAA-MM-DD montado das partes LOCAIS da data (`dateKey`;
// nunca `toISOString`, que muda o dia pelo fuso), vazio sem data.
function BoughtOnField({
  value,
  onChange,
  maxDate,
}: {
  value: Date | undefined;
  onChange: (value: Date | undefined) => void;
  maxDate: Date;
}) {
  const { error, errorId, clear } = useCampo('boughtOn');
  return (
    <div className="flex flex-col gap-1">
      <DatePicker
        label="Data da compra (opcional)"
        placeholder="Sem data"
        locale="pt-BR"
        format={DATE_FORMAT}
        description={DATE_HINT}
        minDate={MIN_BOUGHT_ON}
        maxDate={maxDate}
        showToday
        value={value}
        onChange={(next) => {
          clear();
          onChange(next);
        }}
        invalid={Boolean(error)}
        describedBy={error ? errorId : undefined}
      />
      <input type="hidden" name="boughtOn" value={value ? dateKey(value) : ''} />
      {error ? <FieldError id={errorId}>{error}</FieldError> : null}
    </div>
  );
}

// O formulário de lançar uma compra e o de editar um lançamento: o mesmo, com `lot` na edição. Os campos são controlados (o modo, a quantidade,
// o valor e a data moram aqui, e o resumo acima dos botões os lê); o ticker não (o valor mora no DOM). Trocar de modo APAGA o valor (o mesmo
// número quer dizer outra coisa no outro modo, e um total de R$ 3.550,00 lido como preço por ação seria mil vezes maior em silêncio); na edição,
// voltar ao total devolve o custo guardado.
// ponytail: sem sugestões de ticker (um <datalist> alimentado pela /stocks?q). A api confere o ticker e diz "não encontramos esta ação"; se a
// pessoa errar muito o código, o <datalist> nativo com a busca (um fetch por tecla a uma rota pública com cache).
function LotForm({
  lot,
  today,
  track,
  onSaved,
  onGone,
  onCancel,
}: {
  lot?: LotView;
  // o dia de hoje em Brasília: o último que o calendário deixa escolher (a api confere de verdade)
  today: string;
  // avisa a lista que há um pedido no ar (ver `track`, em WalletLots)
  track: (work: Promise<Reply>) => Promise<Reply>;
  onSaved: (message: string) => void;
  // o lançamento já não existe (apagado noutra aba)
  onGone?: (message: string) => void;
  onCancel: () => void;
}) {
  // O banco guarda só o custo total, não o modo: a edição começa em "valor total pago", com o custo exato de volta no campo.
  const [mode, setMode] = useState<PriceMode>(lot ? 'total' : 'unit');
  const [quantity, setQuantity] = useState(lot?.quantity ?? 1);
  const [cents, setCents] = useState<number | null>(lot ? lot.costCents : null);
  const [boughtOn, setBoughtOn] = useState(lot?.boughtOn ? fromKey(lot.boughtOn) : undefined);
  const maxDate = useMemo(() => fromKey(today), [today]);
  const summary = lotSummary(mode, quantity, cents);

  async function run(data: FormData): Promise<Outcome | void> {
    const checked = checkLot({
      ticker: text(data, 'ticker'),
      quantity: text(data, 'quantity'),
      mode,
      value: text(data, 'value'),
      boughtOn: text(data, 'boughtOn'),
    });
    if (!checked.ok) return { fields: checked.fields };

    const out = await track(
      send(lot ? `${LOTS_PATH}/${lot.id}` : LOTS_PATH, {
        method: lot ? 'PATCH' : 'POST',
        body: checked.body,
      }),
    );
    if (out.ok) {
      const described = { quantity: checked.body.quantity, ticker: checked.body.ticker };
      onSaved(
        lot
          ? savedMessage(described, checked.costCents)
          : createdMessage(described, checked.costCents),
      );
      return; // saindo: quem chamou fecha o modal e refaz a tela (o formulário de lançar nasce de novo, limpo)
    }
    const failure = lotFailure(out);
    if (failure.gone && onGone) {
      onGone(failure.message ?? '');
      return;
    }
    return outcomeOf(failure);
  }

  return (
    <AccountForm
      submit={lot ? 'Salvar alterações' : 'Lançar compra'}
      run={run}
      labelledBy={TITULO}
      noscript={false}
      primary
      actions={
        <button type="button" className={BUTTON} onClick={onCancel}>
          Cancelar
        </button>
      }
    >
      <TextField
        name="ticker"
        label="Ticker"
        autoComplete="off"
        capitalize="characters"
        maxLength={12}
        defaultValue={lot?.ticker}
        hint="O código da ação na B3, como PETR4."
      />
      <QuantityField value={quantity} onChange={setQuantity} />
      <RadioField
        name="mode"
        legend="Como você vai informar o valor?"
        hint={MODE_HINT}
        value={mode}
        options={MODES}
        onChange={(value) => {
          const next: PriceMode = value === 'total' ? 'total' : 'unit';
          setMode(next);
          setCents(lot && next === 'total' ? lot.costCents : null);
        }}
        clears="value"
        describe={{ total: TOTAL_EXPLICADO }}
      />
      <MoneyField
        label={VALUE_LABEL[mode]}
        hint={lot && mode === 'total' ? EDIT_TOTAL_HINT : VALUE_HINT[mode]}
        value={cents}
        onChange={setCents}
      />
      <BoughtOnField value={boughtOn} onChange={setBoughtOn} maxDate={maxDate} />
      {/* o resumo do que vai ser lançado, no contador da Arc (rola quando o − e o + mudam a quantidade); some sem valor ou acima do teto */}
      {summary ? (
        <p className={styles.resumo} data-resumo="">
          <span className="text-muted">{summary.label}</span>{' '}
          <span className={styles.resumoValor}>
            <Dinheiro cents={summary.cents} />
          </span>
        </p>
      ) : null}
    </AccountForm>
  );
}

// Para onde o foco vai depois de uma ação: um seletor dentro desta árvore. O objeto é novo a cada pedido, então o mesmo destino de novo (apagar
// dois lançamentos seguidos, o aviso) também move o foco. Sem isto o foco se perderia no <body> quando o botão que o tinha desaparece.
interface Focus {
  selector: string;
}
// o aviso que acabou de chegar na pilha (o id é o que `avisar` devolve)
const NOTICE = 'aviso';
const sel = {
  notice: (id: string) => `[data-aviso="${id}"]`,
  edit: (id: string) => `[data-lot="${id}"] [data-action="edit"]`,
  remove: (id: string) => `[data-lot="${id}"] [data-action="remove"]`,
  question: (id: string) => `[data-lot="${id}"] [data-question]`,
  problem: (id: string) => `[data-lot="${id}"] [data-alert]`,
};

interface Removal {
  busy: boolean;
  failure: LotFailure | null;
}
const IDLE: Removal = { busy: false, failure: null };

export function WalletLots({
  lots,
  today,
  logos = {},
}: {
  lots: readonly LotView[];
  today: string;
  // a versão do logo de cada ticker (lib/logos.ts, no servidor); sem ela, o monograma
  logos?: Readonly<Record<string, string>>;
}) {
  const router = useRouter();
  const hydrated = useHydrated();
  const avisar = useAvisar();
  const [refreshing, startTransition] = useTransition();
  const root = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  // quem abriu o modal: o foco volta a ele quando o modal fecha sem lançar (o <dialog> devolve o foco a quem o tinha, mas o Safari não foca o
  // botão no clique)
  const opener = useRef<HTMLElement | null>(null);
  const sending = useRef(false);
  // o lançamento que o modal edita (null: lançar). Fica depois de fechar, para o modal sair mostrando o que mostrava
  const [editing, setEditing] = useState<LotView | null>(null);
  // sobe a cada abertura da edição: o formulário dela nasce de novo, com o que está guardado
  const [opens, setOpens] = useState(0);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removal, setRemoval] = useState<Removal>(IDLE);
  // sobe a cada lançamento criado: o formulário de lançar nasce de novo, limpo. Até lá o rascunho sobrevive a fechar e abrir o modal
  const [createKey, setCreateKey] = useState(0);
  const [focus, setFocus] = useState<Focus | null>(null);

  useEffect(() => {
    if (focus) root.current?.querySelector<HTMLElement>(focus.selector)?.focus();
  }, [focus]);

  // Uma ação de cada vez (docs/TELAS.md, seção 9): enquanto um pedido está no ar, ou o servidor ainda refaz a página depois dele, os outros
  // cartões não abrem edição nem pergunta, e o modal não fecha. Um contador, e não um boleano: dois pedidos podem estar no ar ao mesmo tempo.
  const [flying, setFlying] = useState(0);
  const locked = refreshing || flying > 0;
  async function track(work: Promise<Reply>): Promise<Reply> {
    setFlying((n) => n + 1);
    try {
      return await work;
    } finally {
      setFlying((n) => n - 1);
    }
  }

  // Abre o modal no clique (dentro do gesto: no iPhone o foco no ticker só abre o teclado assim): o React desenha o formulário certo antes
  // (`flushSync`), o <dialog> abre e o foco vai ao ticker.
  const openDialog = useCallback((lot: LotView | null, from: HTMLElement | null) => {
    const modal = dialog.current;
    if (!modal || modal.open) return;
    opener.current = from;
    flushSync(() => {
      setEditing(lot);
      setRemoving(null);
      if (lot) setOpens((n) => n + 1);
    });
    modal.showModal();
    modal
      .querySelector<HTMLElement>(`[data-form="${lot ? 'editar' : 'lancar'}"] input[name="ticker"]`)
      ?.focus();
  }, []);
  useEffect(() => {
    const abrir = (event: Event) =>
      openDialog(null, (event as CustomEvent<HTMLElement | null>).detail);
    window.addEventListener(ABRIR, abrir);
    return () => window.removeEventListener(ABRIR, abrir);
  }, [openDialog]);
  // fechar sem lançar (o ✕, o "Cancelar" e o Esc): o evento `close` devolve o foco a quem abriu
  const closeDialog = () => dialog.current?.close();
  // fechar depois de dar certo (ou do 404 da edição): o foco vai ao aviso ou ao Editar (`done`), e não a quem abriu
  const finishDialog = () => {
    opener.current = null;
    dialog.current?.close();
  };

  // A página restaurada do cache de ida e volta do navegador (o botão "voltar"): os dois formulários nascem de novo, no começo. Os campos
  // moram no React, e o form.reset() do AccountForm não os alcança (o rótulo diria "total" com o radio "por ação" marcado).
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      setCreateKey((key) => key + 1);
      setOpens((n) => n + 1);
    };
    window.addEventListener('pageshow', restored);
    return () => window.removeEventListener('pageshow', restored);
  }, []);

  // O resultado de uma ação que deu certo: o servidor renderiza a página de novo e, na MESMA transição, esta tela troca o estado (o aviso na
  // pilha, o foco e o que `after` fecha ou limpa: só o que a ação mexeu). Se o React juntar as duas, a lista nova, o número que rola no resumo
  // e o aviso chegam juntos; se não juntar, o aviso chega antes e a lista logo depois. Nos dois casos o aviso diz o que aconteceu por inteiro,
  // e a lista termina igual à que a api guardou. `to` é um seletor, ou o aviso novo.
  function done(message: string, to: string, after: () => void) {
    startTransition(() => {
      router.refresh();
      const id = avisar(message);
      after();
      setFocus({ selector: to === NOTICE ? sel.notice(id) : to });
    });
  }
  const closeRemoval = () => {
    setRemoving(null);
    setRemoval(IDLE);
  };

  function openRemove(id: string) {
    setRemoving(id);
    setRemoval(IDLE);
    setFocus({ selector: sel.question(id) });
  }
  function cancelRemove(id: string) {
    setRemoving(null);
    setFocus({ selector: sel.remove(id) });
  }

  async function confirmRemove(lot: LotView) {
    if (sending.current) return; // sem envio duplo: o segundo clique antes de o botão desativar
    sending.current = true;
    setRemoval({ busy: true, failure: null });
    const out = await track(send(`${LOTS_PATH}/${lot.id}`, { method: 'DELETE' }));
    sending.current = false;
    if (out.ok) return done(removedMessage(lot), NOTICE, closeRemoval);
    const failure = lotFailure(out);
    // apagar o que já não existe é o que a pessoa queria: a lista só precisa de atualização
    if (failure.gone) {
      return done('Este lançamento já tinha sido apagado.', NOTICE, closeRemoval);
    }
    setRemoval({ busy: false, failure });
    setFocus({ selector: sel.problem(lot.id) });
  }

  const card = (lot: LotView): ReactNode => {
    const name = `${describeLot(lot)}, custo total ${formatBRL(lot.costCents)}`;
    return (
      <>
        {/* o ticker na sans 500, com o logo à esquerda, ligado à página da ação (o mesmo das posições) */}
        <p className="text-15 font-medium text-ink">
          <NavLink href={`/acoes/${lot.ticker}`} className={`${LINK} no-underline hover:underline`}>
            <LogoDoPapel ticker={lot.ticker} versao={logos[lot.ticker]} className="mr-3" />
            {lot.ticker}
          </NavLink>
        </p>
        <Facts dense>
          <Fact term="Quantidade">{formatQuantity(lot.quantity)}</Fact>
          <Fact term="Custo total">{formatBRL(lot.costCents)}</Fact>
          <Fact term="Data da compra">
            {lot.boughtOn === null ? 'sem data' : formatDate(lot.boughtOn)}
          </Fact>
        </Facts>
        {removing === lot.id ? (
          <div
            role="group"
            aria-labelledby={`apagar-${lot.id}`}
            className="space-y-3 rounded-lg bg-surface-card p-4"
          >
            <p
              id={`apagar-${lot.id}`}
              tabIndex={-1}
              data-question=""
              className="font-medium text-ink"
            >
              {`Apagar o lançamento de ${name}? Não dá para desfazer.`}
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className={BUTTON}
                disabled={removal.busy || locked}
                onClick={() => void confirmRemove(lot)}
              >
                {removal.busy ? 'Apagando…' : 'Sim, apagar'}
              </button>
              <button
                type="button"
                className={BUTTON}
                disabled={removal.busy || locked}
                onClick={() => cancelRemove(lot.id)}
              >
                Não, manter
              </button>
            </div>
            {removal.failure ? (
              <p role="alert" tabIndex={-1} data-alert="" className={CAIXA_ERRO}>
                <FailureText failure={removal.failure} />
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              data-action="edit"
              className={BUTTON}
              disabled={!hydrated || locked}
              aria-label={`Editar lançamento: ${name}`}
              onClick={(event) => openDialog(lot, event.currentTarget)}
            >
              Editar
            </button>
            <button
              type="button"
              data-action="remove"
              className={BUTTON}
              disabled={!hydrated || locked}
              aria-label={`Apagar lançamento: ${name}`}
              onClick={() => openRemove(lot.id)}
            >
              Apagar
            </button>
          </div>
        )}
      </>
    );
  };

  return (
    <div ref={root} className="space-y-8">
      {/* a pilha de avisos (o toast): no documento, aqui, antes da lista (o Tab do aviso segue para os lançamentos), e na tela, fixa no pé; a
          região viva existe desde o começo, para o leitor de tela anunciar o aviso que chega depois */}
      <PilhaDeAvisos />
      <section id="lancamentos" aria-labelledby="lancamentos-titulo" className="mt-12">
        <div className={styles.secaoTopo}>
          <h2 id="lancamentos-titulo" className="font-display text-22">
            Lançamentos
          </h2>
          <BotaoLancar primary />
        </div>
        {lots.length === 0 ? (
          <Empty>
            Você ainda não lançou nenhuma compra. Use o botão “Lançar compra” para anotar a
            primeira: o código da ação (como PETR4), a quantidade e quanto você pagou, por ação ou
            no total. Depois dá para editar ou apagar cada lançamento.
          </Empty>
        ) : (
          <ul className="max-w-2xl divide-y divide-hairline border-y border-hairline">
            {lots.map((lot) => (
              <li key={lot.id} data-lot={lot.id} className="min-w-0 space-y-3 py-4">
                {card(lot)}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* O modal de lançar e de editar. NÃO fecha no clique fora (o padrão do <dialog>, sem o `closedby="any"`): é um formulário com o que a
          pessoa digitou, e um toque perdido no véu o jogaria fora. Fecha pelo Esc (o `cancel` nativo), pelo ✕ e pelo "Cancelar"; com um pedido
          no ar nada fecha, e com o calendário aberto o pedido de fechar fecha só o calendário: o Esc ele mesmo já cancela; o voltar do Android
          chega aqui sem tecla nenhuma, e o clique no gatilho aberto o fecha (o gatilho alterna). */}
      <dialog
        ref={dialog}
        aria-labelledby={TITULO}
        className={styles.modal}
        onCancel={(event) => {
          const calendar = event.currentTarget.querySelector<HTMLButtonElement>(
            '[aria-haspopup="dialog"][aria-expanded="true"]',
          );
          if (flying > 0 || calendar) event.preventDefault();
          calendar?.click();
        }}
        onClose={() => {
          const to = opener.current;
          opener.current = null;
          to?.focus();
        }}
      >
        <div className={styles.cabeca}>
          <h2 id={TITULO} className={styles.titulo}>
            {editing ? `Editar lançamento de ${describeLot(editing)}` : 'Lançar uma compra'}
          </h2>
          <button
            type="button"
            className={styles.fechar}
            aria-label="Fechar"
            disabled={flying > 0}
            onClick={closeDialog}
          >
            <IconeFechar />
          </button>
        </div>
        <div className={styles.corpo}>
          <div data-form="lancar" hidden={editing !== null} className="space-y-4">
            <p className="muted max-w-prose">
              Anote uma compra que você fez. Cada lançamento entra na posição da ação: o preço médio
              é o custo de todos os lançamentos dividido pela quantidade.
            </p>
            <p>
              <a href="/acoes" target="_blank" rel="noopener noreferrer" className={LINK}>
                Buscar uma ação
                <span className="sr-only"> (abre em outra aba)</span>
              </a>
            </p>
            <LotForm
              key={createKey}
              today={today}
              track={track}
              onSaved={(message) =>
                done(message, NOTICE, () => {
                  finishDialog();
                  setCreateKey((key) => key + 1);
                })
              }
              onCancel={closeDialog}
            />
          </div>
          {editing ? (
            <div data-form="editar">
              <LotForm
                key={`${editing.id}:${opens}`}
                lot={editing}
                today={today}
                track={track}
                onSaved={(message) => done(message, sel.edit(editing.id), finishDialog)}
                onGone={(message) => done(message, NOTICE, finishDialog)}
                onCancel={closeDialog}
              />
            </div>
          ) : null}
        </div>
      </dialog>
    </div>
  );
}
