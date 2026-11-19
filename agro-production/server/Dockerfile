FROM node:22.13.0-slim AS base

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/
COPY prisma.config.ts ./

RUN PRISMA_GENERATE_DATABASE_URL=postgresql://prisma-generate:unused@localhost:5432/prisma_generate npm ci

RUN PRISMA_GENERATE_DATABASE_URL=postgresql://prisma-generate:unused@localhost:5432/prisma_generate npx prisma generate

COPY tsconfig.json ./
COPY src ./src/

RUN npm run build

FROM node:22.13.0-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

RUN groupadd --system --gid 1001 nodejs
RUN useradd --system --uid 1001 --gid nodejs appuser

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/prisma ./prisma
COPY --from=base /app/prisma.config.ts ./prisma.config.ts
COPY --from=base /app/dist ./dist
COPY --from=base /app/package.json ./

USER appuser

EXPOSE 5001

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5001/health', (res) => { if (res.statusCode !== 200) throw new Error(res.statusCode) })" || exit 1

CMD ["npm", "start"]
