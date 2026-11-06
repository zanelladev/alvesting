# T0b: os logos das ações no site (05/11/2026)

Onda do design premium. A T1 da onda anterior guardou no banco a cópia dos SVG da brapi e deu ao site duas rotas internas (ADR 0036;
`docs/redesign-rallies/relatorios/logos-api.md`, "O contrato das rotas para a T3"). Esta tarefa lê os logos, serve-os do nosso domínio com
segurança e entrega o componente que as telas vão usar, provado na lista e na página da ação. O desenho e o uso estão em `docs/TELAS.md`, seção
4a; a decisão, no ADR 0036, "Como o site mostra"; a rota, no `docs/API.md`, seção 6.

## Resumo

- **Feito:** as leituras dos logos em `lib/quotes.ts` (o índice, uma hora no cache de dados, e o SVG de um papel, sem cache de dados); o
  auxiliar do servidor `versoesDosLogos()` (`lib/logos.ts`, uma vez por requisição); a rota do site `GET /logos/<TICKER>.svg`
  (`app/logos/[arquivo]/route.ts`) com a normalização do viewBox (`app/logos/viewbox.ts`, uma função pura) e a regra de CSP no
  `next.config.ts`; o componente `components/logo-do-papel.tsx` (o `<img>` no círculo branco, ou o monograma); o logo na lista das ações e no
  cabeçalho da página da ação; os dois logos sintéticos do seed do e2e (`--logos-sinteticos`); o `e2e/logos.spec.ts`; os docs.
- **Achados:** (1) o preflight do Tailwind faz todo `<img>` virar bloco, e no `h1` o logo ficava numa linha só dele (a captura mostrou; agora
  `inline-block`, com teste); (2) o Next só põe o cabeçalho da rota quando a config não pôs o mesmo antes, então a CSP geral venceria a dos logos
  (`next/dist/server/send-response.js`; daí a regra no `next.config.ts`, provada com `curl`); (3) o `oklch(1 0 0 / 0.1)` do contorno sai
  `[245, 255, 255]` no Chromium escuro (a T0 achou na rodada dela; agora em `rgb()`); (4) o `pnpm install` das 12:02 (da T0) içou o `rxjs@6.6.7`
  e derrubou toda api HTTP (escalado; a T0 corrigiu às 12:26).
- **Fica para depois:** o logo nas outras telas (as tarefas de tela, com o componente e o auxiliar daqui); a tag `logos` vencida pelo worker,
  se uma hora pesar; o teto de 200 KB no contrato (hoje repetido no site).

## Cada item do pedido, com a evidência

Os testes de unidade foram vistos falhar antes do código; o vermelho está ao lado de cada um. Os testes da api, o ensaio, o e2e, a api das
capturas e o `pnpm check` (que roda também os do site) rodaram com o az falso e a guarda de rede das regras comuns
(`NET_GUARD_LOG=.data/guardas/t0b-logos-rede.log`, que nem foi criado: a guarda só escreve quando barra; o `.data/guardas/az-stub/calls.log`
continuou com 0 linhas).

### 1. As leituras (`apps/web/src/lib/quotes.ts`) e o auxiliar do servidor

- `readLogos(deps)`: `GET /api/v1/interno/logos`, validado pelo `internalLogosSchema` do contrato, pelo mesmo caminho da fita e das barras
  (o segredo aparado e conferido antes do `fetch`, o `X-Azure-FDID`, `redirect: 'error'`, o 404 do segredo como recusa), no cache de dados do
  Next com `revalidate: 3600` (`LOGOS_TTL_SECONDS`) e sem tag. O comentário `ponytail:` diz o teto (o logo novo aparece em até uma hora e mais
  uma requisição) e a saída (uma tag `logos` vencida pelo worker no fim da atualização semanal). **A falha vira "nenhum logo"**: a api fora, o
  erro da api, o segredo recusado, a resposta fora do contrato (campo a mais, ordem errada, versão torta, corpo que não é JSON) dão a lista
  vazia com uma linha de log `[web] logos: ...`, sem o segredo; o segredo ausente ou torto dá a lista vazia sem chamar a api, com a linha que
  já existia (`cotações desligadas`, só o nome da variável).
