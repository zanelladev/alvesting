# Relatório da T2b (a carteira, a conta, o admin, o chat, as telas de entrar e os textos legais no design premium)

Tarefa `task_09fa87e0026d` (dispatch `ctx_7b2cfb975131`), onda "design premium", 05/11/2026. Rodou em paralelo com a T2a (o Explorar, o
terminal das ações e as notícias). Nada foi commitado nem posto no índice: o trabalho está só no working tree. Nada no `apps/api` (nenhuma
rota nova), nenhuma dependência npm nova (o `apps/web/package.json` e o `pnpm-lock.yaml` não são desta tarefa). A demo (4300 e 4310) não foi
tocada.

## Resumo

- **A carteira (`/carteira`)**: o logo de cada ação à esquerda do ticker (o componente e o auxiliar da T0b) nas posições, na legenda da rosca
  e nos lançamentos; a **alocação na rosca da beUI** (o valor de cada posição, que é do dono: ADR 0033), com a fatia e o valor no centro e a
  legenda ligada; o valor estimado, o resultado e o custo total no **contador da Arc**, que rola só quando o número muda depois de lançar,
  editar ou apagar; a confirmação de lançar, editar e apagar no **toast da beUI** (`aria-live="polite"`, o "Fechar aviso" com nome, o Esc);
  o **tooltip da Arc** no preço médio, no resultado e no "valor total pago". A regra do dinheiro digitado continua a do contrato
  (`parseBrl`, `lotCostCents`, `@alvesting/contracts/portfolio-rules`), e o navegador não leva o zod.
- **A conta e o painel**: o toast no download dos dados, no aceite dos termos (que recarrega a conta: o aviso sobrevive à recarga) e em cada
  ação do painel; o **select nativo da ReUI** (o do shadcn) no único `<select>` (o tipo do evento corporativo); tudo na sans, a mono só no hash
  e no JSON da temporada; a falha com o ícone do erro, sem faixa colorida.
- **As telas de entrar e os textos legais**: o erro de formulário é o fio do campo no vermelho e a frase com o ícone, lida pelo leitor de
  tela; a confirmação sem caixa; a escadaria azul parada na tela dividida, como estava; nos termos e na política, o aviso do rascunho sem
  caixa e sem mono e o sumário **"Nesta página"** preso à direita a partir de 1280 px (só HTML e CSS), que serve também ao `/como-funciona`.
  **Nenhuma palavra dos textos legais mudou** (o SHA-256 e o aceite são os mesmos; os testes congelados continuam).
- **O chat desligado (`/chat`)**: já estava no desenho do Rallies desde a onda anterior; ganhou o movimento dos chips em 150 ms e o controle
  desativado que não acende no hover. Continua desligado: nenhum pedido sai da página.
- **A prova**: o `pnpm check` com exit 0 (o site com 50 arquivos e 914 testes), o `pnpm build` com exit 0, **o e2e inteiro nos seis
  projetos, um por vez e com 1 worker, sem nenhuma falha e sem nenhum instável** (só os pulados de sempre), o Lighthouse com LCP de 2.416 ms,
  CLS 0 e TBT de 19,5 ms (a mediana de 5 coletas), o `docs:check` com 75 itens, o ensaio com o SHA-256 de sempre, o `az` falso sem chamada;
  a guarda de rede não registrou nada durante a prova final (os três registros dela são tentativas do próprio pnpm ao registro do npm,
  bloqueadas, de antes das 16:27; seção 5).

## 1. O que mudou em cada tela

**A `/carteira`** (`app/(app)/(carteira)/carteira/page.tsx`, `components/wallet-panels.tsx`, `wallet-lots.tsx` e o novo `wallet-charts.tsx`):
- A coluna da carteira (o "Portfolio" do Today do Rallies): o valor estimado, o resultado (o sinal, o percentual e a palavra ganho ou perda,
  com o glifo uma vez) e o custo total no contador da Arc (`Dinheiro`, em `wallet-charts.tsx`): o leitor de tela lê o texto inteiro do
  `formatBRL` (em `sr-only`, sem float), e as rodas ficam escondidas dele. Nada rola na abertura: o servidor refaz a página depois de lançar,
  editar ou apagar, e só o número que mudou anda.
