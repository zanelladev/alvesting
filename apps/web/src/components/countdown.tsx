'use client';

import { useEffect, useState } from 'react';
import { countdownText } from '../lib/format';

// A contagem para o próximo ciclo. O servidor escreve a frase ao renderizar (`initial`), e o relógio do navegador a refaz a cada 30 s, para
// ela não ficar parada numa aba aberta por horas. É o único trecho da arena que roda JavaScript sem o leitor ter feito nada, e é só texto.
// A resposta da api é guardada por até 300 s, então a hora (`at`) vem dela e o "agora" é sempre o do relógio de quem lê.
export function Countdown({ at, initial }: { at: string; initial: string }) {
  const [text, setText] = useState(initial);
  useEffect(() => {
    const timer = setInterval(() => setText(countdownText(at, Date.now())), 30_000);
    return () => clearInterval(timer);
  }, [at]);
  return <span data-testid="contagem">{text}</span>;
}
