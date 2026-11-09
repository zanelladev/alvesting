# ADR 0025: As telas da conta: uma origem só, leitura do servidor sem cache e formulários que exigem JavaScript

- **Status:** aceita (o item 1 em parte substituído pelo ADR 0039: no perfil econômico, sem Front Door, o site passou a repassar `/api/*` à api)
- **Data:** 02/11/2026
- **Origem:** `docs/PLANO.md`, §9, §12 e §13; etapa 11 do §16 (parte 2); `docs/CONTA.md`, seção 9; ADRs 0018, 0023 e 0024

## Contexto

A parte 1 da etapa 11 pôs o login na api (Better Auth em `/api/auth/*`, rotas `/api/v1/me*`). As telas (`/entrar`, `/cadastro`, `/conta`...) precisam falar com ela, e três coisas do desenho não saem de graça:

- O cookie da sessão é `SameSite=Lax`, a api confere o `Origin` das mutações contra o `PUBLIC_URL` e o link do e-mail aponta para `PUBLIC_URL/api/auth/...`. Com o site e a api em origens diferentes, o login não fecha.
- A conta é dado de uma pessoa só, e o site tem um cache de dados (ADR 0023, `docs/API.md`, seção 2) que serve a mesma resposta a todos.
- O formulário de senha é o lugar onde um erro de JavaScript vira vazamento: um `<form>` sem handler faz um GET com a senha na URL.

## Decisão

1. **O navegador fala com uma origem só, e o site não tem caminho de produção para isso.** Na Azure o Front Door manda `/api/*` para a api e `/*` para o site. Em dev o `rewrites` do `next.config.ts` repassa `/api/*` à api **só na fase do servidor de
   desenvolvimento**. No e2e um Front Door imitado (`apps/web/e2e/front-door.ts`) faz o papel do de verdade, com a api e o site da conta atrás da trava de origem: o `X-Azure-FDID` do SSR para a api é provado no e2e, e não só na Azure. Ele serve **https**, com um certificado autoassinado gerado na subida
   (o `openssl`): a api emite o cookie de produção (`Secure`, com o prefixo `__Secure-`, que o WebKit só aceita em https) e o e2e o exercita em Chromium e em WebKit. O `Secure` vem do esquema do `PUBLIC_URL`, e não do `NODE_ENV`.
2. **Tudo que o servidor lê para a conta passa por `apiGetFresh`:** `cache: 'no-store'`, sem `next.revalidate` e sem tags. O cookie vai só para a api, filtrado (`alvesting.` e `__Secure-alvesting.`) e como veio. As páginas públicas da arena **não leem a
   sessão**; o cabeçalho tem só o link fixo "Conta", e a `/conta` manda quem não entrou para `/entrar`. O servidor chama `GET /api/v1/me` (e não `/api/auth/get-session`, que cairia no balde "sem IP confiável" do Better Auth).
3. **Os formulários exigem JavaScript, e dizem isso.** O `<fieldset>` nasce desativado e só é ativado depois da hidratação, o método é `post` e o `<noscript>` explica. Os textos legais, a exportação (um link) e o redirecionamento da `/conta` não dependem dele.
4. **A api diz se o Google está configurado** (`GET /api/v1/auth/providers`, `{ google: boolean }`, pública e sem cache): é a única mudança na api desta parte. O botão só aparece com `true`.
5. **O servidor não renova o cookie da sessão.** Um Server Component não escreve cookie, então o cookie vale 7 dias a partir do login, ainda que o banco renove a sessão a cada uso (`ponytail` em `app/conta/page.tsx`).

## Consequências

- O site precisa de um Front Door (ou de um domínio comum) para a conta funcionar: no perfil econômico, com `ca-web` e `ca-api` em hosts diferentes, a sessão não fecha (já era dito em `docs/CONTA.md`).
- `/conta` e as telas de formulário são dinâmicas e lêem a api a cada visita (os textos legais e os provedores, que são leves). O LCP da home não mudou (`pnpm lighthouse`: 2,33 a 2,35 s).
- O e2e passou a subir oito servidores (entraram o site da conta e o Front Door imitado). A api da conta passou a rodar atrás da trava: o `account-api.spec.ts` manda o `X-Azure-FDID` e o IP no `X-Azure-SocketIP`.
- O login real com o Google e o aceite novo na tela não têm e2e, e o cookie `Secure` só foi exercitado atrás do Front Door imitado (https com certificado autoassinado): o certificado e o `Host` do Front Door de verdade e o iPhone físico ficam para o primeiro login na Azure (`docs/CONTA.md`, seção 11).
- O e2e precisa do `openssl` na máquina (o macOS e o `ubuntu-latest` do CI têm).
- Os módulos que vão ao navegador leem `ACCOUNT_LIMITS` pelo subcaminho `@alvesting/contracts/account-constants`, um módulo sem imports: pelo índice do pacote o zod ia junto (123 KB, 36 KB comprimidos) e atrasava o momento em que o formulário passa a valer. As etapas 12 e 13 seguem a mesma regra.

## Alternativas consideradas

- **Server Actions** (o formulário funciona sem JavaScript). O limite de tentativas do Better Auth é por IP, e a chamada sairia do servidor do site: todos os usuários dividiriam o mesmo balde. O cookie teria de ser reescrito à mão a partir da resposta da api.
- **Um Route Handler no site que repassa `/api/*`.** Seria um caminho de produção que só existe para dev, uma segunda porta para a api (o WAF e as regras do Front Door contam com `/api/*` indo direto para ela) e mais um lugar onde o `Origin` e o cookie podem se perder.
- **O cliente do Better Auth no navegador** (`better-auth/react`). Mais código no JavaScript de toda tela e uma dependência de interface a mais, para umas dez chamadas `fetch` simples (o ADR 0024 já dizia que a parte 2 usa `fetch`).
- **Ler a sessão no layout** para o cabeçalho mostrar o nome e o "Sair". Tornaria toda página da arena dinâmica por usuário, tiraria o cache de dados delas e pesaria no LCP da home.
- **`rewrites` em todos os ambientes.** O site publicado passaria a repassar `/api/*` sozinho, atrás do Front Door, sem o `X-Azure-FDID` e sem o WAF: o contrário da trava de origem (ADR 0018).
