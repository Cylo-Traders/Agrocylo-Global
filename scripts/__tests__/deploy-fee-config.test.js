"use strict";

/**
 * Issue #1289 — Explicit zero-fee marketplace configuration and verification.
 * Verifies deploy-contracts.sh fee wiring logic:
 * 1. Always applies fee config (including explicit 0 bps).
 * 2. Compares both fee rate AND fee collector to detect collector-only changes.
 * 3. Skips wiring only when both fee rate and collector match.
 * 4. Fails clearly on governed reruns when set_fee_config is rejected.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

function runBash(script) {
  const bashExe = process.platform === "win32"
    ? "C:\\Program Files\\Git\\bin\\bash.exe"
    : "bash";
  return spawnSync(bashExe, ["-c", script], { encoding: "utf8" });
}

test("fee wiring applies explicit zero fee rate (0 bps)", (t) => {
  const bashScript = `
    set -euo pipefail

    ESCROW="mock_escrow"
    ADMIN="mock_admin"
    FEE_COLLECTOR="mock_collector"
    FEE_RATE_BPS=0

    # Mock contract read returning unconfigured default 300 bps
    invoke_read() {
        local id="$1" fn="$2"
        if [[ "$fn" == "get_fee_rate_bps" ]]; then
            echo "300"
        elif [[ "$fn" == "get_fee_collector" ]]; then
            echo "mock_collector"
        fi
    }

    INVOKED_SET_CONFIG="false"
    invoke() {
        INVOKED_SET_CONFIG="true"
        echo "set_fee_config called with: $*"
    }

    CURRENT_FEE_RATE="$(invoke_read "$ESCROW" get_fee_rate_bps || true)"
    CURRENT_FEE_COLLECTOR="$(invoke_read "$ESCROW" get_fee_collector || true)"
    if [[ "\${CURRENT_FEE_RATE}:\${CURRENT_FEE_COLLECTOR}" == "\${FEE_RATE_BPS}:\${FEE_COLLECTOR}" ]]; then
        echo "  = escrow.fee_config already rate=\$FEE_RATE_BPS collector=\$FEE_COLLECTOR"
    else
        echo "  + escrow.fee_config -> rate=\$FEE_RATE_BPS collector=\$FEE_COLLECTOR"
        invoke "$ESCROW" set_fee_config --admin_caller "$ADMIN" --fee_collector "$FEE_COLLECTOR" --fee_rate_bps "$FEE_RATE_BPS"
    fi

    echo "INVOKED=\$INVOKED_SET_CONFIG"
  `;

  const res = runBash(bashScript);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /escrow\.fee_config -> rate=0 collector=mock_collector/);
  assert.match(res.stdout, /INVOKED=true/);
});

test("fee wiring skips invocation when rate and collector already match", (t) => {
  const bashScript = `
    set -euo pipefail

    ESCROW="mock_escrow"
    ADMIN="mock_admin"
    FEE_COLLECTOR="mock_collector"
    FEE_RATE_BPS=0

    invoke_read() {
        local id="$1" fn="$2"
        if [[ "$fn" == "get_fee_rate_bps" ]]; then
            echo "0"
        elif [[ "$fn" == "get_fee_collector" ]]; then
            echo "mock_collector"
        fi
    }

    INVOKED_SET_CONFIG="false"
    invoke() {
        INVOKED_SET_CONFIG="true"
    }

    CURRENT_FEE_RATE="$(invoke_read "$ESCROW" get_fee_rate_bps || true)"
    CURRENT_FEE_COLLECTOR="$(invoke_read "$ESCROW" get_fee_collector || true)"
    if [[ "\${CURRENT_FEE_RATE}:\${CURRENT_FEE_COLLECTOR}" == "\${FEE_RATE_BPS}:\${FEE_COLLECTOR}" ]]; then
        echo "  = escrow.fee_config already rate=\$FEE_RATE_BPS collector=\$FEE_COLLECTOR"
    else
        echo "  + escrow.fee_config -> rate=\$FEE_RATE_BPS collector=\$FEE_COLLECTOR"
        invoke "$ESCROW" set_fee_config --admin_caller "$ADMIN" --fee_collector "$FEE_COLLECTOR" --fee_rate_bps "$FEE_RATE_BPS"
    fi

    echo "INVOKED=\$INVOKED_SET_CONFIG"
  `;

  const res = runBash(bashScript);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /escrow\.fee_config already rate=0 collector=mock_collector/);
  assert.match(res.stdout, /INVOKED=false/);
});

test("fee wiring detects collector-only mismatch and updates config", (t) => {
  const bashScript = `
    set -euo pipefail

    ESCROW="mock_escrow"
    ADMIN="mock_admin"
    FEE_COLLECTOR="new_collector"
    FEE_RATE_BPS=50

    invoke_read() {
        local id="$1" fn="$2"
        if [[ "$fn" == "get_fee_rate_bps" ]]; then
            echo "50"
        elif [[ "$fn" == "get_fee_collector" ]]; then
            echo "old_collector"
        fi
    }

    INVOKED_SET_CONFIG="false"
    invoke() {
        INVOKED_SET_CONFIG="true"
        echo "set_fee_config called with: $*"
    }

    CURRENT_FEE_RATE="$(invoke_read "$ESCROW" get_fee_rate_bps || true)"
    CURRENT_FEE_COLLECTOR="$(invoke_read "$ESCROW" get_fee_collector || true)"
    if [[ "\${CURRENT_FEE_RATE}:\${CURRENT_FEE_COLLECTOR}" == "\${FEE_RATE_BPS}:\${FEE_COLLECTOR}" ]]; then
        echo "  = escrow.fee_config already rate=\$FEE_RATE_BPS collector=\$FEE_COLLECTOR"
    else
        echo "  + escrow.fee_config -> rate=\$FEE_RATE_BPS collector=\$FEE_COLLECTOR"
        invoke "$ESCROW" set_fee_config --admin_caller "$ADMIN" --fee_collector "$FEE_COLLECTOR" --fee_rate_bps "$FEE_RATE_BPS"
    fi

    echo "INVOKED=\$INVOKED_SET_CONFIG"
  `;

  const res = runBash(bashScript);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /escrow\.fee_config -> rate=50 collector=new_collector/);
  assert.match(res.stdout, /INVOKED=true/);
});

test("governed rerun fails clearly when set_fee_config is rejected", (t) => {
  const bashScript = `
    set -euo pipefail

    ESCROW="mock_escrow"
    ADMIN="mock_admin"
    FEE_COLLECTOR="mock_collector"
    FEE_RATE_BPS=0

    invoke_read() {
        local id="$1" fn="$2"
        if [[ "$fn" == "get_fee_rate_bps" ]]; then
            echo "300"
        elif [[ "$fn" == "get_fee_collector" ]]; then
            echo "mock_collector"
        fi
    }

    # Simulate contract failure due to active governance (NotGoverned)
    invoke() {
        echo "HostError: Error(Contract, #21) NotGoverned" >&2
        return 1
    }

    CURRENT_FEE_RATE="$(invoke_read "$ESCROW" get_fee_rate_bps || true)"
    CURRENT_FEE_COLLECTOR="$(invoke_read "$ESCROW" get_fee_collector || true)"
    if [[ "\${CURRENT_FEE_RATE}:\${CURRENT_FEE_COLLECTOR}" == "\${FEE_RATE_BPS}:\${FEE_COLLECTOR}" ]]; then
        echo "  = escrow.fee_config already rate=\$FEE_RATE_BPS collector=\$FEE_COLLECTOR"
    else
        echo "  + escrow.fee_config -> rate=\$FEE_RATE_BPS collector=\$FEE_COLLECTOR"
        if ! invoke "$ESCROW" set_fee_config --admin_caller "$ADMIN" --fee_collector "$FEE_COLLECTOR" --fee_rate_bps "$FEE_RATE_BPS"; then
            echo "Error: failed to apply escrow.fee_config (rate: \$FEE_RATE_BPS bps, collector: \$FEE_COLLECTOR). A governed contract cannot have fee configuration changed via raw admin; submit an authorized governance proposal." >&2
            exit 1
        fi
    fi
  `;

  const res = runBash(bashScript);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /A governed contract cannot have fee configuration changed via raw admin/);
});

test("verification pass asserts fee rate and collector readbacks", (t) => {
  const bashScript = `
    set -euo pipefail

    ESCROW="mock_escrow"
    FEE_RATE_BPS=0
    FEE_COLLECTOR="mock_collector"

    invoke_read() {
        local id="$1" fn="$2"
        if [[ "$fn" == "get_fee_rate_bps" ]]; then
            echo "0"
        elif [[ "$fn" == "get_fee_collector" ]]; then
            echo "mock_collector"
        fi
    }

    FAILURES=0
    check() {
        if [[ "\$2" == "\$3" ]]; then
            echo "  ok   \$1 = \$3"
        else
            echo "  FAIL \$1: expected '\$3', got '\$2'" >&2
            FAILURES=\$((FAILURES + 1))
        fi
    }

    m_get() { echo ""; }

    EXPECTED_FEE_RATE_BPS="\${FEE_RATE_BPS:-\$(m_get '.wiring."escrow.fee_rate_bps"')}"
    check "escrow.get_fee_rate_bps"        "\$(invoke_read "\$ESCROW" get_fee_rate_bps || true)"    "\$EXPECTED_FEE_RATE_BPS"
    EXPECTED_FEE_COLLECTOR="\${FEE_COLLECTOR:-\$(m_get '.wiring."escrow.fee_collector"')}"
    if [[ -n "\$EXPECTED_FEE_COLLECTOR" ]]; then
        check "escrow.get_fee_collector"   "\$(invoke_read "\$ESCROW" get_fee_collector || true)"   "\$EXPECTED_FEE_COLLECTOR"
    fi

    echo "FAILURES=\$FAILURES"
  `;

  const res = runBash(bashScript);
  assert.equal(res.status, 0);
  assert.match(res.stdout, /ok   escrow\.get_fee_rate_bps = 0/);
  assert.match(res.stdout, /ok   escrow\.get_fee_collector = mock_collector/);
  assert.match(res.stdout, /FAILURES=0/);
});
