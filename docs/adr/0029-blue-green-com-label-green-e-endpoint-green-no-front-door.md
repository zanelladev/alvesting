# ADR 0029: Blue/green com o label `green`, a api antes do web e um endpoint green no Front Door

- **Status:** aceita (substitui em parte o ADR 0019)
- **Data:** 03/11/2026
- **Origem:** `docs/PLANO.md`, §5.10 ("nova revisão (label `green`, 0% do tráfego) → smoke e Playwright mobile pelo Front Door → 100% para `green`") e a etapa 10 do §16; ADR 0019; `docs/DEPLOY.md`; `docs/INFRA.md`, 2.5

## Contexto

O ADR 0019 deixou duas provas do código novo: pela URL da própria revisão (só o `/health`) e, **depois** da virada, pelo Front Door, porque a origem do Front Door é o endereço do app e, com a revisão nova a 0%, ele só
alcançava a antiga. Isso custou uma etiqueta (`@pos-virada`) nos testes do smoke que provam código que a antiga não tem, uma janela de um a dois minutos em que o usuário via o código novo antes de o Playwright passar por ele, e um `Desfazer`
que sempre acabava com a janela aberta. O ADR dizia que o blue/green com label da etapa 10 fecharia isso, "com uma origem ou regra de rota no Front Door".

Três coisas pesaram: o Container Apps documenta o **label** para exatamente isto (uma URL própria `<app>---<label>.<domínio do ambiente>` para a revisão em prova, que mora numa revisão por vez e **não pede peso de tráfego**; Learn, "Revisions" e "Blue-green
deployment in Azure Container Apps"); o Front Door Standard **não cobra** rota, regra própria do WAF, endpoint, grupo de origem nem origem (a taxa-base é por perfil: Learn, "Compare pricing between Azure Front Door tiers", 25/09/2025; limites do Standard: 10
endpoints, 100 rotas, 100 grupos de origem); e o web novo pode depender da api nova, enquanto a migration é só aditiva (a api nova convive com o web antigo).

## Decisão

1. **Um label só, `green`, na revisão em prova.** O `pin` prende os 100% à revisão atual, pelo nome; o `create` cria a revisão nova com 0%, espera ficar saudável e dá a ela o label (`az containerapp revision label add --yes`; sem o `--yes` a CLI pergunta ao trocar o dono do label e, sem TTY, falha);
   confere de novo que o tráfego não mudou. O `promote` passa os 100% pelo nome da revisão. O label **fica na revisão que está no ar** depois do `cleanup` (o endpoint green segue com origem saudável) e muda de dono no deploy seguinte; o `rollback` o tira da revisão
   nova e a desativa.
2. **A api antes do web, cada um com a prova inteira antes da virada.** `create api`, `smoke-green api`, Playwright mobile pelo green com `--grep @api`, `promote api`; depois o mesmo para o web, e o Playwright do web verde já fala com a api nova. Falhou
   em qualquer ponto antes do `cleanup`: o `rollback` devolve **os dois** apps à revisão antiga (a api já promovida inclusive), tira o label e desativa as novas.
3. **Um endpoint green no Front Door** (`alvesting-green`), com dois grupos de origem (`web-green` e `api-green`, no endereço do label de cada app) e duas rotas **sem cache** (`/api/*` e `/*`). Ele está nos domínios da política de segurança do WAF (as regras valem) e usa o mesmo
   `X-Azure-FDID` (a trava de origem vale). Não usa o domínio próprio. O host sai na saída `greenSiteUrl` e vira a variável de repositório `SITE_GREEN_URL`.
4. **A etiqueta `@pos-virada` acaba.** O mesmo `smoke.spec.ts` roda no green (antes da virada) e em produção (depois dela); nenhum teste espera a virada. Os testes que só chamam a api levam `@api` para a prova da api rodar sem abrir página (o web verde ainda é o do
   deploy anterior). O `deploy.test.mjs` reprova a volta da etiqueta.
5. **Voltar uma revisão** é `node scripts/deploy.mjs revert <revisão>`: reativa, espera ficar saudável, passa os 100%, desativa a que servia e confere o `/health`. Não toca no label nem nos jobs.
6. **Jobs e worker não têm revisão.** Não há blue/green para eles: o `roll-roles` os atualiza **depois** do ponto sem volta, e uma falha ali se resolve repetindo o passo (idempotente). `docs/DEPLOY.md`, seção 1.
7. **O alerta de origem doente olha só os grupos `web` e `api`.** Os verdes ficam sem revisão depois de um deploy que falha (o `rollback` tira o label da nova) e até o primeiro deploy, e isso não é o site doente: o deploy já fica vermelho.

## Alternativas descartadas

- **Testar o green só pelo FQDN do label, com o `X-Azure-FDID` no cabeçalho, e manter o smoke `@pos-virada` pelo Front Door.** É o desvio previsto se o Front Door recusar a origem: o CI lê o ID do perfil com `az afd profile show --query frontDoorId` (o papel
  de deploy já o lê; o ID é mascarado e não fica no GitHub, o que responde à objeção do ADR 0019). Perde a prova da borda (WAF, certificado, rotas) antes da virada e mantém a etiqueta. Fica como volta, não como desenho.
