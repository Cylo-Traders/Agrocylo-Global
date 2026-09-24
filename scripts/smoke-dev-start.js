#!/usr/bin/env node
"use strict";

/**
 * Issue #924 — cold-start HTTP smoke coverage for both Next.js workspaces.
 *
 *   node scripts/smoke-dev-start.js                     # both apps + root launcher
 *   node scripts/smoke-dev-start.js --app=client        # marketplace client only
 *   node scripts/smoke-dev-start.js --skip-install      # reuse an existing install
 *   node scripts/smoke-dev-start.js --reset-cache       # start from empty .next
 *
 * What it does, per scenario:
 *   1. Runs the read-only doctor so a broken bundler root / missing package is
 *      reported before a server is even started.
 *   2. Starts the app through its documented workspace command with a
 *      deterministic port and non-production configuration.
 *   3. Waits for a real HTTP 200 containing an app-specific content marker,
 *      then requests extra routes so lazy route compilation is exercised.
 *   4. Optionally repeats as a stop/start cycle, then stops the server and
 *      verifies the port is released.
 *
 * Every spawned process is killed on success, failure and cancellation.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const net = require("net");
const path = require("path");

const layout = require("./lib/workspace-layout");
const doctor = require("./lib/next-doctor");
const { resetAppCache } = require("./lib/next-cache");

const DEFAULT_LOG_DIR = ".smoke-logs";

/** Deterministic, non-production configuration for the smoke run. */
const SMOKE_ENV = {
  NODE_ENV: "development",
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_DEMO_MODE: "true",
  NEXT_PUBLIC_SOROBAN_RPC_URL: "https://soroban-testnet.stellar.org",
  NEXT_PUBLIC_NETWORK_PASSPHRASE: "Test SDF Network ; September 2015",
  NEXT_PUBLIC_HORIZON_URL: "https://horizon-testnet.stellar.org",
};

/** Per-app expectations: port, content marker and extra routes to compile. */
const APP_PROFILES = {
  client: {
    key: "client",
    ports: [3000],
    marker: "AgroCylo",
    routes: ["/", "/market", "/about"],
  },
  agro: {
    key: "agro",
    ports: [3001],
    marker: "Agro Production",
    routes: ["/", "/campaigns"],
  },
};

const USAGE = `Usage: node scripts/smoke-dev-start.js [--app=<client|agro|all>] [options]

Options:
  --app=<name>        Scenarios to run (default: all).
  --no-root-launcher  Skip the root \`npm run dev\` (Turborepo) scenario.
  --cycles=<n>        Start/stop cycles per scenario (default: 2).
  --timeout=<ms>      Per-wait timeout in milliseconds (default: 180000).
  --reset-cache       Remove the app's generated .next before starting.
  --no-reset-cache    Never remove generated output (default when not running in CI).
  --skip-install      Do not run \`npm ci\` at the repository root first.
  --install-timeout=<ms>  Timeout for \`npm ci\` (default: 600000).
  --log-dir=<dir>     Where startup logs are written (default: ${DEFAULT_LOG_DIR}).
  -h, --help          Show this message.
`;

// ── process bookkeeping ────────────────────────────────────────────────────
const cleanups = new Set();
let cleanupRunning = false;

function registerCleanup(fn) {
  cleanups.add(fn);
  return () => cleanups.delete(fn);
}

function runCleanups() {
  if (cleanupRunning) return;
  cleanupRunning = true;
  for (const fn of [...cleanups]) {
    try {
      fn();
    } catch {
      /* best effort: cleanup must never mask the real failure */
    }
  }
  cleanups.clear();
  cleanupRunning = false;
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    runCleanups();
    process.exit(130);
  });
}
process.on("exit", runCleanups);

// ── helpers ────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

/** True when nothing is listening on the port. */
function isPortFree(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, host);
  });
}

