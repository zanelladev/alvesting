# ADR 0011: Prompt no Key Vault, não no repositório

- **Status:** aceita. **Refinada pelo ADR 0020:** a variável de ambiente vem por referência ao Key Vault (`secretRef`), nunca como valor literal no template
- **Data:** 31/10/2026
- **Origem:** `docs/PLANO.md`, §5.14 (decisão deliberada)

## Contexto

O repositório pode ficar público. O prompt da arena fica oculto durante a temporada (plano, §10), mas o público precisa poder conferir que todos os modelos receberam o mesmo texto, sem que o texto seja revelado antes do fim.

## Decisão

O texto fica no Key Vault, versionado, nos segredos `prompt-arena` e `prompt-chat` (plano, §5.7). O banco guarda só o SHA-256 e a versão do segredo. Em dev, o texto vem de variável no `.env.local`, fora do git. Nos testes, vem de um canário.

## Consequências

- O hash de cada ciclo, publicado, prova a igualdade sem revelar o texto (plano, §10).
- No fim da temporada o texto é revelado, e o hash publicado confere (padrão adotado, plano §17.4).
- O filtro de vazamento procura o canário e n-gramas de 8 palavras nos textos públicos (plano, §10).
- Nenhuma resposta da API, nenhum log e nenhuma imagem contém o texto. O teste de canário é da etapa 6.
- Trocar o prompt é uma nova versão no Key Vault, não um commit.

## Alternativas consideradas

- **Prompt no repositório:** descartado. O repositório pode ser público, e o prompt deixaria de ser oculto durante a temporada.
- **Prompt em variável de ambiente do Container Apps:** descartado. O plano proíbe segredo em variável de ambiente (§5.1); a referência ao Key Vault é o caminho. O ADR 0020 precisa o alcance: o que fica descartado é o valor literal na variável; o Key Vault consumido como variável por referência (`secretRef`, `PROMPT_ARENA` e `PROMPT_CHAT`) é o caminho adotado.
