# Relatório da T4 (o fechamento da onda "design premium")

Tarefa `task_449f8bf798a4` (dispatch `ctx_db903ffd5b66`), 05/11/2026, das 18:55 às 21:35 (horário de Brasília). Consertei os achados da revisão de
código (`relatorios/revisao-codigo.md`, a T3a) e do QA ao vivo (`relatorios/qa.md`, a T3b), fiz o radio de lançar que a T2b deixou, fechei o que as
tarefas deixaram para o fechamento e provei tudo com a suíte e2e inteira nos seis projetos, o Lighthouse, o `pnpm check`, o `docs:check` com o
conferente novo e o ensaio. Nada foi commitado nem posto no índice; nada no `apps/api` nem no `packages`; nenhuma dependência npm nova; nada Pro;
o `/chat` continua desligado; os textos dos termos e da política não mudaram. A demo (4300 e 4310) não foi parada nem reiniciada, e o
`alvesting_ensaio` não foi tocado.

## Resumo

- **A revisão de código: os 6 importantes e os 19 menores feitos**, cada um com o conserto e o teste onde havia lógica, visto falhar antes. Dois
  ajustes de caminho, com o motivo na seção 1: o M11 prova o salto das molas por um teste de unidade e pelas etiquetas do fim das linhas (a escala
  do eixo não muda com o banco do e2e), e o M12 não se reproduz no Playwright (o conserto ficou, e o teste de toque é guarda).
- **O radio de lançar**: o desenho do radio nativo, de 20 px, com o estado na espessura da borda, no alvo de 44 px do rótulo (seção 2).
- **O QA ao vivo: os 17 achados**, 16 consertados e o 14 anotado no `docs/TELAS.md`, como o coordenador decidiu (seção 3).
- **O que as tarefas deixaram**: os logos na justificativa da landing, o `partesDoNome` na faixa dos laboratórios, a seção 6 do `TELAS.md` com o
  `e2e/logos.spec.ts` e as capturas da landing de novo (seção 4).
- **A prova** (seção 6): o `pnpm check` com exit 0 (o site com 50 arquivos e 919 testes, os contratos 501, a api 3.153 e 9 pulados, os scripts
  136); o `pnpm build` com exit 0; **o e2e inteiro nos seis projetos, um por vez e com 1 worker, sem nenhuma falha** (pixel-7 517 e 17 pulados,
  iphone-15 517 e 17, desktop 530 e 4, pixel-7-escuro 161 e 1, iphone-15-escuro 161 e 1, desktop-escuro 162); o `tema.spec.ts` três vezes no
  desktop, 11 de 11 em cada (e o teste da corrida repetido 10 vezes, 20 de 20); o Lighthouse com **LCP de 2.422 ms**, CLS 0 e TBT de 20,5 ms; **o CSS
  da landing menor que o da T2b** (16.156 B no fio contra 16.178); o `docs:check` com 91 itens; o ensaio com o SHA-256 de sempre; o `az` falso sem
  chamada; e 52 capturas do depois, 11.760 KB.

## 1. A revisão de código (T3a)

### Os importantes

| Achado | O conserto | O teste (visto falhar antes do conserto) |
|---|---|---|
| **I1.** A sexta fatia da rosca sem cor | `--fatia-6` no `.rosca` (o 200 da escala no claro, o 800 no escuro: o tom seguinte da ordem, longe da primária de cada tema), e o comentário da regra | `wallet-client.spec.ts`, "toda cor que a alocação dá existe no globals.css, a sexta fatia inclusive" (lê o `.rosca` e confere cada `var(--fatia-N)` que a alocação emite para 6, 7 e 8 ações). Vermelho: `expected '…' to match /--fatia-6:/` |
| **I2.** O aviso fechado com o ponteiro em cima prendia a pilha | O aviso guarda se o ponteiro está nele e, ao sair da tela (fechado pelo mouse, arrastado, empurrado pelo limite), solta a pausa `hover` (o desmontar do item, `animated-toast-stack.tsx`): é a raiz, e vale para todo caminho de saída | e2e `carteira.spec.ts`, "o aviso fechado com o ponteiro em cima não prende os seguintes: o próximo some sozinho" (desktop: o ponteiro sobre o aviso, o clique no fechar, e o aviso seguinte some no prazo). Vermelho no build sem o conserto: o segundo aviso ficou na tela os 12 s do teste. Não há DOM nos testes de unidade do site (o vitest roda no node, sem jsdom), então a prova é a do navegador |
| **I3.** A fonte padrão maior desalinhava o eixo das velas e o fim das linhas | A altura das duas caixas em px (`style={{ height }}`, a da escala), no lugar do `h-70` (17,5 rem) | e2e `arena.spec.ts`, "com a fonte padrão de 20 px, o eixo das velas e o fim das linhas do patrimônio ficam no lugar" (o `font-size` do `<html>` a 20 px, como a "Grande" do Chrome: cada marco do eixo a no máximo 2 px da linha da grade dele, e o ponto do fim de cada linha a no máximo 2 px do fim do traço). Vermelho: 22,2 px. E unidade: "a caixa do desenho tem a altura da escala em px" (as velas) |
| **I4.** O gráfico de posições abria nos pregões antigos | A caixa que rola é `dir="rtl"` e o conteúdo volta ao `ltr`: a rolagem começa na ponta direita, nos pregões mais novos, como o nome da região já dizia. Só HTML e CSS | e2e "em 320 px o gráfico de posições abre no último pregão, com os nomes do fim inteiros" (a data do último pregão dentro da caixa à vista, em 320 e 1440 px). Vermelho |
| **I5.** Esconder uma série pela legenda apagava as outras | O realce ignora a série escondida (`realce`, no `line-chart.tsx`) | e2e "a legenda mostra a referência escondida e esconde um modelo": depois de esconder o modelo, toda linha à vista volta à opacidade 1. Vermelho: as linhas ficavam a 25% |
| **I6.** A corrida do `tema.spec.ts:75` | O teste espera a troca (`expect.poll`) depois do clique, e espera dois quadros depois de mudar o sistema antes de conferir que a escolha guardada vale (o teste agora está na linha 80) | Três rodadas do arquivo no desktop, 11 de 11 cada; o teste repetido 10 vezes (`--repeat-each=10`), 20 de 20 |

### Os menores

