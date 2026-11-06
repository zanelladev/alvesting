# Checklist antes de entregar

Rode linha por linha. Corrija o que falhar e rode de novo.

## Casca e tipo

- [ ] Um `h1` por tela; nada de sobretítulo; o fato da página embaixo do título.
- [ ] Nenhuma caixa-alta e nenhum travessão no texto visível; nenhum `uppercase` nem `capitalize` no que o e2e lê com `innerText`.
- [ ] Uma pílula branca (`btn-primary`) por superfície; o resto `btn`.
- [ ] Navegar é link (`NavLink`); `<button>` só para ação.
- [ ] O que é peso 500 vai com `font-display` (a Geist 500 é a única fonte baixada; sem negrito falso).
- [ ] Nenhum componente de cliente nem `motion` na casca; nenhuma dependência npm nova.

## Cor e dado

- [ ] Âmbar só no acento, na marca e na brasa: nunca em CTA nem em dado.
- [ ] Todo valor com direção leva glifo `▲ ▼ ■` e sinal; a cor nunca sozinha.
- [ ] `muted-soft` nunca em texto; `muted` não vai sobre `surface-strong` em texto pequeno.
- [ ] Nenhum número sintético na tela: o ASCII de dado sai do valor da api.
- [ ] Gráfico pequeno em blocos é o `AsciiChart` (`areaChart`), decorativo, com o número em texto ao lado.
- [ ] Moeda com o espaço que não quebra (`formatBRL`).

## Moldura e alvos

- [ ] Nenhuma divisória feita à mão: a linha vem do `PageHead` ou do `Section`, ou de uma `Rule` filha de quem ocupa a coluna inteira.
- [ ] Nada dentro da faixa vazia de 48 px sob o cabeçalho da página.
- [ ] Faixa de largura total (a de números, o hero) sai da coluna por margem negativa e encosta nas linhas.
- [ ] Em 1440 e numa largura ímpar (1441), o losango centrado sobre as duas linhas; abaixo de 1202 px, sem laterais nem losango.
- [ ] Todo link e botão com a caixa de 44 × 44 em toda largura; a pílula menor fica por dentro (`pill`, `chip`, `capsule-item`, `acao`).
- [ ] Spec que usa link do cabeçalho abre o menu antes (`e2e/menu.ts`): abaixo de 1024 px ele é uma folha `popover`.

## ASCII e arte

- [ ] Peça de dado em caractere usa `ascii-block` (a mono do sistema); arte só com glifos latinos.
- [ ] ASCII decorativo com `aria-hidden` e o mesmo dado em texto (`sr-only` ou ao lado).
- [ ] A arte tem linha em `docs/DEPENDENCIAS.md`, "Artes", com a procedência; nada de terceiros "só para desenvolvimento".
- [ ] O quadro 0 vem no HTML (confira com o JavaScript desligado); o laço só a partir de 1024 px, sem movimento reduzido e sem Save-Data.
- [ ] A arte nunca atrás de texto legível nem encostada em número, em 360, 390, 1024, 1280 e 1440 px; as bordas dissolvem.

## Verificação

- [ ] `pnpm --filter @alvesting/web typecheck`, `lint` e `test` verdes.
- [ ] `pnpm build` e `pnpm test:e2e` verdes em pixel-7, iphone-15 e desktop (sem rolagem horizontal em 360 px, alvos de 44 px, axe sem
      violação, nenhum erro no console).
- [ ] Mudou a home: `pnpm lighthouse` com LCP até 2,5 s (meta interna de 2,45 s), CLS até 0,1 e TBT até 200 ms, e o elemento do LCP anotado.
- [ ] No navegador, em 1440 × 900 e 390 × 844: o menu do celular abre e fecha (Esc), a fita rola, e com movimento reduzido nada anda.
