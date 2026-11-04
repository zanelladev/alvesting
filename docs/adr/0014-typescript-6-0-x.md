# ADR 0014: TypeScript 6.0.x

- **Status:** aceita
- **Data:** 31/10/2026
- **Origem:** `docs/PLANO.md`, §5.14 (decisão deliberada)

## Contexto

O `typescript-eslint` 8.72.1 declara `typescript >=4.8.4 <6.1.0` no peerDependencies (conferido em 31/10/2026). Um TypeScript 6.1 ou mais novo fica fora do lint com checagem de tipos, que é o que o projeto usa.

## Decisão

TypeScript 6.0.3, com versão exata nos workspaces que o usam.

## Consequências

- O peer do `typescript-eslint` bate com a versão instalada.
- Quando o `typescript-eslint` aceitar o 6.1 ou mais novo, o TypeScript sobe num PR próprio, e este ADR é atualizado ou substituído por um novo.
- A linha de `typescript` em `docs/DEPENDENCIAS.md` cita este ADR.

## Alternativas consideradas

- **TypeScript 6.1 ou mais novo:** descartado. O lint com checagem de tipos não aceita a versão. Voltar para o 5.x não foi avaliado.
