#!/usr/bin/env node
"use strict";

/**
 * CI enforcement for Issue #755 / #728 / #923: the two Next.js workspaces must
 * stay on the same framework versions, and Next.js tooling must follow the
 * documented upgrade policy.
 *
 * Policy (see docs/DEPENDENCY_UPGRADE_POLICY.md):
 *  1. Presence — every app declares next, react, react-dom and
 *     eslint-config-next.
 *  2. Alignment — both apps declare the *same* version of each of those
 *     packages. Versions are compared after resolving range syntax (`^16.3.5`
 *     -> 16.3.5), not by reading the first digit.
 *  3. Lockstep — eslint-config-next is released alongside Next.js and must
 *     match the app's next version exactly (major.minor.patch). A Next.js
 *     upgrade that leaves eslint-config-next behind fails the check.
 *
 * Manifest-only by default so the check runs before `npm ci`. Opt into
 * installed/lockfile verification with --verify-lockfile / --verify-installed.
 */

const fs = require("fs");
const path = require("path");

const layout = require("./lib/workspace-layout");

/** Runtime framework packages both apps must declare. */
const FRAMEWORK_DEPS = ["next", "react", "react-dom"];

/** Next.js-coupled tooling both apps must declare. */
const TOOLING_DEPS = ["eslint-config-next"];

/** Packages that must match each other *within* an app (major.minor.patch). */
const LOCKSTEP_PAIRS = [["next", "eslint-config-next"]];

const USAGE = `Usage: node scripts/check-shared-versions.js [--verify-lockfile] [--verify-installed]

Options:
  --verify-lockfile   Also require the root lockfile to resolve the declared versions.
  --verify-installed  Also require node_modules/<dep>/package.json to match.
  -h, --help          Show this message.
`;