- `readLogoSvg(ticker, deps)`: `GET /api/v1/interno/logos/:ticker` com o segredo, **sem o cache de dados** (`cache: 'no-store'`: o navegador
  guarda pela URL com a versão, e o cache de dados guardaria o SVG velho sob a versão nova). O ticker fora da forma da B3 é nulo sem chamar a
  api; o 404 `LOGO_NOT_FOUND` é nulo sem log; o resto que não se repassa é nulo com uma linha de log do ticker e do motivo, nunca o segredo nem o
  corpo: o 404 sem o código (segredo recusado), o 5xx, a api fora, outro tipo de conteúdo que não `image/svg+xml` (o `charset` vale), o
  `Content-Length` acima do teto (recusado sem ler), o corpo lido acima do teto (a leitura para nele), o corpo fora do UTF-8 e o corpo que cai
  no meio da leitura. O teto é o da T1: `LOGO_MAX_BYTES = 200 * 1024`.
- `versoesDosLogos()` (`lib/logos.ts`, `import 'server-only'`): o mapa ticker → versão, com o índice lido uma vez por requisição pelo `cache`
  do React. O `quotes-boundary.spec.ts` segue verde: só o `quotes.ts` lê o `QUOTES_SECRET`, e nenhum componente de cliente chega a ele.
- Testes: `quotes.spec.ts` (34 novos; vermelho antes: `33 failed`, `readLogos is not a function`; o do corpo que cai no meio veio na revisão
  do meu diff, vermelho com `promise rejected "TypeError: terminated"`) e `logos.spec.ts` (o mapa e a leitura única, com um `cache` que memoriza;
  vermelho: `Cannot find module '/src/lib/logos'`).

### 2. A rota do site `GET /logos/<TICKER>.svg`

- `app/logos/[arquivo]/route.ts`: o arquivo tem de casar `^([A-Z0-9]{4,12})\.svg$` antes de qualquer chamada (minúsculas, `../`, outra
  extensão, tamanho errado: 404); a forma da B3 vem em seguida, no `readLogoSvg`. O SVG passa pelo `withViewBox` e sai com os `LOGO_HEADERS`
  do contrato (`image/svg+xml`, `nosniff`, `default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox`) e
  `Cache-Control: public, max-age=31536000, immutable`. O resto é 404 sem corpo e `no-store`.
- A normalização (`app/logos/viewbox.ts`): a raiz sem `viewBox`, com `width` e `height` numéricos (px ou sem unidade, maiores que zero), ganha
  `viewBox="0 0 W H"`; só a tag raiz muda. Pula o prólogo que o validador aceita (BOM, declaração XML, comentários; um `<svg>` dentro de comentário
  não é a raiz), lê atributos entre aspas simples ou duplas e com `>` no valor, trata o `viewbox` em minúsculas como ausente (o XML tem caixa), e
  devolve o que não reconhece como veio (outra raiz, prefixo, DOCTYPE, tag torta); entrada grande e torta volta em tempo linear.
- `next.config.ts`: a regra `/logos/:arquivo` com a CSP dos logos, **depois** da geral. É de um segmento só (e não `/logos/:path*`): a página 404
  do Next em `/logos/a/b` segue com a CSP geral e com o CSS dela (o `curl` abaixo mostra).
- Testes: `viewbox.spec.ts` (23; vermelho: `Cannot find module './viewbox'`), `route.spec.ts` (28: os cabeçalhos exatos, o viewBox posto e o
  SVG com viewBox byte a byte, nada do segredo nem da api, 17 arquivos tortos sem chamar a api, a forma da B3, o `LOGO_NOT_FOUND`, e seis
  respostas recusadas; vermelho: `Cannot find module`) e `next-config.spec.ts` (1 novo: a regra depois da geral, a CSP igual à do contrato, o
  resto do site com a geral; vermelho: `expected -1 to be greater than 0`).
- **A prova com `curl` no servidor construído** (o standalone do `next build`, na 4331, lendo a minha api na 4330 sobre o `alvesting_dev` só
  para leitura, com o login de menor privilégio):

  ```text
  GET /logos/PETR4.svg?v=659e50f6c54d8fca
  HTTP/1.1 200 OK
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Content-Security-Policy: default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox
  Strict-Transport-Security: max-age=31536000
  cache-control: public, max-age=31536000, immutable
  content-type: image/svg+xml
  ```

  A raiz guardada `<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56">` sai `... width="56" height="56" viewBox="0 0 56 56">`
  (1.062 → 1.082 bytes, os 20 do atributo); o AFLT3, que já tem viewBox, sai igual ao da api byte a byte (`cmp`); o `HEAD` (`curl -I`) dá os
  mesmos cabeçalhos; `CASN3.svg` (sem logo), `petr4.svg`, `..%2FPETR4.svg` e `PETR4.png` dão 404 com a CSP dos logos e `no-store`;
  `PETR4.svg/x` dá a 404 do Next com a CSP geral; e o segredo, a porta da api e `interno` aparecem 0 vezes na resposta.

