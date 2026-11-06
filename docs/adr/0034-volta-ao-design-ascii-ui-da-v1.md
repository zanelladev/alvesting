# ADR 0034: A volta ao design ascii-ui da v1, com o código da v2

- **Status:** aceita
- **Data:** 04/11/2026
- **Origem:** o pedido do Artur ("Eu quero o design ASCII antigo, a landing antiga tava muito bonita, principalmente Hero"); `docs/PLANO.md`, §17, item 7 ("estética crua do Alpha Arena (recomendo) ou ascii-ui da v1"); o plano do porte, `docs/redesign-ascii/plano.md` (a tarefa T0, que leu a v1 e a v2); as decisões do coordenador da onda sobre a seção 8 dele

## Contexto

A v2 nasceu com a **estética crua** do Alpha Arena (o §17, item 7, do plano a recomendava): papel creme, tinta preta, bordas pretas de 1 a 2 px, IBM Plex Mono nos títulos e números e Plex Sans no texto, sem gradiente, sombra, animação nem ilustração. Funcionava e media bem (o LCP simulado da home em 2,34 s, `docs/TELAS.md`, seção 5), mas não é o que o Artur quer mostrar. A v1 (o worktree `feat-redesign`, commit `cddd320`, "Redesign ascii-ui: as 14 telas no tema novo") tinha um sistema visual próprio, o **ascii-ui**: o canvas preto, a cápsula de navegação centrada, a pílula branca do CTA, a moldura de linhas laterais e, no hero, uma escadaria em ASCII com a brasa em âmbar, sangrando à direita e embaixo, com a fita de cotações no pé.

O que a v1 fazia **não cabe como está** nas regras da v2: os componentes do Arc (uiarc.dev) que ela copiou importam `motion` e rodam no cliente, e o título do hero nascia invisível até hidratar; a arte era de cliente (o `<pre>` vazio no HTML, o JSON de 2,9 MB cru buscado e analisado na thread principal, o tamanho calculado num efeito); as três fontes variáveis somavam 118 KB; a navegação lia o caminho num componente de cliente. Somado, o hero da v1 reprovaria o portão de LCP de 2,5 s no celular. E ela tinha artes de procedência fraca (a estátua de Wall Street, um modelo do Sketchfab sem licença) e o logo dos laboratórios ao lado dos modelos.

## Decisão

**Volta o visual da v1; fica o código da v2.** O resumo do plano do porte (seções 1 a 4):

