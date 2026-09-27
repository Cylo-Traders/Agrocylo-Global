#!/usr/bin/env node
"use strict";

/**
 * CI enforcement for Issue #1041: exactly one React runtime may be resolved for
 * the Agro Production client.
 *
 * Why a dedicated check rather than a unit test: the failure this guards against
 * lives in the *installed tree*, not in source. Both workspaces pin
 * react/react-dom 19.2.3, but npm can additionally hoist a second copy to the
 * root to satisfy a hoisted peer dependency (that is where the 19.2.8 in the
 * lockfile came from). Two copies mean two ReactCurrentDispatcher objects, so
 * a hook called by a component from one copy and rendered by the other throws
 * "Invalid hook call" at runtime — in every test that mounts a component, and
 * with no build-time error to point at the cause.
 *
 * `vitest.config.ts`'s `resolve.dedupe` masks this during tests. That is
 * deliberate (it makes the suites pass regardless of tree shape) but it also
 * means the suite alone cannot tell you the tree is wrong. This check reads the
 * lockfile directly and fails on the actual condition.
 *
 * Runs on the lockfile, so it needs no node_modules and can gate before
 * `npm ci`.
 *
 * Usage: node scripts/check-react-runtime.js [--lockfile <path>]
 */

const fs = require("fs");
const path = require("path");

const PACKAGES = ["react", "react-dom"];

const USAGE = `Usage: node scripts/check-react-runtime.js [--lockfile <path>]

Fails if the lockfile resolves more than one version of ${PACKAGES.join(" or ")}.
`;

/** Collect every resolved version of `name` in a lockfile's `packages` map. */
function collectVersions(lock, name) {
  const found = new Map(); // version -> [paths]
  const packages = lock.packages || {};
  for (const [pkgPath, meta] of Object.entries(packages)) {
    if (!pkgPath) continue;
    // Only the package itself, not scoped children or same-named leaves.
    const expectedSuffix = `node_modules/${name}`;
    if (!pkgPath.endsWith(expectedSuffix)) continue;
    const version = meta.version;
    if (!version) continue;
    if (!found.has(version)) found.set(version, []);
    found.get(version).push(pkgPath);
  }
  return found;
}

function parseArgs(argv) {
  const options = { lockfile: path.resolve(__dirname, "..", "package-lock.json") };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "-h" || argv[i] === "--help") {
      process.stdout.write(USAGE);
      process.exit(0);
    }
    if (argv[i] === "--lockfile") {
      const next = argv[i + 1];
      if (!next) {
        process.stderr.write("error: --lockfile requires a path\n");
        process.exit(2);
      }
      options.lockfile = path.resolve(next);
      i++;
    }
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));

  let lock;
  try {
    lock = JSON.parse(fs.readFileSync(options.lockfile, "utf8"));
  } catch (error) {
    process.stderr.write(`error: cannot read lockfile at ${options.lockfile}\n`);
    process.stderr.write(`${error.message}\n`);
    process.exit(2);
  }

  let failed = false;

  for (const name of PACKAGES) {
    const versions = collectVersions(lock, name);

    if (versions.size === 0) {
      process.stderr.write(`error: lockfile resolves no ${name} at all\n`);
      failed = true;
      continue;
    }

    if (versions.size > 1) {
      process.stderr.write(`FAIL: ${name} resolves to ${versions.size} versions (#1041)\n`);
      for (const [version, paths] of [...versions.entries()].sort()) {
        process.stderr.write(`  ${version}\n`);
        for (const pkgPath of paths) {
          process.stderr.write(`    ${pkgPath}\n`);
        }
      }
      process.stderr.write(
        `\nTwo React runtimes means two ReactCurrentDispatcher objects, so hooks\n` +
          `throw "Invalid hook call" whenever a component and its renderer resolve\n` +
          `to different copies. Pin a single version via the root package.json\n` +
          `"overrides" block, then run: npm install\n`,
      );
      failed = true;
      continue;
    }

    const [version, paths] = [...versions.entries()][0];
    process.stdout.write(`ok: single ${name}@${version}\n`);
    for (const pkgPath of paths) {
      process.stdout.write(`  ${pkgPath}\n`);
    }
  }

  if (failed) process.exit(1);
  process.stdout.write("Single React runtime resolved.\n");
}

main();
