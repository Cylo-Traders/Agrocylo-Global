#!/usr/bin/env node
"use strict";

/**
 * Issue #920 — workspace-aware diagnostics for Next.js dependency problems.
 *
 *   node scripts/doctor-next.js              # both clients
 *   node scripts/doctor-next.js --app=client # marketplace client only
 *   node scripts/doctor-next.js --app=agro   # agro-production client only
 *   node scripts/doctor-next.js --json       # machine-readable output
 *
 * Read-only: manifests, lockfiles, caches and configs are never modified and
 * dependencies are never installed or deleted. Exits nonzero when a blocking
 * problem (missing package, broken link, package outside the bundler root) is
 * found.
 */

const path = require("path");

const layout = require("./lib/workspace-layout");
const doctor = require("./lib/next-doctor");

const STATUS_GLYPH = { ok: "✓", warn: "!", fail: "✗", info: "•" };

const USAGE = `Usage: node scripts/doctor-next.js [--app=<${layout
  .listApps()
  .map((a) => a.key)
  .join("|")}>] [--json]

Options:
  --app=<name>   Diagnose one workspace (default: both, or the workspace you
                 are running the command from).
  --json         Print the diagnosis as JSON.
  -h, --help     Show this message.
`;

function parseArgs(argv) {
  const parsed = { app: null, json: false, help: false };
  for (const arg of argv) {
    if (arg === "-h" || arg === "--help") parsed.help = true;
    else if (arg === "--json") parsed.json = true;
    else if (arg.startsWith("--app=")) parsed.app = arg.slice("--app=".length);
    else throw new layout.WorkspaceError(`Unexpected argument "${arg}".\n\n${USAGE}`, "BAD_ARGS");
  }
  return parsed;
}

/** Infer the app from the current working directory, if it is inside one. */
function appForCwd() {
  const cwd = process.cwd();
  return layout.listApps().find((app) => layout.isInside(app.dir, cwd)) || null;
}

function selectApps(selector) {
  if (selector) return [layout.resolveApp(selector)];
  const cwdApp = appForCwd();
  return cwdApp ? [cwdApp] : layout.listApps();
}

function render(result, app) {
  const lines = [];
  lines.push(`── ${app ? app.label : result.appDir} ──`);
  for (const check of result.checks) {
    lines.push(`  ${STATUS_GLYPH[check.status] || "•"} ${check.label}: ${check.value}`);
  }
  for (const warning of result.warnings) {
    lines.push(`  ! ${warning.code}: ${warning.message}`);
  }
  for (const failure of result.failures) {
    lines.push(`  ✗ ${failure.code}: ${failure.message}`);
    for (const step of failure.recovery) lines.push(`      → ${step}`);
  }
  lines.push(
    result.ok
      ? "  Result: OK — next resolves from inside the effective bundler root."
      : `  Result: BLOCKED — ${result.failures.length} problem(s) must be fixed before \`npm run dev\`.`,
  );
  return lines.join("\n");
}

function main(argv, context = {}) {
  const out = context.out || process.stdout;
  const args = parseArgs(argv);
  if (args.help) {
    out.write(USAGE);
    return 0;
  }

  const apps = context.apps || selectApps(args.app);
  const results = apps.map((app) => ({ app, result: doctor.diagnoseApp(app.dir) }));
  const blocked = results.filter(({ result }) => !result.ok);

  if (args.json) {
    out.write(
      `${JSON.stringify(
        results.map(({ app, result }) => ({ app: app.key, ...result })),
        null,
        2,
      )}\n`,
    );
    return blocked.length ? 1 : 0;
  }

  for (const { app, result } of results) {
    out.write(`${render(result, app)}\n`);
  }

  if (blocked.length) {
    out.write(
      "\nNext steps: fix the blocking problem above (usually a root install or a " +
        "turbopack.root misconfiguration), stop any running dev server, then optionally reset the " +
        "app cache with `node scripts/reset-next-cache.js --app=<client|agro>`. " +
        "This command never installs packages or deletes caches for you.\n",
    );
    return 1;
  }

  out.write("\nAll selected workspaces resolve Next.js from inside their bundler root.\n");
  return 0;
}

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (error) {
    const known = error instanceof layout.WorkspaceError;
    process.stderr.write(`${known ? error.message : `Unexpected failure: ${error.stack}`}\n`);
    process.exit(1);
  }
}

module.exports = { main, USAGE, parseArgs, selectApps, render };