### 3. O componente (`apps/web/src/components/logo-do-papel.tsx`)

- `<LogoDoPapel ticker versao tamanho className />`, sem `'use client'` e sem import nenhum. Com a versão: `<img src="/logos/<T>.svg?v=<v>"
  alt="" width height loading="lazy" decoding="async" data-logo="imagem">`, `inline-block`, `rounded-full`, `bg-white` e o contorno de 1 px por
  dentro da borda (`outline`, `-outline-offset-1`, `light-dark(rgb(0 0 0 / 0.1), rgb(255 255 255 / 0.1))`). Sem a versão: o monograma,
  `<span aria-hidden="true" data-logo="monograma" data-inicial="P">`, com a letra pelo `::before` (fora do texto), em `bg-surface-strong`,
  `border-hairline` e `text-muted` (o desenho da inicial do competidor). Dois tamanhos: `lista` (16 px) e `cabecalho` (40 px).
- **As medidas do Rallies** (as capturas de `.data/rallies-referencia/`, todas em 1x): o círculo tem 16 × 16 px nas três (`arena-1440-dark`,
  `arena-1440-light` e `arena-1917-logado`); a primeira tinta do ticker fica a 15 px do círculo; no claro o círculo branco some no fundo e só o
  desenho aparece. As nossas, medidas nas capturas: 16 × 16, 14 px do círculo à caixa do texto (`mr-3.5`) e o centro do texto no centro do
  logo; no cabeçalho, 40 × 40, 12 px (`mr-3`) e 3,25 px entre os centros.
- O contorno: o `light-dark()` segue o `color-scheme` da página, que a fundação da T0 põe por `data-tema` (o claro e o escuro escolhidos) ou
  deixa `light dark` (o sistema). O `dark:` não serviria: a T0 o ligou à classe `.dark`. O Tailwind compila o `light-dark()` para as variáveis
  `--lightningcss-light`/`--lightningcss-dark`, que o próprio CSS da T0 vira por tema.
- Testes: `logo-do-papel.spec.tsx` (6: o `<img>` e os atributos, o tamanho do cabeçalho, o monograma sem texto, o `className`, o endereço
  codificado e o arquivo sem import nem diretiva; vermelho: `Cannot find module './logo-do-papel'`; depois, o `inline-block`, vermelho antes da
  classe).

### 4. Onde entra agora

- A lista das ações (`app/(app)/(explorar)/acoes/page.tsx`): o logo dentro do link, à esquerda do ticker (`mr-3.5`); o link passou de
  `min-w-16` a `min-w-24` (o logo e o ticker mais longo, para o nome começar no mesmo lugar). O índice sai no mesmo `Promise.all` das outras
  leituras.
- O cabeçalho da página da ação (`acoes/[ticker]/page.tsx`): o logo de 40 px no `h1`, antes do ticker (`mr-3`); o nome do `h1` continua o
  ticker. O índice sai junto com a leitura da ação (ele não tem parâmetro da URL; as barras continuam depois da ação).

### 5. O e2e e o seed

- O seed: `arena:ensaio --logos-sinteticos` (`apps/api/src/ensaio/cli-args.ts` e `ensaio-cli.ts`) grava, **depois do relatório**, os dois SVG de
  `apps/api/src/ensaio/synthetic-logos.ts` pelo mesmo repositório da passada (`MarketRepository.logoTargets` e `saveLogo`: o SHA-256 e o tamanho
  dos bytes): o MOVE3, um quadrado verde com um disco branco, `width="56" height="56"` e sem viewBox (sem a normalização, o `<img>` de 16 px
  mostraria só o canto verde), e o SINA3, um quadrado azul com três barras brancas e `viewBox="0 0 32 32"`. Formas simples, de marca nenhuma;
  a origem é `https://example.test/e2e/logos/<TICKER>.svg`. O `e2e:seed` e o comando da api do `playwright.config.ts` passam a bandeira; o
  `arena:ensaio` comum não, então a demo e o Lighthouse seguem sem logo. Testes: `synthetic-logos.spec.ts` (3: o validador de verdade da T1
  aceita os dois, um com e outro sem viewBox, e a gravação; vermelho: `Cannot find module './synthetic-logos.js'`) e `cli-args.spec.ts` (1 novo,
  e 2 expectativas mudadas: abaixo).