async function waitForPortFree(port, { timeoutMs = 15000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isPortFree(port)) return true;
    await sleep(250);
  }
  return false;
}

/**
 * Poll `url` until it answers 200 and (optionally) contains `marker`.
 * Connection failures mean "still booting"; a persistent 4xx/5xx is a real
 * compile/runtime failure and is reported as soon as the grace period passes.
 */
async function waitForHttpResponse(url, options = {}) {
  const {
    timeoutMs = 180000,
    intervalMs = 500,
    marker = null,
    errorGraceMs = 15000,
    fetchImpl = globalThis.fetch,
  } = options;

  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  let lastStatus = null;
  let lastBody = "";
  let firstErrorAt = null;

  while (Date.now() < deadline) {
    try {
      const response = await fetchImpl(url, {
        redirect: "follow",
        // Cold route compilation can take tens of seconds; one request is
        // allowed up to a minute before it is retried.
        signal: AbortSignal.timeout(Math.min(60000, Math.max(30000, timeoutMs))),
      });
      lastStatus = response.status;
      const body = await response.text();
      lastBody = body;

      if (response.status >= 400) {
        if (firstErrorAt === null) firstErrorAt = Date.now();
        if (Date.now() - firstErrorAt > errorGraceMs) {
          return {
            ok: false,
            status: response.status,
            body,
            reason: `server answered HTTP ${response.status} for ${url} for longer than ${errorGraceMs}ms`,
            snippet: body.slice(0, 1200),
          };
        }
      } else if (response.status === 200 && (!marker || body.includes(marker))) {
        return { ok: true, status: response.status, body };
      } else {
        firstErrorAt = null;
        if (response.status === 200 && marker) {
          return {
            ok: false,
            status: response.status,
            body,
            reason: `HTTP 200 from ${url} but the content marker "${marker}" was not found`,
            snippet: body.slice(0, 1200),
          };
        }
      }
    } catch (error) {
      lastError = error;
      firstErrorAt = null;
    }
    await sleep(intervalMs);
  }

  return {
    ok: false,
    status: lastStatus,
    body: lastBody,
    reason: lastError
      ? `timed out after ${timeoutMs}ms waiting for ${url} (last error: ${lastError.message || lastError})`
      : `timed out after ${timeoutMs}ms waiting for ${url} (last status: ${lastStatus || "none"})`,
    snippet: lastBody.slice(0, 1200),
  };
}

/**
 * Start a dev server. Returns a handle with the child process, its log file
 * and a `stop()` that kills the whole process tree.
 */
function startServer({ command, args, cwd, env, logFile, label }) {
  ensureDir(path.dirname(logFile));
  const stream = fs.createWriteStream(logFile, { flags: "a" });
  const isWindows = process.platform === "win32";

  const child = spawn(command, args, {
    cwd,
    env,
    detached: !isWindows,
    shell: isWindows,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const write = (chunk) => {
    try {
      stream.write(chunk);
    } catch {
      /* ignore log write failures */
    }
  };
  child.stdout.on("data", write);
  child.stderr.on("data", write);

  let exited = null;
  child.on("exit", (code, signal) => {
    exited = { code, signal };
  });

  const handle = {
    label,
    pid: child.pid,
    logFile,
    exited: () => exited,
    stop: async ({ graceMs = 5000 } = {}) => {
      if (exited) return exited;
      if (isWindows) {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        try {
          process.kill(-child.pid, "SIGTERM");
        } catch {
          try {
            child.kill("SIGTERM");
          } catch {
            /* already gone */
          }
        }
      }
      const deadline = Date.now() + graceMs;
      while (Date.now() < deadline && !exited) await sleep(200);
      if (!exited) {
        if (isWindows) {
          spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
        } else {
          try {
            process.kill(-child.pid, "SIGKILL");
          } catch {
            try {
              child.kill("SIGKILL");
            } catch {
              /* already gone */
            }
          }
        }
        const hardDeadline = Date.now() + 5000;
        while (Date.now() < hardDeadline && !exited) await sleep(200);
      }
      try {
        stream.end();
      } catch {
        /* ignore */
      }
      return exited;
    },
  };

  const unregister = registerCleanup(() => {
    if (!handle.exited()) {
      // Fire-and-forget: cleanup runs synchronously on exit.
      if (isWindows) {
        spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } else {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          try {
            child.kill("SIGKILL");
          } catch {
            /* already gone */
          }
        }
      }
    }
    try {
      stream.end();
    } catch {
      /* ignore */
    }
  });
  handle.release = unregister;

  return handle;
}

/** Tail of a log file, used to make failures actionable. */
function tailLog(logFile, maxBytes = 4000) {
  try {
    const size = fs.statSync(logFile).size;
    const fd = fs.openSync(logFile, "r");
    const length = Math.min(size, maxBytes);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, Math.max(0, size - length));
    fs.closeSync(fd);
    return buffer.toString("utf8");
  } catch {
    return "(no log output captured)";
  }
}

