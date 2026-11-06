'use client';

import { useEffect } from 'react';

// O JavaScript da arte (ADR 0034), só depois do `load`, quando o navegador está à toa. Não desenha nada: o quadro 0 com a brasa (ou, no urso,
// o quadro de espera com os ladrilhos) já veio do servidor (arte.tsx). Duas tarefas:
// - `quadro0`: o quadro 0 que o servidor não mandou (o urso da 404), do arquivo pequeno `<nome>-q0.json`, em toda largura;
// - o laço: só a partir de 1024 px, sem `prefers-reduced-motion` e sem economia de dados (Save-Data). Busca o arquivo inteiro (o JSON com os
//   quadros e o sprite de todos eles) e troca o texto do quadro e a posição do sprite a cada passo, a 12 quadros por segundo; para fora da tela
//   e com a aba oculta.
// No celular, sem `quadro0`, nada além de conferir a largura: nenhum pedido.
type Quadros = { fps: number; rows: number; frames: string[] };

export function ArteViva({ nome, quadro0 = false }: { nome: string; quadro0?: boolean }) {
  useEffect(() => {
    const host = document.querySelector<HTMLElement>(`[data-arte="${nome}"]`);
    const pre = host?.querySelector('pre');
    const tiles = host?.querySelector<HTMLElement>('.arte-ladrilho');
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean } })
      .connection;
    const loop =
      matchMedia('(min-width: 1024px) and (prefers-reduced-motion: no-preference)').matches &&
      !connection?.saveData;
    if (!host || !pre || !tiles || (!loop && !quadro0)) return;

    let stopped = false;
    let frame = 0;
    let visible = true;
    const watcher = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    watcher.observe(host);

    const fill = async () => {
      const art = (await (await fetch(`/ascii/arte/${nome}-q0.json`)).json()) as Quadros;
      if (!stopped && art.frames[0]) pre.textContent = art.frames[0];
    };

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

    // a arte é enfeite: se uma busca falhar, fica o que já está na tela (o quadro 0, ou o quadro de espera). Quem saiu da página (uma
    // navegação suave) entre o `load` e o ócio do navegador não baixa nada para uma página que não está mais na tela.
    const begin = () => {
      const run = () => {
        if (stopped) return;
        void (async () => {
          if (quadro0) await fill().catch(() => undefined);
          if (loop && !stopped) await play();
        })().catch(() => undefined);
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
  }, [nome, quadro0]);
  return null;
}
