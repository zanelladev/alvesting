# Qualidade: cobertura, TDD e análise estática

Como a Alvesting cumpre a parte de qualidade da linha Web Apps do Playbook da Católica SC: a **cobertura de testes unitários com TDD,
75% no backend e 25% no frontend**, conferida na prova de autoria, e a **análise estática de código e segurança** do núcleo comum. Diz
como gerar o relatório que o professor pede, o que conta como backend e frontend, o que fica fora da conta e por quê, os números de hoje,
o TDD com exemplos de verdade, e como ligar o SonarCloud e publicar a Wiki.

---

## 1. O que o Playbook pede e onde estamos

| Parte | Mínimo | Hoje (linhas) | Onde o mínimo está travado |
|---|---|---|---|
| Backend: `apps/api/src` (a API, os workers e os agendadores) | 75% | **91,68%** | `apps/api/vitest.config.ts` (`thresholds`) |
| Contratos: `packages/contracts/src` (os schemas Zod que a api e o site dividem) | 75% (o do backend) | **100%** | `packages/contracts/vitest.config.ts` |
| Frontend: `apps/web/src` (as telas, os componentes e a `lib` do site) | 25% | **69,63%** | `apps/web/vitest.config.ts` |

O mínimo vale para linhas e para instruções (statements): abaixo dele o próprio Vitest reprova, no `pnpm coverage` local e no job
`coverage` do CI. Os números completos e a data da medida estão na seção 5.

## 2. Como gerar o relatório (a prova de autoria)

Com o Postgres e o Azurite do `docker compose` no ar (o README, "Subir"):

```bash
nvm use
pnpm install
docker compose up -d
TEST_DATABASE_URL=postgresql://alvesting:alvesting@localhost:25432/alvesting_test \
STORAGE_CONNECTION_STRING='UseDevelopmentStorage=true;DevelopmentStorageProxyUri=http://127.0.0.1:25100' \
pnpm coverage
```

- **O que roda.** O `scripts/coverage.mjs` chama o `turbo run test -- --coverage`: os mesmos testes do `pnpm test`, nos três pacotes, com a
  cobertura ligada. Sem o `--coverage`, o `vitest run` de sempre não muda nada.
- **Por que as duas variáveis.** Sem elas cerca de mil testes de integração da api (os que falam com o Postgres e o Blob de verdade) são
  pulados, e o backend sairia com um número menor que o real. O script recusa rodar sem as duas e diz como chamá-lo.
- **O que ele imprime.** O resumo de cada pacote no meio do log (o `text-summary` do Vitest) e, no fim, a tabela:

  ```
  Cobertura de linhas e instruções (Playbook da Católica SC, linha Web Apps)
    backend    apps/api            linhas  91,68%  instruções  91,16%  mínimo 75%
    contratos  packages/contracts  linhas 100,00%  instruções 100,00%  mínimo 75%
    frontend   apps/web            linhas  69,63%  instruções  67,85%  mínimo 25%
  ```

  Pacote cujo teste falhou aparece como "sem relatório", nunca com um número velho (o Vitest só grava o relatório quando a suíte passa).
- **Onde abrir.** O HTML de cada pacote, arquivo por arquivo e linha por linha: `apps/api/coverage/index.html`,
  `apps/web/coverage/index.html` e `packages/contracts/coverage/index.html`. Ao lado ficam o `lcov.info` (o que o SonarCloud lê) e o
  `coverage-summary.json`. A pasta `coverage/` fica fora do git.
- **No CI.** O job `coverage` do `.github/workflows/ci.yml` roda o mesmo comando, com o Postgres e o Azurite, e guarda as três pastas como o
  artefato `coverage` do run (7 dias).

## 3. O que conta como backend e frontend

- **Backend** é o `apps/api/src` inteiro: a API HTTP, o worker de dados, o job de decisões, os agendadores, os CLIs e o ensaio, todos na
  mesma imagem (a [ARQUITETURA.md](ARQUITETURA.md), seção 2).
- **Frontend** é o `apps/web/src` inteiro: as telas (`app/`), os componentes (`components/`, as cópias das bibliotecas MIT inclusive) e a
  `lib/` (a leitura da api, a formatação, os gráficos). Só `.ts` e `.tsx`: o CSS, o SVG, a arte em JSON e o `LICENSE` das bibliotecas não
  são código.
- **Os contratos** (`packages/contracts/src`) servem os dois lados e ficam com o mínimo maior, o do backend.
- **Fora da conta de propósito:** os testes de ponta a ponta (o Playwright de `apps/web/e2e/`, que cobre as telas no navegador), os testes
  dos scripts (`scripts/*.test.mjs`, pelo `node --test`) e o `infra/tests/check.mjs`. O Playbook fala de teste unitário; esses são outros, e
  rodam no `pnpm check`, no `pnpm test:e2e` e no CI.
