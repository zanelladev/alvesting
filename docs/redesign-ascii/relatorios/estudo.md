# Relatório da T0 (estudo): o plano do porte do design ascii-ui

Tarefa T0 da onda "design ASCII + elenco" (Run `run_ee238b5b17cc`, task `task_257b8d83e363`), 04/11/2026. Só leitura; o produto é
`docs/redesign-ascii/plano.md`.

## O que foi feito

1. **As capturas do antes, primeiro**, antes de a T1 mudar a home: um script de Playwright fora do repositório
   (`.data/orquestracao/estudo/capturar.mjs`, com o `@playwright/test` 1.64.1 de `apps/web`) abriu a demo em http://127.0.0.1:4300 e
   tirou home, ranking, um modelo (`/modelos/fake-hold`), um ciclo (`/ciclos/2026-12-01`), notícias, entrar e carteira (entrando com
   `demo@example.test`), em 390 × 844 e 1440 × 900, o quadro e a página inteira: 28 PNG em `docs/redesign-ascii/antes/` (4,3 MB), no
   padrão de nomes da v1 (`<tela>-<largura>.png` e `<tela>-<largura>-inteira.png`). O indicador do `next dev` foi escondido por CSS. A
   demo não foi reiniciada.
2. **A v1, lida do commit `cddd320`** (`git show HEAD:<arquivo>`; o trabalho sem commit e os `/lab/*` ficaram de fora): o `DESIGN.md`
   inteiro; a skill `ascii-ui` (`SKILL.md`, `arc.md`, `arte.md`, `checklist.md`, `waerk.md`); o `CREDITOS.md` da skill `halftone` e os
   `.json` de registro das fontes do Higgsfield; `tokens.css`, `ascii.ts`, `ascii-arte.py` (as entradas e a saída); `page.tsx`,
   `layout.tsx` e `globals.css`; `ascii-background.tsx`, `site-nav.tsx`, `brand.tsx`, `ui.tsx`, as peças ASCII e o player, o
   `dot-spinner.tsx`, o `submit-button.tsx`, o `dither-frames.tsx`, o `lib/arte.ts`; o CSS do Arc (cabeçalho, hero, botão,
   `foundation.css`) e o `HeroContent`; o `plano-telas.md` e as capturas de `qa/`.
3. **A v2**: as 21 rotas de `apps/web/src/app` e os componentes; os 24 arquivos de `apps/web/e2e` (os specs que dependem de marcação,
   texto, classe, cor e medida, linha a linha); os specs unitários de `src`; `docs/TELAS.md` (o Lighthouse e o orçamento do LCP);
   `docs/PLANO.md` (§17, item 7); `docs/DEPENDENCIAS.md` (o formato das 8 colunas); `docs/API.md` (as rotas e a rota interna);
   `packages/contracts` (`public.ts`, `cycle.ts`, `internal.ts`, `season.ts`); `table-policy.ts` e `infra/tests/check.mjs` (para a
   rota da fita); a especificação da T1, para manter o aviso e a etiqueta "simulado".
4. **Medidas sem build**: os pesos e as dimensões das artes (Python com `gzip`, só leitura); o recorte do quadro 0 em paleta (um
   script de Node com `zlib`, no scratchpad: 3.856 B para a escadaria e 4.816 B para o urso; a imagem foi conferida); as fontes que a
   v1 e a v2 já tinham baixado (`.next/static/media`) e a versão e a licença de cada uma pela tabela `name` do `.woff2`
   (`brotliDecompressSync`, `.data/orquestracao/estudo/woff2-name.mjs`); a forma dos dados do hero pela api da demo (localhost:
   `arena/current` e `equity`).
5. **A licença do Arc**: nenhum arquivo local a dizia (nem os componentes copiados, nem o `components.json`, nem os docs, nem o cache
   do npm). Perguntei ao coordenador pelo `ask`; a resposta autorizou abrir só a página de licença e o JSON de um item. Duas leituras:
   https://uiarc.dev/license (MIT para os itens free, "Copyright (c) 2026 Elia Kuratli", atualizada em 25/10/2026) e
   https://uiarc.dev/r/button.json (sem campo de licença; `meta.tier: "free"`, `dependencies: ["motion"]`).

## Aceite, com a evidência

