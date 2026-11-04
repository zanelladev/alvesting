# ADR 0013: Node 26 LTS

- **Status:** aceita
- **Data:** 31/10/2026
- **Origem:** `docs/PLANO.md`, §5.14 e §0.1 (decisão deliberada)

## Contexto

O Node 26.13.0 é LTS desde 28/10/2026 (`nodejs.org/dist/index.json`). O Artur pediu a versão mais recente. Uma revisão externa sugeriu o Node 24 (plano, §0.1).

## Decisão

Node 26.13.0 em todo o projeto: `.nvmrc`, `engines` do `package.json` (`>=26.13 <27`) e o CI, que lê o `.nvmrc`. A máquina do Artur continua com o Node 20 como padrão; o projeto usa o 26 pelo nvm.

## Consequências

- O Prisma 7.10.1 declara `engines` `>=24.0`, que cobre o 26. O preinstall dele imprime uma mensagem que cita só até o 24. É aviso, não erro (`docs/DEPENDENCIAS.md`, Diferenças).
- Next 16.4, NestJS 12 e Vitest 5 rodaram no 26 no build, nos testes e no e2e da etapa 1.
- Se uma dependência quebrar no 26, a volta é para o Node 24 LTS por um ADR novo, mudando `.nvmrc`, `engines` e o CI no mesmo PR.

## Alternativas consideradas

- **Node 24 LTS:** é a sugestão da revisão. Fica como plano B; uma dependência que quebrar no 26 é o gatilho.