1. **O sistema visual** mora no `@theme` de `apps/web/src/app/globals.css`, a fonte única (os tokens da v1: o canvas `#000`, as superfícies em degraus, as linhas de 1 px, a tinta `#f5f5f5`, `#a3a3a3` e `#8a8a8a`, o âmbar `#ffb000` só como acento, as cores de dado com glifo e sinal, os raios do Arc). As classes que os testes e o tamanho do documento usam ficam com o mesmo nome e mudam de cara (`link`, `btn`, `field`, `check`, `radio`, `tbl`, `th`, `td`, `row`, `muted`); entram `btn-primary` (a pílula branca, uma por superfície), `pill`, `chip`, `badge`, `card`, `vazio`, `rule`, `capsule`, `tape` e a arte. O foco do teclado é o contorno sólido de 2 px, agora âmbar. A regra global de movimento reduzido para tudo no quadro de partida. As regras que valem para toda tela estão em `docs/TELAS.md`, seção "Sistema visual (ascii-ui)".
2. **Fontes: a Geist só no 500**, pelo `next/font`, com preload (títulos, números grandes, botões, a cápsula, o negrito); **o texto e a mono são as fontes do sistema**. Um peso só faz o Google servir a fonte estática, e não a variável (o dobro do tamanho). O plano previa a Inter 400 no texto: ela saiu na medida do Lighthouse (abaixo, "As fontes e o LCP"). A JetBrains Mono da v1 fica fora: um texto qualquer da home nela faria o navegador pedi-la no primeiro layout.
3. **O Arc (MIT) é referência de medida, não código copiado.** As peças (a cápsula, a pílula, os botões, o hero, a faixa de números, o badge, o vazio) são refeitas em CSS como Server Components, nas medidas do Arc; nenhum arquivo dele, nenhum `motion`, nenhum `lucide-react`. **Nenhuma dependência npm nova.**
4. **O hero da v1 com o texto da v2**, num componente de servidor sem entrada animada (o título nasce visível). **A arte é arquivo, e o código só troca o quadro**: o servidor manda o quadro 0 da escadaria inteiro no HTML, com a brasa (o sprite do quadro 0, um PNG de 3.856 B que o CSS pede; sem `preload`, pela medida do LCP abaixo), e o tamanho sai do CSS (`font-size: max(100cqw / colunas, 100cqh / linhas)`, o `cover` sem `ResizeObserver`; a célula de 1 em em qualquer mono, `letter-spacing: calc(1em - 1ch)`). O laço (o arquivo inteiro, 58 KB de JSON e 325 KB de sprite no fio) só toca a partir de 1024 px, sem `prefers-reduced-motion` e sem Save-Data, depois do `load` (`arte-viva.tsx`, o único JavaScript da arte). Sem canvas e sem shader.
5. **A fita** do pé do hero é CSS (`@keyframes` com `steps()`, um caractere por passo), decorativa, com o mesmo dado em `sr-only` (o fechamento e o sinal de cada papel, sem o glifo: o sinal já diz a direção). Ela lê a rota interna do universo (`GET /api/v1/interno/fita`, a `a0` desta onda, com o mesmo segredo da rota das barras): os papéis do universo da semana do último ciclo, os que o briefing deu a todos os modelos, até os 40 de maior volume (`TAPE_LIMIT`, `lib/fita.ts`), com o fechamento do último pregão até o do ciclo que tem a cobertura do briefing (80% do universo com barra: no meio da carga do fim do dia a fita fica no pregão anterior), e a legenda "Os mesmos N papéis da B3, lidos por todos os modelos. Cotações: brapi.dev, pregão de …". Sem ciclo, sem universo ou sem pregão com a cobertura (a resposta vazia), e também quando a rota falha (a falha vai para o log do servidor, e a home não cai: a fita é enfeite), ela mostra o que a home já lê, o BOVA11 e o macro do Banco Central, e a legenda diz isso ("O mesmo briefing para todos os modelos: o BOVA11 e o macro do Banco Central. Cotações: brapi.dev, pregão de …").
6. **O menu**: a cápsula a partir de 1024 px; abaixo disso, uma folha `popover` nativa aberta pelo botão "Menu" (44 × 44, os traços viram um ✕), sem JavaScript. A folha vai até o pé da tela, e o resto dela, embaixo dos links, é o botão "Fechar o menu": o toque ali fecha a folha sem chegar à página de baixo (o toque fora de um `popover` fecha e segue para o que está embaixo), e a página sai de vista e da ordem do Tab enquanto a folha está aberta (o foco não some atrás dela); o Esc também fecha. Sem `popover` (o Safari antes do 17, o Firefox antes do 125), os links ficam em linha no cabeçalho, que deixa de ficar preso no topo. A casca (o cabeçalho, a moldura, o rodapé) não tem componente de cliente; a moldura são duas linhas de 1 px, e não uma caixa por cima da coluna (que deixava o axe sem o fundo de todo o texto).
7. **As decisões da seção 8 do plano** (os padrões recomendados, tomados pelo coordenador; o Artur pode mudar depois): a arte da escadaria entra agora, com a pendência dos termos do Higgsfield (abaixo); a JetBrains Mono fica fora; a rota interna da fita entra, por outra tarefa; o menu em `popover`; as peças de cabeçalho da v1 (moeda, ampulheta, envelope, sino) ficam fora; nenhum logo de laboratório (o nome e a etiqueta "simulado" bastam); a skill `ascii-ui` vem adaptada para `.claude/skills/ascii-ui/`, só com texto.

## Consequências

