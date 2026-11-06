# Relatório da T2b (a0): a rota interna da fita de cotações

Tarefa `task_6b66ddff1558`, 04/11/2026. Só api, contratos e a leitura no site; nada de tela. Plano: `docs/redesign-ascii/plano.md`, seções
4.4 e 8 (item 3). Sem commit nem `git add`: o trabalho está fora do índice.

## O que foi feito

1. **A rota** `GET /api/v1/interno/fita`, no controlador das cotações (`apps/api/src/modules/quotes/presentation/quotes.controller.ts`),
   irmã de `/interno/barras/:ticker`: o mesmo `QuotesSecretGuard` na classe (o `QUOTES_SECRET` conferido em tempo constante; sem ele ou com
   o errado, o 404 da rota que não existe), `Cache-Control: no-store`, fora do Swagger (`@ApiExcludeController`), `/interno/` no caminho,
   `noQuerySchema` (parâmetro de query é 400, depois do guard) e a resposta validada pelo schema estrito antes de sair.
2. **A consulta** `QuotesRepository.tape()` (`apps/api/src/modules/quotes/infrastructure/quotes.repository.ts`), seis leituras do Prisma
   com as colunas listadas: a temporada atual (`findPublicSeason`, a mesma do `arena/current`), o último ciclo dela, o universo congelado da
   semana ISO desse ciclo (membros na ordem da posição, com o ticker), o pregão mais recente com barra até o do ciclo, o pregão anterior com
   barra, e os fechamentos desses dois pregões.
3. **O contrato** em `packages/contracts/src/internal.ts`: `internalTapeSchema`, `internalTapeRowSchema`, `INTERNAL_TAPE_LIMIT` (500) e os
   tipos `InternalTape` e `InternalTapeRow`; o spec em `internal.spec.ts`.
4. **A migration** `apps/api/prisma/migrations/20261104120000_api_role_universe_read/migration.sql`: só
   `GRANT SELECT ON "universe_snapshot", "universe_member" TO "alvesting_api_group"` (o mesmo padrão da `20261103100000_api_role`; sem
   `ALTER DEFAULT PRIVILEGES`, sem mexer em dado). Aplicada no `alvesting_dev` com `migrate:deploy`. **Não** aplicada no `alvesting_ensaio`.
5. **A matriz** `apps/api/src/infrastructure/database/table-policy.ts`: `universe_snapshot` e `universe_member` passam a `api: ['SELECT']`,
   com o porquê (a fita); teste novo no `table-policy.spec.ts`. O `api-role.integration.spec.ts` não mudou: ele compara o catálogo com a
   matriz, tabela a tabela.
6. **O site**: `readTape()` em `apps/web/src/lib/quotes.ts`, o único módulo que lê o segredo. O miolo de `readBars` (o segredo e o endereço
   conferidos antes do `fetch`, o cache de dados com a tag `arena` e os 300 s, o 404 virando 502 `QUOTES_REFUSED`) virou `readInternal`,
   usado pelas duas; `readBars` não mudou de comportamento. Testes novos em `quotes.spec.ts`. Nenhuma página nem componente foi tocado.
