# Conformidade com o Portfolio Playbook

Cada item do [Portfolio Playbook](https://github.com/CatolicaSC-Portfolio/The-Portfolio-Playbook) da Católica SC que vale para a
Alvesting (linha **Web Apps**, 8º período: a Disciplina de Portfólio e o PAC Extensionista VIII), com o status de hoje e a evidência.
Lido no commit `ce005fe` do Playbook, em 06/11/2026: `directions/portfolio-directions-webapp.md`, `directions/portfolio-directions-GERAL.md`,
`Portfolio.md`, `calendario.md`, `documentation/normas.md`, `documentation/guia-prova-de-autoria.md` e `demoday/Avaliacao_Poster_DemoDay.md`.
**Prazo de entrega: 30/11/2026 (segunda-feira).**

**Status:** **atende** · **parcial** (feito em parte; o que falta está dito) · **pendente** (não feito) · **depende do Artur** (uma
decisão, uma conta ou uma entrega que só ele faz). **Estado em 06/11/2026, sem enfeite:** o repositório é local e não está no GitHub;
não há deploy (nada roda na Azure); o CI nunca rodou no GitHub; a Wiki não está publicada; o SonarCloud não está ligado; o PAC VIII
(squad, peer review, parceiro) é todo do Artur.

---

## 1. Resumo

| | O que está feito | O que falta até 30/11/2026 |
|---|---|---|
| **Produto** | A arena, a conta com a LGPD, a carteira e o painel de admin, testados (3.198 testes na api, 919 no site, 504 nos contratos e 447 declarações de teste no e2e, em três aparelhos) | O deploy na Azure, público e estável até a divulgação das notas; a Temporada 1 real (em construção nesta onda) |
| **Documentação mínima** | Requisitos, user stories com os fluxos completos, C4 e instruções de deploy (esta onda), 37 ADRs | Publicar a Wiki (o gerador está pronto) |
| **Engenharia** | CI/CD escrito e validado sem a Azure, cobertura de 91,7% na api e 69,6% no site, análise estática no CI, observabilidade no código | O CI rodar no GitHub, o SonarCloud ligado, a observabilidade implantada |
| **Riscos do critério 5 (eliminatório)** | O código de terceiros registrado com licença; o retroativo marcado como tal | **O design copiado do Rallies AI** (seção 9.1) e **o histórico curto do git** (seção 2, item 5): decisões do Artur |

---

## 2. Obrigatórios da linha Web Apps

| # | Item do Playbook | Status | Evidência e o que falta |
|---|---|---|---|
| 1 | Hospedado em ambiente acessível publicamente (AWS, GCP, Azure...) | **pendente**; depende do Artur | A infra da Azure está escrita em Bicep e validada sem assinatura (`infra/`, `infra/tests/check.mjs`), e o passo a passo está no [DEPLOY.md](DEPLOY.md), "Como implantar". Falta a assinatura de estudante e o repositório público. O Playbook pede o sistema no ar e estável **até a divulgação final das notas**, sem depender de notebook: o operador local no Mac (seção 5 da [ARQUITETURA.md](ARQUITETURA.md)) é ponte, não o ambiente da entrega. O crédito de US$ 100 dura umas 5 semanas no perfil padrão e de 10 meses a mais de um ano no econômico (`docs/INFRA.md`, seção 9): a escolha do perfil é do Artur |
| 2 | Funcionalidades completas e reais, conforme o escopo do RFC | **parcial**; depende do Artur | Arena, conta, carteira e admin feitos ([REQUISITOS.md](REQUISITOS.md)). O chat consultivo (etapa 13) não foi feito: espera o aval do orientador, e a tela `/chat` está desligada com o aviso. A Temporada 1 com os serviços reais está em construção. **O RFC do 7º semestre não está no repositório**: conferir que o escopo do `docs/PLANO.md` (a v2, refeita do zero em 31/10/2026) bate com o RFC aprovado é do Artur |
| 3 | Interface funcional, navegável e com usabilidade básica | **atende** | O e2e navega só clicando (`e2e/arena.spec.ts`, "arena, modelo, ciclo, ação e notícias, só clicando"), pelo teclado e pelo toque, no Pixel 7, no iPhone 15 e no desktop |
| 4 | Arquitetura definida e organização modular (componentes reutilizáveis, separação de responsabilidades) | **atende** | O C4 e os módulos em camadas (`application`, `domain`, `infrastructure`, `presentation`): [ARQUITETURA.md](ARQUITETURA.md). A ressalva do RFC é a do item 2 |
| 5 | Código-fonte em repositório com histórico de commits | **parcial**; depende do Artur | O repositório git existe, mas **é local e tem 6 commits**: um em 04/11/2026 ("Alvesting v2: etapas 1 a 12 do TCC") e cinco em 06/11/2026. O Playbook pede commits frequentes e revistos por pares (`Portfolio.md`, "Desenvolvimento Contínuo"). A evolução está registrada nos documentos (as etapas do `docs/PLANO.md`, os relatórios das ondas em `docs/redesign-*/relatorios/`, os ADRs com data), mas não no git. **Não se reescreve o histórico** (datas inventadas seriam falsificação, critério 5): daqui em diante, um commit por tarefa e PR revisado pelo squad. Publicar o repositório é decisão do Artur, depois de revisar o que vai a público |
| 6 | Documentação mínima: requisitos funcionais; casos de uso ou user stories; diagrama de arquitetura (C4 ou equivalente); instruções de deploy | **atende** | [REQUISITOS.md](REQUISITOS.md), [USER-STORIES.md](USER-STORIES.md), [ARQUITETURA.md](ARQUITETURA.md) (C4 em três níveis e as sequências) e [DEPLOY.md](DEPLOY.md) ("Como implantar"). Os diagramas Mermaid não foram desenhados localmente (sem rede): o GitHub os desenha depois do push |
| 7 | Ao menos três fluxos de negócio completos | **atende** | Quatro: o ciclo diário da arena, a conta com a LGPD, a carteira e a operação pelo painel ([USER-STORIES.md](USER-STORIES.md), seção 1), cada um com o teste de ponta a ponta. O ciclo diário é provado com os provedores fake (`ensaio.integration.spec.ts`); com os serviços reais, é a Temporada 1 |
| 8 | Cobertura de testes unitários com TDD: 75% no backend e 25% no frontend, conferida na prova de autoria | **atende** (o número); **parcial** (o registro do TDD) | Api 91,68%, site 69,63%, contratos 100% de linhas, com o mínimo travado no `vitest.config.ts` de cada pacote e no job `coverage` do CI; o relatório sai do `pnpm coverage` ([QUALIDADE.md](QUALIDADE.md), seções 2 e 5). O TDD tem exemplos com o vermelho registrado desde 04/11/2026 (seção 6 dela); antes disso os relatórios não registraram a ordem. A prova é do Artur, até 30/11/2026, com a segunda tentativa até 03/12/2026 |

## 3. Núcleo comum de engenharia

| # | Item | Status | Evidência e o que falta |
|---|---|---|---|
| 1 | Documentação em Wiki junto ao repositório | **parcial**; depende do Artur | `node scripts/wiki.mjs` gera a Home, a `_Sidebar` e uma página por documento e por ADR em `.data/wiki/`, com os links reescritos e teste (`scripts/wiki.test.mjs`). Publicar depende do repositório público: [QUALIDADE.md](QUALIDADE.md), seção 8 |
| 2 | Pipeline CI/CD configurado e funcionando | **parcial** | Escrito: `.github/workflows/ci.yml` (lint, tipos, unidade e integração, cobertura, e2e, Lighthouse, imagens, check da infra) e `deploy.yml` (blue/green com volta automática). Validado sem o GitHub: `actionlint` limpo e `scripts/deploy.test.mjs`, que executa o `deploy.yml` contra um Container Apps falso. **Nunca rodou no GitHub**, e "funcionando" só se prova depois do push |
| 3 | Análise estática de código e segurança | **parcial** | TypeScript estrito, ESLint com checagem de tipos, Prettier, `docs:check`, o check da infra e o `actionlint` rodam hoje. O SonarCloud está configurado (`sonar-project.properties` e o passo no `ci.yml`) e **não ligado**: o passo a passo está no [QUALIDADE.md](QUALIDADE.md), seção 7 |
| 4 | Monitoramento ou observabilidade | **parcial** | OpenTelemetry para o Application Insights, logs Pino no Log Analytics, alertas por e-mail e um runbook por alerta, escritos e testados (`apps/api/src/telemetry/`, `infra/modules/alerts.bicep`, `docs/RUNBOOK.md`). **Nada implantado**: os alertas nunca dispararam de verdade. O Application Insights é uma ferramenta de APM do mesmo tipo das que o Playbook cita (New Relic, Datadog) |

## 4. Desejáveis

| Item | Status | Evidência |
|---|---|---|
| Frameworks modernos com boas práticas | **atende** | Next 16.4 e React 19.3 no site, NestJS 12 na api, TypeScript 6 estrito ([DEPENDENCIAS.md](DEPENDENCIAS.md)) |
| Integração com APIs externas | **atende** (no código) | brapi, OpenRouter, CVM, BCB e os feeds RSS (seção 1 da [ARQUITETURA.md](ARQUITETURA.md)). Nesta onda nenhuma chamada real: a primeira é da Temporada 1, depois da chave e do prompt aprovados pelo Artur |
| Banco com persistência real | **atende** | PostgreSQL 17 com Prisma 7 e migrations versionadas (`apps/api/prisma/`); na Azure, o Flexible Server privado |
| Responsividade | **atende** | Celular primeiro; nenhuma rolagem horizontal de 360 a 1920 px (`e2e/layout.spec.ts`) |
| Testes de integração | **atende** | 38 arquivos `*.integration.spec.ts` contra o Postgres de verdade, o Azurite e o emulador do Service Bus |
| Práticas de segurança (HTTPS, validação de entradas) | **atende** (no código) | Zod em toda entrada, HTTPS e HSTS, a trava de origem, o papel mínimo do Postgres (RNF-01 do [REQUISITOS.md](REQUISITOS.md)). O HTTPS de verdade é o do Front Door, depois do deploy |
| Estratégias de cache | **atende** | O cache do Front Door no estático e na API pública, o cache de dados do Next revalidado depois de cada liquidação e o `Cache-Control` de cada rota (`docs/API.md`, seção 2; ADR 0023). Sem Redis, de propósito |
| Containerização | **atende** | Duas imagens (`apps/api/Dockerfile`, `apps/web/Dockerfile`), construídas e testadas no job `images` do CI |

## 5. Diferenciais

| Item | Status | Evidência |
|---|---|---|
| Autenticação robusta (OAuth2, login social, MFA) | **parcial** | E-mail e senha com verificação obrigatória e o login com o Google (OAuth 2.0, opcional: só com o client ID e o segredo configurados). Sem MFA |
| Dashboards com visualizações de dados | **atende** | O patrimônio com a faixa do Monte Carlo, o gráfico de posições, as velas, a sparkline e a rosca da carteira ([TELAS.md](TELAS.md)) |
| Camada de segurança (JWT, XSS, CSRF) | **atende** | Sessão em cookie `HttpOnly` com `SameSite=Lax` e a conferência do `Origin` nas mutações (CSRF); o texto de terceiro sempre como texto (XSS, `e2e/fixture.spec.ts`); a trava de origem e o WAF |
| Suporte multilíngue | não feito | Só português |
| Design System ou biblioteca de componentes | **atende** | Os tokens nos dois temas (`apps/web/src/app/globals.css`), o `docs/DESIGN.md` e a tabela de peças do ADR 0037. A ressalva da origem do desenho está na seção 9.1 |
| Testes de usabilidade com usuários reais | **pendente**; depende do Artur | Não houve. É também a evidência do PAC VIII (seção 7) |
| Domínio próprio | **pendente**; depende do Artur | O Bicep aceita (`docs/INFRA.md`, seção 8.4) |
| Processamento assíncrono com mensageria | **atende** | O Service Bus com seis filas e DLQ, os agendadores que só publicam e os workers que escalam pela fila (ADR 0004, 0006 e 0007) |
| Infraestrutura como código | **atende** | Bicep (`infra/`), com o check estático (`infra/tests/check.mjs`); o porquê de não ser Terraform no ADR 0012 |

## 6. O que evitar e o que não pode ter

**O que deve ser evitado:**

| Item | Status | Evidência e ressalva |
|---|---|---|
| Estilo visual inconsistente ou não responsivo | **atende** | Um sistema visual só, nos dois temas; o e2e em três aparelhos |
| Interface genérica ou desorganizada | **atende** | Cada tela responde a uma pergunta (`docs/PRODUCT.md`); a ressalva da origem do desenho está na seção 9.1 |
| Ausência de feedback ao usuário | **atende** | Estados vazios e de erro com texto, confirmações na página, avisos anunciados (`e2e/fixture.spec.ts`, "a api fora do ar vira uma tela de erro com texto útil..."; `e2e/carteira.spec.ts`, "as falhas do envio dizem o que fazer...") |
| Bibliotecas, templates ou temas prontos sem personalização | **parcial** (risco) | As peças da Arc, da beUI e da ReUI foram copiadas do registro e adaptadas (as mudanças estão no topo de cada arquivo e no `docs/DEPENDENCIAS.md`), mas a linguagem visual veio do Rallies AI: seção 9.1 |
| Falta de modularidade | **atende** | Monorepo com módulos em camadas ([ARQUITETURA.md](ARQUITETURA.md), seção 3) |
| Vibecoding (código improvisado, sem planejamento) | **atende**, com a ressalva | O plano (`docs/PLANO.md`), 37 ADRs, os relatórios das ondas e os testes. O código foi escrito com agentes do Claude Code sob a direção do Artur (o README, "Uso de IA no desenvolvimento"): quem prova que não é improviso é a prova de autoria, e o `docs/GUIA-DO-CODIGO.md` é o material de estudo dela |
| Documentação em Notion ou Obsidian | **atende** | Tudo em Markdown no repositório, e a Wiki é gerada dele |
| Hospedagem em Vercel, Netlify, Firebase ou Render | **atende** | Azure Container Apps |
| Plataforma que automatiza backend, banco e APIs (no-code disfarçado) | **atende** | Backend próprio (NestJS), banco gerido por nós (Bicep, migrations, papel mínimo) |
| Cloud que oculta a infra e o deploy, sem domínio técnico | **atende** | A infra escrita à mão em Bicep e o rollout num script testado (`scripts/deploy.mjs`), com o porquê de cada escolha nos ADRs |

**O que não pode ter (reprovação direta):**

| Item | Status | Evidência e ressalva |
|---|---|---|
| Projeto não acessível (link quebrado, servidor fora do ar) | **pendente** (risco) | Não está no ar (seção 2, item 1). Precisa estar até 30/11/2026 e ficar até a divulgação das notas |
| Código copiado ou plagiado | **atende**, com a ressalva | Todo código de terceiros é MIT, com o `LICENSE` ao lado e a linha no `docs/DEPENDENCIAS.md` ("Componentes copiados de registros"), e o `pnpm docs:check` reprova a cópia sem registro. São 2.521 linhas em `apps/web/src/components/{arc,beui,reui}`, uns 18% do código do site e 6% do total. A ressalva do desenho está na seção 9.1 |
| Interface inoperante (botões, menus ou links que não funcionam) | **atende**, com a ressalva | O e2e clica em tudo. A tela `/chat` é desligada **de propósito**, com o aviso de que entra na etapa 13: se a banca puder ler isso como "botão que não funciona", tirá-la da navegação até o chat existir é decisão do Artur |
| Violação de segurança básica | **atende** (no código) | Segredos no Key Vault, uma identidade por workload, papel mínimo no Postgres, a trava de origem e os testes de isolamento entre usuários (RNF-01 e RNF-02 do [REQUISITOS.md](REQUISITOS.md)). Não verificado na Azure |
| Ausência de documentação mínima | **atende** | Seção 2, item 6 |
| Deploy manual via SSH ou FTP | **atende** | GitHub Actions com OIDC, sem senha guardada ([DEPLOY.md](DEPLOY.md)) |
| Processo em cascata | **parcial** (risco) | O trabalho foi por etapas e ondas curtas, com entregas testadas e CI (`docs/PLANO.md`, seção 16), mas o histórico do git não mostra isso (seção 2, item 5) |
| Plataformas no-code | **atende** | Nenhuma |
| Banco em disco local (H2, SQLite) | **atende** | PostgreSQL. Até a Azure, o operador local usa o Postgres do Docker no Mac: é o mesmo PostgreSQL 17, e não o ambiente da entrega |

## 7. Temas e normas

**Temas a evitar e temas impedidos:**

| Tema | Status | Por quê |
|---|---|---|
| IA "apenas via prompt, sem integração efetiva ou arquitetura própria" (a evitar; na tabela geral, 🚫 Não Usar) | **atende**, com o argumento | O LLM é uma peça de um pipeline: a entrada comum congelada com o SHA-256, a resposta em JSON estrito validada item a item, o HOLD forçado no erro e no prazo, a execução no preço de abertura, a liquidação, o controle aleatório (Sorteio e Monte Carlo de 1.000 carteiras) e o teto de custo ([ARQUITETURA.md](ARQUITETURA.md), seção 4.1; `docs/METODOLOGIA.md`). O prompt é oculto por desenho do experimento, não porque a solução seja só ele |
| Gestão de listas (como o Goodreads) | **atende** | Não é |
| Cardápio, estoque, tele-entrega | **atende** | Não é |
| **Gestão financeira (com ou sem IA)** (impedido) | **atende**, com o risco; depende do Artur | O centro é a arena: um experimento sobre como LLMs decidem com a mesma informação, com a pergunta de pesquisa e as hipóteses do `docs/METODOLOGIA.md`. A carteira do usuário é acessória (só compras, para comparar com o que os modelos fazem; sem venda, nota, imposto, provento nem orçamento: `docs/PLANO.md`, seção 3). Vale confirmar com o orientador e manter a carteira em segundo plano no pôster e no pitch |

**Normas (`documentation/normas.md`):**

| Norma | Status | Evidência e o que falta |
|---|---|---|
| LGPD (Lei 13.709/2018) | **parcial** | Consentimento versionado com o SHA-256, exportar e excluir pela própria pessoa, limpeza diária, dado pessoal fora do backup e dos logs (`docs/CONTA.md`, seção 5). Os textos legais são **rascunho**, e o controlador e o contato são configuração da implantação: revisar antes de abrir (`docs/CONTA.md`, seção 8) |
| Uso de software de terceiros (licenças) | **parcial**; depende do Artur | Tudo o que vem de fora tem a linha no `docs/DEPENDENCIAS.md`, conferida pelo `pnpm docs:check`. Pendente antes de publicar: conferir os termos vigentes do Higgsfield, de onde vêm as artes do hero e da 404 (`docs/DEPENDENCIAS.md`, "Artes"); e as marcas dos laboratórios são dos donos (uso nominativo, com o aviso no rodapé) |
| Acessibilidade (WCAG 2.1) | **parcial** | O axe sem violação nas telas, nos dois temas, o teclado, o contraste e os alvos de 44 px (RNF-03 do [REQUISITOS.md](REQUISITOS.md)). Sem auditoria manual nem teste com leitor de tela |
| Desenvolvimento seguro (OWASP, ISO/IEC 27001 e 27002) | **parcial** | O OWASP Top 10 está mapeado no RNF-01 do [REQUISITOS.md](REQUISITOS.md); a ISO não foi seguida formalmente |
| Princípios da OCDE e ética em IA | **atende** no que se aplica | Transparência (o hash do prompt, a metodologia e as limitações publicadas, o "simulado" à vista, "não é recomendação"), a mesma entrada para todos os modelos e nenhuma decisão automática sobre pessoas |
| Do domínio: a CVM (recomendação de investimento) | **atende** | O aviso fixo no rodapé de toda tela (arena acadêmica, dinheiro fictício, nada de recomendação, as Resoluções CVM 19 e 20), e o chat só depois do aval do orientador (`docs/PLANO.md`, seção 12) |

## 8. Requisitos de entrega e calendário (até 30/11/2026)

| Item (`Portfolio.md` e `calendario.md`) | Prazo | Status |
|---|---|---|
| Duas primeiras orientações evidenciadas | 30/09/2026 (quarta-feira) | depende do Artur |
| Cinco orientações evidenciadas, no total | 30/11/2026 (segunda-feira) | depende do Artur |
| Prova de autoria aprovada (inclui a cobertura) | 30/11/2026 (segunda-feira); segunda tentativa até 03/12/2026 (quinta-feira) | depende do Artur. Apoio: o relatório de cobertura ([QUALIDADE.md](QUALIDADE.md), seção 2) e o `docs/GUIA-DO-CODIGO.md` |
| Repositório público no GitHub, com histórico de commits | 30/11/2026 | **pendente**; depende do Artur (seção 2, item 5) |
| Aplicação em ambiente produtivo, pública e estável, sem depender do notebook | 30/11/2026, e no ar até a divulgação das notas | **pendente** (seção 2, item 1) |
| Pôster digital em PDF, A0 vertical, com QR Code | 30/11/2026 | **pendente**; fora desta onda |
| Documentação de arquitetura, requisitos e decisões técnicas, com Wiki | 30/11/2026 | **parcial**: os documentos estão feitos; a Wiki, por publicar |
| Critérios obrigatórios da linha | 30/11/2026 | seção 2 |
| PAC VIII: software em release, evidências de peer review (PRs e issues no squad) e termo de aceite do parceiro (ou a evidência equivalente da modalidade Comunidade) | 30/11/2026 | depende do Artur. A release pode ser uma tag do GitHub depois do deploy |
| Visitar uma noite do Poster + Demo Day e avaliar os colegas | 10, 15 e 16/12/2026 | depende do Artur |

## 9. Riscos do critério eliminatório (ética, integridade e autoria)

O critério 5 do Demo Day reprova na hora por "cópias de código, design ou texto", "falsificação de resultados" e "uso indevido de dados".
O critério 1 aceita "projeto inspirado em app conhecido, mas com proposta diferente ou contexto local".

### 9.1 O design inspirado no Rallies AI (risco alto; decisão do Artur)

**O que existe.** O ADR 0035 registra o pedido "Quero que copie o Design do Rallies AI" e decide copiar a linguagem visual e a estrutura: a
casca do app (o trilho de ícones, a barra de abas, a folha "Mais"), as pílulas, as tabelas, a escala de tipo e os valores das cores (os
deles, ajustados o mínimo para passar o AA). O `docs/TELAS.md` chama as telas de "A Arena do Rallies", "O Discover do Rallies" e "O Chat do
Rallies", e o `docs/PLANO.md`, seção 1, tem a coluna "Copiamos". **O que não veio de lá** (ADR 0035 e `docs/DEPENDENCIAS.md`, "Desenho de
terceiros"): o código, o CSS, o JavaScript, a marca, o nome, o logo, as ilustrações, os avatares e os textos. Desde 05/11/2026 a cor primária é
a do logo da Alvesting (`#14144C`, ADR 0037), e a arte do hero e da 404 é a do Artur. **A proposta é outra:** o Rallies é um produto
financeiro comercial (com uma arena de LLMs comparada ao SPY, `docs/PLANO.md`, seção 1); a Alvesting é um experimento acadêmico na B3, com o mesmo prompt oculto e o hash
publicado, a entrada congelada e o controle aleatório para separar habilidade de sorte.

**Por que é risco.** O Playbook veda "cópia de design" no critério eliminatório, e as palavras dos documentos ("copie", "Copiamos", "a Arena
do Rallies") são as primeiras que um avaliador vai ler. **O que dá para fazer, decisão do Artur:** (1) trocar o que ainda é deles pelo que é
nosso (os neutros e as cores de dado, a escala de tipo, a casca), a partir dos tokens do `globals.css`; (2) reescrever a origem nos documentos
como referência ("inspirado em"), dizendo o que foi tomado e o que é próprio, sem esconder o que aconteceu; (3) levar a questão ao
orientador antes de 30/11/2026 e registrar a resposta num ADR; (4) creditar o Rallies como referência no README e no pôster (o README já faz).

### 9.2 O código copiado das bibliotecas MIT

A Arc, a beUI e a ReUI (só os itens grátis e MIT, nada Pro), copiadas do registro de cada uma e adaptadas; os ícones dos laboratórios do
pacote MIT da LobeHub. Cada arquivo diz de onde veio, sob qual licença e o que mudou; cada pasta tem o `LICENSE`; e o `pnpm docs:check`
reprova a cópia sem registro (ADR 0037; `docs/DEPENDENCIAS.md`). Código de terceiro com licença, crédito e registro não é plágio, e é o que o
Playbook pede (`documentation/normas.md`, "Uso de software de terceiros"). O risco que fica é o da seção 6 ("bibliotecas sem personalização").

### 9.3 A honestidade do trecho retroativo da Temporada 1

Os pregões de 13/10/2026 até a virada para o ao vivo são rodados depois, cada um só com o que existia às 07:30 dele, e ficam **marcados
como retroativos** no banco (o modo e a hora real em que rodaram) e no site; o ao vivo roda no relógio de verdade, e o pregão perdido com o
Mac desligado nunca vira "ao vivo" atrasado. As notícias dos portais não guardam histórico, então o retroativo fica sem elas. **Em
construção nesta onda** (as tarefas T0 e T1): as regras ficam no `docs/METODOLOGIA.md` e no `docs/DADOS.md`. Apresentar um pregão retroativo
como se fosse ao vivo seria falsificação de resultado: o pôster e a apresentação têm de dizer o mesmo que o site.

### 9.4 O tema impedido "gestão financeira" e o tema "IA só por prompt"

Os dois estão na seção 7, com o argumento. O risco é de leitura: a carteira e o chat sobre a carteira são o que mais se parece com um app de
finanças. A defesa é a arquitetura e a pergunta de pesquisa, e não a carteira.

### 9.5 O uso de IA no desenvolvimento

O Playbook permite, mas "não dispensa o domínio do resultado": o aluno responde por cada decisão e cada linha (`Portfolio.md`, "Prova de
Autoria"). O README diz como a IA foi usada (rascunho para o Artur revisar), e o `docs/GUIA-DO-CODIGO.md` é o mapa para a prova.
