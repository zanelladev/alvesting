'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react';
// Só tipos do pacote de contratos: este módulo vai ao navegador, e o que ele lê por valor (a regra do dinheiro) vem de lib/wallet-client.ts, pelo
// subcaminho sem zod (CLAUDE.md; o carteira-layout.spec.ts confere que nenhum script da tela leva o zod).
import type { Lot } from '@alvesting/contracts';
import type { PriceMode } from '@alvesting/contracts/portfolio-rules';
import { send, type Reply } from '../lib/account-client';
import { formatBRL, formatDate, formatQuantity } from '../lib/format';
import {
  LOTS_PATH,
  centsToInput,
  checkLot,
  createdMessage,
  describeLot,
  lotFailure,
  removedMessage,
  savedMessage,
  type LotFailure,
} from '../lib/wallet-client';
import { AccountForm, RadioField, TextField, useHydrated, type Outcome } from './form-kit';
import { BUTTON, CAIXA, CAIXA_ERRO, Empty, Fact, Facts, LINK, NavLink, Section } from './ui';

// Os lançamentos da carteira e o formulário que os cria e edita (etapa 12, parte 2; docs/TELAS.md, seção 9). É o único pedaço da tela que roda no
// navegador: o resumo e as posições são Server Components. Lançar, editar e apagar falam com `/api/v1/me/portfolio/lots` na mesma origem (o cookie e
// o Origin chegam sozinhos) e, no sucesso, pedem ao servidor que renderize a página de novo (`router.refresh()`): o resumo, as posições e esta
// lista mostram o que a api guardou. A pessoa escolhe de novo o que está em tela, e o foco vai para onde ela estava (ver `Focus`).
//
// Editar usa o MESMO formulário de lançar, aberto no próprio cartão do lançamento (a pessoa não perde o lugar numa lista de até 200). Apagar pede
// a confirmação no próprio cartão, sem `window.confirm`: a pergunta recebe o foco, e "Sim, apagar" só aparece depois dela.

const MODES = [
  ['unit', 'Preço por ação'],
  ['total', 'Valor total pago'],
] as const;
const VALUE_LABEL: Record<PriceMode, string> = {
  unit: 'Preço por ação (R$)',
  total: 'Valor total pago (R$)',
};
const VALUE_HINT: Record<PriceMode, string> = {
  unit: 'O preço de uma ação, em reais, com vírgula nos centavos. Ex.: 35,50.',
  total: 'O total que você pagou pelas ações deste lançamento, em reais. Ex.: 3.550,00.',
};
// Na edição o campo já vem com o custo guardado, que é o total de TODAS as ações: quem muda só a quantidade e não o total muda o preço médio.
const EDIT_TOTAL_HINT = `${VALUE_HINT.total} Mudou a quantidade? Confira este total.`;
const MODE_HINT = 'Ao trocar a opção, o valor digitado é apagado.';
const LINKS = {
  entrar: { href: '/entrar?proximo=%2Fcarteira', text: 'Entrar de novo' },
  conta: { href: '/conta', text: 'Abrir a minha conta' },
} as const;

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

