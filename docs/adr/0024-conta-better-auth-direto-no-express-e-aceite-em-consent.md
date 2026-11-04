# ADR 0024: A conta: Better Auth direto no Express, aceite na tabela `consent` e texto legal servido pela API

- **Status:** aceita
- **Data:** 02/11/2026
- **Origem:** `docs/PLANO.md`, §3, §5.7, §8, §9 e §12; etapa 11 do §16; `docs/CONTA.md`

## Contexto

A etapa 11 pede login por e-mail e senha (verificado) e por Google, papéis, termos e privacidade com aceite versionado, exportar e excluir. O plano nomeia as tabelas do Better Auth e uma
`profile` para os termos, e deixa em aberto como o Better Auth entra no Nest e onde mora o texto legal. Seis escolhas saíram do plano ou o completam.

## Decisão

1. **O handler do Better Auth é montado direto no Express** (`toNodeHandler`, em `configure-app.ts`, depois da trava de origem e antes dos body parsers do Nest) em `/api/auth/*`. Sem o adaptador
   da comunidade (`@thallesp/nestjs-better-auth`): são poucas linhas, e o adaptador pede desligar o body parser do Nest (que o resto da API usa) e registra um guard global (a API é pública por padrão). As
   rotas do Better Auth ficam fora do envelope, como as `@Sse`; as da conta (`/api/v1/me`, `/api/v1/legal`) ficam no envelope, com guards próprios (`SessionGuard`, `RolesGuard`, `ConsentGuard`).
2. **O aceite mora em `consent`, não em `profile`.** Uma linha por (usuário, documento, versão) com o SHA-256 do texto e a data, e um gatilho do banco que recusa `UPDATE`: histórico que não se reescreve. É o desenho mínimo; o plano
   previa só "termos e versão". Nenhum outro dado de perfil existe.
3. **O texto legal são arquivos `.md` no repositório**, lidos pela API, com a versão e a vigência dentro do próprio texto (entram no hash). A API serve o texto (`GET /api/v1/legal`, sem cache) e grava o hash no aceite, então o
   que o usuário aceita é, por construção, o que a API vai exigir. Um teste congela cada versão: editar um texto já publicado sem subir a versão reprova.
4. **O aceite é exigido no cadastro, conferido antes de olhar se o e-mail existe** (hook `before` do Better Auth), para a resposta sem aceite ser igual para e-mail novo e repetido; e de novo na criação do usuário (defesa em
   profundidade). No Google o cadastro é explícito (`requestSignUp` com o aceite em `additionalData`): entrar com o Google não cria conta sozinho.
5. **Sem ligação automática entre conta de senha e conta Google pelo e-mail** (`disableImplicitLinking`). Com ela, quem cadastrasse o e-mail de outra pessoa sem verificá-lo ficaria com uma senha dentro da conta que a vítima criasse
   depois pelo Google (sequestro de cadastro). O custo é pequeno: quem tem conta por senha entra com a senha.

6. **O Better Auth nasce fechado (revisão de fechamento, 02/11/2026).** Só as rotas que o site usa estão abertas; o resto responde 404 (`CLOSED_PATHS`) e um teste lista as rotas do pacote para reprovar a
   que uma atualização trouxer. O corpo de `/api/auth/*` tem teto de 16 KB (o `toNodeHandler` lê o corpo inteiro e o limite do Nest não vale ali). `onAPIError: { throw: true }` tira o log próprio do Better Auth
   (fora do `redactPii`), a conferência de origem e de CSRF fica ligada em todo ambiente, a exclusão da conta é uma transação só (`beforeDelete`) e o P2002 da criação do usuário vira a resposta genérica do
   e-mail repetido (extensão de query do Prisma passada ao adaptador).

Complementos: dados mínimos (hooks zeram IP, navegador, foto e os tokens do Google); papel numa coluna `input: false` e promoção só pelo comando `account:promote`; o IP do limite de tentativas vem do `X-Azure-SocketIP` atrás do
Front Door; o e-mail sai pelo Communication Services com a connection string (a identidade gerenciada ficou de fora).

## Consequências

- Duas famílias de resposta na API: a do Better Auth em `/api/auth/*` e o envelope no resto. O site já trata as duas (a parte 2 usa `fetch`, sem o cliente do Better Auth).
- Texto jurídico novo = arquivo novo + versão nova + linha em `FROZEN` + novo aceite de todos. É deliberado.
- Cadastro nunca verificado guarda o e-mail até alguém limpar (fila `maintenance`, etapa 10). Anotado em `docs/CONTA.md`.
- Atrás do Front Door o limite de tentativas depende de o `X-Azure-SocketIP` chegar à origem e não ser sobrescrito por quem chama; a documentação não garante a segunda metade. O WAF (30 por minuto por IP em `/api/auth/*`) é o limite de verdade.
- `better-auth` 1.7.15 em vez da 1.7.14 do plano (a mais nova no dia). O pnpm 12 barrou a versão por ter menos de 1 dia; a exceção que ele gravou foi desfeita quando o pacote completou 1 dia.

## Alternativas consideradas

- **Adaptador da comunidade para o Nest.** Descartado pelo motivo do item 1.
- **Better Auth em um processo à parte.** Mais um serviço, mais uma identidade e mais um segredo para um TCC; a API já tem o banco e a trava de origem.
- **Aceite como colunas do usuário** (`terms_version`, `terms_accepted_at`). Não guarda o histórico nem o hash, e a versão nova apagaria a prova da anterior.
- **Texto legal em TypeScript no pacote de contratos**, para o site importar. O site e a API poderiam divergir numa troca de versão; servir o texto pela API garante que o usuário aceite o que ela exige.
- **Identidade gerenciada para o Communication Services.** Melhor que a chave, mas a documentação lida não diz qual papel do Azure RBAC basta para enviar (`docs/CONTA.md`); sem isso a troca seria chute.
