FROM node:22.12-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Generate Prisma client artifacts into node_modules/.prisma/client.
# npm run build also invokes prisma generate, but running it explicitly
# here ensures the generated files are present before tsc runs and
# makes the generation step visible in the layer cache.
RUN npx prisma generate
RUN npm run build

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --timeout=5 -q -O /dev/null http://localhost:5000/health 2>/dev/null; test $? -le 1

# Production startup: do NOT run `prisma db push` here — schema changes must
# go through the migration workflow (prisma migrate deploy), not an
# unguarded push. The generated client is already present from the build stage.
CMD ["node", "dist/index.js"]
