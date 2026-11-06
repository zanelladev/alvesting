import type { ReactNode } from 'react';
import { Arte } from './arte';
import { Marca } from './icones';
import { Rodape } from './rodape';
import { NavLink } from './ui';

// A tela dividida de entrar e criar conta (docs/redesign-rallies/plano.md, f.6; o desenho do cadastro do Rallies). À esquerda, a marca no canto
// e a pílula da outra tela, o formulário numa coluna de até 384 px e, no pé, o aviso fixo e as atribuições; à direita, a partir de 1024 px, a
// moldura escura com a escadaria no quadro 0, sem o laço (o arquivo inteiro só toca na landing), presa na altura da tela enquanto o formulário
// rola. No celular, só o formulário. Componente de servidor, sem JavaScript, como as duas cascas.
// A pílula troca com a tela ("Criar conta" na de entrar, "Entrar" nas outras), e o layout não sabe o caminho: por isso são dois grupos de rota,
// cada um com o seu layout ((entrar) e (auth)), como as áreas do app. Sem `aria-current`: a casca da conta não marca item (layout.spec.ts).
const PILULAS = {
  entrar: ['Entrar', '/entrar'],
  cadastro: ['Criar conta', '/cadastro'],
} as const;

export function TelaDividida({
  pilula,
  children,
}: {
  pilula: keyof typeof PILULAS;
  children: ReactNode;
}) {
  const [label, href] = PILULAS[pilula];
  return (
    <div className="flex min-w-0 flex-1 flex-col lg:grid lg:grid-cols-2">
      <div className="flex min-h-dvh min-w-0 flex-col">
        <header className="flex h-16 items-center justify-between gap-2 px-(--calha)">
          <NavLink
            href="/"
            className="inline-flex min-h-11 items-center gap-2 font-display text-base font-semibold text-ink"
          >
            <Marca />
            Alvesting
          </NavLink>
          <NavLink href={href} className="pill">
            {label}
          </NavLink>
        </header>
        <main className="mx-auto w-full max-w-md flex-1 px-(--calha) pt-8 pb-16 lg:pt-[10vh]">
          {children}
        </main>
        <Rodape className="space-y-3 border-t border-hairline px-(--calha) pt-8 pb-10 text-xs text-muted" />
      </div>
      {/* a arte no pé da metade, na largura dela: as 136 colunas da direita da grade (as 64 da esquerda são só fundo) cabem na largura, e a
          caixa tem a proporção delas (136 × 120), deslocada para a esquerda o que sobra */}
      <div className="moldura relative hidden lg:sticky lg:top-0 lg:block lg:h-dvh">
        <Arte
          nome="escadaria"
          laco={false}
          className="top-auto aspect-[136/120] [--deslocar:-23.5cqw]"
        />
      </div>
    </div>
  );
}