// O formulário de lançar uma compra e o de editar um lançamento: o mesmo, com `lot` na edição. Os campos não são controlados (o valor mora no
// DOM), menos o modo: ele muda o rótulo e a dica do campo de valor, e trocar de modo APAGA o que foi digitado nele (o mesmo número quer dizer
// outra coisa no outro modo, e um total de R$ 3.550,00 lido como preço por ação seria mil vezes maior em silêncio).
// ponytail: sem sugestões de ticker (um <datalist> alimentado pela /stocks?q) e sem prévia do custo total ao digitar. A api confere o ticker e
// diz "não encontramos esta ação"; o lançamento salvo mostra o custo, e dá para editar. Se a pessoa errar muito o código, o <datalist> nativo com a
// busca (um fetch por tecla a uma rota pública com cache); se errar o modo mesmo com o rótulo e a dica, uma linha "Custo total" acima do botão
// (os campos passam a ser controlados). Uma data só com dia e mês (o Chromium de mesa) chega vazia e o lançamento entra "sem data": dá para editar.
// Também não há botão "Limpar data": quem errou a data troca por outra. Se isso incomodar, um botão de 44 px que zera o campo e, no envio, a conferência
// de `validity.badInput` (recusar a data incompleta com a frase do campo); precisa ser visto num iPhone de verdade antes de dar por resolvido.
function LotForm({
  lot,
  today,
  labelledBy,
  track,
  onSaved,
  onGone,
  onCancel,
}: {
  lot?: LotView;
  // o dia de hoje em Brasília: o último que o seletor de data deixa escolher (a api confere de verdade)
  today: string;
  labelledBy: string;
  // avisa a lista que há um pedido no ar (ver `track`, em WalletLots)
  track: (work: Promise<Reply>) => Promise<Reply>;
  onSaved: (message: string) => void;
  // o lançamento já não existe (apagado noutra aba)
  onGone?: (message: string) => void;
  onCancel?: () => void;
}) {
  // O banco guarda só o custo total, não o modo: a edição começa em "valor total pago", com o custo exato de volta no campo.
  const initialMode: PriceMode = lot ? 'total' : 'unit';
  const [mode, setMode] = useState<PriceMode>(initialMode);

  // A página restaurada do cache de ida e volta do navegador (o botão "voltar"): o AccountForm devolve os campos ao começo (form.reset()), e o modo,
  // que mora aqui e não no DOM, volta junto. Sem isso o estado e o radio podiam ficar em modos diferentes (o reset mexe no DOM sem passar pelo React),
  // e o rótulo diria "total" com o radio "por ação" marcado. O estado volta ao modo da primeira renderização, que é também o modo marcado no HTML
  // original, o que o reset devolve ao DOM: os dois acabam no mesmo.
  useEffect(() => {
    const restored = (event: PageTransitionEvent) => {
      if (event.persisted) setMode(initialMode);
    };
    window.addEventListener('pageshow', restored);
    return () => window.removeEventListener('pageshow', restored);
  }, [initialMode]);

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
      return; // saindo: quem chamou refaz a tela (o formulário nasce de novo, limpo, ou o cartão volta a ser só leitura)
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
      labelledBy={labelledBy}
      noscript={false}
      primary
      actions={
        onCancel ? (
          <button type="button" className={BUTTON} onClick={onCancel}>
            Cancelar edição
          </button>
        ) : undefined
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
      <TextField
        name="quantity"
        label="Quantidade"
        autoComplete="off"
        inputMode="numeric"
        defaultValue={lot ? String(lot.quantity) : undefined}
        hint="Número inteiro de ações, sem ponto nem vírgula."
      />
      <RadioField
        name="mode"
        legend="Como você vai informar o valor?"
        hint={MODE_HINT}
        value={mode}
        options={MODES}
        onChange={(value) => setMode(value === 'total' ? 'total' : 'unit')}
        clears="value"
      />
      {/* a chave é o modo: ao trocá-lo o campo nasce de novo, vazio (ou com o custo guardado, se a edição voltar ao "valor total pago") */}
      <TextField
        key={mode}
        name="value"
        label={VALUE_LABEL[mode]}
        autoComplete="off"
        inputMode="decimal"
        defaultValue={lot && mode === 'total' ? centsToInput(lot.costCents) : undefined}
        hint={lot && mode === 'total' ? EDIT_TOTAL_HINT : VALUE_HINT[mode]}
      />
      <TextField
        name="boughtOn"
        label="Data da compra (opcional)"
        type="date"
        autoComplete="off"
        max={today}
        defaultValue={lot?.boughtOn ?? undefined}
        hint="Pode ficar em branco. Não pode ser no futuro."
      />
    </AccountForm>
  );
}