| Achado | O conserto | O teste ou a prova |
|---|---|---|
| **M1.** Peças da Arc sem uso | Saíram o segmentado e o esqueleto (o `.tsx` e o `.module.css` de cada um, e os testes deles no `arc.spec.tsx`), as chaves dos tokens de movimento que nada lia (`duration.exit`, `ease.exit`, `ease.inOut`, `spring.responsive`, `spring.gentle`, `spring.snappy`, `stagger.*`, `blur.text`; e também `duration.fast` e `duration.considered`, que só os retirados liam), o `export default` repetido do tooltip e do contador, e as props `label` e `animateOnView` do contador (com as variantes, o `useInView` e o CSS do rótulo). O ADR 0037 diz, na linha de cada uma, "copiada e retirada em 05/11/2026 por falta de uso; volta do registro quando uma tela pedir" | `arc.spec.tsx` (o contador e o tooltip); o `tsc`, o lint e o e2e |
| **M2.** O ADR 0037 e os docs não batiam | A coluna "Instalada agora" de cada linha (o que cada tela usa); a linha das velas: "só o visual, de servidor, sem o código da peça" (a leitura das quatro cotações, a ADR 0033); o toast que troca na hora com movimento reduzido; o parágrafo das peças instaladas; no `DESIGN.md`, as três pastas (a `reui` também) e a leitura pelo teclado só da linha, da rosca e do ranking no tempo; no `TELAS.md`, a tabela equivalente só do patrimônio e das posições | Leitura |
| **M3.** O "simulado" uma vez por contexto | A regra nova no `CLAUDE.md` (seção Telas), no `TELAS.md` (o bullet dos logos dos laboratórios), na lista "Muda" do ADR 0037 e uma nota no ADR 0035 | Leitura |
| **M4.** O `components.json` citado | A frase saiu do `DEPENDENCIAS.md` ("não há `components.json`") | Leitura |
| **M5.** O `docs:check` não via os componentes copiados | O `scripts/docs-check.mjs` percorre `apps/web/src/components/arc`, `beui` e `reui` e exige, para cada arquivo (fora os testes nossos, `.spec`, e o `LICENSE`), uma linha completa na seção "Componentes copiados de registros" cujo Onde tenha o caminho do arquivo ou de uma pasta acima dele (a pasta `tooltip` não cobre `tooltip-extra`), e o `LICENSE` em cada pasta | `scripts/docs-check.test.mjs`, "componentes copiados de registros" (5 casos: o arquivo sem linha, a pasta que cobre, o nome de pasta parecido, a linha fora da seção ou incompleta, a pasta sem `LICENSE`). Vermelho: 4 de 5. O `docs:check` real: 91 itens (os 75 de antes, os 13 arquivos copiados e os 3 `LICENSE`) |
| **M6.** Nomes das bibliotecas e variantes que nada lia | Do `:root` ficaram só os nomes que algum arquivo lê (o `--background` e o `--foreground` do tooltip, os `--chart-1` a `--chart-7`, a sombra, o espaço, o raio, a entrelinha e o movimento do tooltip e do contador) e saíram os outros 30; saíram o `@theme inline` do shadcn, o `@custom-variant dark` e a sombra de repouso (era da pílula do segmentado). O `data-theme` do script do tema também saiu (nenhuma peça o lia); a classe `dark` ficou (a sombra do escuro a lê). O `CLAUDE.md`, o ADR 0037, o `DESIGN.md` e o `TELAS.md` dizem isso | `tokens.spec.ts`, "os nomes das bibliotecas apontam para os tokens": cada nome do `:root` tem quem o leia (o `var()` no CSS e no `style`, o `-(--x)` do Tailwind) e lê um token, sem cor crua. Vermelho: 30 nomes sem leitor. `theme-selector.spec.tsx`: o `data-theme` não é escrito (vermelho antes de tirá-lo do script) |
| **M7.** Cor fora dos tokens | Os tokens `logo-fundo` (o branco) e `logo-contorno` (`light-dark` do preto e do branco a 10%) para o círculo do logo das ações; as opções do select nativo no canvas e na tinta (eram as cores do sistema); o `theme-color` continua escrito em hexadecimal (a meta não lê o CSS), e um teste o prende ao canvas | `tokens.spec.ts`, "a Regra do Token nas peças": nenhuma peça pinta branco, preto, hexadecimal, `rgb`, `oklch` nem a cor do sistema (vermelho: o logo e o select), e a cor da barra do navegador é o canvas dos dois temas (no `layout.tsx` e no script do tema). O `logos.spec.ts` do e2e (o contorno de cada tema) passou nos seis projetos |
| **M8.** Três desenhos para o "termo com explicação" | Um desenho só: o `.termo` (o sublinhado pontilhado no fio de controle, 3:1, que acende na tinta), no botão `Termo` de 44 px da carteira e no texto do radio "Valor total pago"; o `.dica` saiu (o Explorar e o terminal passaram a mostrar a explicação em texto, o M9). Linha nova no ADR 0037, "Termo com explicação" | `wallet-panels.spec.tsx` (o botão do termo) |
| **M9.** As explicações só no balão | As regras do universo da semana à vista, num parágrafo do Explorar; a explicação da confiança à vista, uma vez, no começo das decisões do terminal. O balão que repetia o texto saiu (era um `span` de `tabIndex` sem papel e sem a caixa de 44 px) | e2e `explorar.spec.ts`, "as regras do universo e o que é a confiança estão no texto da página, também no celular" (nos três projetos claros; vermelho) e "a confiança é explicada uma vez, no texto da seção..." (vermelho); unidade, o universo com as regras à vista |
| **M10.** O teste das cotações só procurava os fechamentos | Procura também a abertura, a máxima e a mínima de cada pregão, e o real com ponto (`66.17`, o `closeCents / 100` que um gráfico de cliente receberia sob outra chave). O real com uma casa (o `66.1` do zero final) ficou de fora: ele bate com as coordenadas do SVG das velas | `quotes.spec.ts` verde no build real. A regra nova, num script à parte com uma página de mentira (a lista `{"x":…,"y":66.17,"o":…}`): pega 6 dos 7 preços vazados (o que fica de fora é o de zero final), e a regra de antes, 0 de 3 |
| **M11.** O movimento reduzido não via as molas | O salto das molas da escala é uma função pura, `moverMola` (`line-chart.tsx`), com teste de unidade; no e2e, as etiquetas do fim das linhas (molas do Motion, que se rearrumam quando o CDI entra) ficam no mesmo lugar em dois quadros seguidos, e alguma mudou de lugar | Unidade, "com movimento reduzido a coordenada salta para o alvo, sem mola" (vermelho: a função não existia). **Desvio**: a sugestão da revisão (ler o `d` de uma linha depois de a legenda mudar a escala) não se aplica ao banco do e2e: a faixa do Monte Carlo cobre todas as séries nos 5 pregões, e nenhuma série muda a escala (o teste procurou uma e não achou). Ficaram as etiquetas (a mesma família de molas) e o teste de unidade do ramo da escala |
| **M12.** O realce da legenda do gráfico de posições no toque | O realce pelo foco só quando o foco é o do teclado (`:focus-visible`), no gráfico de posições e no do patrimônio | e2e "o gráfico de posições mostra a posição...": nos projetos de toque, tocar fixa, tocar solta, e nenhuma linha fica apagada. **Não se reproduz no Playwright**: o teste passou também no build sem o conserto (o toque do CDP solta um `pointerleave` que limpa o realce antes do foco). O conserto segue a sugestão da revisão, e o teste fica como guarda |
| **M13.** O aviso da arena com o feed filtrado falava de todos | O `quemSimula` aceita o elenco parcial: com o feed filtrado antes da primeira liquidação, nomeia os simulados que vê, sem concluir "os modelos"; e conta um modelo por nome (o feed repete o modelo) | Unidade, "com o elenco parcial (o feed filtrado), a nota nomeia os simulados em vez de dizer 'os modelos'". Vermelho |
| **M14.** Código e CSS sem uso ou repetidos | Saíram o `CAIXA`, o `semVersao` (a faixa dos laboratórios usa o `partesDoNome`), as curvas `linear` e `step` do `xy-path` (e o tipo `XYCurve`), o `MARGIN` padrão do `layoutEquity` (a margem é obrigatória; o teste passa a dele), o `export` do `ALTURA_VELAS` e do `VelasLayout`, o parâmetro `altura` do `layoutVelas`, a classe `velas`, o `.painel-velas` (o painel é o `card` com o respiro menor), o `export { ratioBps }` das carteiras e o seletor `.menu-acoes .pill` repetido; e, achados no caminho, os "títulos de aba grandes" (`Abas grandes` e `.abas-grandes`), que só as âncoras da arena usavam | O `tsc`, o lint e os testes |
| **M15.** Comentários e nomes velhos | A Geist e a "pílula preta" nos comentários do `ui.tsx`, do `error-page.tsx`, da página da conta e no nome do teste do `hero.spec.tsx`; o link na primária no `globals.css`; os "rótulos dentro do SVG" do `lib/chart.ts`; o contador do painel, que agora rola só pelo ponteiro (pelo toque e pelo teclado troca na hora, como o comentário dizia); e a frase do `relatorios/explorar.md` sobre a primária no trilho | Leitura |
| **M16.** O aviso da exportação prometia o download | "Pedimos o arquivo dos seus dados ao servidor: o alvesting-meus-dados.json aparece na pasta de downloads do navegador." | e2e `conta.spec.ts` (a frase nova) |
| **M17.** O `pnpm add` mexeu no lockfile além do pedido | Conferido com um script que compara as seções `packages` e `snapshots` do lockfile do índice e do working tree: **nenhuma versão que existia mudou** (29 pacotes novos, os do `motion` e do tooltip da Radix, e sete versões novas de pacotes da Radix ao lado das que já existiam; nenhum removido). O que mudou foram as variantes de par: o `next@16.4.3` e o `vitest@5.0.5` do `apps/web` passaram a resolver o par opcional `@opentelemetry/api@1.10.0` (e o `vite`, o `yaml@2.9.1`), as variantes que já havia no lockfile (o pnpm junta as variantes iguais); e o `@nestjs/platform-express` com o `rxjs`, o `packageExtensions`. Nada voltou (a regra do coordenador é voltar a versão que mudou, e nenhuma mudou), e o `pnpm-lock.yaml` não foi tocado. O efeito: o Next usa o `@opentelemetry/api` do pacote, e não a cópia compilada, e ele vai no standalone da imagem do site (sem o SDK, é vazio). A linha do `@opentelemetry/api` no `DEPENDENCIAS.md` diz isso. Não rodei o `docker build` da imagem do site (ele baixa a imagem base pela rede) | O script de comparação, no relatório; o build e o e2e |
| **M18.** A etiqueta do último preço encostava no marco | `PERTO_DA_ETIQUETA` de 20 (as duas caixas, de uns 20 e 16 px, centradas na mesma coluna) | Unidade, "nenhum marco do eixo fica a menos de 20 px da etiqueta do último preço" (os fechamentos de R$ 71,00 a R$ 72,00, de centavo em centavo). Vermelho: 19,7 px em R$ 71,28 |
| **M19.** O id da estratégia no cartão do Explorar | "Decisões simuladas por uma estratégia fixa." (a página do modelo continua com o id, no par "Estratégia simulada") | Leitura e as capturas |

