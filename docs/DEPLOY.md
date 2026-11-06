# Deploy: GitHub Actions para a Azure, por OIDC

Etapa 3 do plano (§5.10 e §16), com o blue/green da etapa 10 (ADR 0029). Merge na `main` publica sem passo manual: as imagens vão para o ACR, as migrations
rodam (e o login da api no banco), e a revisão nova de cada app, a api primeiro, sobe com o label `green` e sem tráfego, passa por smoke e por Playwright mobile
pelo Front Door verde, e só então recebe 100% do tráfego. Qualquer passo que falhe antes da confirmação (seção 1) deixa a revisão antiga com 100% e desativa a nova.

| Arquivo | Para quê |
|---|---|
| `.github/workflows/ci.yml` | PR e push na `main`: lint, tipos, unidade, integração (Postgres e emulador do Service Bus), Playwright nos três projetos, Lighthouse mobile, `docs:check`, build, check da infra, imagens Docker e what-if do Bicep |
| `.github/workflows/deploy.yml` | Push na `main` (e execução manual): imagens no ACR e o rollout descrito abaixo |
| `scripts/deploy.mjs` | Os passos que falam com o Container Apps (`pin`, `migrate`, `create api\|web`, `smoke-green api\|web`, `promote api\|web`, `smoke-edge`, `cleanup`, `roll-roles`, `rollback`, `current-tags`, e o `revert <revisão>` da seção 6), com testes em `scripts/deploy.test.mjs` (que executa o `deploy.yml` de verdade contra um Container Apps falso) |
| `scripts/sse-probe.mjs` | Mede se o SSE chega aos poucos ou bufferizado (ADR 0017) |

Nenhum segredo vive no GitHub. Os IDs do OIDC (cliente, tenant, assinatura) não são segredo: sozinhos não dão acesso a nada.

---

## 1. O que acontece em cada deploy

`images` (um job) e `deploy` (outro, que depende dele). É um **blue/green com o label `green`** (etapa 10, parte 4; ADR 0029): a revisão nova de cada app nasce com
**0% do tráfego** e com o label, é provada pelo endereço do label e pelo **endpoint green do Front Door** (smoke e Playwright mobile, com o WAF e a trava de origem
de verdade) e só então recebe os 100%. A **api vai antes do web**: o web novo pode depender da api nova, e a migration é só aditiva (a api nova convive com o web
antigo). O `deploy` roda os passos nesta ordem; a coluna da direita diz o que acontece se o passo falhar.

| # | Passo | O que prova ou faz | Se falhar |
|---|---|---|---|
| 1 | Conferir as variáveis e instalar as dependências do e2e | `SITE_URL` e `SITE_GREEN_URL` (as duas https e **diferentes**: com a mesma, o Playwright pelo "green" provaria a revisão antiga, que ainda tem os 100%) e o Playwright (Chromium e WebKit), antes de tocar na Azure | Nada mudou na Azure |
| 2 | Fixar o tráfego (`pin`) | Descobre a revisão que serve cada app e prende os 100% a ela, pelo nome | Nada mudou |
| 3 | Migrations e login da api (`migrate`) | Põe a imagem nova no `job-migrate`, dispara e espera `Succeeded`. O job roda o `migrate deploy` e, só se deu certo, o `db:roles` (o login de menor privilégio da api no banco, `docs/INFRA.md`, 2.2) | Revisão antiga segue; o banco só recebe migrations seguras (expandir antes de contrair, CLAUDE.md) |
| 4 | **API:** criar a revisão (`create api`) | `update` do `ca-api` com a imagem do SHA; confere que ela nasceu com 0%, espera ficar saudável, dá a ela o label `green` (`revision label add --yes`) e confere de novo que o tráfego não mudou | `Desfazer` |
| 5 | **API:** smoke no label (`smoke-green api`) | Confere que o label está na revisão nova e pede `/health` e `/api/v1/health` no endereço do label (`ca-api---green.<domínio do ambiente>`) | `Desfazer` |
| 6 | **API:** Playwright pelo Front Door verde | `e2e/smoke.spec.ts` com `--grep @api`, em `pixel-7` (Chromium) e `iphone-15` (WebKit), com `BASE_URL` = `SITE_GREEN_URL`: só os testes da api (health, textos legais, admin 401, carteira 401, login), porque o web verde ainda é o do deploy anterior | `Desfazer` |
| 7 | **API:** virar o tráfego (`promote api`) | 100% para a revisão nova da api | `Desfazer` (devolve a api) |
| 8 | **WEB:** criar a revisão, smoke no label, Playwright e virar (`create web`, `smoke-green web`, Playwright, `promote web`) | O mesmo, para o `ca-web`. O Playwright roda a suíte inteira do smoke pelo Front Door verde: o web novo fala com a **api nova**, que já tem os 100% | `Desfazer` devolve **os dois** apps |
| 9 | Smoke pelo Front Door **de produção** (`smoke-edge`) e Playwright de novo | Com os dois já no ar: `/health` do site e `/api/v1/health` da api, e o mesmo smoke do Playwright com `BASE_URL` = `SITE_URL`. Prova as rotas com cache, o domínio e o certificado de produção com o código novo | `Desfazer` devolve os dois apps à antiga, que segue ativa |
| 10 | Confirmar (`cleanup`) | **Ponto sem volta.** Marca o deploy como confirmado e desativa as revisões antigas. O label `green` fica na revisão que está no ar | O deploy fica vermelho, mas o `Desfazer` não faz mais nada (voltar de lá é a seção 6) |
| 11 | Atualizar worker, decisões e agendadores (`roll-roles`) | Levam a mesma imagem da api (plano §4). **Não têm revisão para provar nem para voltar** (abaixo) | Fica vermelho; web e api já estão no ar |
| 12 | Teste de SSE (informativo) | Escreve o veredito no resumo do job; nunca derruba o deploy | Nada |
| 13 | `Desfazer` (`rollback`) | `if: failure() \|\| cancelled()`: 100% de volta à revisão antiga **nos dois apps**, o label `green` sai da nova e ela é desativada. Idempotente | Se o próprio rollback falhar, o job lista o que sobrou |

Concorrência: o grupo `deploy-production` enfileira. Um deploy nunca cancela outro em andamento.