- A alocação (`AlocacaoDaCarteira`): a rosca da beUI com uma fatia por ação até seis (com sete ou mais, as cinco maiores e "Outras (N ações)"
  com a soma), da maior para a menor (o empate na ordem do ticker), em pontos-base inteiros (`alocacao`, `lib/wallet-client.ts`, com o
  `ratioBps` do projeto). A posição sem cotação e a de valor zero ficam fora. No centro, o valor estimado e o número de ações; com uma fatia em
  foco (o ponteiro na fatia ou na linha da legenda, o foco do teclado na linha), o valor dela e a parte, no contador. As linhas da legenda são
  botões (as setas andam entre elas; o clique fixa a fatia com `aria-pressed`, e outro clique a solta) com o logo, o ticker, a parte, o valor
  e a barra. As cores são os tons da primária (`--fatia-1` a `--fatia-5`, no bloco da T2b do `globals.css`), que seguem o tema; a fatia maior
  não é a primária `#14144C` (a primária fica na ação principal).
- A pílula primária "Lançar compra" no pé da coluna (a ação principal da superfície), que leva ao formulário.
- As posições: o ticker na sans 500 com algarismos tabulares, com o logo à esquerda, ligado à página da ação (a caixa de 44 px do link, o
  sublinhado só no hover); o "Resultado" e o "Preço médio" do cabeçalho são termos com o tooltip da Arc (a mesma explicação está em texto no
  parágrafo das posições, para quem usa o toque); as células a 6 px de cada lado (com o logo, as seis colunas cabem no painel do meio em
  1440 px); nenhuma mono.
- Os lançamentos: a lista com os fios do Rallies (e não um cartão por item), o logo à esquerda do ticker; editar no próprio item e apagar com a
  confirmação no próprio item, como antes; o "Valor total pago" do radio com o tooltip da Arc (e a mesma explicação como descrição do radio e
  na dica do campo). O que acabou de acontecer (lançado, salvo, apagado) é um aviso da pilha da página (`components/avisos.tsx`): o texto que o
  leitor de tela lia antes é o mesmo, anunciado pela região viva da pilha, e o foco vai ao aviso quando o botão que enviou sumiu (lançar e
  apagar).
- O "Perguntar" (o chat desligado, à direita no desktop) não mudou.

**A `/conta`** (`app/(app)/(conta)/conta/page.tsx`, `components/account-forms.tsx`): os cartões com o fio do Rallies; a pilha de avisos logo
abaixo do título; o "Baixar meus dados" continua um link comum (sem JavaScript, a api manda o arquivo), e com JavaScript o aviso confirma que
o download começou; o aceite dos termos recarrega a conta como sempre, e a confirmação chega depois da recarga, na pilha (o texto guardado no
`sessionStorage`, lido uma vez; o navegador que recusa o armazenamento só perde o aviso).

**O `/admin`** (`app/(app)/(conta)/admin/page.tsx`, `components/admin-forms.tsx`, `admin-panels.tsx`): cada ação (o reenvio da DLQ, o
reprocesso do pregão, o evento corporativo, as da temporada) confirma num aviso curto da pilha, e o resultado inteiro continua no formulário
dela, como antes; o tipo do evento corporativo no select nativo da ReUI; o tipo do job, a fila, o MessageId e o slug na sans 500 (a mono só no
JSON da temporada); cada falha com o ícone do erro, sem faixa colorida ao lado.

