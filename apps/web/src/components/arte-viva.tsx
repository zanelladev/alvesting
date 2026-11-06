'use client';

import { useEffect } from 'react';

// O laço da arte (ADR 0034), o único JavaScript dela: só a partir de 1024 px, sem `prefers-reduced-motion` e sem economia de dados (Save-Data),
// e só depois do `load`, quando o navegador está à toa. Aí busca o arquivo inteiro (o JSON com os quadros e o sprite de todos eles) e troca o
// texto do quadro e a posição do sprite a cada passo, a 12 quadros por segundo; para fora da tela e com a aba oculta. Não desenha nada: o
// quadro 0, com a brasa, já veio do servidor (arte.tsx). No celular, nada além de conferir a largura: nenhum pedido.
type Quadros = { fps: number; rows: number; frames: string[] };

export function ArteViva({ nome }: { nome: string }) {
  useEffect(() => {
    const host = document.querySelector<HTMLElement>(`[data-arte="${nome}"]`);
    const pre = host?.querySelector('pre');
    const tiles = host?.querySelector<HTMLElement>('.arte-ladrilho');
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } })
      .connection;
    if (
      !host ||
      !pre ||
      !tiles ||
      !matchMedia('(min-width: 1024px) and (prefers-reduced-motion: no-preference)').matches ||
      connection?.saveData
    ) {
      return;
    }

    let stopped = false;
    let frame = 0;
    let visible = true;
    const watcher = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    watcher.observe(host);

    const play = async () => {
      const sprite = `/ascii/arte/${nome}.png`;
      const image = new Image();
      image.src = sprite;
      const [art] = await Promise.all([
        fetch(`/ascii/arte/${nome}.json`).then((r) => r.json() as Promise<Quadros>),
        image.decode(),
      ]);
      if (stopped || art.frames.length < 2) return;
      // o sprite inteiro já decodificado: a troca não pisca, e o quadro 0 dele é o mesmo do sprite pequeno
      host.style.setProperty('--sprite', `url(${sprite})`);
      host.style.setProperty('--quadros', String(art.frames.length));
      const start = performance.now();
      let shown = 0;
      const tick = (now: number) => {
        frame = requestAnimationFrame(tick);
        if (!visible || document.hidden) return;
        const i = Math.floor(((now - start) / 1000) * art.fps) % art.frames.length;
        if (i === shown) return;
        shown = i;
        pre.textContent = art.frames[i]!;
        const y = `${-i * art.rows}em`;
        pre.style.backgroundPositionY = y;
        tiles.style.backgroundPositionY = y;
      };
      frame = requestAnimationFrame(tick);
    };

    // o laço é enfeite: se a busca falhar, a arte fica no quadro 0, que já está na tela. Quem saiu da página (uma navegação suave) entre o
    // `load` e o ócio do navegador não baixa o arquivo inteiro para uma página que não está mais na tela.
    const begin = () => {
      const run = () => {
        if (!stopped) void play().catch(() => undefined);
      };
      if ('requestIdleCallback' in window) requestIdleCallback(run);
      else setTimeout(run, 200);
    };
    if (document.readyState === 'complete') begin();
    else window.addEventListener('load', begin, { once: true });

    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      watcher.disconnect();
      window.removeEventListener('load', begin);
    };
  }, [nome]);
  return null;
}
