import type { ReactNode } from 'react';

// O texto dos termos de uso e da política de privacidade (etapa 11), como a api o serve: Markdown simples, de arquivos do repositório
// (apps/api/src/modules/account/legal). Só o que os textos usam: `## ` e `### ` (subtítulos), `> ` (a citação do rascunho), `- ` (lista),
// parágrafos e `**negrito**`. Vira elementos do React, nunca HTML cru: o texto entra como texto, e um link em Markdown ou uma tag HTML
// ficam escritos como estão. Não é um interpretador de Markdown, de propósito: se um texto passar a usar tabela ou link, o teste do
// e2e (que confere que cada linha do texto está na tela) aponta, e a escolha é ampliar isto ou trocar a marcação do texto.
//
// O título (`# `), a versão (`Versão: `) e a vigência (`Vigência: `) a página mostra à parte, acima do texto, com o SHA-256: aqui não
// se repetem. O SHA-256 que a api guarda no aceite é do texto inteiro, com essas três linhas.
const HEADER_LINE = /^(?:# .*|Versão: .*|Vigência: .*)$/;

// **negrito** em partes: o que está entre dois pares de asteriscos. Asteriscos sem par ficam como texto.
function inline(line: string): ReactNode[] {
  return line
    .split(/\*\*(.+?)\*\*/g)
    .map((part, index) => (index % 2 === 1 ? <strong key={index}>{part}</strong> : part));
}

type Block =
  { kind: 'h2' | 'h3' | 'p' | 'quote'; text: string } | { kind: 'list'; items: string[] };

function blocks(text: string): Block[] {
  const out: Block[] = [];
  // o parágrafo e a citação continuam enquanto as linhas seguem coladas; a linha em branco fecha
  const state: { open: { kind: 'p' | 'quote'; lines: string[] } | null } = { open: null };
  const close = () => {
    if (state.open) out.push({ kind: state.open.kind, text: state.open.lines.join(' ') });
    state.open = null;
  };
  const continueOr = (kind: 'p' | 'quote', line: string) => {
    if (state.open?.kind !== kind) {
      close();
      state.open = { kind, lines: [] };
    }
    state.open.lines.push(line);
  };

  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    if (HEADER_LINE.test(line) || line.trim() === '') {
      close();
    } else if (line.startsWith('### ')) {
      close();
      out.push({ kind: 'h3', text: line.slice(4) });
    } else if (line.startsWith('## ')) {
      close();
      out.push({ kind: 'h2', text: line.slice(3) });
    } else if (line.startsWith('- ')) {
      close();
      const last = out[out.length - 1];
      if (last?.kind === 'list') last.items.push(line.slice(2));
      else out.push({ kind: 'list', items: [line.slice(2)] });
    } else if (line.startsWith('> ')) {
      continueOr('quote', line.slice(2));
    } else {
      continueOr('p', line);
    }
  }
  close();
  return out;
}

// A âncora de cada seção (o h2) e o sumário "Nesta página" que a usa: o id sai do texto do subtítulo (sem acento, em minúsculas, o que não é
// letra nem número vira hífen), com o prefixo `secao-` (um id que começa por número não serve num seletor), e o repetido ganha um número. O texto
// legal não muda: só o h2 ganha o id.
const semNegrito = (line: string) => line.replace(/\*\*(.+?)\*\*/g, '$1');
const slug = (line: string) =>
  semNegrito(line)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export interface ItemDoSumario {
  id: string;
  titulo: string;
}

function ancoras(parts: Block[]): ItemDoSumario[] {
  const vistos = new Map<string, number>();
  return parts.flatMap((block) => {
    if (block.kind !== 'h2') return [];
    const base = `secao-${slug(block.text)}`;
    const vezes = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, vezes);
    return [{ id: vezes === 1 ? base : `${base}-${vezes}`, titulo: semNegrito(block.text) }];
  });
}

export const sumarioDoTexto = (text: string): ItemDoSumario[] => ancoras(blocks(text));

// O sumário "Nesta página", preso à direita a partir de 1280 px, onde a coluna de leitura deixa o lado direito vazio (os textos legais e o Como
// funciona): só HTML e CSS, um link por seção. Abaixo disso a página é uma coluna só, e ele some (o texto continua na ordem).
// A `nav` ocupa a altura da coluna (o item da grade, ou a caixa que `className` posiciona) e o miolo fica preso abaixo do cabeçalho do site.
export function Sumario({
  itens,
  className,
}: {
  itens: readonly ItemDoSumario[];
  className?: string;
}) {
  if (itens.length === 0) return null;
  return (
    <nav
      aria-label="Nesta página"
      className={`sumario hidden xl:block${className ? ` ${className}` : ''}`}
    >
      <div className="sticky top-24">
        <p className="pb-2 text-13 font-medium text-ink">Nesta página</p>
        <ol>
          {itens.map((item) => (
            <li key={item.id}>
              <a href={`#${item.id}`}>{item.titulo}</a>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}

export function LegalText({ text }: { text: string }) {
  const parts = blocks(text);
  if (parts.length === 0) return null;
  const ids = ancoras(parts).map((item) => item.id);
  let secao = 0;
  return (
    // a prosa até 65 caracteres por linha (max-w-prose), 16/1,6, com os subtítulos em 22 e 18 (ADR 0035)
    <div className="max-w-prose space-y-4 text-base leading-[1.6] break-words">
      {parts.map((block, index) => {
        switch (block.kind) {
          case 'h2':
            return (
              <h2 key={index} id={ids[secao++]} className="scroll-mt-4 pt-6 font-display text-22">
                {inline(block.text)}
              </h2>
            );
          case 'h3':
            return (
              <h3 key={index} className="pt-2 font-display text-18">
                {inline(block.text)}
              </h3>
            );
          case 'quote':
            // o aviso do rascunho é o `[!]` sem caixa, como o aviso de página (ui.tsx, `Aviso`): a honestidade é obrigatória, o peso não
            return (
              <blockquote key={index} className="flex gap-2.5 text-body">
                <span aria-hidden="true" className="shrink-0 font-medium text-muted">
                  [!]
                </span>
                <span className="min-w-0">{inline(block.text)}</span>
              </blockquote>
            );
          case 'list':
            return (
              <ul key={index} className="list-disc space-y-2 pl-6">
                {block.items.map((item, at) => (
                  <li key={at}>{inline(item)}</li>
                ))}
              </ul>
            );
          default:
            return <p key={index}>{inline(block.text)}</p>;
        }
      })}
    </div>
  );
}
