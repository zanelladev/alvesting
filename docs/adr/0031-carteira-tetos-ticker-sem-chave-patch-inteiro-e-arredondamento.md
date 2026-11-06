# ADR 0031: Carteira do usuário: tetos, ticker sem chave estrangeira, PATCH do lançamento inteiro e arredondamento

- **Status:** aceita
- **Data:** 03/11/2026
- **Origem:** `docs/PLANO.md`, §3, §8, §9, §11, §12 e §16 (etapa 12); `docs/API.md`, seção 9; `docs/CONTA.md`; ADR 0024 (a conta e o aceite), 0025 (as telas da conta) e 0028 (o papel mínimo do Postgres); pendências das ondas 3b, 3c e 3d

## Contexto

A etapa 12 dá ao usuário uma carteira: lançamentos de compra com quantidade e preço por ação **ou** valor total pago, edição e exclusão, posição consolidada por ticker com preço médio ponderado e P&L pelo último
fechamento. É dado pessoal e financeiro novo (a política de privacidade passa de 0.1 para 0.2), numa api que fala com a internet e tem um papel mínimo no Postgres (ADR 0028). Havia escolhas que o plano não fecha: até
onde a carteira pode crescer, como ler o que o usuário digita, o que fazer com o ticker, o que o PATCH troca e onde a conta arredonda.

## Decisão

1. **Tetos explícitos** (três de entrada e um de leitura), com o pior caso provado por teste (`packages/contracts/src/portfolio-rules.spec.ts`): **1.000.000 de ações** e **R$ 1.000.000.000,00** (10^11 centavos) de custo por lançamento, e **200 lançamentos**
   por usuário. O pior caso da carteira inteira soma 2 × 10^13 centavos (450 vezes abaixo do inteiro seguro, 9,007 × 10^15) e 2 × 10^8 ações (abaixo do `INTEGER` de 32 bits do banco), então toda soma de custo e de quantidade que a api faz
   e todo número que sai em JSON é exato. O **valor de mercado** (ações × fechamento) de toda a carteira só cabe em inteiro seguro com um fechamento de até R$ 450.000,00 por ação, o teto de leitura (`maxCloseCents`): uma barra acima disso
   não é cotação (o `daily_bar` só exige `close_cents >= 0`), e a posição sai **sem fechamento**, como a de um ticker sem barra. A primeira versão deixava o `safeNumber` lançar, e um dado ruim dava 500 no `GET` de todo
   detentor do papel (achado da revisão do fechamento); com o teto, o valor, o P&L em centavos e as somas deles cabem sempre. O **percentual** (P&L × 10.000 ÷ custo) sai do inteiro seguro antes disso, com custo de
   centavos sobre valor alto (a partir de uns R$ 9.007 por ação com 1 centavo por 1.000.000 de ações), e então é nulo; o resto da posição vale. O teto de lançamentos
   também limita o tamanho da resposta do `GET` (200 lançamentos e 200 posições, uns 80 KB no pior caso, com todos os números no tamanho máximo) e o custo da consulta. Os números moram em um módulo sem imports (`portfolio-rules.ts`, que o formulário do site lê pelo subcaminho
   `@alvesting/contracts/portfolio-rules`, sem levar o zod ao navegador), e são repetidos pelo banco: `CHECK` de quantidade e de custo, e um gatilho (item 7). `ponytail`: tetos fixos; subir um deles exige conferir de novo
   a soma do pior caso e a migration.
2. **O valor digitado em reais lê no jeito brasileiro** (`parseBrl`): `1.234,56`, `1234,56`, `0,5` e `12` viram centavos inteiros, com no máximo 2 casas, e recusa negativo, zero, expoente, texto e dígito de outro
   alfabeto. **O ponto como separador decimal**, que o teclado numérico de alguns Android manda: um ponto único seguido de 1 ou 2 dígitos é o separador decimal (`12.5` é R$ 12,50); dois pontos ou mais, em grupos de 3, são
   milhar; e **um ponto seguido de exatamente 3 dígitos, sem vírgula (`1.234`), é ambíguo e é recusado**, com a mensagem para escrever `1.234,00` ou `1234`. Adivinhar custaria um erro de mil vezes sem aviso (R$ 1,234 lido
   como R$ 1.234,00). Com vírgula, ela manda: o ponto antes dela é milhar em grupos de 3 e depois dela vêm 1 ou 2 dígitos. A quantidade é só dígitos (`parseQuantity`).