// Para onde o foco vai depois de uma ação: um seletor dentro desta árvore. O objeto é novo a cada pedido, então o mesmo destino de novo (apagar
// dois lançamentos seguidos, o aviso) também move o foco. Sem isto o foco se perderia no <body> quando o botão que o tinha desaparece.
interface Focus {
  selector: string;
}
const sel = {
  notice: '[data-notice]',
  field: (id: string) => `[data-lot="${id}"] input[name="ticker"]`,
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

export function WalletLots({ lots, today }: { lots: readonly LotView[]; today: string }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [refreshing, startTransition] = useTransition();
  const root = useRef<HTMLDivElement>(null);
  const sending = useRef(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removal, setRemoval] = useState<Removal>(IDLE);
  const [notice, setNotice] = useState('');
  // sobe a cada lançamento criado: o formulário de lançar nasce de novo, limpo, pronto para o próximo
  const [createKey, setCreateKey] = useState(0);
  const [focus, setFocus] = useState<Focus | null>(null);

  useEffect(() => {
    if (focus) root.current?.querySelector<HTMLElement>(focus.selector)?.focus();
  }, [focus]);

  // Uma ação de cada vez (docs/TELAS.md, seção 9): enquanto um pedido está no ar, ou o servidor ainda refaz a página depois dele, os outros
  // cartões não abrem edição nem pergunta. Sem isso o fim da ação fecharia o cartão que a pessoa abriu no meio do caminho (com o que ela já
  // tinha digitado) e puxaria o foco de volta. Um contador, e não um boleano: o lançar e o salvar podem estar no ar ao mesmo tempo.
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

  // O resultado de uma ação que deu certo: o servidor renderiza a página de novo e, na MESMA transição, esta tela troca o estado (o aviso, o
  // foco e o que `after` fecha ou limpa: só o que a ação mexeu, para lançar não fechar uma edição aberta noutro cartão). Se o React juntar as
  // duas, a lista nova e o aviso chegam juntos; se não juntar, o aviso chega antes e a lista logo depois. Nos dois casos o aviso diz o que
  // aconteceu por inteiro, e a lista termina igual à que a api guardou.
  function done(message: string, to: string, after: () => void) {
    startTransition(() => {
      router.refresh();
      setNotice(message);
      after();
      setFocus({ selector: to });
    });
  }
  const closeRemoval = () => {
    setRemoving(null);
    setRemoval(IDLE);
  };

  function openEdit(id: string) {
    setEditing(id);
    setRemoving(null);
    setFocus({ selector: sel.field(id) });
  }
  function cancelEdit(id: string) {
    setEditing(null);
    setFocus({ selector: sel.edit(id) });
  }
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
    if (out.ok) return done(removedMessage(lot), sel.notice, closeRemoval);
    const failure = lotFailure(out);
    // apagar o que já não existe é o que a pessoa queria: a lista só precisa de atualização
    if (failure.gone) {
      return done('Este lançamento já tinha sido apagado.', sel.notice, closeRemoval);
    }
    setRemoval({ busy: false, failure });
    setFocus({ selector: sel.problem(lot.id) });
  }

  const card = (lot: LotView): ReactNode => {
    const name = `${describeLot(lot)}, custo total ${formatBRL(lot.costCents)}`;
    if (editing === lot.id) {
      return (
        <>
          <h3 id={`editar-${lot.id}`} className="font-display text-base">
            {`Editar lançamento de ${describeLot(lot)}`}
          </h3>
          <LotForm
            lot={lot}
            today={today}
            labelledBy={`editar-${lot.id}`}
            track={track}
            onSaved={(message) => done(message, sel.edit(lot.id), () => setEditing(null))}
            onGone={(message) => done(message, sel.notice, () => setEditing(null))}
            onCancel={() => cancelEdit(lot.id)}
          />
        </>
      );
    }
    return (
      <>
        <p className="font-mono text-base font-semibold text-ink">{lot.ticker}</p>
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
            className="space-y-3 rounded-lg border border-dashed border-hairline-strong p-4"
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
              onClick={() => openEdit(lot.id)}
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
      <Section id="lancamentos" title="Lançamentos">
        {/* a região existe desde o começo, para o leitor de tela anunciar o aviso que chega depois; com texto, o foco vai a ela */}
        <p
          role="status"
          tabIndex={notice ? -1 : undefined}
          data-notice=""
          className={notice ? `max-w-prose ${CAIXA}` : 'sr-only'}
        >
          {notice}
        </p>
        {/* o formulário de lançar fica depois da lista inteira (são até 200 cartões): no celular, o atalho poupa a rolagem */}
        {lots.length > 0 ? (
          <p>
            <a href="#lancar" className={LINK}>
              Ir para o formulário de lançar
            </a>
          </p>
        ) : null}
        {lots.length === 0 ? (
          <Empty>
            Você ainda não lançou nenhuma compra. Use o formulário abaixo para anotar a primeira: o
            código da ação (como PETR4), a quantidade e quanto você pagou, por ação ou no total.
            Depois dá para editar ou apagar cada lançamento.
          </Empty>
        ) : (
          <ul className="max-w-2xl space-y-3">
            {lots.map((lot) => (
              <li key={lot.id} data-lot={lot.id} className="card space-y-4 p-4 sm:p-5">
                {card(lot)}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section id="lancar" title="Lançar uma compra">
        <p className="max-w-prose">
          Anote uma compra que você fez. Cada lançamento entra na posição da ação: o preço médio é o
          custo de todos os lançamentos dividido pela quantidade.
        </p>
        <p>
          <a href="/acoes" target="_blank" rel="noopener noreferrer" className={LINK}>
            Buscar uma ação
            <span className="sr-only"> (abre em outra aba)</span>
          </a>
        </p>
        <div className="card max-w-md p-4 sm:p-6">
          <LotForm
            key={createKey}
            today={today}
            labelledBy="lancar-titulo"
            track={track}
            onSaved={(message) => done(message, sel.notice, () => setCreateKey((key) => key + 1))}
          />
        </div>
      </Section>
    </div>
  );
}
