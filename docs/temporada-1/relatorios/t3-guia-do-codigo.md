# T3 — Guia do código: relatório

Tarefa `task_e60763d7ae32` da onda "Temporada 1 real e Playbook" (`run_590c8dd286c3`), 06/11/2026. Especificação:
`.data/orquestracao/temporada/t3-guia-do-codigo.md`.

## O que foi feito

- **`docs/GUIA-DO-CODIGO.md`** (939 linhas, 245 referências `caminho#símbolo`): o mapa de 10 minutos (pastas, os 12 módulos da api e as
  telas); uma requisição de ponta a ponta (lançar uma compra na carteira, em 18 saltos, do toque ao Postgres e de volta) e o ciclo diário
  da arena (agendador, fila, handler, gateway de LLM, validação, liquidação e revalidação); as 25 perguntas do guia da prova de autoria,
  cada uma com a resposta, as referências e o "por quê? e se…?" com os ADRs; o "como rodar do zero" conferido; o roteiro da mudança ao
  vivo (o campo de observação no lançamento, camada por camada, sem implementar); cinco bugs reais com sintoma, causa, correção e teste;
  o que ainda não rodou de verdade; e o histórico dos seis commits e o processo.
- **`scripts/guia-check.mjs`**: lê o guia, acha cada trecho de código em linha `caminho#símbolo` (o caminho com uma barra ou um ponto) e
  falha se o arquivo não existe, se não é arquivo, se está fora do repositório ou se o símbolo não aparece nele. Um símbolo com cara de
  identificador vale só como palavra inteira (`call` não é achado em `callBudget`); outro texto é procurado como está. Ignora os blocos
  cercados. Sai com 0, 1 (alguma quebrada, ou nenhuma referência) ou 2 (erro de leitura), como o `docs-check`.
- **`scripts/guia-check.test.mjs`**: 14 testes em `node:test`, no estilo do `docs-check.test.mjs` (repositório de mentira num diretório
  temporário, mais a linha de comando por `spawnSync`). **Escrito antes do script** (TDD): a primeira execução falhou porque o módulo não
  existia, e só então veio o script.
- **Não mexi** no `package.json` (o fechamento liga o script ao `pnpm check`). O teste já entra no `pnpm test` sozinho, pelo glob
  `scripts/*.test.mjs`.

## Critérios de aceite

### 1. As 25 perguntas respondidas, cada uma com pelo menos uma referência que o `guia-check` aprova

Contagem das referências dentro do bloco de cada pergunta (a mesma expressão do `guia-check`, por título `#### N.` da seção 3):

```
perguntas: 25 | sem referência: nenhuma
1:5 2:2 3:10 4:5 5:8 6:3 7:4 8:1 9:5 10:6 11:6 12:7 13:3 14:6 15:7 16:4 17:8 18:3 19:5 20:3 21:4 22:2 23:3 24:1 25:3
```

E todas valem: `node scripts/guia-check.mjs` → `guia-check ok: 245 referências conferidas em docs/GUIA-DO-CODIGO.md` (saída 0). O
`guia-check` também serviu de revisão do próprio guia: no primeiro rascunho ele achou 6 referências erradas (o exemplo da introdução e
caminhos abreviados como `auth.ts#cookiePrefix`), todas corrigidas.

Além da existência, conferi o **sentido** de cada afirmação lendo o código, e corrigi o que não batia: só os modelos têm linha em
`decision` (o Sorteio é sorteado na liquidação, `settlement-plan.ts`); a `/arena` também lê as barras do BOVA11 por rota interna; o CDI
usa a última taxa publicada (`rateOnOrBefore`); o aviso de cota cega da brapi é de cinco respostas sem o cabeçalho e nenhuma com ele (não
"seguidas"); a nota do scrypt está na seção 11 do `CONTA.md`; e tirei uma inferência minha sobre como o bug 6.5 foi achado (o ADR não diz).

### 2. O `guia-check` passa no guia, o teste passa, e a falha de verdade com uma referência quebrada