**Achado meu no caminho**: com poucos pregões (menos de 12), as velas punham `data-ponta="inicio"` em todas as colunas, e a data do realce da
ponta direita saía para fora da figura; a metade de cá da ponta direita agora se alinha pelo fim.

## 2. O radio de lançar

Feito como a revisão propôs: o `<input type="radio">` de 20 px (`size-5`, `appearance-none`, redondo), desmarcado com a borda de 2 px no fio de
controle e marcado com a de 6 px na tinta, o miolo no canvas. **O estado é a espessura da borda**, sem `::before` nem fundo: a borda sobrevive às
cores forçadas do sistema em todo navegador, o Firefox inclusive (a cor vira a do sistema, a espessura fica), e o glifo `●` num `::before` de
`<input>`, que havia, o Firefox não desenha. O alvo de 44 px é o `<label>` inteiro da opção (`min-h-11`, o radio e o texto; o toque no texto marca o
radio), e o anel de foco fica no radio (`outline-offset-2`). A caixa de marcar (`.check`) continua como estava, porque o `✕` precisa do glifo. O
texto do "Valor total pago" tem o sublinhado do termo (o M8).

**Os testes que mudaram de expectativa, com o motivo**: o `carteira.spec.ts` ("lançar, editar e apagar tocando") conferia o disco na tinta com o
`●`; agora confere a borda de 6 px na tinta e o fundo no canvas, marcado, e a de 2 px no fio de controle, desmarcado, os dois com 20 px e redondos,
e o rótulo de cada opção com pelo menos 44 px de altura. O `carteira-layout.spec.ts` mede os alvos de 44 px e passa a medir o radio pelo rótulo
da opção (`label:has(> input[type=radio])`), e não o `<input>`, que agora tem 20 px de propósito.

