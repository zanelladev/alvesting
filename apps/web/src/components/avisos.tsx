'use client';

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import {
  AnimatedToastStack,
  useAnimatedToastStack,
  type ToastStatus,
} from './beui/animated-toast-stack';

// Os avisos de página (docs/TELAS.md; o Animated Toast Stack da beUI, ADR 0037): a confirmação do que acabou de acontecer (o lançamento da carteira,
// a exportação e o aceite da conta, as ações do painel), numa pilha só por página. A página põe o provedor (`Avisos`) em volta do que avisa e a
// pilha (`PilhaDeAvisos`) onde ela deve ficar no documento: dentro do `main`, na ordem do Tab (o CSS a fixa no pé da tela). Quem avisa chama
// `useAvisar()`; o aviso recebe o foco só quando a tela o pede (o botão que enviou sumiu), pelo id que `avisar` devolve.

const PENDENTE = 'alvesting.aviso';

// O aviso que precisa sobreviver a uma recarga (o aceite dos termos recarrega a conta, e o fluxo dele não muda): fica no `sessionStorage` e sai
// na próxima carga, uma vez só. O navegador que recusa o armazenamento só perde o aviso; a tela mostra o resultado do mesmo jeito.
export function guardarAvisoPendente(
  texto: string,
  storage: Pick<Storage, 'setItem'> = window.sessionStorage,
): void {
  try {
    storage.setItem(PENDENTE, texto);
  } catch {
    // sem armazenamento, sem aviso: a página recarregada já mostra o que mudou
  }
}

export function lerAvisoPendente(
  storage: Pick<Storage, 'getItem' | 'removeItem'> = window.sessionStorage,
): string | null {
  try {
    const texto = storage.getItem(PENDENTE);
    if (texto !== null) storage.removeItem(PENDENTE);
    return texto;
  } catch {
    return null;
  }
}

type Pilha = ReturnType<typeof useAnimatedToastStack>;
const Contexto = createContext<{ pilha: Pilha; foco?: string } | null>(null);

// `foco`: o seletor do lugar para onde o foco vai quando a pessoa fecha pelo teclado o aviso em que ele estava (o título da seção, por exemplo)
export function Avisos({ children, foco }: { children: ReactNode; foco?: string }) {
  const pilha = useAnimatedToastStack();
  const { showToast } = pilha;
  useEffect(() => {
    const texto = lerAvisoPendente();
    if (texto) showToast({ title: texto });
  }, [showToast]);
  const valor = useMemo(() => ({ pilha, foco }), [pilha, foco]);
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>;
}

// Devolve o id do aviso (`[data-aviso="<id>"]`), para quem precisa levar o foco a ele.
export function useAvisar(): (texto: string, status?: ToastStatus) => string {
  const contexto = useContext(Contexto);
  const showToast = contexto?.pilha.showToast;
  return useMemo(
    () => (texto: string, status?: ToastStatus) => showToast?.({ title: texto, status }) ?? '',
    [showToast],
  );
}

export function PilhaDeAvisos() {
  const contexto = useContext(Contexto);
  if (!contexto) return null;
  const { pilha, foco } = contexto;
  return (
    <AnimatedToastStack
      toasts={pilha.toasts}
      onDismiss={pilha.dismissToast}
      onHold={pilha.hold}
      onFocusLeave={() => {
        const alvo = foco ? document.querySelector<HTMLElement>(foco) : null;
        if (!alvo) return;
        if (alvo.tabIndex < 0 && !alvo.hasAttribute('tabindex')) alvo.tabIndex = -1;
        alvo.focus();
      }}
    />
  );
}
