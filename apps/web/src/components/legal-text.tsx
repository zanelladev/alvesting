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
  return line.split(/\*\*(.+?)\*\*/g).map((part, index) =>
    index % 2 === 1 ? (
      <strong key={index} className="font-semibold">
        {part}
      </strong>
    ) : (
      part
    ),
  );
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

export function LegalText({ text }: { text: string }) {
  const parts = blocks(text);
  if (parts.length === 0) return null;
  return (
    <div className="max-w-prose space-y-4 break-words">
      {parts.map((block, index) => {
        switch (block.kind) {
          case 'h2':
            return (
              <h2 key={index} className="pt-2 font-mono text-lg font-semibold">
                {inline(block.text)}
              </h2>
            );
          case 'h3':
            return (
              <h3 key={index} className="font-mono font-semibold">
                {inline(block.text)}
              </h3>
            );
          case 'quote':
            return (
              <blockquote key={index} className="border-2 border-ink p-3 font-mono font-semibold">
                {inline(block.text)}
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
