# ADR 0036: Os logos das ações, uma cópia própria dos SVG da brapi

- **Status:** aceita
- **Data:** 05/11/2026
- **Origem:** o pedido do Artur de 05/11/2026 ("Quero as logos das ações", com a captura da Arena do Rallies logado); `docs/DADOS.md`, seção 3a; `docs/API.md`, seção 6; `docs/JOBS.md`, seção 2.1; ADR 0028 (o papel mínimo do Postgres da api), 0032 (a brapi como fonte e o banco como cache), 0033 (a rota interna para o site) e 0035 (o design do Rallies AI)

## Contexto

O Rallies mostra o logo da empresa ao lado do ticker nas carteiras, e o Artur pediu o mesmo. A fonte é a brapi: o FAQ dela diz que todos os
planos, inclusive o gratuito, "incluem acesso às logos oficiais das empresas brasileiras listadas em bolsa" (o texto vem do pedido da onda,
de 05/11/2026; esta tarefa não releu a página: a única rede dela foi a lista e os SVG), e a lista que o job semanal já pede
(`/api/quote/list`, ADR 0032) traz, em cada ação, o campo `logo` com o endereço de um SVG em `https://icons.brapi.dev/icons/<TICKER>.svg`.

Um SVG não é uma imagem inerte como um PNG: é um documento XML que pode trazer script, atributos de evento, `<foreignObject>` com HTML,
referências a endereços de fora e entidades. Servi-lo como está seria abrir no nosso domínio um documento escrito por terceiros.

## Decisão

O Artur escolheu **"Cópia guardada por nós"**:

1. **O job baixa os SVG, recusa os inseguros e guarda no nosso banco** (`instrument_logo`, um por papel, com cascata do `instrument`: a URL
   de origem, o SVG, o SHA-256, os bytes e a data da busca). Roda no fim da atualização semanal (`WeeklyRefresh`, dentro do `universe` de
   domingo, depois da lista e das barras, com o que sobra do orçamento de 4 minutos) e no comando manual `market:logos` (sem rede por padrão;
   busca só com `--confirmo-banco <nome>`). A falha dele nunca derruba a atualização nem o universo.
2. **Só vale o endereço exato** `https://icons.brapi.dev/icons/<nome>.svg` (sem porta, usuário, query, fragmento, ponto nem
   percent-encoding no nome); o resto é "sem logo", e um valor torto num papel nunca derruba a lista. **O ícone padrão** que a brapi põe para
   quem não tem logo (`BRAPI.svg`, o de 31 das 783 ações da lista na prova de 05/11/2026) também é "sem logo".
3. **O baixador:** um pedido por vez, só nesse endereço, sem token nem cookie (o token da brapi nunca vai a este host), sem seguir
   redirecionamento, com prazo de 10 s (o corpo inclusive), teto de 200 KB do corpo já descomprimido (o host comprime: o
   `Content-Length` do ABEV3 era 888 e o corpo lido, 1.617 bytes) e `Content-Type: image/svg+xml`; 5 falhas seguidas são o host fora do ar e param a passada. Baixa só
   o que falta, o que mudou de endereço e o que tem mais de 30 dias; o mesmo SHA-256 não regrava o SVG (só a data da busca anda).
4. **O validador** (`svg-check.ts`, uma função pura, sem dependência nova): um leitor pequeno de XML que entende só o que um logo usa e
   recusa o resto. A raiz é `<svg>`; recusa `<script>`, atributos `on*`, `<foreignObject>`, `<!DOCTYPE>` e `<!ENTITY>`, `<iframe>`,
   `<embed>`, `<object>`, a animação que troca atributo (`<set>`, `<animate>`...), instrução de processamento (`<?xml-stylesheet?>`),
   `javascript:` em qualquer atributo, `href` e `src` que não sejam `#id` ou imagem embutida em `data:image/(png|jpeg|gif|webp);base64`,
   `url()` que não seja `#id` ou essa imagem, `@import` e endereço (`//`) no CSS, e o que passa do teto. Os nomes valem sem prefixo de
   namespace e sem caixa, e os valores, depois das entidades do XML, dos escapes do CSS e sem os espaços e controles que o navegador ignora
   num endereço. O recusado vira "sem logo", com a linha de log do ticker e do motivo, **nunca o conteúdo**.
5. **A tabela só guarda o que passa no validador de hoje.** Antes de baixar, cada passada reconfere todo SVG guardado e apaga o que o
   validador recusa (com o ticker e o motivo no log). **Depois de mudar o validador, roda-se o `market:logos`** (RUNBOOK, 12.7), e a regra
   nova vale na hora; sem isso, vale no domingo seguinte.