| Critério | Evidência |
|---|---|
| `plano.md` com as 7 seções | `grep -n "^## " docs/redesign-ascii/plano.md`: Resumo, 1. Peças do sistema, 2. Artes, 3. Mapa das telas, 4. O hero, 5. Impacto nos testes, 6. Divisão do trabalho, 7. Documentação, 8. Pendências, Apêndice A |
| Cada licença com a fonte (arquivo e campo) | npm: o campo `license` do `package.json` instalado em `apps/web/node_modules` da v1 (seção 1.5), e o `LICENSE` da ascii.rest; Arc: a página de licença e o JSON do registro, com a data da consulta (1.3); fontes: os IDs 0, 5 e 14 da tabela `name` de cada `.woff2` (1.2); artes: o `CREDITOS.md` da v1 e os `.json` de registro de cada geração, com os `request_id` (seção 2) |
| As 21 rotas no mapa | a tabela da seção 3 tem 21 linhas (layout, `/`, ranking, modelo, ciclo, notícias, ações, ação, como funciona, 404, erro, entrar, cadastro, verificar e-mail, esqueci a senha, redefinir a senha, conta, carteira, admin, termos, privacidade), conferidas com `awk` |
| Cada risco com o jeito de medir | seção 5.3 (contraste, link em texto, alvo de toque, 360 px, movimento reduzido, `public/` no e2e, glifo nas células) e seção 4.6 (LCP, CLS e TBT: o Lighthouse e o audit do elemento, os bytes por `ls` e `curl`, o `PerformanceObserver`, o e2e novo) |
| Capturas do antes, 390 e 1440 de cada tela pedida | `ls docs/redesign-ascii/antes \| wc -l` = 28 (7 telas, 2 larguras, quadro e página inteira); `file` dá 390 × 844 e 1440 × 900 nos quadros; a carteira saiu logada (o endereço final foi `/carteira`, sem ir para `/entrar`) |
| O relatório e o `worker_done` com `--report-path` | este arquivo |

## O que o estudo achou e que muda o pedido

- **O orçamento do LCP é o centro do problema.** A margem da home é de uns 160 ms, "de bytes" (TELAS §5): uns 32 KB no fio. As fontes
  da v1 sozinhas somariam ~80 KB ao caminho crítico (118.200 B contra 37.776 B de hoje). O plano usa um peso por família (Geist 500 e
  Inter 400) e tira a JetBrains Mono.
- **O hero da v1 pintaria tarde**: o `AsciiBackground` é de cliente (o `<pre>` chega vazio, o JSON de 2,9 MB é lido depois de
  hidratar) e o `HeroContent` do Arc nasce com o título em opacidade 0. O plano põe o quadro 0 no HTML com um PNG de 3,9 KB em
  `preload`, sem JavaScript no celular. Uma primeira ideia (o quadro em cinza e a brasa acendendo depois do `load`) foi descartada no
  próprio estudo: a imagem que chega tarde vira candidata nova ao LCP.
- **O Arc é MIT, mas não entra como código**: todos os 23 itens que a v1 instalou importam `motion`. Nenhuma dependência npm nova.
- **A fita da v1 não tem fonte na v2**: a API pública não entrega cotação bruta, e o login da api não lê o universo (`table-policy.ts`).
  O plano propõe uma rota interna nova, com uma migration de `GRANT`, e uma fita de reserva com o BOVA11 e o macro.
- **O menu do celular**: os testes de hoje exigem os 7 links visíveis em duas linhas a 360 px. Com isso o cabeçalho do celular
  teria uns 160 px e a arte sairia da primeira dobra. O plano troca por um `popover` nativo e lista os seis specs que mudam.
- **As artes têm procedência**, mas com a ressalva que a própria v1 escreveu: conferir a versão vigente dos termos da API do
  Higgsfield antes de publicar. É pendência do Artur, não de um worker (exige rede).

## Desvios

- Rede: além do localhost, duas leituras em uiarc.dev, com a autorização do coordenador (o `ask` desta tarefa). Nada baixado, nada
  instalado.
- Sem build, e2e, Lighthouse nem `pnpm check` (restrição da tarefa): os pesos das fontes estáticas, do CSS e do documento novos são
  estimativas marcadas "a medir" no plano, com o comando de cada medida.
- Os números de linha dos specs são de 04/11/2026, com a T1 editando `arena.spec.ts`, `data.ts`, `quotes.spec.ts`,
  `public-api.spec.ts` e `components.spec.tsx`; o plano avisa para procurar pelo texto citado.

## O que ficou para depois

As decisões da seção 8 do plano (os termos do Higgsfield, a JetBrains, a rota da fita, o menu, as peças de cabeçalho, os logos e a
skill) e as tarefas (a), (b) e (c) da seção 6. Nada foi implementado.

## Arquivos tocados

- `docs/redesign-ascii/plano.md` (novo)
- `docs/redesign-ascii/relatorios/estudo.md` (novo, este)
- `docs/redesign-ascii/antes/*.png` (28 novos: `{home,ranking,modelo,ciclo,noticias,entrar,carteira}-{390,1440}.png` e os `-inteira`)
- Fora do git: `.data/orquestracao/estudo/capturar.mjs`, `q0.mjs` e `woff2-name.mjs`

Nenhum arquivo do repositório fora de `docs/redesign-ascii/` foi mudado; nada no índice do git; a v1 só foi lida.
