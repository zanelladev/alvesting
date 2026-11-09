# T1: o lançamento da carteira num modal, com as peças da Arc (06/11/2026)

O pedido do Artur, sobre o formulário "Lançar uma compra" da `/carteira`: "Os imput nao tem formatação, nao da pra comprar meia ação,
precisa ser um counter, com - e + tambem, o field de data ta nativo nao usa libs de ui, o imput de reais tambem nao ta formato e falta o
simbolo R$, quero esse lançamento em um modal, clico num botao e aparece o popup para preencher". A especificação é a
`.data/orquestracao/lancamento/t1-lancamento-modal.md`; as regras comuns, a `regras-comuns.md` da mesma pasta.

## 1. O que foi feito

- **O modal** (`apps/web/src/components/wallet-lots.tsx`, `wallet-lots.module.css`): um `<dialog>` do navegador com `showModal()`, um só
  para lançar e para editar, dentro do `WalletLots`. O título (`h2`, "Lançar uma compra" ou "Editar lançamento de 100 MOVE3") dá o nome ao
  modal e ao formulário (`aria-labelledby`). No desktop (de 640 px para cima), centrado, `min(480px, 100vw - 32px)`, raio 16, o canvas e a
  sombra do projeto, 24 px de respiro; no celular, a folha de baixo na largura toda, raio 16 só em cima, até 92dvh, a área segura no pé. O
  corpo rola por dentro; a página atrás não rola (`html:has(.modal[open])`, só CSS). O véu escuro (64 % no escuro, 40 % no claro) com
  desfoque de 2 px. Abre em 250 ms com a saída forte (expo; no desktop sobe 8 px e cresce de 0,97; no celular sobe de baixo) e fecha em
  150 ms, só CSS (`@starting-style` e `transition-behavior: allow-discrete` no `display` e no `overlay`); com movimento reduzido nada se
  desloca. Fecha pelo Esc (o `cancel` nativo), pelo ✕ (44 px, "Fechar") e pelo "Cancelar", com o foco de volta em quem abriu (o `close`
  do `<dialog>` foca o botão que abriu: o WebKit não foca o botão no clique, então a volta nativa do `<dialog>` não bastava); **não fecha no
  clique fora** (o comentário no código diz por quê); com um pedido no ar nada fecha (o ✕ e o "Cancelar" desativados, o `cancel` com
  `preventDefault`). O modal abre dentro do gesto do clique (`flushSync` desenha o formulário certo, o `showModal()` abre e o foco vai ao
  ticker). O rascunho de lançar sobrevive a fechar e abrir de novo, até um lançamento dar certo (a `createKey` sobe e o formulário nasce
  limpo); editar abre sempre com o que está guardado (a chave é o id do lançamento com um contador de aberturas). No sucesso, o modal fecha
  e vale o `done()` de antes (o aviso na pilha, o foco no aviso ao lançar e no "Editar" ao salvar); o 404 da edição fecha e avisa. O cartão
  do lançamento ficou com os dados, o "Editar" (abre o modal) e o "Apagar" (a confirmação no cartão, como antes). A página restaurada do
  cache de ida e volta faz os dois formulários nascerem de novo (os campos moram no React).
- **Quem abre**: a pílula primária "Lançar compra" com o "+" no cabeçalho da seção "Lançamentos", e a pílula cinza na coluna do resumo
  (`WalletSummary` e `WalletEmpty`, de servidor), as duas pelo `BotaoLancar` exportado do `wallet-lots.tsx`, que avisa o `WalletLots` por um
  evento no `window` (`alvesting:lancar`, com o botão no `detail`), sem mudar a árvore da página. Antes do JavaScript ficam desativados
  (`useHydrated`), com um `<noscript>` curto ao lado ("Lançar uma compra precisa de JavaScript."; um `<span>`, para o `noscript p` do e2e
  sem JavaScript seguir único). Saíram o link "Ir para o formulário de lançar" e a seção `#lancar`; a frase da carteira vazia fala do botão.
