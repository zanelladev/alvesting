# Relatório da tarefa T3a (telas da arena): as telas públicas no sistema visual ascii-ui

Tarefa `task_3dcec68bfe19`, onda "design ASCII + elenco" (Run `run_ee238b5b17cc`), 04/11/2026. É a dona (b), fase 2, do plano
(`docs/redesign-ascii/plano.md`). Nada foi commitado nem posto no índice: o trabalho está só no working tree (`git diff` e os `??`).

O pedido do Artur: "Eu quero o design ASCII antigo, a landing antiga tava muito bonita, principalmente Hero". A T2 trouxe a casca e a home;
esta tarefa trouxe o resto da arena para a cara da v1, com o conteúdo da v2. As referências foram as capturas da v1 (`feat-redesign`, commit
`cddd320`, `docs/redesign-2026-10/depois/` e `qa/`), as do antes (`docs/redesign-ascii/antes/`) e as da home da T2
(`docs/redesign-ascii/depois/home-*`).

## 1. O que foi feito

**As telas**, cada uma na composição da seção 3 do plano, com as peças da fundação (`PageHead`, `Section`, `Facts`, `Strip`, `card`, `tbl` em
`TableScroll`, `badge`, `chip`, `btn`, `btn-primary`, `Empty`, `ApiDown`), o h1 na Geist 500 de 36 px e a moldura da v1 (o `PageHead` fecha
com a linha, a faixa vazia de 48 px, a linha da seção seguinte):

- **`/ranking`**: o `PageHead` com a frase do que a tabela mostra e, no `meta`, a temporada e o pregão liquidado; as três seções de hoje
  (Modelos, Sorteio (controle) e Referências), cada uma com a tabela no painel; o glifo ▲ ▼ ■ antes do retorno e dos excessos; a etiqueta
  "simulado"; as notas de leitura viraram a seção "Como ler a tabela". Sem resultado: `Empty`.
- **`/modelos/[slug]`**: o `PageHead` com o nome e a etiqueta "simulado" dentro do h1, o tipo e a temporada no `meta`, o provedor e a
  estratégia (ou o ID) num `dl` em linha, na mono, e o aviso da T1 com o mesmo texto, com `[!]` em cinza (o `<strong>` "Decisões simuladas:
  o modelo ainda não está conectado."). "Resultado": os seis números que dizem como o competidor está (posição, patrimônio, retorno, percentil,
  vs igual-peso e vs CDI) na faixa dividida da home (o `Strip`, num painel), com o glifo nos que têm sinal, e os outros quatro em pares termo e
  valor. "Carteira": os pares e a tabela de posições (o resultado com o glifo). "Patrimônio": o `EquityChart` num `card`. "Decisões": os
  cartões em duas colunas a partir de 1024 px. O Sorteio e as referências: só o patrimônio, como antes.
- **`/ciclos/[data]`**: o `PageHead` "Ciclo de dd/mm/aaaa" com a situação na marca da v1 (`[ok] fechado` em verde, `[!] aberto` em cinza,
  `[x] pulado` em vermelho; o colchete diz o estado sem depender da cor) e o dia da semana; "Horários" nos pares de hoje; "Prompt e briefing":
  a versão e os dois SHA-256 inteiros, na mono, num `card` (um `dl`, nada de bloco de código; o texto do prompt nunca aparece); "Decisões":
  os cartões em duas colunas a partir de 1024 px. Pulado ou sem decisão: `Empty` com o motivo.
