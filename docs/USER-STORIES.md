# User stories

As histórias de usuário da Alvesting, por ator, cada uma com os critérios de aceite e o teste que a cobre. O Playbook da Católica SC (linha
Web Apps) pede "casos de uso ou user stories" e **ao menos três fluxos de negócio completos**: eles estão na seção 1, e as histórias
avulsas, na seção 2. Os requisitos que cada história cumpre (RF-xx) estão em [REQUISITOS.md](REQUISITOS.md).

**Formato:** "Como **ator**, quero **ação**, para **valor**". O aceite diz o que tem de acontecer para a história valer; a coluna do teste
diz quem prova. `e2e/...` é Playwright em `apps/web/e2e/`, e todo e2e roda no Pixel 7 (Chromium), no iPhone 15 (WebKit) e no desktop
(`apps/web/playwright.config.ts`). O e2e sobe a api sobre um banco **sintético**: uma temporada inteira gerada pelo motor do ensaio
(`docs/ENSAIO.md`), com os handlers de verdade e os provedores fake, sem rede.

---

## 1. Fluxos de negócio completos

### F1. O ciclo diário da arena (sistema → visitante)

**Notícias e cotações → briefing → decisões → liquidação → ranking.** É o fluxo principal: sem pessoa, os agendadores publicam nas filas
e os workers fazem o trabalho (o desenho está na [ARQUITETURA.md](ARQUITETURA.md), seção 4.1).

| Passo | O que acontece | História | Prova |
|---|---|---|---|
| 1 | A cada 30 minutos, as notícias (RSS), os fatos relevantes (CVM) e o macro (BCB) entram no banco | US-S1 | `apps/api/src/modules/news/application/fetch.integration.spec.ts` |
| 2 | Às 21:30 do pregão anterior, as barras que faltam vêm da brapi | US-S2 | `apps/api/src/modules/market-data/application/market-data.integration.spec.ts` |
| 3 | Às 07:30, o briefing congela: a mesma entrada para todos, com o SHA-256 | US-S3 | `apps/api/src/modules/briefing/application/freeze.integration.spec.ts` |
| 4 | Às 08:00, cada modelo decide BUY, HOLD ou SELL; a resposta é validada e o que não vale vira HOLD; o prazo é 09:30 | US-S4 | `apps/api/src/modules/arena/arena-cycle.integration.spec.ts` |
| 5 | À noite, a liquidação executa no preço de abertura, rende o caixa no CDI e roda o Monte Carlo; o site revalida | US-S5 | `apps/api/src/modules/settlement/application/settle.handler.integration.spec.ts` e `cache-refresher.spec.ts` |
| 6 | O visitante vê o ranking, o ciclo e as decisões novas | US-V1 a US-V5 | `e2e/arena.spec.ts`, `e2e/public-api.spec.ts`, `e2e/fixture.spec.ts` |

**De ponta a ponta:** `apps/api/src/ensaio/ensaio.integration.spec.ts` ("3 pregões seguidos, sem intervenção e sem nenhuma mensagem na DLQ") roda os passos 1 a 5 com o relógio simulado; o `pnpm --filter @alvesting/api arena:ensaio` faz o mesmo por 5 pregões. O e2e semeia o
banco com esse mesmo motor e prova o passo 6 nas telas. **O que não está provado:** o fluxo com os serviços reais (brapi, OpenRouter, CVM,
BCB) e no relógio de verdade; é o que a Temporada 1 vai fazer (a onda de 06/11/2026 prepara o retroativo e o operador local, em construção).

### F2. A conta, com a LGPD (visitante → pessoa com conta)

**Cadastro com aceite → verificação do e-mail → entrar → ver a conta → exportar → sair → excluir.**

| Passo | História | Prova |
|---|---|---|
| Criar a conta com o aceite explícito dos termos e da privacidade | US-C1 | `e2e/conta.spec.ts` ("sem o aceite não há cadastro...") |
| Confirmar o e-mail pelo link | US-C2 | `e2e/conta.spec.ts` ("a tela de verificação...") |
| Entrar e ver a conta | US-C3 | `e2e/conta.spec.ts` ("entrar com a senha errada, ou com o e-mail ainda não confirmado...") |
| Exportar os dados | US-C5 | dentro do fluxo completo, abaixo |
| Excluir a conta | US-C6 | `e2e/conta.spec.ts` ("excluir com a sessão antiga...") |

**De ponta a ponta:** `e2e/conta.spec.ts` ("o fluxo completo pelas telas: cadastro com aceite, link do e-mail, verificação, entrar, conta, exportar, sair, entrar de novo, excluir e não entrar mais"), pelo Front Door imitado em https (`apps/web/e2e/front-door.ts`) e com o
e-mail falso (o link sai de uma pasta, nenhum e-mail de verdade); e `e2e/account-api.spec.ts` ("cadastro, e-mail falso, verificação, login, aceite, exportação e exclusão, de ponta a ponta"), direto na api do build de produção.

