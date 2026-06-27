# Backend Setup Guide

## Quick Start (5 minutes)

For a quick local development setup:

```bash
cd server
npm install
cp .env.example .env
# Edit .env with your Supabase credentials
npx prisma migrate dev
npm run dev
```

Server will be available at `http://localhost:5000`

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | 20.x | JavaScript runtime |
| npm | 10.x | Package manager |
| PostgreSQL | 15+ | Primary database |
| Redis | 6.x+ | Caching (optional) |

### Installation

**macOS:**
```bash
brew install node postgresql redis
brew services start postgresql
```

**Ubuntu/Debian:**
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs postgresql redis-server
sudo systemctl start postgresql
sudo systemctl start redis-server
```

**Windows:**
- Download and install from official websites
- Use Windows Subsystem for Linux (WSL2) recommended for PostgreSQL/Redis

## Step 1: Clone the Repository

```bash
git clone https://github.com/Cylo-Traders/Agrocylo-Global.git
cd Agrocylo-Global/server
npm install
```

## Step 2: Environment Configuration

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` with your configuration. For development, at minimum you need:
   ```bash
   DATABASE_URL=postgresql://agrocylo:agrocylo123@localhost:5432/agrocylo_db
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_SERVICE_ROLE_KEY=your-service-key
   JWT_SECRET=your-secret-key
   ```

   See [ENVIRONMENT.md](./ENVIRONMENT.md) for detailed variable documentation.

## Step 3: Database Setup

### Create PostgreSQL Database

**Local setup (development):**

```bash
# Start PostgreSQL service
sudo service postgresql start  # Linux
brew services start postgresql  # macOS

# Create user and database
sudo -u postgres psql -c "CREATE USER agrocylo WITH PASSWORD 'agrocylo123';"
sudo -u postgres psql -c "CREATE DATABASE agrocylo_db OWNER agrocylo;"

# Update DATABASE_URL in .env
DATABASE_URL="postgresql://agrocylo:agrocylo123@localhost:5432/agrocylo_db"
```

### Run Database Migrations

```bash
# Generate Prisma client
npx prisma generate

# Run pending migrations
npx prisma migrate dev

# View database in Prisma Studio (optional)
npx prisma studio
```

### Seed Database (Optional)

If seed scripts exist:
```bash
npx prisma db seed
```

## Step 4: Start the Server

**Development with hot reload:**
```bash
npm run dev
```

**Production build:**
```bash
npm run build
npm start
```

**Verify the server is running:**
```bash
curl http://localhost:5000/health
```

Expected response:
```json
{
  "status": "UP",
  "timestamp": "2026-06-27T10:30:00.000Z",
  "service": "Agrocylo-Backend",
  "env": "development",
  "database": "UP",
  "supabase": "UP"
}
```

## Step 5: Run Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm test -- --watch

# Run specific test file
npm test -- src/services/orderService.test.ts

# Run with coverage
npm test -- --coverage
```

## Common Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start with hot reload |
| `npm run build` | Compile TypeScript to JavaScript |
| `npm start` | Run compiled production build |
| `npm test` | Run all tests |
| `npx prisma generate` | Generate Prisma client |
| `npx prisma migrate dev` | Create and run migrations |
| `npx prisma studio` | Open database browser UI |

## Docker Setup

For Docker-based setup, see [DOCKER.md](./DOCKER.md).

## Troubleshooting

### Database Connection Error
```
Error: connect ECONNREFUSED 127.0.0.1:5432
```
Solution: Ensure PostgreSQL is running:
```bash
sudo service postgresql start  # Linux
brew services start postgresql  # macOS
```

### Port Already in Use
```
Error: listen EADDRINUSE :::5000
```
Solution: Change PORT in .env or kill the process using port 5000:
```bash
lsof -i :5000  # Find process
kill -9 <PID>  # Kill process
```

### Supabase Connection Error
- Verify SUPABASE_URL is correct format: `https://[project-ref].supabase.co`
- Check SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are valid
- Ensure your network allows connection to Supabase

### Migration Failed
If a migration fails, you can reset the database (development only):
```bash
npx prisma migrate reset
```

This will drop the database and re-run all migrations from scratch.

### JWT Secret Too Short
In production, JWT_SECRET must be at least 32 characters:
```bash
openssl rand -base64 32
```

## Project Structure

```
server/
├── src/
│   ├── app.ts              # Express app setup
│   ├── index.ts            # Server entry point
│   ├── middleware/         # Express middleware
│   ├── routes/             # API route handlers
│   ├── services/           # Business logic
│   ├── models/             # Data models
│   └── config/             # Configuration
├── prisma/
│   └── schema.prisma       # Database schema
├── tests/                  # Test files
├── .env.example            # Environment template
├── package.json
├── tsconfig.json
└── README.md
```

## Next Steps

1. Review [ARCHITECTURE.md](./ARCHITECTURE.md) for system design
2. Check [API.md](./API.md) for available endpoints
3. Read [ENVIRONMENT.md](./ENVIRONMENT.md) for all configuration options
4. See [DOCKER.md](./DOCKER.md) for containerized deployment

## Need Help?

- Check existing issues on GitHub
- Review error messages in server logs
- Consult [DOCKER.md](./DOCKER.md) for container-based setup
- Open a new issue with error details and setup steps tried
