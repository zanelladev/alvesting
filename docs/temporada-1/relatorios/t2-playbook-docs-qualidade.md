# T2: Playbook, documentação obrigatória, Wiki, cobertura travada e SonarCloud (06/11/2026)

Tarefa T2 da onda "Temporada 1 real e Playbook". Fecha o que a linha **Web Apps** e o núcleo comum do Portfolio Playbook da Católica SC pedem e
que não depende de conta externa: a documentação mínima (requisitos, user stories, C4, instruções de deploy), a Wiki gerada do `docs/`, a
cobertura medida e travada no projeto, a análise estática pronta para ligar e um checklist de conformidade honesto. Nenhuma chamada a
serviço externo além da exceção da tarefa (o `gh api` só de leitura na release da action do SonarCloud e a documentação pública do
SonarCloud).

## Resumo

- **Documentos novos:** `docs/REQUISITOS.md` (40 RF e 11 RNF, cada um com o código e o teste), `docs/USER-STORIES.md` (35 histórias por ator e
  quatro fluxos de negócio completos), `docs/ARQUITETURA.md` (o C4 em três níveis, as sequências dos três fluxos e a variante do operador
  local, em Mermaid), `docs/QUALIDADE.md` (como gerar o relatório, o que conta, as exclusões, os números, o TDD com exemplos, a análise estática,
  o SonarCloud e a Wiki) e `docs/CONFORMIDADE-PLAYBOOK.md` (cada item do Playbook com o status e a evidência, e os riscos do critério
  eliminatório).
- **`docs/DEPLOY.md`:** a seção "Como implantar (do zero, na ordem)", com os oito passos batidos contra o `deploy.yml`, o `scripts/deploy.mjs`,
  o `infra/` e o `docs/INFRA.md`; o `coverage` nos checks exigidos da `main`; o `SONAR_TOKEN` como único segredo do repositório; e o título
  e o texto do "Primeiro deploy", que ainda falavam da versão mínima.
- **Cobertura travada:** os três `vitest.config.ts` com o provedor `v8`, o `include` com todo o `src`, as exclusões comentadas, os relatórios
  `text-summary`, `json-summary`, `lcovonly` (com os caminhos a partir da raiz) e `html`, e os mínimos de linhas e instruções (api 75, contratos
  75, site 25). O `pnpm coverage` (`scripts/coverage.mjs`, com teste) recusa rodar sem as variáveis de integração, roda os três pelo turbo e
  imprime backend, contratos e frontend. A pasta `coverage/` entrou no `.gitignore` e no `.prettierignore`.
- **CI:** o job `coverage` no `ci.yml` (Postgres, Azurite e o cliente do PostgreSQL 17, como o `check`), com o `lcov` e o HTML como artefato
  e o SonarCloud só com o segredo `SONAR_TOKEN`, pela action fixada no SHA da release v8.4.1. `sonar-project.properties` na raiz.
- **Wiki:** `scripts/wiki.mjs` gera 61 páginas em `.data/wiki/` (Home, `_Sidebar`, um documento ou ADR por página), com o teste da reescrita
  dos links (`scripts/wiki.test.mjs`).
- **README:** as seções "O Playbook da Católica SC", "Referências e o que é nosso" e o rascunho de "Uso de IA no desenvolvimento" (para o
  Artur revisar), os documentos novos na lista, o `pnpm coverage` na tabela de testes e os scripts novos na estrutura.

## Os critérios de aceite, com a evidência

### 1. Cada RF e cada user story aponta para código e teste que existem

Conferido por um script fora do repositório (no scratchpad da sessão) que lê cada documento, acha cada caminho entre crases no repositório
(nas bases `apps/api/src/`, `apps/web/src/`, `apps/web/`, a raiz...) e acusa nome solto que exista em mais de um lugar, e procura cada título
de teste citado entre aspas dentro do spec citado:

| Documento | Caminhos | Títulos de teste | Problemas |
|---|---|---|---|
| `docs/REQUISITOS.md` e `docs/USER-STORIES.md` | 205 | 124 | 0 |
| `docs/ARQUITETURA.md` | 65 | 0 | 0 |
| `docs/QUALIDADE.md` | 53 | 0 | 0 (dois avisos de propósito: o `coverage-summary.json`, relatório gerado e fora do git, e o `page.tsx` genérico) |
| `docs/DEPLOY.md` | 24 | 0 | 0 |
| `docs/CONFORMIDADE-PLAYBOOK.md` | 27 | 0 | 0 (os 7 restantes são caminhos do repositório do Playbook, como devem ser) |
| `README.md` | 7 | 0 | 0 |

