# ADR 0039: A produção no perfil econômico: uma origem só pelo site, o pipeline no GHCR e a temporada levada por uma execução do job-migrate

- **Status:** aceita
- **Data:** 06/11/2026
- **Origem:** o pedido do Artur de 06/11/2026 ("Como posso subir no azure o projeto com pipeline no github?" e "criou a pipe pra eu subir o
  projeto na azure?"); a decisão do coordenador da onda "Azure no perfil econômico" (a produção sobe no econômico); `docs/INFRA.md`, 1.3, 2.7, 3.3
  e 6; `docs/DEPLOY.md`; `docs/RUNBOOK.md`, 13.6; ADR 0018 (a trava de origem), 0028 (o papel mínimo do Postgres e o backup sem dado pessoal),
  0029 (o blue/green) e 0038 (a temporada no Mac).

## Contexto

O crédito é o Azure for Students, US$ 100 por 12 meses. O perfil padrão (Front Door, uns US$ 72 a 83 por mês) dura umas 5 semanas e acaba antes
das notas, e o site tem de ficar no ar até depois do Demo Day (10 a 16/12). O econômico custa uns US$ 5 a 10 por mês. O Bicep já tinha os dois
perfis, mas três buracos impediam o econômico de servir de produção:

1. **O pipeline era só do padrão:** as imagens iam ao ACR (`az acr login`) e a revisão nova era provada pelo endpoint green do Front Door.
2. **Não havia uma origem só.** O navegador chama a api por caminho relativo (`/api/auth/*` nos formulários da conta, `/api/v1/me/portfolio/lots`
   na carteira) e o link do e-mail é `PUBLIC_URL/api/auth/...`. No padrão o Front Door manda `/api/*` à api; no econômico ninguém fazia isso (o
   `rewrites` do `next.config.ts` só existia no `pnpm dev`), e entrar, cadastrar, confirmar o e-mail, o callback do Google e a carteira dariam 404.
   O CORS da api no Bicep não resolvia: o código nunca chama o host da api pelo navegador.
3. **A temporada real não tinha como entrar.** Ela está no `alvesting_temporada` do Mac (ADR 0038) e no Azurite; o Postgres da Azure é privado.

## Decisão

1. **A produção nasce no econômico** (`infra/main.prod.bicepparam`, `profile = 'economico'`), e o padrão continua funcionando exatamente como
   antes para quem tiver crédito: nenhum passo do padrão mudou (o `deploy.test.mjs` e o `check.mjs` afirmam isso).
2. **Uma origem só pelo site.** No econômico a api tem ingress **interno** (`external: false`, sem CORS) e só os apps do ambiente a alcançam;
   o site repassa `/api/*` a ela em tempo de execução, no `apps/web/src/proxy.ts` (`src/lib/api-proxy.ts`), ligado por `API_PROXY=on`, que o
   Bicep põe só no econômico, junto com o `API_INTERNAL_URL` interno (`https://ca-api.internal.<domínio>`; Learn, "Communicate between container
   apps"). É um `NextResponse.rewrite` para outra origem, resolvido a cada requisição: o `rewrites` do `next.config` seria fixado no build, e a
   imagem é uma só para os dois perfis. O Next o faz como proxy HTTP (`proxy-request.js`, `changeOrigin`): o corpo, o `Origin`, o `Set-Cookie` e os
   302 passam como vieram, e a api continua conferindo o `Origin`. Duas regras da borda moram no repasse:
   - **nunca leva `/api/v1/interno/*`** (404 igual ao da rota que não existe, como o `BlockInterno` do WAF), conferido decodificado e sem
     diferença de caixa;
   - **regrava o `X-Forwarded-For` com a entrada da direita**, a única que o ingress do Container Apps escreve ("Only the rightmost IP is provided
     by Azure Container Apps": Learn, "Ingress in Azure Container Apps"). O Better Auth só confia num `X-Forwarded-For` de um valor
     (`getIPFromHeader`, `@better-auth/core/utils/ip`), e o ingress interno da api acrescenta o IP do site à direita; por isso a api, sem o Front
     Door, ganhou `trustedProxies` com as faixas privadas (`auth.ts`): ela pula esse salto e conta o cliente. Um `X-Forwarded-For` forjado não
     abre um balde novo no limite do login (o e2e e o teste de integração provam).
   O `pnpm dev` passou a usar o mesmo repasse (o `devRewrites` saiu): o dev exercita o caminho do econômico.
3. **O pipeline no econômico**, pela variável do repositório `ALVESTING_PROFILE` (`economico`; ausente ou `padrao` = os passos de sempre): o job
   `images` publica no GHCR (`ghcr.io/<dono em minúsculas>`, `docker login` com o `GITHUB_TOKEN` pela entrada padrão, `packages: write`, o rótulo
   `org.opencontainers.image.source`, sem `azure/login`); o `deploy` tem a mesma ordem e o mesmo "Desfazer", mas a api verde, interna, é provada
   **pelas sondas da plataforma** (`probe-green`: o label na revisão nova, saudável em 3 leituras seguidas, 10 s entre elas) e o web verde pelo
   smoke e pelo Playwright mobile **no endereço do label** (`green-url`), que já fala com a api nova pelo repasse.
4. **A temporada vai por uma execução do job-migrate** com o comando trocado (`node dist/restore-cli.js temporada <dump> <sha256>`; Learn, "Jobs
   in Azure Container Apps": a execução pode trocar o modelo inteiro). O comando lê o dump do container `backups` pela identidade do migrate (só
   leitura nesse container, e só no econômico), confere o SHA-256 antes de escrever, recusa o destino que já tem temporada, o dump que não é só
   de dados e o que traz as tabelas pessoais, e restaura numa transação só (o psql com o script do pg_restore): o TRUNCATE do que os agendadores
   da Azure já coletaram nas tabelas que o dump traz e os COPY. A trilha (`audit_log`) só cresce e as tabelas pessoais não são tocadas. Depois,
   cada tabela tem de ter as linhas do dump, e as contagens vão para o log. Nada pede superusuário (o administrador do Flexible Server não é).
5. **Quem opera escreve nos três containers** (Storage Blob Data Contributor em `backups`, `briefings` e `llm-io`, só no econômico, para o
   `adminPrincipalId`): o envio do dump e a cópia do Blob do Azurite pelo `az storage blob upload-batch --auth-mode login`. Ser Owner do
   resource group não basta (Learn, "Authorize access to blob data with Azure CLI": "Even though you are the account owner, you need explicit
   permissions to perform data operations").

## Alternativas descartadas

- **A api com ingress externo e CORS, o navegador chamando o host dela.** O cookie da sessão é `SameSite=Lax` e primário; com dois hosts, o
  `Origin`, o cookie e o link do e-mail deixam de fechar, e o código teria de mudar em todo formulário. E a api ficaria na internet, sem o WAF.
- **O `rewrites` do `next.config` em produção.** Ele é resolvido no build, e a imagem é a mesma para os dois perfis.
- **Um `fetch` à mão no proxy.** O `NextResponse.rewrite` já faz o repasse em fluxo, sem seguir redirecionamento nem reescrever cookie; um
  `fetch` descomprime a resposta e pede cuidado com o `Set-Cookie` repetido.
- **Front Door só para o deploy.** A taxa-base é por perfil, o mês inteiro.
- **Restaurar pela máquina do Artur.** O Postgres não tem acesso público (ADR 0028, seção 2.2 do INFRA.md), e abrir um caminho só para isso
  seria abrir o banco.
- **Uma identidade nova só para a restauração.** O coordenador fixou a do migrate; o teto dela é o de quem pode iniciar o job, que já lê o
  `database-url` do administrador.

## Consequências

- **O portão da api é mais fraco no econômico.** O runner não alcança a api interna (de fora, o proxy do ambiente responde 404), então ela não
  passa por smoke HTTP nem Playwright antes da virada: só as sondas (`GET /health` no contêiner). Quem a prova por HTTP é o Playwright do web
  verde, depois de a api virar; se ele reprovar, o "Desfazer" devolve os dois apps. Uma api que sobe saudável e erra numa rota fica no ar
  durante os minutos do web verde.
- **A identidade do migrate vale para o código no econômico** (`lifecycle: Main`, com `AZURE_CLIENT_ID` e `STORAGE_BLOB_ENDPOINT`): o teto é ler
  os dumps do `backups`, que não têm dado pessoal. No padrão ela segue só da plataforma.
- **O `trustedProxies` são as faixas privadas inteiras**, porque o IP que o ingress interno acrescenta (o da réplica do site) só a Azure mostra.
  O próprio Better Auth avisa para não usar faixa que cubra clientes; aqui nenhum cliente chega à api de endereço privado. Depois do primeiro
  deploy dá para estreitar à sub-rede do ambiente (INFRA.md, 11).
- **A resposta repassada leva o cabeçalho `x-middleware-rewrite`** com o endereço interno da api (o Next o põe). Não é segredo (o domínio do
  ambiente é o mesmo do site, e o endereço interno não responde fora), mas fica registrado.
- **O pacote do GHCR nasce privado** e precisa ficar público uma vez (a página de configurações do pacote; a API REST do GitHub não tem rota para
  a visibilidade). Sem isso a Azure não puxa a imagem.
- **O que só a Azure e o GitHub provam** está no INFRA.md, seção 11: o ingress interno e o repasse de verdade, o IP que a api vê, o `job start` com
  o comando trocado lendo o Blob pela identidade do migrate, o primeiro publish no GHCR e a visibilidade do pacote.