- **Os campos, nesta ordem**: o Ticker (o `TextField` de antes); a **Quantidade**, o Number field da Arc (`locale="pt-BR"`, `min={1}`,
  `max={1_000_000}`, `step={1}`, sem o `scrub`, começa em 1 ao lançar e na guardada ao editar), com o hidden `name="quantity"`, a dica
  "Ações inteiras: use − e + ou digite." e o limite "Mín. 1 ação" / "Máx. 1.000.000 ações"; o **modo** no controle segmentado (o
  `RadioField` do `form-kit.tsx` refeito: duas metades de 44 px na trilha cinza, a pílula do canvas que desliza em 250 ms por
  `:has(:checked)`, radios nativos escondidos à vista com o anel de foco na metade; o tooltip saiu, e a explicação do "Valor total pago" é a
  dica à vista do campo no modo total e a descrição do radio); o **Valor**, o campo de dinheiro nosso (`MoneyField`): o "R$" dentro do campo,
  à esquerda, no cinza (`aria-hidden`), os centavos entrando pela direita, o Backspace que tira o último, o milhar enquanto digita, o cursor
  no fim, `inputMode="numeric"`, no máximo 12 algarismos, o colar pelo `parseBrl`, o rótulo "Preço por ação" ou "Valor total pago" com "em
  reais" só para o leitor de tela, e `name="value"` com o texto que ele mostra (o `checkLot` não mudou); a **Data da compra (opcional)**, o
  Date picker e o Calendar da Arc (`pt-BR`, "15 de out. de 2026", "Sem data", `maxDate` = o `today` de Brasília, `minDate` = 1900-01-01, o
  "Hoje"), com o hidden `name="boughtOn"` montado das partes locais (`dateKey`), o mês e o ano em dois `<select>` nativos no título (o ano do
  mais novo ao mais velho, o mês fora dos limites desativado), o calendário que vem à vista quando o corpo do modal rola, e o Esc que fecha
  só o calendário (`preventDefault` e `stopPropagation`; o `cancel` do `<dialog>` também é cancelado enquanto o calendário está aberto).
- **O resumo** acima dos botões, no cinza do painel: "Custo total" (por ação, `lotCostCents`) ou "Preço médio por ação" (total ÷
  quantidade, o meio para longe do zero, em BigInt como o `divRound` da api), no contador da Arc (`Dinheiro`); some sem valor ou acima do
  teto (`lotSummary`, `lib/wallet-client.ts`).
- **O `form-kit.tsx`**, além do `RadioField` segmentado: o `useCampo` (o id, o erro, a dica e o `aria-describedby` de um campo, que o
  `TextField`, o `TextAreaField` e os três campos novos do lançamento dividem) e a `FieldError` exportada, para o erro dos campos sobre as
  peças da Arc sair igual ao dos outros; o `TextField` perdeu o `inputMode` e o `max`, que só o formulário antigo da carteira usava (o `tsc`
  confirma que ninguém mais os passa; a conta e o admin seguem iguais). O diff do `CheckField` no mesmo arquivo (a caixa de 20 px) é da outra
  tarefa da onda, e não meu.
- **As peças da Arc copiadas** (de `.../scratchpad/libs-lancamento/src/`, conferidas byte a byte com o JSON do registro: os cinco arquivos e
  o `use-today.ts` iguais): `components/arc/number-field/`, `calendar/`, `date-picker/` e `lib/use-today.ts`, com a origem, "lido em
  06/11/2026", o Copyright (c) 2026 Elia Kuratli, a MIT e o que mudou no topo de cada arquivo; imports relativos; os ícones do `lucide-react`
  viraram os nossos (`IconeAdicionar`, `IconeSubtrair`, `IconeCalendario` e as três setas, em `icones.tsx`); os textos em português; 44 px
  em todo alvo; os nossos tokens nos módulos (nenhuma cor crua, nada novo no `:root` nem no `globals.css`). O `motion-tokens.ts` ganhou o
  `duration.fast`, o `duration.slow` e o `spring.snappy`, com os valores do `lib/motion.ts` (nenhuma duração nova: as durações soltas das
  peças viraram tokens, e a mola dos meses do calendário, de 360 ms, virou a de 250 ms).