**As telas de entrar** (`/entrar`, `/cadastro`, `/verificar-email`, `/esqueci-senha`, `/redefinir-senha`; `components/form-kit.tsx`): o campo
de 44 px no cinza do painel com o fio de controle; com erro, o fio vira o vermelho do erro (`aria-invalid`) e a frase vem embaixo, ligada por
`aria-describedby` e lida pelo leitor de tela, com o ícone ao lado (a frase na tinta: a cor nunca anda sozinha, e nada de faixa colorida); a
confirmação do `/entrar` sem caixa (o ícone do que deu certo e a frase); a pílula primária no envio; a escadaria azul parada no quadro 0 na
metade direita da tela dividida, como estava (a T1b).

**Os textos legais** (`/termos`, `/privacidade`; `components/legal-document.tsx`, `legal-text.tsx`): a ficha (versão, vigência e o SHA-256 na
`.hash`, a única mono); o aviso do rascunho é o `[!]` sem caixa e sem mono, como o aviso de página; cada h2 ganha um id (`secao-…`, do próprio
subtítulo; o texto não muda); a partir de 1280 px, o sumário "Nesta página" à direita da coluna de leitura, com o miolo preso abaixo do
cabeçalho, um link por seção (só HTML e CSS); abaixo disso ele some.

**O `/como-funciona`** (por trechos, só o sumário): o mesmo `Sumario`, com as nove seções da página; a versão e o SHA-256 do prompt na `.hash`
(eram `font-mono` soltos).

**O `/chat`** (`components/chat/chat-desligado.tsx`): o fundo das abas e das sugestões anda em 150 ms (pronto para quando a etapa 13 os ligar);
enquanto estão desativados, não acendem no hover (o controle que não responde não finge que responde).

## 2. As peças e de onde vêm

| Peça | De onde | Onde | O que veio e o que mudou (o detalhe no topo de cada arquivo e no `docs/DEPENDENCIAS.md`) |
|---|---|---|---|
| Donut Chart | beUI `donut-chart` (MIT), lido no registro em 05/11/2026 (`updated_at` 18/10/2026) | `components/beui/donut-chart.tsx` (os seis arquivos do registro num só) | Veio: as fatias de pontas redondas com o vão igual sobre o trilho (`buildDonut`), o foco compartilhado entre o anel, o centro e a legenda, o anel de toque parado embaixo de cada fatia, a legenda em botões com as setas, a barra da parte e a escolha que fixa (`aria-pressed`). Mudou: nada anima na abertura (saíram o giro de entrada, o `useInView` e a barra que cresce); o centro é de quem usa (o contador da Arc) e não é região viva; as cores por `var()` no `style`; as molas do `lib/motion.ts`, sem quique; os botões desativados até a hidratação; saíram o `cn` e o DigitSwap |
| Animated Toast Stack | beUI `animated-toast-stack` (MIT), lido no registro em 05/11/2026 (`updated_at` 18/10/2026) | `components/beui/animated-toast-stack.tsx`, com o `components/avisos.tsx` (o provedor da página, a pilha e o aviso que sobrevive à recarga) | Veio: a lista com `aria-live="polite"`, o fechar com nome, o prazo (6 s), o limite de três, a entrada por mola, a pilha que se rearruma e o arrastar para fechar (desligado com movimento reduzido). Mudou: os ícones nossos (sem lucide-react, `cn`, clsx e tailwind-merge), os tokens (o canvas com a sombra de elevação, sem o vidro), o texto inteiro em português, a saída curta, sem portal (a pilha fica dentro do `main`, na ordem do Tab; o CSS a fixa no pé, acima da barra de abas no celular); acrescentados o foco no aviso quando a página pede, o Esc, o prazo que para com o ponteiro ou o foco na pilha (WCAG 2.2.1) e o destino do foco ao fechar pelo teclado |
| Native select | ReUI "Native select", que é o `native-select` do shadcn/ui (MIT), lido no registro em 05/11/2026 | `components/reui/native-select.tsx`, com o `components/reui/LICENSE` (a MIT da ReUI e a do shadcn) | Veio: o `<select>` do navegador com o desenho do campo por cima e a seta à parte, as opções em `Canvas`/`CanvasText`. Mudou: o desenho do nosso `.field` (44 px, raio 8, 16 px contra o zoom do Safari, o anel de foco e o `aria-invalid` do site), a seta é o nosso ícone, sem o `cn` e sem o tamanho pequeno |
| Contador | Arc `animated-counter` (da fundação) | o resumo da carteira e o centro da rosca | Usado como está, com o prefixo `R$` e o espaço que não quebra; acima de R$ 70 trilhões sai o texto parado (`ponytail:` no `wallet-charts.tsx`: o contador da Arc formata em ponto flutuante) |
| Tooltip | Arc `tooltip` (da fundação) | o preço médio e o resultado das posições, o resultado do resumo e o "valor total pago" | Usado como está (o termo é um botão com o sublinhado pontilhado, `.termo`) |
| Logo da ação | `components/logo-do-papel.tsx` e `lib/logos.ts` (da T0b) | as posições, a legenda da rosca e os lançamentos | Usados como estão; a página manda ao navegador só a versão do logo dos tickers da carteira |

