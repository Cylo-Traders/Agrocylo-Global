#!/usr/bin/env node
/**
 * Fail fast on an unsupported Node runtime, with a message that says what to
 * install instead of leaving the failure to Prisma's own engine check.
 *
 * The supported range is read from `engines.node` in package.json, so the
 * manifest stays the single source of truth and this script cannot drift from
 * it. Wired in as `predev` / `prebuild` / `prestart` / `preworker:start`, and
 * `npm ci` is covered separately by `engine-strict=true` in .npmrc.
 *
 * The range is deliberately the same set the locked Prisma toolchain accepts
 * (`^20.19 || ^22.12 || >=24.0` for @prisma/client 7.10.0), minus Node 20,
 * which this service no longer declares support for.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));

export function parseVersion(value) {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(value).trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

function compare(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/** Does `version` satisfy one comparator such as `^22.12.0` or `>=24.0.0`? */
export function satisfiesComparator(version, comparator) {
  const v = parseVersion(version);
  const body = comparator.trim();
  if (!v || !body) return false;

  if (body.startsWith("^")) {
    const base = parseVersion(body.slice(1));
    if (!base) return false;
    // caret: >= base, and below the next major
    return compare(v, base) >= 0 && v[0] === base[0];
  }
  if (body.startsWith(">=")) {
    const base = parseVersion(body.slice(2));
    return base ? compare(v, base) >= 0 : false;
  }
  if (body.startsWith(">")) {
    const base = parseVersion(body.slice(1));
    return base ? compare(v, base) > 0 : false;
  }
  if (body.startsWith("<=")) {
    const base = parseVersion(body.slice(2));
    return base ? compare(v, base) <= 0 : false;
  }
  if (body.startsWith("<")) {
    const base = parseVersion(body.slice(1));
    return base ? compare(v, base) < 0 : false;
  }
  if (body.includes(" - ")) {
    const [lo, hi] = body.split(" - ").map((part) => parseVersion(part));
    return !!lo && !!hi && compare(v, lo) >= 0 && compare(v, hi) <= 0;
  }
  const exact = parseVersion(body);
  return exact ? compare(v, exact) === 0 : false;
}

/** Does `version` satisfy an `||`-joined range? */
export function satisfiesRange(version, range) {
  return String(range)
    .split("||")
    .some((clause) => satisfiesComparator(version, clause));
}

export function requiredRange() {
  return manifest.engines?.node ?? "";
}

/** The Prisma version the lockfile actually resolves, for an accurate message. */
export function lockedPrismaVersion() {
  try {
    const lock = JSON.parse(readFileSync(join(here, "..", "package-lock.json"), "utf8"));
    return (
      lock.packages?.["node_modules/@prisma/client"]?.version ??
      lock.packages?.["node_modules/prisma"]?.version ??
      null
    );
  } catch {
    return null;
  }
}

export function describeRuntime() {
  return {
    node: process.versions.node,
    npm: process.env.npm_config_user_agent?.match(/npm\/[\d.]+/)?.[0] ?? "unknown",
  };
}

export function main() {
  const range = requiredRange();
  if (!range) {
    console.error("[engines] package.json has no engines.node range — refusing to guess.");
    process.exit(1);
  }
  if (satisfiesRange(process.versions.node, range)) return;

  console.error(
    [
      "",
      `✖ agrocylo-backend does not support Node v${process.versions.node}.`,
      "",
      `  Required: ${range}`,
      "  Reason:   the locked Prisma toolchain (@prisma/client " +
        `${lockedPrismaVersion() ?? manifest.dependencies?.["@prisma/client"] ?? ""}) ` +
        "supports ^20.19 || ^22.12 || >=24.0; this service supports the 22.12+ and 24+ lines.",
      "",
      "  Fix one of:",
      "    • nvm install && nvm use      # uses server/.nvmrc (22.12.0)",
      "    • docker build/run            # server/Dockerfile pins node:22.12-alpine",
      "    • install a supported release from https://nodejs.org/en/download",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
