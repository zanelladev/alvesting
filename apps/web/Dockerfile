# Imagem do site: build standalone do Next (output: 'standalone' no next.config.ts), servido por `node server.js`.
#
# Contexto de build: a raiz do monorepo.
#   docker build -f apps/web/Dockerfile -t alvesting-web .
# Sem segredo na imagem: FRONT_DOOR_ID e o resto vêm do ambiente em execução, e o .dockerignore deixa os .env*
# de fora. O `next build` baixa as fontes do Google Fonts (docs/DEPENDENCIAS.md) e as serve do próprio site.
# A versão do Node é a do .nvmrc; a do pnpm é a do campo packageManager do package.json.

FROM node:26.13.0-bookworm-slim AS base
RUN npm install --global pnpm@12.16.1
WORKDIR /repo

FROM base AS build
# Só os package.json primeiro: a instalação fica em cache enquanto as dependências não mudam.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json apps/web/
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile --filter "@alvesting/web..."
COPY apps/web apps/web
COPY packages packages
ENV NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1
# O turbo cumpre o grafo do turbo.json: build dos contratos e next build.
RUN pnpm exec turbo run build --filter=@alvesting/web
# Garante a pasta public/ (as artes do hero e da 404, ADR 0034): o COPY da etapa final nunca quebra, mesmo sem arquivo nela.
RUN mkdir -p apps/web/public

FROM node:26.13.0-bookworm-slim AS runtime
# HOSTNAME: o Docker põe o ID do contêiner nele, e o servidor do Next escutaria só nesse nome.
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# O standalone não leva o estático nem o public/: a documentação do Next manda copiar os dois.
# O dono é o usuário node: o Next grava cache de ISR em .next/ quando o site passar a revalidar páginas.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