Nenhuma peça fora da tabela do ADR 0037, então o ADR não mudou. Nenhuma dependência nova: as três peças rodam com o `motion` e o React que já
estavam. Nada Pro.

## 3. Cada critério, com a evidência

| Critério | Evidência |
|---|---|
| A sans com algarismos tabulares nos números e nos tickers; a mono só no hash | unidade: `WalletPositions: o desenho limpo do Rallies` (nenhuma mono na tabela), `a citação do rascunho: sem caixa e sem a mono`; o `/como-funciona` e o painel na `.hash` e na sans; capturas |
| A primária só na ação principal de cada superfície | A pílula "Lançar compra" (a carteira), o envio dos formulários (`form-kit.tsx`); a fatia maior da rosca num tom da escala, e não a primária; capturas `carteira-*` |
| A Regra do Glifo uma vez por linha; o `[!]` sem caixa; nenhum âmbar | O resultado do resumo e o de cada posição com um glifo só (os testes de unidade do resumo e das posições); o aviso da carteira e o do rascunho legal sem caixa (unidade e capturas); `grep -i "âmbar\|amber"` nos meus arquivos e no bloco da T2b: nada. Os comentários velhos ("pílula preta", "Geist") reescritos |
| O logo de cada ação à esquerda do ticker, nas posições e nos lançamentos | e2e "o logo de cada ação fica à esquerda do ticker, ligado à página dela, nas posições, na legenda e nos lançamentos" (nos seis projetos); unidade: `o ticker na sans 500 com o logo à esquerda` |
| A rosca da beUI com a fatia e o valor no centro e a legenda ligada | e2e "a rosca mostra a alocação de cada posição contra a api, e a legenda liga a fatia ao centro (o foco, as setas e o clique que fixa)"; unidade: `alocacao` (4 testes) e os 2 da rosca no resumo; captura `estado-rosca-*` |
| O contador que rola só quando o número muda por interação | e2e "o contador do resumo rola quando o número muda depois de lançar, e nada rola na abertura"; unidade: "os três números no contador: o texto lido inteiro, as rodas escondidas do leitor de tela" |
| O toast em lançar, editar e apagar, anunciado e fechável pelo teclado, sem perder o texto lido | e2e "o aviso do lançamento chega na pilha anunciada (aria-live polite), com o foco, fixo no pé da tela, e fecha pelo teclado" e "o aviso sem o foco some sozinho"; os testes de lançar, editar e apagar leem o mesmo texto de antes (agora no aviso); unidade: `PilhaDeAvisos` e o aviso que sobrevive à recarga; captura `estado-aviso-*` |
| O toast na conta e no painel | e2e `conta.spec.ts` (o download dos dados) e `admin.spec.ts` (o reenvio da DLQ) leem o aviso na lista "Avisos" |
| O tooltip no preço médio, no resultado e no valor total pago | e2e "o preço médio, o resultado e o valor total pago explicam-se no tooltip, pelo ponteiro e pelo teclado" (desktop: o hover, o foco, a descrição acessível e o Esc); unidade: `o resultado e o preço médio são termos com explicação` |
| O select nativo da ReUI só onde há `<select>` | O único `<select>` do site nas minhas telas (o tipo do evento corporativo, `SelectField` do `form-kit.tsx`); o e2e do painel e o `admin-layout.spec.ts` (44 px, axe) |
| Os erros de formulário com o fio de controle e a mensagem lida | e2e `conta.spec.ts` (o `aria-invalid` e a descrição acessível de cada campo no cadastro, na exclusão da conta e no aceite) e o `conta-layout.spec.ts`, que mede as telas com o erro na tela (360 px, 44 px, o axe) |
| O chat desligado, nada sai da página, os chips em 150 ms | e2e `chat.spec.ts` "nada do que a pessoa faça sai da página: ... nenhum pedido vai à api" e "o JavaScript da tela não leva o zod"; o CSS do bloco da T2b |
| Os textos legais sem mudar uma palavra; o sumário "Nesta página" | Os testes congelados do SHA-256 e do aceite continuam verdes; e2e "em 1440 px fica à direita do texto e leva a cada seção; em 390 px some" (`/termos` e `/privacidade`); unidade: `sumarioDoTexto` (3), `Sumario` (2) e o novo `como-funciona/page.spec.tsx` (cada link do sumário para uma seção que existe, na ordem) |
| Nada anima na abertura; com movimento reduzido, nada se move | e2e "movimento reduzido: o contador, a rosca e o aviso trocam na hora" (nenhuma animação rodando, todo algarismo inteiro, as fatias esmaecidas sem meio-termo) e "nada rola na abertura" |
| De 360 a 1920 px sem rolagem horizontal e sem barra à vista; 44 px; o axe nos dois temas | `carteira-layout.spec.ts`, `conta-layout.spec.ts` e `admin-layout.spec.ts` ("de 360 a 1920 px": a largura da página e nenhuma barra de rolagem), os testes de 44 px e do axe deles e o laço de `ROUTES` do `layout.spec.ts` (o `/chat`), nos seis projetos (os `-escuro` levam os `@tema`) |
| O teclado do celular sem cobrir o campo | O campo de 16 px (sem o zoom do Safari) e a pilha de avisos acima da barra de abas; o `carteira-layout.spec.ts` confere o tamanho da letra dos campos |
| O navegador não leva o zod | `carteira-layout.spec.ts` e `conta-layout.spec.ts` (nenhum script das telas leva o zod); `wallet-charts.tsx` importa só o tipo `Position` |

