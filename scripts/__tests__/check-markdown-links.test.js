#!/usr/bin/env node
"use strict";

/**
 * Tests for scripts/check-markdown-links.js (Issue #1453).
 *
 * Verifies that:
 * 1. All tracked Markdown relative links in the repository resolve cleanly
 *    (including docs/contracts/TTL_KEEPER.md -> ./TTL_POLICY.md).
 * 2. An intentionally broken relative Markdown link in a tracked fixture repository
 *    causes check-markdown-links.js to exit with code 1.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const SCRIPT = path.join(__dirname, "..", "check-markdown-links.js");
const REPO_ROOT = path.resolve(__dirname, "..", "..");

test("check-markdown-links passes on the repository and resolves docs/contracts/TTL_POLICY.md", () => {
  const ttlPolicyPath = path.join(REPO_ROOT, "docs", "contracts", "TTL_POLICY.md");
  assert.ok(fs.existsSync(ttlPolicyPath), "docs/contracts/TTL_POLICY.md must exist");

  const stdout = execFileSync(process.execPath, [SCRIPT], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.match(stdout, /Tracked Markdown relative links: OK/);
});

test("check-markdown-links fails with exit code 1 on an intentionally broken relative link", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "md-links-test-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: tmpDir });
    const docPath = path.join(tmpDir, "README.md");
    fs.writeFileSync(docPath, "# Test\n\nSee [Missing Doc](./DOES_NOT_EXIST.md) for details.\n", "utf8");
    execFileSync("git", ["add", "README.md"], { cwd: tmpDir });

    let exitCode = 0;
    let stderr = "";
    try {
      execFileSync(process.execPath, [SCRIPT], {
        cwd: tmpDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      exitCode = err.status ?? 1;
      stderr = err.stderr ?? "";
    }

    assert.equal(exitCode, 1, "Expected check-markdown-links.js to fail with exit code 1");
    assert.match(stderr, /README\.md: broken relative link \.\/DOES_NOT_EXIST\.md/);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
