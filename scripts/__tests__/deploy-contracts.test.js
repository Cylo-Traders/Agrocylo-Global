"use strict";

/**
 * Issue #1281 — invoke_idempotent must correctly capture non-zero exit codes
 * on unexpected failures and fail loudly, tolerating only AlreadyInitialized.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

function runBash(script) {
  // Test using git bash or bash if available, or sh
  const bashExe = process.platform === "win32"
    ? "C:\\Program Files\\Git\\bin\\bash.exe"
    : "bash";
  return spawnSync(bashExe, ["-c", script], { encoding: "utf8" });
}

test("invoke_idempotent returns 0 on successful invocation", (t) => {
  const bashScript = `
    invoke_idempotent() {
        local out rc=0
        out="\$("\$@" 2>&1)" || rc=\$?
        if (( rc == 0 )); then
            printf '%s\n' "\$out"
            return 0
        fi
        if grep -qiE "AlreadyInitialized|already.initialized" <<<"\$out"; then
            echo "  (already initialized — skipping)"
            return 0
        fi
        printf '%s\n' "\$out" >&2
        return "\$rc"
    }

    mock_success() {
        echo "contract initialized successfully"
        return 0
    }

    invoke_idempotent mock_success
  `;

  const res = runBash(bashScript);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /contract initialized successfully/);
});

test("invoke_idempotent tolerates AlreadyInitialized error", (t) => {
  const bashScript = `
    invoke_idempotent() {
        local out rc=0
        out="\$("\$@" 2>&1)" || rc=\$?
        if (( rc == 0 )); then
            printf '%s\n' "\$out"
            return 0
        fi
        if grep -qiE "AlreadyInitialized|already.initialized" <<<"\$out"; then
            echo "  (already initialized — skipping)"
            return 0
        fi
        printf '%s\n' "\$out" >&2
        return "\$rc"
    }

    mock_already_init() {
        echo "HostError: Error(Contract, #1) AlreadyInitialized" >&2
        return 1
    }

    invoke_idempotent mock_already_init
  `;

  const res = runBash(bashScript);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /already initialized — skipping/);
});

test("invoke_idempotent propagates unexpected non-zero exit code (e.g. 7)", (t) => {
  const bashScript = `
    invoke_idempotent() {
        local out rc=0
        out="\$("\$@" 2>&1)" || rc=\$?
        if (( rc == 0 )); then
            printf '%s\n' "\$out"
            return 0
        fi
        if grep -qiE "AlreadyInitialized|already.initialized" <<<"\$out"; then
            echo "  (already initialized — skipping)"
            return 0
        fi
        printf '%s\n' "\$out" >&2
        return "\$rc"
    }

    mock_fail_7() {
        echo "RPC Connection Refused / Auth Failure" >&2
        return 7
    }

    invoke_idempotent mock_fail_7
  `;

  const res = runBash(bashScript);
  assert.equal(res.status, 7);
  assert.match(res.stderr, /RPC Connection Refused/);
});

test("unexpected failure halts deployment before subsequent mutations under set -e", (t) => {
  const bashScript = `
    set -euo pipefail

    invoke_idempotent() {
        local out rc=0
        out="\$("\$@" 2>&1)" || rc=\$?
        if (( rc == 0 )); then
            printf '%s\n' "\$out"
            return 0
        fi
        if grep -qiE "AlreadyInitialized|already.initialized" <<<"\$out"; then
            echo "  (already initialized — skipping)"
            return 0
        fi
        printf '%s\n' "\$out" >&2
        return "\$rc"
    }

    mock_fail_auth() {
        echo "Error: BadAuthentication" >&2
        return 2
    }

    step1_ran=false
    step2_ran=false

    # Step 1 fails
    invoke_idempotent mock_fail_auth
    step1_ran=true

    # Step 2 should never run
    step2_ran=true
  `;

  const res = runBash(bashScript);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /BadAuthentication/);
});
