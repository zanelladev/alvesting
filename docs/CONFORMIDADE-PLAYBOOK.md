# Conformidade com o Portfolio Playbook

Cada item do [Portfolio Playbook](https://github.com/CatolicaSC-Portfolio/The-Portfolio-Playbook) da Católica SC que vale para a
Alvesting (linha **Web Apps**, 8º período: a Disciplina de Portfólio e o PAC Extensionista VIII), com o status de hoje e a evidência.
Lido no commit `ce005fe` do Playbook, em 06/11/2026 (em 18/11/2026 ele ainda é o último): `directions/portfolio-directions-webapp.md`, `directions/portfolio-directions-GERAL.md`,
`Portfolio.md`, `calendario.md`, `documentation/normas.md`, `documentation/guia-prova-de-autoria.md` e `demoday/Avaliacao_Poster_DemoDay.md`.
**Prazo de entrega: 30/11/2026 (segunda-feira).**

**Status:** **atende** · **parcial** (feito em parte; o que falta está dito) · **pendente** (não feito) · **depende do Artur** (uma
decisão, uma conta ou uma entrega que só ele faz). **Estado em 18/11/2026, sem enfeite:** o repositório é público no GitHub, com 16
commits, todos direto na `main` e sem PR; o CI e o deploy rodam no GitHub Actions; o site e a api estão no ar na Azure, sempre ligados
desde 15/11/2026; a Temporada 1 está ao vivo desde 16/11/2026, depois dos 23 pregões retroativos; o site ainda não mostra qual pregão foi
retroativo; a Wiki não está publicada; o SonarCloud não está ligado; o PAC VIII (squad, peer review, parceiro) é todo do Artur.

---

## 1. Resumo

| | O que está feito | O que falta até 30/11/2026 |
|---|---|---|
| **Produto** | A arena, a conta com a LGPD, a carteira (com a comparação com a arena) e o painel de admin, testados (no CI do commit `291a150`, de 17/11/2026: 3.221 testes na api, 979 no site, 504 nos contratos e 2.132 execuções do e2e em três aparelhos), no ar na Azure, com a Temporada 1 real ao vivo desde 16/11/2026 | Marcar no site os pregões retroativos (seção 9.3) e manter o sistema no ar e estável até a divulgação das notas |
| **Documentação mínima** | Requisitos, user stories com os fluxos completos, C4 e instruções de deploy, 40 ADRs | Publicar a Wiki: o gerador está pronto, e falta o Artur criar a primeira página no GitHub |
| **Engenharia** | CI/CD rodando no GitHub Actions (o `291a150` passou no CI e foi implantado pelo deploy), cobertura de 91,2% na api e 67,6% no site, análise estática no CI, observabilidade implantada na Azure, com alertas que já dispararam de verdade | O SonarCloud ligado (o projeto e o segredo são do Artur); achar por que a regra de log dos alertas nunca disparou (seção 3, item 4) |
| **Riscos do critério 5 (eliminatório)** | O código de terceiros registrado com licença; o retroativo marcado no banco e na API pública; a correção do RAIZ4 registrada na metodologia | **O que ficou do sistema visual anterior** (seção 9.1: a arquitetura de informação e algumas medidas; desde 18/11/2026 o sistema visual é o do ADR 0041), **o retroativo sem rótulo no site** (seção 9.3) e **o histórico curto do git, sem PR** (seção 2, item 5): o desenho e o histórico são decisões do Artur |

---

## 2. Obrigatórios da linha Web Apps

| # | Item do Playbook | Status | Evidência e o que falta |
|---|---|---|---|
| 1 | Hospedado em ambiente acessível publicamente (AWS, GCP, Azure...) | **atende** | O site e a api rodam na Azure, no Container Apps da Chile Central (ADR 0040), no perfil econômico (ADR 0039), implantados pelo pipeline do GitHub Actions: o deploy passa desde o commit `a39d77e` (10/11/2026), e o último commit, o `291a150`, foi implantado em 17/11/2026. Desde 15/11/2026 os dois ficam sempre ligados, com uma réplica no mínimo, para a primeira visita não esperar a partida a frio (ADR 0039, nota de 15/11/2026). O Playbook pede o sistema no ar e estável **até a divulgação final das notas**, sem depender de notebook: a produção não depende do Mac (o operador local, `docs/RUNBOOK.md`, seção 13, nunca foi instalado, e a temporada foi para a Azure em 15/11/2026, pela 13.6), e o crédito de estudante, no ritmo medido em 15/11/2026, dura até o começo de abril de 2027 (a mesma nota) |
| 2 | Funcionalidades completas e reais, conforme o escopo do RFC | **parcial**; depende do Artur | Arena, conta, carteira e admin feitos ([REQUISITOS.md](REQUISITOS.md)), e a Temporada 1 roda com os serviços reais: os 23 pregões de 13/10 a 13/11/2026 como retroativos (ADR 0038) e, desde 16/11/2026, ao vivo na Azure, até o último pregão do ano (30/12/2026). O chat consultivo (etapa 13) fica desligado, por decisão do Artur em 17/11/2026: a tela `/chat` mostra o aviso, e das ideias para ele entrou só a comparação da carteira com a arena ([TELAS.md](TELAS.md), seção 9), que não chama LLM. **O RFC do 7º semestre não está no repositório**: conferir com o orientador se o RFC aprovado previa o chat, e se o escopo do `docs/PLANO.md` (a v2, refeita do zero em 31/10/2026) bate com ele, é do Artur |
| 3 | Interface funcional, navegável e com usabilidade básica | **atende** | O e2e navega só clicando (`e2e/arena.spec.ts`, "arena, modelo, ciclo, ação e notícias, só clicando"), pelo teclado e pelo toque, no Pixel 7, no iPhone 15 e no desktop |
| 4 | Arquitetura definida e organização modular (componentes reutilizáveis, separação de responsabilidades) | **atende** | O C4 e os módulos em camadas (`application`, `domain`, `infrastructure`, `presentation`): [ARQUITETURA.md](ARQUITETURA.md). A ressalva do RFC é a do item 2 |
| 5 | Código-fonte em repositório com histórico de commits | **parcial**; depende do Artur | O repositório é público no GitHub ([`zanelladev/alvesting`](https://github.com/zanelladev/alvesting)) desde 09/11/2026, com **16 commits**: um em 04/11/2026 ("Alvesting v2: etapas 1 a 12 do TCC"), cinco em 06/11/2026 e dez de 09 a 17/11/2026, **todos direto na `main`, sem PR**. O Playbook pede commits frequentes e revistos por pares (`Portfolio.md`, "Desenvolvimento Contínuo"). A evolução de antes de 04/11 está registrada nos documentos (as etapas do `docs/PLANO.md`, os relatórios das ondas em `docs/redesign-*/relatorios/` e `docs/temporada-1/relatorios/`, os ADRs com data), mas não no git. **Não se inventam commits nem datas no histórico** (seria falsificação, critério 5). A revisão por pares, com PRs no squad, é do Artur (o PAC VIII, seção 8) |
| 6 | Documentação mínima: requisitos funcionais; casos de uso ou user stories; diagrama de arquitetura (C4 ou equivalente); instruções de deploy | **atende** | [REQUISITOS.md](REQUISITOS.md), [USER-STORIES.md](USER-STORIES.md), [ARQUITETURA.md](ARQUITETURA.md) (C4 em três níveis e as sequências) e [DEPLOY.md](DEPLOY.md) ("Como implantar"). O GitHub desenha os diagramas Mermaid na página de cada documento (conferido na ARQUITETURA.md em 18/11/2026) |
| 7 | Ao menos três fluxos de negócio completos | **atende** | Quatro: o ciclo diário da arena, a conta com a LGPD, a carteira e a operação pelo painel ([USER-STORIES.md](USER-STORIES.md), seção 1), cada um com o teste de ponta a ponta. O ciclo diário é provado com os provedores fake (`ensaio.integration.spec.ts`) e roda com os serviços reais na Temporada 1, na Azure |
| 8 | Cobertura de testes unitários com TDD: 75% no backend e 25% no frontend, conferida na prova de autoria | **atende** (o número); **parcial** (o registro do TDD) | No job `coverage` do CI do commit `291a150` (17/11/2026): api 91,22%, site 67,64% e contratos 100% de linhas, com o mínimo travado no `vitest.config.ts` de cada pacote e no próprio job; o relatório sai do `pnpm coverage` ([QUALIDADE.md](QUALIDADE.md), seções 2 e 5). O TDD tem exemplos com o vermelho registrado desde 04/11/2026 (seção 6 dela); antes disso os relatórios não registraram a ordem. A prova é do Artur, até 30/11/2026, com a segunda tentativa até 03/12/2026 |

## 3. Núcleo comum de engenharia

| # | Item | Status | Evidência e o que falta |
|---|---|---|---|
| 1 | Documentação em Wiki junto ao repositório | **parcial**; depende do Artur | `node scripts/wiki.mjs` gera a Home, a `_Sidebar` e uma página por documento e por ADR em `.data/wiki/`, com os links reescritos e teste (`scripts/wiki.test.mjs`). O repositório já é público e tem a Wiki ligada; falta o Artur criar a primeira página pelo site do GitHub (o repositório da Wiki só nasce assim), e depois a publicação são os passos 3 e 4 da [QUALIDADE.md](QUALIDADE.md), seção 8 |
| 2 | Pipeline CI/CD configurado e funcionando | **atende** | `.github/workflows/ci.yml` (lint, tipos, unidade e integração, cobertura, e2e, Lighthouse, imagens, check da infra) e `deploy.yml` (blue/green com volta automática) rodam no GitHub Actions a cada push na `main`. O último commit, o `291a150` (17/11/2026), passou nos dois: o deploy o implantou, e o CI passou na segunda execução do job do site, porque na primeira um teste do e2e da carteira (o giro dos algarismos, no iPhone 15) foi instável, e o CI reprova teste instável (`failOnFlakyTests`). Antes do GitHub, os dois foram validados com o `actionlint` e o `scripts/deploy.test.mjs`, que executa o `deploy.yml` contra um Container Apps falso |
| 3 | Análise estática de código e segurança | **parcial**; depende do Artur | TypeScript estrito, ESLint com checagem de tipos, Prettier, `docs:check` e o check da infra rodam no CI a cada push, e o `actionlint` antes de mudar um workflow. O SonarCloud está configurado (`sonar-project.properties` e o passo no `ci.yml`) e **não ligado**: sem o segredo `SONAR_TOKEN`, o passo é pulado com um aviso (como no CI do `291a150`). Falta o Artur criar o projeto no SonarCloud e o segredo no GitHub: [QUALIDADE.md](QUALIDADE.md), seção 7 |
| 4 | Monitoramento ou observabilidade | **atende**, com a ressalva | OpenTelemetry para o Application Insights, logs Pino no Log Analytics, alertas por e-mail e um runbook por alerta (`apps/api/src/telemetry/`, `infra/modules/alerts.bicep`, `docs/RUNBOOK.md`), implantados na Azure com a infra. Os alertas já dispararam de verdade: o da DLQ em 10, 13 e 15/11/2026, e o da CPU do banco em 17/11/2026 (o histórico de alertas da Azure, lido em 18/11/2026). **A ressalva:** a regra de log dos sinais da aplicação (`alvesting-sinais-da-aplicacao`) nunca disparou, nem com as falhas de job das filas `briefing` (10 a 13/11/2026) e `market` (15/11/2026), que a consulta dela conta como `job-falhou`; a causa está em aberto (o roteiro de conferência é o do `docs/INFRA.md`, 5.4). O Application Insights é uma ferramenta de APM do mesmo tipo das que o Playbook cita (New Relic, Datadog) |

## 4. Desejáveis

| Item | Status | Evidência |
|---|---|---|
| Frameworks modernos com boas práticas | **atende** | Next 16.4 e React 19.3 no site, NestJS 12 na api, TypeScript 6 estrito ([DEPENDENCIAS.md](DEPENDENCIAS.md)) |
| Integração com APIs externas | **atende** | brapi, OpenRouter, CVM, BCB e os feeds RSS (seção 1 da [ARQUITETURA.md](ARQUITETURA.md)), chamados de verdade desde a Temporada 1: no retroativo, do Mac (de 06 a 15/11/2026), e na produção, pela Azure |
| Banco com persistência real | **atende** | PostgreSQL 17 com Prisma 7 e migrations versionadas (`apps/api/prisma/`); na produção, o Flexible Server privado da Azure |
| Responsividade | **atende** | Celular primeiro; nenhuma rolagem horizontal de 360 a 1920 px (`e2e/layout.spec.ts`) |
| Testes de integração | **atende** | 42 arquivos `*.integration.spec.ts` contra o Postgres de verdade, o Azurite e o emulador do Service Bus, no CI |
| Práticas de segurança (HTTPS, validação de entradas) | **atende** | Zod em toda entrada, HTTPS e HSTS, o papel mínimo do Postgres (RNF-01 do [REQUISITOS.md](REQUISITOS.md)). Na produção (o perfil econômico, sem Front Door), o HTTPS é o do ingress do Container Apps (`allowInsecure: false`), e a api só tem ingress interno, atrás do site (ADR 0039); a trava de origem é do perfil padrão |
| Estratégias de cache | **atende** | O cache de dados do Next, revalidado depois de cada liquidação, e o `Cache-Control` de cada rota (`docs/API.md`, seção 2; ADR 0023); o cache do Front Door no estático e na API pública é do perfil padrão, e a produção, no econômico, fica sem ele. Sem Redis, de propósito |
| Containerização | **atende** | Duas imagens (`apps/api/Dockerfile`, `apps/web/Dockerfile`), construídas e testadas no job `images` do CI, publicadas no GHCR e rodando no Container Apps |

## 5. Diferenciais

| Item | Status | Evidência |
|---|---|---|
| Autenticação robusta (OAuth2, login social, MFA) | **parcial** | E-mail e senha com verificação obrigatória e o login com o Google (OAuth 2.0, opcional: só com o client ID e o segredo configurados). Sem MFA |
| Dashboards com visualizações de dados | **atende** | O patrimônio com a faixa do Monte Carlo (em R$ ou em % desde 17/11/2026, com a leitura do maior patrimônio do pregão para o menor), o gráfico de posições, as velas, a sparkline, a rosca da carteira e a comparação da carteira com a arena ([TELAS.md](TELAS.md)) |
| Camada de segurança (JWT, XSS, CSRF) | **atende** | Sessão em cookie `HttpOnly` com `SameSite=Lax` e a conferência do `Origin` nas mutações (CSRF); o texto de terceiro sempre como texto (XSS, `e2e/fixture.spec.ts`); na produção, a api fora da internet, atrás do site, e no perfil padrão a trava de origem e o WAF |
| Suporte multilíngue | não feito | Só português |
| Design System ou biblioteca de componentes | **atende** | Os tokens nos dois temas (`apps/web/src/app/globals.css`), o `docs/DESIGN.md` (a página regrada, ADR 0041) e a tabela de peças do ADR 0037. O que ficou do sistema visual anterior está na seção 9.1 |
| Testes de usabilidade com usuários reais | **pendente**; depende do Artur | Não houve. É também a evidência do PAC VIII (seção 7) |
| Domínio próprio | **pendente**; depende do Artur | O Bicep aceita no perfil padrão; no econômico, o da produção, o domínio próprio no ingress do Container Apps não foi implementado (`docs/INFRA.md`, seção 8.4) |
| Processamento assíncrono com mensageria | **atende** | O Service Bus com seis filas e DLQ, os agendadores que só publicam e os workers que escalam pela fila (ADR 0004, 0006 e 0007), rodando na produção |
| Infraestrutura como código | **atende** | Bicep (`infra/`), com o check estático (`infra/tests/check.mjs`); a produção foi criada por ele, e o porquê de não ser Terraform está no ADR 0012 |

## 6. O que evitar e o que não pode ter

**O que deve ser evitado:**

| Item | Status | Evidência e ressalva |
|---|---|---|
| Estilo visual inconsistente ou não responsivo | **atende** | Um sistema visual só, nos dois temas; o e2e em três aparelhos |
| Interface genérica ou desorganizada | **atende** | Cada tela responde a uma pergunta (`docs/PRODUCT.md`); o que ficou do sistema visual anterior está na seção 9.1 |
| Ausência de feedback ao usuário | **atende** | Estados vazios e de erro com texto, confirmações na página, avisos anunciados (`e2e/fixture.spec.ts`, "a api fora do ar vira uma tela de erro com texto útil..."; `e2e/carteira.spec.ts`, "as falhas do envio dizem o que fazer...") |
| Bibliotecas, templates ou temas prontos sem personalização | **parcial** (risco) | As peças da Arc, da beUI e da ReUI foram copiadas do registro e adaptadas (as mudanças estão no topo de cada arquivo e no `docs/DEPENDENCIAS.md`), e o sistema visual em volta delas é próprio desde 18/11/2026 (ADR 0041; seção 9.1) |
| Falta de modularidade | **atende** | Monorepo com módulos em camadas ([ARQUITETURA.md](ARQUITETURA.md), seção 3) |
| Vibecoding (código improvisado, sem planejamento) | **atende**, com a ressalva | O plano (`docs/PLANO.md`), 40 ADRs, os relatórios das ondas e os testes. O código foi escrito com agentes do Claude Code sob a direção do Artur (o README, "Uso de IA no desenvolvimento"): quem prova que não é improviso é a prova de autoria, e o `docs/GUIA-DO-CODIGO.md` é o material de estudo dela |
| Documentação em Notion ou Obsidian | **atende** | Tudo em Markdown no repositório, e a Wiki é gerada dele |
| Hospedagem em Vercel, Netlify, Firebase ou Render | **atende** | Azure Container Apps |
| Plataforma que automatiza backend, banco e APIs (no-code disfarçado) | **atende** | Backend próprio (NestJS), banco gerido por nós (Bicep, migrations, papel mínimo) |
| Cloud que oculta a infra e o deploy, sem domínio técnico | **atende** | A infra escrita à mão em Bicep e o rollout num script testado (`scripts/deploy.mjs`), com o porquê de cada escolha nos ADRs |

**O que não pode ter (reprovação direta):**

| Item | Status | Evidência e ressalva |
|---|---|---|
| Projeto não acessível (link quebrado, servidor fora do ar) | **atende**; manter até as notas | No ar na Azure, com o site e a api sempre ligados desde 15/11/2026 (seção 2, item 1). Tem de ficar até a divulgação das notas: o crédito, no ritmo medido, dura até o começo de abril de 2027 (ADR 0039, nota de 15/11/2026) |
| Código copiado ou plagiado | **atende**, com a ressalva | Todo código de terceiros é MIT, com o `LICENSE` ao lado e a linha no `docs/DEPENDENCIAS.md` ("Componentes copiados de registros"), e o `pnpm docs:check` reprova a cópia sem registro. São 4.385 linhas em `apps/web/src/components/{arc,beui,reui}` (sem os testes), uns 27% do código do site e 9% do total (contados em 18/11/2026). A ressalva do desenho está na seção 9.1 |
| Interface inoperante (botões, menus ou links que não funcionam) | **atende**, com a ressalva | O e2e clica em tudo. A tela `/chat` segue desligada **de propósito**, com o aviso na tela, e o chat fica desligado por decisão do Artur em 17/11/2026: se a banca puder ler isso como "botão que não funciona", tirar o Chat da navegação é decisão do Artur |
| Violação de segurança básica | **atende** | Segredos no Key Vault, uma identidade por workload, papel mínimo no Postgres (a api de produção só sobe com o login de menor privilégio, `requireApiLogin`), a api só alcançável pelo site e os testes de isolamento entre usuários (RNF-01 e RNF-02 do [REQUISITOS.md](REQUISITOS.md)), implantados na Azure |
| Ausência de documentação mínima | **atende** | Seção 2, item 6 |
| Deploy manual via SSH ou FTP | **atende** | GitHub Actions com OIDC, sem senha guardada ([DEPLOY.md](DEPLOY.md)), que implantou o `291a150`. O mínimo de uma réplica, em 15/11/2026, mudou primeiro à mão, pelo `az` e no mesmo blue/green, e entrou no Bicep no mesmo dia (ADR 0039, nota de 15/11/2026) |
| Processo em cascata | **parcial** (risco) | O trabalho foi por etapas e ondas curtas, com entregas testadas e CI (`docs/PLANO.md`, seção 16), mas o histórico do git é curto e sem PR (seção 2, item 5) |
| Plataformas no-code | **atende** | Nenhuma |
| Banco em disco local (H2, SQLite) | **atende** | PostgreSQL 17 no Flexible Server da Azure. O trecho retroativo da Temporada 1 rodou no Postgres do Docker no Mac (o mesmo PostgreSQL 17) e foi para a Azure em 15/11/2026 (`docs/RUNBOOK.md`, 13.6) |

## 7. Temas e normas

**Temas a evitar e temas impedidos:**

| Tema | Status | Por quê |
|---|---|---|
| IA "apenas via prompt, sem integração efetiva ou arquitetura própria" (a evitar; na tabela geral, 🚫 Não Usar) | **atende**, com o argumento | O LLM é uma peça de um pipeline: a entrada comum congelada com o SHA-256, a resposta em JSON estrito validada item a item, o HOLD forçado no erro e no prazo, a execução no preço de abertura, a liquidação, o controle aleatório (Sorteio e Monte Carlo de 1.000 carteiras) e o teto de custo ([ARQUITETURA.md](ARQUITETURA.md), seção 4.1; `docs/METODOLOGIA.md`). O prompt é oculto por desenho do experimento, não porque a solução seja só ele |
| Gestão de listas (como o Goodreads) | **atende** | Não é |
| Cardápio, estoque, tele-entrega | **atende** | Não é |
| **Gestão financeira (com ou sem IA)** (impedido) | **atende**, com o risco; depende do Artur | O centro é a arena: um experimento sobre como LLMs decidem com a mesma informação, com a pergunta de pesquisa e as hipóteses do `docs/METODOLOGIA.md`. A carteira do usuário é acessória: só compras, para comparar com o que os modelos fazem (desde 17/11/2026, a comparação com a arena mostra quanto o mesmo dinheiro valeria em cada competidor, sem recomendação e sem LLM), e sem venda, nota, imposto, provento nem orçamento (`docs/PLANO.md`, seção 3). O chat sobre a carteira ficou desligado (decisão do Artur em 17/11/2026). Vale confirmar com o orientador e manter a carteira em segundo plano no pôster e no pitch |

**Normas (`documentation/normas.md`):**

| Norma | Status | Evidência e o que falta |
|---|---|---|
| LGPD (Lei 13.709/2018) | **parcial**; depende do Artur | Consentimento versionado com o SHA-256, exportar e excluir pela própria pessoa, limpeza diária, dado pessoal fora do backup e dos logs (`docs/CONTA.md`, seção 5). O site está aberto com os textos legais ainda em **rascunho** (os termos 0.2 e a política 0.3): revê-los com o orientador é o primeiro item do que fazer antes de abrir (`docs/CONTA.md`, seção 8). O controlador e o contato vêm da configuração da produção |
| Uso de software de terceiros (licenças) | **parcial**; depende do Artur | Tudo o que vem de fora tem a linha no `docs/DEPENDENCIAS.md`, conferida pelo `pnpm docs:check`. O repositório foi publicado em 09/11/2026, e o `docs/DEPENDENCIAS.md` ainda marca como pendência do Artur conferir os termos vigentes do Higgsfield, de onde vêm as artes do hero e da 404 ("Artes"); e as marcas dos laboratórios são dos donos (uso nominativo, com o aviso no rodapé) |
| Acessibilidade (WCAG 2.1) | **parcial** | O axe sem violação nas telas, nos dois temas, o teclado, o contraste e os alvos de 44 px (RNF-03 do [REQUISITOS.md](REQUISITOS.md)). Sem auditoria manual nem teste com leitor de tela |
| Desenvolvimento seguro (OWASP, ISO/IEC 27001 e 27002) | **parcial** | O OWASP Top 10 está mapeado no RNF-01 do [REQUISITOS.md](REQUISITOS.md); a ISO não foi seguida formalmente |
| Princípios da OCDE e ética em IA | **atende** no que se aplica | Transparência (o hash do prompt, a metodologia e as limitações publicadas, o "simulado" à vista, "não é recomendação"), a mesma entrada para todos os modelos e nenhuma decisão automática sobre pessoas |
| Do domínio: a CVM (recomendação de investimento) | **atende** | O aviso fixo no rodapé de toda tela (arena acadêmica, dinheiro fictício, nada de recomendação, as Resoluções CVM 19 e 20); o chat, que só começaria com o aval do orientador (`docs/PLANO.md`, seção 12), ficou desligado; e a comparação da carteira com a arena é relatório do que já aconteceu, sem recomendação ([TELAS.md](TELAS.md), seção 9) |

## 8. Requisitos de entrega e calendário (até 30/11/2026)

| Item (`Portfolio.md` e `calendario.md`) | Prazo | Status |
|---|---|---|
| Duas primeiras orientações evidenciadas | 30/09/2026 (quarta-feira) | depende do Artur |
| Cinco orientações evidenciadas, no total | 30/11/2026 (segunda-feira) | depende do Artur |
| Prova de autoria aprovada (inclui a cobertura) | 30/11/2026 (segunda-feira); segunda tentativa até 03/12/2026 (quinta-feira) | depende do Artur. Apoio: o relatório de cobertura ([QUALIDADE.md](QUALIDADE.md), seção 2) e o `docs/GUIA-DO-CODIGO.md` |
| Repositório público no GitHub, com histórico de commits | 30/11/2026 | **atende** (público desde 09/11/2026); o histórico curto e sem PR é o risco da seção 2, item 5 |
| Aplicação em ambiente produtivo, pública e estável, sem depender do notebook | 30/11/2026, e no ar até a divulgação das notas | **atende** (seção 2, item 1): na Azure, sempre ligada desde 15/11/2026; falta mantê-la até as notas |
| Pôster digital em PDF, A0 vertical, com QR Code | 30/11/2026 | **pendente**; depende do Artur |
| Documentação de arquitetura, requisitos e decisões técnicas, com Wiki | 30/11/2026 | **parcial**: os documentos estão feitos; a Wiki espera o Artur criar a primeira página (seção 3, item 1) |
| Critérios obrigatórios da linha | 30/11/2026 | seção 2 |
| PAC VIII: software em release, evidências de peer review (PRs e issues no squad) e termo de aceite do parceiro (ou a evidência equivalente da modalidade Comunidade) | 30/11/2026 | depende do Artur: o squad, o peer review (os commits desta fase foram direto na `main`, sem PR) e o termo de aceite. Ainda não há tag nem release no GitHub: ela sai perto da entrega, com o OK do Artur |
| Visitar uma noite do Poster + Demo Day e avaliar os colegas | 10, 15 e 16/12/2026 | depende do Artur. A Temporada 1 só termina depois, em 30/12/2026 |

## 9. Riscos do critério eliminatório (ética, integridade e autoria)

O critério 5 do Demo Day reprova na hora por "cópias de código, design ou texto", "falsificação de resultados" e "uso indevido de dados".
O critério 1 aceita "projeto inspirado em app conhecido, mas com proposta diferente ou contexto local".

### 9.1 O sistema visual (decisão do Artur)

**O que existe.** Desde 18/11/2026 o sistema visual é a página regrada (ADR 0041), no lugar do sistema visual de 05/11/2026: os tokens, as
cascas, as formas das peças, os títulos e a landing foram desenhados para a Alvesting, com a referência de ritmo da landing nova de outro
projeto do Artur (as linhas, a coluna no centro e a lateral à esquerda), sem código, componente, texto, arquivo, cor nem fonte dela. O que
veio de fora tem licença e registro em `docs/DEPENDENCIAS.md`: as peças das bibliotecas MIT (seção 9.2) e os logos dos laboratórios
(LobeHub, MIT); a arte do hero e da 404 é a do Artur, e a cor primária é a do logo da Alvesting (`#14144C`, ADR 0037). **A proposta é
própria:** um experimento acadêmico na B3, com o mesmo prompt oculto e o hash publicado, a entrada congelada e o controle aleatório para
separar habilidade de sorte.

**O que ficou do sistema anterior.** A arquitetura de informação e o comportamento das telas (ADR 0041, decisão 10: as áreas do app e a
barra de abas no celular, o Explorar, a carteira e o chat desligado) e algumas medidas (a escala de tipo em px e o campo dos formulários).
O Playbook veda "cópia de design" no critério eliminatório. **O que dá para fazer, decisão do Artur:** trocar o que ainda vem de lá, ou
levar a questão ao orientador antes de 30/11/2026 e registrar a resposta num ADR.

**O estado.** O desenho do ADR 0041 entra na `main` com o redesenho, e o site publicado passa a ele no deploy seguinte.

### 9.2 O código copiado das bibliotecas MIT

A Arc, a beUI e a ReUI (só os itens grátis e MIT, nada Pro), copiadas do registro de cada uma e adaptadas; os ícones dos laboratórios do
pacote MIT da LobeHub. Cada arquivo diz de onde veio, sob qual licença e o que mudou; cada pasta tem o `LICENSE`; e o `pnpm docs:check`
reprova a cópia sem registro (ADR 0037; `docs/DEPENDENCIAS.md`). Código de terceiro com licença, crédito e registro não é plágio, e é o que o
Playbook pede (`documentation/normas.md`, "Uso de software de terceiros"). O risco que fica é o da seção 6 ("bibliotecas sem personalização").

### 9.3 A honestidade do trecho retroativo da Temporada 1

Os 23 pregões de 13/10 a 13/11/2026 foram rodados depois, de 06 a 15/11/2026, cada um só com o que existia às 07:30 dele (ADR 0038), e
desde 16/11/2026 o pregão é ao vivo, na Azure, no relógio de verdade. As notícias dos portais não guardam histórico, então o retroativo
fica sem elas. As regras estão no `docs/METODOLOGIA.md` ("Temporada 1") e no `docs/DADOS.md` (seção 22). **No banco e na API pública**,
cada ciclo diz o modo (`RETROATIVO` ou `AO_VIVO`) e a hora real em que rodou, e o ranking conta os pregões de cada modo. **No site, ainda
não:** nenhuma tela mostra que um pregão foi retroativo, e marcar as telas é pendência antes da entrega. Apresentar um pregão retroativo
como se fosse ao vivo seria falsificação de resultado: o site, o pôster e a apresentação têm de dizer o que o banco já diz.

**Uma correção registrada.** Em 15/11/2026, a referência igual-peso estava inflada pelo RAIZ4, cotado por lote de 100 ações desde
03/11/2026 sem evento registrado (−4,9% em vez de −22,2% em 13/11). O evento entrou pelo painel como grupamento 100:1, a temporada foi
liquidada de novo, e a nota com o antes e o depois está no `docs/METODOLOGIA.md` ("O RAIZ4 cotado por lote").

### 9.4 O tema impedido "gestão financeira" e o tema "IA só por prompt"

Os dois estão na seção 7, com o argumento. O risco é de leitura: a carteira, agora com a comparação com a arena, é o que mais se parece com
um app de finanças (o chat sobre ela ficou desligado). A defesa é a arquitetura e a pergunta de pesquisa, e não a carteira.

### 9.5 O uso de IA no desenvolvimento

O Playbook permite, mas "não dispensa o domínio do resultado": o aluno responde por cada decisão e cada linha (`Portfolio.md`, "Prova de
Autoria"). O README diz como a IA foi usada (rascunho para o Artur revisar), e o `docs/GUIA-DO-CODIGO.md` é o mapa para a prova.
