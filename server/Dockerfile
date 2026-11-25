FROM node:22.13.0-alpine

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

ENV PORT=5000
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --timeout=5 -q --spider "http://localhost:${PORT:-5000}/health" || exit 1

# Production startup only launches the compiled application. Schema changes
# must go through the ordered migration workflow. The generated client is
# already present from the build stage.
CMD ["node", "dist/index.js"]