6. **O site serve os logos do próprio domínio**, lendo-os de duas rotas internas da api, atrás do mesmo `QuotesSecretGuard` das cotações
   (ADR 0033: segredo do servidor comparado em tempo constante, 404 de rota que não existe sem ele, `no-store`, fora do Swagger e do cache
   do Front Door, com `/interno/` no caminho para o WAF barrar na borda): `GET /api/v1/interno/logos` (a lista de quem tem logo, com a
   versão: os 16 primeiros hex do SHA-256) e `GET /api/v1/interno/logos/:ticker` (o SVG, fora do envelope, com `Content-Type:
   image/svg+xml`, `X-Content-Type-Options: nosniff` e `Content-Security-Policy: default-src 'none'; img-src data:; style-src
   'unsafe-inline'; sandbox`). Nenhuma rota pública nova. O contrato está no `docs/API.md`, seção 6. A rota do site e o componente estão em "Como o site mostra", abaixo.
7. **As duas rotas leem o banco como está**, sem reconferir o SVG ao servir. A primeira versão reconferia na rota do SVG, e saiu quando
   entrou a lista: a lista diria "tem logo" e a rota daria 404 (ícone quebrado) no caso de uma regra nova. Pode sair porque **só o worker
   escreve na tabela** (a api só a lê: `SELECT` e nada mais, pela matriz do papel, `table-policy.ts`, que o `api-role.integration.spec.ts`
   confere no catálogo), porque a passada reconfere o guardado (item 5), porque **o site mostra o SVG só por `<img>`** (que não roda script
   nem busca nada de fora) e porque **a rota do site manda a mesma CSP com `sandbox`** (o SVG aberto direto na aba também fica inerte).

Nenhum dado do visitante vai à brapi: quem pede o SVG é o worker, uma vez, e o navegador só fala com o nosso domínio. A política de
privacidade não muda. **Nenhum SVG entra no git** (só os de teste, escritos à mão, nos specs).

## Como o site mostra

Feito na onda do design premium (05/11/2026); o desenho e o uso estão no `docs/TELAS.md`, seção 4a.

1. **Quem tem logo.** A tela (de servidor) pede `versoesDosLogos()` (`apps/web/src/lib/logos.ts`, só do servidor): o índice da rota interna,
   uma vez por requisição (o `cache` do React) e por uma hora entre elas (o cache de dados do Next; `readLogos`, `lib/quotes.ts`, o único módulo
   que lê o `QUOTES_SECRET`). O logo novo chega com a atualização semanal, então uma hora basta; a saída, se pesar, é uma tag vencida pelo worker
   no fim dela. **A falha** (a api fora, o segredo ausente ou recusado, a resposta fora do contrato) vira o mapa vazio: só monogramas, com uma
   linha de log sem o segredo. O logo é enfeite e nunca derruba a tela.
2. **O componente.** `<LogoDoPapel>` (`apps/web/src/components/logo-do-papel.tsx`, sem `'use client'` e sem import: serve ao servidor e ao
   cliente) põe, no papel com versão, um `<img src="/logos/<TICKER>.svg?v=<versão>" alt="">` de tamanho fixo (16 px nas listas e tabelas, 40 px
   no cabeçalho da página da ação), `loading="lazy"` e `decoding="async"`, num círculo branco com o contorno de 1 px (preto a 10% no claro,
   branco a 10% no escuro); sem versão, o monograma (a primeira letra do ticker, `aria-hidden`, fora do texto). **O SVG só entra por `<img>`**:
   nunca como marcação na página, em `innerHTML` ou num `data:` montado pelo site.
3. **A rota do site** (`apps/web/src/app/logos/[arquivo]/route.ts`, `GET /logos/<TICKER>.svg`): confere o arquivo antes de chamar a api (A-Z e
   0-9, de 4 a 12, `.svg`, e a forma da B3); lê o SVG da rota interna com o segredo, **sem o cache de dados** (o navegador guarda pela URL com a
   versão, e o cache de dados guardaria o SVG velho sob a versão nova); repassa só `image/svg+xml`, até os 200 KB da T1 e em UTF-8; põe o
   `viewBox="0 0 W H"` na raiz que não tem, com `width` e `height` numéricos (300 dos 357: sem ele o desenho não encolhe num `<img>` menor;
   `viewbox.ts`, uma função pura que só mexe na tag raiz); e responde com os `LOGO_HEADERS` e `Cache-Control: public, max-age=31536000,
   immutable` (a versão está na URL: logo novo é URL nova). O resto é 404 sem corpo e `no-store`. Nada do segredo nem da api sai na resposta.