- **`/noticias`**: o `PageHead` com a frase de hoje, o formulário GET (o `field` e o `btn` "Filtrar"), "Limpar filtro" e, quando o ticker
  não vale, o aviso `role="alert"` junto do campo, no tom do erro de formulário da T2; a lista numa seção ("Todas as notícias" ou "Notícias
  de X"), **um cartão por notícia** (como a v1): o título como link externo de 44 px na Geist, a fonte e a hora, e os tickers como `chip`;
  "Mais antigas" em `btn`.
- **`/acoes`**: o `PageHead` e a busca (o aviso da busca inválida junto do campo); os resultados num painel, uma linha por ação, o ticker na
  mono (com largura mínima, para os nomes alinharem em coluna) e o nome. Sem busca: só o formulário; sem resultado: `Empty`.
- **`/acoes/[ticker]`**: o `PageHead` com o ticker, o nome e "Buscar outra ação"; "Cotações recentes": as velas num `card` (alta vazada em
  `ink`, baixa cheia em `body`, como a T2 deixou), com o resumo ao lado a partir de `md` (a mesma grade da legenda do patrimônio) e o crédito
  "Cotações: brapi.dev, pregão de …"; "Quem tem a ação" (só modelos, o resultado com o glifo); "Decisões dos modelos": um cartão por decisão,
  em duas colunas a partir de 1024 px (o pregão e o modelo, a ordem com o `ActionBadge`, o percentual, a confiança e a justificativa);
  "Notícias": os cartões e "Todas as notícias de X" em `btn`.
- **`/como-funciona`**: o `PageHead`; as seções de hoje em prosa de até 64 caracteres por linha (`max-w-[64ch] text-prose-md`, as mesmas
  classes do texto jurídico da T3b); os números nos pares; o hash do prompt inteiro num `card`, na mono. Sem a api: o texto sem os números.
- **404 (`not-found.tsx`)**: a gramática do hero da 404 da v1: o título no vazio, centrado, no tamanho do título do hero, o texto de hoje, a
  pílula branca "Voltar ao início" e os botões "Ver o ranking" e "Buscar uma ação", e **o urso** num bloco embaixo, nunca atrás do texto: o
  quadro 0 no HTML, com a brasa do PNG pequeno, e o laço só a partir de 1024 px, sem movimento reduzido e sem Save-Data (o mesmo `Arte` da
  escadaria). Responde 404.
- **`error.tsx`**: o `ApiDown` da T2 com "Tentar de novo" na pílula branca, como na tela do servidor (`with-api-down.tsx`).

**As peças que recebi da fase 1**: `news-list.tsx` (o cartão por notícia e os tickers em `chip`; a lista mantém o `space-y-3`, então a
linha 91 do `components.spec.tsx` continua valendo) e `charts.tsx` (só a grade do `CandlesChart`: o resumo ao lado do desenho a partir de
`md`). O `decisions.tsx` e o `countdown.tsx` ficaram como a T2 deixou (o cartão em `card` e o `ActionBadge` já estavam no desenho).

**O urso da 404**: `urso.json` e `urso.png` copiados do commit `cddd320` da v1 (`git cat-file blob`; o `git hash-object` bate com o blob:
`35f70e32…` e `16669e20…`), e `urso-q0.json` e `urso-q0.png` derivados pelo apêndice A do plano (o `frames[0]`, 85 linhas de 200 colunas,
17.084 caracteres, formatado pelo `prettier`; o recorte do sprite com o `q0.mjs`, 400 × 85, paleta de 8 bits, **4.816 B**, o número do
plano). As quatro linhas estão em `docs/DEPENDENCIAS.md`, seção "Artes", com a procedência (o vídeo `urso-colunas.mp4`, Kling 3.0, request
`0a54ba8c-…`, e a imagem `urso-colunas.jpg`, Soul 2, request `672c8016-…`, os dois de 27/09/2026, conferidos nos registros `.json` da v1) e
o comando.

**Mudanças em arquivos congelados de (a), todas com a autorização do coordenador pelo `ask`** (e nada além delas):

1. `components/arte.tsx`: o `import urso from '../arte/urso-q0.json'` e o `ARTES = { escadaria, urso }` (o tipo do nome vem de
   `keyof typeof ARTES`). O quadro da escadaria e o HTML da home não mudam (seção 2, critério 5).
2. `components/ui.tsx`: o `title` do `PageHead` passou de `string` a `ReactNode` (a página do modelo põe a etiqueta "simulado" dentro do h1,
   que o e2e da T1 confere). Nada no `PageHead` usa o título como texto (nem id, nem aria); a T3b continua chamando com `string`.
3. `components/tables.tsx` e `app/globals.css`: **o glifo de direção** do plano (seção 1.4, `Delta`). O `direction` (`up`, `down`, `flat`)
   vira o atributo `data-dir` nas células com sinal (Retorno, vs igual-peso e vs CDI do ranking; Resultado das posições; o "—" fica sem), e
   uma regra no `globals.css`, junto das da tabela, desenha o ▲ ▼ ■ por `::before`, com a declaração de reserva antes (`content: '▲ '`) e a
   com o texto alternativo vazio depois (`content: '▲ ' / ''`), e a cor (`data-up`, `data-down`, `data-flat`) só no glifo. O `textContent` e o
   `innerText` não mudam. A tabela compacta da home também ganhou o glifo (só visual). O build manteve as duas declarações
   (`content:"▲ ";content:"▲ " / ""` no CSS final).

## 2. Critérios de aceite, com a evidência

Ambiente: Node 26.13 (`nvm use`); o `pnpm check` e os e2e com o az falso no `PATH` e a guarda de rede (`NODE_OPTIONS=--import
.data/guardas/net-guard.mjs`, `NET_GUARD_LOG=.data/guardas/arena-rede.log`), o Azurite do compose e, no `check`, o banco próprio
`alvesting_arena_test` (apagado no fim). Cada execução pesada tomou a trava `.data/trava-pesada` (dono `T3a-arena`), com o disco conferido antes
e um vigia durante (os limites do coordenador: o e2e começa com 6 GB livres e para abaixo de 5; o `check`, 5,5 e 5).

1. **Capturas do depois**, da demo (http://127.0.0.1:4300), em 390 × 844 e 1440 × 900, o quadro e a página inteira, no padrão de nomes
   (`<tela>-<largura>.png` e `<tela>-<largura>-inteira.png`), em `docs/redesign-ascii/depois/`: `ranking`, `modelo`
   (`/modelos/claude-opus-5-5`), `ciclo` (`/ciclos/2026-12-01`), `noticias`, `acoes` (`?q=SIM`), `acao` (`/acoes/DOBR4`), `como-funciona` e
   `404`, 32 arquivos. A comparação com a v1 (`feat-redesign/docs/redesign-2026-10/qa/` e `depois/`) e com o antes
   (`docs/redesign-ascii/antes/`):
   - **O que ficou igual à v1, em todas**: o canvas preto e a moldura (as laterais em x = 120 e 1320 em 1440 px, a linha com o losango); o
     cabeçalho de página da v1 (o título na Geist 500 de 36 px a uns 68 px da linha do cabeçalho, a frase de 18 px em `body`, o `meta` de 14 px
     em `muted`), fechado pela linha, a faixa vazia de 48 px e a linha da seção; o título de seção de 28 px; as tabelas no painel de raio 26
     com o cabeçalho de 12 px em cinza e as linhas de 1 px; os cartões de raio 34; os números tabulares com o glifo ▲ ▼ ■; o botão escuro de
     44 px e a pílula branca. **O antes** (`docs/redesign-ascii/antes/`) é a estética crua da
     etapa 9: o papel claro, a IBM Plex, o h1 na mono em negrito, as tabelas com borda preta de 2 px e os títulos de coluna em caixa-alta, e
     o elenco fake antigo. Depois da T2, e antes desta tarefa, as minhas telas já estavam no escuro, mas ainda com o h1 na mono, sem a linha
     do cabeçalho de página, e com as bordas da estética crua (agora claras) nas notícias, nas decisões da ação e nos avisos.
   - **Ranking**: igual à v1 a tabela com o retorno marcado pelo glifo; mudou de propósito: sem a coluna da curva e sem o logo do modelo (o
     elenco é simulado, plano §2), a cor só no glifo, três tabelas (modelos, Sorteio e referências) e a seção "Como ler a tabela".
   - **Modelo**: igual à v1 o nome grande com a linha de `meta` e os números grandes do desempenho; mudou: a etiqueta "simulado" e o aviso da
     T1, o provedor e a estratégia no cabeçalho, a faixa dividida no lugar dos quatro cartões, o patrimônio em SVG com a faixa do Monte Carlo
     (e não a curva pontilhada da v1) e as decisões em cartões.
   - **Ciclo**: igual à v1 o título, a frase e a marca `[ok]` da situação; mudou: sem o snapshot em árvore, sem o log do ciclo e **sem o bloco
     de código do contexto** (o prompt é oculto e o briefing sai só como SHA-256, regra 4), sem a navegação entre pregões.
   - **Notícias**: igual à v1 um cartão por notícia (título, fonte e hora); mudou: o filtro é um formulário GET por ticker (e não a lista de
     tickers e de idiomas da v1), os tickers de cada notícia viram `chip`, e não há "entrou no ciclo de" (a v2 não tem esse dado).
   - **Ações**: mudou de propósito: a busca com os resultados em painel, **sem a tabela do universo com preço** (ADR 0033; plano, seção 3).
   - **Ação**: igual à v1 o ticker grande e o nome; mudou: sem os cartões de fechamento, máxima e volume (cotação bruta, ADR 0033) e as velas
     em SVG, não em ASCII (`g[data-candle]`, que o e2e confere), com o resumo em texto ao lado.
   - **Como funciona**: sem par na v1; a regra das páginas de texto (o cabeçalho e a prosa de 64 caracteres).
   - **404**: igual à v1 a composição (o título centrado no tamanho do hero, o texto, a pílula branca e o botão escuro, e o urso derrubando as
     colunas embaixo, com a brasa âmbar no urso); mudou: o título e o texto da v2, três botões e o urso na coluna.
2. **`pnpm check` com exit 0**, em 271 s (19:03 a 19:07): lint (o `turbo run lint` e o `prettier --check .`), tipos, testes (site: 35
   arquivos, **595 testes**, com o novo; contratos: 13 arquivos, 497; api: 151 arquivos verdes e 2 pulados por desenho, o emulador do Service
   Bus e os arquivos reais da CVM, 3.007 testes verdes e 9 pulados; `scripts/*.test.mjs`: 113) e o `docs:check` ("73 itens documentados").
3. **`pnpm build` com exit 0** às 18:17 (as 4 tarefas do turbo; a do site executada, cache miss, com todas as minhas mudanças de código: não
   mexi em `apps/web/src` depois dele). O build também rodou, verde, dentro de cada `pnpm test:e2e`.
4. **E2e dos meus specs** (`arena`, `layout`, `quotes`, `fixture`, `public-api`, `revalidate` e `origin-lock`, mais o `hero` e o `home` da
   T2, porque mexi no `arte.tsx` e no `tables.tsx`: 166 testes por projeto):
   - **pixel-7: 166 de 166 verdes** (a primeira rodada, os três projetos com `--workers=2`, das 18:17 às 18:19). O vigia **parou** essa
     rodada às 18:19:02, com o disco em 4 GB (o swap do macOS em 22,9 de 24,5 GB; os artefatos do e2e tinham 84 KB): o iphone-15 estava com 17
     verdes, e os 2 que falharam (o ciclo) falharam porque o servidor do site recebeu o SIGTERM antes deles; o desktop não tinha começado.
     Soltei a trava e perguntei ao coordenador.
   - **iphone-15: 166 de 166 verdes** (`--project=iphone-15 --workers=1`, em 1,9 min, exit 0 às 19:01:48), depois de 26 minutos esperando o
     disco voltar a 6 GB (uma tentativa anterior pegou a trava às 18:33 com 4 GB e não começou).
   - **desktop: não rodou.** O coordenador decidiu às 19:02, sem rodar mais e2e (o disco não saía de 5 a 6 GB): o pixel-7 vale como
     evidência, e o que faltasse fica para a suíte do fechamento, por projeto e com 1 worker. A mensagem chegou quando o iphone-15 já tinha
     terminado verde, então ficam dois projetos verdes; a rodada do desktop, que esperava o disco na fila, foi cancelada antes de começar.
   - **A suíte inteira não rodou**, também por decisão do coordenador (o disco e a memória): fica para o fechamento e a conferência dele.
5. **O HTML da home não mudou com o `arte.tsx`**: o `e2e/hero.spec.ts` (5 de 5 no pixel-7 e no iphone-15, inclusive "sem JavaScript, o quadro
   0 da escadaria igual ao `frames[0]`") e o `components/hero.spec.tsx` (no vitest) verdes, e o `e2e/home.spec.ts` (7 de 7). A única mudança
   visual da home é o glifo na tabela compacta do ranking.
6. **Sem rolagem horizontal em 360 px, alvos de 44 px e axe sem violação**: o laço de `ROUTES` do `layout.spec.ts` (12 endereços, cinco testes
   cada, mais os três do cabeçalho: 63 de 63 no pixel-7 e no iphone-15), com o axe sem violação séria ou crítica na largura do aparelho e sem
   nenhuma violação em 360 px. O "texto de terceiro sem espaço" do `fixture.spec.ts` (o ciclo, a ação e as notícias a 360 e 320 px) também
   passou.
7. **O `git grep` dos tokens velhos** (`git grep -n -E "(bg|text|border|fill|stroke)-(paper|band)\b"`) sai vazio nos meus arquivos (exit 1) e
   em todo o `apps/web/src`.
8. **Nenhuma dependência npm nova**: não toquei em `package.json`, `pnpm-lock.yaml` nem `pnpm-workspace.yaml`. `pnpm docs:check` ok.
9. **As guardas**: o `.data/guardas/az-stub/calls.log` continua com 0 linhas, e o `arena-rede.log` nunca foi criado (a guarda só o cria ao
   barrar). O banco `alvesting_arena_test` foi apagado, a trava está solta e nenhum servidor meu ficou de pé (a demo da 4300 e da 4310 não foi
   tocada).
10. **Relatório**: este arquivo; o `worker_done` vai com `--report-path` para ele e `--files-modified`.

## 3. Desvios e decisões

1. **"Resultado" do modelo na faixa dividida, e não só em pares num `card`** (o plano dizia "Facts num card"). A v1 mostrava o desempenho em
   cartões de número grande; os seis números principais na faixa da home (`Strip` de 6, num painel) ficam mais perto disso e enchem 2, 3 ou 6
   colunas sem célula vazia. Os outros quatro (drawdown, acerto, operações, custo de LLM) seguem em pares. Os dois são `dt` e `dd`, então o
   e2e (`fact(result, …)`) não mudou.
2. **A região das decisões do ciclo continua "Decisões"** (o plano escreveu "Decisões dos modelos" na linha do ciclo). O `arena.spec.ts` e o
   `fixture.spec.ts` acham a região do ciclo por "Decisões", e o contrato de DOM fica; "Decisões dos modelos" é a região da página da ação,
   como já era.
3. **A situação no cabeçalho do ciclo** (`[ok] fechado`, `[!] aberto`, `[x] pulado`): a marca da v1, composta na própria página (o `Flag` do
   plano não existe no `ui.tsx`). O verde e o vermelho são os de sistema (`semantic-success`, `semantic-error`), e o colchete diz o estado
   sem a cor; o aberto fica em cinza, porque não há cor de aviso. O par "Situação" dos horários continua sendo o que o e2e lê.
4. **As notícias e as decisões da ação viraram cartões**, como as notícias da v1 e o feed da home. A lista de notícias continua sendo uma
   `ul` "Notícias" de `li` (o e2e e o `components.spec.tsx` a acham assim), e a das decisões da ação, uma lista de `li` com o mesmo texto,
   na mesma ordem (o e2e compara por igualdade, com `innerText`).
5. **A página de notícias ganhou uma seção para a lista** ("Todas as notícias", ou "Notícias de X" com o filtro), para a moldura da v1 (a
   linha, a faixa vazia, a linha e o título). O aviso de ticker inválido e o de busca inválida (`/acoes`) foram para junto do campo, no tom
   do erro de formulário da T2 (`rounded-control border border-semantic-error/60 bg-surface-card p-4 text-ink`, classes que já existiam).
6. **A 404 manteve o título e o texto da v2** ("Página não encontrada", que o e2e confere; a v1 dizia "O urso derrubou esta página"), com
   três botões (a pílula branca e dois escuros), sem a linha "Erro 404 · página não encontrada" da v1 (o título já diz). O urso fica **na
   coluna**, e não de ponta a ponta como o hero: a 200 colunas, a 1136 px de largura, ele cabe inteiro na altura de `min(75vw, 420px)` (a
   mesma do palco do hero no celular, uma classe que já existia), e as primeiras linhas cortadas são o céu vazio.
7. **"De onde vêm os dados" (Como funciona) sem link para cada fonte** (o plano dizia "fontes como link"). Os links já estão no rodapé de
   toda tela, numa lista escrita à mão (`site-chrome.tsx`, `NEWS_SOURCES`, com um `ponytail:`); repetir os endereços na página seria uma
   segunda lista para manter. A frase da página diz que a lista com o link de cada fonte está no rodapé.
8. **A cor só no glifo**, nunca no número (a v1 pintava o retorno inteiro de verde ou vermelho): o número continua na tinta, e o glifo e o
   sinal dizem a direção sem depender da cor. Foi a condição do coordenador.
9. **O CSS.** Usei as classes e os utilitários que já existiam onde deu (o título do hero na 404, o `max-w-[64ch] text-lead text-pretty` do
   `ApiDown`, o `max-w-[64ch] text-prose-md` do texto jurídico, a grade da legenda do patrimônio nas velas, o painel e a faixa da home, o
   tom do erro de formulário). Entraram poucos utilitários novos (por exemplo `lg:grid-cols-2`, `min-w-16`, `first:border-t-0`,
   `text-semantic-success` e `text-semantic-error`) e a regra do glifo. O CSS do build final tem 40.041 B crus e 8.644 B em gzip -9 (a T2 mediu
   41,8 KB crus e 8,9 KB comprimidos, com a casca do momento dela); o LCP da home fica para o fechamento medir, como a tarefa pede.

## 4. Testes

**Nenhum teste que já existia mudou de expectativa.** Nenhuma asserção foi trocada, afrouxada ou pulada: o contrato de DOM ficou (as regiões
com nome, `dt` e `dd`, os `data-*` e as classes `link`, `btn`, `field`, `tbl`, `th`, `td`, `row` e `muted`), nada lido com `innerText` ganhou
`uppercase` ou `capitalize`, e o glifo entra por `::before`, fora do texto. As linhas (b) das tabelas 5.1 e 5.2 do plano, conferidas:

- `arena.spec.ts` (o resto), `quotes.spec.ts`, `public-api.spec.ts`, `revalidate.spec.ts` e `origin-lock.spec.ts`: "nada, se o contrato de DOM
  ficar". Ficou, e rodaram verdes sem mudança. As linhas da fase 1 (o h1 do hero e o menu, linhas 126, 951, 956 e 959 do plano) a T2 já tinha
  trocado; continuam como ela deixou.
- `layout.spec.ts`, o laço de `ROUTES`: sem mudança no teste; as telas passam (seção 2, critério 6).
- `components.spec.tsx`, linhas 91, 206 e 212: a 91 (`space-y-3` da lista de notícias) e a 206 (`min-w-0 basis-full text-sm` da
  justificativa) continuam valendo, porque mantive essas classes; a 212 (o título do cartão) a T2 já tinha trocado.

**Os testes novos:**

- `components.spec.tsx`, "o número com sinal leva a direção para o glifo, fora do texto…": o `data-dir` `up`, `down` e `flat` nas células com
  sinal do ranking (quatro atributos em duas linhas: o "—" do excesso que não existe, o percentil, o drawdown sem sinal e o acerto ficam sem),
  `down` e `flat` no resultado das posições, e nenhum `▲ ▼ ■` no HTML (o glifo é do CSS).
- `arena.spec.ts`, "ranking": para cada competidor, o `data-dir` da célula do retorno igual ao sinal do `returnBps` e o `::before` desenhado
  com o glifo certo (`getComputedStyle(cell, '::before').content`), nos três navegadores. É o que prova que a regra do CSS existe e pinta: a
  comparação por igualdade das células, logo acima, não vê o glifo.
- `arena.spec.ts`, "404 sem JavaScript" (no padrão do `e2e/hero.spec.ts` da T2): a resposta é 404 e o `<pre>` do urso já traz o quadro 0
  inteiro, igual ao `frames[0]` do `urso.json` da v1, com as 85 linhas.
- `arena.spec.ts`, "404 e o urso": em 390 px nenhum pedido ao `urso.json` nem ao `urso.png` (o `urso-q0.png` do quadro 0 não conta), e o
  `<pre>` não vazio; em 1440 px o quadro muda (o laço toca).

## 5. Para o TELAS.md

O que o fechamento pode escrever no `docs/TELAS.md` (não mexi nele):

- **Seção 1, as rotas** (a coluna "O que mostra"):
  - `/ranking`: "… com o glifo ▲ ▼ ■ antes do retorno e dos excessos, e a seção 'Como ler a tabela'".
  - `/modelos/[slug]`: "o provedor e o ID (ou a estratégia simulada) no cabeçalho, na mono; o resultado com os seis números principais na
    faixa dividida e os outros em pares; as decisões em duas colunas a partir de 1024 px".
  - `/ciclos/[data]`: "a situação no cabeçalho (`[ok] fechado`, `[!] aberto`, `[x] pulado`); a versão e os SHA-256 inteiros, na mono, num
    cartão (nunca bloco de código); as decisões em duas colunas a partir de 1024 px".
  - `/noticias`: "um cartão por notícia, com os tickers como filtro em link (`chip`); a lista numa seção ('Todas as notícias' ou 'Notícias
    de X')".
  - `/acoes`: "os resultados num painel, uma linha por ação (ticker e nome)".
  - `/acoes/[ticker]`: "as velas num cartão, com o resumo ao lado a partir de `md`; cada decisão num cartão; 'Todas as notícias de X' em
    botão".
  - 404 e erro: "a 404 tem a gramática do hero da v1 (o título no vazio, o texto, a pílula branca 'Voltar ao início', 'Ver o ranking' e
    'Buscar uma ação') e o urso derrubando as colunas embaixo, nunca atrás do texto; o erro tem 'Tentar de novo' na pílula branca nas duas
    portas (o servidor e o `error.tsx`)".
- **Seção 2**: o JavaScript além do Next passa a ser "a contagem, o laço da arte (o hero e a 404) e o botão de erro". A linha 25 tem um
  pedaço repetido ("… abre e fecha sem JavaScript.tsx`) e o botão "Tentar de novo" da página de erro do navegador (`app/error.tsx`).") que
  sobrou de uma edição.
- **Seção 3**: o glifo de direção é CSS (`[data-dir]::before`, com o texto alternativo vazio): o leitor de tela e o e2e leem só o número com
  o sinal. A reserva (`content: '▲ '`) vale para o navegador que não aceita o texto alternativo, e nele o leitor de tela leria o glifo.
- **Seção 6, testes**: no `arena.spec.ts`, o urso da 404 (sem JavaScript o quadro 0 já está no HTML, igual ao `frames[0]` do `urso.json`; em
  390 px nenhum pedido ao `urso.json` nem ao `urso.png`; em 1440 px o quadro muda) e o glifo do retorno no ranking (o `data-dir` igual ao
  sinal e o `::before` desenhado); no `components.spec.tsx`, o `data-dir` das células com sinal (e nenhum glifo no HTML).
- **Seção 10, sistema visual**: na "A arte é arquivo…", o urso da 404 (o mesmo `Arte`, `nome="urso"`, 200 × 85, na coluna); no "ASCII no
  dado", o glifo `▲ ▼ ■` por CSS nas células com sinal (`direction` em `tables.tsx`), com a cor de dado só no glifo; a marca `[ok]`/`[!]`/`[x]`
  do cabeçalho do ciclo (as cores de sistema, o colchete sem cor); e o `card` como a superfície das listas (notícias, decisões da ação, o
  cartão dos hashes).
- **`docs/DEPENDENCIAS.md`, fora das quatro linhas do urso** (que eu escrevi): a introdução da seção "Artes" diz "entrada `escadaria`" e a
  linha do Higgsfield diz "a arte da escadaria do hero"; as duas podem citar também o urso da 404 (deixei como estavam: a tarefa pediu só as
  linhas do urso).

## 6. O que ficou para depois

- **O fechamento (a)**: apagar os apelidos `paper` e `band` (nos meus arquivos, e em todo o `apps/web/src`, o `git grep` já sai vazio);
  medir o Lighthouse da home de novo (o glifo entrou na tabela compacta da home, e o CSS ganhou a regra do glifo e uns poucos utilitários);
  escrever o `TELAS.md` (seção 5 deste relatório).
- **A linha do "DeepSeek V4 Pro (0813)"** no ranking completo quebra o nome e a etiqueta em duas linhas no desktop (a coluna presa do
  `tables.tsx` deixa o nome quebrar nos espaços, de propósito, para caber em 360 px). Fica alta, mas legível; não mexi no `tables.tsx` além do
  glifo.
- **Pendência do Artur** (a mesma da T2): conferir a versão vigente dos termos da API do Higgsfield antes de publicar o repositório. O urso
  tem a mesma procedência da escadaria.
- **Não verificado**: iPhone e Android físicos (só o WebKit e o Chromium do Playwright) e leitor de tela de verdade.

## 7. Arquivos tocados

Só no working tree; nada no índice.

- `apps/web/src/app/`: `ranking/page.tsx`, `modelos/[slug]/page.tsx`, `ciclos/[data]/page.tsx`, `noticias/page.tsx`, `acoes/page.tsx`,
  `acoes/[ticker]/page.tsx`, `como-funciona/page.tsx`, `not-found.tsx`, `error.tsx`.
- `apps/web/src/components/`: `news-list.tsx`, `charts.tsx`, `components.spec.tsx`.
- Congelados de (a), com a autorização do coordenador: `apps/web/src/components/arte.tsx`, `apps/web/src/components/ui.tsx`,
  `apps/web/src/components/tables.tsx`, `apps/web/src/app/globals.css`.
- Novos: `apps/web/src/arte/urso-q0.json`; `apps/web/public/ascii/arte/urso.json`, `urso.png` e `urso-q0.png`.
- `apps/web/e2e/arena.spec.ts`.
- `docs/DEPENDENCIAS.md` (as quatro linhas do urso, na seção "Artes").
- `docs/redesign-ascii/depois/`: `ranking-`, `modelo-`, `ciclo-`, `noticias-`, `acoes-`, `acao-`, `como-funciona-` e `404-` em `390.png`,
  `390-inteira.png`, `1440.png` e `1440-inteira.png` (32 arquivos).
- `docs/redesign-ascii/relatorios/arena.md` (este).

Sem mudança, mas meus nesta fase: `decisions.tsx`, `countdown.tsx`, `layout.spec.ts`, `quotes.spec.ts`, `fixture.spec.ts`, `fixture-api.ts`,
`public-api.spec.ts`, `revalidate.spec.ts` e `origin-lock.spec.ts`.