### F3. A carteira (pessoa com conta)

**Lançar uma compra → ver a posição e o resultado → editar → apagar.**

| Passo | História | Prova |
|---|---|---|
| Lançar nos dois modos de preço (por ação ou total pago) | US-P1 | `e2e/carteira.spec.ts` ("os dois modos de preço dão o mesmo custo total, e a posição soma os dois lançamentos") |
| Ver a posição, o preço médio, o último fechamento com a data e o resultado | US-P2 | `e2e/carteira.spec.ts` ("uma perda e papéis com datas de fechamento diferentes...") |
| Editar o lançamento | US-P3 | `e2e/carteira.spec.ts` ("editar usa o mesmo formulário, já preenchido, e a posição acompanha") |
| Apagar com a confirmação na página | US-P3 | `e2e/carteira.spec.ts` ("apagar pede a confirmação na própria página...") |

**De ponta a ponta:** `e2e/carteira.spec.ts` ("lançar, editar e apagar sem o mouse" e "lançar, editar e apagar tocando...") percorre o fluxo
inteiro pelo teclado e pelo toque; a api, em `apps/api/src/modules/portfolio/presentation/portfolio.integration.spec.ts`.

### F4. A operação pelo painel (admin)

**Entrar como admin → ver jobs, filas e custos → criar a temporada → reenviar uma mensagem da DLQ → reprocessar um ciclo → registrar um evento
corporativo.** Prova: `e2e/admin.spec.ts` (o arquivo inteiro: quem entra, o que o painel mostra e cada ação com a confirmação) e
`apps/api/src/modules/admin/presentation/admin.integration.spec.ts`. O e2e nunca **inicia** uma temporada (a em andamento é a atual
pública, e os specs dividem o banco: regra do `CLAUDE.md`).

---

## 2. Histórias por ator

### Visitante (sem login)

| ID | História | Aceite | Teste |
|---|---|---|---|
| US-V1 | Como visitante, quero ver quem está ganhando na arena agora, para entender em segundos quem está à frente | A arena mostra a temporada, o último ciclo, a contagem para o próximo, o macro com a data de cada valor e a faixa dos modelos e do Sorteio na ordem do ranking; sem temporada ou sem ciclo, a tela diz o que falta em vez de quebrar | `e2e/arena.spec.ts` ("mostra a temporada, as cotações com a data, os ciclos e o ranking do banco sintético", "a faixa traz os modelos e o Sorteio na ordem do ranking, com retorno e percentil"); `e2e/fixture.spec.ts` ("a arena diz o que falta, em vez de uma tela quebrada...") |
| US-V2 | Como visitante, quero comparar cada modelo com o acaso, para separar habilidade de sorte | O ranking separa modelos, Sorteio e referências e mostra o percentil contra as carteiras sorteadas, o excesso sobre o igual-peso e o CDI, o drawdown e o acerto | `e2e/arena.spec.ts` ("a tabela completa separa modelos, Sorteio e referências, com todas as métricas") |
| US-V3 | Como visitante, quero ver a evolução do patrimônio de cada um, também no celular e sem mouse | O gráfico tem título, descrição e uma tabela com os valores; lê-se pelo ponteiro, pelo toque e pelo teclado | `e2e/arena.spec.ts` ("o gráfico se lê pelo teclado...", "o gráfico se lê pelo toque no celular...") |
| US-V4 | Como visitante, quero ler por que um modelo decidiu, para confiar (ou não) no raciocínio | O feed mostra as decisões mais novas com o texto do modelo como texto (nunca HTML), filtra por BUY, SELL e HOLD e por modelo e pagina sem repetir linha | `e2e/arena.spec.ts` ("o feed mostra as decisões mais novas...", o grupo "filtro do feed por BUY, SELL e HOLD") |
| US-V5 | Como visitante, quero conferir um ciclo, para ver que todos receberam a mesma entrada | O ciclo mostra os horários, o SHA-256 do prompt e o do briefing, a decisão de cada modelo, o HOLD forçado e os itens descartados com o motivo, e o ciclo pulado diz por quê | `e2e/fixture.spec.ts` ("HOLD forçado e itens descartados aparecem com o motivo...", "o ciclo pulado diz por quê...") |
| US-V6 | Como visitante, quero pesquisar uma ação, para ver o preço, quem a tem e o que os modelos acharam dela | A página da ação mostra as velas com o crédito da brapi, os modelos que a têm, as decisões e as notícias; a ação sem dado mostra cada seção vazia, com texto | `e2e/explorar.spec.ts` (o grupo "o terminal da ação"); `e2e/fixture.spec.ts` ("a ação sem barra, dono, decisão nem notícia mostra cada seção vazia, com texto") |
| US-V7 | Como visitante, quero ler as notícias que os modelos receberam | Cada notícia tem título, fonte, hora e link, filtra por ação e nunca traz o trecho | `e2e/public-api.spec.ts` ("notícias com título, fonte, hora e link; nunca o trecho") |
| US-V8 | Como membro da banca, quero entender as regras e as limitações, para avaliar o experimento | O "Como funciona" traz as regras com os números da temporada, o prompt oculto com o hash, a igualdade das entradas, o Sorteio e o Monte Carlo, as referências, as fontes e as limitações | `e2e/arena.spec.ts` ("traz as regras, o prompt oculto com o hash publicado...") |
| US-V9 | Como visitante, quero usar o site no tema que eu prefiro | O seletor troca entre claro, escuro e o do sistema, a escolha sobrevive ao recarregar e o axe não acha violação nos dois temas | `e2e/tema.spec.ts` |

