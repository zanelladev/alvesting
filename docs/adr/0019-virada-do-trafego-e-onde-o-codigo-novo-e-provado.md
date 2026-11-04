# ADR 0019: Virada do tráfego, e onde o código novo é provado

- **Status:** aceita; **substituída em parte pelo ADR 0029** (03/11/2026): o blue/green com o label `green` e o endpoint green do Front Door provam o código novo pelo Front Door ANTES da virada. Ficam de pé deste ADR o `pin`, a revisão nova que nasce com 0%, o `Desfazer` e o ponto sem volta; acabam a etiqueta `@pos-virada` e a janela de um a dois minutos
- **Data:** 01/11/2026
- **Origem:** `docs/PLANO.md`, §5.10 ("smoke e Playwright mobile pelo Front Door → 100% para `green`") e etapa 3 do §16

## Contexto

O plano manda provar a revisão nova pelo Front Door e só então dar 100% do tráfego a ela. Mas a origem do Front Door é o endereço do app (`ca-web.<domínio do ambiente>`), e o tráfego desse endereço segue as regras do Container Apps. Enquanto a revisão nova tem 0%, o Front Door só alcança a **antiga**: um smoke ou um Playwright pelo Front Door nesse momento prova a borda (rota, WAF, trava de origem, certificado), não o código novo.

Fazer o Front Door chegar à revisão nova antes da virada pede um destino próprio para ela (label `green` e uma origem ou regra de rota no Front Door). Isso é o blue/green com label, da etapa 10, e está fora do escopo da etapa 3.

## Decisão

O código novo é provado em dois lugares, e o rollback cobre os dois:

1. **Antes da virada, pela URL da própria revisão.** Cada revisão tem endereço próprio (`<app>--<sufixo>.<domínio>`), que o Container Apps documenta para testar a revisão sem afetar o tráfego. O smoke chama `/health` (web e api) e `/api/v1/health` (api) ali. O `/health` é o que a trava de origem deixa passar sem cabeçalho (ADR 0018).
2. **Antes da virada, pelo Front Door**, o smoke e o Playwright mobile (Pixel 7 e iPhone 15). Eles provam a borda e que o Playwright roda contra o site publicado. É a ordem que o plano pede.
3. **A virada** só vem depois de 1 e 2: 100% para as revisões novas, api primeiro.
4. **Depois da virada, de novo pelo Front Door**, o smoke e o Playwright. Agora o Front Door alcança o código novo. Se falhar, o tráfego volta para a antiga, que segue ativa.
5. **Só então** o deploy é confirmado e as revisões antigas são desativadas. Esse é o ponto sem volta; dali o rollback não faz mais nada.

O tráfego é fixado pelo nome na revisão atual **antes** de a nova existir. Sem isso a Azure manda 100% para a revisão mais nova assim que ela fica pronta (Microsoft Learn, "Traffic splitting": por padrão todo o tráfego vai para a última revisão implantada).

## Consequências

- Há uma janela de um a dois minutos, entre a virada e o fim do passo 4, em que usuários podem ver o código novo antes de o Playwright ter passado por ele pelo Front Door. O que a cobre é o smoke da URL da revisão, que já provou o código novo, e a volta automática.
- Se o passo 2 falha, o problema é da borda ou do ambiente de teste (nada mudou). Se só o passo 4 falha, é o código novo. A separação ajuda o diagnóstico.
- Quando a etapa 10 trouxer o blue/green com label, os passos 2 e 4 viram um só, antes da virada, e a janela some. (Feito na parte 4 da etapa 10: ADR 0029.)
- O custo é um segundo Playwright (cerca de 30 segundos) por deploy.

## Alternativas consideradas

- **Dar uma fatia do tráfego (canário) à revisão nova e testar pelo Front Door.** O Playwright cairia numa ou noutra revisão ao acaso, e usuários reais veriam o código não provado.
- **Rodar o Playwright direto na URL da revisão, com o `X-Azure-FDID` injetado.** Exigiria o ID do perfil no CI, e a regra é que nada disso fica no GitHub. (O ADR 0029 observa que o CI pode lê-lo da Azure na hora, com `az afd profile show --query frontDoorId`, sem guardá-lo no GitHub; fica como volta se o endpoint green do Front Door não funcionar.)
- **Só testar depois da virada.** Descartada: o smoke da URL da revisão e o do Front Door antes da virada pegam a maioria das falhas sem expor ninguém.