- **`include` com todo o `src`.** Cada `vitest.config.ts` lista o `src` inteiro no `coverage.include`. Sem isso o Vitest 5 só conta o
  arquivo que algum teste importou, e um módulo sem teste nenhum sumiria da conta em vez de entrar com 0%.

## 4. O que fica fora da conta, e por quê

| Fora | Por quê | Onde |
|---|---|---|
| `apps/api/src/generated/**` | O cliente do Prisma, gerado pelo `prisma generate` e fora do git: não é código escrito aqui | `apps/api/vitest.config.ts` e `sonar-project.properties` |
| `*.spec.ts` e `*.spec.tsx` | Os próprios testes. O Vitest já os tira; a linha deixa a regra à vista e igual à do `sonar-project.properties` | os três `vitest.config.ts` |

Só isso. Duas coisas **ficam dentro**, e vale dizer:

- **O código de apoio aos testes da api** (os `*.fixture.ts`, as pastas `testing/` e os fakes do ensaio, que o `arena:ensaio` e o e2e
  usam) conta como backend. Ele roda nos testes, então puxa o número para cima: na rodada da seção 5, sem os fixtures e as pastas
  `testing/`, a api fica em **91,24%** de linhas, e sem os quatro fakes de `apps/api/src/ensaio/` também (`fake-brapi.ts`, `feeds.ts`,
  `market.ts` e `synthetic-logos.ts`), em **90,99%**. A diferença é de menos de um ponto, e o mínimo de 75% fica longe nos dois casos.
- **Os pontos de entrada ficam com 0%** e entram na conta assim: `main.ts`, `worker.ts`, `decide.ts`, `schedule.ts`, `app.module.ts` e os
  CLIs (`*-cli.ts`). São a casca que sobe o Nest e lê os argumentos; o que eles chamam é testado (`role.ts`, `market-cli-args.ts`, os
  serviços). No site, as páginas que só montam componentes (`page.tsx` do ranking, do explorar, das ações) e o `proxy.ts` têm pouca ou
  nenhuma cobertura **unitária**: quem as prova é o e2e (`e2e/arena.spec.ts`, `e2e/explorar.spec.ts`, `e2e/origin-lock.spec.ts`), que não
  entra no número. A `lib/` do site está em 99,6%.

## 5. Os números de hoje

Medidos em 06/11/2026 (a rodada das 10:24), num Mac arm64, pelo `pnpm coverage` com o `TEST_DATABASE_URL` e o
`STORAGE_CONNECTION_STRING` (sem o emulador do Service Bus, como o CI), com todos os testes passando. A linha de base do mesmo dia, medida
pelo coordenador da onda com as mesmas regras antes destes arquivos de configuração existirem, era de 93,62% (api), 69,63% (site) e 100%
(contratos).

| Pacote | Linhas | Instruções | Ramos | Funções | Testes |
|---|---|---|---|---|---|
| `apps/api` | 91,68% (6.552 de 7.146) | 91,16% | 84,53% | 93,05% | 3.198 em 160 arquivos (9 pulados: 6 pedem o emulador do Service Bus e 3 leem arquivos reais da CVM, só com `REAL_DATA_TESTS=1`) |
| `packages/contracts` | 100% (333 de 333) | 100% | 99,31% | 100% | 504 em 13 arquivos |
| `apps/web` | 69,63% (1.775 de 2.549) | 67,85% | 61,74% | 67,15% | 919 em 50 arquivos |

A api ficou abaixo da linha de base pelo código novo, e não pela regra: a temporada real (`apps/api/src/temporada/`) estava sendo escrita
no mesmo dia, e os 8 arquivos dela mediram 59,32% nessa rodada (245 de 413 linhas). Sem essa pasta, a mesma rodada dá 93,67% (6.307 de
6.733 linhas).

## 6. TDD no projeto

O Playbook pede TDD na linha Web Apps, e o critério 3 do Demo Day pontua se os testes **exercitam regra de negócio**, não quanto medem.
Aqui o teste nasce antes do código onde há lógica (uma regra, um parser, dinheiro, segurança) e é visto falhar pelo motivo certo antes
de passar. Os relatórios das ondas registram o vermelho de cada um; alguns exemplos, com o arquivo onde estão contados:

| Onde | O teste | O vermelho antes do código | Relatório |
|---|---|---|---|
| Backend | O validador dos logos SVG da brapi (`apps/api/src/modules/market-data/domain/svg-check.spec.ts`): `<script>`, `@import`, `url()` externo, `<foreignObject>` e dezenas de truques recusados | `66 failed \| 11 passed` contra um stub que aceitava tudo; depois, `77 passed` | commit `43ce40c` (o relatório da onda do Rallies saiu do repositório em 09/11/2026) |
| Backend | O endereço do logo na lista da brapi (`brapi.client.spec.ts`): 20 valores tortos numa lista só, e só o bom passa | `expected { PETR4: undefined, …(19) }` | commit `43ce40c` (o relatório da onda do Rallies saiu do repositório em 09/11/2026) |
| Backend | A atualização semanal com os logos (`weekly-refresh.spec.ts`) e os argumentos do `market:logos` (`market-cli-args.spec.ts`) | `2 failed` e `5 failed` | commit `43ce40c` (o relatório da onda do Rallies saiu do repositório em 09/11/2026) |
| Frontend | O ranking por dia do gráfico de posições (`apps/web/src/lib/chart.spec.ts`, `rankByDay` e `serieDe`) | `11 failed` (`rankByDay is not a function`) e `2 failed` | `docs/redesign-premium/relatorios/arena.md`, seção 4 |
| Frontend | A geometria e o desenho das velas (`components.spec.tsx`, "velas: a geometria") | o módulo `./velas` não existia | `docs/redesign-premium/relatorios/explorar.md`, seção 4 |
| Frontend | A leitura dos logos no servidor (`apps/web/src/lib/logos.spec.ts`) | `Cannot find module '/src/lib/logos'` | `docs/redesign-premium/relatorios/logos.md` |
| Frontend | Uma carteira que falha não derruba a arena (`app/(app)/(arena)/arena/page.spec.tsx`) | a página inteira virava "Não foi possível carregar os dados" | commit `3c9db10` (o relatório da onda do Rallies saiu do repositório em 09/11/2026) |
| Scripts | O resumo do `pnpm coverage` (`scripts/coverage.test.mjs`) e a reescrita dos links da Wiki (`scripts/wiki.test.mjs`) | `ERR_MODULE_NOT_FOUND` nos dois, antes de o script existir; depois, duas falhas plantadas no `wiki.mjs` reprovam 4 e 1 testes | `docs/temporada-1/relatorios/t2-playbook-docs-qualidade.md` |

**Honestidade sobre o histórico.** Nas etapas 1 a 12 a regra já era teste em todo caso de uso e endpoint (`CLAUDE.md`), mas os relatórios
delas não registraram, um a um, que o teste veio antes: onde não há o registro, este documento não afirma. A partir das ondas de redesenho
(04 e 05/11/2026) o vermelho antes do código passou a ir no relatório de cada tarefa.

**Testes que exercitam regra de negócio, e não percentual.** Alguns exemplos que valem mais do que o número: a liquidação conferida
contra uma planilha feita à mão (`apps/api/src/modules/settlement/domain/hand-checked.spec.ts`, 3 ações e 5 pregões); a API pública
percorrida rota a rota com o canário do prompt, para provar que o texto oculto nunca sai
(`apps/api/src/modules/public/presentation/public-api.integration.spec.ts`); a lista branca de cada campo com preço contra a licença da
brapi (`packages/contracts/src/public-quotes.spec.ts`); e o `scripts/deploy.test.mjs`, que executa o `deploy.yml` de verdade contra um
Container Apps falso para provar a ordem do rollout.

## 7. Análise estática

| Ferramenta | O que confere | Onde roda |
|---|---|---|
| **TypeScript** estrito | `strict`, `noUncheckedIndexedAccess`, `noImplicitOverride`, `noImplicitReturns` e `noFallthroughCasesInSwitch` (`packages/config/tsconfig.base.json`) | `pnpm typecheck`, no `pnpm check` e no CI |
| **ESLint** com o `typescript-eslint` em `recommendedTypeChecked` (e o `eslint-config-next` no site) | promessas soltas, `any` inseguro, variáveis sem uso, regras do React e do Next (`packages/config/eslint.mjs`) | `pnpm lint` |
| **Prettier** | um formato só em todo o código | `pnpm lint` (`prettier --check .`) |
| **`docs:check`** | toda dependência (pacote, imagem, action, código copiado) com a linha completa no `docs/DEPENDENCIAS.md` | `pnpm docs:check` |
| **`infra/tests/check.mjs`** | o Bicep compila sem erro nem aviso, o `bicep lint` limpo e os invariantes de segurança da infra (os papéis por fila e por container, as rotas sem cache, os segredos de cada workload) | o job `check` do CI |
| **`actionlint`** (com o ShellCheck) | os workflows do GitHub Actions, inclusive os scripts de cada `run:` | à mão, antes de mudar um workflow (`CLAUDE.md`) |
| **Testes que conferem regras do repositório** | `runbook.spec.ts` (todo alerta e toda ação de auditoria têm seção no runbook), `table-policy.spec.ts` (toda tabela tem a política do papel da api), `public-quotes.spec.ts` (nenhum campo de preço fora da lista branca), `quotes-boundary.spec.ts` (só um módulo do site lê o segredo das cotações) | `pnpm test` |
| **SonarCloud** (SonarQube Cloud) | bugs, *code smells*, vulnerabilidades, *security hotspots*, duplicação e a cobertura dos três `lcov.info` | o job `coverage` do CI, **só com o segredo `SONAR_TOKEN`**: ainda não ligado |

