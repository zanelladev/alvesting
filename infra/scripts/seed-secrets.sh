#!/usr/bin/env bash
# Semeia no Key Vault os segredos que o Artur preenche à mão (plano §5.7). O Bicep não cria nenhum deles:
# se criasse, cada deploy sobrescreveria o valor real. Roda DEPOIS da fase 1 do deploy (o cofre precisa
# existir) e ANTES da fase 2 (o Container App não sobe se o segredo referenciado não existe).
#
# Uso:  infra/scripts/seed-secrets.sh <nome-do-cofre>      ex.: kv-alvesting
#
# Idempotente: segredo que já tem valor real não é tocado. O valor nunca aparece na linha de comando, no
# log nem no histórico: vem de variável de ambiente, de arquivo ou de pergunta sem eco.
#
#   segredo                      de onde vem o valor
#   better-auth-secret           gerado ao acaso (ou ALVESTING_SECRET_BETTER_AUTH_SECRET)
#   revalidate-secret            gerado ao acaso (ou ALVESTING_SECRET_REVALIDATE_SECRET)
#   quotes-secret                gerado ao acaso (ou ALVESTING_SECRET_QUOTES_SECRET): 384 bits, que o site e a api leem
#                                (a rota interna de cotações, docs/API.md, seção 6)
#   openrouter-api-key           ALVESTING_SECRET_OPENROUTER_API_KEY, ou pergunta
#   google-oauth-client-secret   ALVESTING_SECRET_GOOGLE_OAUTH_CLIENT_SECRET, ou pergunta
#   brapi-token                  ALVESTING_SECRET_BRAPI_TOKEN, ou pergunta
#   prompt-arena, prompt-chat    SÓ de arquivo: ALVESTING_SECRET_PROMPT_ARENA_FILE / ..._PROMPT_CHAT_FILE
#                                (vários parágrafos; o arquivo fica fora do repositório)
#
# Qualquer um dos de cima também aceita ALVESTING_SECRET_<NOME>_FILE (o valor é o conteúdo do arquivo).
# Os que a Azure ainda não te deu (Google OAuth, brapi, OpenRouter) ficam com o valor PENDENTE e a tag
# pendente=true, para o Container App subir; rode o script de novo quando tiver o valor. Os prompts nunca
# recebem valor provisório, e sem arquivo o segredo fica ausente. O prompt-arena é exigido pela fase 2 (o job de
# decisões o referencia): sem ele a fase 2 não sobe. O prompt-chat só entra com o chat ligado (enableOpenAI).
# Depois de gravar um prompt, a fase 2 pede a versão dele (docs/INFRA.md, passo 4). O script só lê METADADO
# (nome e tag) do cofre, nunca o valor de um segredo.
set -euo pipefail

usage() { sed -n '2,/^set -euo/p' "$0" | sed '$d; s/^# \{0,1\}//'; }

VAULT="${1:-}"
case "$VAULT" in
  -h | --help) usage; exit 0 ;;
  '') usage >&2; exit 1 ;;
esac

command -v az >/dev/null || { echo "az não encontrado (Azure CLI)." >&2; exit 1; }
command -v openssl >/dev/null || { echo "openssl não encontrado." >&2; exit 1; }

umask 077
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
VALUE="$WORK/value"
ERRORS="$WORK/errors"

forbidden() {
  cat >&2 <<EOF
Sem permissão para ler ou escrever segredos em $VAULT.
Quem semeia precisa do papel "Key Vault Secrets Officer" no cofre. Ou o deploy recebe
ALVESTING_ADMIN_PRINCIPAL_ID=\$(az ad signed-in-user show --query id -o tsv) (e atribui o papel), ou:
  az role assignment create --assignee-object-id "\$(az ad signed-in-user show --query id -o tsv)" \\
    --assignee-principal-type User --role "Key Vault Secrets Officer" \\
    --scope "\$(az keyvault show --name $VAULT --query id -o tsv)"
(o papel leva alguns minutos para valer).
EOF
  exit 1
}

