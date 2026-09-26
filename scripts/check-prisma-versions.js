#!/usr/bin/env node
/**
 * Prisma toolchain compatibility guard (Issue #944 companion).
 *
 * Validates that `prisma` (CLI), `@prisma/client`, and `@prisma/adapter-pg`
 * are declared at compatible versions in server/package.json and that the
 * installed versions (resolved in server/package-lock.json) agree.
 *
 * Rules enforced:
 *  1. All three packages must be present as declared dependencies.
 *  2. All three declared versions must share the same semver major.
 *  3. All three locked (resolved) versions must share the same semver major.
 *  4. The declared major and the locked major must agree.
 *
 * Exit 0 → compatible.  Exit 1 → incompatible, with a precise message.
 *
 * Usage (local):
 *   node scripts/check-prisma-versions.js
 *
 * Usage (CI):
 *   - name: Check Prisma toolchain compatibility
 *     run: node scripts/check-prisma-versions.js
 */

"use strict";

const fs = require("fs");
const path = require("path");

const SERVER_DIR = path.join(__dirname, "..", "server");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    console.error(`check-prisma-versions: cannot read ${filePath}: ${err.message}`);
    process.exit(1);
  }
}

/**
 * Extract the leading numeric major from a semver range or resolved version.
 * Strips common range prefixes: ^, ~, >=, =, v.
 * Returns null if the string cannot be parsed.
 */
function majorOf(versionString) {
  if (!versionString) return null;
  const match = /[v^~>=]*(\d+)/.exec(versionString);
  return match ? parseInt(match[1], 10) : null;
}

// ---------------------------------------------------------------------------
// Load manifests
// ---------------------------------------------------------------------------

const pkgPath = path.join(SERVER_DIR, "package.json");
const lockPath = path.join(SERVER_DIR, "package-lock.json");

if (!fs.existsSync(pkgPath)) {
  console.error(`check-prisma-versions: server/package.json not found at ${pkgPath}`);
  process.exit(1);
}
if (!fs.existsSync(lockPath)) {
  console.error(`check-prisma-versions: server/package-lock.json not found at ${lockPath}`);
  process.exit(1);
}

const pkg = readJson(pkgPath);
const lock = readJson(lockPath);

// ---------------------------------------------------------------------------
// Resolve declared versions from package.json
// ---------------------------------------------------------------------------

const PRISMA_PACKAGES = ["prisma", "@prisma/client", "@prisma/adapter-pg"];

const allDeclared = {
  ...((pkg.dependencies) || {}),
  ...((pkg.devDependencies) || {}),
};

const declared = {};
const missing = [];

for (const name of PRISMA_PACKAGES) {
  const v = allDeclared[name];
  if (!v) {
    missing.push(name);
  } else {
    declared[name] = v;
  }
}

if (missing.length > 0) {
  console.error(
    `check-prisma-versions: the following Prisma packages are not declared in server/package.json:\n` +
      missing.map((m) => `  - ${m}`).join("\n") +
      `\n\nAll three packages must be present to guarantee a coherent toolchain.`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Resolve locked (installed) versions from package-lock.json
// ---------------------------------------------------------------------------

/**
 * package-lock.json v3 stores resolved versions in the `packages` map.
 * Keys are paths like "node_modules/@prisma/client".
 */
const packages = lock.packages || {};

const locked = {};
const missingLocked = [];

for (const name of PRISMA_PACKAGES) {
  const key = `node_modules/${name}`;
  const entry = packages[key];
  if (!entry || !entry.version) {
    missingLocked.push(name);
  } else {
    locked[name] = entry.version;
  }
}

if (missingLocked.length > 0) {
  console.error(
    `check-prisma-versions: the following Prisma packages are missing from server/package-lock.json:\n` +
      missingLocked.map((m) => `  - ${m}`).join("\n") +
      `\n\nRun \`npm install\` in server/ to regenerate the lockfile, then commit it.`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Check major-version alignment
// ---------------------------------------------------------------------------

let failed = false;

// 1. Declared majors must all agree.
const declaredMajors = PRISMA_PACKAGES.map((name) => ({
  name,
  version: declared[name],
  major: majorOf(declared[name]),
}));

const uniqueDeclaredMajors = new Set(declaredMajors.map((d) => d.major));
if (uniqueDeclaredMajors.size > 1) {
  failed = true;
  console.error(
    `check-prisma-versions: declared Prisma packages have mismatched major versions in server/package.json:`,
  );
  for (const { name, version, major } of declaredMajors) {
    console.error(`  ${name}: ${version}  (major ${major})`);
  }
}

// 2. Locked (resolved) majors must all agree.
const lockedMajors = PRISMA_PACKAGES.map((name) => ({
  name,
  version: locked[name],
  major: majorOf(locked[name]),
}));

const uniqueLockedMajors = new Set(lockedMajors.map((d) => d.major));
if (uniqueLockedMajors.size > 1) {
  failed = true;
  console.error(
    `check-prisma-versions: installed Prisma packages have mismatched major versions in server/package-lock.json:`,
  );
  for (const { name, version, major } of lockedMajors) {
    console.error(`  ${name}: ${version}  (major ${major})`);
  }
}

// 3. Declared major and locked major must agree.
const declaredMajor = [...uniqueDeclaredMajors][0];
const lockedMajor = [...uniqueLockedMajors][0];

if (
  declaredMajor !== undefined &&
  lockedMajor !== undefined &&
  declaredMajor !== lockedMajor
) {
  failed = true;
  console.error(
    `check-prisma-versions: declared Prisma major (${declaredMajor}) does not match ` +
      `installed/locked major (${lockedMajor}).`,
  );
  console.error(`  Declared (package.json):`);
  for (const { name, version } of declaredMajors) {
    console.error(`    ${name}: ${version}`);
  }
  console.error(`  Installed (package-lock.json):`);
  for (const { name, version } of lockedMajors) {
    console.error(`    ${name}: ${version}`);
  }
  console.error(
    `\n  Resolution: run \`npm install\` in server/ with the desired consistent versions, ` +
      `then commit both package.json and package-lock.json together.`,
  );
}

if (failed) {
  console.error(
    `\nPrisma toolchain compatibility check failed. ` +
      `All three packages (prisma, @prisma/client, @prisma/adapter-pg) must share the same major version. ` +
      `See Issue #944.`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// All good
// ---------------------------------------------------------------------------

console.log(`Prisma toolchain compatibility OK:`);
for (const name of PRISMA_PACKAGES) {
  console.log(`  ${name}: declared ${declared[name]}  →  installed ${locked[name]}`);
}
console.log(`  All packages aligned at major ${lockedMajor}.`);