3. **O custo total é o único valor guardado**: no modo "preço por ação" é quantidade × preço, no modo "valor total pago" é o próprio valor; o modo em que o usuário digitou não é guardado, e os dois geram o mesmo custo para
   os mesmos números (teste de propriedade com 20 mil pares, e o de integração que posta os dois modos). A comparação do produto com o teto é exata sem BigInt: o produto exato só passa de 2^53 quando já passa do teto, e a
   multiplicação arredondada é monotônica, então quem passa do teto continua passando e quem fica abaixo é exato.
4. **O ticker é texto, validado na escrita contra `instrument`, sem chave estrangeira.** O conjunto é o que `/stocks?q` busca e `/stocks/:ticker` serve (`kind = 'STOCK'`; até 04/11/2026 o conjunto também
   excluía o papel por lote, GOLL54 e AZUL53, pelo fator de cota `quote_factor = 1`, mas o dev foi recriado e a coluna saiu, `docs/DADOS.md`, seção 1): ticker desconhecido e referência (o BOVA11) são
   400 no campo `ticker`. A limpeza de `instrument` que o schema prevê (`docs/DADOS.md`, seção 4) não pode travar por causa da carteira de um usuário: com a chave estrangeira, apagar um papel falharia enquanto alguém o
   tivesse. `ponytail`: o ticker que sai de `instrument` fica no lançamento e a posição sai sem fechamento (valor e P&L nulos, `unpriced` nos totais); a saída seria uma tabela de papéis aposentados e um aviso na tela. O `CHECK` do
   banco repete só o formato do ticker.
