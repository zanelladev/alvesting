# ADR 0035: O design do Rallies AI, nos dois temas

- **Status:** aceita
- **Data:** 05/11/2026
- **Origem:** o pedido do Artur ("Quero que copie o Design do Rallies AI": rallies.ai, `/discover`, `/arena` e `/chat") e as decisões dele
  (os dois temas seguindo o sistema; uma landing pública com a escadaria no hero e o app; o `/chat` pronto e desligado; os logos dos
  laboratórios ao lado dos modelos); o plano da onda (a tarefa T0, que mediu o Rallies deslogado; saiu do repositório em 09/11/2026, com os relatórios e as capturas da onda); as seis
  decisões da seção j do plano, tomadas pelo coordenador com a recomendação de cada uma (valem até o Artur dizer outra coisa)
- **Substitui:** as partes visuais do ADR 0034 (os tokens do ascii-ui, a casca de um cabeçalho só, a moldura de linhas, a cápsula, o foco
  âmbar e a Geist 500). Ficam do 0034: a arte como arquivo (o quadro 0 no HTML, o laço só a partir de 1024 px, a procedência e a pendência
  dos termos do Higgsfield), a fita, a regra de nada de cliente na casca e a de fontes do sistema no texto

## Contexto

A v2 voltou ao ascii-ui da v1 (ADR 0034): o canvas preto, a cápsula de navegação, a moldura de linhas laterais e o hero com a escadaria em
ASCII. O Artur quer agora a cara do **Rallies AI**: um app financeiro claro (e escuro, pela preferência da conta), com um trilho de ícones à
esquerda no desktop, uma barra de abas no pé no celular, pílulas, controles segmentados, tabelas densas e o logo de cada laboratório ao lado
do modelo. O que se copia é a linguagem visual e a estrutura; o código, o CSS, o JavaScript, a marca, o nome, o logo, as ilustrações, as
pinturas, os avatares e os textos deles não. A fonte dos títulos deles (FK Grotesk) é paga.

Três coisas do Rallies não cabem como estão: o tema escuro deles é uma classe que a conta liga (deslogado, o `<html>` vem com
`color-scheme: light` fixo), e o Artur quer o tema do sistema; três cinzas e dois vermelhos/verdes deles reprovam o AA nas superfícies
cinza, e o anel de foco (`outline: auto 1px`, cinza a 50%) não passa os 3:1; e a FK Grotesk e a Geist Pixel custariam fontes no caminho do
LCP da home, que já tem pouca folga (mediana de 2,39 s contra o teto de 2,5 s).

## Decisão

1. **Os tokens nos dois temas, com os mesmos nomes de antes.** O claro é a base do `@theme` de `apps/web/src/app/globals.css`, e o escuro
   troca os valores num `@media (prefers-color-scheme: dark)` sobre o `:root`, na camada base. Sem botão de tema: segue o sistema. Os nomes
   ficam (`canvas`, `surface-card`, `surface-strong`, `hairline`, `ink`, `body`, `muted`, `muted-soft`, `data-up`, `data-down`...): todo
   utilitário que já existia passa a seguir o tema sem trocar de nome. O `@theme` continua o comum (com o `inline` o utilitário levaria o
   valor e o escuro não pegaria). Os valores são os do Rallies, ajustados o mínimo para passar o AA onde o deles reprova (o `muted` claro
   `#6b6b72`, o `data-up` `#007a32`, o `data-down` `#d6003a`; a tabela a.2 do plano tem o contraste de cada par). O âmbar fica só na marca e
   na brasa da arte; o verde-limão é o positivo do escuro. O foco é o contorno sólido de 2 px na tinta, nos dois temas. `color-scheme` passa
   a `light dark` (no `html` e no `<meta>`), e o `theme-color` tem uma entrada por tema (`#ffffff` e `#171717`). Os derivados apontam para o
   token de base (`data-flat` é o `muted`; `semantic-*` são as cores de dado; a matriz do `DotSpinner` é a tinta e o `surface-strong`), e as
   séries do gráfico ganham uma cor por laboratório (`serie-openai`... `serie-neutra`), ajustada nos dois temas (decisão 2 da seção j).
2. **Tipo: a Geist num peso só, o 600**, pelo `next/font/google`, com preload, no lugar da FK Grotesk: títulos, nomes, números grandes e o
   nome gigante do rodapé (decisão 1 da seção j: sem Geist Pixel). O resto é a fonte do sistema com os pesos de verdade dela (400, 500 e
   600): texto, botões, pílulas, rótulos, e a mono também é a do sistema. A escala do Rallies entra no `@theme` pelo número em px
   (`text-11`, `text-13`, `text-15`, `text-18`, `text-20`, `text-22`, `text-26`, `text-30`, `text-32`, `text-40`, `text-42`, `text-gigante`),
   com a entrelinha e o espaçamento juntos; os nomes do Arc saíram todos (os últimos, `display-sm`,
   `lead`, `title`, `label` e `prose-md`, no fechamento da onda). O versalete fica liberado só em rótulo que o e2e não lê com `innerText`
   (decisão 3 da seção j).
3. **Duas cascas, por grupos de rota do Next**, sem mudar endereço, com um layout raiz só (o `html`, o `body`, a fonte e o viewport):
   - **O site** (`(site)`: a landing, o Como funciona, os textos legais; a 404 da raiz traz a mesma casca): o cabeçalho do Rallies, com a
     marca, os links no meio e a pílula "Entrar"; abaixo de 1024 px, a folha `popover` do botão "Menu", como a de antes.
   - **A tela dividida** (`(entrar)`, a de entrar, e `(auth)`, as outras quatro da conta): a do cadastro do Rallies, com o formulário à
     esquerda e, a partir de 1024 px, a moldura escura com a escadaria (o quadro 0, sem o laço) à direita (nota de 05/11/2026).
   - **O app** (`(app)/(arena|explorar|carteira|chat|conta)`): uma `nav "Principal"` só, dentro do `banner`, que o CSS desenha como o trilho
     de ícones de 80 px no desktop (a marca no topo; "Buscar" e "Conta" embaixo) e como a barra de abas fixa no pé no celular (Arena,
     Explorar, Carteira, Chat, Mais e Conta, decisão 4 da seção j: a arena é o produto público; seis alvos de 60 × 56 px em 360, com a área
     segura do iPhone pelo `viewport-fit=cover`). **O item ativo sai do servidor, sem JavaScript**: cada área tem o seu layout, que passa a
     área à `AppShell`, e o item dela leva `aria-current="page"` (o ADR 0034 deixou a cápsula sem item ativo porque o layout não sabe o
     caminho; um layout por área resolve). O "Mais" abre um `popover` com as telas de apoio (Como funciona, Notícias, Ações, Termos,
     Privacidade), sem JavaScript: no celular, a folha da tela inteira acima da barra de abas, como a do site (o título "Mais", o ✕ e a lista
     na própria folha; a coluna coberta sai de vista e da ordem do Tab); no desktop, um menu curto ancorado no item "Mais" do trilho, que
     deixa a coluna à vista (o Esc devolve o foco ao "Mais"). O principal não tem teto de largura: como o Discover e a Arena do Rallies, ele
     enche a tela, e cada tela diz a largura do próprio texto. O rodapé do app é compacto, no pé da coluna, com o mesmo aviso fixo e as
     mesmas atribuições do site (`components/rodape.tsx`).
   - O erro fica um por grupo (o `error.tsx` de `(site)`, `(entrar)`, `(auth)` e de cada área do app), com a casca do grupo em volta, todos
     com o mesmo `ApiDown`.
4. **As rotas de hoje continuam no mesmo endereço**; entram `/arena` (o conteúdo da home de antes, que virou a landing), `/explorar` (o
   Discover) e `/chat` (pronto e desligado até o aval do orientador, como a etapa 13 manda). O `/?filtro=` e o `/?cursor=` de antes levam ao
   feed da `/arena` com 308, no `src/proxy.ts`, depois da trava de origem (nota de 05/11/2026).
5. **Os logos dos laboratórios voltam** (o ADR 0034 os deixou fora): os SVG monocromáticos do LobeHub Icons (`@lobehub/icons-static-svg`
   1.102.0, MIT, Copyright (c) 2023 LobeHub), seis arquivos em `apps/web/public/laboratorios/`, copiados sem alteração no desenho, com a
   nota MIT ao lado; nenhuma dependência npm. O logo é o do modelo (o que o Rallies mostra), desenhado por máscara CSS em `currentColor`
   num círculo (o tema pinta; nada de dois arquivos por tema nem de imagem invertida), decorativo, com o nome sempre ao lado em texto e a
   etiqueta "simulado" enquanto as decisões forem simuladas. O laboratório sai do `modelId` (o prefixo do OpenRouter) ou, no provedor fake,
   do slug do elenco (`lib/laboratorio.ts`): o contrato público não muda. O Sorteio, as referências e um laboratório sem logo levam a
   inicial num círculo neutro, pelo atributo (fora do texto que o leitor de tela e o e2e leem). A cor do laboratório vai só na linha do
   gráfico, nunca no logo. As marcas são dos donos: o rodapé de toda tela diz isso, e a MIT cobre os arquivos, não as marcas.
6. **A arte só na moldura escura.** A escadaria e o urso são âmbar sobre preto, e no tema claro sumiriam no branco: a classe `.moldura`
   pinta o preto nos dois temas, com a tinta da arte. Nela moram só a arte, a legenda, a fita e o texto para o leitor de tela; o que segue o
   tema da página (o cartão "Arena agora" da landing, as pílulas) fica fora dela, por cima, e um número com o glifo de dado não entra nela (o
   verde e o vermelho do claro não passam o AA sobre o preto). A escadaria vai no hero da landing (a moldura grande do Rallies, com o recorte
   de UI por cima) e na tela dividida; o urso, na 404. O quadro 0 da escadaria vem no HTML; o do urso chega no navegador depois do `load`
   (`public/ascii/arte/urso-q0.json`), porque a árvore da 404 vai no documento de toda página (nota de 05/11/2026).

## Consequências

- **Testes.** A suíte roda no claro (o padrão do Playwright); o escuro roda em três projetos a mais (`pixel-7-escuro`, `iphone-15-escuro`,
  `desktop-escuro`) que pegam só os testes marcados `@tema`: os dos quatro specs de layout (360 px sem rolagem e alvos de 44 px, o axe nos
  dois tamanhos e o tema que trocou de verdade) e os testes de tela que conferem o tema (a moldura e o cartão da landing, a moldura do urso
  da 404), sem dobrar a suíte. Mudaram de expectativa: o cabeçalho de antes (a cápsula e a folha com sete
  links) virou a casca do app e a do site; a moldura de linhas saiu; a caixa de marcar e o radio marcados pintam a tinta do claro
  (`rgb(10, 10, 10)`) e o radio vazio, o branco; quem clicava "Conta" no cabeçalho da home passa pela casca do app.
- **O LCP da home.** A fonte trocou de peso (a Geist 600, 13.456 B no subset latin, contra 13.336 B da 500) e nada entrou no caminho
  crítico: os logos são máscara CSS (imagem de prioridade baixa, pedida só onde um logo aparece). A medida está no relatório da fundação.
- **Cor fixa não segue o tema.** Hexadecimal em atributo de SVG ou em `style` fica invisível num dos temas (o gráfico do patrimônio pintava
  `#f5f5f5`): as cores vão por classe (`stroke-ink`, `fill-muted`, `stroke-serie-openai`) ou por `var()`.
- **Os grupos de rota mexeram em todo arquivo de página** (um `mv`, sem mudar o conteúdo): o índice do git continua com os caminhos velhos até
  o commit do Artur.
- **Ficam de fora** o que é do Rallies e não existe aqui (os agentes do usuário, conectar corretora, o gráfico da carteira por período, as
  respostas e o compartilhar do feed, os depoimentos e os números de patrimônio deles, as ilustrações e os avatares), a Geist Mono e a Geist
  Pixel, e o botão de tema.

## Nota de 05/11/2026 (fase 2 e fechamento da onda)

O que as tarefas da fase 2 e o fechamento decidiram, e que muda ou completa as decisões acima:

- **A tela dividida em dois grupos.** A de entrar mora em `(entrar)` e as outras quatro da conta em `(auth)`, cada grupo com o seu layout e o
  seu `error.tsx`: a pílula do canto troca com a tela ("Criar conta" na de entrar, "Entrar" nas outras), e um layout não sabe o caminho
  (o mesmo motivo do layout por área do app). O endereço não muda.
- **A 404 é a da variante B.** A 404 da raiz traz a casca do site e o conteúdo dela, sem o quadro do urso no documento (ele chega depois do
  `load`, do `urso-q0.json`); não há pega-tudo (`[...resto]`) nem not-found de grupo. O Next 16.4.3 só desenha no servidor a 404 da URL que
  não existe: a de dentro do app (`notFound()` lançado por uma página) aparece com o JavaScript, como antes da onda. A variante A (a 404 da
  raiz mínima e um pega-tudo no `(site)`) poupava mais bytes, mas deixava a URL que não existe em branco sem JavaScript e reprovava a regra
  `no-html-link-for-pages` nos `<a>` da casca.
- **O 308 do `/?filtro=` mora no `src/proxy.ts`, depois da trava de origem**, e não no `redirects()` do `next.config.ts`, que o plano previa:
  os `redirects()` rodam antes do proxy, e sem o `X-Azure-FDID` o pedido responderia 308 em vez de 403, uma exceção nova à trava. Assim o
  308 não é exceção: sem o cabeçalho é 403, como qualquer caminho.
- **O escopo do `@tema`**: os quatro specs de layout e os testes de tela que conferem o tema de verdade (o `landing.spec.ts` e o
  `nao-encontrada.spec.ts`); teste funcional não leva a marca (o do chat saiu dela no fechamento).
- **O fechamento**: o principal do app sem teto de largura (a barra secundária encosta no trilho, como a do Rallies: em 1440 px a arena tem
  os 960 px do Rallies ao lado da barra de 400); a carteira no Today em três painéis de 360, 1fr e 360 px a partir de 1280 px (a tabela de
  posições cabe inteira no meio em 1440 px, com as células das tabelas a 8 px de cada lado); a folha "Mais" da decisão 3, que no desenho da
  fundação apagava a coluna do app inteira; o nome do competidor nas tabelas em 14/600, com o logo fora do fluxo do texto; a `.moldura` só com
  o preto e a tinta (decisão 6); e os nomes do Arc fora do `@theme`.
- **As linhas e as barras** (o pedido do Artur com a captura da Arena do Rallies logado numa janela de 1.917 px; relatório
  `linhas-barras.md`): o "sem teto" vale até a coluna do app, de 1.550 px medidos lá (o fio da esquerda em x = 183 e o da direita em 1.732),
  que acima disso fica no centro com o fio de cada lado; o fio embaixo da barra do topo fica em y = 44, contínuo da barra secundária ao
  principal, e os das carteiras e da faixa vão de borda a borda; nenhuma barra de rolagem fica à vista (`scrollbar-width: none`), e a faixa
  dos modelos ganha o "›" redondo de 36 px do Rallies pelo `::scroll-button()` do Chromium, só CSS e só com o mouse.
- **O "simulado" uma vez por contexto** (a onda do design premium, ADR 0037): a etiqueta ao lado de todo nome, da decisão 5, virou a nota no
  cabeçalho da faixa, da tabela e da barra das carteiras, a etiqueta junto do título na página do modelo e o aviso de página na arena e no
  ciclo; visível e discreta, nunca uma etiqueta em cada nome.
- **Os logos coloridos** (06/11/2026, pedido do Artur): a decisão 5 trocou de desenho, não de regra. Entram as versões coloridas (`-color`)
  do mesmo pacote, onde ele as tem (o Claude, o Gemini, o DeepSeek e o Qwen; o GPT e o Grok só existem em preto), como imagem num círculo
  branco nos dois temas com o contorno de 1 px, o mesmo do logo das ações; a procedência e os SHA-256 novos em `docs/DEPENDENCIAS.md`.
- **Entrar e criar conta na casca do app** (06/11/2026, pedido do Artur: "a tela de login deve ser um menu do app, aparecendo a
  sidebar/navbar"): a tela dividida saiu. Entrar e as outras quatro telas da conta moram num grupo só, `(auth)`, na casca do app, na área da
  conta (a "Conta" marcada), com o formulário numa coluna de até 448 px no centro do principal; `components/tela-dividida.tsx` e o
  `laco={false}` da `Arte`, que só ela usava, saíram. No mesmo pedido, a caixa de marcar virou a nativa de 20 px (o alvo de 44 px é o
  rótulo, como o do radio), e a conta virou um grid (`docs/CONTA.md`, seção 9).
