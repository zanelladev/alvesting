# Relatório da tarefa T3b (telas da conta): entrar, cadastro, conta, carteira, admin, termos e privacidade no ascii-ui

Tarefa `task_60b3ef2fad54`, onda "design ASCII + elenco" (Run `run_ee238b5b17cc`), 04/11/2026. É a dona (c), fase 2, do plano
(`docs/redesign-ascii/plano.md`, seções 3, 5 e 6). Ponto de partida: a fundação da T2 (`relatorios/fundacao.md`). Nada foi commitado nem
posto no índice: o trabalho está só no working tree (`git diff` e os `??`).

O pedido do Artur: "Eu quero o design ASCII antigo, a landing antiga tava muito bonita, principalmente Hero". A T2 trouxe a casca e a home;
esta tarefa põe as telas da conta no mesmo sistema visual. A v1 não tinha telas de conta: elas seguem as regras de formulário do Arc que o
plano descreve (campo de 44 px, uma pílula branca por superfície, `DotSpinner` no envio). **Só desenho**: os fluxos, os nomes de campo, os
rótulos, as mensagens, as regiões, os roles e o texto dos termos e da política ficaram iguais.

## 1. O que foi feito

**O padrão das telas** (a composição da tabela da seção 3 do plano):

- **`PageHead`** em toda tela: o h1 em Geist 500 de 36 px (antes mono semibold), o texto que explica em `text-lead` (18 px, `body`) e a
  linha da moldura; o conteúdo abre 48 px abaixo (`mt-12`, que colapsa com o `space-y-8` do `main`), e cada `Section` traz a linha, a faixa
  vazia e o título, como na home.
- **O formulário num cartão** (`card`, até 448 px: o `max-w-md` do formulário): entrar, cadastro, verificar e-mail, esqueci a senha,
  redefinir a senha, o aceite novo, a exclusão, lançar uma compra, e no painel o reprocesso, o evento corporativo e a nova temporada.
- **Uma pílula branca por superfície.** O `AccountForm` (`form-kit.tsx`) ganhou `primary` (padrão `false`): o envio vira `btn btn-primary`
  em "Entrar", "Criar conta", "Enviar o link", "Salvar a nova senha", "Reenviar o link", "Aceitar as versões novas", "Lançar compra" e
  "Salvar alterações"; ficam no `btn` escuro "Sair", "Excluir minha conta", "Entrar com o Google"/"Cadastrar com o Google" e as seis ações do
  painel (nenhuma é convite). Sem formulário, a única ação vira a pílula: "Entrar" do e-mail confirmado e "Pedir um link novo" do link
  incompleto.
- **Enviando**: "Enviando…" com o `DotSpinner` 3 × 3 da T2 (o nome do botão continua "Enviando…").
- **Erros e avisos**: o erro do formulário (`role="alert"`) e o do Google numa caixa `rounded-control` com a borda `semantic-error/60`; o
  erro de campo com o fio vermelho à esquerda (T2); o status e o aviso de `/entrar?aviso=` numa caixa `hairline-strong`; **aviso é `[!]` em
  cinza** (sem cor de aviso no sistema) numa caixa `hairline-strong`: o da carteira, "Os textos mudaram", "Teto não configurado" e o
  RASCUNHO dos textos legais. Onde o teste exige o texto como primeiro filho (o `<noscript><p>`, o aviso de `/entrar`, o `role="alert"`), a
  caixa fica sem o `[!]`.
- **Rótulos e legendas** em Geist 500 de 14 px na tinta (`font-display text-sm font-medium text-ink`): os campos (T2), a legenda dos radios
  da carteira e a do "Aceite" do cadastro; a área de texto do painel (o JSON da temporada) na mono e com 16 px (antes 14 px e sans: o
  comentário dizia mono, e o Safari do iPhone dá zoom abaixo de 16 px).

**Tela a tela:**