A primeira passada achou 19 problemas, todos de forma: caminhos curtos relativos ao módulo da mesma célula (`application/eod.handler.spec.ts`)
e três títulos quebrados no meio da linha. Ficaram com o caminho inteiro e o título numa linha só, e duas citações a `.data/orquestracao/` (fora
do git, o professor não veria) viraram o relatório versionado da T0. **A lista conferida, linha por linha** (os arquivos e os títulos de cada
requisito e de cada história; `ok` quer dizer que todos existem):

**docs/REQUISITOS.md**

- RF-01: 6 arquivos e 4 títulos de teste conferidos (ok)
- RF-02: 6 arquivos e 1 títulos de teste conferidos (ok)
- RF-03: 3 arquivos e 4 títulos de teste conferidos (ok)
- RF-04: 2 arquivos e 3 títulos de teste conferidos (ok)
- RF-05: 3 arquivos e 2 títulos de teste conferidos (ok)
- RF-06: 2 arquivos e 4 títulos de teste conferidos (ok)
- RF-07: 2 arquivos e 2 títulos de teste conferidos (ok)
- RF-08: 4 arquivos e 2 títulos de teste conferidos (ok)
- RF-09: 1 arquivos e 0 títulos de teste conferidos (ok)
- RF-10: 3 arquivos e 1 títulos de teste conferidos (ok)
- RF-11: 4 arquivos e 0 títulos de teste conferidos (ok)
- RF-12: 3 arquivos e 2 títulos de teste conferidos (ok)
- RF-13: 5 arquivos e 4 títulos de teste conferidos (ok)
- RF-14: 2 arquivos e 2 títulos de teste conferidos (ok)
- RF-15: 3 arquivos e 3 títulos de teste conferidos (ok)
- RF-16: 2 arquivos e 2 títulos de teste conferidos (ok)
- RF-17: 4 arquivos e 2 títulos de teste conferidos (ok)
- RF-18: 4 arquivos e 3 títulos de teste conferidos (ok)
- RF-19: 2 arquivos e 2 títulos de teste conferidos (ok)
- RF-20: 4 arquivos e 1 títulos de teste conferidos (ok)
- RF-21: 4 arquivos e 2 títulos de teste conferidos (ok)
- RF-22: 4 arquivos e 2 títulos de teste conferidos (ok)
- RF-23: 2 arquivos e 3 títulos de teste conferidos (ok)
- RF-24: 3 arquivos e 1 títulos de teste conferidos (ok)
- RF-25: 2 arquivos e 1 títulos de teste conferidos (ok)
- RF-26: 2 arquivos e 2 títulos de teste conferidos (ok)
- RF-27: 2 arquivos e 2 títulos de teste conferidos (ok)
- RF-28: 5 arquivos e 2 títulos de teste conferidos (ok)
- RF-29: 6 arquivos e 1 títulos de teste conferidos (ok)
- RF-30: 9 arquivos e 0 títulos de teste conferidos (ok)
- RF-31: 9 arquivos e 1 títulos de teste conferidos (ok)
- RF-32: 3 arquivos e 1 títulos de teste conferidos (ok)
- RF-33: 10 arquivos e 1 títulos de teste conferidos (ok)
- RF-34: 5 arquivos e 0 títulos de teste conferidos (ok)
- RF-35: 6 arquivos e 1 títulos de teste conferidos (ok)
- RF-36: 4 arquivos e 0 títulos de teste conferidos (ok)
- RF-37: 5 arquivos e 0 títulos de teste conferidos (ok)
- RF-38: 3 arquivos e 1 títulos de teste conferidos (ok)
- RF-39: 4 arquivos e 0 títulos de teste conferidos (ok)
- RF-40: 1 arquivos e 0 títulos de teste conferidos (ok)
- RNF-01: 17 arquivos e 4 títulos de teste conferidos (ok)
- RNF-02: 8 arquivos e 0 títulos de teste conferidos (ok)
- RNF-03: 8 arquivos e 2 títulos de teste conferidos (ok)
- RNF-04: 3 arquivos e 2 títulos de teste conferidos (ok)
- RNF-05: 4 arquivos e 1 títulos de teste conferidos (ok)
- RNF-06: 7 arquivos e 0 títulos de teste conferidos (ok)
- RNF-07: 4 arquivos e 0 títulos de teste conferidos (ok)
- RNF-08: 8 arquivos e 0 títulos de teste conferidos (ok)
- RNF-09: 7 arquivos e 3 títulos de teste conferidos (ok)
- RNF-10: 5 arquivos e 1 títulos de teste conferidos (ok)
- RNF-11: 2 arquivos e 0 títulos de teste conferidos (ok)