- **Documentos**: `docs/TELAS.md` (seção 9: o modal, os botões, os campos, o resumo, os testes), a ADR 0037 (as linhas novas "Campo de
  número" e "Data", as que mudam "Campo de dinheiro", "Folha e diálogo", "Termo com explicação" e "Abas e controle segmentado", e a nota de
  06/11/2026), `docs/DEPENDENCIAS.md` (as linhas do `number-field`, do `calendar` com o `use-today` e do `date-picker`; a do
  `arc-motion-tokens` e a da Arc como referência atualizadas), `docs/GUIA-DO-CODIGO.md` (o passo 5 do "lançar uma compra": o `BotaoLancar`
  e o `openDialog`) e o `CLAUDE.md` (o "campo de número" e a "data" na lista de peças da tabela; ele não falava do `LotForm`, do `#lancar` nem
  do `centsToInput`). O `centsToInput` saiu, com o teste dele (ficou sem uso).

## 2. Critérios de aceite

| Critério | Evidência |
|---|---|
| 1. "Lançar compra" (cabeçalho e coluna) abre o modal; Esc, ✕ e "Cancelar" fecham com o foco de volta; lançar e editar pelo modal nos seis projetos, com o aviso e o foco de hoje | e2e `carteira.spec.ts`, "o modal de lançar › abre pelos dois botões e fecha pelo Esc, pelo ✕ e por "Cancelar", com o foco de volta em quem abriu" (e o clique fora que não fecha, e a página atrás com `overflow: hidden`); lançar e editar nos testes refeitos ("os dois modos...", "editar abre o mesmo formulário no modal...", "cancelar a edição fecha o modal...", "por toque", "só com o teclado"), com o aviso focado ao lançar e o "Editar" focado ao salvar. Rodada final na seção 3 |
| 2. Quantidade só inteira, − e + de 44 px, algarismos que rolam; valor com "R$" e centavos pela direita; data pelo calendário da Arc em português, mês e ano rápidos, nada depois de hoje | e2e "a quantidade só inteira..." (o − e o + de 1 em 1, o − em `aria-disabled` no 1 com "Mín. 1 ação", uma roda no meio do giro depois do +, "1,5" vira 15, "1000" aparece "1.000", acima do teto volta a 1.000.000), "o valor: o "R$" no campo, os centavos pela direita..." ("3550" mostra 0,03, 0,35, 3,55 e 35,50; o Backspace; o colar de "R$ 1.234,56" e o "1.234" recusado; o resumo) e "a data: o calendário da Arc..." (o mês e o ano nos `<select>`, amanhã desativado, o "Próximo mês" desativado, o mês seguinte desativado no `<select>`, 2019 em três toques, "Limpar", "Hoje", o Esc só no calendário); os 44 px no `carteira-layout.spec.ts` (o estado do modal e o do calendário); unidade em `wallet-client.spec.ts` e `arc.spec.tsx` |
| 3. O corpo enviado é o mesmo (`{ ticker, quantity, mode, valueCents, boughtOn? }`) e nenhuma dependência npm nova | o `checkLot` e o `LotBody` não mudaram (`git diff apps/web/src/lib/wallet-client.ts`: só o campo de dinheiro, o resumo e o re-export dos tetos); o e2e confere o que a api guardou (`wallet()`), inclusive o `boughtOn: '2019-03-10'`; `apps/web/package.json` e `pnpm-lock.yaml` sem mudança (`git status --porcelain apps/web/package.json pnpm-lock.yaml`: nada) |
| 4. Typecheck, lint, Vitest, build, `docs:check`, guia, e2e da carteira e de layout nos seis projetos; axe sem violação com o modal e o calendário abertos nos dois temas; nada rola de lado em 360 px | seção 3 |
| 5. A landing não mudou (CSS igual ou menor) | o CSS que a `/` baixa (o `entryCSSFiles` do manifesto do build): **97.146 B antes → 97.121 B depois** (gzip 18.210 → 18.201). A única diferença é o `.w-fit{width:fit-content}` que saiu (era do rótulo do radio antigo). Medido de novo no build final: os mesmos 97.121 B. Sem o Lighthouse: o CSS ficou menor |
| 6. Capturas 360 e 1440, claro e escuro: o modal aberto, o calendário aberto e o resumo | `docs/redesign-premium/capturas/lancamento/`: `modal-`, `resumo-`, `calendario-` e `pagina-` (a carteira com os dois botões), cada um em `360-claro`, `360-escuro`, `1440-claro` e `1440-escuro` (16 capturas, tiradas por um spec temporário no projeto `desktop`, apagado depois) |

