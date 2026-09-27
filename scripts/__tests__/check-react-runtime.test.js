#!/usr/bin/env node
"use strict";

/**
 * Tests for scripts/check-react-runtime.js (issue #1041).
 *
 * Exercises the duplicate-runtime detection against synthetic lockfiles, so the
 * guard's pass/fail behaviour is pinned without depending on the real lockfile
 * -- which the overrides make pass only after `npm install` regenerates it.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const SCRIPT = path.join(__dirname, "..", "check-react-runtime.js");

function writeLockfile(packages) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "react-runtime-"));
  const file = path.join(dir, "package-lock.json");
  fs.writeFileSync(file, JSON.stringify({ lockfileVersion: 3, packages }, null, 2));
  return { dir, file };
}

function runCheck(lockfile) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, "--lockfile", lockfile], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    return { status: error.status ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

test("passes when a single React runtime is resolved", () => {
  const { dir, file } = writeLockfile({
    "": { name: "root" },
    "node_modules/react": { version: "19.2.3" },
    "node_modules/react-dom": { version: "19.2.3", peerDependencies: { react: "^19.2.3" } },
  });
  try {
    const result = runCheck(file);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /single react@19\.2\.3/);
    assert.match(result.stdout, /Single React runtime resolved/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fails when react resolves to two versions", () => {
  const { dir, file } = writeLockfile({
    "": { name: "root" },
    "node_modules/react": { version: "19.2.8", peer: true },
    "agro-production/client/node_modules/react": { version: "19.2.3" },
    "node_modules/react-dom": { version: "19.2.3" },
  });
  try {
    const result = runCheck(file);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /react resolves to 2 versions/);
    assert.match(result.stderr, /19\.2\.8/);
    assert.match(result.stderr, /19\.2\.3/);
    assert.match(result.stderr, /Invalid hook call/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fails when react-dom resolves to two versions", () => {
  const { dir, file } = writeLockfile({
    "": { name: "root" },
    "node_modules/react": { version: "19.2.3" },
    "node_modules/react-dom": { version: "19.2.8", peer: true },
    "client/node_modules/react-dom": { version: "19.2.3" },
  });
  try {
    const result = runCheck(file);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /react-dom resolves to 2 versions/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fails when a package is missing entirely", () => {
  const { dir, file } = writeLockfile({
    "": { name: "root" },
    "node_modules/react": { version: "19.2.3" },
  });
  try {
    const result = runCheck(file);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /resolves no react-dom/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("exits 2 on an unreadable lockfile rather than reporting a pass", () => {
  const result = runCheck(path.join(os.tmpdir(), "definitely-not-here-12345.json"));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /cannot read lockfile/);
});

test("ignores unrelated packages that merely end in react", () => {
  const { dir, file } = writeLockfile({
    "": { name: "root" },
    "node_modules/react": { version: "19.2.3" },
    "node_modules/react-dom": { version: "19.2.3" },
    "node_modules/@radix-ui/react-dialog": { version: "1.1.0" },
    "node_modules/some-react": { version: "9.9.9" },
  });
  try {
    const result = runCheck(file);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