function runInstall({ rootDir, timeoutMs, logFile, env }) {
  return new Promise((resolve, reject) => {
    ensureDir(path.dirname(logFile));
    const stream = fs.createWriteStream(logFile, { flags: "a" });
    const child = spawn("npm", ["ci"], {
      cwd: rootDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => stream.write(chunk));
    child.stderr.on("data", (chunk) => stream.write(chunk));
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`npm ci exceeded ${timeoutMs}ms — see ${logFile}`));
    }, timeoutMs);
    child.on("error", reject);
    child.on("exit", (code) => {
      clearTimeout(timer);
      stream.end();
      resolve(code);
    });
  });
}

// ── scenario runner ────────────────────────────────────────────────────────
function buildScenarios({ app, includeRootLauncher }) {
  const apps = app === "all" ? layout.listApps() : [layout.resolveApp(app)];
  const scenarios = apps.map((entry) => {
    const profile = APP_PROFILES[entry.key];
    return {
      id: entry.key,
      label: `${entry.label} via \`npm run dev --workspace ${entry.npmName}\``,
      apps: [entry],
      command: "npm",
      args: ["run", "dev", "--workspace", entry.npmName],
      expectations: [{ port: profile.ports[0], marker: profile.marker, routes: profile.routes }],
    };
  });

  if (includeRootLauncher) {
    scenarios.push({
      id: "root-launcher",
      label: "both apps via root `npm run dev` (Turborepo)",
      apps: layout.listApps(),
      command: "npm",
      args: ["run", "dev"],
      expectations: layout
        .listApps()
        .map((entry) => APP_PROFILES[entry.key])
        .filter(Boolean)
        .map((profile) => ({ port: profile.ports[0], marker: profile.marker, routes: profile.routes.slice(0, 2) })),
    });
  }

  return scenarios;
}