**docs/USER-STORIES.md**

- US-V1: 2 arquivos e 3 títulos de teste conferidos (ok)
- US-V2: 1 arquivos e 1 títulos de teste conferidos (ok)
- US-V3: 1 arquivos e 2 títulos de teste conferidos (ok)
- US-V4: 1 arquivos e 2 títulos de teste conferidos (ok)
- US-V5: 1 arquivos e 2 títulos de teste conferidos (ok)
- US-V6: 2 arquivos e 2 títulos de teste conferidos (ok)
- US-V7: 1 arquivos e 1 títulos de teste conferidos (ok)
- US-V8: 1 arquivos e 1 títulos de teste conferidos (ok)
- US-V9: 1 arquivos e 0 títulos de teste conferidos (ok)
- US-C1: 1 arquivos e 1 títulos de teste conferidos (ok)
- US-C2: 1 arquivos e 1 títulos de teste conferidos (ok)
- US-C3: 1 arquivos e 2 títulos de teste conferidos (ok)
- US-C4: 1 arquivos e 1 títulos de teste conferidos (ok)
- US-C5: 2 arquivos e 1 títulos de teste conferidos (ok)
- US-C6: 1 arquivos e 1 títulos de teste conferidos (ok)
- US-C7: 1 arquivos e 2 títulos de teste conferidos (ok)
- US-P1: 1 arquivos e 2 títulos de teste conferidos (ok)
- US-P2: 1 arquivos e 1 títulos de teste conferidos (ok)
- US-P3: 1 arquivos e 1 títulos de teste conferidos (ok)
- US-P4: 1 arquivos e 1 títulos de teste conferidos (ok)
- US-A1: 1 arquivos e 2 títulos de teste conferidos (ok)
- US-A2: 1 arquivos e 0 títulos de teste conferidos (ok)
- US-A3: 1 arquivos e 1 títulos de teste conferidos (ok)
- US-A4: 1 arquivos e 1 títulos de teste conferidos (ok)
- US-A5: 1 arquivos e 1 títulos de teste conferidos (ok)
- US-S1: 1 arquivos e 0 títulos de teste conferidos (ok)
- US-S2: 1 arquivos e 0 títulos de teste conferidos (ok)
- US-S3: 1 arquivos e 0 títulos de teste conferidos (ok)
- US-S4: 2 arquivos e 0 títulos de teste conferidos (ok)
- US-S5: 3 arquivos e 0 títulos de teste conferidos (ok)
- US-S6: 2 arquivos e 0 títulos de teste conferidos (ok)
- US-O1: 2 arquivos e 0 títulos de teste conferidos (ok)
- US-O2: 1 arquivos e 0 títulos de teste conferidos (ok)
- US-O3: 3 arquivos e 0 títulos de teste conferidos (ok)
- US-O4: 0 arquivos e 0 títulos de teste conferidos (ok)

### 2. Os diagramas C4 batem com o Bicep e o código

Cada contêiner do nível 2 tem o arquivo do Bicep e o do código na tabela da `docs/ARQUITETURA.md`, seção 2; o resumo:

| Contêiner | Bicep | Código |
|---|---|---|
| Front Door Standard + WAF | `infra/modules/frontdoor.bicep` (`profile`, os endpoints `alvesting` e `alvesting-green`, as rotas) | `apps/api/src/common/origin-lock.ts`, `apps/web/src/proxy.ts` |
| `ca-web` | `infra/modules/containerapps.bicep` (`name: 'ca-web'`) | `apps/web/`, `apps/web/src/lib/api.ts` |
| `ca-api` | `containerapps.bicep` (`name: 'ca-api'`) | `apps/api/src/main.ts`, `app.module.ts` |
| `ca-worker-data` | `containerapps.bicep` (`name: 'ca-worker-data'`) | `apps/api/src/worker.ts`, `role.ts` (`queueHandlers`) |
| `job-worker-decisions` | `containerapps.bicep` (`name: 'job-worker-decisions'`) | `apps/api/src/decide.ts` |
| Os sete `job-sched-*` | `containerapps.bicep` (a lista com `news`, `briefing`, `cycle`, `eod`, `universe`, `retention` e `backup` e o cron de cada um) | `apps/api/src/schedule.ts`, `role.ts` (`schedulers`) |
| `job-migrate` | `containerapps.bicep` (`name: 'job-migrate'`) | `apps/api/prisma/migrations/`, `apps/api/src/db-roles-cli.ts` |
| Service Bus | `infra/modules/servicebus.bicep` (as seis filas) | `apps/api/src/modules/messaging/` |
| PostgreSQL | `infra/modules/postgres.bicep` | `apps/api/prisma/schema.prisma`, `apps/api/src/infrastructure/database/` |
| Blob | `infra/modules/storage.bicep` (`briefings`, `llm-io`, `backups`) | `apps/api/src/infrastructure/storage/blob-client.ts`, `briefing.archive.ts`, `llm-io.archive.ts`, `backup-verify.handler.ts` |
| Key Vault | `infra/modules/keyvault.bicep`, `secret-access.bicep` | `apps/api/src/config/env.ts` |
| Application Insights, Log Analytics e alertas | `infra/modules/observability.bicep` (`appi-alvesting`), `alerts.bicep` | `apps/api/src/telemetry/` |
| Communication Services | `infra/modules/email.bicep` | `apps/api/src/modules/account/infrastructure/email/` |

