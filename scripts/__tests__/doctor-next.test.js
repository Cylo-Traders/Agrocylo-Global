"use strict";

/**
 * Issue #920 — diagnostics must distinguish a missing package, a broken link
 * and an installed package outside the allowed bundler root, without ever
 * modifying the checkout.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const doctor = require("../lib/next-doctor");
const layout = require("../lib/workspace-layout");
const doctorCli = require("../doctor-next");

function makeWorkspace(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agrocylo-doctor-"));
  const appDir = path.join(root, "client");
  fs.mkdirSync(path.join(appDir, "src"), { recursive: true });
  fs.writeFileSync(
    path.join(appDir, "package.json"),
    `${JSON.stringify({ name: "client", dependencies: { next: "16.2.4" } }, null, 2)}\n`,
  );
  fs.writeFileSync(path.join(root, "package-lock.json"), '{ "lockfileVersion": 3 }\n');
  fs.writeFileSync(path.join(appDir, ".env.local"), "SECRET=keep\n");

  if (options.install !== false) {
    const target = options.installRoot || root;
    fs.mkdirSync(path.join(target, "node_modules", "next"), { recursive: true });
    fs.writeFileSync(
      path.join(target, "node_modules", "next", "package.json"),
      '{"name":"next","version":"16.2.4"}',
    );
  }

  return { root, appDir };
}

function writeConfig(appDir, rootExpression) {
  fs.writeFileSync(
    path.join(appDir, "next.config.ts"),
    `import type { NextConfig } from "next";\n\nconst root = ${rootExpression};\n\nconst nextConfig: NextConfig = {\n  turbopack: { root },\n};\n\nexport default nextConfig;\n`,
  );
}

test("healthy workspace install resolves next inside the bundler root", () => {
  const ws = makeWorkspace();
  const result = doctor.diagnoseApp(ws.appDir);

  assert.equal(result.ok, true, JSON.stringify(result.failures));
  assert.deepEqual(result.failures, []);
  const resolved = result.checks.find((c) => c.label === "Resolved next");
  assert.match(resolved.value, /next\/package\.json \(v16\.2\.4/);
  const inside = result.checks.find((c) => c.label === "Inside bundler root");
  assert.equal(inside.value, "yes");
  const bundlerRoot = result.checks.find((c) => c.label === "Effective bundler root");
  assert.equal(bundlerRoot.value, `${ws.root} (workspace policy)`);
});

test("missing package produces a distinct, actionable failure", () => {
  const ws = makeWorkspace({ install: false });
  const result = doctor.diagnoseApp(ws.appDir);

  assert.equal(result.ok, false);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].code, "NEXT_NOT_INSTALLED");
  assert.match(result.recovery.join("\n"), /npm ci/);
  assert.match(result.recovery.join("\n"), /NODE_PATH/);
});

test("broken link produces a distinct failure", () => {
  const ws = makeWorkspace({ install: false });
  fs.mkdirSync(path.join(ws.appDir, "node_modules", "next"), { recursive: true });
  fs.symlinkSync(
    path.join(ws.appDir, "does-not-exist", "package.json"),
    path.join(ws.appDir, "node_modules", "next", "package.json"),
  );

  const result = doctor.diagnoseApp(ws.appDir);
  assert.equal(result.ok, false);
  assert.equal(result.failures[0].code, "NEXT_BROKEN_LINK");
  assert.match(result.recovery.join("\n"), /npm ci/);
});

test("package installed outside the configured bundler root is reported", () => {
  const ws = makeWorkspace();
  // The app declares itself as its own bundler root while dependencies are
  // hoisted to the workspace root — the reported startup failure.
  writeConfig(ws.appDir, `"${ws.appDir.replace(/\\/g, "/")}"`);

  const result = doctor.diagnoseApp(ws.appDir);
  assert.equal(result.ok, false);
  assert.equal(result.failures[0].code, "ROOT_MISCONFIGURED");
  assert.match(result.failures[0].message, /outside the effective bundler root/);
  const bundlerRoot = result.checks.find((c) => c.label === "Effective bundler root");
  assert.equal(bundlerRoot.value, `${ws.appDir} (from next.config.ts)`);
});

test("a cwd-based bundler root is evaluated and caught", () => {
  const ws = makeWorkspace();
  // The historical bug: the root depends on the working directory and resolves
  // to the app directory, which excludes the hoisted dependencies.
  writeConfig(ws.appDir, 'process.cwd()');

  const result = doctor.diagnoseApp(ws.appDir);
  assert.equal(result.ok, false);
  assert.equal(result.failures[0].code, "ROOT_MISCONFIGURED");
  const bundlerRoot = result.checks.find((c) => c.label === "Effective bundler root");
  assert.equal(bundlerRoot.value, `${ws.appDir} (from next.config.ts)`);
});

test("a workspace-root bundler root is accepted", () => {
  const ws = makeWorkspace();
  writeConfig(ws.appDir, 'path.resolve(__dirname, "..")');

  const result = doctor.diagnoseApp(ws.appDir);
  assert.equal(result.ok, true, JSON.stringify(result.failures));
  const bundlerRoot = result.checks.find((c) => c.label === "Effective bundler root");
  assert.equal(bundlerRoot.value, `${ws.root} (from next.config.ts)`);
});

test("out-of-root install without an explicit config is still caught", () => {
  const ws = makeWorkspace();
  // Lockfile inside the app makes the app its own workspace root, while next
  // is hoisted one level up.
  fs.writeFileSync(path.join(ws.appDir, "package-lock.json"), '{ "lockfileVersion": 3 }\n');

  const result = doctor.diagnoseApp(ws.appDir);
  assert.equal(result.ok, false);
  assert.equal(result.failures[0].code, "NEXT_OUTSIDE_ROOT");
});

test("an app that does not declare next fails fast", () => {
  const ws = makeWorkspace();
  fs.writeFileSync(
    path.join(ws.appDir, "package.json"),
    `${JSON.stringify({ name: "client", dependencies: {} }, null, 2)}\n`,
  );

  const result = doctor.diagnoseApp(ws.appDir);
  assert.ok(result.failures.some((f) => f.code === "NEXT_NOT_DECLARED"));
});

test("diagnostics never modify the checkout", () => {
  const ws = makeWorkspace();
  const before = {
    manifest: fs.readFileSync(path.join(ws.appDir, "package.json"), "utf8"),
    lockfile: fs.readFileSync(path.join(ws.root, "package-lock.json"), "utf8"),
    env: fs.readFileSync(path.join(ws.appDir, ".env.local"), "utf8"),
  };

  doctor.diagnoseApp(ws.appDir);

  assert.equal(fs.readFileSync(path.join(ws.appDir, "package.json"), "utf8"), before.manifest);
  assert.equal(fs.readFileSync(path.join(ws.root, "package-lock.json"), "utf8"), before.lockfile);
  assert.equal(fs.readFileSync(path.join(ws.appDir, ".env.local"), "utf8"), before.env);
  assert.equal(fs.existsSync(path.join(ws.appDir, ".next")), false);
});

test("diagnostics never print environment values", () => {
  const ws = makeWorkspace({ install: false });
  process.env.AGROCYLO_TEST_SECRET = "super-secret-value";
  try {
    const result = doctor.diagnoseApp(ws.appDir);
    const rendered = `${JSON.stringify(result)}`;
    assert.equal(rendered.includes("super-secret-value"), false);
  } finally {
    delete process.env.AGROCYLO_TEST_SECRET;
  }
});

test("CLI exits nonzero for a blocking failure and zero when healthy", () => {
  const broken = makeWorkspace({ install: false });
  const healthy = makeWorkspace();
  const sink = { write: () => {} };

  const brokenCode = doctorCli.main([], {
    apps: [{ key: "client", label: "fixture client", dir: broken.appDir }],
    out: sink,
  });
  const healthyCode = doctorCli.main([], {
    apps: [{ key: "client", label: "fixture client", dir: healthy.appDir }],
    out: sink,
  });

  assert.equal(brokenCode, 1);
  assert.equal(healthyCode, 0);
});

test("CLI selects the app from the current working directory", () => {
  const original = process.cwd();
  try {
    process.chdir(layout.resolveApp("client").dir);
    const selected = doctorCli.selectApps(null);
    assert.equal(selected.length, 1);
    assert.equal(selected[0].key, "client");
  } finally {
    process.chdir(original);
  }
});

test("real repository clients resolve next locally", () => {
  // Skipped when dependencies are not installed; CI always installs first.
  if (!fs.existsSync(path.join(layout.REPO_ROOT, "node_modules", "next", "package.json"))) return;
  for (const app of layout.listApps()) {
    const result = doctor.diagnoseApp(app.dir);
    assert.equal(result.ok, true, `${app.key}: ${JSON.stringify(result.failures)}`);
  }
});