## 4. Os testes

Novos ou mudados, com o vermelho visto antes do código onde há lógica:

- `src/lib/wallet-client.spec.ts`: `alocacao` (4 testes: a ordem e a parte, a posição sem cotação, a sétima ação em "Outras", o empate).
- `src/components/wallet-panels.spec.tsx`: a rosca (a imagem com as partes no nome e a legenda), sem rosca quando nada tem fechamento, os três
  números no contador, o ticker com o logo e sem mono, os termos com explicação.
- `src/components/wallet-lots.spec.tsx`: ajustado ao aviso na pilha e à lista com fios.
- `src/components/avisos.spec.tsx` (novo): o aviso que sobrevive à recarga (lido uma vez; o armazenamento recusado) e a pilha vazia com nome e
  `aria-live`.
- `src/components/legal-text.spec.tsx`: `sumarioDoTexto` (3), `Sumario` (2) e a citação do rascunho sem caixa e sem mono.
- `src/app/(site)/como-funciona/page.spec.tsx` (novo): o sumário do Como funciona contra as seções da página.
- `src/app/(app)/(carteira)/carteira/page.spec.tsx` e `src/app/(entrar)/entrar/page.spec.tsx`: ajustados (os logos da carteira, a confirmação
  sem caixa).
- e2e `carteira.spec.ts`: "as peças vivas da carteira" (o logo, a rosca, o aviso, o aviso que some, o contador), "movimento reduzido" e "os
  termos com explicação"; os testes antigos de lançar, editar e apagar leem o aviso pela pilha (`notice()`), com o mesmo texto.