# absent | pending | present. Só metadado: `list` devolve o nome e as tags, nunca o valor. O `show` baixaria o valor
# do segredo (o --query só filtra a saída): o texto dos prompts passaria pela memória do az e cada execução geraria
# um SecretGet no log de auditoria do cofre, que existe para mostrar quem leu o quê. Com -o tsv a tag ausente sai
# como None, e só "true" é pendente.
state() {
  local listing
  if ! listing="$(az keyvault secret list --vault-name "$VAULT" --query '[].[name, tags.pendente]' -o tsv --only-show-errors 2>"$ERRORS")"; then
    if grep -qi 'Forbidden\|not authorized\|AuthorizationFailed' "$ERRORS"; then forbidden; fi
    cat "$ERRORS" >&2
    exit 1
  fi
  printf '%s\n' "$listing" | awk -F'\t' -v name="$1" '
    $1 == name { found = 1; pending = ($2 == "true") }
    END { print (!found ? "absent" : (pending ? "pending" : "present")) }'
}

put() { # put <nome>   (o valor está em $VALUE; a ausência de --tags limpa a tag pendente)
  az keyvault secret set --vault-name "$VAULT" --name "$1" --file "$VALUE" --encoding utf-8 \
    --only-show-errors -o none
}

put_pending() { # put_pending <nome>
  az keyvault secret set --vault-name "$VAULT" --name "$1" --file "$VALUE" --encoding utf-8 \
    --tags pendente=true --only-show-errors -o none
}

# Escreve o valor em $VALUE. Retorna 1 se não houver.
read_value() { # read_value <nome> <random|ask|file>
  local var file answer
  var="ALVESTING_SECRET_$(printf '%s' "$1" | tr 'a-z-' 'A-Z_')"
  file="${var}_FILE"
  : >"$VALUE"
  if [ -n "${!file:-}" ]; then
    cat "${!file}" >"$VALUE"
  elif [ "$2" != file ] && [ -n "${!var:-}" ]; then
    printf '%s' "${!var}" >"$VALUE"
  elif [ "$2" = random ]; then
    openssl rand -base64 48 | tr -d '\n' >"$VALUE"
  elif [ "$2" = ask ] && [ -t 0 ]; then
    read -r -s -p "$1 (vazio = pendente): " answer
    echo >&2
    printf '%s' "$answer" >"$VALUE"
  fi
  [ -s "$VALUE" ]
}

seed() { # seed <nome> <random|ask|file>
  local current
  current="$(state "$1")"
  if [ "$current" = present ]; then
    printf '%-28s já existe, mantido\n' "$1"
  elif read_value "$1" "$2"; then
    put "$1"
    printf '%-28s gravado\n' "$1"
  elif [ "$current" = pending ]; then
    printf '%-28s continua PENDENTE\n' "$1"
  elif [ "$2" = file ]; then
    printf '%-28s AUSENTE: defina ALVESTING_SECRET_%s_FILE e rode de novo\n' "$1" \
      "$(printf '%s' "$1" | tr 'a-z-' 'A-Z_')"
  else
    printf 'PENDENTE' >"$VALUE"
    put_pending "$1"
    printf '%-28s PENDENTE (rode de novo quando tiver o valor)\n' "$1"
  fi
}

seed better-auth-secret random
seed revalidate-secret random
seed quotes-secret random
seed openrouter-api-key ask
seed google-oauth-client-secret ask
seed brapi-token ask
seed prompt-arena file
seed prompt-chat file

cat <<EOF

Pronto. Próximo passo: anotar a versão do prompt-arena (docs/INFRA.md, passo 4), publicar as imagens (etapa 3)
e rodar a fase 2 do deploy (docs/INFRA.md, passo 6). O prompt-arena precisa existir: a fase 2 não sobe sem ele.
Os segredos derivados (database-url, database-url-api, front-door-id, acs-connection-string,
appinsights-connection-string) já foram criados pelo Bicep na fase 1: nenhum se semeia à mão. O login da api no
Postgres (database-url-api) só passa a existir no banco quando o job-migrate roda o db:roles (docs/INFRA.md, passo 6).
EOF
