import type { ReactNode } from 'react';

// Uma seção da conta e do painel da arena num cartão (docs/redesign-rallies/plano.md, f.4): o canvas com o fio e raio 8, o título na Geist de 18
// e o conteúdo. A região tem o nome do título, como a `Section` (ui.tsx): é como o leitor de tela e o e2e a encontram. `perigo` troca o fio pelo
// vermelho do erro (a exclusão da conta).
export function SecaoCartao({
  id,
  title,
  perigo = false,
  children,
}: {
  id: string;
  title: string;
  perigo?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-titulo`}
      className={`card space-y-4 p-4 sm:p-6${perigo ? ' border-semantic-error/60' : ''}`}
    >
      <h2 id={`${id}-titulo`} className="font-display text-18">
        {title}
      </h2>
      {children}
    </section>
  );
}
