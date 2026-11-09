# ADR 0040: A produção na Chile Central, a região mais perto do Brasil que a assinatura de estudante libera

- **Status:** aceita
- **Data:** 07/11/2026
- **Origem:** o primeiro contato com a assinatura Azure for Students do Artur (07/11/2026) e a resposta dele à escolha da região ("Não tem
  Brasil? Se nao vai Chile mesmo"); `docs/INFRA.md`, 6.0, 9 e 11; ADR 0039 (a produção no perfil econômico).

## Contexto

O plano escolheu a East US 2 (plano §5) sem conhecer a assinatura. A Azure for Students vem com a política "Allowed resource deployment
regions", atribuída pela Microsoft acima da assinatura, e o aluno não a muda. Na do Artur (lida em 07/11/2026 com `az policy assignment list
--disable-scope-strict-match`) ela libera cinco regiões: `chilecentral`, `canadacentral`, `spaincentral`, `southafricanorth` e
`francecentral`. A East US 2 e a Brazil South ficam de fora; na East US 2, até o Postgres recusa a assinatura ("Subscriptions are restricted
from provisioning in this region"). As cinco têm todos os tipos de recurso do template (`az provider show`, tipo por tipo, a partir do
`az bicep build`) e o Postgres Flexible B1ms na versão 17 (`az postgres flexible-server list-skus`, sem restrição para a assinatura).

## Decisão

A produção (`rg-alvesting-prod`) fica na **Chile Central**. Só o `az group create` leva a região; o resto herda a do grupo (a identidade do CI
também, `docs/DEPLOY.md`). O e-mail (Azure Communication Services, recurso global) continua com os dados do envio nos Estados Unidos.

## Por quê

- **Latência, que conta no celular.** O econômico não tem Front Door nem CDN, e cada página nova faz umas três idas e voltas antes do
  primeiro byte. Do Mac do Artur, em SC, a conexão TCP leva ~73 ms até a Chile Central, ~129 ms até a East US 2 e ~145 ms até a Canada
  Central (07/11/2026, até `<região>-0.in.applicationinsights.azure.com`, IPs diferentes por região). A tabela da Microsoft (30 dias até
  30/07/2026) dá, a partir da Brazil South, 129 ms até a Canada Central, 183 até a Spain Central, 191 até a France Central e 321 até a South
  Africa North; a Chile Central ainda não consta.
- **Custo.** O Postgres B1ms sai a US$ 0,0238 por hora (0,0185 na Canada Central, 0,017 na East US 2) e a vCPU do Container Apps a
  US$ 0,000034 por segundo, igual à da Canada Central. O econômico vai de uns US$ 5 a 10 para uns US$ 5 a 11 por mês (US$ 27 a 33 sem a
  franquia do Postgres): cabe nos US$ 100 até depois do Demo Day e da virada do ano.

## Consequências

- A política de privacidade (item 6, ainda o rascunho 0.3, com o hash atualizado) e a caixa de aceite do cadastro dizem Chile e Estados
  Unidos; `docs/CONTA.md` acompanha.
- Região nova: no Burstable, o Postgres só oferece B1ms e B2s, e capacidade só a criação confirma (`docs/INFRA.md`, 11). Depois que o Key
  Vault nasce, trocar de região prende o nome `kv-alvesting` por 90 dias (purge protection).
- O chat com o Azure OpenAI (etapa 13, `enableOpenAI` desligado): o `DataZoneStandard` só existe nas zonas de dados dos EUA e da UE, e a Chile
  Central não está em nenhuma. Ligar pede decidir antes onde o modelo roda (`docs/INFRA.md`, 8.3).
- Os preços, a tabela de latência e a medida estão em `docs/DEPENDENCIAS.md`.
