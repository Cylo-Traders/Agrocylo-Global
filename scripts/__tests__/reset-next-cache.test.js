"use strict";

/**
 * Issue #921 — proves the cache reset only ever removes the selected app's
 * generated output.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { resetAppCache, inspectCacheDir, CacheResetError } = require("../lib/next-cache");
const layout = require("../lib/workspace-layout");

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agrocylo-reset-"));
  const clientDir = path.join(root, "client");
  const agroDir = path.join(root, "agro-production", "client");

  for (const dir of [clientDir, agroDir]) {
    fs.mkdirSync(path.join(dir, "src"), { recursive: true });
    fs.writeFileSync(path.join(dir, "package.json"), `${JSON.stringify({ name: path.basename(dir) }, null, 2)}\n`);
    fs.writeFileSync(path.join(dir, "package-lock.json"), "{}\n");
    fs.writeFileSync(path.join(dir, ".env.local"), "SECRET=do-not-delete\n");
    fs.mkdirSync(path.join(dir, "node_modules", "next"), { recursive: true });
    fs.writeFileSync(path.join(dir, "node_modules", "next", "package.json"), '{"name":"next","version":"16.2.4"}');
    fs.writeFileSync(path.join(dir, "src", "page.tsx"), "export default function Page() { return null; }\n");
    fs.mkdirSync(path.join(dir, ".next", "dev", "server", "pages", "_app"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, ".next", "dev", "server", "pages", "_app", "build-manifest.json"),
      "{}",
    );
  }

  return { root, clientDir, agroDir };
}

function snapshot(dir) {
  const entries = [];
  const walk = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else entries.push(path.relative(dir, full));
    }
  };
  if (fs.existsSync(dir)) walk(dir);
  return entries.sort();
}

test("reset removes the selected app's generated output", () => {
  const ws = makeWorkspace();
  const result = resetAppCache(ws.clientDir, { logger: () => {} });

  assert.equal(result.removed, true);
  assert.equal(fs.existsSync(path.join(ws.clientDir, ".next")), false);

  // Everything that is not generated output survives.
  assert.ok(fs.existsSync(path.join(ws.clientDir, "package.json")));
  assert.ok(fs.existsSync(path.join(ws.clientDir, "package-lock.json")));
  assert.ok(fs.existsSync(path.join(ws.clientDir, ".env.local")));
  assert.ok(fs.existsSync(path.join(ws.clientDir, "src", "page.tsx")));
  assert.ok(fs.existsSync(path.join(ws.clientDir, "node_modules", "next", "package.json")));
});

test("reset never touches the other client's cache", () => {
  const ws = makeWorkspace();
  resetAppCache(ws.clientDir, { logger: () => {} });

  assert.ok(fs.existsSync(path.join(ws.agroDir, ".next", "dev", "server", "pages", "_app", "build-manifest.json")));
  assert.deepEqual(
    snapshot(ws.agroDir).filter((f) => f.startsWith(".next")),
    [path.join(".next", "dev", "server", "pages", "_app", "build-manifest.json")],
  );
});

test("reset is idempotent when the cache is already absent", () => {
  const ws = makeWorkspace();
  fs.rmSync(path.join(ws.clientDir, ".next"), { recursive: true, force: true });

  const first = resetAppCache(ws.clientDir, { logger: () => {} });
  const second = resetAppCache(ws.clientDir, { logger: () => {} });

  assert.equal(first.removed, false);
  assert.equal(first.alreadyAbsent, true);
  assert.equal(second.alreadyAbsent, true);
  assert.ok(fs.existsSync(path.join(ws.clientDir, "package.json")));
});

test("reset refuses to follow a .next symlink outside the app", () => {
  const ws = makeWorkspace();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "agrocylo-outside-"));
  fs.writeFileSync(path.join(outside, "important.txt"), "must survive\n");

  fs.rmSync(path.join(ws.clientDir, ".next"), { recursive: true, force: true });
  fs.symlinkSync(outside, path.join(ws.clientDir, ".next"), "dir");

  assert.throws(
    () => resetAppCache(ws.clientDir, { logger: () => {} }),
    (error) => error instanceof CacheResetError && error.code === "CACHE_IS_SYMLINK",
  );

  assert.ok(fs.existsSync(path.join(outside, "important.txt")));
  assert.ok(fs.lstatSync(path.join(ws.clientDir, ".next")).isSymbolicLink());
});

test("inspect reports a symlink instead of resolving it", () => {
  const ws = makeWorkspace();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "agrocylo-outside-"));
  fs.rmSync(path.join(ws.clientDir, ".next"), { recursive: true, force: true });
  fs.symlinkSync(outside, path.join(ws.clientDir, ".next"), "dir");

  const info = inspectCacheDir(ws.clientDir);
  assert.equal(info.state, "symlink");
  assert.equal(info.realPath, fs.realpathSync(outside));
});

test("reset refuses a target outside the selected app", () => {
  const ws = makeWorkspace();
  // A relative cache path that escapes the app directory must never be honoured.
  assert.throws(
    () => resetAppCache(ws.clientDir, { cacheDirName: "../agro-production/client/.next" }),
    (error) => error instanceof CacheResetError && error.code === "CACHE_TARGET_OUTSIDE_APP",
  );
  assert.ok(fs.existsSync(path.join(ws.agroDir, ".next")));
});

test("dry run leaves the cache in place", () => {
  const ws = makeWorkspace();
  const result = resetAppCache(ws.clientDir, { dryRun: true, logger: () => {} });
  assert.equal(result.dryRun, true);
  assert.ok(fs.existsSync(path.join(ws.clientDir, ".next")));
});

test("known workspace paths resolve inside the repository", () => {
  for (const app of layout.listApps()) {
    const info = inspectCacheDir(app.dir);
    assert.equal(path.dirname(info.cachePath), app.dir);
    assert.ok(layout.isInside(app.dir, info.cachePath));
  }
});