**O que a ordem "api antes do web" pede de quem escreve código.** Entre a virada da api (passo 7) e a do web (passo 8), o site **antigo** fala com a api **nova**; se o web novo reprovar, o `Desfazer` devolve a api e o par volta a ser o antigo.
Por isso uma mudança **incompatível** em `/api/v1` (campo que sai ou muda de tipo, rota removida) vai em lançamentos separados, como a migration (`CLAUDE.md`): primeiro a api que aceita o formato antigo e o novo, depois o web que usa o novo,
e só então a api que retira o antigo. Mudança **aditiva** (campo ou rota nova) vai de uma vez, porque o web antigo a ignora.

**Texto legal novo não vai ao ar antes da tela que ele descreve.** A api serve o texto em `GET /legal` e o aceite grava o SHA-256 do que a pessoa viu. Os textos da carteira (etapa 12: os termos **0.2** e a política **0.2**, que em 04/11/2026 passou para a **0.3** com a limpeza diária) prometem a tela da carteira: a data do fechamento usado em cada posição, e a correção e a exclusão dos lançamentos ali. Publicar a api 0.2 sem a tela
`/carteira` faria alguém aceitar um texto que descreve o que ainda não existe (LGPD, art. 9). **A tela existe desde a parte 2 da etapa 12** (`docs/TELAS.md`, seção 9), com a data do fechamento em cada posição e o editar e o apagar de cada lançamento: o portão está cumprido no código, e a api com esses textos e o web com a tela vão no mesmo deploy (a janela entre a virada da api e a do web é de minutos), nunca a api sozinha (ADR 0031). A prova do web verde (`smoke.spec.ts`, que abre `/carteira` e vê a entrada) confere que a tela subiu. O mesmo vale para o texto novo do chat (etapa 13): a tela dele vai no mesmo deploy do texto.

### Onde a garantia "prova falha mantém a revisão antiga com 100%" está

No cabeçalho de `deploy.yml` e em `scripts/deploy.mjs`, com teste para cada ramo (`scripts/deploy.test.mjs`). O teste de ponta a ponta **lê o `deploy.yml` de verdade**
e o executa contra um Container Apps falso (`node scripts/deploy.mjs ...` roda o `main`; cada `playwright test` chama um Playwright que enxerga o tráfego daquele instante), então a
**ordem** que importa está provada no arquivo que o GitHub executa:

