# Build context is the repository root (npm workspace, Issue #755).
# Dependencies are hoisted to the root, so the app cannot build from its own
# directory: there is no local package-lock.json and `next` lives in /app/node_modules.
#
# Debian slim (glibc) is used because Next.js ships glibc-native swc binaries.
FROM node:22-slim AS base

WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

# NEXT_PUBLIC_* values are inlined at build time; provide defaults so a bare
# `docker build` succeeds. Override with --build-arg for other environments.
ARG NEXT_PUBLIC_SOROBAN_RPC_URL=https://soroban-testnet.stellar.org
ARG NEXT_PUBLIC_HORIZON_URL=https://horizon-testnet.stellar.org
ARG NEXT_PUBLIC_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
ARG NEXT_PUBLIC_STELLAR_ENV=testnet
ARG NEXT_PUBLIC_API_URL=http://localhost:5001
ARG NEXT_PUBLIC_WS_URL=ws://localhost:5001/ws
ARG NEXT_PUBLIC_BASE_PATH=/agro
ENV NEXT_PUBLIC_SOROBAN_RPC_URL=$NEXT_PUBLIC_SOROBAN_RPC_URL \
    NEXT_PUBLIC_HORIZON_URL=$NEXT_PUBLIC_HORIZON_URL \
    NEXT_PUBLIC_NETWORK_PASSPHRASE=$NEXT_PUBLIC_NETWORK_PASSPHRASE \
    NEXT_PUBLIC_STELLAR_ENV=$NEXT_PUBLIC_STELLAR_ENV \
    NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL \
    NEXT_PUBLIC_BASE_PATH=$NEXT_PUBLIC_BASE_PATH

# Workspace manifests + root lockfile + toolchain guard required by preinstall.
COPY package.json package-lock.json ./
COPY scripts/check-toolchain.cjs ./scripts/check-toolchain.cjs
COPY client/package.json ./client/package.json
COPY agro-production/client/package.json ./agro-production/client/package.json
COPY packages/wallet-core/package.json ./packages/wallet-core/package.json

RUN npm ci

# Source needed to build the agro client workspace and its local dependencies.
COPY packages/wallet-core ./packages/wallet-core
COPY agro-production/client ./agro-production/client

RUN npm run build --workspace=agro-production-client

FROM node:22-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001
ENV HOSTNAME="0.0.0.0"
ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 1001 nodejs \
 && useradd --system --uid 1001 --gid nodejs appuser

# Standalone output keeps the workspace path: server.js lands under agro-production/client/.
COPY --from=base /app/agro-production/client/.next/standalone ./
COPY --from=base /app/agro-production/client/.next/static ./agro-production/client/.next/static
COPY --from=base /app/agro-production/client/public ./agro-production/client/public

USER appuser

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD curl -fsS http://localhost:3001/ >/dev/null || exit 1

CMD ["node", "agro-production/client/server.js"]