- `apps/web/e2e/logos.spec.ts`, marcado `@tema`, nos seis projetos (8 testes): o índice da api com os dois logos e só eles; a lista
  (`/acoes?q=SIN`, onde o SINA3 tem logo e os outros não, e `/acoes?q=MO`) com o `<img>` da rota dentro do link e o monograma nos outros, o texto
  das linhas igual ao de antes; a página da ação com o logo de 40 px na linha do ticker (12 px, centros a até 4 px) e o monograma no SINB4; em
  cada `<img>`: o endereço com a versão, os atributos, o tamanho, o desenho carregado, o fundo branco, o raio, o contorno `solid 1px -1px` e a cor
  pintada num pixel (preto a 10% no claro, branco a 10% no escuro, exata); a rota com os `LOGO_HEADERS`, o cache de um ano, o viewBox posto no
  MOVE3 e o SINA3 byte a byte, o `HEAD`, nada do segredo nem da api; doze 404 com `no-store` (sem logo, minúsculas, `../` codificado de dois
  jeitos, outra extensão, tamanho errado, dois segmentos); nenhum pedido a outro host nas duas páginas (e a prova de que os SVG vieram do site);
  e o axe sem violação nenhuma em 360 px e nenhuma rolagem de 360 a 1920 px nas duas telas com monograma (as com o logo do MOVE3 já estão no
  `ROUTES` do `layout.spec.ts`).
- A api falsa do e2e (`e2e/fixture-api.ts`) ganhou o índice vazio: os papéis dela não têm logo, e sem a rota o site dela registraria a falha.

### 6. Os docs

- `docs/TELAS.md`: a seção nova **4a. Logos das ações** (o componente, os tamanhos, o círculo branco, o monograma, quem tem logo, a rota, o
  viewBox, onde está e como as telas o usam, e os testes). Só a minha seção, inserida antes da 5, sem renumerar (a T0 edita a 10).
- `docs/adr/0036-logos-das-acoes-copia-propria-da-brapi.md`: a seção **Como o site mostra** (cinco itens) e o item 6 apontando para ela.
- `docs/API.md`, seção 6: a linha **A rota do site** entre as rotas internas, e a frase da seção 5 sobre o `e2e:seed` (a bandeira).

## As provas

Com a trava pesada (12:12 a 12:15 e 13:19 a 14:00; o disco entre 12 e 9 GB livres), o az falso, a guarda de rede e o meu banco de teste
(`TEST_DATABASE_URL=.../alvesting_t0b_logos_test`, apagado no fim) com o Azurite das regras comuns:

| Prova | Resultado |
|---|---|
| `pnpm check` (13:55:44 a 13:58:33) | **exit 0**. Lint dos 4 pacotes e "All matched files use Prettier code style!"; typecheck; testes: contracts 13 arquivos e 501 testes, web 48 e 855, api 154 arquivos e 3.153 testes (2 arquivos e 9 testes pulados, os de sempre: `messaging.integration.spec.ts`, 6, sem o emulador do Service Bus, e `cvm-real-files.spec.ts`, 3, sem os arquivos reais da CVM), `node --test "scripts/*.test.mjs"` 113 de 113; `docs:check`: "ok: 75 itens documentados em docs/DEPENDENCIAS.md" |
| A primeira rodada do `pnpm check` (13:48) | Reprovou no `prettier --check .` por `scripts/arte-azul.mjs` e `scripts/arte-azul.test.mjs`, da T1b, que começou às 13:44 (avisei o coordenador; ela os formatou às 13:52 e tirou o teste, que reprova 4 casos de propósito até ela trocar a paleta). O typecheck e os testes rodados à parte entre as duas passaram, menos esse teste dela |
| `pnpm build` | **exit 0** três vezes: às 12:12; às 13:25, tudo do cache do turbo (o build da T0 das 12:55 já tinha o `rgb()`); e às 13:28, com o `inline-block` (o web refeito, a api do cache). A rota aparece como `ƒ /logos/[arquivo]` |
| O e2e, os seis projetos, um por vez, com 1 worker (`pnpm --filter @alvesting/web exec playwright test --workers=1 --project=<p>`, 13:30 a 13:47) | **todos verdes**: `pixel-7` 470 passaram e 7 pulados (3,6 min); `iphone-15` 470 e 7 (4,7 min); `desktop` 476 e 1 (3,5 min); `pixel-7-escuro` 154 e 1; `iphone-15-escuro` 154 e 1; `desktop-escuro` 155 e 0. O `logos.spec.ts`: 8 de 8 em cada projeto |
| Os pulados do e2e | Nenhum meu: os quatro de teclado da casca e o de teclado da carteira, que pulam no celular (`layout.spec.ts` 458, 590, 644 e 773; `carteira.spec.ts` 1116); o login do smoke pelo Front Door (`smoke.spec.ts` 192, nos três claros); e o do seletor de tema pelo teclado da T0 (`tema.spec.ts` 173), nos quatro de celular |
| O conserto do contorno (decisão do coordenador) | O `logos.spec.ts` nos dois escuros do Chromium, sozinho, antes do e2e inteiro: `desktop-escuro` 8 passaram (13,4 s) e `pixel-7-escuro` 8 (11,7 s). Na rodada da T0 eram as duas falhas `[245, 255, 255]` contra `[255, 255, 255]` |
| `pnpm --filter @alvesting/api arena:ensaio` com `ENSAIO_DATABASE_URL=.../alvesting_t0b_logos_ensaio` | **exit 0** e "RESULTADO: OK"; o `relatorio-s1-p5.txt` com **`081d860b31b6c69997424d92beacc190eefed498835b61e2ebe9b442d8891f12`** (22.068 bytes), o das regras. E pelo caminho do seed do e2e (`node dist/ensaio-cli.js --logos-sinteticos`, o mesmo banco recriado): "RESULTADO: OK", o **mesmo SHA-256**, "logos sintéticos do e2e gravados: MOVE3, SINA3", e no banco o MOVE3 com 153 bytes sem viewBox e o SINA3 com 169 bytes e viewBox. O banco foi apagado depois |
| A prova com `curl` no servidor construído | A seção 2, acima: a CSP final é a dos logos, com `sandbox`, e o cache é o de um ano |
| As capturas | A seção abaixo |
| `node infra/tests/check.mjs` | 97 de 97 (nenhuma rota da api mudou) |
| A guarda de rede | O `t0b-logos-rede.log` nem foi criado: nada foi barrado (a guarda só escreve quando barra), nos testes, no ensaio, no e2e e na api das capturas |
| O az falso | `.data/guardas/az-stub/calls.log` com 0 linhas, antes e depois |
| O `alvesting_dev` | Só lido: a minha api das capturas (4330) entrou com o login de menor privilégio (`alvesting_api`, o `API_DATABASE_URL` do `.env.example`, sem o `.env.local`) e só recebeu GET das telas públicas e das rotas internas; as consultas à mão foram `SELECT` |
| A demo | Fora às 12:13 (o `rxjs` içado; ver os desvios), religada pelo coordenador; às 14:00 a api (4310) e o site (4300) respondiam 200, e nenhum processo dela foi tocado por mim |
| O bloqueio do `rxjs` | O `pnpm install` das 12:02 (da T0) apontou o `node_modules/.pnpm/node_modules/rxjs` para o `rxjs@6.6.7` (do `inquirer@6.5.2`), e o `@nestjs/platform-express`, que usa o `rxjs` sem declará-lo, quebrou ("does not provide an export named 'catchError'"; o Nest: "No driver (HTTP) has been selected"): nenhuma api HTTP subia. Escalei às 12:14 e soltei a trava; a T0 aplicou o `packageExtensions` no `pnpm-workspace.yaml` às 12:26. Não mexi no lockfile nem no `pnpm-workspace.yaml` |

## As capturas