## 3. O QA ao vivo (T3b)

| Achado | O conserto | O teste |
|---|---|---|
| **1** (bloqueia). Em 360 px a arena e o ranking rolavam de lado | A tabela de cada carteira cabe nos 320 px da coluna: o cabeçalho numa linha (o "%" à vista, "Resultado %" para o leitor de tela), o respiro de 2 px de cada lado até 640 px, e o anel da alocação (decorativo: o número está ao lado) só sai na carteira mais estreita que 336 px (uma consulta de contêiner) | e2e "em 360 px a carteira com o resultado de '-R$ 1.330,30' cabe na coluna", na `/arena?vista=carteiras` e no `/ranking`: desce até as carteiras, põe em cada linha o texto mais comprido que a carteira mostra (o ticker de seis letras, a alocação de 100,00%, o resultado de "-R$ 1.330,30" e o percentual de "-12,34%") e mede a página, cada tabela e o cabeçalho. Vermelho: a página rolava 17 px |
| **2** (bloqueia). A leitura do gráfico não fechava no celular | Com a leitura aberta, o `pointerdown` fora da figura a fecha, e a rolagem (de qualquer caixa) também, quando quem a abriu foi o toque (pelo teclado, o foco que rola a página até o gráfico não pode fechá-la) | e2e "no celular a leitura fecha com o toque fora do gráfico e com a rolagem" (pixel-7 e iphone-15: tocar no gráfico, tocar no título, o painel some; tocar de novo, rolar, o painel some). Vermelho nos dois |
| **3.** Os nomes cortados no fim das linhas das posições | O nome curto também nas referências ("Igual-peso", "BOVA11", "CDI", pelo tipo, `partesDoNome`; o resto do nome para o leitor de tela), sem o corte de 96 px, numa calha de 128 px que é respiro de dentro da área que rola | e2e "em 1440 px o gráfico de posições abre no último pregão, com os nomes do fim inteiros" (cada nome inteiro e dentro da caixa); unidade, o nome curto das referências. Vermelho |
| **4.** As tabelas cortavam colunas sem pista | A pista é só CSS, na caixa que rola (`TableScroll`): a borda da direita esmaece enquanto há mais colunas (a máscara, com a largura numa propriedade registrada que uma animação ligada à rolagem da própria caixa leva a zero no fim; sem rolagem, nada esmaece) e, com o mouse, o mesmo "›" redondo da faixa (`::scroll-button()`). As três tabelas do ranking com as mesmas larguras de coluna (`table-layout: fixed` e um `<colgroup>` em px, nenhuma coluna tirada). A tabela compacta da landing cabe no celular: o nome curto pode quebrar ao lado do logo (fora do fluxo do texto), o respiro das células é de 4 px, e o recorte do celular perdeu 4 px de cada lado | e2e "as três tabelas têm as mesmas colunas, e a que passa da coluna esmaece na borda até o fim da rolagem" (vermelho: `auto` no lugar de `fixed`); "em 360 px" e "em 390 px a tabela do 'Sorte ou habilidade?' cabe inteira, com o Percentil" (vermelho: rolava 84 px) |
| **5.** O título do DeepSeek em duas linhas, com a segunda embaixo do logo | O logo ao lado do título, fora do `h1` (o `logo` do `PageHead`), e o teto do título de 24 para 32 ch | e2e "o título da página do modelo cabe numa linha no desktop, e o logo fica ao lado dele" (1440 e 360 px). Vermelho |
| **6.** O botão primário esmaecia na abertura | Quando o JavaScript chega, o formulário desativado vira ativo sem transição: o `useHydrated` (`form-kit.tsx`, o gancho que todo controle que espera a hidratação usa) põe uma folha com `transition: none` antes de o navegador recalcular o estilo e a tira dois quadros depois, uma vez por página (a mesma troca do tema). O hover e o toque continuam em 150 ms nos dois sentidos; o motivo de desativar antes de hidratar continua | e2e `conta-layout.spec.ts`, "nada transiciona quando o formulário fica ativo, e o hover ainda anda nos dois sentidos" (o `transitionrun` contado desde a abertura da `/entrar`: zero; e no desktop o hover dispara a transição da cor de fundo na ida e na volta). Vermelho: 4 transições na hidratação |
| **7.** "Decisões \| Carteiras" pareciam abas | Abas de verdade, do servidor, como o filtro do feed: `?vista=decisoes\|carteiras`, no desenho do `.segmentado`, com o `aria-current="page"` na escolhida; abaixo de 1280 px o CSS mostra só a vista escolhida (o padrão, e o valor que não é um deles, é a das decisões), e a partir de 1280 px as duas, com as abas escondidas. Sem JavaScript novo e sem o segmentado da Arc. Sozinha, a barra das carteiras vem logo abaixo das abas (as classes escolhidas no servidor) | e2e "as abas mostram uma vista por vez pela URL, e a partir de 1280 px as duas" e "sem JavaScript: as abas são links, e a vista vem pronta do servidor". Vermelho |
| **8.** O "Mais antigas" na primária | A pílula cinza (`.btn`), na arena e nas notícias | e2e "a paginação 'Mais antigas' é a pílula cinza, e não a primária". Vermelho |
| **9.** Duas primárias "Lançar compra" na carteira | O atalho da coluna do resumo (e o da carteira vazia) é a pílula cinza; a primária fica no envio do formulário | Unidade (`wallet-panels.spec.tsx`) e as capturas |
| **10.** A data do cursor por cima do rótulo do eixo | O rótulo que a pílula do cursor cobriria sai da frente pelas duas caixas em px (`rotuloCoberto`, no `lib/chart.ts`), e não pela distância entre os pontos de âncora (o rótulo da ponta direita vai de x − largura a x) | Unidade, `rotuloCoberto` (vermelho: a função não existia) |
| **11.** A série que a legenda mostra só esmaecia | Ela se desenha da esquerda para a direita, num recorte que cresce em 250 ms (a animação `linha-desenha`, do CSS, num caminho novo a cada volta, decidido durante a renderização: nenhum quadro mostra a linha inteira antes de começar); com movimento reduzido, a regra global troca na hora. O retângulo de recorte do Motion, que não andava, saiu | e2e "a série que a legenda mostra se desenha da esquerda para a direita, em 250 ms" (o `animationstart` da série, com a duração de 250 e o recorte que começa fechado na direita); o de movimento reduzido confere que ela aparece inteira na hora. Vermelho |
| **12.** O selo "[ok] fechado" no verde, com borda | A etiqueta cinza sem borda (a do "simulado"), com o texto na tinta, para as três situações | e2e "a situação do ciclo é a pílula cinza sem borda, com o texto na tinta". Vermelho |
| **13.** O cabeçalho do site sem o movimento do resto | A `.pill` e o `.chip` com o fundo em 150 ms e o toque a 0,96, como o botão (as pílulas desativadas do chat não encolhem), e os links do cabeçalho com a cor em 150 ms | e2e "em 1280 px os links e a pílula 'Entrar' do cabeçalho andam em 150 ms, e a pílula encolhe no toque". Vermelho: `all 0s` |
| **14.** O clique fora do menu "Mais" no desktop segue o link | Fica como está (o comportamento comum de um menu curto; no celular a folha cobre a tela inteira), anotado no `docs/TELAS.md`, seção 3 ("As folhas") | — |
| **15.** O anel do cartão da ponta embaixo do "›" | `scroll-padding-inline: 3.5rem` na faixa, com o mouse: a rolagem que leva o cartão focado à vista deixa livre a largura do botão | e2e da faixa (`layout.spec.ts`): o `scroll-padding-inline-end` com pelo menos 52 px. Vermelho |
| **16.** "Resultado %" em duas linhas | O "%" à vista ao lado do "Resultado" (o nome inteiro para o leitor de tela), como o "P&L %" do Rallies; o cabeçalho sem quebra | O e2e do achado 1 confere o cabeçalho numa linha |
| **17.** Os nomes em duas e três linhas nas tabelas do ranking | O nome curto também nas referências e o nome numa linha em toda largura (a tabela rola, com a pista do achado 4) | e2e "em 390 px o nome de cada competidor fica numa linha, inclusive o das referências". Vermelho |

