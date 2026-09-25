"use strict";

/**
 * Issue #923 — the shared dependency checker must enforce presence, the
 * documented next/eslint-config-next lockstep policy and cross-app alignment,
 * using resolved semver ranges rather than the first digit.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const checker = require("../check-shared-versions");
const layout = require("../lib/workspace-layout");

function manifest(overrides = {}) {
  return {
    name: "fixture",
    dependencies: {
      next: "16.2.4",
      react: "19.2.3",
      "react-dom": "19.2.3",
      ...(overrides.dependencies || {}),
    },
    devDependencies: {
      "eslint-config-next": "16.2.4",
      ...(overrides.devDependencies || {}),
    },
  };
}

function apps(pair) {
  return [
    { name: "client", manifest: pair.a || manifest() },
    { name: "agro-production-client", manifest: pair.b || manifest() },
  ];
}

test("the committed baseline satisfies the policy", () => {
  const result = checker.checkSharedVersions({ apps: checker.loadApps(layout.REPO_ROOT) });
  assert.equal(result.ok, true, JSON.stringify(result.failures, null, 2));
});

test("a missing required framework dependency fails and names the app", () => {
  const broken = manifest();
  delete broken.dependencies.next;
  const result = checker.checkSharedVersions({ apps: apps({ a: broken }) });

  assert.equal(result.ok, false);
  const failure = result.failures.find((f) => f.code === "MISSING_DEPENDENCY");
  assert.ok(failure);
  assert.match(failure.message, /client/);
  assert.match(failure.message, /"next"/);
});

test("a missing required tooling dependency fails and names the app", () => {
  const broken = manifest();
  delete broken.devDependencies["eslint-config-next"];
  const result = checker.checkSharedVersions({ apps: apps({ b: broken }) });

  assert.equal(result.ok, false);
  const failure = result.failures.find((f) => f.code === "MISSING_DEPENDENCY");
  assert.ok(failure);
  assert.match(failure.message, /agro-production-client/);
  assert.match(failure.message, /"eslint-config-next"/);
});

test("next upgraded without eslint-config-next fails the lockstep policy", () => {
  const upgraded = manifest({ dependencies: { next: "16.3.5" } });
  const result = checker.checkSharedVersions({ apps: apps({ a: upgraded, b: upgraded }) });

  const failure = result.failures.find((f) => f.code === "POLICY_MISMATCH");
  assert.ok(failure, JSON.stringify(result.failures));
  assert.match(failure.message, /client: "eslint-config-next" \(16\.2\.4\) must match "next" \(16\.3\.5\)/);
  assert.equal(result.ok, false);
});

test("a range is interpreted as its resolved version", () => {
  // Both are "major 16", so a first-digit comparison would wrongly pass.
  const caret = manifest({ dependencies: { next: "^16.3.5" } });
  const pinned = manifest({ dependencies: { next: "16.2.4" } });
  const result = checker.checkSharedVersions({ apps: apps({ a: caret, b: pinned }) });

  const failure = result.failures.find((f) => f.code === "VERSION_DRIFT");
  assert.ok(failure, JSON.stringify(result.failures));
  assert.match(failure.message, /client 16\.3\.5 vs agro-production-client 16\.2\.4/);

  assert.deepEqual(checker.parseSpecifier("^16.3.5"), {
    raw: "^16.3.5",
    operator: "^",
    base: "16.3.5",
    major: 16,
    minor: 3,
    patch: 5,
  });
  assert.equal(checker.parseSpecifier("~19.2.0").base, "19.2.0");
  assert.equal(checker.parseSpecifier("19").base, "19.0.0");
});

test("divergent client versions fail with both app names", () => {
  const result = checker.checkSharedVersions({
    apps: apps({ a: manifest({ dependencies: { next: "16.2.4" } }), b: manifest({ dependencies: { next: "17.0.0" } }) }),
  });

  const failure = result.failures.find((f) => f.code === "VERSION_DRIFT");
  assert.ok(failure);
  assert.match(failure.message, /client 16\.2\.4 vs agro-production-client 17\.0\.0/);
});

test("a compliant upgrade of both clients passes", () => {
  const upgraded = manifest({
    dependencies: { next: "16.3.5" },
    devDependencies: { "eslint-config-next": "16.3.5" },
  });
  const result = checker.checkSharedVersions({ apps: apps({ a: upgraded, b: upgraded }) });

  assert.equal(result.ok, true, JSON.stringify(result.failures, null, 2));
  assert.ok(result.lines.some((line) => line.includes('"eslint-config-next" matches "next" at 16.3.5')));
});

test("lockfile verification is opt-in and detects drift", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agrocylo-versions-"));
  const lockfilePath = path.join(root, "package-lock.json");
  fs.writeFileSync(
    lockfilePath,
    `${JSON.stringify(
      {
        lockfileVersion: 3,
        packages: {
          "node_modules/next": { version: "16.2.4" },
          "node_modules/eslint-config-next": { version: "16.1.0" },
          "node_modules/react": { version: "19.2.3" },
          "node_modules/react-dom": { version: "19.2.3" },
        },
      },
      null,
      2,
    )}\n`,
  );

  const baseline = checker.checkSharedVersions({ apps: apps({}), rootDir: root });
  assert.equal(baseline.ok, true);

  const verified = checker.checkSharedVersions({ apps: apps({}), rootDir: root, verifyLockfile: true });
  assert.equal(verified.ok, false);
  const failure = verified.failures.find((f) => f.code === "LOCKFILE_DRIFT");
  assert.ok(failure, JSON.stringify(verified.failures));
  assert.match(failure.message, /eslint-config-next.*declared as 16\.2\.4 but the root lockfile resolves 16\.1\.0/);

  fs.writeFileSync(
    lockfilePath,
    `${JSON.stringify(
      {
        lockfileVersion: 3,
        packages: {
          "node_modules/next": { version: "16.2.4" },
          "node_modules/eslint-config-next": { version: "16.2.4" },
          "node_modules/react": { version: "19.2.3" },
          "node_modules/react-dom": { version: "19.2.3" },
        },
      },
      null,
      2,
    )}\n`,
  );
  const aligned = checker.checkSharedVersions({ apps: apps({}), rootDir: root, verifyLockfile: true });
  assert.equal(aligned.ok, true, JSON.stringify(aligned.failures));
});

test("installed verification detects a stale install", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agrocylo-versions-"));
  fs.mkdirSync(path.join(root, "node_modules", "next"), { recursive: true });
  fs.writeFileSync(path.join(root, "node_modules", "next", "package.json"), '{"name":"next","version":"16.1.0"}');

  const result = checker.checkSharedVersions({ apps: apps({}), rootDir: root, verifyInstalled: true });
  const failure = result.failures.find((f) => f.code === "INSTALLED_DRIFT" || f.code === "NOT_INSTALLED");
  assert.ok(failure, JSON.stringify(result.failures));
});