4. **A CSP.** O Next só põe o cabeçalho da rota quando a config não pôs o mesmo antes (`next/dist/server/send-response.js`), então a CSP geral do
   site venceria a dos logos: o `next.config.ts` a repete para `/logos/:arquivo`, numa regra depois da geral (a última vence). Um segmento só:
   a página 404 do Next em `/logos` e em `/logos/a/b` segue com a CSP geral (e com o CSS dela).
5. **A prova.** O e2e (`apps/web/e2e/logos.spec.ts`, nos seis projetos) roda sobre dois SVG desenhados à mão, de marca nenhuma, que o seed do
   e2e grava depois do ensaio (`arena:ensaio --logos-sinteticos`, `apps/api/src/ensaio/synthetic-logos.ts`: o MOVE3 sem viewBox e o SINA3 com),
   sem mudar o relatório do ensaio. Nenhum SVG da brapi entra no repositório; as capturas com os logos reais leram o `alvesting_dev` só para
   leitura e ficam fora do git.

## Consequências

- A prova de 05/11/2026 (`docs/DADOS.md`, seção 3a) mediu o que a doc não dizia: 783 ações na lista, todas com `logo` na forma exata, 752
  com o logo da empresa e 31 com o ícone padrão; o icons.brapi.dev é o GitHub Pages (`server: GitHub.com`, `Cache-Control: max-age=600`,
  comprimido); os SVG têm a raiz `<svg width="56" height="56">` (sem `viewBox` em 300 dos 357 do dev). A carga do dev guardou 357 logos (507.174
  bytes, de 222 a 15.198 cada), nenhum recusado e nenhum com imagem embutida, e 18 ações do banco ficaram sem logo (o ícone padrão, ou fora
  da lista de hoje).
- A lista não gasta a cota da brapi (ADR 0032: só o limitador de 20 por minuto) e o icons.brapi.dev é outro host, sem token: a cópia não
  custa nada da cota de 15 mil. Uma semana comum não pede SVG nenhum; a cada 30 dias os 357 voltam a ser pedidos (uns 45 s, só a data anda
  se nada mudou), dentro do orçamento do `universe`.
- O papel sem logo (o ícone padrão, a recusa, o host fora do ar) fica com o monograma no site. O recusado não apaga o guardado antes, que
  passou na reconferência da mesma passada.
- `instrument_logo` não é dado pessoal (o logo é da empresa): entra no dump mensal do backup como as outras tabelas de mercado.

## Risco residual (decidido, e que o Artur e o orientador podem rever)

**Os termos podem chamar a cópia de redistribuição.** Os Termos de Uso da brapi (07/06/2025) vedam "revender, redistribuir ou sublicenciar
os Dados" e criar "proxy, espelho ou wrapper" de acesso público (ADR 0033). O FAQ dá o acesso às logos em todos os planos, e o uso é dentro
do produto (o logo ao lado do ticker, como a licença deixa "exibir os dados para os seus usuários"), mas a cópia guardada e servida do nosso
domínio pode ser lida como redistribuição. O que reduz o risco: a rota que entrega o SVG é **interna** (com o segredo do servidor; nenhuma
rota pública entrega o logo nem a lista), o site o mostra só ao lado do ticker, e o logo é marca da empresa dona, não um dado da brapi. Se a
brapi ou o orientador disserem que não pode, as saídas são as alternativas abaixo (o monograma não pede código novo: é o que o site mostra
sem logo).

## Alternativas consideradas

- **Buscar direto da brapi no navegador** (`<img src="https://icons.brapi.dev/...">`): descartada. Cada visitante mandaria o próprio IP (e o
  `Referer` da página) à brapi e ao GitHub Pages, e a política de privacidade teria de dizer isso; o site ficaria preso à disponibilidade e
  ao conteúdo de um host de terceiros, servido sem nenhuma conferência, e a CSP do site teria de abrir o `img-src` para fora.
- **Só o monograma** (as iniciais do ticker, sem logo nenhum): descartada pelo Artur, que quer o logo como o Rallies. Fica como o que o
  site mostra quando o papel não tem logo.
- **Reconferir o SVG ao servir** (na rota de um logo): descartada no item 7 (a lista e a rota discordariam; a reconferência da passada
  cobre a regra nova, e o `<img>` e a CSP cobrem o que está no banco).
- **Uma biblioteca de saneamento de SVG** (DOMPurify com jsdom, por exemplo): descartada. Traria um DOM inteiro (dependência nova e grande)
  para uma tarefa que um leitor pequeno faz recusando tudo o que um logo não usa; a regra do projeto é perguntar antes de dependência nova, e
  recusar (o monograma) é mais seguro que reescrever o SVG.
- **Guardar no Blob** em vez do banco: descartada. São uns 500 KB no total; o banco já é o cache da brapi (ADR 0032), entra no backup, e a
  rota interna lê numa consulta, sem container novo nem papel novo na infra (ADR 0030).