- e2e `carteira-layout.spec.ts`, `conta-layout.spec.ts` e `admin-layout.spec.ts`: "de 360 a 1920 px" (a largura e a barra), a espera da
  transição de 150 ms antes do axe e o sumário dos textos legais.
- e2e `conta.spec.ts` e `admin.spec.ts`: o aviso na pilha.

Mutantes: os testes novos de unidade pegaram os 8 mutantes que pus na lógica nova, cada um desfeito na hora e conferido byte a byte; e o do
Como funciona (um id trocado na lista `SECOES`) também.

O tooltip no e2e: a saída do ponteiro anda em 10 passos (`page.mouse.move(0, 0, { steps: 10 })`), como no `explorar.spec.ts`. A Radix deixa o
balão alcançável (WCAG 1.4.13): o `pointerleave` do termo cria a área de passagem a partir do ponto de saída, e só um `pointermove` seguinte,
fora dela, fecha o balão; o salto de uma vez manda um movimento só, o do ponto de saída, e o balão ficava aberto (a T2a viu as duas saídas
reprovarem no desktop e avisou pelo coordenador). Só o teste mudou; o tooltip é o da Arc, como está.

## 5. Os comandos e os resultados

Com a trava pesada (`.data/trava-pesada`, das 17:24:54 às 17:48:44), o piso de disco (58 GB livres no começo) e a guarda de rede (`NODE_OPTIONS` com o
`net-guard.mjs`, registro em `.data/guardas/t2b-conta-rede.log`) e o `az` falso no `PATH`:

| Comando | Resultado |
|---|---|
| `pnpm build` (17:24) | **exit 0**; o web recompilado (cache miss do turbo), a api e os contratos do cache; os 6 avisos de CSS são os de antes desta tarefa (o `::scroll-button()` da faixa, que o lightningcss não reconhece), os mesmos do build "antes", conferidos com `diff` |
| As capturas (17:25) | um spec temporário (`e2e/zz-capturas-t2b.spec.ts`, posto e tirado pelo script, fora do repositório no fim) no projeto `desktop`: 5 testes, 36 capturas |
| e2e `pixel-7` (17:26 a 17:30) | **exit 0**: 498 passaram, 16 pulados (4,0 min) |
| e2e `iphone-15` (17:30 a 17:35) | **exit 0**: 498 passaram, 16 pulados (5,4 min) |
| e2e `desktop` (17:35 a 17:39) | **exit 0**: 511 passaram, 3 pulados (4,2 min); o teste do tooltip da carteira (`carteira.spec.ts:1527`) passou em 1,9 s |
| e2e `pixel-7-escuro` | **exit 0**: 161 passaram, 1 pulado (1,6 min) |
| e2e `iphone-15-escuro` | **exit 0**: 161 passaram, 1 pulado (2,1 min) |
| e2e `desktop-escuro` | **exit 0**: 162 passaram (1,6 min) |
| `pnpm lighthouse` (17:46) | **exit 0**: 5 coletas da landing no celular; a mediana na seção 6 |
| `pnpm check` (17:48, com o meu `TEST_DATABASE_URL`, `alvesting_t2b_conta_test`) | **exit 0**: o lint (o prettier inteiro), os tipos, os testes (os contratos com 501, o site com 914 em 50 arquivos, a api com 3.153 e 9 pulados) e o `docs:check` com 75 itens |
| Ensaio (17:48, `ENSAIO_DATABASE_URL=…/alvesting_t2b_conta_ensaio`) | **exit 0**, "RESULTADO: OK"; o `.data/ensaio/relatorio-s1-p5.txt` (22.068 bytes) com o SHA-256 **`081d860b31b6c69997424d92beacc190eefed498835b61e2ebe9b442d8891f12`**, o das regras |
| O `az` falso | o `calls.log` com 0 linhas antes e 0 depois |
| A guarda de rede | o `.data/guardas/t2b-conta-rede.log` tem três linhas, `TCP registry.npmjs.org`, de três processos do pnpm, todas de antes das 16:27 (a data do arquivo): tentativas do próprio pnpm ao registro do npm, bloqueadas, como as que a T1a anotou. A prova final (17:24 às 17:48) não acrescentou nenhuma |
| Os bancos | o `alvesting_t2b_conta_test` e o `alvesting_t2b_conta_ensaio` apagados no fim (`DROP DATABASE … WITH (FORCE)`); nenhum `alvesting_verify_*` nem `alvesting_t2b*` sobrou |