Os nomes do nível 1 (brapi, OpenRouter, CVM, BCB, os portais) foram conferidos no código: `brapi.client.ts`, `OPENROUTER_BASE_URL` em
`llm-gateway.ts`, `CVM_HOST` e `BCB_HOST` em `modules/news/domain/`, e as URLs dos feeds em `modules/news/domain/sources.ts`. Os módulos do
nível 3 são os que `app.module.ts` e `roles.module.ts` carregam em cada papel.

**Os diagramas não foram desenhados aqui:** não há renderizador de Mermaid instalado, e baixá-lo seria rede. Conferi a sintaxe à mão e tirei
todo `;` de dentro dos blocos (nos diagramas de sequência ele separa comandos). Usei o `flowchart`, e não o `C4Context` (experimental no
Mermaid), com as convenções do C4. **A conferir no GitHub depois do push:** os sete diagramas desenham.

### 3. `pnpm coverage` roda os três pacotes com os limites e imprime backend e frontend

A rodada final, com a trava pesada, às 10:24 de 06/11/2026: `pnpm coverage` com o `TEST_DATABASE_URL` do `alvesting_t2_test` e o Azurite,
**código 0 em 177 s**, com todos os testes passando. O fim do log:

```
Cobertura de linhas e instruções (Playbook da Católica SC, linha Web Apps)
  backend    apps/api            linhas  91,68%  instruções  91,16%  mínimo 75%
  contratos  packages/contracts  linhas 100,00%  instruções 100,00%  mínimo 75%
  frontend   apps/web            linhas  69,63%  instruções  67,85%  mínimo 25%
```

| Pacote | Arquivos de teste | Testes | Linhas | Mínimo (linhas e instruções) |
|---|---|---|---|---|
| `apps/api` | 158 passaram e 2 pulados (160) | 3.189 passaram e 9 pulados (3.198) | 6.552 de 7.146 | 75 |
| `packages/contracts` | 13 | 504 | 333 de 333 | 75 |
| `apps/web` | 50 | 919 | 1.775 de 2.549 | 25 |

**O mínimo reprova de verdade:** nos contratos, `vitest run --coverage --coverage.thresholds.branches=100` (os ramos estão em 99,31%)
imprime `ERROR: Coverage for branches (99.31%) does not meet global threshold (100%)` e sai com 1; a rodada normal logo depois sai com 0.

**Por que a api ficou abaixo da linha de base (93,62%):** o código da T0, no mesmo checkout. Do `coverage-summary.json` da rodada final,
separando os arquivos pelo `git status` (porcentagens truncadas como o Vitest as imprime):

| Arquivos da api | Quantos | Linhas cobertas | % |
|---|---|---|---|
| Sem mudança desde o `c9ca348` | 195 | 5.081 de 5.377 | 94,49% |
| Mudados pela T0 | 18 | 1.226 de 1.356 | 90,41% (o `arena-cli.ts` e o `ensaio-cli.ts`, pontos de entrada, com 0%) |
| Novos da T0 (`apps/api/src/temporada/`) | 8 | 245 de 413 | 59,32% (o `operator.ts` e o `prepare.ts` com 0%) |
| **Todos, menos a pasta nova da T0** | 213 | 6.307 de 6.733 | **93,67%** |

O `docs/QUALIDADE.md`, seção 5, diz isso ao leitor. O `temporada/prepare.integration.spec.ts` da T0 nasceu às 10:27, depois do começo da
rodada (10:24), e não entrou nela: o número da api muda de novo quando a T0 fechar (ver "O que ficou para depois").

**A regra não mudou o número.** O coordenador mediu a linha de base de 06/11/2026 com o `include` de todo o `src` e só o código gerado de fora
(e os testes, que o Vitest tira sozinho). As configurações novas fazem o mesmo:

| Pacote | Linha de base | Com as configurações novas | Por quê |
|---|---|---|---|
| `apps/web` | 69,63% | 69,63% (1.775 de 2.549 linhas, igual) | O `include` de `src/**/*.{ts,tsx}`: com `src/**` o Vitest tenta transformar o CSS, o SVG e o `LICENSE` e quebra (`RolldownError: Parse failed`) |
| `packages/contracts` | 100% | 100% | O mesmo com `src/**` e com `src/**/*.ts` |
| `apps/api` | 93,62% | 93,72% no diagnóstico das 09:58 (6.260 de 6.679, com três testes da T0 falhando); 91,68% na rodada final, e 93,67% sem a pasta nova da T0 | A mesma regra (`src/**/*.ts` menos `src/generated/**` e os specs); a diferença vem do código e dos testes que a T0 está escrevendo agora |

**`vitest run` sem `--coverage` continua igual:** no site, `vitest run --dir src` deu 50 arquivos e 919 testes antes e depois do
`vitest.config.ts` novo, e o `vitest run` sem o `--dir` também (o `dir: 'src'` da config segura o `e2e/` do Playwright fora); nos contratos,
13 arquivos e 501 testes com e sem a cobertura (504 depois, com os testes novos da T0). A cobertura só liga com a flag.

**O script recusa rodar sem as variáveis**, porque sem elas o número do backend mente: o `pnpm test` da rodada final, sem o
`TEST_DATABASE_URL` e o `STORAGE_CONNECTION_STRING`, pulou 1.071 dos 3.198 testes da api.

```
$ env -u TEST_DATABASE_URL -u STORAGE_CONNECTION_STRING node scripts/coverage.mjs
pnpm coverage precisa de TEST_DATABASE_URL e STORAGE_CONNECTION_STRING: sem elas os testes de integração da api são pulados e o número
do backend sai menor que o real. [...]
exit=1
```

**Quando um pacote reprova, a tabela não mostra número velho.** Na primeira rodada (09:51), três testes do `season.service.spec.ts`, que a T0
estava mudando, falharam; o Vitest não gravou o relatório da api e a tabela disse `backend apps/api sem relatório (os testes deste pacote
falharam?)`.

**O TDD do script:** o `scripts/coverage.test.mjs` (6 testes) foi escrito antes e falhou com `ERR_MODULE_NOT_FOUND`; depois do script, um
teste reprovou por um motivo de forma (a regex esperava um espaço e a coluna alinhada tem dois) e o teste passou a conferir o valor, não o
espaço; agora `6 pass`.

### 4. `actionlint` passa; a action do SonarCloud está fixada por SHA; o passo não roda sem o segredo

- `actionlint .github/workflows/*.yml` (1.7.12, com o ShellCheck): sem nenhuma saída, código 0.
- A release lida pelo `gh api repos/SonarSource/sonarqube-scan-action/releases/latest`: **v8.4.1**, publicada em 03/11/2026; a tag aponta
  direto para o commit `e805d875275f728fac1885b413934be6d7c63f65` (`git/ref/tags/v8.4.1`, tipo `commit`); licença LGPL-3.0; o `action.yml`
  desse commit roda em `node24` e baixa o SonarScanner CLI 8.3.1.16491 com a assinatura GPG conferida. No workflow:
  `uses: SonarSource/sonarqube-scan-action@e805d875275f728fac1885b413934be6d7c63f65 # v8.4.1`.
- **O passo não roda sem o segredo:** o GitHub não deixa ler `secrets` no `if` de um passo, então o passo "SonarCloud configurado?" recebe o
  `SONAR_TOKEN` no `env`, escreve `enabled=true` na saída só se ele não for vazio (senão, um `::notice::`), e o passo "SonarCloud" tem
  `if: ${{ steps.sonar.outputs.enabled == 'true' }}`. O segredo fica só nesses dois passos, e não no job inteiro (os testes não o veem).
  PR de fork não recebe segredo e pula o passo.
- Da documentação pública do SonarCloud (`docs.sonarsource.com`, lida em 06/11/2026), o que entrou no `sonar-project.properties` e no
  `QUALIDADE.md`: os caminhos do LCOV precisam ser únicos no repositório inteiro e a correção é gravá-los a partir da raiz (daí o
  `projectRoot` no reporter `lcovonly`; os três `lcov.info` saem com `SF:apps/api/src/...`, `SF:apps/web/src/...` e
  `SF:packages/contracts/src/...`); um arquivo é fonte ou teste, nunca os dois, e com os dois na mesma pasta o padrão do teste vai em
  `sonar.test.inclusions` e em `sonar.exclusions`; a análise automática não importa cobertura e, ligada, faz a análise do CI falhar (desligar em
  Administration, Analysis Method); `fetch-depth: 0` no checkout; o plano Free analisa projeto público sem limite de quantidade.