## 3. Comandos e resultados

| Comando | Resultado |
|---|---|
| `pnpm --filter @alvesting/web typecheck` | ok |
| `pnpm --filter @alvesting/web lint` | ok, sem aviso (um `eslint-disable-next-line` com o motivo: o `aria-invalid` no gatilho da data, global no ARIA que o axe confere; o plugin do lint segue a ARIA 1.2) |
| `pnpm --filter @alvesting/web test` | 50 arquivos, **939 testes, todos passaram** |
| TDD | os testes do campo de dinheiro e do resumo (`wallet-client.spec.ts`) escritos antes do código: 12 vermelhos pelo motivo certo (as funções não existiam), verdes depois |
| `pnpm --filter @alvesting/web build` | ok (os mesmos 10 avisos de antes, do `::scroll-button` do `globals.css`; nenhum dos módulos novos). O build final (18:44) é posterior à última edição do código (18:41), e o Vitest e o e2e desta tabela rodaram sobre ele |
| `pnpm docs:check` | `docs:check ok: 100 itens documentados` |
| `node scripts/guia-check.mjs` (não há `guia:check` no `package.json` da raiz) | `guia-check ok: 247 referências conferidas` |
| `playwright test e2e/carteira.spec.ts e2e/carteira-layout.spec.ts e2e/layout.spec.ts --workers=2` nos seis projetos | **815 passaram, 16 pulados, nenhuma falha nem instável** (831 testes: 199 em cada projeto claro e 78 em cada escuro; 5,4 min), sobre o build final |
| `prettier --check` nos meus arquivos | ok |

O e2e rodou com a trava das execuções pesadas, o `az-stub` no `PATH` e o build de produção; os 16 pulados são os de antes (os testes só do
desktop: o do teclado, o do ponteiro sobre o aviso e o do tooltip, e cinco do `layout.spec.ts`, em pixel-7 e iphone-15).

## 4. Testes que mudaram de expectativa (e o motivo)

- **`carteira.spec.ts`**: os auxiliares (`fields`, `fill`, `createForm`) passaram a abrir o modal (`openCreate`), a achar a quantidade como
  `spinbutton`, o valor pelo nome "... em reais", a data pelo gatilho, e a escolher a data no calendário (`pickDate`: o ano e o mês nos
  `<select>`, o dia pelo nome inteiro). O modo é escolhido **tocando o texto da metade** (`choose`), e não pelo `check()` no radio: no
  segmentado o radio fica embaixo do texto, invisível, e o Playwright exige que o ponto do clique caia no próprio alvo (quem vê toca o
  texto; o teclado chega ao radio pelo Tab e pelas setas, no teste do teclado). Mudaram:
  - o `type="date"`: agora o gatilho abre o calendário, e os dias depois de hoje e o mês seguinte estão desativados (teste da data);
  - a data futura: o calendário não a deixa escolher, e o teste da api ficou só com a ação desconhecida. Quem prova que a api recusa a data
    futura é o `apps/api/src/modules/portfolio/presentation/portfolio.integration.spec.ts` ("a data da compra não pode ser futura (em
    Brasília): hoje passa, amanhã não" e o do PATCH com data futura);
  - limpar a data: "Limpar" no calendário (antes, `fill('')` no campo);
  - a edição já preenchida: o valor aparece "3.550,00" (com o milhar; era "3550,00", o `centsToInput`), a data é o nome do gatilho;
  - o link `#lancar` e o "formulário limpo depois de lançar": agora os botões que abrem o modal, e o formulário reaberto vem limpo;
  - os erros no campo: o "1.234" ambíguo, as 3 casas e a quantidade com ponto não se digitam mais (o campo de dinheiro só aceita algarismos,
    e o de número, inteiros); ficaram o vazio e o produto acima do teto. A regra do contrato segue nos testes de unidade (`checkLot`,
    `parseBrl`);
  - os valores digitados nos testes: o "40" virou "4000" (R$ 40,00), o "3550" do toque virou "355000" (R$ 3.550,00) e o "1420" virou
    "142000", porque os centavos entram pela direita;
  - o radio de 20 px (a espessura da borda): agora o segmentado (as duas metades de 44 px, o radio invisível, a cor do texto escolhido e o
    `translate` de 100% da pílula);
  - o tooltip do "Valor total pago": saiu; o teste confere que o hover não abre balão e que a explicação está à vista na dica do campo;
  - "o aviso sem o foco some sozinho": o ponteiro sai de cima do aviso antes de esperar (`page.mouse.move(1, 1)`). O "Salvar alterações"
    agora fica no pé da folha, e no iPhone 15 (viewport de 659 px) o aviso nasce embaixo do ponteiro parado ali, o que pausa o prazo (a
    regra da WCAG 2.2.1 que o teste seguinte prova). A asserção (some sozinho) é a mesma.