## 4. O que as tarefas deixaram para o fechamento

- **Os logos na justificativa da landing**: a landing lê o índice dos logos (`versoesDosLogos`, em paralelo com as outras leituras; uma hora no cache
  de dados, e a falha vira os monogramas) e passa ao `DecisionCard`. O e2e da landing confere o logo de cada ordem (a imagem nos dois papéis com logo
  do seed, o monograma nos outros).
- **O `semVersao`** saiu; a faixa dos laboratórios usa o `partesDoNome` (o M14).
- **A seção 6 do `docs/TELAS.md`** cita o `e2e/logos.spec.ts`, e ganhou o bullet do que o `arena.spec.ts` confere desde o fechamento.
- **As capturas da landing de novo**, com as peças da T1a já entregues: `docs/redesign-premium/depois/landing-*` (o hero, a página inteira, nos dois
  tamanhos e nos dois temas).

Ficaram de fora, como a especificação mandou: o arquivo do logo do Artur, o `LOGO_MAX_BYTES` no contrato, o volume das velas, a leitura das quatro
cotações pelo cursor, as referências do gráfico da arena à vista na abertura, o chat de verdade e o `loading.tsx` com o esqueleto.

## 5. O que mudou nos documentos

- **ADR 0037**: a lista "Muda" ganhou o "simulado" uma vez por contexto; a tabela tem a coluna "Instalada agora" de cada peça (o uso de cada uma),
  a linha do segmentado e a do esqueleto com "copiada e retirada em 05/11/2026 por falta de uso; volta do registro quando uma tela pedir", a linha
  nova "Termo com explicação", a das velas como só o visual de servidor, a do toast que troca na hora, a da tabela com a pista e as colunas fixas do
  ranking; o parágrafo das peças instaladas diz o que saiu e que o `docs:check` confere o código copiado; a seção 2 lista só os nomes que alguém lê
  e diz o que saiu (o `@theme inline`, o `dark:`); a seção 3, o `data-theme` que saiu; e uma "Nota de 05/11/2026 (o fechamento da onda)".
- **ADR 0035**: uma linha na nota de 05/11/2026, o "simulado" uma vez por contexto (a decisão 5 mudou pelo 0037).
- **`docs/DESIGN.md`**: a elevação sem a sombra de repouso; as três pastas das peças e o `docs:check`; o botão que fica ativo sem transição na
  hidratação, a pílula e o chip que andam, a paginação cinza; o segmentado e as abas do servidor (as vistas da arena), sem a peça da Arc; a caixa de
  marcar, o radio novo e o termo; a tabela com a pista e o nome numa linha; os gráficos que se leem pelo teclado; o tooltip que não abre no toque;
  o esqueleto, que saiu; a linha que se desenha e o esmaecer ligado à rolagem, no movimento.
- **`docs/TELAS.md`**: a linha da `/arena` (as vistas, o "Mais antigas"), a do ciclo (a situação), a da carteira (a única primária, o radio, o termo);
  a seção 3 (a pista das tabelas, as colunas do ranking, a compacta da landing, a altura em px dos gráficos, a tabela equivalente, o toque fora e a
  rolagem que fecham a leitura, a data do cursor, a linha que se desenha, o gráfico de posições que abre no fim, a etiqueta das velas, o radio, o
  "simulado" e a nota do QA 14); a seção 6 (o `logos.spec.ts` e o que o `arena.spec.ts` confere desde o fechamento); e a seção 10 (o `data-theme`,
  as peças `radio`, `segmentado`, `tabela`, `termo`, a situação do ciclo, o `CAIXA` que saiu, o `.dica` e o `.painel-velas` que saíram).
- **`CLAUDE.md`**: a regra 1 cita o componente copiado de registro e o que o `docs:check` confere; o script do tema põe `data-tema` e a classe
  `dark`; a lista das peças (sem o esqueleto, com o termo com explicação); e o "simulado" uma vez por contexto.