Em `.data/logos-capturas/` (fora do git), no build de produção (o standalone na 4331), lendo a minha api na 4330 sobre o `alvesting_dev` só para
leitura, em Chromium, nos dois temas: `lista-*` (`/acoes?q=CA`: CALI3, CASN3 e CASN4 sem logo e o resto com), `acao-petr4-*` (o logo da
Petrobras, sem viewBox no banco) e `acao-sem-logo-casn3-*` (o monograma), cada uma em 1440 × 900 (1x, como a do Rallies) e em 390 × 844 (2x, como
a `arena-390` dele), com um recorte do primeiro logo; `comparacao-rallies-1440-claro.png` e `-escuro.png` põem o recorte da Arena do Rallies e o
da nossa lista lado a lado, na mesma ampliação (4x); e `medidas.json` guarda as medidas de cada uma. Nas 12, nenhum pedido a outro host. O que
elas mostram: no escuro o círculo branco aparece em volta de cada logo, como no Rallies; no claro ele some no fundo e fica o desenho; o logo
sem viewBox (o PETR4) aparece inteiro, encolhido; e o tamanho e o respiro são os do Rallies (a altura da linha da lista é a da tela, das tarefas
de tela). A primeira rodada mostrou o achado do `inline-block` (o logo do cabeçalho numa linha acima do ticker); as capturas de agora são da
rodada depois da correção.

## Como as telas usam o componente e o auxiliar

```tsx
// numa tela de servidor (app/...), junto com as outras leituras
const [carteira, logos] = await Promise.all([lerCarteira(), versoesDosLogos()]);
// à esquerda do ticker, dentro do link dele; 16 px e 14 px até o ticker nas listas e tabelas
<NavLink href={`/acoes/${p.ticker}`} className={LINK}>
  <LogoDoPapel ticker={p.ticker} versao={logos.get(p.ticker)} className="mr-3.5" />
  {p.ticker}
</NavLink>
// no cabeçalho de uma página: tamanho="cabecalho" (40 px) e className="mr-3"
```

- `versoesDosLogos` é só do servidor (`lib/logos.ts`); o componente serve aos dois lados. Para um componente de cliente, a tela de servidor passa
  a versão de cada linha (uma string) por prop.
- O logo é decorativo: o texto e o nome acessível da linha não mudam (o `<img>` tem `alt=""`, e a letra do monograma vem do atributo). Um teste
  que lê o `innerText` da linha continua valendo.
- Em `flex`, o logo já é item (`shrink-0`); em texto corrido, ele corre na linha (`inline-block` e `align-middle`).
- O `components.spec.tsx` confere que a lista de notícias não tem `<img` (o título de terceiro não vira HTML): a tarefa que puser o logo nas
  notícias precisa estreitar essa asserção para o título.

## Desvios e decisões

- **A regra do `next.config.ts` é `/logos/:arquivo`**, e não `/logos/:path*` como o pedido escreveu: o mesmo efeito na rota, sem estragar a
  página 404 do Next em `/logos` e em `/logos/a/b` (a CSP dos logos bloquearia o CSS dela). O teste e o `curl` provam os dois lados.
- **A rota confere também a forma da B3** antes da api (além de A-Z e 0-9, de 4 a 12): `ABCD.svg` passa na primeira e não chama a api.
- **Toda falha da api na rota é 404 sem cache** (e não 502 ou 503): para o `<img>` não há diferença, e a linha de log diz o motivo.
- **O contorno usa `light-dark()`, e em `rgb()`** (o pedido escreveu as cores em oklch, as mesmas): o `light-dark()` segue o tema da T0 pelo
  `color-scheme`, o que o `dark:` (ligado à classe) não garantiria; o `rgb()` foi a decisão do coordenador para o Chromium escuro (o teste do
  e2e segue exato).
- **O `<img>` leva `inline-block`**: o preflight do Tailwind o faz bloco, e no `h1` ele ficava numa linha só dele.
- **Expectativa de teste mudada:** `apps/api/src/ensaio/cli-args.spec.ts`, "sem argumento valem 5 pregões e a semente 1" e "lê --pregoes e
  --semente, em qualquer ordem": o resultado do `parseArgs` ganhou o campo `syntheticLogos: false` (a bandeira nova). Fora isso, só testes
  novos. O contrato de DOM das duas telas ganhou o elemento do logo (`data-logo`), com o texto e os nomes acessíveis iguais; o link da lista
  passou de `min-w-16` a `min-w-24`.
- **Arquivos fora da lista estrita**, por consequência direta do pedido: `apps/web/playwright.config.ts` (só a bandeira no comando da api do e2e
  e o comentário), `apps/api/package.json` (só a bandeira no `e2e:seed`), `apps/api/src/ensaio/cli-args.ts` e `ensaio-cli.ts` (a bandeira) e
  `apps/web/e2e/fixture-api.ts` (o índice vazio).