Os pulados são os de sempre, por projeto: no celular, os testes de hover e de teclado do desktop (o tooltip da carteira, da arena e do
Explorar, o "só com o teclado" da carteira, as folhas da casca pelo teclado, o seletor de tema pelo teclado) e o login do smoke (`@api`, só
contra o site publicado); no desktop, os de toque do celular e o mesmo do smoke; nos `-escuro`, o do seletor pelo teclado nos dois celulares.

## 6. O Lighthouse, as capturas e os achados

**O Lighthouse** (`pnpm lighthouse`, a landing no celular, 5 coletas às 17:45, no build da prova):

| Coleta | LCP | CLS | TBT |
|---|---|---|---|
| 1 | 2.416 ms | 0 | 28,5 ms |
| 2 | 2.408 ms | 0 | 13 ms |
| 3 | 2.422 ms | 0 | 21 ms |
| 4 | 2.414 ms | 0 | 16,5 ms |
| 5 | 2.420 ms | 0 | 19,5 ms |
| **Mediana** | **2.416 ms** | **0** | **19,5 ms** |

Dentro do teto das regras (LCP ≤ 2,5 s), sem precisar do A/B. A landing não carrega nada desta tarefa além das regras do bloco da T2b no CSS
(o arquivo é um só para o site inteiro): as peças novas são ilhas de cliente das telas da conta, e nem a página da landing, nem a casca
do site, nem o layout raiz importam um componente meu (conferido nos imports). A T1a mediu os mesmos 2.416 ms com o mesmo método.

**As capturas** (`docs/redesign-premium/conta/`): as "antes" em `antes/` (tiradas antes de mexer em qualquer arquivo) e as finais em
`depois/`, da `/carteira` (vazia e com posições), do `/chat`, da `/conta`, do `/admin`, do `/entrar` e do `/termos`, em 1440 × 900 e
390 × 844, nos dois temas, e mais duas de estado (`estado-rosca-*`, a fatia em foco com o valor no centro, e `estado-aviso-*`, o aviso do
lançamento no pé da tela). Comparadas:

- Com as "antes": a carteira trocou a coluna de três números parados por o contador, a rosca e a pílula primária; a tabela ganhou o logo e
  os termos; os lançamentos perderam os cartões. A conta e o painel ficaram iguais à vista (a mudança é o aviso, o select e a sans). O
  entrar e os termos: o aviso do rascunho sem caixa e o sumário à direita em 1440 px. O chat ficou igual (a mudança é o movimento).
- Com o Rallies: a carteira segue o "Portfolio" da captura do Artur (`arena-1917-logado.png`: os números grandes na sans, a lista de fios e a
  alocação com a legenda); o `/chat` segue o "O que vamos olhar hoje?" do Today do Rallies desde a onda anterior. As capturas "chat" do
  Rallies (`chat-1440-*`, `chat-390-*`) são a porta de cadastro do chat dele, de quem não entrou, e não a tela do chat: não há o que copiar
  delas para um chat que está desligado.

**Achados no caminho**: o tooltip no e2e (seção 4); o radio do formulário de lançar (seção 7).

## 7. Desvios e decisões

- **O radio de lançar** continua o círculo de 44 px cheio na tinta quando marcado (a regra `.radio` do `globals.css`, usada só pelo
  `form-kit.tsx`, de antes desta tarefa). Desenhá-lo menor dentro do alvo de 44 px pede um pseudo-elemento no `<input>`, que o Firefox não
  desenha, e o glifo `●` em texto existe para o controle sobreviver ao alto contraste do sistema. Fica para a revisão decidir; não mudei.