- **`carteira-layout.spec.ts`**: dois estados novos ("com o modal de lançar aberto" e "com o calendário aberto no modal"), e o estado "com
  todos os erros do formulário" abre o modal antes de enviar. Nenhuma asserção afrouxou.
- **Unidade**: `wallet-lots.spec.tsx` (o HTML do modal fechado, os campos escondidos, o gatilho da data, o "R$", o − parado no 1, o
  "Lançar compra" no cabeçalho), `wallet-panels.spec.tsx` (o botão no lugar do link `#lancar`), `page.spec.tsx` da carteira (o `today` de
  Brasília agora é lido da prop que a página passa ao `WalletLots`, porque o calendário só se desenha aberto; a ordem tem o modal depois da
  lista) e `wallet-client.spec.ts` (o `centsToInput` saiu com a função).

## 5. Desvios da especificação

- **O CSS dos módulos não é só da `/carteira`**: o `cssChunking` padrão do Next junta os CSS de módulo pequenos num arquivo só (20.960 B,
  4.165 B comprimidos), que as telas do app que usam alguma peça da Arc ou o `form-kit` também baixam (a `/arena`, a `/conta`, a `/entrar`;
  antes, a carteira baixava 2.763 B de módulos: o tooltip e o contador). A landing não baixa nada disso (critério 5). O `RadioField` mora no
  `form-kit.tsx` (a especificação manda mudá-lo ali), e o CSS dele vai junto aonde o `form-kit` vai. Não mexi no `next.config.ts` (não é meu
  arquivo): o `experimental.cssChunking: 'strict'` separaria os arquivos por página, ao custo de mais pedidos; fica para o coordenador
  decidir.
- **O Number field ocupa a largura do formulário** (a Arc tem 196 px por padrão), como os outros campos do modal; a dica fica embaixo do
  rótulo, como nos outros campos do site; e saíram do código copiado o `scrub`, o prefixo e o sufixo, os tamanhos, o `formatOptions`, o
  `disabled` e a animação de texto da dica, que nenhuma tela usa (a regra "sem abstração sem uso"). O `<input>` dele tem a caixa de 44 × 44
  (centrada na linha do número): o `carteira-layout.spec.ts` mede cada `<input>`, e a caixa da Arc tinha a altura do texto.
- **O Date picker abre no mês do `maxDate`** (o hoje de Brasília) quando não há data, e não no `new Date()` do aparelho; o calendário vem à
  vista duas vezes (na abertura e quando termina de crescer: ele mede menor enquanto entra), e o modal tem `overflow: clip` (com `hidden` ele
  é um contêiner de rolagem, e o `scrollIntoView` do calendário o rolava e escondia o título). O calendário tem até 352 px (e não os 328
  da Arc) para o mês, o ano, o "Hoje" e as setas caberem numa linha no desktop; abaixo de 332 px os dias ficam sem o vão.
- **O gatilho da data leva `aria-labelledby`** (o rótulo e a data mostrada): com o `<label>` só, o nome do botão seria só o rótulo e o
  leitor de tela não ouviria a data.
- **Os botões − e + seguem na ordem do Tab** (o − parado no mínimo fica com `aria-disabled`, focável, como a Arc faz: o toque nele mostra o
  limite). No teclado, as setas para cima e para baixo no próprio campo também mudam a quantidade.
