#!/usr/bin/env bash
# Confere, na assinatura, que cada GUID de papel do infra/roles.bicep tem o nome que o comentário diz.
# Um GUID errado só aparece no meio do deploy como RoleDefinitionDoesNotExist (ou, pior, é outro papel).
# Roda ANTES da fase 1 (docs/INFRA.md, passo 0). Só lê: precisa de `az login` e de nada além disso.
#
# Uso:    infra/scripts/verify-roles.sh
# Saída:  uma linha por papel (ok ou ERRO); código 0 só se todos baterem.
set -euo pipefail

ROLES="$(cd "$(dirname "$0")/.." && pwd)/roles.bicep"

command -v az >/dev/null || { echo "az não encontrado (Azure CLI)." >&2; exit 1; }

# GUID<TAB>nome de todos os papéis da assinatura, numa chamada só.
AZURE="$(az role definition list --query '[].[name,roleName]' -o tsv --only-show-errors)"

status=0
checked=0
# roles.bicep: var <nome> = '<guid>' // <nome oficial do papel>   ->   guid|nome
while IFS='|' read -r guid want; do
  checked=$((checked + 1))
  got="$(printf '%s\n' "$AZURE" | awk -F'\t' -v g="$guid" '$1 == g { print $2 }')"
  if [ "$got" = "$want" ]; then
    echo "ok    $guid  $want"
  else
    echo "ERRO  $guid  esperava \"$want\", a Azure diz \"${got:-nenhum papel com esse GUID}\"" >&2
    status=1
  fi
done < <(sed -n "s#^var [A-Za-z]* = '\([0-9a-f-]\{36\}\)' // \(.*\)\$#\1|\2#p" "$ROLES")

[ "$checked" -gt 0 ] || { echo "nenhum papel encontrado em $ROLES" >&2; exit 1; }
exit "$status"
