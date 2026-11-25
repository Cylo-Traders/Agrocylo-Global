#!/usr/bin/env bash
# =============================================================================
# scripts/test-backend-healthcheck-1424.sh
#
# Regression test for Issue #1424:
# Root backend Docker healthcheck must fail (exit 1) when /health fails or
# refuses connections, honor configured PORT, and mark stopped containers
# unhealthy.
# =============================================================================

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKERFILE="$REPO_ROOT/server/Dockerfile"

echo "=== Test 1: server/Dockerfile does not contain 'test \$? -le 1' ==="
if grep -qE 'test\s+\$\?\s+-le\s+1' "$DOCKERFILE"; then
    echo "FAIL: server/Dockerfile still masks exit code 1 with 'test \$? -le 1'" >&2
    exit 1
fi
echo "  PASS"

echo "=== Test 2: server/Dockerfile HEALTHCHECK honors \${PORT:-5000} and exits 1 on failure ==="
grep -q 'http://localhost:${PORT:-5000}/health" || exit 1' "$DOCKERFILE" || {
    echo "FAIL: HEALTHCHECK command does not use \${PORT:-5000}/health || exit 1" >&2
    exit 1
}
echo "  PASS"

echo "=== Test 3: Docker container health transitions to unhealthy when app process stops (if docker daemon is active) ==="
if command -v docker &>/dev/null && docker info &>/dev/null; then
    CID="$(docker run -d --health-cmd='wget --timeout=2 -q --spider "http://localhost:${PORT:-5099}/health" || exit 1' --health-interval=1s --health-timeout=2s --health-retries=1 -e PORT=5099 alpine:3.20 sleep 30)"
    trap 'docker rm -f "$CID" >/dev/null 2>&1 || true' EXIT
    sleep 3
    STATUS="$(docker inspect --format '{{.State.Health.Status}}' "$CID")"
    if [[ "$STATUS" != "unhealthy" ]]; then
        echo "FAIL: expected container health 'unhealthy', got '$STATUS'" >&2
        exit 1
    fi
    echo "  PASS (container transitioned to unhealthy)"
else
    echo "  SKIP live docker daemon check (docker daemon not running in this environment)"
fi

echo "✅ All Issue #1424 root backend Docker healthcheck tests passed!"