| Rota | Como ficou |
|---|---|
| `/entrar` | `PageHead` "Entrar" (o aviso de `?aviso=` e o erro do Google logo abaixo do texto, na ordem de leitura, como antes) → o formulário num cartão ("Entrar" na pílula, "Entrar com o Google" no `btn`) → "Esqueci a senha" e "Criar conta" como `link` |
| `/cadastro` | `PageHead` "Criar conta" → o formulário num cartão, com as caixas do aceite (`check`) e os links dos termos noutra aba → "Já tenho conta" |
| `/verificar-email` | os três estados num `PageHead`: confirmado (a pílula "Entrar"), vencido ou inválido e o de depois do cadastro (o texto longo virou um `lead` e um parágrafo comum, o mesmo texto) → "Reenviar o link" num cartão → os três links |
| `/esqueci-senha`, `/redefinir-senha` | `PageHead` → o formulário num cartão; sem o token, "Pedir um link novo" na pílula |
| `/conta` | `PageHead` "Minha conta" → "Dados" (`Facts`, até 672 px) → "Termos e privacidade" (cada aceite numa linha com o fio, como os `Facts`) → "Sair" (`btn`) → "Meus dados" (`btn`) → "Excluir a conta" (o que apaga e o que fica, e a confirmação e a senha num cartão de borda `semantic-error/60`, o botão no `btn`). **Com o aceite pendente, "Termos e privacidade" vem antes de "Dados"**, com o `[!]` "Os textos mudaram" e o formulário do aceite num cartão (plano §3: "aceite pendente: o formulário em primeiro") |
| `/carteira` | `PageHead` "Minha carteira" → o aviso `[!]` → "Resumo" (a faixa de números da home: `StripItem` numa caixa `rounded-panel`, uma célula embaixo da outra no celular e três lado a lado a partir de 768 px; o percentual e a palavra embaixo do resultado, menores) → "Posições" (`tbl` em `TableScroll`, com o crédito "Cotações: brapi.dev.") → "Lançamentos" (um `card` por lançamento, até 672 px; o ticker na mono; "Editar" e "Apagar" no `btn`; a pergunta do apagar num quadro tracejado dentro do cartão) → "Lançar uma compra" (o formulário num cartão: `field`, `radio`, `btn-primary`) |
| `/admin` | `PageHead` "Painel da arena" → as seções de hoje: as tabelas em `TableScroll` (a célula presa e o cabeçalho de coluna agora são os de `tables.tsx`; o tipo do job na mono), as falhas com o fio `semantic-error` à esquerda, cada mensagem da DLQ e cada temporada num `card`, os subtítulos em Geist 500 (`text-title`; o nome da fila na mono), "Teto não configurado" com o `[!]`, e os formulários de nova temporada, reprocesso e evento num cartão, sem pílula branca |
| `/termos`, `/privacidade` | `PageHead` com o título e, abaixo, a versão, a vigência e o SHA-256 (na mono, embaixo do termo) e, na política, o controlador e o contato → o texto em prosa: `prose-md` (16 px, linha de 1,6), até 64 caracteres, subtítulos em Geist 500 (`display-sm` de 22 px e `title`), o RASCUNHO num quadro `[!]` |

**Tokens.** O único nome velho nos meus arquivos era o `bg-paper` do `STICKY` do painel, que saiu junto com a cópia local (o painel usa o
`STICKY` e o `Th` de `tables.tsx`, que já estão em `surface-card`). Os `border-2 border-ink`, `font-mono font-semibold` e `text-2xl
sm:text-3xl` da estética crua saíram de todos.

**Docs.** `docs/CONTA.md`, seção 9 (a linha 206): "Estética crua de `globals.css`" virou o sistema visual ascii-ui, com as regras de
formulário e o apontamento para o `TELAS.md`, seção 10. O que muda no `TELAS.md` está na seção 5 deste relatório.

## 2. Critérios de aceite, com a evidência

Ambiente: Node 26.13 (`nvm use`); o `pnpm check` e os e2e com o az falso no `PATH` e a guarda de rede (`NODE_OPTIONS=--import
.data/guardas/net-guard.mjs`, `NET_GUARD_LOG=.data/guardas/t3b-conta-rede.log`); o `pnpm check` com o banco `alvesting_t3b_test` (apagado
depois) e o Azurite do compose. Cada execução pesada tomou a trava `.data/trava-pesada` (dono `T3b-conta`), com o disco conferido antes (o
piso novo do coordenador: começar só com 6 GB livres, `--workers=2` no e2e e parar abaixo de 5 GB; o disco oscilou entre 5 e 9 GB, pelo
swap do macOS).