- **Rule set do Front Door com um cabeçalho que desvia para o green** (ação "Route configuration override", disponível no Standard). Uma regra de cabeçalho fixo é só obscuridade, e trocá-la por deploy leva minutos para propagar na borda.
- **Dois labels que se revezam, `blue` e `green`** (o desenho do exemplo da Microsoft). Troca a pergunta "qual é a nova?" por "qual é o papel de cada label agora?" e pediria o estado do papel entre deploys; um label só, que muda de dono, é o que o plano diz.
- **Criar as duas revisões e provar as duas juntas antes de virar qualquer uma.** O web novo seria provado contra a api **antiga**, o que não prova a combinação que vai para o ar.
- **Dividir o tráfego (canário) em vez do label a 0%.** O Playwright cairia numa ou noutra revisão ao acaso e o usuário veria código não provado (ADR 0019).

## Consequências

- O Front Door tem um segundo endereço público (`alvesting-green-<hash>.z01.azurefd.net`) para o label green. Passa pelo WAF, pelo limite de taxa e pelo `BlockInterno`, serve o mesmo código e o mesmo banco do site (a versão que o deploy acabou de provar ou a do
  último), e ninguém o lista; mas qualquer pessoa que o descubra o alcança. Risco aceito: é uma segunda entrada para o que já é público, **com três pontas soltas que o desenho não fecha**:
  (a) o host é uma variável do repositório (`SITE_GREEN_URL`), não segredo, e o Actions imprime o `env` de cada passo sem máscara (o `BASE_URL` do Playwright): com o repositório público o host aparece nos logs, então trate-o como conhecido;
  (b) o endpoint não tem rota com cache, de modo que as GET públicas que o endpoint do site absorve na borda chegam, pelo green, à origem da api (0,25 vCPU), e só o limite do WAF (600 por minuto por IP, o mesmo do site) as segura;
  (c) o label **fica na revisão que está no ar depois do `cleanup`**, e se o runner morre ou o job estoura o tempo antes do `Desfazer`, a revisão não provada segue ativa, com o label e alcançável por esse host, até o próximo deploy (o `cleanup` dele a desativa); a volta à mão
  está em `docs/DEPLOY.md`, seção 6 ("Deploy que morreu no meio"). Se algum desses pesar, o caminho é uma regra própria do WAF com limite de taxa mais baixo só para o host green (condição de cabeçalho `Host`; o limite certo depende do volume de requisições do smoke, que não foi medido),
  ou as rotas do green desligadas (`enabledState: Disabled`) e ligadas só durante o deploy (`az afd route update`, esperando a propagação na borda). Nenhum dos dois foi feito.
- **O alerta `alvesting-front-door-5xx` conta o endpoint green** (a métrica `Percentage5XX` não tem filtro por endpoint na regra): a revisão nova que falha na prova (5xx no Playwright pelo green) dispara esse alerta por e-mail com o site de produção saudável. O deploy já fica vermelho e o
  `Desfazer` encerra o motivo; fica registrado no INFRA.md 5.3 como falso alarme conhecido. Filtrar pela dimensão `Endpoint` pede o formato do valor, que só o primeiro deploy mostra (`docs/INFRA.md`, seção 11), e um valor errado deixaria o alerta mudo, que é pior.
- **Custo:** nenhum novo (rotas, regras do WAF, endpoint, grupos e origens são grátis no Standard). Um Playwright a mais por deploy (uns 30 segundos por app).
- O Playwright de produção depois da virada continua (as rotas com cache e o domínio próprio só o endpoint do site tem), com volta automática; a janela de código novo sem prova pelo Front Door some.
- **Não verificado na Azure** (precisa da assinatura; `docs/INFRA.md`, seção 11): o Front Door aceitar o FQDN do label (três hífens) como origem e o certificado curinga do ambiente passar na conferência do nome; o ingress entregar o label a uma requisição com esse `Host`;
  o tempo para as sondas do grupo verde ficarem saudáveis; o `label add --yes` trocar o dono sem pedir confirmação. O fake de `deploy.test.mjs` imita as regras do Azure CLI 2.86.0 lidas no código (`label add`, `label remove`, `traffic set`).
- O primeiro deploy cria o primeiro label: até lá o endpoint green fica com as origens sem revisão (e o alerta de origem doente não olha os grupos verdes).
- **Regra nova para quem escreve a api:** como a api vira antes do web, o web antigo fala com a api nova por alguns minutos. Mudança incompatível em `/api/v1` vai em lançamentos separados (aceitar os dois formatos, trocar o web, retirar o antigo), como a migration; mudança aditiva vai de uma vez. Está no `CLAUDE.md` e no `docs/DEPLOY.md`, seção 1.
- **Conferido por mutação em 03/11/2026:** 18 defeitos pequenos (uma linha, ou dois passos trocados de lugar) em `scripts/deploy.mjs` e `.github/workflows/deploy.yml` (label sem `--yes`, label antes da revisão ficar saudável, rollback que não tira o label ou esquece o web, a ordem web antes da api, Playwright da api sem `--grep @api`, só num projeto mobile ou no site de produção, `promote` com `continue-on-error`, o web criado antes de a api virar, o smoke no label tirado, entre outros), mais a impressão digital da chave PGDG no Dockerfile, reintroduzidos um a um e desfeitos na hora (SHA-256 conferido). A primeira rodada deixou escapar dois: a conferência de tráfego "ao nascer" (a revisão doente ficaria até 10 minutos com tráfego, e a conferência depois do label escondia isso no resultado final) e a trava do `cleanup` que recusa desativar tudo quando falta a revisão nova no estado. Cada um ganhou um teste em `deploy.test.mjs` e a mutação passou a ser pega.
