# ADR 0012: Bicep, não Terraform

- **Status:** aceita
- **Data:** 31/10/2026
- **Origem:** `docs/PLANO.md`, §5.14 (decisão deliberada)

## Contexto

A infra (etapa 2) precisa subir do zero num resource group vazio, e o what-if da segunda execução não pode mostrar mudanças (plano, etapa 2).

## Decisão

Bicep, a linguagem nativa da Azure. Na máquina de dev a Bicep CLI é instalada pelo `az bicep install` (versão 0.48.1, em `docs/DEPENDENCIAS.md`). No CI, a instalação entra na etapa 2.

## Consequências

- Sem estado para guardar. O Terraform precisa de um backend de estado com trava, mais um recurso que a própria infra teria de proteger.
- O what-if roda no CI como gate (plano, §5.10).
- A versão da Bicep CLI precisa ser a mesma na máquina e no CI. Ela fica registrada em `docs/DEPENDENCIAS.md`.

## Alternativas consideradas

- **Terraform:** descartado. Precisa de estado guardado e travado em outro lugar, e o provedor da Azure tem ciclo de versão próprio.
