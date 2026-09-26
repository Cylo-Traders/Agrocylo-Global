#!/usr/bin/env node
/**
 * Production-module import check for the GraphQL gateway (Issue #946).
 *
 * The gateway used to be replaced by its Vitest suite, which meant the
 * production module self-imported test globals and exported nothing the
 * router needs. This check runs in a plain Node.js process — never inside
 * Vitest — and therefore catches that regression before the app is built or
 * deployed:
 *
 *   1. the built module loads outside the test runner and without mocks,
 *   2. it exports `executeGraphQL` plus the documented query-limit constants,
 *   3. neither the module nor its local imports pull in Vitest or rely on
 *      test-runner globals.
 *
 * Run from `server/` after `npm run build`:
 *   npm run smoke:graphql-import
 */

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GATEWAY_MODULE = path.join(SERVER_DIR, "dist", "services", "graphqlGatewayService.js");

const REQUIRED_FUNCTIONS = ["executeGraphQL", "getSchemaSDL"];
const REQUIRED_NUMBERS = ["MAX_QUERY_SIZE", "MAX_DEPTH", "MAX_ALIAS_COUNT", "MAX_FIELD_COUNT"];

// Non-secret placeholders so this check stays a pure module-loading smoke test
// on a machine with no `.env`. Anything already exported by the environment
// wins, and nothing is written to disk.
const ENV_PLACEHOLDERS = {
  DATABASE_URL: "postgresql://smoke:smoke@localhost:5432/smoke",
  SUPABASE_URL: "https://smoke.supabase.co",
  SUPABASE_ANON_KEY: "smoke-anon-key",
  JWT_SECRET: "smoke-check-jwt-secret-at-least-32-chars",
};

const TEST_RUNNER_GLOBALS = ["describe", "it", "test", "expect", "beforeEach", "afterEach", "vi"];

function fail(message) {
  console.error(`GraphQL production module check failed: ${message}`);
  process.exit(1);
}

if (process.env.VITEST || process.env.VITEST_WORKER_ID) {
  fail(
    "this check must run in a plain Node.js process, not inside Vitest. " +
      "Use `npm run smoke:graphql-import` from server/ instead of calling it from a test.",
  );
}

for (const [name, placeholder] of Object.entries(ENV_PLACEHOLDERS)) {
  if (!process.env[name]?.trim()) process.env[name] = placeholder;
}

if (!existsSync(GATEWAY_MODULE)) {
  fail(
    `${path.relative(SERVER_DIR, GATEWAY_MODULE)} does not exist. Run \`npm run build\` from server/ first.`,
  );
}

// Local (relative) specifiers the built gateway pulls in, so the static scan
// below covers the gateway's own module graph and not just its own file.
function localImportsOf(file) {
  const source = readFileSync(file, "utf8");
  const specifiers = new Set();
  for (const match of source.matchAll(/(?:from|import)\s*\(?\s*["'](\.[^"']+)["']/g)) {
    specifiers.add(match[1]);
  }
  return [...specifiers];
}

function assertNoTestRunnerImports() {
  const seen = new Set();
  const queue = [GATEWAY_MODULE];
  const offenders = [];

  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);

    const source = readFileSync(file, "utf8");
    const relative = path.relative(SERVER_DIR, file);

    if (/["']vitest["']/.test(source)) {
      offenders.push(`${relative} imports vitest`);
    }
    if (/\bfrom\s+["']node:test["']/.test(source)) {
      offenders.push(`${relative} imports node:test`);
    }
    if (/\b(?:const|let|var)\s+\{[^}]*\bvi\b[^}]*\}\s*=\s*require\(/.test(source)) {
      offenders.push(`${relative} requires the vitest runner`);
    }

    for (const specifier of localImportsOf(file)) {
      queue.push(path.resolve(path.dirname(file), specifier));
    }
  }

  if (offenders.length > 0) {
    fail(`production module graph contains test-runner code:\n  - ${offenders.join("\n  - ")}`);
  }
}

async function main() {
  assertNoTestRunnerImports();

  const gateway = await import(GATEWAY_MODULE);

  for (const name of REQUIRED_FUNCTIONS) {
    if (typeof gateway[name] !== "function") {
      fail(`built module is missing function export \`${name}\``);
    }
  }

  for (const name of REQUIRED_NUMBERS) {
    if (typeof gateway[name] !== "number") {
      fail(`built module is missing numeric export \`${name}\``);
    }
  }

  for (const name of TEST_RUNNER_GLOBALS) {
    if (name in gateway) {
      fail(`built module leaks test-runner global \`${name}\` as an export`);
    }
  }

  console.log(
    `GraphQL production module import OK (executeGraphQL, getSchemaSDL, limits ` +
      `${REQUIRED_NUMBERS.map((name) => gateway[name]).join(", ")})`,
  );
}

main().catch((error) => {
  console.error("GraphQL production module check failed:", error?.stack || error);
  process.exit(1);
});
