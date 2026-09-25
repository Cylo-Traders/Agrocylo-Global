"use strict";

/**
 * Issue #924 — the smoke harness must wait for real HTTP success, exercise
 * extra routes, fail within a fixed timeout and always clean up its processes.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const smoke = require("../smoke-dev-start");
const layout = require("../lib/workspace-layout");

const STUB = path.join(__dirname, "..", "__fixtures__", "dev-server-stub.js");

function freePort() {
  return 34000 + Math.floor(Math.random() * 2000);
}

function tmpLogDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agrocylo-smoke-"));
}

function startStub({ port, mode, logDir }) {
  return smoke.startServer({
    command: process.execPath,
    args: [STUB, String(port), mode],
    cwd: layout.REPO_ROOT,
    env: { ...process.env },
    logFile: path.join(logDir, `stub-${port}.log`),
    label: `stub-${port}`,
  });
}

async function portFree(port) {
  return smoke.isPortFree(port);
}

test("waits for HTTP 200 plus the content marker", async () => {
  const port = freePort();
  const logDir = tmpLogDir();
  const handle = startStub({ port, mode: "ok", logDir });
  try {
    const result = await smoke.waitForHttpResponse(`http://127.0.0.1:${port}/`, {
      timeoutMs: 10000,
      marker: "AgroCylo",
    });
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
  } finally {
    await handle.stop();
    handle.release();
  }
});

test("fails when the content marker is missing", async () => {
  const port = freePort();
  const logDir = tmpLogDir();
  const handle = startStub({ port, mode: "nomarker", logDir });
  try {
    const result = await smoke.waitForHttpResponse(`http://127.0.0.1:${port}/`, {
      timeoutMs: 5000,
      marker: "AgroCylo",
    });
    assert.equal(result.ok, false);
    assert.match(result.reason, /content marker "AgroCylo" was not found/);
  } finally {
    await handle.stop();
    handle.release();
  }
});

test("a persistent compile failure fails within the fixed timeout", async () => {
  const port = freePort();
  const logDir = tmpLogDir();
  const handle = startStub({ port, mode: "fail", logDir });
  try {
    const result = await smoke.waitForHttpResponse(`http://127.0.0.1:${port}/`, {
      timeoutMs: 8000,
      errorGraceMs: 300,
    });
    assert.equal(result.ok, false);
    assert.equal(result.status, 500);
    assert.match(result.reason, /HTTP 500/);
  } finally {
    await handle.stop();
    handle.release();
  }
});

test("times out when nothing ever listens", async () => {
  const port = freePort();
  const result = await smoke.waitForHttpResponse(`http://127.0.0.1:${port}/`, { timeoutMs: 1200 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /timed out/);
});

test("recovers from a temporary 503 while the route compiles", async () => {
  const port = freePort();
  const logDir = tmpLogDir();
  const handle = startStub({ port, mode: "slow", logDir });
  try {
    const result = await smoke.waitForHttpResponse(`http://127.0.0.1:${port}/`, {
      timeoutMs: 15000,
      errorGraceMs: 5000,
      marker: "AgroCylo",
    });
    assert.equal(result.ok, true);
  } finally {
    await handle.stop();
    handle.release();
  }
});

test("stop() kills the spawned process tree and releases the port", async () => {
  const port = freePort();
  const logDir = tmpLogDir();
  const handle = startStub({ port, mode: "ok", logDir });

  // Wait until the stub is actually listening before asserting it holds the port.
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && (await portFree(port))) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(await portFree(port), false);
  const exited = await handle.stop();
  assert.ok(exited, "server should have exited");
  handle.release();

  assert.equal(await smoke.waitForPortFree(port, { timeoutMs: 10000 }), true);
  assert.equal(await portFree(port), true);
});

test("a crashed server is reported through the handle", async () => {
  const port = freePort();
  const logDir = tmpLogDir();
  const handle = startStub({ port, mode: "crash", logDir });
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline && !handle.exited()) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const exited = handle.exited();
  assert.ok(exited);
  assert.equal(exited.code, 3);
  handle.release();
});

test("cleanup kills registered processes", async () => {
  const port = freePort();
  const logDir = tmpLogDir();
  const handle = startStub({ port, mode: "ok", logDir });
  smoke.runCleanups();
  assert.equal(await smoke.waitForPortFree(port, { timeoutMs: 10000 }), true);
  handle.release();
});

test("scenarios use deterministic ports and cover both apps plus the root launcher", () => {
  const all = smoke.buildScenarios({ app: "all", includeRootLauncher: true });
  assert.deepEqual(
    all.map((s) => s.id),
    ["client", "agro", "root-launcher"],
  );
  assert.deepEqual(all[0].expectations[0].port, 3000);
  assert.deepEqual(all[1].expectations[0].port, 3001);
  assert.deepEqual(
    all[2].expectations.map((e) => e.port),
    [3000, 3001],
  );
  assert.deepEqual(all[0].args, ["run", "dev", "--workspace", "client"]);
  assert.deepEqual(all[2].args, ["run", "dev"]);

  const single = smoke.buildScenarios({ app: "agro", includeRootLauncher: false });
  assert.equal(single.length, 1);
  assert.equal(single[0].id, "agro");
});

test("parseArgs defaults and flags", () => {
  const defaults = smoke.parseArgs([]);
  assert.equal(defaults.app, "all");
  assert.equal(defaults.cycles, 2);
  assert.equal(defaults.rootLauncher, true);

  const custom = smoke.parseArgs([
    "--app=client",
    "--no-root-launcher",
    "--cycles=1",
    "--timeout=5000",
    "--skip-install",
  ]);
  assert.equal(custom.app, "client");
  assert.equal(custom.rootLauncher, false);
  assert.equal(custom.cycles, 1);
  assert.equal(custom.timeoutMs, 5000);
  assert.equal(custom.install, false);
});

test("tailLog returns captured output", async () => {
  const port = freePort();
  const logDir = tmpLogDir();
  const handle = startStub({ port, mode: "ok", logDir });
  try {
    await smoke.waitForHttpResponse(`http://127.0.0.1:${port}/`, { timeoutMs: 10000 });
    const tail = smoke.tailLog(path.join(logDir, `stub-${port}.log`));
    assert.match(tail, /stub listening/);
  } finally {
    await handle.stop();
    handle.release();
  }
});
