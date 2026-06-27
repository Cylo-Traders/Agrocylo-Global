# Environment Configuration Guide

This document describes all environment variables used by the Agrocylo backend server.

## Quick Start

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Fill in the required variables (see "Required Variables" section below)

3. Start the server:
   ```bash
   npm run dev
   ```

## Variable Categories

### Required Variables

These variables **must** be set for the application to start.

#### Server Configuration
- **PORT**: Server port (default: 5000)
  - Type: `number`
  - Example: `5000`

- **NODE_ENV**: Application environment
  - Type: `string` (choices: `development`, `test`, `production`)
  - Default: `development`
  - Example: `development`

#### Database
- **DATABASE_URL**: PostgreSQL connection string
  - Type: `string`
  - Format: `postgresql://user:password@host:port/database`
  - Example: `postgresql://agrocylo:password@localhost:5432/agrocylo_db`
  - Note: Required for all operations

#### Supabase
- **SUPABASE_URL**: Supabase project URL
  - Type: `URL`
  - Format: `https://[project-ref].supabase.co`
  - Example: `https://abcdef123456.supabase.co`

- **SUPABASE_ANON_KEY**: Supabase anonymous key (public key)
  - Type: `string`
  - Length: ~38-40 characters
  - Used for client-side authentication

- **SUPABASE_SERVICE_ROLE_KEY**: Supabase service role key (private key)
  - Type: `string`
  - Length: ~38-40 characters
  - Used for server-side admin operations

#### Authentication
- **JWT_SECRET**: Secret key for signing JWT tokens
  - Type: `string`
  - Minimum length: 32 characters in production
  - Generate: `openssl rand -base64 32`
  - Development default: `dev-secret-change-in-production`
  - Important: Must be changed in production

### Optional Variables

These variables have sensible defaults and can be omitted.

#### Redis
- **REDIS_URL**: Redis connection URL
  - Type: `URL`
  - Default: `redis://127.0.0.1:6379`
  - Example: `redis://localhost:6379`
  - Used for: Caching, session management

#### Workers
- **RUN_WORKERS**: Enable background job workers
  - Type: `boolean`
  - Default: `false`
  - Example: `true`

#### Stellar Soroban Integration
- **RUN_CONTRACT_WATCHER**: Enable Soroban contract event watcher
  - Type: `boolean`
  - Default: `false`
  - Requires: CONTRACT_ID must be set if enabled
  - Used for: Real-time blockchain event tracking

- **CONTRACT_ID**: Stellar Soroban contract ID
  - Type: `string`
  - Example: `CADM...(56 character base32 address)`
  - Required if: `RUN_CONTRACT_WATCHER=true`

- **RPC_URL**: Stellar RPC endpoint
  - Type: `URL`
  - Default: `https://soroban-testnet.stellar.org`
  - Options:
    - Testnet: `https://soroban-testnet.stellar.org`
    - Mainnet: `https://soroban-mainnet.stellar.org`

#### Monitoring & Metrics
- **METRICS_API_KEY**: API key for accessing metrics endpoint
  - Type: `string`
  - Default: empty (no authentication)
  - Example: `your-secret-metrics-key`
  - Used for: Protecting GET /metrics endpoint

#### Storage
- **SUPABASE_PRODUCT_IMAGES_BUCKET**: Supabase bucket name for product images
  - Type: `string`
  - Default: `product-images`
  - Used for: Storing and retrieving product images

- **PRODUCT_IMAGE_PLACEHOLDER_URL**: URL for placeholder images
  - Type: `URL`
  - Default: `https://placehold.co/800x800/png?text=No+Image`
  - Used for: Displaying when product image is missing

#### WebSocket
- **WS_PATH**: WebSocket server path
  - Type: `string`
  - Default: `/ws`
  - Example: `/ws`
  - Used for: Real-time updates via WebSocket

## Environment by Stage

### Development

```bash
PORT=5000
NODE_ENV=development
DATABASE_URL=postgresql://agrocylo:password@localhost:5432/agrocylo_db
SUPABASE_URL=https://YOUR_DEV_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_DEV_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_DEV_SERVICE_KEY
JWT_SECRET=dev-secret-change-in-production
REDIS_URL=redis://127.0.0.1:6379
RUN_WORKERS=false
RUN_CONTRACT_WATCHER=false
```

### Testing

```bash
PORT=5001
NODE_ENV=test
DATABASE_URL=postgresql://agrocylo:password@localhost:5432/agrocylo_test
SUPABASE_URL=https://YOUR_TEST_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_TEST_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_TEST_SERVICE_KEY
JWT_SECRET=test-secret-key-minimum-32-characters
REDIS_URL=redis://127.0.0.1:6379
RUN_WORKERS=false
RUN_CONTRACT_WATCHER=false
```

### Production

```bash
PORT=3000
NODE_ENV=production
DATABASE_URL=postgresql://prod_user:STRONG_PASSWORD@prod_host:5432/agrocylo_prod
SUPABASE_URL=https://YOUR_PROD_PROJECT.supabase.co
SUPABASE_ANON_KEY=YOUR_PROD_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY=YOUR_PROD_SERVICE_KEY
JWT_SECRET=YOUR_STRONG_SECRET_MIN_32_CHARS
REDIS_URL=redis://prod_redis:6379
RUN_WORKERS=true
RUN_CONTRACT_WATCHER=true
CONTRACT_ID=YOUR_SOROBAN_CONTRACT_ID
RPC_URL=https://soroban-mainnet.stellar.org
METRICS_API_KEY=YOUR_METRICS_KEY
```

## Validation

The application validates environment variables on startup using `envalid`. If required variables are missing or invalid, the server will refuse to start with a clear error message.

### Production Validation

In production environment (`NODE_ENV=production`):
- `JWT_SECRET` is required and must be at least 32 characters
- `JWT_SECRET` cannot be a default value (`changeme`, `dev-secret`, etc.)
- `CONTRACT_ID` must be set if `RUN_CONTRACT_WATCHER=true`

## Secrets Management

### Development
Use the `.env` file locally (ignored by git via `.gitignore`).

### Production
Use your platform's secrets manager:
- Docker: Use `--env-file` or environment variables
- Kubernetes: Use ConfigMaps and Secrets
- Cloud platforms: Use environment variable management services
- CI/CD: Use repository secrets

Never commit `.env` files or secrets to version control.

## Troubleshooting

### Port Already in Use
If you get "Port 5000 already in use", either:
- Stop the process using that port
- Change PORT to a different value (e.g., 5001)

### Database Connection Failed
Check DATABASE_URL format:
```
postgresql://username:password@host:port/database
```

### Supabase Connection Failed
Verify:
- SUPABASE_URL is accessible
- SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are correct
- Network allows connection to Supabase

### JWT Secret Too Short
JWT_SECRET must be at least 32 characters in production. Generate one:
```bash
openssl rand -base64 32
```

### Contract Watcher Won't Start
If `RUN_CONTRACT_WATCHER=true` but server won't start:
- Verify CONTRACT_ID is set
- Verify CONTRACT_ID is a valid Soroban contract ID
- Verify RPC_URL is accessible

## See Also

- [SETUP.md](./SETUP.md) - Local development setup
- [ARCHITECTURE.md](./ARCHITECTURE.md) - System architecture
- [API.md](./API.md) - API documentation