5. **O PATCH troca o lançamento inteiro**, com o mesmo schema do POST. Um corpo só, uma regra de validação só (inclusive o teto do produto, que depende de quantidade e valor juntos), e sem a pergunta "campo ausente é
   deixar como está ou limpar?": a data que falta no corpo limpa a data. O corpo parcial é 400. Se um dia o PATCH aceitar parcial, é mudança aditiva. A escrita filtra pelo dono **na mesma instrução** (`UPDATE ... FROM
   portfolio ... WHERE p.user_id = <sessão> ... RETURNING`, e o mesmo no `DELETE`), sem ler e depois escrever; o lançamento de outro usuário é 404, igual ao que não existe.
6. **Arredondamento só em dois lugares, os dois pela regra do domínio** (`divRound` em `settlement/domain/money.ts`: o mais próximo, com o meio indo para longe do zero): o **preço médio** (Σ custo ÷ Σ quantidade) no centavo, e
   o **P&L percentual** em ponto-base inteiro (a convenção da API: taxa é ponto-base; nulo quando passaria do inteiro seguro, item 1). Custo, valor de mercado (quantidade × fechamento) e P&L em centavos são exatos (bigint no servidor). O fechamento é o `close_cents` da barra
   mais recente do papel (qualquer fonte, até o teto de leitura do item 1), com a data dele na resposta; não é ajustado por provento nem desdobramento, e a tela e os termos dizem que o valor é **estimado**.
7. **Sem corrida no teto de lançamentos**, em duas camadas. O serviço faz a escrita numa transação que trava o usuário (`pg_advisory_xact_lock`, o molde das temporadas e da liquidação), cria a carteira se for a primeira,
   conta e só então grava: dois POST ao mesmo tempo não passam de 200, e o perdedor recebe 409 `LOT_LIMIT`. Atrás dele, o gatilho `portfolio_lot_api_guard` (`BEFORE INSERT`, só para o login da api, como os `*_api_guard`
   do ADR 0028) conta os lançamentos da carteira sob uma trava consultiva própria e recusa o 201º com `42501`: vale também para o caminho que esquecer a trava do serviço (o teste prova os dois, e que o administrador, que
   semeia e testa, passa dos 200). O `UPDATE` da api em `portfolio_lot` é **por coluna** (`ticker`, `quantity`, `cost_cents`, `bought_on` e `updated_at`): a carteira dona e a data de criação nunca mudam. A api tem `SELECT` e
   `INSERT` em `portfolio` e nenhum `DELETE`: a carteira some só pela cascata do usuário, que o Postgres executa com os privilégios do dono da tabela (ADR 0028, item 3).
8. **O dono é sempre o ULID da sessão** (nunca o corpo, a query ou o caminho; campo a mais é 400), `SessionGuard` e `ConsentGuard` em toda rota, `Cache-Control: no-store`, e a rota está na lista sem cache do Front Door
   (`infra/tests/check.mjs` lê o controlador). **Sem trilha de auditoria** nos lançamentos: é dado do próprio dono, que o edita e o apaga, e a trilha guarda só o ULID e sobrevive à exclusão da conta; nenhuma ação nova em
   `AUDIT_ACTIONS` e nenhum alerta novo (o `RUNBOOK` não muda). Nenhum dado da carteira vai ao log nem à telemetria: o log de requisição é uma lista branca, o span da rota leva o padrão
   (`/api/v1/me/portfolio/lots/:id`) e o SQL, os valores como parâmetro (teste em `telemetry.integration.spec.ts`).
9. **LGPD.** `portfolio` e `portfolio_lot` são `personal: true` na matriz de tabelas: ficam fora do dump do backup mensal (só o ponto de restauração de 7 dias as guarda), entram no export (`portfolios` e `portfolioLots`,
   o custo em centavos e a data da compra como `AAAA-MM-DD`) e somem na exclusão da conta (cascata usuário, carteira, lançamento). Os textos legais sobem para a **0.2** (rascunho): a política descreve a carteira e os
   termos dizem que ela é informativa, que os valores são estimados pelo último fechamento disponível e que nada ali é recomendação. Quem aceitou a 0.1 recebe 403 `CONSENT_REQUIRED` nas rotas da carteira até aceitar a 0.2
   (exportar e excluir seguem abertos). **O `ConsentGuard` fica na classe, inclusive no `DELETE` do lançamento** (achado da revisão do fechamento): sem o aceite da versão vigente a pessoa só exporta os dados e exclui a conta
   (que apaga a carteira inteira), e a política (item 7) diz isso, em vez de prometer a correção na tela sem condição. Tirar o guard só do `DELETE` (mover o `@UseGuards` da classe para as outras três rotas) é possível e
   foi descartado: quem tem lançamentos já aceitou a versão que criou a carteira, e só uma versão nova de texto o deixa nesse estado, onde exportar e excluir a conta seguem abertos.

## Alternativas descartadas

- **Chave estrangeira de `portfolio_lot.ticker` para `instrument`.** Ver o item 4: travaria a limpeza de `instrument`.
- **PATCH parcial.** Mais flexível, mas pede a regra de "ausente" e valida o teto do produto só depois de juntar com o que está no banco (uma leitura antes da escrita, o que o item 5 evita).
- **O ponto sempre como milhar (a leitura brasileira estrita) ou sempre como decimal (a americana).** A primeira recusa o que o teclado de alguns Android manda; a segunda lê `1.234` como R$ 1,23 ou 1.234 em silêncio,
  conforme o lado em que erra. Recusar o único caso ambíguo é o que não erra em silêncio.
- **Guardar o modo de preço** (ou o preço por ação) no lançamento. Duas fontes da mesma verdade, e o preço por ação não é inteiro em centavos quando o usuário digita o total.
- **Dinheiro em `number` ou ponto flutuante** na api: ver o item 3 e o `CLAUDE.md` (bigint no servidor, número JSON exato só na saída, e só até o inteiro seguro).
- **Tetos maiores** (sem limite de lançamentos, ou 10^6 lançamentos): a soma do pior caso deixaria de caber em inteiro seguro e a resposta do `GET` não teria teto.
- **Auditar cada lançamento.** Dado do dono, editável e apagável por ele, e a trilha é só de ULID e sobrevive à conta: ficaria uma linha que a política não explica.
- **Uma trava por linha da carteira (`SELECT ... FOR UPDATE`).** Pede `UPDATE` na tabela `portfolio`, que a api não tem (a linha nunca muda); a trava consultiva não pede privilégio nenhum e cobre também a criação da carteira.

## Consequências

- **Fora do escopo desta etapa:** vendas, proventos, desdobramentos, nota de corretagem e imposto de renda. O P&L é do que foi comprado, sem ajuste nenhum.
- **Fechamento atrasado ou ausente** é parte do contrato: cada posição diz a data do fechamento que usou (`closeDate`), o papel sem barra não entra no valor de mercado nem no P&L dos totais, e `totals.unpriced` conta os que
  ficaram de fora. O fechamento é cotação (da B3, na data deste texto; desde 03/11/2026 da brapi, ADR 0032): mostrá-lo ao usuário depende da mesma decisão do Artur e do orientador que a API pública (`docs/PLANO.md`, §5.16; `docs/API.md`, seção 6). Aqui tudo é sintético. **Nota de 03/11/2026 (ADR 0033):** a API pública deixou de entregar cotação bruta; a carteira, que é privada (sessão, só o dono, `no-store`), segue devolvendo o último fechamento de cada posição do próprio usuário, que a licença da brapi deixa exibir, e o risco residual (uma conta que lance um papel só para ler o fechamento dele) está no ADR 0033.
- **O preço por ação tem no máximo 2 casas** (centavo inteiro): uma média de corretagem com mais casas (R$ 35,5555) não cabe no modo "preço por ação"; quem a tem digita o **total pago**, que o modo "valor total" aceita sem perda. `ponytail`: sem milésimos de
  centavo; a saída seria guardar o preço em milésimos de centavo (como a pendência da etapa 7 prevê para papel cotado por lote), o que muda a coluna e o contrato.
- **Deploy e rollback** (`docs/DEPLOY.md`, seção 1): a migration, a rota e o campo novo do export são aditivos e vão de uma vez, a api antes do web. O web antigo continua certo com a api nova (a tela de cadastro lê as versões dos textos de `GET /legal`, sem
  cache, e o export só é um link). Voltar a api para a revisão anterior deixa as tabelas novas sem uso e faz quem só aceitou a 0.2 voltar a precisar do aceite da 0.1 (a `/conta` mostra o formulário): nenhum dado se perde. **Mas a revisão
  anterior monta o export sem a carteira** (o `EXPORTED_MODELS` antigo não tem `portfolios` nem `portfolioLots`): enquanto ela estiver ativa, o direito de acesso (LGPD, art. 18) não leva os lançamentos, e a carteira segue no banco, intacta
  (`docs/RUNBOOK.md`, seção 6). **A api com os textos 0.2 não vai ao ar sem a tela da carteira** (`docs/DEPLOY.md`, seção 1): o aceite grava o SHA-256 do texto que a pessoa viu, e a 0.2 promete a tela com a data do fechamento e a correção
  e a exclusão dos lançamentos; publicar a api antes da tela faria alguém aceitar um texto que descreve o que ainda não existe (LGPD, art. 9). A tela é a parte 2 desta etapa.
- **Mudar um teto** é mudar o contrato, a migration (`CHECK` e gatilho), os textos e este ADR juntos.
- **O pré-sequestro por cadastro com o e-mail alheio** (`docs/CONTA.md`, seção 11) foi **reavaliado** com a carteira na conta (revisão do fechamento): a carteira da vítima **não fica exposta** enquanto quatro ajustes valerem, todos presos em teste
  (o clique no link de verificação não abre sessão, `autoSignInAfterVerification: false`; o Google não se liga sozinho a uma conta de senha com o mesmo e-mail, `disableImplicitLinking`; a redefinição de senha troca o hash e revoga todas as sessões;
  `change-email`, `update-user` e `link-social` estão fechados). O resíduo é a **conta ocupada** (o atacante guarda uma conta verificada com o e-mail da vítima), sem acesso ao dado dela. A mitigação de verdade (invalidar a senha e as sessões criadas antes
  da verificação, ou pedir a senha no próprio link) segue decisão de produto, não tomada, e é um item do checklist do `docs/PLANO.md`, §5.16.
- **Não verificado na Azure:** o `GRANT` por coluna e o gatilho pelo administrador do Flexible Server (como o resto da matriz, ADR 0028), e o plano de execução do `LATERAL` com a tabela de barras de produção (medido só no
  Postgres local, com 600 mil barras sintéticas).
