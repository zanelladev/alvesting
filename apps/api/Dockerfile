# Imagem da API: UMA imagem, quatro papéis, escolhidos pelo comando do contêiner (o Container Apps manda o
# `command` de cada app e job, ver infra/modules/containerapps.bicep). Sem comando, sobe o papel HTTP.
#   node dist/main.js                                        HTTP + SSE            ca-api
#   node dist/worker.js                                      consome as filas      ca-worker-data
#   node dist/decide.js                                      1 mensagem e sai      job-worker-decisions
#   node dist/schedule.js <nome>                             publica mensagens     job-sched-*
#   sh -c 'prisma migrate deploy && node dist/db-roles-cli.js'  migrations e login da api   job-migrate
# Os quatro primeiros recebem a telemetria pelo NODE_OPTIONS da etapa final (--import do dist/telemetry/preload.js).
#
# Contexto de build: a raiz do monorepo.
#   docker build -f apps/api/Dockerfile -t alvesting-api .
# Sem segredo e sem prompt na imagem: tudo vem do ambiente em execução, e o .dockerignore deixa os .env* de fora.
# A versão do Node é a do .nvmrc; a do pnpm é a do campo packageManager do package.json.

# openssl: o Prisma escolhe o binário do motor de migrations pela versão do OpenSSL que enxerga. Sem o pacote
# (a imagem slim não traz) ele cai no 1.1.x, que não roda no Debian 12. Vale para a etapa que baixa o binário
# (build) e para a que o executa (runtime), por isso fica na base das duas.
FROM node:26.13.0-bookworm-slim AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS build
RUN npm install --global pnpm@12.16.1
WORKDIR /repo
# Só os package.json primeiro: a instalação fica em cache enquanto as dependências não mudam.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile --filter "@alvesting/api..."
COPY apps/api apps/api
COPY packages packages
ENV TURBO_TELEMETRY_DISABLED=1
# O turbo cumpre o grafo do turbo.json: prisma generate, build dos contratos e nest build.
RUN pnpm exec turbo run build --filter=@alvesting/api
# Só o que roda em produção, com os pacotes do workspace copiados (não linkados) para dentro de /out.
RUN pnpm --filter @alvesting/api deploy --prod /out

FROM base AS runtime
# O cliente do PostgreSQL 17 (pg_dump, pg_restore e psql), só nesta etapa: o backup-verify (fila maintenance, no ca-worker-data) chama o
# pg_dump e o pg_restore pelo PATH, e o código recusa binário de outro major que o do servidor (17). O Debian 12 só tem o cliente 15,
# então o 17 vem do repositório oficial PGDG (apt.postgresql.org, suíte bookworm-pgdg), com a chave do próprio PostgreSQL (ACCC4CF8, no
# caminho e com o comando que a página de download do PostgreSQL manda usar) e o MAJOR FIXO no nome do pacote. A impressão digital da chave
# é conferida contra a que a mesma página publica ("Verify the key"): uma chave baixada que não seja essa derruba o build, e o arquivo tem
# de ter UMA chave só (o `signed-by` do apt confia em TODAS as chaves do arquivo, então uma segunda, depois da certa, passaria). A versão menor vem
# do apt no build (o PGDG mantém uma série de versões menores; um pacote com a versão exata quebraria o build quando ela saísse do
# repositório). O curl e o gpg só servem para baixar e conferir a chave, e saem no fim. O último comando confere o major: um repositório
# que entregue outro derruba o build.
# ponytail: o postgresql-client-common depende do perl do Debian (o /usr/bin/pg_dump é um wrapper em Perl que escolhe a versão), uns 40 MB
# a mais. Se a imagem pesar demais, o caminho é copiar só /usr/lib/postgresql/17/bin de uma etapa de build e pôr essa pasta no PATH.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gpg \
    && install -d /usr/share/postgresql-common/pgdg \
    && curl -fsSL -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    && test "$(gpg --show-keys --with-colons /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc | awk -F: '$1 == "pub" { n++ } $1 == "fpr" && !f { f = $10 } END { print n " " f }')" = "1 B97B0AFCAA1A47F044F244A07FCC7D46ACCC4CF8" \
    && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-client-17 \
    && apt-get purge -y --auto-remove curl gpg \
    && rm -rf /var/lib/apt/lists/* /root/.gnupg \
    && pg_dump --version | grep -q '(PostgreSQL) 17\.' \
    && pg_restore --version | grep -q '(PostgreSQL) 17\.'
# CHECKPOINT_DISABLE: o CLI do Prisma (job-migrate) não precisa falar com o servidor de telemetria dele.
# NODE_OPTIONS: --import ./dist/telemetry/preload.js liga o OpenTelemetry para o Application Insights ANTES do ponto de entrada carregar
# qualquer biblioteca (a api é ESM: os ganchos de módulo têm de existir antes do `import` do pg, do http e do SDK da Azure; ver
# apps/api/src/telemetry/telemetry.ts). Vale para os quatro papéis sem mexer no comando de nenhum. Sem APPLICATIONINSIGHTS_CONNECTION_STRING
# (o job-migrate, um `docker run` local) o arquivo não faz nada. O WORKDIR é /app: o caminho relativo resolve dentro da imagem.
ENV NODE_ENV=production \
    API_PORT=8080 \
    NODE_OPTIONS="--enable-source-maps --import ./dist/telemetry/preload.js" \
    CHECKPOINT_DISABLE=1
WORKDIR /app
# O Bicep supõe, no WORKDIR: dist/, node_modules/ com o CLI do Prisma, prisma/ e prisma.config.ts (docs/INFRA.md, 2.8).
COPY --from=build /out/package.json ./
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
COPY --from=build /out/prisma ./prisma
COPY --from=build /out/prisma.config.ts ./
USER node
EXPOSE 8080
CMD ["node", "dist/main.js"]