- `node --test scripts/guia-check.test.mjs` → `tests 14 · pass 14 · fail 0`.
- **A falha, sobre o repositório real**: uma raiz temporária no scratchpad com links simbólicos para `apps`, `packages`, `infra`, `scripts`,
  `.github` e os arquivos da raiz, e uma cópia do guia com dois erros (o símbolo `bootstrap` trocado por `bootstrapApp` e o arquivo
  `id.ts` por `ids.ts`). O guia de verdade não foi tocado.

  ```
  $ node scripts/guia-check.mjs <scratchpad>/demo-quebrada
  guia-check falhou: 5 de 244 referências quebradas em docs/GUIA-DO-CODIGO.md

    linha 9: `apps/api/src/main.ts#bootstrapApp`  o símbolo não aparece no arquivo
    linha 32: `apps/api/src/main.ts#bootstrapApp`  o símbolo não aparece no arquivo
    linha 140: `apps/api/src/common/ids.ts#newId`  o arquivo não existe
    linha 286: `apps/api/src/main.ts#bootstrapApp`  o símbolo não aparece no arquivo
    linha 355: `apps/api/src/common/ids.ts#newId`  o arquivo não existe
  exit 1
  $ node scripts/guia-check.mjs
  guia-check ok: 244 referências conferidas em docs/GUIA-DO-CODIGO.md
  exit 0
  ```

  (244 naquela hora; depois entrou mais uma, no bug 6.1, e o guia está com 245.)
- **O teste pega um checker quebrado**: numa cópia mutante do script no scratchpad, com o "símbolo aparece" sempre verdadeiro, o mesmo teste
  dá `pass 12 · fail 2` ("símbolo que não aparece no arquivo falha" e "um identificador vale só como palavra inteira").

### 3. O "como rodar do zero" conferido, com o que faltou no README e no `CLAUDE.md`

Tudo no checkout atual, com o `az` falso no `PATH` e a guarda de rede no `NODE_OPTIONS`. O plano do que rodar foi combinado com o
coordenador (`ask` respondido: "Ok, o plano está certo").

| Comando | Resultado |
|---|---|
| `nvm use` (no mesmo terminal) | `node -v` → v26.13.0 (o `.nvmrc` diz 26.13.0) |
| `pnpm -v` | 12.16.1, o do `packageManager` |
| `docker compose ps` / `config --services` / `--profiles` | `alvesting-postgres-1` (healthy, 127.0.0.1:25432) e `alvesting-azurite-1` (127.0.0.1:25100) de pé; serviços `azurite`, `postgres`, `servicebus`; profile `servicebus` |
| `createdb alvesting_t3_test` e `DATABASE_URL=…/alvesting_t3_test pnpm --filter @alvesting/api migrate:deploy` | `All migrations have been successfully applied.` (22, num banco vazio) |
| `prisma migrate status` e `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script` | `Database schema is up to date!` e `-- This is an empty migration.` |
| `turbo run dev --dry=json` | as tarefas do `pnpm dev`: `api#generate`, `contracts#build`, `api#dev` (`nest start --watch`), `contracts#dev` (`tsc --watch`), `web#dev` (`next dev` na 4300) |
| A api compilada (`node --env-file-if-exists=../../.env.example dist/main.js`, porta 4320, banco do passo acima, sem o `.env.local`) | `/api/v1/health` 200 `{"success":true,"data":{"status":"ok","service":"api"},"error":null}`; `/health` 200; `/api/docs` 200; `/api/v1/me/portfolio` 401 `UNAUTHORIZED`; `/api/v1/seasons?x=1` 400 `VALIDATION_ERROR` (`unrecognized_keys`). Processo parado; a 4320 ficou livre |
| `pnpm docs:check` | `docs:check ok: 92 itens documentados em docs/DEPENDENCIAS.md` |
| Os testes da carteira, um diretório por vez (`TEST_DATABASE_URL=…/alvesting_t3_test`) | api: `src/modules/portfolio` e `settlement/domain/portfolio.spec.ts`, 3 arquivos e 114 testes verdes; contratos: `portfolio.spec.ts` e `portfolio-rules.spec.ts`, 2 arquivos e 107 testes verdes |

**Não rodados, de propósito** (e conferidos no código): o `pnpm install` (outro processo, `pnpm install` no Node 20, instalava no mesmo
checkout naquela hora); o `db:roles` (faz `nest build` no `dist` que a demo usa pelo `nest start --watch` e troca a senha do papel
`alvesting_api`, que é do **servidor** Postgres inteiro: derrubaria a demo, como o coordenador confirmou); o `pnpm dev` (as portas 4300 e
4310 são da demo, e o `next dev` trava a pasta `.next/dev`); o `playwright install` (baixa da rede; os navegadores já estavam no cache);
o `pnpm check` inteiro (uma execução pesada por vez; fica para o fechamento).