1. **Capturas do depois** em `docs/redesign-ascii/depois/`, 390 × 844 e 1440 × 900, o quadro e a página inteira, no padrão de nomes do
   antes: `entrar`, `cadastro`, `esqueci-senha`, `termos`, `privacidade` e, com a conta da demo, `conta`, `carteira` e `admin` (32 arquivos);
   e mais `carteira-lancamentos` (4 arquivos), a carteira com três compras, de uma conta de teste criada na demo pelo `/cadastro` e apagada
   pela própria `/conta` (a conta da demo não tem lançamento). Tiradas da demo (http://127.0.0.1:4300) com o `@playwright/test` do
   `apps/web`. A comparação com o antes (`docs/redesign-ascii/antes/entrar-*` e `carteira-*`, a estética crua; as outras telas da conta
   tinham o mesmo desenho):
   - **O que mudou, em toda tela**: o papel creme virou o canvas preto com a moldura (a casca é da T2); o h1 na mono semibold de 24 a 30 px
     virou a Geist 500 de 36 px, com o texto de 18 px em `body` embaixo e a linha da moldura fechando o cabeçalho da página; os campos de
     borda preta de 2 px viraram o `field` de 44 px (raio de 12, fio `hairline-strong`), com o rótulo em Geist 500 na tinta, e o formulário
     foi para um cartão de raio 34; o "ENTRAR" em caixa-alta na mono com borda de 2 px virou a pílula branca "Entrar" (e, nas telas com mais
     de uma ação, só a principal é pílula); as caixas de aviso de borda preta e texto mono em negrito viraram caixas de fio
     `hairline-strong` com o texto na tinta e, quando é aviso, o `[!]` em cinza.
   - **`entrar`**: o formulário é um cartão de até 448 px, alinhado à esquerda da coluna como o resto do texto; os links "Esqueci a senha"
     e "Criar conta" ficaram embaixo do cartão, com o sublinhado discreto. No celular o cabeçalho (o da T2) tem uma linha só, com o botão
     "Menu" (antes, os sete links em duas linhas).
   - **`carteira`** (a vazia, a da demo): o aviso em destaque continua o primeiro bloco depois do título, agora entre duas linhas da
     moldura; o vazio é o da T2 (o contorno tracejado com a grade `. : .`); os radios de 44 px ficaram redondos e claros quando marcados; o
     formulário num cartão, com "Lançar compra" na pílula. **Com lançamentos** (`carteira-lancamentos`): o resumo, que eram três linhas de
     termo e valor, virou a faixa de números da home; as posições, a tabela do Arc numa caixa arredondada com a ação presa à esquerda; cada
     lançamento, um cartão com "Editar" e "Apagar" escuros.
   - **`conta`**: as seções com a moldura e os títulos em Geist; a exclusão, que era só mais uma seção, ganhou o cartão de borda vermelha
     em volta da confirmação, com o botão escuro (não convida). **`admin`**: as tabelas em caixas arredondadas, as filas e as temporadas em
     cartões, os subtítulos em Geist, o `[!]` do teto. **`termos` e `privacidade`**: o texto em prosa de 64 caracteres e 16 px, os subtítulos
     em Geist de 22 px e o rascunho num quadro `[!]`.
   - **O que não mudou**: os textos, os campos, os rótulos, as mensagens, a ordem das telas (fora a `/conta` com o aceite pendente) e o
     comportamento.
2. **`pnpm check` com exit 0**: lint (o `turbo run lint` e o `prettier --check .`), tipos, testes (web: 35 arquivos, 595 testes; contratos:
   13 arquivos, 497; api: 151 arquivos verdes e 2 pulados por desenho, o emulador do Service Bus e os arquivos reais da CVM, 3.007 testes
   verdes e 9 pulados, em 5 min 23 s; `scripts/*.test.mjs`: 113) e o `docs:check` ("73 itens documentados em docs/DEPENDENCIAS.md").
3. **`pnpm build` com exit 0** (4 tarefas; as rotas da conta seguem dinâmicas, `ƒ`). O CSS do site (o arquivo que a home também baixa):
   40.041 B crus, 8.644 B com gzip e 7.722 B com brotli (a T2 mediu 41,8 KB crus); o único utilitário novo dos meus arquivos é o
   `text-display-sm`.
4. **E2e dos meus specs** (`pnpm test:e2e -- --workers=3 e2e/conta.spec.ts e2e/conta-layout.spec.ts e2e/carteira.spec.ts
   e2e/carteira-layout.spec.ts e2e/admin.spec.ts e2e/admin-layout.spec.ts e2e/account-api.spec.ts`, antes do piso novo do coordenador):
   **607 passaram, 2 pulados, 0 falha**, em 5,7 min, nos três projetos. Os 2 pulados são os de sempre (o "só com o teclado" da carteira no
   pixel-7 e no iphone-15). As mudanças do `conta-layout.spec.ts` e do `admin-layout.spec.ts` (seção 3) entraram com essa execução já em
   andamento: elas rodaram na suíte inteira (item 5).
5. **A suíte inteira** (`pnpm test:e2e -- --workers=2`), **primeira tentativa, interrompida pela regra do disco**: dos 1.149 testes,
   218 passaram e 1 foi pulado (o "só com o teclado" da carteira no pixel-7), **0 falha**, quando o disco caiu para 4 GB livres (18:32);
   parei a suíte, soltei a trava, conferi que nenhum servidor do e2e ficou de pé (a demo da 4300 e da 4310 seguiu intacta) e perguntei ao
   coordenador. Já tinham rodado, verdes, os testes novos do cabeçalho do `admin-layout.spec.ts` (os dois estados) e do
   `conta-layout.spec.ts` (no pixel-7), e partes do `account-api`, `admin`, `arena`, `carteira` e `carteira-layout`. **Decisão do
   coordenador** (pelo `ask`): entregar com a suíte parcial registrada aqui; a suíte inteira fica para o fechamento e para a conferência
   dele. Nenhuma falha fora dos meus arquivos apareceu até a parada.
6. **360 px, 44 px e axe** nas minhas telas: os specs `conta-layout` (19 estados), `carteira-layout` (8) e `admin-layout` (2), cada um nos
   três projetos: sem rolagem horizontal em 360 px, todo alvo de toque com pelo menos 43,95 px (as caixas de marcar e os radios inclusive),
   nenhum erro no console, o zod fora do JavaScript da tela, e o axe sem violação séria ou crítica na largura do aparelho e sem nenhuma
   violação em 360 px: verdes na execução dos meus specs (item 4). A folha do menu com os 7 links dentro dos 360 px e com 44 px: no
   `carteira-layout` desde a T2 (verde no item 4); a mesma medida que acrescentei ao `conta-layout` e ao `admin-layout` rodou na suíte
   parcial (item 5) no pixel-7, nos 19 estados da conta e nos 2 do painel, verde; no iphone-15 e no desktop ela fica para a suíte inteira
   do fechamento.
7. **Tokens**: `git grep -n -E "(bg|text|border|fill|stroke)-(paper|band)\b" --` nos meus arquivos: vazio (exit 1). No `apps/web/src`
   inteiro também não sobrou nenhum, no fim desta tarefa.
8. **Nenhuma dependência npm nova**: `git diff --stat -- package.json apps/*/package.json pnpm-lock.yaml pnpm-workspace.yaml` mostra só o
   `start` do `apps/web/package.json`, que é da T2. **`pnpm docs:check` ok** (item 2).
9. **A demo sem mudança de dado minha**: entrei com a conta da demo só para ver e capturar (nada lançado, editado, apagado, aceito,
   exportado, nenhuma sessão encerrada, nenhuma ação do painel). As duas contas de teste (`t3b-revisao-<ms>@example.test`, para os estados
   com dado) foram criadas pelo `/cadastro`, confirmadas pelo e-mail da `.data/outbox/` e apagadas pela própria `/conta`. Conferido no banco
   `alvesting_ensaio`, só leitura: nenhum usuário `t3b-revisao-%`, nenhum `portfolio` nem `portfolio_lot` (a conta da demo não tinha
   nenhum), a conta da demo `ADMIN` e confirmada, e na trilha só as duas linhas `account.deleted` dessas exclusões (a trilha da exclusão é
   de propósito: o código aleatório da conta, sem nome nem e-mail).
10. **As guardas**: o `.data/guardas/az-stub/calls.log` continua com 0 linhas e o `t3b-conta-rede.log` nunca foi criado (a guarda só o cria
    ao barrar).
11. **Relatório**: este arquivo; o `worker_done` vai com `--report-path` para ele.

## 3. Testes que mudaram de expectativa (e o motivo)

| Teste | Antes | Agora | Motivo |
|---|---|---|---|
| `components/wallet-lots.spec.tsx:83` | a `legend` do modo de preço com `class="font-mono text-sm font-semibold"` | `class="font-display text-sm font-medium text-ink"` | a legenda segue o rótulo dos campos (Geist 500 na tinta); a T2 deixou a classe velha no `form-kit.tsx` de propósito, para os dois mudarem juntos |
| `e2e/conta-layout.spec.ts` e `e2e/admin-layout.spec.ts`, "em 360 px não rola na horizontal, o cabeçalho cabe e os alvos de toque têm pelo menos 44 px" | o laço mede os links do `banner`, que, com a folha do menu fechada (`display: none`), são só a marca | abre o menu (`e2e/menu.ts`), exige pelo menos 8 links no `banner` (a marca e os 7), cada um dentro de 360 px e com 43,95 px de altura, e confere que o Esc fecha a folha | completa a troca da T2 (plano 5.1): é o que ela fez no `carteira-layout.spec.ts`. Aperta o teste, não afrouxa |

Conferidas, sem mudança minha: as linhas (c) das tabelas 5.1 e 5.2 que a T2 trocou na fase 1 (hoje: `conta.spec.ts` 73 e 727,
`conta-layout.spec.ts` 208, `carteira.spec.ts` 166 e 1028-1029, `carteira-layout.spec.ts` 156-170 e 234) e as que não mudam (`admin-forms.spec.tsx` 93 e 98, a classe
`min-w-0 pt-2.5` do `CheckField`, que ficou; o resto de `account-forms.spec.tsx`, `wallet-panels.spec.tsx`, `legal-text.spec.tsx` e dos
`page.spec.tsx`): todos verdes.

## 4. Desvios e decisões

1. **O formulário é flex com vão** (`flex flex-col gap-3`, antes `space-y-4`): a região de status vazia é `sr-only` (fora do fluxo) e deixava
   16 px sobrando abaixo do botão, dentro do cartão.
2. **O resultado da carteira fica na tinta**, sem `data-up`/`data-down`: o sistema só aceita a cor de dado com o glifo `▲ ▼ ■`, e o glifo
   mudaria o texto que o e2e compara por igualdade (o `globals.css` não tem o glifo por `::before` que o plano previa). O sinal e a palavra
   seguem dizendo ganho ou perda.
3. **O painel não tem pílula branca**: as ações dele são operação com confirmação, e nenhuma é o convite da tela.
4. **CSS novo** (o CSS do site é um arquivo só, que a home também baixa): só o utilitário `text-display-sm` (os subtítulos dos textos
   legais). Todo o resto já existia em outro arquivo; troquei o `gap-4`, o `pl-3` e o `pt-3` que tinha usado pelos `gap-3`, `pl-2` e `pt-4`
   que já estavam no CSS. Nenhum valor arbitrário novo.
5. **Os lançamentos e os `Facts` da conta vão até 672 px** (`max-w-2xl`, já no CSS): na coluna de 1200 px, um cartão de ponta a ponta com
   três pares deixava um vão grande entre o termo e o valor.
6. **O botão que envia, desativado durante o envio**, fica com o fundo `surface-strong` e a borda da pílula (`.btn` tem
   `disabled:bg-surface-strong` e não troca a borda). Ficou bom (o `DotSpinner` só aparece sobre o escuro), mas é do `globals.css`: se o
   fechamento quiser a borda `hairline` no `btn-primary` desativado, é uma linha lá.

## 5. Para o TELAS.md (o fechamento escreve)

- **Seção 10, um parágrafo novo "Formulários e avisos"** (vale para a conta, a carteira e o painel): o `PageHead` com o título e o texto em
  `text-lead`; o formulário num cartão (`card`, até 448 px); o envio na pílula branca só quando é a ação principal da superfície (o `primary`
  do `AccountForm`), e sair, excluir a conta, o Google e as ações do painel no `btn`; o cartão da exclusão com a borda `semantic-error`; os
  rótulos e as legendas em Geist 500 de 14 px na tinta; o erro do formulário (`role="alert"`) com a borda `semantic-error`, o status com a
  `hairline-strong`; aviso de página é `[!]` em cinza numa caixa `hairline-strong` (a carteira, os textos que mudaram, o teto não
  configurado, o rascunho dos textos legais); o `DotSpinner` ao lado de "Enviando…".
- **Seção 9 (a carteira), a tabela "O que mostra"**:
  - "Título e avisos": "e o aviso da carteira, em destaque" vira "e o aviso da carteira, numa caixa com o `[!]` em cinza".
  - "Resumo": acrescentar "na faixa de números da home (três células divididas por um fio numa caixa de borda; uma embaixo da outra no
    celular, lado a lado a partir de 768 px), com o percentual e a palavra embaixo do resultado".
  - "Posições": "nunca só a cor (a estética é preto sobre papel)" vira "nunca só a cor (o valor fica na tinta: a cor de dado só vale com o
    glifo ▲ ▼ ■, que mudaria o texto que o e2e compara)".
  - "Lançamentos": "Um cartão por lançamento" vira "Um cartão (`card`, até 672 px) por lançamento", e "com os botões Editar e Apagar" ganha
    "(`btn`)"; a pergunta do apagar fica num quadro tracejado dentro do cartão.
  - "Lançar uma compra": "O formulário (abaixo), num cartão, com a pílula branca 'Lançar compra'".