- O `pnpm docs:check` cobra a action: as três linhas novas do `docs/DEPENDENCIAS.md` (a action, o SonarCloud e a Wiki do GitHub, estas duas
  marcadas como ainda não ligado e não publicada), editadas com o aval do coordenador. Resultado: `docs:check ok: 93 itens documentados`.

### 5. `node scripts/wiki.mjs` gera as páginas e o teste da reescrita de links passa

```
$ node scripts/wiki.mjs
wiki: o repositório não tem remote do GitHub; os links para o código apontam para https://github.com/DONO/REPOSITORIO. Gere de novo depois do primeiro push.
wiki: 61 páginas em .data/wiki
```

Conferido nas páginas geradas: 61 páginas, 198 links internos e nenhum que aponte para uma página que não existe; os 7 blocos `mermaid` da
`ARQUITETURA.md` intactos; o front matter do `DESIGN.md` virou um bloco `yaml`. `node --test scripts/wiki.test.mjs`: **11 pass, 0 fail**
(a reescrita para o nome da página, com âncora; de um ADR para o vizinho e para a pasta de cima; a pasta dos ADRs para o índice; o arquivo
que não é página para o endereço no repositório, e a imagem pelo `raw`; âncora, URL externa e `mailto:` intactos; nada muda dentro de
bloco de código, de Mermaid e de código em linha; o remote em https e em ssh; a Home, a `_Sidebar` e uma página por documento e por ADR; a
gravação que troca as páginas e não toca no `.git` do clone). **O teste pega defeito de verdade:** foi escrito antes e falhou com
`ERR_MODULE_NOT_FOUND`; e, contra duas cópias do script com um defeito plantado cada (no scratchpad, sem tocar no repositório), reprovou 4
testes (o link para a página virando o caminho do arquivo) e 1 (o bloco de código deixando de ser respeitado).

### 6. `pnpm check` verde (com a trava pesada) e `pnpm docs:check` passa

`pnpm docs:check` passa (`93 itens documentados`). **O `pnpm check` da rodada final (10:23) reprovou, e só por arquivos da T0 em
andamento:** o `pnpm lint` reprovou no ESLint da api, com 7 erros em três arquivos da T0 (`apps/api/src/ensaio/network-guard.spec.ts`,
`apps/api/src/temporada/agenda.spec.ts` e `apps/api/src/temporada/retro.integration.spec.ts`), e, como o `check` é uma cadeia de `&&`, parou
ali. Avisei o coordenador pela regra comum; ele pediu o conserto à T0 e, às 10:33, que eu rodasse de novo só o `pnpm lint` depois, sem
repetir a suíte pesada. Às 10:30 o ESLint da api ainda reprovava só em arquivos da T0, que ela seguia mudando (`ensaio/network-guard.spec.ts`,
`temporada/agenda.spec.ts`, `temporada/prepare.integration.spec.ts` e `temporada/testing/local-world.fixture.ts`). **Às 10:53, com o conserto
da T0, o `pnpm lint` passou** (código 0: o ESLint dos 5 pacotes e o `prettier --check .`). Com o typecheck e o `docs:check` da mesma hora e o
`pnpm test` da rodada final, as quatro partes do `pnpm check` estão verdes:

| Parte | Quando | Resultado |
|---|---|---|
| `pnpm lint` (o ESLint pelo turbo e o `prettier --check .`) | 10:53 | código 0: `Tasks: 5 successful, 5 total` e `All matched files use Prettier code style!` |
| `pnpm typecheck` | 10:53 | os 5 pacotes, código 0 |
| `pnpm test` (o turbo e os testes dos scripts) | rodada final, com a trava | código 0 em 47 s: api 2.127 passaram e 1.071 pularam (sem as variáveis de integração), site 919, contratos 504, scripts 167 |
| `pnpm docs:check` | 10:53 | `93 itens documentados` |
| `pnpm coverage` (com a integração) | rodada final, com a trava | código 0 em 177 s (seção 3) |
| `node --test scripts/*.test.mjs` | 10:30 | 167 pass, 0 fail |
| `actionlint .github/workflows/*.yml` | 10:30 | código 0 |

## O que mais conferi

- **Rede:** às 10:36, o `.data/guardas/t2-playbook-rede.log` com 0 linhas e o `.data/guardas/az-stub/calls.log` com 0 linhas (era 0 no
  começo). O `NODE_OPTIONS` com a guarda chega aos testes pelo turbo (conferido com um módulo marcador: o turbo, o vitest e os workers dele o
  carregam).