- **As fontes e o LCP.** Com o plano como estava (a Geist 500 e a Inter 400 com preload, o CSS dentro do HTML e o sprite do quadro 0 com `preload` de alta prioridade), o `pnpm lighthouse` reprovou: LCP de 2.608 ms na mediana (2.590 a 2.637), o documento da home com 57,8 KB no fio, porque o CSS novo (uns 9 KB comprimidos) ia três vezes nele. O elemento do LCP é o parágrafo da descrição do hero (texto), e não a arte. Medido variante por variante (um proxy que mudava o HTML, com o Lighthouse direto contra ele), o que move o valor ruim da simulação não é o conteúdo da home (só o hero dá o mesmo), e sim os pedidos de alta prioridade que o Lantern conta como bloqueantes: as fontes e o sprite com preload. Duas mudanças, juntas: **a Inter saiu** (o texto vai na fonte do sistema: SF no Apple, Roboto no Android, Segoe no Windows; a saída 2 do plano previa tirar a Inter) e **o sprite do quadro 0 perdeu o `preload`** (o CSS o pede; a imagem é de baixa entropia e não vira candidata ao LCP quando chega). O CSS foi para arquivo (sem o `experimental.inlineCss`): o documento caiu para 30,5 KB. Resultado: **LCP de 2.394 ms na mediana** (2.377 a 2.482), CLS 0, TBT de 93 ms, 14 pedidos e 205 KB (antes do redesenho, 215 KB); a brasa continua no celular. Os números e as variantes estão em `docs/TELAS.md`, seção 5. Se o LCP passar de uns 2,45 s de novo, as saídas seguintes do plano (seção 4.6) são o celular sem a brasa, um recorte da arte para o celular e, por último, sem arte abaixo de 640 px.
- **A arte e a procedência.** Entram `escadaria.json` e `escadaria.png` (copiados do commit `cddd320` da v1) e os dois `-q0` derivados deles (o apêndice abaixo); cada um tem uma linha em `docs/DEPENDENCIAS.md`, "Artes". A cadeia: a imagem `touro-escadaria.jpg` (Higgsfield Soul 2, request `c2f915e3-f894-43cd-93a2-5eed2ffadfe3`, 27/09/2026) virou o vídeo `touro-escadaria.mp4` (Kling 3.0, request `57013ba6-52bd-45c2-9b6b-853ce2b62234`, primeiro quadro igual ao último), e o gerador do Artur (`packages/config/ascii-arte.py` da v1) o converteu na grade com brasa. Nenhum prompt nomeia obra, marca, lugar ou pessoa. **Pendência do Artur antes de publicar o repositório:** conferir a versão vigente dos termos da API do Higgsfield (a v1 deixou escrito "uso comercial permitido pelos termos da API, help center, 'What Is the Higgsfield API'; conferir a versão vigente antes de publicar"). Se os termos não permitirem, as artes saem e o hero fica com a composição sem a imagem. O gerador não vem: nenhuma arte é gerada nesta onda. **O urso da 404** (`urso.json`, `urso.png` e os dois `-q0`, da tarefa das telas da arena) tem a mesma cadeia e a mesma pendência: a imagem `urso-colunas.jpg` (Soul 2, request `672c8016-…`) virou o vídeo `urso-colunas.mp4` (Kling 3.0, request `0a54ba8c-…`), os dois de 27/09/2026, com as linhas em `docs/DEPENDENCIAS.md`, "Artes".
- **O hero se adapta à largura para a arte nunca ficar atrás de texto.** O aviso da arena simulada (a T1, com o mesmo texto) deixou o texto do hero mais alto que o da v1. A partir de 1024 px a arte é o fundo do hero inteiro e a grade anda para a direita o bastante para o touro começar depois da coluna de texto (`--deslocar`); abaixo de 1024 px ela vai para um palco logo abaixo dos botões, e só as 56 linhas de baixo da grade aparecem (o touro e a escada). No celular o hero fica um pouco mais alto que a tela (a legenda e a fita logo abaixo da primeira dobra).
- **O menu em `popover` muda testes** (o `getByRole` não acha link escondido): todo spec que usa um link do cabeçalho abre o menu antes, pelo ajudante `e2e/menu.ts`. Os links do menu são `<a>` comuns, e não o `Link` do Next: o cabeçalho é do layout, que não remonta numa navegação suave, e a folha aberta continuaria aberta sobre a página nova. Pelo mesmo motivo (nada de cliente na casca, e o layout não sabe o caminho) a cápsula não marca o item ativo, como a v1 marcava.
- **Os testes que mudaram de expectativa**, e por quê: o h1 da home passa de "Alvesting" a "Modelos de linguagem investindo na B3" (o título do hero; o `<title>` continua "Alvesting"); a regra "o menu cabe em duas linhas em 360 px" virou "o botão Menu tem 44 px, abre a folha com os sete links e o Esc a fecha"; a caixa de marcar e o radio marcados pintam a tinta clara (`rgb(245, 245, 245)`) e o radio vazio, o preto (o glifo, que é a regra, fica); o "Tentar de novo" da tela de erro é a pílula branca. Novos: `e2e/hero.spec.ts`, `src/components/hero.spec.tsx`, `src/lib/ascii.spec.ts`, `src/lib/fita.spec.ts` e a medida dos links do cabeçalho em 1280 px.
- **A arte no celular sem o `preload`**: a brasa chega pelo CSS, logo depois do documento; antes dela o texto da arte é transparente (o glifo veste a tinta do sprite), então a arte aparece inteira quando o PNG de 3,9 KB chega.
- **Espaço é a escala numérica do Tailwind.** Os nomes de espaço da v1 (`xs`, `sm`, `md`, `lg`, `xl`) não entram no `@theme`: no Tailwind 4.3 o `max-w-*` lê `--spacing-*` antes de `--container-*`, e o `max-w-md` dos formulários passaria de 28rem a 20 px. Os valores são os mesmos (base de 4 px).
- **Fica de fora** o que a v1 tinha e a v2 não usa ou não pode ter: os componentes do Arc e o `motion`; o runtime da ascii.rest e as peças animadas de dado; o dither-kit; as peças de cabeçalho; o `Ridge` (a silhueta do Ibovespa antes do rodapé, que obrigaria o layout a ler a api); o logo dos laboratórios; o `loading.tsx` por rota; o link de admin e o status "dados ao vivo" no cabeçalho; e as artes sem procedência (o touro de Wall Street, os laboratórios, as imagens da skill).
- **A migração dos nomes de cor** foi em duas fases: na primeira, `paper` e `band` ficaram como apelidos (marcados com `ponytail:` no `globals.css`) e `ink` e `muted` já valiam os valores novos, para as telas que ainda não tinham sido redesenhadas continuarem usáveis no tema escuro; as tarefas das telas da arena e da conta trocaram os nomes, e o fechamento apagou os apelidos (o `git grep` dos nomes velhos sai vazio em `apps/web/src`), junto com os tokens da v1 que nenhuma tela usa (`surface-card-elevated`, `hairline-soft`, `primary-active`, `on-primary`, `data-benchmark`, as cinco cores de série e os tamanhos `data-*` e `prose-sm`): voltam com a primeira tela que precisar deles.

