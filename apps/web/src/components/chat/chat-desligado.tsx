import { Icone, IconeArena, IconeCarteira, IconeChat } from '../icones';
import { NavLink } from '../ui';

// O chat desligado (docs/redesign-rallies/plano.md, f.2 e f.3): o desenho do Chat do Rallies, pronto e sem nenhuma chamada. O chat é a etapa 13
// e só começa depois do aval do orientador (CLAUDE.md). Componentes de servidor: sem `'use client'`, sem `fetch`, sem `<form>`, sem leitura da api
// nem da sessão. Os controles moram num `<fieldset disabled>`: a caixa não aceita texto e nenhum botão responde, então nada do que a pessoa digite
// ou toque sai do navegador (o chat.spec.ts confere). O `/chat` usa a caixa e as sugestões; a carteira, o painel "Perguntar", que leva ao /chat.

export const AVISO_DO_CHAT =
  'O chat está desligado: ele entra na etapa 13, depois do aval do orientador. Nada aqui chama um modelo nem dá conselho.';

// Os ícones do chat: o `Icone` da casca (components/icones.tsx), em 16 e 18 px. Decorativos: o nome vem ao lado, em texto, ou no aria-label
// do botão.
const IconeAnexar = () => (
  <Icone size={18}>
    <path d="M10 4.5v11M4.5 10h11" />
  </Icone>
);
const IconeEnviar = () => (
  <Icone size={18}>
    <path d="M10 15.5v-11M5.5 9 10 4.5 14.5 9" />
  </Icone>
);
// a seta curva das perguntas do painel (o "↳" do Rallies)
const IconeSetaCurva = () => (
  <Icone size={16}>
    <path d="M5 4.5v5a3 3 0 0 0 3 3h7M12 9.5l3 3-3 3" />
  </Icone>
);
const IconeConversas = () => (
  <Icone size={16}>
    <circle cx="10" cy="10" r="6.75" />
    <path d="M10 6.5V10l2.5 2" />
  </Icone>
);
const IconeResumo = () => (
  <Icone size={16}>
    <path d="M4 5.5h12M4 10h12M4 14.5h7" />
  </Icone>
);
const IconeDecisao = () => (
  <Icone size={16}>
    <path d="M7.75 14.25h4.5M8.25 16.75h3.5M10 3.25a4.75 4.75 0 0 0-2.9 8.5c.55.45.9 1.1.9 1.8v.7h4v-.7c0-.7.35-1.35.9-1.8a4.75 4.75 0 0 0-2.9-8.5z" />
  </Icone>
);
const SUGESTOES = [
  ['Resumir o pregão', <IconeResumo key="resumo" />],
  ['Comparar os modelos', <IconeArena key="comparar" size={16} />],
  ['Explicar uma decisão', <IconeDecisao key="decisao" />],
  ['Minha carteira', <IconeCarteira key="carteira" size={16} />],
] as const;

// A tela do chat: as abas em pílula ("Perguntar", a escolhida, e "Conversas", o histórico que a etapa 13 traz), a caixa grande com o "+" e o
// enviar redondos (32 px visíveis na caixa de 44) e as sugestões em chips. Tudo dentro do fieldset desativado.
export function ChatDesligado() {
  return (
    <fieldset disabled className="chat-desligado w-full min-w-0 space-y-4">
      <legend className="sr-only">O chat, desligado</legend>
      <div className="flex justify-center gap-1">
        <button type="button" aria-pressed="true" className="chip cursor-not-allowed font-medium">
          <IconeChat size={16} />
          Perguntar
        </button>
        <button
          type="button"
          aria-pressed="false"
          className="chip cursor-not-allowed font-medium text-muted before:bg-transparent"
        >
          <IconeConversas />
          Conversas
        </button>
      </div>
      <div className="rounded-3xl border border-hairline bg-surface-card px-3 pt-3 pb-1.5 text-left">
        <label htmlFor="chat-pergunta" className="sr-only">
          Pergunta para o chat
        </label>
        <textarea
          id="chat-pergunta"
          rows={3}
          placeholder="O chat ainda não está ligado."
          className="block w-full resize-none bg-transparent px-2 py-1 text-base text-ink placeholder:text-muted disabled:cursor-not-allowed"
        />
        <div className="flex items-center justify-between">
          <button
            type="button"
            aria-label="Anexar"
            className="grid size-11 cursor-not-allowed place-items-center text-muted"
          >
            <span className="grid size-8 place-items-center rounded-full border border-hairline-strong">
              <IconeAnexar />
            </span>
          </button>
          <button
            type="button"
            aria-label="Enviar"
            className="grid size-11 cursor-not-allowed place-items-center text-muted"
          >
            <span className="grid size-8 place-items-center rounded-full bg-surface-strong">
              <IconeEnviar />
            </span>
          </button>
        </div>
      </div>
      <ul aria-label="Sugestões" className="flex flex-wrap justify-center gap-x-1">
        {SUGESTOES.map(([label, icone]) => (
          <li key={label}>
            <button type="button" className="pill cursor-not-allowed text-muted">
              {icone}
              {label}
            </button>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

// As perguntas do painel "Perguntar" da carteira (o "Go deeper" do Today): exemplos do que o chat vai responder, em texto. Não são controles: a
// tela da carteira não tem botão que não faça nada (o carteira-layout.spec.ts espera que todo botão do `main` ligue depois da hidratação).
const PERGUNTAS_DA_CARTEIRA = [
  'Como as minhas ações foram no último pregão?',
  'O que os modelos fizeram com as ações da minha carteira?',
  'Que notícias saíram sobre as minhas ações?',
] as const;

// O painel "Perguntar" da carteira (plano, f.3): a partir de 1280 px a terceira coluna, com as perguntas e a caixa pequena; abaixo, um cartão
// com o título, a frase e o link no fim da tela. A caixa é só o desenho (aria-hidden): quem quer perguntar segue o link para o /chat, que diz
// que o chat está desligado.
export function PainelPerguntar() {
  return (
    <section
      id="perguntar"
      aria-labelledby="perguntar-titulo"
      className="card min-w-0 space-y-4 p-5"
    >
      <h2 id="perguntar-titulo" className="font-display text-18">
        Perguntar
      </h2>
      <p className="muted">
        O chat sobre a sua carteira ainda está desligado: ele entra na etapa 13, depois do aval do
        orientador.
      </p>
      <div className="hidden space-y-3 xl:block">
        <h3 className="text-13 font-medium text-muted">Vá mais fundo</h3>
        <ul className="space-y-2.5">
          {PERGUNTAS_DA_CARTEIRA.map((pergunta) => (
            <li key={pergunta} className="flex gap-2 text-sm text-muted">
              <span className="pt-0.5">
                <IconeSetaCurva />
              </span>
              <span className="min-w-0">{pergunta}</span>
            </li>
          ))}
        </ul>
        <div
          aria-hidden="true"
          className="flex items-center justify-between gap-2 rounded-3xl border border-hairline bg-surface-card py-1.5 pr-1.5 pl-4 text-sm text-muted"
        >
          Chat desligado
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-surface-strong">
            <IconeEnviar />
          </span>
        </div>
      </div>
      <NavLink href="/chat" className="btn">
        Abrir o chat
      </NavLink>
    </section>
  );
}