- **`docs/DEPENDENCIAS.md`**: a linha do `@opentelemetry/api` (o par opcional do `next` no site, o M17); a linha da Arc em "Desenho de terceiros"; o
  parágrafo dos componentes copiados (sem o `components.json`, com o que o `docs:check` confere e o que saiu); saíram as linhas do segmentado e do
  esqueleto; e as linhas dos tokens de movimento, do contador, do Line Chart (com o `xy-path`), do Bump Chart, do toast e do select nativo dizem o que
  o fechamento mudou.
- **`relatorios/explorar.md`**: a frase da primária no trilho (o M15).

## 6. Os comandos e os resultados

Todas as execuções pesadas rodaram com a trava (`.data/trava-pesada`, dono `t4-fechamento`, das 19:30 às 19:31, das 19:54 às 20:01, das 20:15 às
21:33; solta no fim), com o disco entre 52 e 57 GB livres (o piso é 6), o Node 26.13 do nvm, o `az` falso no `PATH` e a guarda de rede
(`NODE_OPTIONS=--import .data/guardas/net-guard.mjs`, `NET_GUARD_LOG=.data/guardas/t4-fechamento-rede.log`, com os avisos de versão do pnpm, do
turbo e do Next desligados).

**O vermelho antes dos consertos** (o build das 19:30, com o código daquela hora e o aviso sem o conserto do I2):

| O quê | Resultado |
|---|---|
| Os e2e novos no desktop | 24 falharam, 14 passaram, 1 pulado: cada falha pelo motivo do achado (a página rolando 17 px em 360 px, o eixo das velas a 22,2 px da grade, 4 transições na hidratação, `auto` no lugar de `fixed`, o `[ok] fechado` com borda de 1 px, o `all 0s` do cabeçalho, o aviso que não sumia, a série sem animação de desenho, as abas sem `aria-current`, os nomes em duas linhas...) |
| Os de toque no pixel-7 e no iphone-15 | 2 falharam em cada (a leitura que não fechava; o radio) e 9 passaram (o do M12 entre eles: não se reproduz) |
| Unidade | o `docs-check.test.mjs` (4 de 5), o `tokens.spec.ts` (30 nomes sem leitor; 2 cores cruas), o `theme-selector.spec.tsx` (1), o `wallet-client.spec.ts` (1), o `competidor.spec.tsx` (2), o `chart.spec.ts` (2), o `components.spec.tsx` (o M18 e a altura das velas, 2; o elenco parcial, 1; as molas, 1) |

**A prova final** (o código final; o build das 21:10):

| O quê | Comando | Resultado |
|---|---|---|
| `pnpm check` | `TEST_DATABASE_URL=…/alvesting_t4_test`, o Azurite do compose, `pnpm check` (21:08 a 21:10) | **exit 0**: o lint e "All matched files use Prettier code style!"; os tipos; os testes: os contratos 13 arquivos e 501 testes, o site **50 arquivos e 919 testes**, a api 154 arquivos (2 pulados) e 3.153 testes (9 pulados), os `scripts/*.test.mjs` **136, 0 falha**; o `docs:check` com **91 itens** |
| `pnpm build` | o monorepo (21:10) | **exit 0**, os 4 pacotes (3 do cache). Os 10 avisos de CSS são todos do `::scroll-button()` (o Lightning CSS não conhece o pseudo-elemento): eram 6, da faixa, e as tabelas somaram 4; as regras saem no CSS final (conferido) |
| O e2e inteiro, os seis projetos, um por vez, com 1 worker | `pnpm --filter @alvesting/web exec playwright test --workers=1 --project=<projeto>` (21:10 a 21:29) | **pixel-7: 517 passaram, 17 pulados** (3,9 min); **iphone-15: 517, 17 pulados** (5,4 min); **desktop: 530, 4 pulados** (4,2 min); **pixel-7-escuro: 161, 1 pulado** (1,4 min); **iphone-15-escuro: 161, 1 pulado** (2,0 min); **desktop-escuro: 162** (1,4 min). **Nenhuma falha.** Os pulados são os de sempre (o login do smoke nos três claros; nos de toque, os de teclado e de mouse; no desktop, os de toque) e os novos pelo mesmo motivo: o do aviso com o ponteiro e o do cabeçalho com o mouse, pulados nos de toque, e o da leitura pelo toque, pulado no desktop. Contra a T2b (511 e 3; 498 e 16): +19 testes em cada projeto claro; a confiança explicada saiu de "só desktop" e roda nos três |
| O tema três vezes | `playwright test --workers=1 --project=desktop e2e/tema.spec.ts` (21:29) | **11 passaram, as três vezes**; e o teste da corrida (`tema.spec.ts:80`) com `--repeat-each=10` (20:43): **20 passaram** |
| Lighthouse | `pnpm lighthouse` (21:30 a 21:31) | **exit 0** (as asserções vazias): seção 7 |
| Ensaio | `ENSAIO_DATABASE_URL=…/alvesting_t4_fechamento_ensaio pnpm --filter @alvesting/api arena:ensaio` (21:31) | **exit 0**, "RESULTADO: OK"; o `.data/ensaio/relatorio-s1-p5.txt` (22.068 bytes) com o SHA-256 **`081d860b31b6c69997424d92beacc190eefed498835b61e2ebe9b442d8891f12`** |
| As capturas | um spec temporário (`e2e/zz-capturas-t4.spec.ts`, posto e tirado; no desktop) (21:32) | 2 testes, **52 PNG** em `docs/redesign-premium/depois/` (seção 8) |
| O `az` falso | `wc -l .data/guardas/az-stub/calls.log` | **0 linha** antes e depois |
| A guarda de rede | `.data/guardas/t4-fechamento-rede.log` | **8 linhas, todas bloqueadas**: `TCP registry.npmjs.org`, uma por `next build` que compilou (a conhecida das regras comuns: a checagem do próprio pnpm, sem origem no código). Nenhum teste, servidor ou código do site tentou rede |
| Os bancos | `DROP DATABASE … WITH (FORCE)` no `alvesting-postgres-1` | `alvesting_t4_test` e `alvesting_t4_fechamento_ensaio` apagados; nenhum `alvesting_verify_*` sobrou. Ficaram, como os testes os deixam de propósito: o `alvesting_recreate_test` (o `database-admin.spec.ts` o recria a cada execução e não o apaga, para não forçar um checkpoint a mais) e o `alvesting_e2e_test` (o e2e o recria a cada subida). O `alvesting_ensaio` da demo é o de 04/11, intocado |
| Os servidores | `lsof` nas portas 4301 a 4339 | nenhum meu de pé (só a api da demo, na 4310) |