async function runScenario(scenario, options) {
  const { timeoutMs, cycles, resetCache, logDir, env } = options;
  const results = [];
  const started = Date.now();

  process.stdout.write(`\n▶ ${scenario.label}\n`);

  // 1. Preflight diagnostics: catches a missing package, a broken link and a
  //    bundler root that excludes the installed dependencies.
  for (const app of scenario.apps) {
    const diagnosis = doctor.diagnoseApp(app.dir);
    if (!diagnosis.ok) {
      results.push({
        scenario: scenario.id,
        ok: false,
        phase: "preflight",
        reason: `doctor blocked ${app.label}: ${diagnosis.failures
          .map((f) => `${f.code} — ${f.message}`)
          .join(" | ")}`,
        recovery: diagnosis.recovery,
      });
      process.stdout.write(`  ✗ preflight: ${app.label} failed diagnostics\n`);
      return { scenario: scenario.id, ok: false, results, durationMs: Date.now() - started };
    }
  }

  // 2. Optional cold start: remove the generated output of the apps in this
  //    scenario only. Never the other app, never node_modules or lockfiles.
  if (resetCache) {
    for (const app of scenario.apps) {
      resetAppCache(app.dir, {
        logger: (msg) => process.stdout.write(`  • ${msg}\n`),
      });
    }
  }

  // 3. Deterministic ports must be free before we start.
  for (const expectation of scenario.expectations) {
    if (!(await isPortFree(expectation.port))) {
      results.push({
        scenario: scenario.id,
        ok: false,
        phase: "port",
        reason: `port ${expectation.port} is already in use — stop the running dev server and retry`,
      });
      return { scenario: scenario.id, ok: false, results, durationMs: Date.now() - started };
    }
  }

  // 4. Start / verify / stop cycles.
  for (let cycle = 1; cycle <= cycles; cycle += 1) {
    const logFile = path.join(logDir, `${scenario.id}-cycle${cycle}.log`);
    const handle = startServer({
      command: scenario.command,
      args: scenario.args,
      cwd: layout.REPO_ROOT,
      env,
      logFile,
      label: scenario.id,
    });

    try {
      for (const expectation of scenario.expectations) {
        const baseUrl = `http://127.0.0.1:${expectation.port}`;
        for (const route of expectation.routes) {
          const url = `${baseUrl}${route}`;
          const waited = await waitForHttpResponse(url, {
            timeoutMs,
            marker: route === "/" ? expectation.marker : null,
          });
          if (!waited.ok) {
            const crashed = handle.exited();
            results.push({
              scenario: scenario.id,
              ok: false,
              phase: `cycle${cycle}`,
              reason: waited.reason,
              snippet: waited.snippet,
              logFile,
              logTail: tailLog(logFile),
              crashed: crashed ? `server exited (code ${crashed.code}, signal ${crashed.signal})` : null,
            });
            process.stdout.write(`  ✗ ${url}: ${waited.reason}\n`);
            return { scenario: scenario.id, ok: false, results, durationMs: Date.now() - started };
          }
          process.stdout.write(`  ✓ ${url} → 200${route === "/" ? ` (marker "${expectation.marker}")` : ""}\n`);
        }
      }
      results.push({ scenario: scenario.id, ok: true, phase: `cycle${cycle}`, logFile });
    } finally {
      await handle.stop();
      handle.release();
    }

    const freed = await waitForPortFree(scenario.expectations[0].port, { timeoutMs: 15000 });
    if (!freed) {
      results.push({
        scenario: scenario.id,
        ok: false,
        phase: `cycle${cycle}-shutdown`,
        reason: `port ${scenario.expectations[0].port} was still held after stopping the server — a process from this harness is still running`,
        logFile,
      });
      return { scenario: scenario.id, ok: false, results, durationMs: Date.now() - started };
    }
  }

  return { scenario: scenario.id, ok: true, results, durationMs: Date.now() - started };
}

// ── CLI ────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = {
    app: "all",
    rootLauncher: true,
    cycles: 2,
    timeoutMs: 180000,
    resetCache: Boolean(process.env.CI),
    install: true,
    installTimeoutMs: 600000,
    logDir: path.join(layout.REPO_ROOT, DEFAULT_LOG_DIR),
    help: false,
  };

  for (const arg of argv) {
    if (arg === "-h" || arg === "--help") args.help = true;
    else if (arg.startsWith("--app=")) args.app = arg.slice("--app=".length);
    else if (arg === "--no-root-launcher") args.rootLauncher = false;
    else if (arg.startsWith("--cycles=")) args.cycles = Number(arg.slice("--cycles=".length));
    else if (arg.startsWith("--timeout=")) args.timeoutMs = Number(arg.slice("--timeout=".length));
    else if (arg === "--reset-cache") args.resetCache = true;
    else if (arg === "--no-reset-cache") args.resetCache = false;
    else if (arg === "--skip-install") args.install = false;
    else if (arg.startsWith("--log-dir=")) args.logDir = path.resolve(arg.slice("--log-dir=".length));
    else if (arg.startsWith("--install-timeout="))
      args.installTimeoutMs = Number(arg.slice("--install-timeout=".length));
    else throw new layout.WorkspaceError(`Unexpected argument "${arg}".\n\n${USAGE}`, "BAD_ARGS");
  }

  if (!Number.isFinite(args.cycles) || args.cycles < 1) args.cycles = 1;
  if (!Number.isFinite(args.timeoutMs) || args.timeoutMs < 1000) args.timeoutMs = 180000;
  return args;
}