- **Seção 8 (o painel)**, depois da tabela: cada mensagem da DLQ e cada temporada num `card`, as falhas recentes com o fio `semantic-error`,
  os formulários de nova temporada, reprocesso e evento num cartão, e nenhuma ação do painel na pílula branca.
- **Seção 1 ou 10, os textos legais**: em prosa (`prose-md`, até 64 caracteres por linha), os subtítulos em Geist 500 (`display-sm` e
  `title`), o rascunho numa caixa `[!]`; a versão, a vigência e o SHA-256 (na mono) no `PageHead`.

## 6. O que ficou para depois

- Não verificado: iPhone e Android físicos, leitor de tela de verdade (só o axe e o WebKit e o Chromium do Playwright).
- A DLQ com mensagens e os rascunhos de temporada só existem no banco do e2e (a demo não tem Service Bus): o desenho deles foi conferido
  pelo e2e (`admin-layout.spec.ts`: 360 px, 44 px, axe) e pelo código, sem captura.

## 7. Arquivos tocados

Só no working tree; nada no índice.

- `apps/web/src/app/`: `entrar/page.tsx`, `cadastro/page.tsx`, `verificar-email/page.tsx`, `esqueci-senha/page.tsx`,
  `redefinir-senha/page.tsx`, `conta/page.tsx`, `carteira/page.tsx`, `admin/page.tsx` (os `termos` e `privacidade` não mudaram: usam o
  `legal-document.tsx`).
- `apps/web/src/components/`: `form-kit.tsx`, `account-forms.tsx`, `admin-panels.tsx`, `wallet-lots.tsx`, `wallet-panels.tsx`,
  `legal-document.tsx`, `legal-text.tsx`, `wallet-lots.spec.tsx` (o `admin-forms.tsx` não mudou: o envio dele fica no `btn` pelo padrão do
  `primary`).
- `apps/web/e2e/`: `conta-layout.spec.ts`, `admin-layout.spec.ts`.
- `docs/CONTA.md` (a linha 206).
- `docs/redesign-ascii/depois/`: 36 capturas novas, as 32 pedidas (`entrar`, `cadastro`, `esqueci-senha`, `conta`, `carteira`, `admin`,
  `termos` e `privacidade`, em 390 e 1440, o quadro e a página inteira) e a `carteira-lancamentos` (390 e 1440, quadro e inteira).
- `docs/redesign-ascii/relatorios/conta.md` (este).

Fora do git: os scripts de captura e de estados ficaram na pasta de trabalho do agente.
