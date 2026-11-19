#!/usr/bin/env node
/**
 * Env-var drift checker (Issue #750).
 *
 * For every app it verifies, in both directions, that the app's `.env.example`
 * and the app's actual code agree on which environment variables exist:
 *
 *   A. example -> code   every var declared in `.env.example` must appear
 *                        somewhere in the app's source. Flags variables that
 *                        are documented but no longer read (stale config).
 *
 *   B. code -> example   every var the code reads via `process.env.X`,
 *                        `process.env['X']`, `import.meta.env.X`, or the
 *                        `getEnv('X')` / `requireEnv('X')` helpers must be
 *                        declared in `.env.example` (or the allowlist). Flags
 *                        variables the code depends on but nobody documented.
 *
 * The authoritative cross-app reference is docs/deployment/environment.md.
 *
 * Exit code 0 = no drift, 1 = drift found, 2 = usage error.
 */

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");

/** Vars that are injected by the platform / tooling, not app config. */
const ALLOWLIST = new Set([
  "NODE_ENV",
  "PORT",
  "CI",
  "TZ",
  "NEXT_RUNTIME",
  "NEXT_TELEMETRY_DISABLED",
  "ANALYZE",
  "VERCEL",
  "VERCEL_ENV",
  "VERCEL_URL",
  "VERCEL_GIT_COMMIT_SHA",
  "PLAYWRIGHT_BASE_URL",
  "PW_TEST_CONNECT_WS_ENDPOINT",
  // Test-harness-only toggles (never set in a real deployment).
  "ENABLE_TEST_RATE_LIMIT",
  "E2E_DATABASE_URL",
]);

/**
 * Apps to check. `envExample` is relative to repo root; `sources` are globs of
 * files whose env-var usage counts as "the code reads this".
 */
const APPS = [
  {
    name: "server",
    envExample: "server/.env.example",
    sourceDirs: ["server/src"],
    extraFiles: ["server/prisma.config.ts"],
  },
  {
    name: "client",
    envExample: "client/.env.example",
    sourceDirs: ["client/src", "packages/instrumentation/src"],
    extraFiles: ["client/next.config.ts"],
  },
  {
    name: "agro-production/server",
    envExample: "agro-production/server/.env.example",
    sourceDirs: ["agro-production/server/src"],
    extraFiles: [],
  },
  {
    name: "agro-production/client",
    envExample: "agro-production/client/.env.example",
    sourceDirs: ["agro-production/client/src", "packages/instrumentation/src"],
    extraFiles: ["agro-production/client/next.config.ts"],
  },
  {
    // Unified reference example for the agro sub-app: every var here must be
    // read by *either* agro-production/server or agro-production/client.
    name: "agro-production (unified)",
    envExample: "agro-production/.env.example",
    sourceDirs: ["agro-production/server/src", "agro-production/client/src", "packages/instrumentation/src"],
    extraFiles: [],
  },
];

const SOURCE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const IGNORE_DIR = new Set(["node_modules", ".next", "dist", "build", "coverage", ".turbo"]);
const isTestFile = (f) => /\.(test|spec|e2e)\.[cm]?[jt]sx?$/.test(f) || /(^|\/)__tests__\//.test(f);

function walk(dir, acc) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!IGNORE_DIR.has(e.name)) walk(full, acc);
    } else if (SOURCE_EXT.has(path.extname(e.name)) && !isTestFile(e.name)) {
      acc.push(full);
    }
  }
  return acc;
}

/** Parse `KEY=...` / `KEY =` declarations out of a .env.example file. */
function parseEnvExample(absPath) {
  const vars = new Set();
  const text = fs.readFileSync(absPath, "utf8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=/);
    if (m) vars.add(m[1]);
  }
  return vars;
}

const USE_PATTERNS = [
  /process\.env\.([A-Z][A-Z0-9_]*)/g,
  /process\.env\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\]/g,
  /import\.meta\.env\.([A-Z][A-Z0-9_]*)/g,
  /\b(?:getEnv|requireEnv|optionalEnv|envString|envBool|envNumber)\(\s*["'`]([A-Z][A-Z0-9_]*)["'`]/g,
];

/** Env vars a set of files reads directly (Direction B evidence). */
function collectUsedVars(files) {
  const used = new Set();
  for (const file of files) {
    const text = fs.readFileSync(file, "utf8");
    for (const re of USE_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) used.add(m[1]);
    }
  }
  return used;
}

/** Whether `varName` appears as a bare token anywhere in the given text blobs. */
function mentionedAnywhere(varName, blobs) {
  const re = new RegExp(`\\b${varName}\\b`);
  return blobs.some((b) => re.test(b));
}

function main() {
  let hadDrift = false;

  for (const app of APPS) {
    const envPath = path.join(REPO_ROOT, app.envExample);
    if (!fs.existsSync(envPath)) {
      console.error(`✗ ${app.name}: missing ${app.envExample}`);
      hadDrift = true;
      continue;
    }

    const declared = parseEnvExample(envPath);

    const files = [];
    for (const d of app.sourceDirs) walk(path.join(REPO_ROOT, d), files);
    for (const f of app.extraFiles) {
      const abs = path.join(REPO_ROOT, f);
      if (fs.existsSync(abs)) files.push(abs);
    }
    const blobs = files.map((f) => fs.readFileSync(f, "utf8"));
    const usedDirectly = collectUsedVars(files);

    const problems = [];

    // Direction A: declared but never mentioned in code.
    for (const v of declared) {
      if (ALLOWLIST.has(v)) continue;
      if (!mentionedAnywhere(v, blobs)) {
        problems.push(`  documented but unused:   ${v}  (in ${app.envExample}, not referenced in code)`);
      }
    }

    // Direction B: read by code but not documented.
    for (const v of usedDirectly) {
      if (ALLOWLIST.has(v)) continue;
      if (!declared.has(v)) {
        problems.push(`  used but undocumented:   ${v}  (read in code, missing from ${app.envExample})`);
      }
    }

    if (problems.length) {
      hadDrift = true;
      console.error(`✗ ${app.name}`);
      for (const p of problems) console.error(p);
    } else {
      console.log(`✓ ${app.name}  (${declared.size} vars, in sync)`);
    }
  }

  if (hadDrift) {
    console.error(
      "\nEnv drift detected. Update the app's .env.example AND " +
        "docs/deployment/environment.md so they match the code, " +
        "or add a genuinely platform-injected var to ALLOWLIST in this script.",
    );
    process.exit(1);
  }
  console.log("\nAll .env.example files are in sync with code.");
}

main();