### Pessoa com conta

| ID | História | Aceite | Teste |
|---|---|---|---|
| US-C1 | Como visitante, quero criar uma conta, para guardar a minha carteira | O cadastro só nasce com o aceite explícito dos dois textos (nada pré-marcado); cada erro fica no campo, com o foco no primeiro | `e2e/conta.spec.ts` ("sem o aceite não há cadastro...") |
| US-C2 | Como pessoa cadastrada, quero confirmar o meu e-mail | O link confirma; o vencido diz que venceu e deixa pedir outro; sem confirmar não se entra | `e2e/conta.spec.ts` ("a tela de verificação: sem o link, com o link vencido e o pedido de um link novo...") |
| US-C3 | Como pessoa com conta, quero entrar e sair | A senha errada e o e-mail não confirmado dizem o que houve no campo certo; depois de entrar, só se vai para caminho interno | `e2e/conta.spec.ts` ("entrar com a senha errada...", "depois de entrar só se vai para caminho interno...") |
| US-C4 | Como pessoa com conta, quero recuperar a senha esquecida | O link do e-mail leva a uma senha nova, que entra; o link não vale duas vezes | `e2e/conta.spec.ts` ("o link do e-mail leva a uma senha nova, que entra; o link não vale duas vezes...") |
| US-C5 | Como pessoa com conta, quero baixar os meus dados (LGPD) | A exportação traz tudo do dono, sem hash de senha nem token | `e2e/conta.spec.ts` (o fluxo completo); `apps/api/src/modules/account/presentation/me.integration.spec.ts` ("GET /api/v1/me/export") |
| US-C6 | Como pessoa com conta, quero excluir a minha conta e tudo o que é meu (LGPD) | A exclusão apaga tudo numa transação; com a sessão antiga, pede a senha; depois dela não se entra mais | `e2e/conta.spec.ts` ("excluir com a sessão antiga: a tela pede a senha, a errada é recusada e a certa exclui") |
| US-C7 | Como pessoa com conta, quero que ninguém veja os meus dados | O usuário A não vê, não exporta nem apaga nada de B; a `/conta` não vai a cache nenhum e não entrega o token | `e2e/conta.spec.ts` ("dois usuários em contextos separados...", "/conta é privada...") |
| US-P1 | Como pessoa com conta, quero lançar uma compra do jeito que está na minha nota (preço por ação ou total pago) | Os dois modos dão o mesmo custo; ação desconhecida e data futura são recusadas no campo; o duplo clique manda um pedido só | `e2e/carteira.spec.ts` ("os dois modos de preço dão o mesmo custo total...", "o duplo clique em Lançar compra manda um pedido só") |
| US-P2 | Como pessoa com conta, quero ver a minha posição e o resultado | Cada posição mostra o preço médio, o último fechamento com a data e o resultado com sinal e palavra (não só a cor) | `e2e/carteira.spec.ts` ("uma perda e papéis com datas de fechamento diferentes...") |
| US-P3 | Como pessoa com conta, quero corrigir ou apagar um lançamento | Editar usa o mesmo formulário, preenchido; apagar pede a confirmação na página e só apaga com ela; o erro da api aparece na pergunta | `e2e/carteira.spec.ts` (o grupo "editar e apagar") |
| US-P4 | Como pessoa com conta, quero que a minha carteira seja só minha | A não vê a carteira de B, nem pela tela nem pela api com o cookie dele | `e2e/carteira.spec.ts` ("o usuário A não vê a carteira do B...") |

### Admin