## Apêndice: como os arquivos do quadro 0 foram derivados

Rodado em 04/11/2026 contra os arquivos copiados do commit `cddd320` da v1. O PNG de saída tem 400 × 120, paleta de 8 bits, 3.856 B; o JSON, um quadro de 24.119 caracteres (1.741 B em gzip -6), depois formatado pelo `prettier --write` do repositório (só a indentação muda).

```sh
A=apps/web/public/ascii/arte
# o quadro 0 no mesmo formato (v2 do gerador), com o sprite do recorte
node -e "const fs=require('fs');const a=JSON.parse(fs.readFileSync(process.argv[1]));fs.writeFileSync(process.argv[2],JSON.stringify({v:a.v,cols:a.cols,rows:a.rows,fps:a.fps,sprite:process.argv[3],frames:[a.frames[0]]}))" "$A/escadaria.json" apps/web/src/arte/escadaria-q0.json escadaria-q0.png
# as primeiras 120 linhas do sprite (as do quadro 0), em paleta: o script abaixo, salvo como q0.mjs
node q0.mjs "$A/escadaria.png" "$A/escadaria-q0.png" 120
```

```js
// q0.mjs: recorta as primeiras `rows` linhas de um PNG de paleta de 8 bits, mantendo o PLTE e o tRNS. Cada linha do PNG começa com o
// byte do filtro, e o filtro só olha a linha de cima: as primeiras linhas do IDAT descomprimido valem como estão.
import { readFileSync, writeFileSync } from 'node:fs';
import zlib from 'node:zlib';
const [src, dst, rowsArg] = process.argv.slice(2);
const buf = readFileSync(src);
let off = 8, ihdr, plte, trns; const idat = [];
while (off < buf.length) {
  const len = buf.readUInt32BE(off), type = buf.toString('latin1', off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
  if (type === 'IHDR') ihdr = Buffer.from(data); else if (type === 'PLTE') plte = data; else if (type === 'tRNS') trns = data; else if (type === 'IDAT') idat.push(data);
  off += 12 + len;
}
const width = ihdr.readUInt32BE(0), depth = ihdr[8], color = ihdr[9];
if (depth !== 8 || color !== 3) throw new Error(`esperava paleta de 8 bits, veio depth ${depth} color ${color}`);
const rows = Number(rowsArg);
const raw = zlib.inflateSync(Buffer.concat(idat)).subarray(0, rows * (1 + width));
ihdr.writeUInt32BE(rows, 4);
const chunk = (type, data) => { const t = Buffer.from(type, 'latin1'); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); };
writeFileSync(dst, Buffer.concat([buf.subarray(0, 8), chunk('IHDR', ihdr), chunk('PLTE', plte), ...(trns ? [chunk('tRNS', trns)] : []), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]));
```