1. O passo 2 (`pin`) roda antes de existir revisão nova e prende o tráfego pelo nome. Sem isso, a Azure mandaria 100%
   para a revisão mais nova assim que ela ficasse pronta (Microsoft Learn, "Traffic splitting": "by default, all
   traffic is routed to the latest deployed revision").
2. O passo 4 confere, depois de criar e depois de pôr o label, que a nova tem 0%. Se a Azure fizer diferente, devolve o tráfego na hora e para. O label não precisa de peso para
   responder (Learn, "Revisions", seção "Labels": "Allocation for traffic splitting isn't required for revisions with labels").
3. Só os passos 7 e 8 movem tráfego para a revisão nova, cada um depois do smoke no label e do Playwright mobile **daquele app**, e o job só chega neles se os passos anteriores passaram.
   O Playwright do web verde roda com a api nova já no ar (`seen[1]` do teste `o rollout inteiro`: a api tem os 100% e o web novo ainda tem 0%).
4. O passo 13 refaz (1), tira o label da nova e a desativa, em falha ou cancelamento, nos dois apps.

### O que acontece com worker, decisões e agendadores (não têm revisão)

Os jobs (`job-worker-decisions`, os sete `job-sched-*` e o `job-migrate`) **não têm revisão**: cada execução usa o modelo do job na hora em que começa, e o `ca-worker-data` tem revisão única. O
`roll-roles` (passo 11) só troca a imagem do modelo deles, **depois do ponto sem volta**, então:

- **Falha antes do passo 10:** eles seguem na imagem velha (o `roll-roles` nem rodou), que convive com o banco migrado (a migration é aditiva) e com a api nova. Nada a desfazer neles.
- **Falha no meio do `roll-roles`:** alguns já estão na imagem nova e outros não. O passo é idempotente (só atualiza o que ainda está na imagem velha): **rode o workflow de novo** (*Re-run failed jobs* ou
  *Run workflow*) ou o comando à mão (`node scripts/deploy.mjs roll-roles`, com `RESOURCE_GROUP`, `REGISTRY` e `IMAGE_TAG`). Enquanto isso o worker e os agendadores falam o protocolo de mensagens do código que têm: mensagem de tipo novo
  numa fila cujo consumidor é velho vai para a DLQ (os `strictObject` do contrato recusam o campo que não conhecem) e o reenvio da DLQ depois resolve (`docs/JOBS.md`, seção 5). Um lançamento que mexe no contrato de mensagem deve
  tratar isso no próprio PR.
- **Voltar:** não há `revert` para eles. O caminho é o `roll-roles` de um commit anterior (*Re-run all jobs* do run verde que você quer de volta, seção 6), que leva a imagem de volta; o `job-migrate` e os agendadores só lêem a imagem na próxima execução.

### O que o Front Door prova antes da virada (e o que não)

O **endpoint green** (`alvesting-green`, `docs/INFRA.md`, 2.5) leva ao label `green` de cada app e passa pelo **mesmo WAF e pela mesma trava de origem** do site (o `X-Azure-FDID` é o do perfil). Por isso o Playwright pelo
`SITE_GREEN_URL` (passos 6 e 8) prova o **código novo** com a borda de verdade (regras do WAF, trava de origem, certificado) antes de ele ter tráfego, e a janela de um a dois minutos do desenho antigo (ADR 0019: a virada primeiro, a prova
depois) deixa de existir. Não prova: as **rotas com cache** do Front Door e o **domínio próprio**, que só o endpoint do site tem (o green não guarda nada na borda, de propósito); quem prova isso é o passo 9, pelo Front Door de produção, com
volta automática. O endereço do green sai na saída `greenSiteUrl` da infra (seção 3).

**Desvio do que a documentação deixa pronto (registrado no ADR 0029):** o endpoint green é público (WAF, rate limit e `BlockInterno` valem, mas qualquer pessoa que descubra o host `alvesting-green-<hash>.z01.azurefd.net` alcança o label green). Ele serve o
mesmo código e o mesmo banco do site, na versão que o deploy acabou de provar ou na do último deploy; o risco aceito é o de uma segunda entrada para o que já é público. Se o Front Door recusar a origem no FQDN do label (três hífens) ou o
desenho não se sustentar na Azure, a volta é provar o green pelo FQDN do label com o `X-Azure-FDID` (o CI lê o ID com `az afd profile show --query frontDoorId` e o mascara, sem guardá-lo no GitHub) e voltar a etiqueta `@pos-virada` para o smoke de produção.

### O smoke do Playwright (passos 6, 8 e 9)

`apps/web/e2e/smoke.spec.ts` é o único arquivo que o deploy roda (`playwright test e2e/smoke.spec.ts --project=pixel-7 --project=iphone-15`, com `BASE_URL` = `SITE_GREEN_URL` nos passos 6 e 8 e = `SITE_URL` no
passo 9). A suíte e2e inteira fica no CI, porque parte dela depende do servidor local (trava de origem, cabeçalhos). São catorze testes. Os que **só falam com a api** levam a etiqueta `@api`, e a prova da api
(passo 6) roda só esses (`--grep @api`); o web verde e a produção rodam os catorze:

| Teste | Etiqueta | O que falha |
|---|---|---|
| A home responde 200, tem título e o h1 do hero ("Modelos de linguagem investindo na B3", ADR 0034) e nenhum recurso da página (JS, CSS, fonte, a arte do quadro 0) volta com status 400 ou mais | | Página fora do ar, borda ou WAF barrando o estático, trava de origem recusando o Front Door, a arte de `public/` fora da imagem |
| A home não rola na horizontal em 360 px | | Layout que estoura a tela do celular |
| A home mostra a faixa de cotações (a região "Cotações e macro", com o BOVA11) e o crédito "brapi.dev" no rodapé (onda da brapi, parte 2; ADR 0033) | | O `QUOTES_SECRET` do site diferente do da api (a rota interna de cotações responde 404 e a home vira "Não foi possível carregar os dados"), ou o site sem o segredo |
| A home mostra o pé do hero: a legenda com o crédito "Cotações: brapi.dev", a fita (decorativa, `aria-hidden`) e o quadro 0 da arte no HTML (ADR 0034). Não depende de dado: o banco sem barra (o primeiro deploy) mostra a fita "sem cotações ainda" | | O hero quebrado na revisão nova, ou a arte e a fita fora da página |
| `GET /health` do site: 200 no envelope, `service: "web"` | | Site fora do ar, rota errada no Front Door |
| `GET /api/v1/health` da api: 200 no envelope, `service: "api"` | `@api` | Api fora do ar, rota `/api/*` errada no Front Door |
| A tela `/entrar` abre (200, h1 "Entrar", campo de e-mail) e a `/conta` sem sessão manda para `/entrar?proximo=%2Fconta` (etapa 11, parte 2) | | O site não alcança a api (a tela de entrar lê quais logins ela oferece, com o `X-Azure-FDID`), a conta fora do ar |
| `GET /api/v1/legal` da api: 200, `Cache-Control: no-store` e os dois textos (`TERMS` e `PRIVACY`) | `@api` | Rota `/api/*` do Front Door errada para a conta, ou o texto legal indo para um cache (o aceite grava a versão que a pessoa viu) |
| A tela `/carteira` sem sessão manda para `/entrar?proximo=%2Fcarteira` (h1 "Entrar"; etapa 12, parte 2; sem cookie o site nem chama a api) | | A tela da carteira fora do ar: a revisão nova do web sem a rota (os textos 0.2 da api prometem a tela, `docs/DEPLOY.md`, seção 1) |
| O painel `/admin` sem sessão manda para `/entrar?proximo=%2Fadmin` (etapa 10, parte 2) | | A tela do painel fora do ar, ou o site sem alcançar a api |
| `GET /api/v1/interno/barras/PETR4` da api, sem o segredo, não entrega barra: 403 (o WAF do Front Door bloqueia `/interno/`) ou 404 (a api), nunca 200 (a rota interna de cotações; não usa o segredo) | `@api` | A rota interna fora do WAF e sem o guard do segredo: a série de preços de um papel, sem login, na internet |
| `GET /api/v1/admin/jobs` da api sem sessão responde 401 com `Cache-Control: no-store` (não faz login nem usa conta de admin) | `@api` | O `/api/v1/admin/*` caindo na rota com cache do Front Door, ou a api sem os guards de admin |
| `GET /api/v1/me/portfolio` da api sem sessão responde 401 `UNAUTHORIZED` com `Cache-Control: no-store` (a carteira, etapa 12; não faz login nem usa conta) | `@api` | O `/api/v1/me/portfolio` (dado pessoal) caindo na rota com cache do Front Door, ou a api sem os guards da carteira |
| `POST /api/auth/sign-in/email` com um e-mail que não existe, pelo Front Door e com o `Origin` do site de produção (`SITE_URL`): 401 `INVALID_EMAIL_OR_PASSWORD` (só no site publicado, com a api na mesma origem; não cria conta nem manda e-mail) | `@api` | O `/api/auth/*` não chega à api, o `Content-Length` não passa pela borda (413), o WAF ou a trava de origem barram o POST, ou o `PUBLIC_URL` da api não é a origem do site (403) |

- **Onde a api está.** Atrás do Front Door o site e a api dividem a origem, então o teste usa o próprio `BASE_URL`. Se a api
  estiver noutra origem (build local, imagens Docker), `E2E_API_URL` diz onde. Sem nenhuma das duas variáveis, o
  `playwright.config.ts` sobe o site, o site com a trava e a api (`apps/api/dist`) em portas próprias.
- **O `Origin` do login.** Pelo Front Door verde a requisição vai ao host do green, mas o Better Auth só aceita o `Origin` do `PUBLIC_URL` da api (o site de produção), então o teste manda o `Origin` do `SITE_URL` (que o
  `deploy.yml` já tem no ambiente do job). Sem `SITE_URL` vale o do próprio `BASE_URL`. Por isso o Playwright é chamado direto (`pnpm --filter @alvesting/web exec playwright test`, como o `deploy.yml` faz), e não pelo
  `turbo`, que filtra as variáveis do ambiente.
- **Por que os dois testes da home importam.** O `/health` (site e api) fica fora da trava de origem (ADR 0018), então ele
  responde 200 mesmo com o `FRONT_DOOR_ID` errado ou ausente. Quem prova que o Front Door é aceito pelos apps é a home: sem
  o `X-Azure-FDID` certo ela volta 403 e os dois testes da home falham, enquanto os dois de health passam.
- **Rodar contra qualquer site**, inclusive o que você sobe na máquina:

  ```bash
  BASE_URL=https://meu-site pnpm --filter @alvesting/web exec playwright test e2e/smoke.spec.ts --project=pixel-7 --project=iphone-15
  # só os testes da api (a prova da api do deploy):
  BASE_URL=https://meu-site SITE_URL=https://o-site-de-producao pnpm --filter @alvesting/web exec playwright test e2e/smoke.spec.ts --project=pixel-7 --grep @api
  # api noutra origem (ex.: as duas imagens Docker, em portas publicadas na máquina):
  BASE_URL=http://127.0.0.1:4321 E2E_API_URL=http://127.0.0.1:4322 pnpm --filter @alvesting/web exec playwright test e2e/smoke.spec.ts
  ```

- **Regra para quem mexer no arquivo.** Só entra ali o que vale para um site publicado: sem fixture, sem servidor que o teste
  suba, sem cabeçalho que a borda possa mudar. Teste que depende do servidor local vai nos outros specs. **Teste que só chama a api leva `{ tag: '@api' }`**; o que abre página, não: a prova da api roda antes
  de o web novo existir, e uma página dali pelo green seria a do deploy anterior.
- **Não existe mais a etiqueta `@pos-virada`** (ela adiava para depois da virada o teste que prova código novo, porque o Front Door só alcançava a revisão antiga). Com o green provado antes da virada, pelo mesmo
  Front Door, nenhum teste espera a virada; o `deploy.test.mjs` reprova a volta dela no `deploy.yml` e no `smoke.spec.ts`. Teste de rota nova (carteira, chat, `/admin`) entra no smoke sem etiqueta.

---

## 2. Configurar o OIDC (uma vez)

O GitHub pede um token ao seu emissor; a Azure aceita o token porque existe uma **credencial federada** que confia
naquele repositório e naquele ambiente. Sem senha, sem chave, nada para girar.

Usa-se uma **identidade gerenciada** (`id-alvesting-ci`) e não um app registration: ela só precisa de permissão no
Azure Resource Manager, não de permissão no Entra ID, que uma conta de estudante costuma não ter.

Pré-requisitos: `az login` com uma conta que seja **Owner** do resource group, a infra da fase 1 criada (o ACR e o
resource group existem) e o repositório no GitHub.

```bash
SUB="$(az account show --query id -o tsv)"
TENANT="$(az account show --query tenantId -o tsv)"
RG=rg-alvesting-prod
ACR=cralvesting                       # com nameSuffix na infra, é outro nome
REPO=dono/alvesting                   # <dono>/<repositório> no GitHub

# 1. A identidade do CI
az identity create --resource-group "$RG" --name id-alvesting-ci --location eastus2
CLIENT_ID="$(az identity show -g "$RG" -n id-alvesting-ci --query clientId -o tsv)"
PRINCIPAL_ID="$(az identity show -g "$RG" -n id-alvesting-ci --query principalId -o tsv)"

# 2. Em que condições o GitHub pode usar essa identidade
az identity federated-credential create -g "$RG" --identity-name id-alvesting-ci \
  --name github-production --issuer https://token.actions.githubusercontent.com \
  --subject "repo:${REPO}:environment:production" --audiences api://AzureADTokenExchange
az identity federated-credential create -g "$RG" --identity-name id-alvesting-ci \
  --name github-pull-request --issuer https://token.actions.githubusercontent.com \
  --subject "repo:${REPO}:pull_request" --audiences api://AzureADTokenExchange

# 3. Os papéis (a identidade acabou de nascer: se a Azure disser que o principal não existe, espere 1 minuto)
az role assignment create --assignee-object-id "$PRINCIPAL_ID" --assignee-principal-type ServicePrincipal \
  --role AcrPush --scope "$(az acr show -n "$ACR" --query id -o tsv)"
az role assignment create --assignee-object-id "$PRINCIPAL_ID" --assignee-principal-type ServicePrincipal \
  --role Contributor --scope "/subscriptions/${SUB}/resourceGroups/${RG}"
```

| Credencial | Assunto (`sub`) | Quem usa |
|---|---|---|
| `github-production` | `repo:<dono>/<repo>:environment:production` | `images` e `deploy` do `deploy.yml`, que declaram `environment: production` |
| `github-pull-request` | `repo:<dono>/<repo>:pull_request` | O what-if do `ci.yml`, em PR do próprio repositório (fork não recebe token de OIDC) |

| Papel | Escopo | Para quê |
|---|---|---|
| `AcrPush` | O registro `cralvesting` | Publicar as imagens (`az acr login`, `docker push`) |
| `Contributor` | O resource group `rg-alvesting-prod` | `containerapp update`, `job update` e `job start`, `ingress traffic set`, `revision deactivate` e o `what-if` |

Por que `Contributor` e não algo mais estreito: o `az containerapp update` escreve o app, junta-o ao ambiente
(`Microsoft.App/managedEnvironments/join/action`) e referencia a identidade dos apps (`.../userAssignedIdentities/assign/action`).
`Contributor` no resource group cobre tudo isso. Nada de `Owner`, nada de escopo de assinatura. Um papel próprio, só com
essas ações, é possível, mas **não foi verificado contra a Azure** e não vale o risco de quebrar o primeiro deploy.

Risco que fica: a credencial `github-pull-request` dá esse mesmo `Contributor` a qualquer PR do próprio repositório, e
um PR pode alterar o workflow. Num repositório de um dono só, é aceitável. Se entrar colaborador, apague essa
credencial e o job `whatif` do `ci.yml` (ele é informativo), ou aponte-o para uma segunda identidade só com `Reader`.

---

## 3. Variáveis do GitHub e o ambiente `production`

Settings, Secrets and variables, Actions, **Variables** (variável, não segredo):

| Variável | Valor | Obrigatória |
|---|---|---|
| `AZURE_CLIENT_ID` | `$CLIENT_ID` da identidade `id-alvesting-ci` | Sim. Sem ela, `images`, `deploy` e o what-if são **pulados** (repositório novo e fork não ficam vermelhos) |
| `AZURE_TENANT_ID` | `$TENANT` | Sim |
| `AZURE_SUBSCRIPTION_ID` | `$SUB` | Sim |
| `SITE_URL` | URL pública, com `https://` e sem barra no fim: o output `siteUrl` da infra (`https://alvesting-xxxx.z01.azurefd.net`) ou o domínio próprio | Sim, no `deploy` |
| `SITE_GREEN_URL` | URL do **endpoint green** do Front Door, com `https://` e sem barra no fim: o output `greenSiteUrl` da infra (`https://alvesting-green-xxxx.z01.azurefd.net`). É por ele que o deploy prova a revisão nova antes de ela ter tráfego (seção 1). Não é o domínio próprio | Sim, no `deploy` |
| `AZURE_RESOURCE_GROUP` | `rg-alvesting-prod` | Não: esse é o padrão |
| `ACR_NAME` | `cralvesting` | Não: esse é o padrão. Mude se a infra usou `nameSuffix` |
| `ALVESTING_BUDGET_EMAIL`, `ALVESTING_ADMIN_PRINCIPAL_ID` | Os mesmos do passo 2 do `docs/INFRA.md` | Não: só para o what-if |
| `ALVESTING_PG_API_PASSWORD` | **Não é variável do repositório.** A senha do login da api no Postgres vive só no seu shell e no Key Vault (`docs/INFRA.md`, passo 2); o what-if do `ci.yml` usa um valor de mentira | Não |
| `ALVESTING_LEGAL_CONTROLLER_NAME`, `ALVESTING_LEGAL_CONTACT_EMAIL`, `ALVESTING_GOOGLE_CLIENT_ID` | Os mesmos do passo 2 do `docs/INFRA.md` (a conta, `docs/CONTA.md`). Variáveis do repositório, não segredos | Não: só para o what-if (sem elas ele usa um valor de mentira) |

```bash
gh variable set AZURE_CLIENT_ID --body "$CLIENT_ID" --repo "$REPO"
gh variable set AZURE_TENANT_ID --body "$TENANT" --repo "$REPO"
gh variable set AZURE_SUBSCRIPTION_ID --body "$SUB" --repo "$REPO"
gh variable set SITE_URL --body "https://alvesting-xxxx.z01.azurefd.net" --repo "$REPO"
# o endpoint green do Front Door (a saída greenSiteUrl da infra): só existe depois da fase 1
gh variable set SITE_GREEN_URL --body "$(az deployment group show -g rg-alvesting-prod -n alvesting --query properties.outputs.greenSiteUrl.value -o tsv)" --repo "$REPO"
```

**Ambiente `production`:** Settings, Environments, New environment, nome `production`. Em *Deployment branches and tags*,
escolha *Selected branches* e libere só `main`: assim nenhum outro branch consegue assumir a credencial
`github-production`. Não ponha revisores obrigatórios (cada um dos dois jobs pediria aprovação).

**Branch protection da `main`:** exija os checks `check`, `web`, `images (api)` e `images (web)` do `ci.yml` antes do
merge. O `whatif` é informativo e não precisa ser exigido.

---

## 4. Primeiro deploy: a versão mínima (olá + `/health`)

O que sobe é o que já existe: a home "Alvesting" do site, o `/health` do site e o `/api/v1/health` da api. É suficiente
para provar o caminho inteiro. A ordem importa, porque o Container App não sobe sem imagem e o Bicep não sobe os apps
sem os segredos (`docs/INFRA.md`, seção 6).

1. **Repositório no GitHub.** O repositório local ainda não tem `remote`. Crie o repositório, faça o primeiro push da
   `main` e **não** configure as variáveis ainda: sem `AZURE_CLIENT_ID` os jobs de publicação são pulados, e o primeiro
   push não fica vermelho.
2. **Infra, fase 1** (`docs/INFRA.md`, passos 0 a 3): `deployApps=false`. Cria rede, cofre, banco, filas, ACR e Front Door.
3. **Segredos do Artur** (`docs/INFRA.md`, passo 4): `infra/scripts/seed-secrets.sh`.
4. **OIDC e variáveis** (seções 2 e 3 deste documento). `SITE_URL` vem de
   `az deployment group show -g rg-alvesting-prod -n alvesting --query properties.outputs.siteUrl.value -o tsv`.
5. **Publicar as imagens.** Actions, *Deploy*, *Run workflow*, na `main`, com **images_only** marcado. O job `images`
   constrói a api e o site e publica `cralvesting.azurecr.io/alvesting-api:<sha>` e `.../alvesting-web:<sha>`. O resumo
   do job lista as duas. Guarde o SHA (40 caracteres).

   Cuidado: do passo 4 ao 6 não faça push na `main`. Com as variáveis já configuradas, o push roda o `deploy.yml`: o job
   `images` passa e o `deploy` falha no passo "Fixar o tráfego", com a mensagem "Ele existe? A fase 2 da infra já
   rodou?". Não é defeito, os apps ainda não existem; basta rodar de novo no passo 7.
6. **Infra, fase 2** (`docs/INFRA.md`, passo 6), **informando as tags que acabaram de ser publicadas** e a versão do prompt
   da arena. O `.bicepparam` não traz tag nem versão (um valor fixo reverteria o que está no ar a cada execução da infra, e
   o `latest` nem existe no ACR: o pipeline só publica a tag do SHA). Sem as três o Container App não sobe. Elas vêm do
   ambiente (`ALVESTING_API_TAG`, `ALVESTING_WEB_TAG` e `ALVESTING_PROMPT_ARENA_VERSION`, esta já exportada no passo 4 do
   INFRA.md) ou da linha de comando, que vence o ambiente:

   ```bash
   az deployment group create --resource-group rg-alvesting-prod --name alvesting \
     --parameters infra/main.prod.bicepparam apiImageTag=<sha> webImageTag=<sha> promptArenaVersion=<versão>
   ```

   As imagens já trazem a trava de origem, com o contrato fail closed (`ORIGIN_LOCK=front-door` exige
   `FRONT_DOOR_ID` e o app recusa subir sem ele): é a condição que o INFRA.md, 3.3, põe para ligar a fase 2. Elas trazem também o cliente do PostgreSQL 17 (o `backup-verify` e o SQL pontual do RUNBOOK) e o
   `db:roles`, que o `job-migrate` roda; a api em produção só sobe com o login `alvesting_api` (`docs/INFRA.md`, 2.2).

   **Logo depois da fase 2, rode o `job-migrate` uma vez** (`docs/INFRA.md`, passo 6): é ele que cria o login da api no banco. A fase 2 já pôs o `database-url-api` no `DATABASE_URL` do `ca-api`, e até esse
   job rodar o login não existe: o `/health` responde (ele não consulta o banco), mas as rotas que consultam falham. O deploy do passo 7 roda o mesmo job antes de criar a revisão nova (é idempotente), então esta
   execução só encurta o tempo com a api sem login.

7. **O primeiro deploy completo.** Actions, *Deploy*, *Run workflow* com `images_only` **desmarcado** (ou qualquer push
   novo na `main`). Ele roda as migrations pelo `job-migrate`, cria a revisão de cada app com o label `green`, passa pelos
   portões (o Front Door verde de verdade) e vira o tráfego, a api primeiro. Precisa da variável `SITE_GREEN_URL` (seção 3). É o teste real do pipeline.
8. **Conferir.**

   ```bash
   SITE="$(az deployment group show -g rg-alvesting-prod -n alvesting --query properties.outputs.siteUrl.value -o tsv)"
   curl -fsS "$SITE/health"          # {"success":true,"data":{"status":"ok","service":"web"},"error":null}
   curl -fsS "$SITE/api/v1/health"   # ... "service":"api"
   ```

   Abra `$SITE` no celular: a home "Alvesting" tem de carregar.

   **Entrar numa conta de teste, num iPhone de verdade e no Chrome do Android** (a etapa 11 trouxe a conta): é a primeira
   prova do cookie de sessão com o prefixo `__Secure-` pela borda de verdade. O e2e o exercita em Chromium e em WebKit
   atrás de um Front Door imitado em https (`apps/web/e2e/front-door.ts`), mas o certificado do Front Door, o `Host`
   reescrito e o iPhone físico só se provam aqui. Cadastre-se com um e-mail seu, confirme pelo link, entre, abra `/conta`
   (tem de mostrar os seus dados, e não mandar de volta para `/entrar`), baixe a exportação, saia e exclua a conta.
9. **Anotar o SSE.** O resumo do job do passo 7 tem a seção "SSE pelo Front Door". Copie o veredito e os tempos para a
   tabela "Pelo Front Door" do `docs/adr/0017-sse-pelo-front-door.md` (e repita em outros horários).

Depois disso, todo merge na `main` publica sozinho.

---

## 5. Quando algo falha

| Sintoma | Onde olhar |
|---|---|
| `images` pulado | A variável `AZURE_CLIENT_ID` não existe, ou o run é de um fork |
| `azure/login` falha com `AADSTS70021` ou `AADSTS700213` | O `sub` do token não bate com nenhuma credencial federada. O job do `deploy.yml` precisa do `environment: production` e a credencial é `repo:<dono>/<repo>:environment:production` (maiúsculas e minúsculas contam). Para PR, a credencial `pull_request` |
| `az acr login` ou `docker push` negado | A identidade não tem `AcrPush` no ACR, ou o papel ainda propaga (alguns minutos) |
| `pin` diz "não está 100% numa revisão só" | Alguém dividiu o tráfego à mão. Acerte (`az containerapp ingress traffic set --revision-weight <rev>=100`) e rode de novo |
| `migrate` termina em `Failed` | Veja o log da execução do `job-migrate` no portal (Container Apps, Jobs, Execution history). O banco não muda quando a migration falha inteira; a antiga segue no ar |
| Smoke no label (`smoke-green`) falha | O log do passo traz a URL do label (`<app>---green.<domínio>`) e o motivo (`status 503`, sem envelope, `service` errado, ou "o label green não está na revisão ..."). A revisão nova já foi desativada pelo `Desfazer`; veja o log do app no Log Analytics |
| Playwright pelo Front Door verde reprova (502, 503, 403) com o smoke no label verde | O app está bem; o problema é a borda do green: o Front Door recusou a origem no FQDN do label, as sondas do grupo `web-green`/`api-green` ainda não ficaram saudáveis (até ~2 minutos), ou a trava de origem (`FRONT_DOOR_ID`) não bate. `az afd origin-group list` e `az afd endpoint show` (`docs/INFRA.md`, seções 2.5 e 11) |
| `create` diz "NoTTYException" ou pede confirmação no `label add` | O `--yes` não foi no comando: o label já estava noutra revisão e a CLI perguntou. O `deploy.mjs` já o passa; se o erro aparece, o comando à mão está sem ele |
| Smoke pelo Front Door de produção (ou pelo verde) falha com 403 | A trava de origem recusou: o `FRONT_DOOR_ID` do app não é o do perfil. Confira o segredo `front-door-id` e o `az afd profile show --query frontDoorId` |
| O `deploy` falha no passo 1 ("falta a variável SITE_GREEN_URL") | A variável do repositório do endpoint green não existe (seção 3): `gh variable set SITE_GREEN_URL --body "$(az deployment group show -g rg-alvesting-prod -n alvesting --query properties.outputs.greenSiteUrl.value -o tsv)"` |
| A api não sobe em produção: "só roda com o login alvesting_api" | O `DATABASE_URL` do `ca-api` aponta para o segredo do administrador. Tem de ser o `database-url-api` (`docs/INFRA.md`, 2.2) |
| A api sobe, mas as rotas que consultam o banco dão `password authentication failed` | O login `alvesting_api` não existe no banco ou a senha dele não é a do `database-url-api`: rode o `job-migrate` (cria o login e define a senha) e, se acabou de girar a senha, reinicie a revisão do `ca-api` (`docs/INFRA.md`, 8.2) |
| `Desfazer` com "rollback incompleto" | Está dito qual app e qual passo. Acerte à mão (seção 6) |

## 6. Voltar uma revisão à mão

Depois do ponto sem volta (o passo 10: as revisões antigas estão **desativadas**), voltar é um comando por app, que o `deploy.test.mjs` cobre:

```bash
export RESOURCE_GROUP=rg-alvesting-prod
# --all: sem ele a CLI só lista as revisões ATIVAS, e depois do passo 10 as antigas estão desativadas (não apareceriam)
az containerapp revision list --all -n ca-api -g "$RESOURCE_GROUP" -o table  # escolha a revisão que você quer de volta (ca-api--<sufixo>)
node scripts/deploy.mjs revert ca-api--<sufixo>
# se a web também precisar voltar:
node scripts/deploy.mjs revert ca-web--<sufixo>
```

O `revert` reativa a revisão se ela estiver desativada, espera ela ficar saudável, passa a ela os **100%** do tráfego (conferindo que ficou numa só), desativa a que estava servindo (a defeituosa; reative-a com `az containerapp revision
activate` para investigar) e confere o `/health` do app (e o `/api/v1/health` da api) no endereço dele. Recusa nome que não seja de `ca-api` ou `ca-web`, tráfego dividido entre revisões (acerte à mão antes) e revisão que não existe,
sem mexer em nada; se a revisão que volta não ficar saudável, o tráfego não muda. Ele não toca no label `green` (que é do deploy) nem nos jobs.

**Deploy que morreu no meio** (o runner caiu ou o job estourou o tempo, e o `Desfazer` não rodou). O `rollback` do `deploy.mjs` lê o arquivo de estado do runner, que se perdeu, então a volta é à mão. Antes do passo 10 a revisão antiga segue com os 100% (menos a da api,
se ela já tinha virado no passo 7), e a **revisão nova, que não foi provada, segue ativa e com o label `green`**: o endpoint green do Front Door (uma segunda entrada pública, ADR 0029) a serve até o próximo deploy, cujo `cleanup` a desativa. Para não esperar, os mesmos
três passos do `rollback`, em cada app que tem uma revisão nova (a do label `green`, ou a `<app>--<sufixo>` do run que morreu):

```bash
export RESOURCE_GROUP=rg-alvesting-prod
for app in ca-api ca-web; do az containerapp ingress traffic show -n "$app" -g "$RESOURCE_GROUP" -o table; done   # quem tem os 100% e quem tem o label green
az containerapp ingress traffic set -n ca-api -g "$RESOURCE_GROUP" --revision-weight ca-api--<a antiga>=100        # 1. os 100% de volta à antiga
az containerapp revision label remove -n ca-api -g "$RESOURCE_GROUP" --label green                                   # 2. o label sai da nova
az containerapp revision deactivate -n ca-api -g "$RESOURCE_GROUP" --revision ca-api--<a nova>                        # 3. a nova sai do ar
```

O [RUNBOOK](RUNBOOK.md), seção 6, repete este passo.

**Os jobs não voltam por aqui.** O worker, as decisões e os agendadores não têm revisão (seção 1): para devolver a imagem deles, use o *Re-run all jobs* do run verde do commit que você quer de volta (as imagens são reconstruídas
desse commit, o pipeline refaz o rollout inteiro e o `roll-roles` leva a imagem de volta) ou `az containerapp job update --image <imagem antiga>` em cada um. A migration não volta: é só aditiva, e o código antigo convive com o banco novo.

**Voltar com um `eod` em espera.** A migration `20261102120000_job_run_waiting` é aditiva (o valor `WAITING` do enum `job_run_status`), mas o código novo é quem passa a gravá-lo:
o `eod` que espera o arquivo do pregão deixa a linha `WAITING` até a cópia agendada reassumi-la (a partir de 21:30, nas noites de pregão). O código antigo **não reassume linha `WAITING`** (só `FAILED` e `RUNNING` velho), então responde "ocupada" a toda entrega e o `eod` do dia
vai para a DLQ (uns 45 minutos depois). Voltou a revisão com uma linha assim? **Antes de a cópia agendada chegar**, no banco:

```sql
UPDATE job_run SET status = 'FAILED' WHERE status = 'WAITING';
```

Como rodar esse SQL no Postgres privado: uma execução do `job-migrate` com o comando trocado, e o `psql` 17 que a imagem da api traz (`docs/INFRA.md`, 8.6, linha "SQL pontual"). O [RUNBOOK](RUNBOOK.md), seção 6, repete este passo.

## 7. O que este pipeline não faz (e o que não foi verificado)

- **Primeiro run real.** Precisa do repositório no GitHub e da assinatura. Tudo aqui foi validado com `actionlint`, com os
  testes de `scripts/deploy.test.mjs` (que usam um Container Apps falso com as regras da documentação da Azure) e com os
  mesmos comandos rodando localmente. Não rodou contra a Azure.
- **Smoke do Playwright no Front Door de verdade.** Foi provado no build local, nas duas imagens e num proxy que imita o
  Front Door (uma origem, `/api/*` para a api, `X-Azure-FDID` anexado, trava ligada nos dois apps), e foi provado que ele
  falha quando deve (site falso com um defeito por vez). Não foi provado contra o Front Door e o WAF reais. Um risco
  conhecido: o WAF barrar o User-Agent do `request` do Playwright, que os dois testes de health usam (o da home é um
  navegador). A home já não vem do cache da borda (ADR 0023: o HTML é dinâmico e a rota `/*` não tem cache), e desde a etapa 9
  ela lê a api: com o `API_INTERNAL_URL` ou o `X-Azure-FDID` do site errados, o servidor responde 200 com a tela de erro, sem o
  h1 da home (hoje o título do hero, ADR 0034), e o smoke reprova (provado na integração da onda 3a, com o site standalone sem api).
- **Premissas da Azure que o pipeline confere em execução**, porque não deu para testá-las aqui: que a revisão nasce com
  0% quando o tráfego está fixado por nome e que o label não a faz receber tráfego (o passo 4 confere os dois e devolve se não for), que `az containerapp job update
  --image` mantém o comando do `job-migrate` (agora `sh -c 'migrate deploy && db:roles'`), e que `--parameters arquivo.bicepparam chave=valor` (o formato do
  INFRA.md) aceita o override de tag no what-if.
- **O blue/green nunca rodou na Azure** (etapa 10, parte 4). Não verificado: o Front Door aceitar o FQDN do label (três hífens) como origem e o certificado curinga do ambiente passar na conferência do nome; o ingress entregar o label a
  uma requisição com esse `Host`; as sondas do grupo verde ficarem saudáveis a tempo (3 de 4 amostras de 30 s); a propagação do papel de Blob e de Service Bus por escopo de container e de fila; e o `label add` trocar o dono do label sem pedir
  confirmação com o `--yes`. Tudo isso está nas linhas da seção 11 do `docs/INFRA.md`, com o que fazer se falhar (inclusive o desvio previsto no ADR 0029, o smoke pelo FQDN do label com o `X-Azure-FDID`).
- **Os jobs não têm revisão** (seção 1): o `roll-roles` depois do ponto sem volta é o único passo que os atualiza, e uma falha nele se resolve rodando o passo de novo.
- **A lista de tráfego do app cresce.** O `az containerapp ingress traffic set` mescla, não substitui: cada revisão que
  já teve tráfego fica na lista com peso 0 (e a regra "sempre a última" também, com peso 0). Não muda o roteamento, e o
  pipeline só olha quem tem peso maior que zero. Se um dia a Azure recusar a lista por causa de revisões apagadas, é
  preciso limpá-la (`az containerapp update --set properties.configuration.ingress.traffic=...`, não verificado).
- **Perfil econômico** (GHCR e sem Front Door): o pipeline cobre só o padrão (ACR e Front Door). No econômico a imagem
  iria para o GHCR e o smoke bateria direto no ingress.
- **Rollback deixa o template do app apontando para a imagem que falhou** até o próximo deploy bom. A revisão que serve é a
  antiga. Por isso o what-if lê a tag da revisão com tráfego (`current-tags`), não a do template, e quem roda a infra à
  mão deve informar as tags que estão no ar (`docs/INFRA.md`, 7.3).
- **Exceção da revalidação.** A revalidação do worker para o site (`POST /interno/revalidar` com o `REVALIDATE_SECRET` válido
  em `Authorization: Bearer`) é a segunda e última exceção da trava (etapa 9; `docs/INFRA.md`, 3.3). O worker chama o ingress do
  `ca-web` direto, então a rota não precisa passar pelo Front Door, e o WAF a bloqueia na borda (`BlockInterno`, `/interno/`). O
  `REVALIDATE_SECRET` tem pelo menos 32 caracteres (o worker e o site recusam um mais curto) e, em produção, a `WEB_INTERNAL_URL` é https.
- **Cache da API pública: conferir depois do primeiro deploy** (nada disto pôde ser exercitado sem a Azure; `docs/API.md`, seções 2 e 6).
  Com o `curl -si` no host do Front Door, duas vezes cada um:
  1. `/api/v1/arena/current` e `/api/v1/arena/current?limit=1` (este dá 400, e erro não se guarda): a segunda resposta do primeiro tem de vir
     com `x-cache: TCP_HIT`; a do 400 vem com `cache-control: no-store` e `x-cache: PRIVATE_NOSTORE`, nunca HIT.
  2. Repetir com `Cache-Control: no-cache` e com `If-None-Match: <o etag>` na requisição: o Front Door documenta que não suporta `ETag` (só
     `Last-Modified`), então a revalidação condicional do navegador pode chegar à origem sempre; vale saber o quanto.
  3. `/api/v1/health` e `/api/docs` (rota `api`, sem cache) têm de vir com `x-cache: CONFIG_NOCACHE` ou `PRIVATE_NOSTORE`, nunca HIT, e
     `POST /interno/revalidar` e `GET /api/v1/interno/barras/PETR4` (a rota interna de cotações, `docs/API.md`, seção 6) pelo host do Front Door têm
     de dar 403 do WAF (`BlockInterno`), nunca 200 nem HIT.
  4. Depois de uma liquidação (ou de `POST` do purge à mão com `az afd endpoint purge`): a próxima leitura de `/api/v1/arena/current` volta
     a ser MISS e traz o `lastCycle` novo, em até 10 minutos; o worker (`id-alvesting-worker`) tem de receber 202 do purge (o papel
     aceitar a ação no endpoint), e o log `cache_publico_falhou` não pode aparecer.
  5. Com o `ca-web` em mais de uma réplica, a revalidação só vence a que a recebeu (`docs/API.md`, 2, limite a): confira o quanto isso aparece.
  6. Uma requisição com `Authorization` a uma rota pública também é guardada, porque a resposta é `public` e `s-maxage` (a documentação do Front
     Door: a requisição com `Authorization` só não é guardada se a resposta não trouxer `must-revalidate`, `public` ou `s-maxage`). Hoje tudo ali é público de verdade; o que protege uma rota nova sob os curingas
     (`/seasons/*`, `/competitors/*`, `/cycles/*`, `/stocks/*`) é a API mandar `no-store` em tudo o que não declara cache. Confira com `Authorization: Bearer x`.
  7. `HEAD` e `OPTIONS` nas rotas públicas pelo Front Door, o `X-Forwarded-For` que o ingress põe (para o limite de taxa do perfil
     econômico) e o job `images` do CI (`docker build` não rodou aqui).
- **Service Bus por identidade.** O cliente que usa `SERVICEBUS_FQDN` com o `DefaultAzureCredential` entrou na etapa 4
  (`service-bus-client.ts`, com `@azure/identity`). O que falta é exercitá-lo na Azure: o emulador e o CI só aceitam connection
  string, então o caminho por identidade só roda no primeiro deploy.
- **Imagem da api com cerca de 900 MB** (e uns 40 MB a mais com o `postgresql-client-17`, não medidos: `docker build` não roda onde isto foi escrito; o job `images` do CI imprime o tamanho no resumo), porque leva o CLI do Prisma para o `job-migrate`. Se pesar, o caminho é uma
  imagem só de migração.
- **Lighthouse mobile na home** (já com o conteúdo da etapa 9) mediu LCP de 1,9 a 2,34 s (o valor de referência é 2,34 s; meta: 2,5 s).
  A margem é de uns 160 ms; um runner mais lento pode estourar. Se o gate piscar, o ajuste é na página, não na meta (as saídas estão
  em `docs/TELAS.md`, seção 5).
