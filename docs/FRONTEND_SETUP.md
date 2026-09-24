# Frontend development setup

This is the canonical local setup for both Next.js frontends. Run installation and
launcher commands from the repository root unless a command explicitly says
otherwise.

## Supported toolchain

Use Node.js 22.13.x and npm 10.9.x. The exact tested versions are declared in
`.nvmrc` and the root `package.json`.

```bash
# Repository root
nvm use
npm run check:toolchain
```

Node.js 18 and earlier are not supported by the current Next.js version.

## Fresh checkout

```bash
git clone https://github.com/Cylo-Traders/Agrocylo-Global.git
cd Agrocylo-Global
npm ci
```

The two clients are npm workspaces and share the committed root
`package-lock.json`. Do not run a separate install inside `client/` or
`agro-production/client/`, and do not create per-app lockfiles. Use `npm ci`
for a reproducible checkout. Use root `npm install` only when intentionally
changing dependencies and commit the resulting root lockfile update.

## Environment files

Each app loads its own local file; neither file belongs at the repository root.

| App | Local file | Template |
|---|---|---|
| Marketplace | `client/.env.local` | `client/.env.example` |
| Production campaigns | `agro-production/client/.env.local` | `agro-production/client/.env.example` |

```bash
# Repository root
cp client/.env.example client/.env.local
cp agro-production/client/.env.example agro-production/client/.env.local
```

Fill in the values needed for the flow you are developing. Never commit either
`.env.local` file. See [the environment-variable reference](deployment/environment.md)
for the authoritative per-app list.

## Start the frontends

Run these commands from the repository root:

| Command | Apps started | Default URL |
|---|---|---|
| `npm run dev` | Both, through Turbo | Marketplace: http://localhost:3000; production: http://localhost:3001 |
| `npm run dev:marketplace` | Marketplace only | http://localhost:3000 |
| `npm run dev:production` | Production only | http://localhost:3001 |

Each launcher prints its app name and URL. Startup fails with an actionable
message if the configured port is occupied; it never silently selects a
different port.

For one app, override its port on any platform with a CLI argument:

```bash
npm run dev:marketplace -- --port 3100
npm run dev:production -- --port 3101
```

For `npm run dev`, set app-specific environment variables so the two apps
remain distinct:

```bash
MARKETPLACE_PORT=3100 PRODUCTION_PORT=3101 npm run dev
```

PowerShell equivalent:

```powershell
$env:MARKETPLACE_PORT=3100
$env:PRODUCTION_PORT=3101
npm run dev
```

Playwright uses `PLAYWRIGHT_BASE_URL` when a non-default marketplace URL is
needed and starts its server on the URL's port.

## Run checks

Commands can remain rooted while targeting one workspace:

```bash
npm test --workspace=client
npm run lint --workspace=client
npm run build --workspace=client

npm test --workspace=agro-production/client
npm run lint --workspace=agro-production/client
npm run build --workspace=agro-production/client
```

Root `npm run test`, `npm run lint`, and `npm run build` run the matching
task across both frontends and shared packages through Turbo.

## Startup troubleshooting

### `next: not found` or Next.js cannot be resolved

Confirm that the command is being run from the repository root and that the
single root install completed:

```bash
node --version
npm --version
npm run check:toolchain
npm ci
```

Do not repair this by installing inside an individual client. If `npm ci` was
interrupted, run it again at the root; it recreates the workspace dependency
tree from the committed lockfile.

### Compile failure followed by a build-manifest `ENOENT`

Use the first compile, module-resolution, or configuration error in the terminal
as the root failure. A later missing `.next` manifest is commonly a downstream
effect of that failed compile, not an independent missing file to recreate.

After fixing the first error, stop every frontend process before clearing cache:

```bash
rm -rf client/.next agro-production/client/.next
npm run dev:marketplace
```

Only the generated `.next` directories should be removed. Do not delete the
root lockfile or create app-specific lockfiles.

### Port already in use

The launcher identifies the app and occupied port. Stop the process that owns
the documented port or use the override commands above. Keep
`PLAYWRIGHT_BASE_URL` aligned when overriding the marketplace port.

### Deprecation, middleware, or Edge-runtime warning

A warning is not automatically the cause of a blank page. Record the first
error and any browser Content Security Policy violation before later warnings.
The marketplace uses Next.js 16's `proxy.ts` convention for request-time CSP;
new middleware/Edge code must not assume Node-only APIs are available unless its
configured runtime supports them.

## Bug-report checklist

Include only sanitized diagnostics:

- operating system;
- `node --version` and `npm --version`;
- app, exact command, and working directory;
- commit SHA from `git rev-parse --short HEAD`;
- the first terminal or browser-console error.

Do not post `.env` or `.env.local` contents, tokens, wallet secrets, keys, or
connection strings.