**O que faltou no README e no `CLAUDE.md`** (para quem é dono deles; o README é da T2 nesta onda):
1. **Ter dados na tela**: depois do `migrate:deploy` o `alvesting_dev` está vazio e o site abre sem temporada. Nenhum dos dois diz como
   apontar o `pnpm dev` para um banco com dados (a carga da brapi pede o token; o `arena:ensaio` apaga e recria o `alvesting_ensaio`, que
   é o banco da demo).
2. **Rodar um arquivo de teste só**: o `vitest run <arquivo>` direto, num clone novo, precisa antes de `pnpm --filter @alvesting/api
   generate` e `pnpm --filter @alvesting/contracts build` (o `src/generated` e o `dist` ficam fora do git; o `pnpm test` só funciona
   porque o Turborepo faz isso antes). É o que se faz numa mudança ao vivo.
3. **O `nvm use` vale só para o terminal em que rodou**: num subshell (eu caí nisso num `|`), o Node volta ao padrão do Mac (v20.19.5), e o
   pnpm dele falha com "Failed to switch pnpm to v12.16.1". O README manda instalar o pnpm dentro do Node 26, mas não mostra o erro.
4. **O `db:roles` mexe num papel do servidor**, não de um banco: o README o põe no passo a passo sem dizer isso (o ADR 0028 diz).
5. **A tabela "Testar" do README** diz que o `pnpm test` roda o Vitest dos contratos e da api; ele roda também o do site
   (`apps/web`, `vitest run --dir src`). E o e2e tem seis projetos: os três escuros rodam só os testes `@tema`
   (`apps/web/playwright.config.ts`); o README e o `CLAUDE.md` falam dos três claros.

### 4. O roteiro da mudança ao vivo cita os arquivos certos de cada camada

Cada arquivo do roteiro existe (o `guia-check` confere) e cada afirmação foi conferida no código:
- **Banco**: o `UPDATE` do `portfolio_lot` é **por coluna** (`GRANT UPDATE ("ticker", "quantity", "cost_cents", "bought_on",
  "updated_at")` na migration `20261103130000_portfolio`), então a coluna nova pede `GRANT UPDATE ("note")`; o `SELECT` e o `INSERT` são da
  tabela inteira e já cobrem a coluna nova. A matriz `table-policy.ts` (`apiColumns.UPDATE`) e o `api-role.integration.spec.ts`, que compara
  o catálogo com ela.
- **Contrato**: `lotBodySchema` (com `transform`) e `lotSchema` em `portfolio.ts`; o export da LGPD usa o mesmo `lotSchema`
  (`account.ts`, `portfolioLots: z.array(lotSchema)`); o limite em `portfolio-rules.ts`, o módulo sem zod que o navegador lê. A regra do
  NUL (recusar na entrada, nunca 500) vem do `CLAUDE.md`, e o nome do cadastro já faz o mesmo (`\p{Cc}` em `auth.ts`).
- **Repositório**: o `replace` é SQL escrito à mão (`UPDATE ... SET ... RETURNING`), a coluna tem de entrar nos dois; o `LOT_SELECT`, o
  `LotRow` e o `create` do `add`; o `toLot` do serviço; o `LotRecord` do domínio.
- **Swagger**: o controller gera o schema do Zod (`schemaOf` com `z.toJSONSchema`), então não muda.
- **LGPD**: o `user-data.ts` (o `select` do export) e o teste `user-data.spec.ts` que reprova a coluna sem decisão; a política de
  privacidade lista os campos da carteira (texto livre é dado pessoal novo: versão nova e novo aceite pelo `ConsentGuard`); o backup já
  exclui os dados da tabela (`personal: true`).
- **Site**: `lotView` na página (só o que a tela usa vai ao navegador), `LotView` e `LotForm` em `wallet-lots.tsx`, `LotDraft`, `LotBody`,
  `checkLot`, `FIELD_OF` e `API_FIELD_ERRORS` em `wallet-client.ts`; o lançamento aparece num cartão com `Fact`, e não na tabela de posições
  (`WalletPositions` soma por ticker).
- **Testes**: `portfolio.spec.ts` (contratos), `portfolio.integration.spec.ts` (o `describe` do PATCH), `api-role.integration.spec.ts`,
  `me.integration.spec.ts` (o export, que já confere `portfolioLots`), `wallet-client.spec.ts`, `wallet-lots.spec.tsx`, o `page.spec.tsx` da
  carteira, o `carteira.spec.ts` e o `carteira-support.ts#addLot` do e2e. Rodei os da carteira (critério 3) para confirmar os comandos.

