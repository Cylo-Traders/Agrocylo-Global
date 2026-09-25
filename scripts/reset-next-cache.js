#!/usr/bin/env node
"use strict";

/**
 * Issue #921 — explicit, safe Next.js cache reset for a single workspace.
 *
 *   node scripts/reset-next-cache.js --app=client
 *   node scripts/reset-next-cache.js --app=agro --dry-run
 *
 * Removes *only* the selected app's generated `.next` directory. It never
 * touches source files, .env files, lockfiles, node_modules, or the other
 * app's cache, and it refuses to follow a `.next` symlink.
 *
 * This is a manual recovery utility: it is not wired into `npm run dev`.
 */

const { resolveApp, listApps, WorkspaceError } = require("./lib/workspace-layout");
const { resetAppCache, CacheResetError } = require("./lib/next-cache");

const USAGE = `Usage: node scripts/reset-next-cache.js --app=<${listApps()
  .map((a) => a.key)
  .join("|")}> [--dry-run]

Options:
  --app=<name>   Required. Which workspace's generated .next to remove.
  --dry-run      Report what would be removed without deleting anything.
  -h, --help     Show this message.

Recovery order (see CONTRIBUTING.md):
  1. Fix the first error reported by the dev server (a cache reset cannot fix
     a broken dependency or a misconfigured bundler root).
  2. Stop the app's dev process (Ctrl+C on \`npm run dev\`).
  3. Run this command for that app only.
  4. Restart with \`npm run dev\`.
`;

function parseArgs(argv) {
  const parsed = { app: null, dryRun: false, help: false };
  for (const arg of argv) {
    if (arg === "-h" || arg === "--help") parsed.help = true;
    else if (arg === "--dry-run") parsed.dryRun = true;
    else if (arg.startsWith("--app=")) parsed.app = arg.slice("--app=".length);
    else if (arg === "--app") parsed.app = null;
    else {
      throw new WorkspaceError(`Unexpected argument "${arg}".\n\n${USAGE}`, "BAD_ARGS");
    }
  }
  return parsed;
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  if (!args.app) {
    process.stderr.write(
      "An explicit --app is required so the reset can never target the wrong workspace.\n\n" + USAGE,
    );
    return 2;
  }

  const app = resolveApp(args.app);
  const result = resetAppCache(app.dir, {
    dryRun: args.dryRun,
    logger: (msg) => process.stdout.write(`${msg}\n`),
  });

  if (result.alreadyAbsent) {
    process.stdout.write(`✓ ${app.label}: no generated output to reset (idempotent).\n`);
  } else if (result.dryRun) {
    process.stdout.write(`✓ ${app.label}: dry run only, nothing deleted.\n`);
  } else {
    process.stdout.write(
      `✓ ${app.label}: generated output removed. Restart with "npm run dev" for that app.\n`,
    );
  }
  return 0;
}

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    const known = error instanceof WorkspaceError || error instanceof CacheResetError;
    process.stderr.write(`${known ? error.message : `Unexpected failure: ${error.stack}`}\n`);
    process.exit(1);
  }
}

module.exports = { main, USAGE, parseArgs };