/** "^16.3.5" -> { raw, operator: "^", base: "16.3.5", major: 16, minor: 3, patch: 5 } */
function parseSpecifier(spec) {
  const raw = String(spec || "").trim();
  const match = /^([^0-9]*)(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(raw);
  if (!match) return null;
  return {
    raw,
    operator: match[1].trim(),
    base: [match[2], match[3] || "0", match[4] || "0"].join("."),
    major: Number(match[2]),
    minor: Number(match[3] || 0),
    patch: Number(match[4] || 0),
  };
}

function declaredSpec(manifest, dep) {
  const deps = { ...(manifest.dependencies || {}), ...(manifest.devDependencies || {}) };
  const spec = deps[dep];
  return typeof spec === "string" ? spec : null;
}

function lockfileVersion(rootDir, dep) {
  const lockfile = layout.resolveLockfile(rootDir);
  if (!lockfile || !/package-lock|npm-shrinkwrap/.test(path.basename(lockfile))) return null;
  try {
    const json = layout.readJson(lockfile);
    const entry = (json.packages || {})[`node_modules/${dep}`];
    return entry && entry.version ? entry.version : null;
  } catch {
    return null;
  }
}

function installedVersion(rootDir, dep) {
  const manifestPath = path.join(rootDir, "node_modules", dep, "package.json");
  try {
    return layout.readJson(manifestPath).version || null;
  } catch {
    return null;
  }
}

/**
 * Run every policy rule.
 *
 * @param {{apps: Array<{name: string, manifest: object}>, rootDir?: string,
 *          verifyLockfile?: boolean, verifyInstalled?: boolean}} input
 * @returns {{ok: boolean, failures: Array<{code: string, message: string}>, lines: string[]}}
 */
function checkSharedVersions(input) {
  const apps = input.apps || [];
  const rootDir = input.rootDir || layout.REPO_ROOT;
  const failures = [];
  const lines = [];

  const parsed = new Map(); // dep -> Map(appName -> version)
  for (const dep of [...FRAMEWORK_DEPS, ...TOOLING_DEPS]) parsed.set(dep, new Map());

  for (const app of apps) {
    for (const dep of [...FRAMEWORK_DEPS, ...TOOLING_DEPS]) {
      const spec = declaredSpec(app.manifest, dep);
      if (!spec) {
        failures.push({
          code: "MISSING_DEPENDENCY",
          message: `${app.name}: required dependency "${dep}" is not declared in package.json.`,
        });
        continue;
      }
      const version = parseSpecifier(spec);
      if (!version) {
        failures.push({
          code: "UNPARSEABLE_VERSION",
          message: `${app.name}: "${dep}" is declared as "${spec}", which cannot be interpreted as a version.`,
        });
        continue;
      }
      parsed.get(dep).set(app.name, version.base);

      if (input.verifyLockfile) {
        const locked = lockfileVersion(rootDir, dep);
        if (!locked) {
          failures.push({
            code: "LOCKFILE_MISSING_ENTRY",
            message: `${app.name}: the root lockfile has no resolved entry for "${dep}". Run "npm install" at the repository root.`,
          });
        } else if (locked !== version.base) {
          failures.push({
            code: "LOCKFILE_DRIFT",
            message: `${app.name}: "${dep}" is declared as ${version.base} but the root lockfile resolves ${locked}. Update the manifest and the lockfile together.`,
          });
        }
      }

      if (input.verifyInstalled) {
        const installed = installedVersion(rootDir, dep);
        if (!installed) {
          failures.push({
            code: "NOT_INSTALLED",
            message: `${app.name}: "${dep}" is declared as ${version.base} but is not installed at ${rootDir}/node_modules/${dep}.`,
          });
        } else if (installed !== version.base) {
          failures.push({
            code: "INSTALLED_DRIFT",
            message: `${app.name}: "${dep}" is declared as ${version.base} but ${installed} is installed. Run "npm ci" at the repository root.`,
          });
        }
      }
    }
  }

  // Rule 2 — cross-app alignment on the resolved version.
  for (const [dep, byApp] of parsed) {
    const versions = new Set(byApp.values());
    if (byApp.size === apps.length && versions.size > 1) {
      failures.push({
        code: "VERSION_DRIFT",
        message:
          `Version drift on "${dep}" across workspaces: ` +
          [...byApp.entries()].map(([app, version]) => `${app} ${version}`).join(" vs ") +
          ". Bump the older workspace to match.",
      });
    } else if (versions.size === 1) {
      lines.push(`OK: "${dep}" aligned at ${[...versions][0]} across ${byApp.size} workspace(s).`);
    }
  }

  // Rule 3 — lockstep policy inside each app.
  for (const app of apps) {
    for (const [driver, follower] of LOCKSTEP_PAIRS) {
      const driverVersion = parsed.get(driver).get(app.name);
      const followerVersion = parsed.get(follower).get(app.name);
      if (!driverVersion || !followerVersion) continue;
      if (driverVersion !== followerVersion) {
        failures.push({
          code: "POLICY_MISMATCH",
          message:
            `${app.name}: "${follower}" (${followerVersion}) must match "${driver}" ` +
            `(${driverVersion}) exactly — ${follower} ships in lockstep with Next.js. ` +
            `Upgrade both together and update the root lockfile in the same commit.`,
        });
      } else {
        lines.push(`OK: ${app.name}: "${follower}" matches "${driver}" at ${driverVersion}.`);
      }
    }
  }

  return { ok: failures.length === 0, failures, lines };
}

function loadApps(rootDir) {
  return layout.listApps().map((app) => {
    const manifest = layout.readAppManifest(app.dir);
    if (!manifest) {
      throw new layout.WorkspaceError(
        `Cannot read ${path.join(app.dir, "package.json")}.`,
        "MANIFEST_MISSING",
      );
    }
    return { name: app.npmName, key: app.key, manifest: manifest.json };
  });
}

function main(argv) {
  const args = { verifyLockfile: false, verifyInstalled: false, help: false };
  for (const arg of argv) {
    if (arg === "-h" || arg === "--help") args.help = true;
    else if (arg === "--verify-lockfile") args.verifyLockfile = true;
    else if (arg === "--verify-installed") args.verifyInstalled = true;
    else throw new layout.WorkspaceError(`Unexpected argument "${arg}".\n\n${USAGE}`, "BAD_ARGS");
  }
  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const apps = loadApps(layout.REPO_ROOT);
  const result = checkSharedVersions({ apps, rootDir: layout.REPO_ROOT, ...args });

  for (const line of result.lines) process.stdout.write(`${line}\n`);

  if (!result.ok) {
    for (const failure of result.failures) {
      process.stderr.write(`✗ ${failure.code}: ${failure.message}\n`);
    }
    process.stderr.write(
      "\nShared dependency policy check failed (Issues #755 / #728 / #923). " +
        "See docs/DEPENDENCY_UPGRADE_POLICY.md.\n",
    );
    return 1;
  }

  process.stdout.write("\nAll shared dependencies satisfy the documented policy.\n");
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

module.exports = {
  FRAMEWORK_DEPS,
  TOOLING_DEPS,
  LOCKSTEP_PAIRS,
  USAGE,
  parseSpecifier,
  declaredSpec,
  checkSharedVersions,
  loadApps,
  main,
  lockfileVersion,
  installedVersion,
};