- **A fatia maior não é a primária**: a regra da onda guarda a `#14144C` para a ação principal, a escolha atual, o foco e a marca; as fatias
  usam os tons 700 a 300 da escala (no escuro, invertidos), que seguem o tema.
- **O aviso não usa portal**: a pilha fica no documento onde a página a põe (dentro do `main`, na ordem do Tab), e o CSS a fixa no pé; o
  leitor de tela e o Tab a encontram onde ela está.
- **O aceite recarrega a conta** como antes (o fluxo não muda); por isso o aviso dele passa pelo `sessionStorage` e sai na carga seguinte.
- **O esqueleto da Arc** não entrou: as minhas telas não têm estado de carregamento no cliente (a carteira, a conta e o painel saem prontos
  do servidor; o envio dos formulários tem o DotSpinner no botão, que não é lugar de esqueleto), e não pus `loading.tsx` (nenhum grupo do app
  tem um; não medi uma espera de navegação que o pedisse). Se a revisão vir a navegação esperar na Azure, o `loading.tsx` do grupo com o
  esqueleto é o passo seguinte.
- **O contrato de DOM dos testes**: o texto que o leitor de tela lia na confirmação de lançar, editar e apagar continua o mesmo, agora no
  aviso da pilha (a lista "Avisos"); os testes antigos passaram a ler por ela (`notice()` no `carteira.spec.ts`). Os números do resumo têm o
  texto inteiro em `sr-only` e as rodas do contador em `aria-hidden`; o e2e lê o texto do leitor (`readText()`, que tira o `aria-hidden`).

## 8. O que fica para depois

- O radio de lançar (seção 7), se a revisão quiser o desenho menor.
- O chat de verdade (etapa 13, depois do aval do orientador): os chips já têm o movimento.

## 9. Os arquivos tocados

Telas: `apps/web/src/app/(app)/(carteira)/carteira/page.tsx` e `page.spec.tsx`; `app/(app)/(conta)/conta/page.tsx`;
`app/(app)/(conta)/admin/page.tsx`; `app/(entrar)/entrar/page.tsx` e `page.spec.tsx`; `app/(auth)/redefinir-senha/page.tsx` e
`app/(auth)/verificar-email/page.tsx` (só comentário); `app/(site)/como-funciona/page.tsx` (o sumário, por trechos) e `page.spec.tsx` (novo).

Componentes: `apps/web/src/components/wallet-panels.tsx` e `.spec.tsx`, `wallet-lots.tsx` e `.spec.tsx`, `wallet-charts.tsx` (novo),
`account-forms.tsx`, `admin-forms.tsx`, `admin-panels.tsx`, `form-kit.tsx`, `cartao.tsx` (só comentário), `chat/chat-desligado.tsx`,
`legal-document.tsx`, `legal-text.tsx` e `.spec.tsx`, `avisos.tsx` e `.spec.tsx` (novos), `beui/donut-chart.tsx` e
`beui/animated-toast-stack.tsx` (novos; o `beui/LICENSE` já estava), `reui/native-select.tsx` e `reui/LICENSE` (novos).

Lib: `apps/web/src/lib/wallet-client.ts` e `.spec.ts`.

CSS: `apps/web/src/app/globals.css`, só o bloco "conta (T2b)" (entre o comentário de abertura e o "fim do bloco conta (T2b)").

e2e: `apps/web/e2e/carteira.spec.ts`, `carteira-layout.spec.ts`, `conta.spec.ts`, `conta-layout.spec.ts`, `admin.spec.ts`,
`admin-layout.spec.ts`.

Docs: `docs/TELAS.md` (as seções da carteira, da conta, do admin e a 10, por trechos), `docs/DEPENDENCIAS.md` (as três peças e o `LICENSE`
da ReUI), `docs/redesign-premium/conta/antes/` e `depois/` (as capturas) e este relatório.