7. **`infra/tests/check.mjs`**: `/api/v1/interno/fita` no `NEVER_CACHED` (o teste lê o controlador e reprova a divergência).
8. **Docs**: `docs/API.md` (a introdução, a seção 2, "Como o site lê", a seção 4 com a medida da consulta e a seção 6, com o item "A fita da
   home" e o papel do banco); `docs/INFRA.md` (2.2: a migration nova; 2.5, 2.6, 2.7, 3.3 e 7.1 passam a citar as duas rotas internas); a
   frase das rotas internas no `CLAUDE.md`.

## A resposta, exatamente (o que a T2 consome)

```
GET /api/v1/interno/fita            (sem parâmetro de query)
Authorization: Bearer <QUOTES_SECRET>
X-Azure-FDID: <FRONT_DOOR_ID>       (quando houver; o call() de lib/api.ts já manda)

200, Cache-Control: no-store
{
  "success": true,
  "data": {
    "date": "2026-11-04",
    "rows": [
      { "ticker": "VALE3", "closeCents": 6100, "previousCloseCents": null },
      { "ticker": "PETR4", "closeCents": 3200, "previousCloseCents": 3100 },
      { "ticker": "WEGE3", "closeCents": 5100, "previousCloseCents": 5000 }
    ]
  },
  "error": null
}
```

- **Quais papéis**: o universo da semana ISO do **último ciclo da temporada atual** (a em andamento; sem ela, a última encerrada; rascunho
  não conta), isto é, os papéis que o briefing deu a todos os modelos naquela semana. Nunca o universo de outra semana.
- **Ordem**: a do universo, posição 1 primeiro (maior volume financeiro médio dos 60 pregões da janela). Estável: a posição é única no
  universo (`@@unique([snapshotId, position])`).
- **`date`**: o pregão mais recente com barra de algum papel do universo **até o pregão do ciclo, inclusive**. De manhã, antes da barra do
  dia, é o pregão anterior (o fechamento que o briefing deu aos modelos); depois do fechamento e do `eod`, o do próprio ciclo; numa
  temporada encerrada, o último pregão dela (barra de depois não entra).
- **`closeCents`**: o fechamento do papel no pregão `date`, em centavos (inteiro). O papel **sem barra nesse pregão fica de fora** (a fita
  não mostra fechamento velho como se fosse do dia). Por isso `rows.length` pode ser menor que o universo, em geral por pouco (o briefing
  exige 80% de cobertura do último pregão).
- **`previousCloseCents`**: o fechamento do papel no pregão anterior com barra no universo; **nulo** se o papel não tem barra nesse pregão
  (a regra da variação do briefing, `changeBps`: nunca a variação de dois pregões). A variação é `variationBps(close, previous)`, como a
  `quoteText` da T2 já faz.
- **No máximo 500 linhas** (`INTERNAL_TAPE_LIMIT`, o teto do universo, `UNIVERSE_RULES.maxMembers`).
- **A resposta vazia**, 200 e `no-store`: `{ "date": null, "rows": [] }`, sem temporada pública, sem ciclo (antes do primeiro pregão da
  temporada), sem o universo da semana do último ciclo ou sem barra até ele. O contrato exige `date` se e só se há linha.
- **Tipos** (`@alvesting/contracts`): `InternalTape` e `InternalTapeRow`, a mesma forma do `TapeQuote` de `apps/web/src/lib/fita.ts`
  (`{ ticker, closeCents, previousCloseCents: number | null }`).

**A função que a T2 chama**: `readTape(deps?: QuotesDeps): Promise<InternalTape>`, de `apps/web/src/lib/quotes.ts` (só servidor), em
paralelo com as outras leituras da home:

```ts
import { readTape } from '../lib/quotes';
const [current, tape /* , ... */] = await Promise.all([reader().arenaCurrent(), readTape() /* , ... */]);
if (tape.date === null) {
  // sem a a0: a fita do BOVA11 e do macro, com a outra legenda (plano, 4.4)
} else {
  // `Os mesmos ${tape.rows.length} papéis da B3, lidos por todos os modelos. Cotações: brapi.dev, pregão de ${dd/mm/aaaa de tape.date}.`
  // tape.rows.map(quoteText)
}
```

Os erros são os de `readBars`: o 404 da rota (o segredo do site não é o da api) vira `ApiError` 502 `QUOTES_REFUSED`; o segredo ausente,
curto ou torto, ou o `API_INTERNAL_URL` sem `https` em produção, viram `ApiError` 503 `QUOTES_UNCONFIGURED` (sem chamar a api); 5xx, rede e
prazo seguem como os de toda leitura; resposta fora do contrato é 502 `INVALID_RESPONSE`. A resposta vazia **não** é erro.

## Critérios de aceite, com a evidência

Todos os comandos com o az falso e a guarda de rede das regras comuns (`PATH=.data/guardas/az-stub:$PATH`,
`NODE_OPTIONS=--import .data/guardas/net-guard.mjs`, `NET_GUARD_LOG=.data/guardas/fita-rede.log`) e
`TEST_DATABASE_URL=postgresql://alvesting:alvesting@localhost:25432/alvesting_fita_test`.

| Critério | Evidência |
|---|---|
| Com o segredo, 200 no schema do contrato | `quotes.integration.spec.ts`, "a fita, com o segredo": a resposta passa por `envelopeSchema(internalTapeSchema)`, com o universo da semana do último ciclo, na ordem, o fechamento e o anterior; o papel sem barra no pregão fica de fora; o anterior é nulo sem barra no pregão anterior; antes da barra do dia, o pregão anterior; a temporada encerrada para no último pregão dela; a temporada em andamento vence a encerrada e o rascunho |
| Sem o segredo ou com o errado, o mesmo 404 da rota que não existe, nos dois casos | `it.each(refusals)` "a fita ...": sem cabeçalho, segredo errado, segredo menos um caractere, em `Basic`, em outro cabeçalho: corpo `Cannot GET /api/v1/interno/fita` no envelope e os mesmos cabeçalhos de `/api/v1/interno/nao-existe`; HEAD sem corpo; a api sem `QUOTES_SECRET` dá 404 a todos; o segredo errado com `?x=1` é 404, não 400 |
| `no-store` | conferido em toda resposta da fita (200, 400 e 404) e no metadado do controlador (o teste genérico vale para toda rota nova) |
| Fora do Swagger | o `/api/docs-json` não cita `interno`, `barras` nem `fita`; o metadado `swagger/apiExcludeController` na classe |
| Sem ciclo, a resposta vazia | `it.each` "a resposta vazia (200, no-store), nunca 404 nem 500": sem temporada, só rascunho, temporada sem ciclo, semana sem universo, universo sem barra até o ciclo |
| `table-policy.spec.ts` e `api-role.integration.spec.ts` verdes | os dois verdes; e a prova do contrário: com o `SELECT` revogado no banco de teste, a rota respondeu 500 (`permission denied`) e o `api-role.integration.spec.ts` reprovou `universe_snapshot` e `universe_member` (4 falhas); concedido de novo, verde |
| `migrate status` em dia no teste e no dev | `prisma migrate status`: "Database schema is up to date!" no `alvesting_fita_test` e no `alvesting_dev` (este depois do `pnpm --filter @alvesting/api migrate:deploy`, que aplicou só a `20261104120000_api_role_universe_read`). No dev, o `alvesting_api` tem `SELECT` e não `INSERT` nas duas tabelas |
| `migrate diff` vazio | `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`: "-- This is an empty migration." nos dois bancos |
| Testes da api verdes | `pnpm --filter @alvesting/api test` (a suíte inteira, com o banco `alvesting_fita_test` e o Azurite): 151 arquivos verdes e 2 pulados (153), 3.007 testes verdes e 9 pulados, saída 0, 331 s. Os 2 pulados são os opcionais por desenho (`REAL_DATA_TESTS=1`, os arquivos reais da CVM, e `SERVICEBUS_EMULATOR=1`), não os desta tarefa. A suíte incluiu o trabalho em andamento das outras tarefas, que estava verde nessa hora |
| Testes dos contratos verdes | `pnpm --filter @alvesting/contracts test`: 13 arquivos, 497 testes, verdes |
| `lib/quotes.spec.ts` verde | `vitest run src/lib/quotes.spec.ts`: 51 verdes (9 novos de `readTape`); com o `quotes-boundary.spec.ts`, 55 |
| `check.mjs` verde | `node infra/tests/check.mjs`: "97 de 97 verificações passaram" (antes do `NEVER_CACHED`, 96 de 97: "NEVER_CACHED e as rotas do controlador de cotações divergem") |
| Typecheck e lint da api e dos contratos | `tsc --noEmit` e `eslint .` limpos nos dois; `prettier --check` limpo nos arquivos tocados; `eslint` limpo em `lib/quotes.ts` e `lib/quotes.spec.ts` do site, e o `tsc` do site não acusa nada neles (o único erro do site é `src/app/layout.tsx`, `Rule`, da T2 em andamento) |
| Nenhuma linha nova no `calls.log` do az falso; guarda de rede vazia | `.data/guardas/az-stub/calls.log`: 0 linhas antes e depois. `.data/guardas/fita-rede.log`: nunca criado (a guarda só o cria ao barrar uma conexão), com todos os comandos acima rodando sob ela (o `migrate` com `CHECKPOINT_DISABLE=1`) |
| Teste antes do código | vermelhos vistos antes de cada implementação: contrato (6 falhas), rota e matriz (12), `readTape` (9), `check.mjs` (1) |

## Decisões (o que a especificação deixou em aberto)

1. **"O último ciclo" é o da temporada atual** (`findPublicSeason`, a mesma do `arena/current` e da pílula do hero), em qualquer estado
   (aberto, fechado ou pulado: o universo da semana é o mesmo).
2. **A data vai até o pregão do ciclo, inclusive**, e não só até o anterior: depois do fechamento, a fita mostra o fechamento do dia (o que
   a liquidação usou), igual à faixa do BOVA11 e ao rodapé, que leem a barra mais recente. De manhã ela coincide com o briefing. O limite no
   pregão do ciclo é o que faz a temporada encerrada parar no último pregão dela, com o universo inteiro daquela semana.
3. **O anterior é o do pregão anterior com barra no universo**, nulo para o papel sem barra nele (a regra do `changeBps` do briefing). A
   alternativa, a última barra do papel antes da data (o `bars.at(-2)` do BOVA11 na home), daria a variação de dois pregões ao papel que
   pulou um.
4. **O papel sem barra no pregão da fita fica de fora**, e não entra com o fechamento velho.
5. **`date` existe se e só se há linha** (um `refine` no contrato): a legenda nunca lê "pregão de null", e a linha nunca fica sem pregão.
6. **O teto de 500** é o do universo. O contrato não importa da api, então um teste da rota (sem banco) prende
   `INTERNAL_TAPE_LIMIT === UNIVERSE_RULES.maxMembers`.
7. **Seis leituras do Prisma**, sem SQL à mão: medidas num banco sintético do tamanho da produção (800 papéis, 500 no universo, 65
   pregões, 52 mil barras): 0,10 e 0,05 ms para os dois pregões, 0,34 ms para os fechamentos, 0,36 ms para o universo, 0,03 ms para o
   ciclo (`docs/API.md`, seção 4). O teto e a saída estão num `ponytail` no repositório.

## Desvios

- `docs/INFRA.md`: além da 2.2 (que não tem a matriz tabela a tabela, só as migrations que mexem no papel: entrou a nova), atualizei as
  menções à rota interna em 2.5, 2.6, 2.7, 3.3 e 7.1, que diziam "a rota" e citavam só as barras. `check.mjs` verde depois (ele lê a 2.7).
- `docs/API.md`: além da seção 6, a introdução, a seção 2 e a seção 4 (a medida).
- `readBars` foi refatorado para `readInternal` (o comportamento é o mesmo: os 42 testes dele seguem verdes, sem mudança).
- O `prettier --write` reformatou só as linhas que acrescentei nos três specs.
- `packages/contracts/dist` foi recompilado (`pnpm --filter @alvesting/contracts build`, fora do git) para a api e o site verem os
  exports novos. É aditivo.

## Pendências para a T2 e para o coordenador

1. **A demo.** A api da demo (4310) roda em `nest start --watch`, então já tem a rota nova; o `alvesting_ensaio` não recebeu a migration (de
   propósito). Se a demo atende com o login `alvesting_api`, `GET /interno/fita` responde 500 (`permission denied for table
   universe_snapshot`) até o banco ser recriado (o `arena:ensaio` aplica todas as migrations) ou receber o `migrate:deploy`. A rota das barras
   segue igual.
2. **O e2e da home (T2).** A api falsa das telas (`apps/web/e2e/fixture-api.ts`) só responde `/interno/barras/:ticker`. Quando a home
   chamar `readTape()`, ela precisa de um `/interno/fita` (com o mesmo `Bearer ${QUOTES_SECRET}`, e `notFound()` sem ele), senão a home dos
   testes da api falsa vira a tela de erro (404 vira `QUOTES_REFUSED`). A api de verdade do e2e (o banco semeado pelo driver do ensaio, com
   todas as migrations) já responde a fita.
3. **O tamanho no HTML.** Em produção o universo tem uns 300 papéis (até 500): a fita inteira são uns 300 × 25 caracteres, duas vezes no
   trilho e uma no `sr-only`. Cortar (os N primeiros, que já vêm em ordem de volume) é decisão da T2, pelo LCP.
4. **Antes do primeiro ciclo de uma temporada** a fita é vazia: a home cai na fita sem a a0.
5. **Licença (para o Artur e o orientador).** A fita exibe o fechamento de um pregão de cada papel do universo, na home: é o "exibir" que a
   licença da brapi deixa, e a rota da api segue fechada a terceiros. Quem raspar a home todo dia monta a série dos fechamentos do universo,
   como de qualquer página que exibe cotação. Ficou escrito no item "A fita da home" do `docs/API.md`, seção 6. Se for julgado "base bruta",
   a saída menor é a fita só com os primeiros papéis do universo.

## Arquivos tocados

- `apps/api/src/modules/quotes/presentation/quotes.controller.ts`
- `apps/api/src/modules/quotes/presentation/quotes.integration.spec.ts`
- `apps/api/src/modules/quotes/infrastructure/quotes.repository.ts`
- `apps/api/src/modules/quotes/quotes.module.ts` (só o comentário)
- `apps/api/src/infrastructure/database/table-policy.ts`
- `apps/api/src/infrastructure/database/table-policy.spec.ts`
- `apps/api/prisma/migrations/20261104120000_api_role_universe_read/migration.sql` (novo)
- `packages/contracts/src/internal.ts`
- `packages/contracts/src/internal.spec.ts`
- `apps/web/src/lib/quotes.ts`
- `apps/web/src/lib/quotes.spec.ts`
- `infra/tests/check.mjs`
- `docs/API.md`
- `docs/INFRA.md`
- `CLAUDE.md` (a frase das rotas internas)
- `docs/redesign-ascii/relatorios/fita.md` (este relatório)

Fora do git: o `alvesting_dev` recebeu a migration; o banco `alvesting_fita_test` foi apagado no fim.