Rodei a prova inteira duas vezes: a primeira (20:15 a 20:46) passou toda, mas depois dela, olhando as capturas, ajustei a tabela compacta da landing
(o logo ficava sozinho numa linha acima do nome) e o respiro da vista das carteiras, e o CSS tinha passado 19 B do da T2b no fio; enxuguei (as classes
escolhidas no servidor, os utilitários que já existiam) e refiz tudo do zero no código final, que é o que a tabela acima mede.

## 7. O Lighthouse e o peso da landing

`pnpm lighthouse` (5 coletas, mediana; o Lighthouse do projeto no celular simulado), às 21:30, no build final:

| | A T2b (17:45, o relatório dela) | **O fechamento (21:30)** |
|---|---|---|
| LCP, mediana (coletas) | 2.416 ms (2.408 a 2.422) | **2.422 ms** (2.413 a 2.519; a de 2.519 é a primeira, a do aquecimento) |
| CLS | 0 | **0** |
| TBT, mediana | 19,5 ms | **20,5 ms** |
| FCP, mediana | 906 ms | 906 ms |
| exit do `lhci` | 0 | **0** |

- **O elemento do LCP** é o mesmo nas 5 coletas e na T2b: o parágrafo do hero (`main.mx-auto > section.grid > div.grid > p.text-15`). O teto de
  2,5 s e a meta interna de 2,45 s passaram; a diferença para a T2b (6 ms) está no ruído da máquina (a rodada da prova anterior, no mesmo código
  menos os dois ajustes, deu 2.411 ms). Sem A/B: a regra comum o pede só para a reprovação por menos de 50 ms.

O que a landing baixa (a coleta mediana; no fio e cru; 22 pedidos nos dois):

| Recurso | A T2b | O fechamento | No fio |
|---|---|---|---|
| CSS (o arquivo único) | 16.178 B / 93.211 B | **16.156 B / 93.063 B** | **−22 B** |
| Documento (o HTML e o payload do React) | 39.477 B / 171.123 B | **39.492 B / 170.945 B** | +15 B |
| JavaScript (10 arquivos) | 151.773 B / 478.769 B | 151.862 B / 479.229 B | +89 B |
| Imagens (9) | 14.575 B | 14.575 B | 0 |
| **Total** | 222.740 B | **222.822 B** | +82 B |

- **O CSS ficou menor**: saíram os 30 nomes das bibliotecas sem leitor, o `.dica`, o `.painel-velas`, as abas grandes, o glifo do radio, a sombra de
  repouso e a regra repetida do menu, e entraram a pista das tabelas, o botão "›" delas, as vistas da arena, a linha que se desenha, o radio novo, o
  movimento das pílulas e o `--fatia-6`.
- **O documento** subiu 15 B no fio e caiu 178 B crus (os logos das ordens da justificativa, os nomes curtos, o `data-theme` que saiu do script do
  tema).
- **O JavaScript** subiu 89 B no fio: é o espaço do logo no `PageHead` (o título da página do modelo, o achado 5 do QA), que vai nos pedaços das
  telas de erro, componentes de cliente que importam o `PageHead` e que a landing baixa. Nenhuma biblioteca entrou, e nada acima da dobra.

## 8. As capturas

**52 PNG em `docs/redesign-premium/depois/`, 11.760 KB**, tiradas do build final no banco sintético do e2e, com o tema do sistema (os dois), o
movimento reduzido (a arte no quadro 0 e a fita parada) e as fontes prontas; as de 390 × 844 com o toque ligado (`isMobile`), as de 1440 × 900 no
Chrome do desktop:

| Tela | O que mostra do fechamento | Arquivos (cada um nos dois temas) |
|---|---|---|
| Landing (`/`) | os logos na justificativa, a faixa dos laboratórios com o nome curto, a tabela compacta inteira no celular, as peças da T1a | `landing-390-*`, `landing-1440-*`, e a página inteira, `landing-*-inteira` |
| Arena (`/arena`) | as abas "Decisões \| Carteiras" no celular; as duas vistas lado a lado em 1440 | `arena-390-*`, `arena-1440-*`, e a vista das carteiras, `arena-carteiras-390-*` |
| Ranking | as três tabelas alinhadas, a borda que esmaece com o "›", os nomes numa linha, o gráfico de posições aberto no fim com os nomes inteiros, o "%" das carteiras | `ranking-390-*`, `ranking-1440-*`, e a página inteira |
| O modelo (DeepSeek) | o título numa linha, com o logo ao lado | `modelo-deepseek-390-*`, `modelo-deepseek-1440-*` |
| O ciclo | a situação na etiqueta cinza sem borda | `ciclo-390-*`, `ciclo-1440-*` |
| Explorar | as regras do universo à vista, a frase do cartão simulado | `explorar-*-inteira` |
| A ação (MOVE3) | a confiança explicada no texto, as velas | `acao-390-*`, `acao-1440-*`, e a página inteira |
| Notícias | o "Mais antigas" na pílula cinza | `noticias-*-inteira` |
| A carteira (três lançamentos) | o radio novo, o "Lançar compra" do resumo na pílula cinza, o termo com o sublinhado | `carteira-390-*` (e a página inteira), `carteira-1440-*` |

As telas cujo conserto não se vê numa foto parada (o botão que não esmaece na hidratação, o aviso da exportação, o movimento do cabeçalho do site,
o toque fora do gráfico) não ganharam captura: os testes da seção 3 os provam.

## 9. Os testes que mudaram de expectativa, com o motivo

- `e2e/tema.spec.ts`: o `data-theme` agora é nulo (saiu do script: nenhuma peça o lia, o M6); a troca e a mudança do sistema são esperadas (o I6).
- `src/components/beui/theme-selector.spec.tsx`: os casos do `data-theme` conferem a classe `dark` (o M6).
- `src/app/tokens.spec.ts`: o teste dos nomes das bibliotecas não tem mais a lista fixa de cada uma; cada nome do `:root` precisa de leitor e de um
  token (o M6), e há os dois casos da Regra do Token (o M7).
