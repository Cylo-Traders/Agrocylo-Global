# Docker Deployment Guide

This guide covers containerized setup and deployment using Docker and Docker Compose.

## Prerequisites

- Docker 20.10+
- Docker Compose 2.0+

### Installation

**macOS and Windows:**
Install [Docker Desktop](https://www.docker.com/products/docker-desktop)

**Linux:**
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER  # Add current user to docker group
```

## Quick Start with Docker Compose

The fastest way to run the entire stack (PostgreSQL, Redis, Backend):

### 1. Create docker-compose.yml

In the project root (or `server` directory):

```yaml
version: '3.9'

services:
  postgres:
    image: postgres:15-alpine
    container_name: agrocylo-postgres
    environment:
      POSTGRES_USER: agrocylo
      POSTGRES_PASSWORD: agrocylo123
      POSTGRES_DB: agrocylo_db
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U agrocylo"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: agrocylo-redis
    volumes:
      - redis_data:/data
    ports:
      - "6379:6379"
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    build:
      context: ./server
      dockerfile: Dockerfile
    container_name: agrocylo-backend
    environment:
      NODE_ENV: development
      PORT: 5000
      DATABASE_URL: postgresql://agrocylo:agrocylo123@postgres:5432/agrocylo_db
      REDIS_URL: redis://redis:6379
      SUPABASE_URL: ${SUPABASE_URL}
      SUPABASE_ANON_KEY: ${SUPABASE_ANON_KEY}
      SUPABASE_SERVICE_ROLE_KEY: ${SUPABASE_SERVICE_ROLE_KEY}
      JWT_SECRET: ${JWT_SECRET:-dev-secret-change-in-production}
    ports:
      - "5000:5000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    volumes:
      - ./server:/app
      - /app/node_modules
    command: npm run dev

volumes:
  postgres_data:
  redis_data:
```

### 2. Create .env.docker

In the project root:

```bash
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-key
JWT_SECRET=your-secret-key-min-32-chars
```

### 3. Start the Stack

```bash
docker-compose up -d
```

Services will be available at:
- Backend: `http://localhost:5000`
- PostgreSQL: `localhost:5432`
- Redis: `localhost:6379`
- Prisma Studio: Run `npm run prisma:studio` inside backend container

### 4. Run Migrations

```bash
# Access the backend container
docker-compose exec backend npx prisma migrate dev

# Or run with docker
docker-compose exec backend npm run dev
```

### 5. Stop the Stack

```bash
docker-compose down
```

To also remove volumes (database data):
```bash
docker-compose down -v
```

## Building a Docker Image

### 1. Create Dockerfile

In `server/Dockerfile`:

```dockerfile
FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Build TypeScript
RUN npm run build

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/health', (res) => { if (res.statusCode !== 200) throw new Error(res.statusCode) })"

# Start server
CMD ["npm", "start"]
```

### 2. Build the Image

```bash
docker build -t agrocylo-backend:latest ./server
```

### 3. Run the Container

```bash
docker run -p 5000:5000 \
  -e DATABASE_URL="postgresql://agrocylo:agrocylo123@localhost:5432/agrocylo_db" \
  -e SUPABASE_URL="https://your-project.supabase.co" \
  -e SUPABASE_ANON_KEY="your-key" \
  -e SUPABASE_SERVICE_ROLE_KEY="your-key" \
  -e JWT_SECRET="your-secret" \
  agrocylo-backend:latest
```

## Production Deployment

### Environment Variables

For production, use secure methods to pass secrets:

**Using env file:**
```bash
docker run --env-file production.env agrocylo-backend:latest
```

**Using Docker Secrets (Swarm mode):**
```yaml
services:
  backend:
    image: agrocylo-backend:latest
    secrets:
      - db_password
      - jwt_secret
```

**Using environment variables in CI/CD:**
```bash
docker run \
  -e DATABASE_URL="$DATABASE_URL" \
  -e JWT_SECRET="$JWT_SECRET" \
  agrocylo-backend:latest
```

### Multi-stage Build

For smaller production images:

```dockerfile
FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

# Copy built application from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

EXPOSE 5000
CMD ["npm", "start"]
```

## Docker Compose for Different Environments

### Development

```yaml
services:
  backend:
    build: ./server
    volumes:
      - ./server:/app  # Hot reload
    environment:
      NODE_ENV: development
```

### Testing

```yaml
services:
  postgres:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: agrocylo_test
```

### Production

```yaml
services:
  backend:
    image: agrocylo-backend:v1.0.0
    restart: always
    environment:
      NODE_ENV: production
    depends_on:
      - postgres
      - redis
```

## Common Docker Commands

```bash
# View running containers
docker ps

# View container logs
docker logs agrocylo-backend
docker logs -f agrocylo-backend  # Follow logs

# Access container shell
docker exec -it agrocylo-backend sh

# Run command in container
docker exec agrocylo-backend npx prisma migrate dev

# Stop container
docker stop agrocylo-backend

# Remove container
docker rm agrocylo-backend

# Remove image
docker rmi agrocylo-backend:latest
```

## Docker Compose Commands

```bash
# Start services
docker-compose up -d

# View logs
docker-compose logs
docker-compose logs -f backend

# Run migrations
docker-compose exec backend npx prisma migrate dev

# Stop services
docker-compose down

# Remove volumes too
docker-compose down -v

# Rebuild image
docker-compose build --no-cache
docker-compose up -d
```

## Troubleshooting

### Port Already in Use

```
Error: bind: address already in use
```

Solution: Change port in docker-compose.yml:
```yaml
ports:
  - "5001:5000"  # Use 5001 instead of 5000
```

### Database Connection Refused

```
Error: connect ECONNREFUSED postgres:5432
```

Solution: Ensure PostgreSQL service is healthy:
```bash
docker-compose exec postgres pg_isready -U agrocylo
```

### Out of Disk Space

Remove unused images and containers:
```bash
docker system prune -a  # Remove all unused images
docker volume prune     # Remove unused volumes
```

### Permission Denied

On Linux, add user to docker group:
```bash
sudo usermod -aG docker $USER
# Log out and log back in
```

### Container Exits Immediately

Check logs:
```bash
docker-compose logs backend
```

### Slow Performance on macOS/Windows

Docker Desktop file sharing is slow. For development:
```yaml
volumes:
  - ./server:/app:cached  # Use cached flag
```

## Performance Optimization

### Reduce Image Size

```dockerfile
# Use alpine variant
FROM node:20-alpine

# Use npm ci instead of npm install
RUN npm ci --only=production
```

### Caching Layers

```dockerfile
# Expensive layers early are cached
COPY package*.json ./
RUN npm ci

# Cheap layer late
COPY . .
```

### Resource Limits

```yaml
services:
  backend:
    resources:
      limits:
        cpus: '2'
        memory: 2G
      reservations:
        cpus: '1'
        memory: 1G
```

## CI/CD Integration

### GitHub Actions

```yaml
name: Build and Push Docker Image

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: docker/build-push-action@v4
        with:
          context: ./server
          push: true
          tags: myregistry/agrocylo-backend:latest
          secrets:
            docker_username: ${{ secrets.DOCKER_USERNAME }}
            docker_password: ${{ secrets.DOCKER_PASSWORD }}
```

## See Also

- [SETUP.md](./SETUP.md) - Local development setup
- [ENVIRONMENT.md](./ENVIRONMENT.md) - Configuration reference
- [Official Docker Docs](https://docs.docker.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