- **Banco:** só o `alvesting_t2_test`, no contêiner `alvesting-postgres-1`, apagado no fim (`DROP DATABASE alvesting_t2_test` às 10:35;
  nenhum banco `alvesting_t2_*` sobrou). Nenhum servidor meu ficou de pé (nada ouvindo de 4320 a 4339).
- **Disco:** 53 GB livres no começo, 51 GB na rodada final e 50 GB no fim.
- **Fatos do código que os documentos afirmam:** o hash de senha do Better Auth é scrypt (`better-auth/dist/crypto/password.mjs`); o limite de
  tentativas do Better Auth está ligado (`auth.ts`, `rateLimit: { enabled: true }`); o único SQL montado em texto é o `TRUNCATE` do ensaio, com
  nomes lidos do catálogo (`ensaio/driver.ts`); o único `dangerouslySetInnerHTML` é o script fixo do tema (`app/layout.tsx`); o CSP do site não
  restringe `script-src` (o comentário do `next.config.ts` diz por quê); o axe do e2e roda com as regras padrão (`new AxeBuilder({ page })`);
  os projetos escuros do Playwright rodam só os testes `@tema`.
- **Números citados:** a cobertura de cada pasta do site (a `lib` em 99,6%, os componentes em 63,4%, as telas em 54,5%) e da api sem o código de
  apoio aos testes (91,24% sem os fixtures e as pastas `testing/`; 90,99% sem os quatro fakes do ensaio também), calculados do
  `coverage-summary.json` da rodada final; os 15 arquivos da api com 0% (os 13 pontos de entrada e CLIs, mais o `temporada/operator.ts` e o
  `temporada/prepare.ts` da T0, em construção); 2.521 linhas copiadas das bibliotecas MIT (uns 18% do site e 6% do total); 6 commits no git;
  38 arquivos de teste de integração; 37 ADRs; 447 declarações de teste no e2e.

## Desvios e decisões

- **`scripts/coverage.mjs` e o teste dele** não estavam na lista de arquivos da tarefa: criados com o aval do coordenador, com as condições
  dele (sem mexer nos `package.json` dos pacotes; avisar ou falhar sem as variáveis: o script falha). O `pnpm coverage` chama o mesmo `test`
  de cada pacote, pelo turbo, com `-- --coverage`.
- **As três linhas do `docs/DEPENDENCIAS.md`**, fora da minha lista, com o aval do coordenador e relendo o trecho antes de editar.
- **`lcovonly` no lugar de `lcov`:** o reporter `lcov` grava o `lcov.info` e mais um HTML inteiro em `lcov-report/`, que duplicaria o `html`.
  O `lcovonly` dá o mesmo `lcov.info`, e com o `projectRoot` na raiz do monorepo, que o SonarCloud precisa.
- **O mínimo dos contratos é 75** (o da especificação), e os documentos os tratam à parte do backend: servem a api e o site.
- **O código de apoio aos testes da api conta na cobertura** (os fixtures, as pastas `testing/` e os fakes do ensaio): tirá-lo baixaria o
  número da linha de base por mudança de regra, o que o critério 3 proíbe. O `QUALIDADE.md` diz o número sem eles (meio ponto a menos).
- **O `flowchart` do Mermaid, e não o `C4Context`:** ver o critério 2.
- **O `DEPLOY.md`, além da seção nova:** o "Primeiro deploy: a versão mínima (olá + `/health`)" virou "Primeiro deploy" (o que sobe é o app
  inteiro), o passo 8 diz o h1 da landing de hoje, o `coverage` entrou nos checks exigidos da `main` e a frase "Nenhum segredo vive no
  GitHub" virou "nenhum segredo da Azure", com o `SONAR_TOKEN` dito.
- **As placas de "em construção":** o RF-40, a US-O4 e a seção 5 da `ARQUITETURA.md` descrevem o retroativo e o operador local pela
  especificação da T0 e apontam o relatório dela (`docs/temporada-1/relatorios/t0-temporada-real.md`), sem citar arquivos que ela ainda está
  escrevendo.
- **O rascunho de "Uso de IA" no README** diz também que um dos competidores da arena é da Anthropic, a mesma empresa do Claude Code, e onde
  está o teste dos parâmetros iguais: é um fato que a banca vai querer saber, e o Artur decide se fica.

## Riscos que o checklist destaca (decisões do Artur)

1. **O design copiado do Rallies AI** (`docs/CONFORMIDADE-PLAYBOOK.md`, seção 9.1): o ADR 0035 registra o pedido "copie o Design do Rallies
   AI", os valores de cor vieram de lá (ajustados para o AA), o `docs/TELAS.md` chama as telas de "a Arena do Rallies" e o `docs/PLANO.md`,
   seção 1, tem a coluna "Copiamos". O Playbook veda "cópia de design" no critério eliminatório. Não mexi nesses documentos (não são meus):
   o checklist lista as saídas.