- `src/components/logo-do-papel.spec.tsx`: as classes do círculo e do contorno são as dos tokens novos (a mesma cor; o M7).
- `src/components/arc/arc.spec.tsx`: saíram os casos do segmentado e do esqueleto (as peças saíram; o M1).
- `src/components/components.spec.tsx`: a nota "simulado" vem antes da casca nova da tabela (`.tabela`, a do "›"; o QA 4); o universo sem o
  `termo` e com as regras à vista (o M9); o `layoutVelas` sem a altura (o M14).
- `src/lib/chart.spec.ts`: o teste passa a margem do desenho (o `layoutEquity` não tem mais a padrão; o M14).
- `src/components/arena/carteiras.spec.tsx`: o `ratioBps` vem do `lib/chart.ts` (o M14).
- `src/components/competidor.spec.tsx`: o `partesDoNome` devolve `resto` (o sufixo de versão ou o resto do nome de uma referência; era `versao`).
- `src/components/wallet-panels.spec.tsx`: o atalho "Lançar compra" é o `btn` (o QA 9), e o termo aceita as classes do botão (o M8).
- `e2e/arena.spec.ts`: as carteiras da arena se leem na `?vista=carteiras` (abaixo de 1280 px é a outra vista; o QA 7); o movimento reduzido confere
  o recorte do CSS e as etiquetas, no lugar do retângulo do Motion (o QA 11 e o M11).
- `e2e/carteira.spec.ts`: o desenho do radio (a seção 2).
- `e2e/carteira-layout.spec.ts`: o alvo do radio é medido pelo rótulo (a seção 2).
- `e2e/conta.spec.ts`: a frase do aviso da exportação (o M16).
- `e2e/explorar.spec.ts`: o balão do universo e o da confiança saíram, e as explicações são conferidas no texto (o M9).
- `e2e/fixture.spec.ts`: as carteiras vazias da api falsa se leem na `?vista=carteiras` (o QA 7).
- `e2e/carteira.spec.ts`, `e2e/explorar.spec.ts` e `e2e/arena.spec.ts`: as contas de "nenhuma animação rodando" com movimento reduzido não contam a
  animação ligada à rolagem (a pista das tabelas, o QA 4): ela não anda no tempo, só acompanha a rolagem, e o navegador a lista como "rodando" mesmo
  parada.
- `src/components/hero.spec.tsx`: só o nome de um teste ("a pílula primária", o M15).

Nenhum teste foi pulado de novo fora dos pulos por projeto de sempre, nenhum `.only`, nenhuma asserção afrouxada.

## 10. Os arquivos tocados

**O site** (`apps/web`):

- Telas: `src/app/(site)/page.tsx` e `page.spec.tsx`; `src/app/(app)/(arena)/arena/page.tsx`, `modelos/[slug]/page.tsx`, `ciclos/[data]/page.tsx`;
  `src/app/(app)/(explorar)/explorar/page.tsx`, `acoes/[ticker]/page.tsx`, `noticias/page.tsx`; `src/app/(app)/(conta)/conta/page.tsx` (comentário);
  `src/app/layout.tsx` (comentário); `src/app/globals.css`; `src/app/tokens.spec.ts`.
- Componentes: `src/components/arc/arc.spec.tsx`, `arc/lib/motion-tokens.ts`, `arc/animated-counter/animated-counter.tsx` e `.module.css`,
  `arc/tooltip/tooltip.tsx`; **removidos** `arc/segmented-control/` (o `.tsx` e o `.module.css`) e `arc/skeleton/` (os dois);
  `src/components/beui/line-chart.tsx`, `bump-chart.tsx`, `animated-toast-stack.tsx`, `theme-selector.tsx`, `theme-selector.spec.tsx`, `xy-path.ts`;
  `src/components/reui/native-select.tsx`; `src/components/arena/carteiras.tsx`, `carteiras.spec.tsx`, `explorar.tsx`, `pagina.tsx`;
  `src/components/landing/paineis.tsx`, `laboratorios.tsx`; `src/components/competidor.tsx`, `competidor.spec.tsx`, `tables.tsx`, `ui.tsx`,
  `velas.tsx`, `components.spec.tsx`, `logo-do-papel.tsx`, `logo-do-papel.spec.tsx`, `wallet-charts.tsx`, `wallet-panels.tsx`,
  `wallet-panels.spec.tsx`, `form-kit.tsx`, `account-forms.tsx`, `error-page.tsx` (comentário), `hero.spec.tsx` (nome de teste).
- Lib: `src/lib/chart.ts`, `chart.spec.ts`, `wallet-client.ts`, `wallet-client.spec.ts`.
- e2e: `e2e/arena.spec.ts`, `landing.spec.ts`, `carteira.spec.ts`, `carteira-layout.spec.ts`, `conta.spec.ts`, `conta-layout.spec.ts`,
  `explorar.spec.ts`, `layout.spec.ts`, `quotes.spec.ts`, `tema.spec.ts`, `fixture.spec.ts`.

**Os scripts**: `scripts/docs-check.mjs`, `scripts/docs-check.test.mjs`.

**Os docs**: `CLAUDE.md`, `docs/DESIGN.md`, `docs/TELAS.md`, `docs/DEPENDENCIAS.md`, `docs/adr/0037-bibliotecas-de-design.md`,
`docs/adr/0035-design-do-rallies-ai-nos-dois-temas.md`, `docs/redesign-premium/relatorios/explorar.md` (uma frase),
`docs/redesign-premium/relatorios/fechamento.md` (este) e `docs/redesign-premium/depois/` (as 52 capturas, novas).

Não toquei: o `apps/api`, o `packages`, o `pnpm-lock.yaml`, o `pnpm-workspace.yaml`, o `apps/web/package.json`, os textos legais e a demo
(conferido pela data dos arquivos: desde as 18:54, sob o `apps/api` só mudou o `dist/`, que o `pnpm build` regrava e o `.gitignore` deixa fora do
git; o `.data/ensaio/relatorio-s1-p5.txt` foi regravado pelo ensaio com o mesmo SHA-256). Fora do
repositório (o scratchpad da sessão) ficaram os scripts de comparação do lockfile e da regra das cotações, o spec das capturas e os logs das
execuções.