O `e2e/hero.spec.ts` confere, sem JavaScript, que o texto do quadro 0 no HTML é igual ao `frames[0]` do arquivo inteiro.

## Nota de 05/11/2026: a brasa no azul da marca

A onda "design premium" trocou a primária do âmbar `#ffb000` pelo azul do logo, `#14144C` (ADR 0037), e o Artur pediu a mesma escadaria
animada refeita no azul. **A arte continua arquivo** (ornamento pré-renderizado, nunca gerado por código): só a brasa mudou, e só a cor dela.

- **O que mudou**: as cores da paleta (o pedaço `PLTE`) dos quatro sprites de paleta de 8 bits, `escadaria.png`, `escadaria-q0.png`, `urso.png`
  e `urso-q0.png`. Os índices de cada pixel (o `IDAT`), a transparência (o `tRNS`), o cabeçalho e os glifos (os `.json`) são os da v1, byte a
  byte; o tamanho de cada arquivo também (o `PLTE` novo tem o tamanho do antigo, e o CRC dele foi refeito com o `zlib.crc32` do Node).
- **A regra da cor**: cada cor visível vira o tom da escala da primária (a do `globals.css`, do 50 ao 950, a matiz 275,49 em OKLCH, amostrada
  em 8 bits) com a **luminância relativa mais próxima** da dela. O contraste de cada célula com o preto da moldura fica o de antes (o maior
  desvio é de 1,22% na escadaria e 0,93% no urso), e o desenho, o mesmo: o mais claro continua o mais claro, e as sombras continuam sombras.
  Quando duas cores de luminância diferente cairiam no mesmo tom de 8 bits, a mais clara sobe para o tom seguinte da rampa: a ordem nunca se
  inverte nem empata. O preto (o fundo e o vazio da arte) e as entradas transparentes ficam. O resultado vai de uns `#272975` (entre o 800 e o
  900, as sombras mais fundas) a `#dfe4fd` (perto do 100, o claro do touro); as cores mais usadas caem entre o 700 e o 300 (a pedra e os
  degraus), e as do 300 ao 100 ficam no brilho do touro e do urso.
- **O comando**: `node scripts/arte-azul.mjs` (lê a escala do `globals.css` e reescreve os quatro PNG de `apps/web/public/ascii/arte`; rodar de
  novo não muda nada, porque cada tom da rampa é o mais próximo de si). **O teste**, `scripts/arte-azul.test.mjs` (no `node --test` do
  `pnpm test`), prova que só a paleta mudou: o SHA-256 de tudo menos os dados do `PLTE` é o dos arquivos âmbar da v1 (medido antes da troca), a
  paleta nova é a do script aplicado à de antes (as 67 cores âmbar estão no teste), cada cor visível é um tom da rampa, nenhum par de cores
  inverte nem empata a ordem de luminância, o contraste com o preto fica a menos de 3% do de antes, todo pedaço tem o CRC certo e o quadro 0
  tem a paleta do arquivo inteiro (o laço troca um sprite pelo outro no meio da animação).
- **A fita** do pé da moldura saiu da mono para a sans, com os algarismos tabulares do resto do site (a Regra da Sans Única, `docs/DESIGN.md`):
  sem a célula fixa da mono, ela rola contínua, em linha reta, a uns 8 caracteres por segundo, e não mais um caractere por passo (o
  `steps()` da decisão 5). O resto da decisão 5 fica: CSS, decorativa, o mesmo dado em `sr-only`, parada com movimento reduzido.
- **Fica**: o quadro 0 no HTML sem `preload`, o laço só a partir de 1024 px depois do `load`, a moldura escura nos dois temas, a procedência e
  a pendência dos termos do Higgsfield (`docs/DEPENDENCIAS.md`, "Artes", com os blobs novos). A tela dividida das telas de entrar usa a mesma
  escadaria e mudou de cor junto.