async function main(argv) {
  const args = parseArgs(argv);
  if (args.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  ensureDir(args.logDir);
  const env = { ...process.env, ...SMOKE_ENV };

  if (args.install) {
    process.stdout.write("▶ npm ci at the repository root\n");
    const installLog = path.join(args.logDir, "npm-ci.log");
    const code = await runInstall({
      rootDir: layout.REPO_ROOT,
      timeoutMs: args.installTimeoutMs,
      logFile: installLog,
      env,
    });
    if (code !== 0) {
      process.stderr.write(`✗ npm ci failed with exit code ${code} — see ${installLog}\n`);
      return 1;
    }
  }

  // The Turborepo launcher starts both apps, so it only belongs to the "all" run.
  const includeRootLauncher = args.rootLauncher && args.app === "all";
  const scenarios = buildScenarios({ app: args.app, includeRootLauncher });
  const outcomes = [];
  for (const scenario of scenarios) {
    outcomes.push(
      await runScenario(scenario, {
        timeoutMs: args.timeoutMs,
        cycles: args.cycles,
        resetCache: args.resetCache,
        logDir: args.logDir,
        env,
      }),
    );
  }

  const summaryPath = path.join(args.logDir, "summary.json");
  fs.writeFileSync(summaryPath, `${JSON.stringify({ outcomes, generatedAt: new Date().toISOString() }, null, 2)}\n`);

  const failed = outcomes.filter((outcome) => !outcome.ok);
  if (failed.length) {
    process.stderr.write(`\n✗ ${failed.length}/${outcomes.length} startup scenario(s) failed.\n`);
    for (const outcome of failed) {
      for (const result of outcome.results.filter((r) => !r.ok)) {
        process.stderr.write(`  [${result.scenario}/${result.phase}] ${result.reason}\n`);
        if (result.crashed) process.stderr.write(`    ${result.crashed}\n`);
        if (result.logFile) process.stderr.write(`    log: ${result.logFile}\n`);
        if (result.snippet) {
          process.stderr.write(`    response snippet: ${result.snippet.replace(/\s+/g, " ").slice(0, 400)}\n`);
        }
        if (result.logTail) {
          process.stderr.write(`    --- server log tail ---\n${result.logTail}\n    ------------------------\n`);
        }
        for (const step of result.recovery || []) process.stderr.write(`    → ${step}\n`);
      }
    }
    process.stderr.write(`\nSummary: ${summaryPath}\n`);
    return 1;
  }

  process.stdout.write(`\n✓ ${outcomes.length} startup scenario(s) served app content. Summary: ${summaryPath}\n`);
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2))
    .then((code) => {
      runCleanups();
      process.exit(code);
    })
    .catch((error) => {
      runCleanups();
      const known = error instanceof layout.WorkspaceError;
      process.stderr.write(`${known ? error.message : `Unexpected failure: ${error.stack}`}\n`);
      process.exit(1);
    });
}

module.exports = {
  APP_PROFILES,
  SMOKE_ENV,
  USAGE,
  parseArgs,
  buildScenarios,
  runScenario,
  waitForHttpResponse,
  waitForPortFree,
  isPortFree,
  startServer,
  runCleanups,
  registerCleanup,
  main,
  tailLog,
};
