---
name: ascii-ui
description: Desde 05/11/2026, só a arte ASCII da Alvesting (a escadaria e o urso); as telas seguem o design do Rallies AI (docs/TELAS.md, seção 10; ADR 0035). O estilo da onda anterior (ADR 0034) — o canvas preto da v1 com a interface nas medidas do Arc (uiarc.dev), o ASCII onde há dado e a arte ASCII "com brasa" (grade de glifos cinza, topo em ladrilho vazado, foco aceso em âmbar) como imagem, na gramática do WAERK (@basit_designs). Use ao pôr, gerar ou ajustar uma arte ASCII numa tela (a escadaria, o urso) ou ao revisar a arte; para desenhar ou revisar uma tela, o docs/TELAS.md, seção 10.
when_to_use: "estilo ascii", "ascii-ui", "design da v1", "como o WAERK", "arte ascii com cor", "brasa", "hero com arte ascii", "medidas do Arc", "uiarc", "refazer a tela nesse estilo", arte para hero/404/vazio, revisar tela contra o docs/TELAS.md
---

# ascii-ui

> **Desde 05/11/2026 as telas seguem o design do Rallies AI, nos dois temas** (`docs/TELAS.md`, seção 10; ADR 0035;
> `docs/redesign-rallies/plano.md`): a casca, os tokens, as peças e o tipo descritos abaixo são os da onda anterior e valem só como
> história. **Esta skill vale para a arte ASCII** (a escadaria do hero da landing e da tela dividida, e o urso da 404): o arquivo
> pré-renderizado com brasa, a moldura escura em que ela mora nos dois temas, o quadro 0 e o laço (`references/arte.md` e a seção "ASCII e
> arte" do checklist).

O sistema visual da v1 (o worktree `feat-redesign`, commit `cddd320`) com o código da v2. Três camadas, cada uma com dono:

| Camada        | Onde                                                                                                            | O que é                                                                                                                                                                    |
| ------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Interface** | `apps/web/src/app/globals.css` (os tokens no `@theme`, as classes no `@layer components`) e `components/ui.tsx` | cabeçalho com a cápsula, pílula branca, cartões de borda, tabela, faixa de números, etiqueta, filtro, vazio, alerta, rodapé: Server Components com CSS, nas medidas do Arc |
| **Dado**      | a fita (`components/fita.tsx`; o texto e o glifo em `src/lib/fita.ts`)                                          | o ASCII que carrega valor real, sempre decorativo e com o mesmo dado em texto ao lado                                                                                      |
| **Imagem**    | `components/arte.tsx` (servidor) e `components/arte-viva.tsx` (cliente, o laço)                                 | a peça com brasa: arquivo pré-renderizado, o navegador só troca o quadro                                                                                                   |

A fonte de verdade das regras é o `docs/TELAS.md`, seção 10 ("Sistema visual (ascii-ui)"), e a dos valores, o `globals.css`. A decisão e
o que ficou de fora da v1 estão no ADR 0034; as medidas e os porquês, no plano do porte (`docs/redesign-ascii/plano.md`). Esta skill é o
modo de usar.

## Fluxo

```
Tarefa ascii-ui:
- [ ] 1. Motivo: uma linha em termos do produto para cada peça de arte (se não convence, sem arte)
- [ ] 2. Peça: para cada região, a classe ou o componente que já existe (globals.css, ui.tsx); ASCII só onde há dado
- [ ] 3. Compor: PageHead e Section (já trazem a linha da moldura), cartões de borda, uma pílula branca por superfície; o hero sai da coluna por margem negativa
- [ ] 4. Arte (se houver): arquivo com procedência registrada no docs/DEPENDENCIAS.md, quadro 0 no HTML, laço só a partir de 1024 px (references/arte.md)
- [ ] 5. Revisar: references/checklist.md, depois typecheck, unidade, o e2e da tela nos três projetos e, se mudou a home, o Lighthouse
```

## As decisões que valem sempre

**O código não muda de natureza.** Server Components; nada de `motion`, `lucide-react`, Radix, `shadcn add` nem componente de cliente na
casca; nenhuma dependência npm nova sem pergunta. O Arc é referência de medida (MIT), não código copiado.

**Cor.** Canvas `#000`. A cor é escassa e cada uma tem um papel só:

- **Âmbar** `#ffb000` = o acento (filtro escolhido, foco do teclado), a marca e a brasa da arte. Nunca CTA, nunca dado.
- **Verde e vermelho** = polaridade de dado, sempre com glifo `▲ ▼ ■` e sinal.
- **Branco** = a pílula do CTA (`btn-primary`), uma por superfície.
- Não existe cor de aviso: aviso é `[!]` em cinza. Nenhum logo de laboratório ao lado dos modelos (o nome e a etiqueta "simulado" bastam).

**Tipo.** Geist 500 no que é 500 (`font-display`), a fonte do sistema no texto (`font-sans`; a Inter saiu pelo LCP da home), a mono do sistema no ticker, no hash e no ASCII. Fonte nova baixada só medindo o Lighthouse antes e depois. Sem sobretítulo,
sem caixa-alta, sem travessão no texto visível, e nada de `uppercase` ou `capitalize` no que o e2e lê com `innerText`.

**Alvo de 44 px.** Todo link e todo botão tem a caixa de 44 × 44; a pílula visível menor (32 ou 36 px) é o `::before`, por dentro
(`pill`, `chip`, `capsule-item`, `acao`).

**Composição do hero** (a gramática do WAERK, references/waerk.md):

1. a seção sai da coluna do `main` (margem negativa, como a `Rule`), com `min-height: max(656px, 100svh − 64px)`;
2. o texto à esquerda, na calha da coluna, com o título de até 56 px;
3. a arte ancorada na base, sangrando à direita e embaixo, terminando acima da fileira do pé; **nunca atrás de texto**: no hero ela anda
   para a direita (`--deslocar`) e, abaixo de 1024 px, vai para o palco sob os botões (`--linhas`);
4. no pé, a fileira de prova: a legenda com o crédito das cotações e a fita com máscara nas pontas;
5. o resto da página entra depois: a faixa de números entre duas linhas da moldura, e as seções na coluna.

**Moldura.** Laterais de 1 px na coluna de 1200 a partir de 1202 px, linha de ponta a ponta entre as seções, losango de 11 px só onde a
linha cruza uma lateral, faixa vazia de 48 px sob o cabeçalho da página. A linha é a `Rule` (`ui.tsx`), que o `PageHead` e o `Section` já
trazem: tela nova não desenha divisória à mão. Toda linha é borda e nenhuma anima.

**Movimento.** Nenhuma entrada animada. Arte a 12 quadros por segundo, só a partir de 1024 px. Espera = o `DotSpinner` 3 × 3 ao lado do
verbo. Spinner circular é proibido. Movimento reduzido: tudo parado no quadro de partida.

**Dado nunca sintético** numa tela de verdade: o ASCII de dado sai do valor da api.

## Onde mora cada coisa

| O quê                                                                                          | Arquivo                                                                                                                |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Tokens e classes                                                                               | `apps/web/src/app/globals.css`                                                                                         |
| Fontes, a moldura (`data-moldura`) e a linha antes do rodapé                                   | `apps/web/src/app/layout.tsx`                                                                                          |
| Cabeçalho (a marca, a `nav` com a cápsula e a folha `popover`) e rodapé                        | `apps/web/src/components/site-chrome.tsx`                                                                              |
| Peças comuns (`PageHead`, `Section`, `Facts`, `Strip`, `Empty`, `SimulatedTag`, `TableScroll`) | `apps/web/src/components/ui.tsx`                                                                                       |
| O hero, a arte, o laço e a fita                                                                | `components/hero.tsx`, `arte.tsx`, `arte-viva.tsx`, `fita.tsx`; o texto da fita em `src/lib/fita.ts`                   |
| Os arquivos da arte                                                                            | `apps/web/public/ascii/arte/` (o arquivo inteiro e o sprite do quadro 0) e `apps/web/src/arte/` (o quadro 0 importado) |
| A procedência de cada arte                                                                     | `docs/DEPENDENCIAS.md`, "Artes"; o ADR 0034                                                                            |
| O ajudante do menu nos testes                                                                  | `apps/web/e2e/menu.ts`                                                                                                 |

## Comandos

```bash
pnpm --filter @alvesting/web typecheck && pnpm --filter @alvesting/web test
pnpm build && pnpm test:e2e -- --workers=3   # os três projetos: pixel-7, iphone-15 e desktop
pnpm lighthouse                              # quando mudar a home: LCP, CLS e TBT têm meta
```

## Referências

| Arquivo                                            | Leia quando                                                                              |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [references/waerk.md](references/waerk.md)         | for decidir composição, proporção da grade ou cor da brasa: a ficha medida da referência |
| [references/arte.md](references/arte.md)           | for pôr, gerar ou ajustar uma peça de arte com brasa                                     |
| [references/checklist.md](references/checklist.md) | antes de entregar. Sempre                                                                |