- **O Enter na quantidade confirma o número e não envia o formulário** (o `preventDefault` do Enter é da peça da Arc: confirma o rascunho e
  põe o cursor no fim). Antes, o Enter no campo da quantidade enviava. Nada se perde: o que se digita dentro dos limites já vale a cada tecla
  (o campo escondido acompanha), o Enter no ticker e no valor envia como antes, e o envio só pelo teclado vai pelo botão (o teste "só com o
  teclado").

## 6. Ficou para depois

- O `.radio` do `globals.css` ficou sem uso (era do radio antigo); o `globals.css` não é meu arquivo. Tirá-lo deixa o CSS da landing menor.
- O `cssChunking` (seção 5).
- O gesto de voltar do Android com o calendário aberto: o `cancel` do `<dialog>` é cancelado (o modal não fecha), mas o calendário continua
  aberto; um segundo voltar fecha o modal (o Chrome não deixa cancelar duas vezes sem um toque no meio). Nada se perde que o "Cancelar" não
  perderia. A melhora é fechar o calendário no próprio `onCancel` do `<dialog>`; não a fiz porque o e2e não tem como provar o gesto.
- Os botões do modal no fim do corpo que rola: num modal alto (o desktop de 900 px de altura, com a dica do modo total), o "Lançar compra"
  pede rolar. Um rodapé preso no pé do modal precisaria mexer no `AccountForm` (os botões moram nele).
- Visto só nos motores do Playwright: a folha num iPhone de verdade (a área segura, o teclado sobre a folha, o foco no ticker abrindo o
  teclado dentro do gesto), o leitor de tela de verdade no `spinbutton`, no segmentado e no calendário.

**Resolvido no fechamento do coordenador (06/11/2026):** o `.radio` saiu do `globals.css`; o `onCancel` do `<dialog>` fecha o calendário
aberto (o e2e prova com um `cancel` sem tecla, o que o voltar do Android manda); e os botões ficaram presos no pé do corpo que rola (o
`data-acoes` do `AccountForm` e a regra em `wallet-lots.module.css`). O `cssChunking` ficou como está: a landing não baixa os módulos.

## 7. Arquivos tocados

Novos:

- `apps/web/src/components/arc/number-field/number-field.tsx`
- `apps/web/src/components/arc/number-field/number-field.module.css`
- `apps/web/src/components/arc/calendar/calendar.tsx`
- `apps/web/src/components/arc/calendar/calendar.module.css`
- `apps/web/src/components/arc/date-picker/date-picker.tsx`
- `apps/web/src/components/arc/date-picker/date-picker.module.css`
- `apps/web/src/components/arc/lib/use-today.ts`
- `apps/web/src/components/form-kit.module.css`
- `apps/web/src/components/wallet-lots.module.css`
- `docs/redesign-premium/capturas/lancamento/` (16 PNG: `pagina-`, `modal-`, `resumo-` e `calendario-`, em `360-claro`, `360-escuro`,
  `1440-claro` e `1440-escuro`)
- `docs/redesign-premium/relatorios/t1-lancamento.md` (este)

Alterados:

- `apps/web/src/components/wallet-lots.tsx`
- `apps/web/src/components/wallet-panels.tsx`
- `apps/web/src/components/form-kit.tsx`
- `apps/web/src/components/icones.tsx`
- `apps/web/src/components/arc/lib/motion-tokens.ts`
- `apps/web/src/components/arc/arc.spec.tsx`
- `apps/web/src/components/wallet-lots.spec.tsx`
- `apps/web/src/components/wallet-panels.spec.tsx`
- `apps/web/src/lib/wallet-client.ts`
- `apps/web/src/lib/wallet-client.spec.ts`
- `apps/web/src/app/(app)/(carteira)/carteira/page.spec.tsx`
- `apps/web/e2e/carteira.spec.ts`
- `apps/web/e2e/carteira-layout.spec.ts`
- `docs/TELAS.md`
- `docs/adr/0037-bibliotecas-de-design.md`
- `docs/DEPENDENCIAS.md`
- `docs/GUIA-DO-CODIGO.md`
- `CLAUDE.md`

Nada apagado nem movido no disco. A página da carteira (`page.tsx`) não precisou mudar. Nenhum servidor meu ficou de pé (os do e2e o
Playwright encerra), a trava foi solta em toda rodada, e a demo (4300 e 4310) e os bancos dela não foram tocados.