- **O teto de 200 KB está repetido no site** (`LOGO_MAX_BYTES` de `lib/quotes.ts`): o da api (`svg-check.ts`) não está no contrato, e mexer no
  contrato e na api não era meu.
- **O ensaio:** o meu resumo ao coordenador abreviou o SHA-256 como "081d860b...8f12", errado; o completo, medido, é o das regras
  (`081d860b31b6c69997424d92beacc190eefed498835b61e2ebe9b442d8891f12`).
- **A demo:** às 12:13 a api da demo (4310) estava fora (curl 000). A causa de ela não voltar era o `rxjs` içado pelo `pnpm install` das 12:02;
  o meu `pnpm build` das 12:12 refez o `apps/api/dist`, que o `nest start --watch` dela usa, e pode ter sido o que a fez reiniciar. Não toquei no
  processo dela; o coordenador a religou (e o site 4300, às 13:25). Os meus builds seguintes não refizeram o `dist` (a api veio do cache do
  turbo), e a api da demo respondeu 200 depois deles.

## O que ficou para depois

- **As tarefas de tela:** o logo nas carteiras, no feed, no explorar, nas notícias, na página do modelo e na carteira do usuário, com o
  componente e o auxiliar (a seção "Como as telas usam", acima, e o `docs/TELAS.md`, 4a).
- **A tag `logos`**, se uma hora de atraso pesar: vencida pelo worker no fim da atualização semanal (o `ponytail:` do `quotes.ts`).
- **O teto no contrato:** `LOGO_MAX_BYTES` em `packages/contracts/src/internal.ts`, lido pela api e pelo site.
- **A lista de testes da seção 6 do `docs/TELAS.md`** não cita o `logos.spec.ts` (a 4a cita): a T0 edita perto dali.

## Arquivos tocados

27 arquivos no repositório (12 novos e 15 alterados), nenhum `git add`: nos alterados que já estavam no índice, a minha mudança é a do
`git diff` (o índice guarda as ondas anteriores, e alguns têm também mudanças de outras tarefas, como o `next.config.ts` e o `package.json` da
api). Nenhum SVG da brapi, segredo ou dado baixado no repositório; nenhuma dependência nova.

- **Novos (12):**
  - `apps/web/src/components/logo-do-papel.tsx` e `logo-do-papel.spec.tsx`
  - `apps/web/src/lib/logos.ts` e `logos.spec.ts` (o auxiliar do servidor)
  - `apps/web/src/app/logos/[arquivo]/route.ts` e `route.spec.ts`; `apps/web/src/app/logos/viewbox.ts` e `viewbox.spec.ts`
  - `apps/web/e2e/logos.spec.ts`
  - `apps/api/src/ensaio/synthetic-logos.ts` e `synthetic-logos.spec.ts`
  - `docs/redesign-premium/relatorios/logos.md` (este)
- **Alterados no site (8):** `apps/web/src/lib/quotes.ts` e `quotes.spec.ts`; `apps/web/next.config.ts` (só a regra de `/logos/:arquivo`) e
  `src/lib/next-config.spec.ts`; `src/app/(app)/(explorar)/acoes/page.tsx` e `acoes/[ticker]/page.tsx` (só o elemento do logo, a leitura do
  índice e o `min-w-24`); `e2e/fixture-api.ts` (o índice vazio); `playwright.config.ts` (a bandeira no comando da api e o comentário).
- **Alterados na api (4):** `apps/api/package.json` (a bandeira no `e2e:seed`), `src/ensaio-cli.ts`, `src/ensaio/cli-args.ts` e
  `cli-args.spec.ts`.
- **Alterados nos docs (3):** `docs/TELAS.md` (a seção 4a), `docs/API.md` (seção 5, a frase do `e2e:seed`; seção 6, a linha da rota do site) e
  `docs/adr/0036-logos-das-acoes-copia-propria-da-brapi.md` (a seção "Como o site mostra" e o item 6).

Fora do git: `.data/logos-capturas/` (as 12 capturas, os 12 recortes, as 2 comparações e o `medidas.json`) e, no scratchpad da sessão, o script
das capturas e os logs das provas. Os bancos meus (`alvesting_t0b_logos_ensaio` e `alvesting_t0b_logos_test`) foram apagados no fim.