2. **O histórico do git tem 6 commits** (um em 04/11/2026 e cinco em 06/11/2026), e o Playbook pede commits frequentes e revistos por pares.
   O checklist diz para não reescrever o histórico (datas inventadas seriam falsificação) e seguir com um commit por tarefa e PR revisado.
3. **Nada no ar ainda**, e o Playbook pede o sistema público e estável de 30/11/2026 até a divulgação das notas, sem depender do notebook.
4. **A carteira e o tema impedido "gestão financeira"**, e a tela `/chat` desligada (que a banca pode ler como interface inoperante).

## O que ficou para depois

- **Publicar a Wiki** e **ligar o SonarCloud** (os passos estão no `docs/QUALIDADE.md`, seções 7 e 8), depois do repositório público; trocar
  o `PREENCHER` do `sonar-project.properties` pelas chaves reais.
- **Conferir os diagramas no GitHub** depois do primeiro push.
- **Quando a T0 fechar:** trocar o "em construção" do RF-40, da US-O4 e da seção 5 da `ARQUITETURA.md` pelos arquivos dela, e pôr no README
  as linhas que o relatório dela pedir (a especificação da T0 deixa isso para o fechamento da onda).
- **Os números da cobertura, de novo depois da T0.** A rodada final mediu a api com a pasta `apps/api/src/temporada/` pela metade (59,32%, e
  o `prepare.integration.spec.ts` nasceu depois): com a T0 fechada, rodar o `pnpm coverage` (com o `TEST_DATABASE_URL` e o
  `STORAGE_CONNECTION_STRING`) e trocar os números em `docs/QUALIDADE.md` (a tabela da seção 1, a saída da seção 2, o parágrafo do código de
  apoio na seção 4 e a tabela e o parágrafo da seção 5), em `docs/REQUISITOS.md` (RNF-11) e em `docs/CONFORMIDADE-PLAYBOOK.md` (o resumo do
  topo e o item 8). Se o commit da T2 vier antes do da T0, o parágrafo da seção 5 cita uma pasta que ainda não estaria no git.
- **A ordem dos commits.** Três citações dos meus documentos dependem de arquivos de outras tarefas: o `docs/GUIA-DO-CODIGO.md` da T3 (no
  rascunho de "Uso de IA" do README e no `docs/CONFORMIDADE-PLAYBOOK.md`, que já existe no disco), o relatório da T0,
  `docs/temporada-1/relatorios/t0-temporada-real.md` (no RF-40, na US-O4 e na seção 5 da `docs/ARQUITETURA.md`, que **ainda não existia às
  10:36**), e a pasta `apps/api/src/temporada/` (no `docs/QUALIDADE.md`, seção 5). Commitar a T2 junto ou depois da T0 e da T3 evita link
  quebrado no histórico.
- **Sugestão fora da minha lista:** o `.dockerignore` não exclui `**/coverage`; quem rodar o `pnpm coverage` antes de um `docker build` local
  manda os relatórios no contexto do build (não chegam à imagem final, que só copia o `dist`, o `node_modules` e o `prisma` da api e o
  `standalone` do site).
- **O `infra/tests/check.mjs` não rodou aqui** (precisa do Bicep CLI, e o `az` desta máquina não pode ser usado); não mexi na infra.

## Arquivos tocados

Novos:

- `docs/REQUISITOS.md`
- `docs/USER-STORIES.md`
- `docs/ARQUITETURA.md`
- `docs/QUALIDADE.md`
- `docs/CONFORMIDADE-PLAYBOOK.md`
- `docs/temporada-1/relatorios/t2-playbook-docs-qualidade.md`
- `apps/web/vitest.config.ts`
- `scripts/coverage.mjs`
- `scripts/coverage.test.mjs`
- `scripts/wiki.mjs`
- `scripts/wiki.test.mjs`
- `sonar-project.properties`

Alterados:

- `apps/api/vitest.config.ts`
- `packages/contracts/vitest.config.ts`
- `package.json` (só o script `coverage`)
- `.github/workflows/ci.yml`
- `.gitignore`
- `.prettierignore`
- `docs/DEPLOY.md`
- `docs/DEPENDENCIAS.md` (três linhas, com o aval do coordenador)
- `README.md`

Fora do git (gerados, não entram no commit): `.data/wiki/` (as páginas da Wiki) e as pastas `coverage/` dos três pacotes.