### Ligar o SonarCloud (depois que o repositório for público)

O CI já tem o passo e a configuração: `sonar-project.properties` na raiz (o escopo e as exclusões, iguais aos da cobertura) e a action
`SonarSource/sonarqube-scan-action` v8.4.1 fixada pelo SHA do commit da release (`.github/workflows/ci.yml`, job `coverage`). Sem o segredo
o passo é pulado com um aviso, e o resto do job roda igual. O plano gratuito (Free) do SonarCloud analisa projetos públicos sem limite de
quantidade (conferido na documentação do SonarCloud em 06/11/2026). Os nomes dos menus abaixo são os da interface em inglês e podem
mudar; o tutorial do próprio SonarCloud guia cada passo. Para ligar:

1. Entrar em [sonarcloud.io](https://sonarcloud.io) com a conta do GitHub (**Log in with GitHub**).
2. Criar a organização importando a conta do GitHub dona do repositório (**Import an organization from GitHub**) e escolher o plano
   **Free**. A chave da organização aparece na página dela.
3. **Analyze new project**, escolher o repositório `alvesting` e criar o projeto. A chave do projeto aparece em **Information**.
4. Na configuração do projeto, **Administration > Analysis Method**: desligar a **Automatic Analysis** e escolher **GitHub Actions**. A
   análise automática não importa cobertura, e com ela ligada a análise do CI falha (documentação do SonarCloud, "Automatic analysis").
5. Gerar o token que o tutorial do **GitHub Actions** mostra (no plano Free, um token pessoal: **My Account > Security**).
6. No GitHub: **Settings > Secrets and variables > Actions > New repository secret**, nome `SONAR_TOKEN`, com o token.
7. Trocar o `PREENCHER` das duas linhas do `sonar-project.properties` (`sonar.organization` e `sonar.projectKey`) pelas chaves dos passos
   2 e 3, e fazer o push. O job `coverage` roda a análise, e o painel do projeto mostra a cobertura que o Vitest mediu.
8. Conferir na aba **Code** do projeto que só entrou o código da api, do site e dos contratos, e que os testes aparecem como testes.

Limites que valem saber: no plano Free a análise é só do ramo principal e dos PRs que miram nele, e PR vindo de fork não recebe o segredo
(o passo é pulado ali). Até o projeto existir, a análise estática que vale é a da tabela acima, que roda em todo PR.

## 8. A Wiki

O núcleo comum do Playbook pede a documentação em Wiki junto ao repositório. A Wiki é **gerada** do `docs/`, que continua sendo a fonte
(ela muda junto com o código, no mesmo PR):

```bash
node scripts/wiki.mjs            # gera as páginas em .data/wiki/ (fora do git)
node scripts/wiki.mjs <pasta>    # ou em outra pasta, como o clone da Wiki
```

O script faz a Home (o resumo do README e os links por grupo), a `_Sidebar` e uma página por documento do `docs/` e por ADR, cada uma
dizendo de qual arquivo veio. Os links entre documentos viram o nome da página na Wiki; os links para código viram o endereço do arquivo no
repositório (lido do `git remote get-url origin`; sem o remote, o script avisa e usa um endereço de exemplo); os blocos de código e os
diagramas Mermaid ficam como estão, e a Wiki os desenha. A reescrita dos links tem teste (`scripts/wiki.test.mjs`, no `pnpm test`).

**Publicar** (depois que o repositório for público; a Wiki do GitHub é um repositório git à parte, `<repositório>.wiki.git`, que só passa a
existir quando a primeira página é criada pelo site):

1. No GitHub, **Settings > General > Features**: marcar **Wikis**.
2. Abrir a aba **Wiki**, **Create the first page**, e salvar a página do jeito que vier (ela vai ser trocada no passo 4).
3. Clonar a Wiki e gerar as páginas dentro do clone:

   ```bash
   rm -rf .data/wiki
   git clone https://github.com/<dono>/alvesting.wiki.git .data/wiki
   node scripts/wiki.mjs .data/wiki
   ```

   O script troca só os `.md` do topo da pasta, e o `.git` do clone fica.
4. Publicar:

   ```bash
   cd .data/wiki
   git add -A
   git commit -m "Wiki gerada do docs/ em <data>"
   git push
   ```

Para atualizar depois, repita os passos 3 e 4 (o `git pull` no clone antes, se alguém editou a Wiki pelo site: a edição pelo site se
perde na próxima geração, de propósito, porque a fonte é o `docs/`).