| ID | História | Aceite | Teste |
|---|---|---|---|
| US-A1 | Como admin, quero ver a saúde da operação | O painel mostra jobs, filas, custos e temporadas iguais aos da api; o usuário comum recebe 404 e o anônimo vai para a entrada | `e2e/admin.spec.ts` ("jobs, filas, custos e temporadas batem com a api...", "usuário comum recebe 404...") |
| US-A2 | Como admin, quero preparar a próxima temporada | Crio o rascunho com a confirmação e edito o nome e o elenco | `e2e/admin.spec.ts` ("cria o rascunho (com a confirmação), edita nome e elenco...") |
| US-A3 | Como admin, quero recuperar uma mensagem que falhou | Reenviar da DLQ pede a confirmação e publica uma vez só | `e2e/admin.spec.ts` ("reenvia a mensagem para a fila de origem uma vez só...") |
| US-A4 | Como admin, quero refazer o ciclo de um pregão que falhou | O reprocesso pede a confirmação, só vale antes do prazo e diz o que a api fez | `e2e/admin.spec.ts` ("o reprocesso pede a confirmação e diz o que a api fez...") |
| US-A5 | Como admin, quero registrar um desdobramento ou grupamento | Ticker que não existe é recusado com a causa; repetir o mesmo evento não muda nada | `e2e/admin.spec.ts` ("o evento corporativo...") |

### Sistema

| ID | História | Aceite | Teste |
|---|---|---|---|
| US-S1 | Como sistema, quero coletar as notícias, os fatos relevantes e o macro | A cada 30 minutos, uma busca por fonte; a mesma notícia não entra duas vezes | `apps/api/src/modules/news/application/fetch.integration.spec.ts` |
| US-S2 | Como sistema, quero ter as barras do pregão sem estourar a cota da brapi | Só a falta vai à brapi, um papel por vez; a barra gravada nunca muda; a busca para antes da reserva da cota | `apps/api/src/modules/market-data/application/market-data.integration.spec.ts` |
| US-S3 | Como sistema, quero congelar a mesma entrada para todos às 07:30 | A mesma entrada gera o mesmo SHA-256, gravado no Blob e no banco | `apps/api/src/modules/briefing/application/freeze.integration.spec.ts` |
| US-S4 | Como sistema, quero pedir a decisão de cada modelo e aceitar só o que vale | Uma decisão por modelo; item inválido é descartado com o motivo; sem resposta até as 09:30, HOLD; sem briefing ou sem orçamento, o ciclo é pulado com o motivo | `apps/api/src/modules/arena/arena-cycle.integration.spec.ts`; `cycle-schedulers.integration.spec.ts` |
| US-S5 | Como sistema, quero liquidar e publicar o resultado | A liquidação bate com a planilha conferida à mão; depois dela o site revalida e a borda é limpa | `apps/api/src/modules/settlement/domain/hand-checked.spec.ts`; `settle.handler.integration.spec.ts`; `e2e/revalidate.spec.ts` |
| US-S6 | Como sistema, quero cumprir a política de privacidade sozinho | Todo dia some o que venceu; todo mês o backup é restaurado num banco temporário e conferido | `apps/api/src/modules/maintenance/application/retention.handler.integration.spec.ts`; `backup-verify.handler.integration.spec.ts` |

### Operador

| ID | História | Aceite | Teste |
|---|---|---|---|
| US-O1 | Como operador, quero ensaiar a arena inteira antes de gastar com LLM | O `arena:ensaio` roda 5 pregões sem rede, e duas execuções com a mesma semente dão o mesmo relatório | `apps/api/src/ensaio/ensaio.integration.spec.ts`; `docs/ENSAIO.md` |
| US-O2 | Como operador, quero criar e iniciar a temporada a partir de um arquivo versionado | `season:create` lê o arquivo, `season:start` fixa a data de início | `apps/api/src/modules/arena/application/season.service.spec.ts` |
| US-O3 | Como operador, quero publicar uma versão nova sem derrubar o site | Merge na `main` publica: a revisão nova nasce sem tráfego, é provada pelo Playwright mobile pelo Front Door e só então recebe os 100%; prova que falha deixa a antiga | `scripts/deploy.test.mjs` (executa o `deploy.yml` contra um Container Apps falso); `docs/DEPLOY.md` |
| US-O4 | Como operador, quero rodar os pregões passados da Temporada 1 como retroativo e o pipeline ao vivo no Mac até a Azure | Cada pregão retroativo só vê o que existia às 07:30 dele e fica marcado como retroativo; pregão perdido nunca vira "ao vivo" atrasado | os testes da tarefa T0 (**em construção**; relatório em `docs/temporada-1/relatorios/t0-temporada-real.md`) |