## Desvios

- **Os bugs da pergunta 24.** Dos quatro exemplos da especificação, contei os três que têm registro: a cota da brapi (`DADOS.md`, o
  `brapi.client.ts` e o teste; commit `1330645`), o `rxjs` içado (`docs/redesign-premium/relatorios/fundacao.md`, seção 5, e o
  `packageExtensions`) e o token do `az` (fonte dada pelo coordenador: o `apps/api/vitest.config.ts` e o `cache-refresher.spec.ts`, de
  03/11/2026, no commit `5a254da`). **A guarda de rede que só barrava por nome ficou de fora**, por decisão do coordenador: era a ferramenta
  de conferência dele (`.data/guardas`, fora do projeto), não código do projeto, e não achei registro dela. Entraram dois que têm registro:
  a fita pela metade (revisão de código da onda ASCII, achado 1, com a correção e o teste) e a barra absurda que derrubava a carteira
  (ADR 0031, item 1, com o teste).
- **A api do "rodar do zero" subiu do `dist` da demo** (o `nest start --watch` dela o mantém), sobre um banco meu e sem o `.env.local`;
  não fiz build.
- **O "Uso de IA"**: o guia diz em uma frase que o código foi escrito com agentes sob a direção do Artur e remete ao texto oficial do
  README (da T2, para o Artur revisar).

## O que fica para o fechamento da onda

- **Ligar o `guia-check` ao `pnpm check`** (o `package.json` não é meu) e rodá-lo de novo depois da T0 e da T2: as duas estão mexendo, agora,
  em arquivos que o guia cita (`apps/api/vitest.config.ts`, `cycle-schedulers.ts`, `arena.repository.ts`, `table-policy.ts`,
  `packages/contracts/src/cycle.ts` e `public.ts`). Na minha última execução, todas as 245 referências valiam.
- **As partes "em construção"** a atualizar: a linha do `apps/api/seasons` no mapa (o `temporada-1.json` no lugar do rascunho); o
  parágrafo da T0 no fim da seção 2.2 (o `cycle.mode`, o `executed_at`, o `arena:retroativo` e o `arena:operar`); a pergunta 8 (a última
  migration passa a ser a da T0, hoje `20261106120000_retroactive_cycles`, ainda fora do git); a 1 (o C4 do `docs/ARQUITETURA.md`); a 18 (o
  `pnpm coverage` e o `docs/QUALIDADE.md`); a 21 (o job de cobertura e o SonarCloud); a 22 (o operador local); a seção 7 (a Temporada 1
  real); e a seção 8 (o texto do README sobre o uso de IA). Também a contagem de "22 migrations" do mapa.
- **As cinco lacunas do README e do `CLAUDE.md`** do critério 3, para quem é dono deles.

## Guardas, bancos e processos

- `PATH` com o `az` falso, `NODE_OPTIONS=--import .data/guardas/net-guard.mjs`, `NET_GUARD_LOG=.data/guardas/t3-guia-rede.log` em todo
  comando com Node. No fim: `.data/guardas/az-stub/calls.log` com **0 linhas** (0 no começo), e o `t3-guia-rede.log` **nem foi criado**
  (a guarda só escreve quando barra).
- Nenhuma chamada de rede além do loopback. Não li o `.env.local` nem o `.data/prompts/`.
- O banco `alvesting_t3_test` foi criado para o "rodar do zero" e os testes, e **apagado no fim** (`dropdb`, sem conexão aberta). Não
  toquei o `alvesting_dev`, o `alvesting_ensaio`, o `alvesting_temporada` nem a demo (4300 e 4310).
- A api na 4320 foi parada; nenhum servidor meu ficou de pé. Não usei a trava pesada (só testes de arquivo único, `docs:check` e o
  `guia-check`).
- Arquivos de trabalho fora do repositório, no scratchpad da sessão: a raiz da demonstração da falha (`demo-quebrada`), o mutante do
  script (`mutante`) e o log da api da 4320.

## Arquivos tocados

- `docs/GUIA-DO-CODIGO.md` (novo)
- `scripts/guia-check.mjs` (novo)
- `scripts/guia-check.test.mjs` (novo)
- `docs/temporada-1/relatorios/t3-guia-do-codigo.md` (este relatório, novo)
