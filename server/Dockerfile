FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

RUN PRISMA_GENERATE_DATABASE_URL=postgresql://prisma-generate:unused@localhost:5432/prisma_generate npx prisma generate
RUN npm run build

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --timeout=5 -q -O /dev/null http://localhost:5000/health 2>/dev/null; test $? -le 1

CMD ["sh", "-c", "npx prisma db push --accept-data-loss --schema=prisma/schema.prisma && npm start"]
