"use strict";

/**
 * Read-only diagnostics for Next.js dependency resolution (Issue #920).
 *
 * Answers the question the raw Turbopack error does not: is `next` missing
 * entirely, is it a broken symlink, or is it installed *outside* the root the
 * bundler is allowed to compile from?
 *
 * The command never writes: no manifest, lockfile, cache or config is touched,
 * and packages are never installed or removed.
 */

const fs = require("fs");
const path = require("path");

const layout = require("./workspace-layout");

const CONFIG_FILE_NAMES = ["next.config.ts", "next.config.mjs", "next.config.js", "next.config.cjs"];

/** Env var *names* that can change resolution — never their values. */
const RESOLUTION_ENV_VARS = ["NODE_PATH", "npm_config_prefix", "npm_config_user_agent"];

function compareVersions(a, b) {
  const left = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const right = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

/** Base version of a range specifier: "^16.3.5" -> "16.3.5", "16.x" -> "16.0.0". */
function baseVersionOf(range) {
  const match = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(range || ""));
  if (!match) return null;
  return [match[1], match[2] || "0", match[3] || "0"].join(".");
}

/** Minimal satisfies() for the exact/caret/tilde ranges used in this repo. */
function versionSatisfies(installed, range) {
  if (!installed || !range) return false;
  const spec = String(range).trim();
  const base = baseVersionOf(spec);
  if (!base) return false;
  if (/^[~^]/.test(spec)) {
    const cmp = compareVersions(installed, base);
    if (cmp < 0) return false;
    if (spec.startsWith("^")) return installed.split(".")[0] === base.split(".")[0];
    const [majA, minA] = installed.split(".");
    const [majB, minB] = base.split(".");
    return majA === majB && minA === minB;
  }
  return compareVersions(installed, base) === 0;
}

/**
 * Resolve `next/package.json` the way the app itself will resolve it, i.e.
 * from the app directory so a project-local install wins over a hoisted one.
 */
function resolveNextPackage(appDir) {
  const searchPaths = [path.resolve(appDir)];
  const workspaceRoot = layout.resolveWorkspaceRoot(appDir);
  if (workspaceRoot && !searchPaths.includes(workspaceRoot)) searchPaths.push(workspaceRoot);

  // A project-local install (including a symlinked one) always wins, so a
  // dangling link is reported as broken rather than being skipped silently.
  const localCandidate = path.join(path.resolve(appDir), "node_modules", "next", "package.json");
  let resolved = layout.lstatOrNull(localCandidate) ? localCandidate : null;

  if (!resolved) {
    try {
      resolved = require.resolve("next/package.json", { paths: searchPaths });
    } catch {
      resolved = null;
    }
  }

  if (!resolved) {
    return { status: "missing", resolution: null, manifestPath: null };
  }

  let realPath = null;
  try {
    realPath = fs.realpathSync(resolved);
  } catch {
    return { status: "broken-link", resolution: resolved, manifestPath: resolved };
  }

  let version = null;
  try {
    version = layout.readJson(realPath).version || null;
  } catch {
    version = null;
  }

  const appLocalRoot = path.join(path.resolve(appDir), "node_modules");
  const resolution = layout.isInside(appLocalRoot, realPath) ? "project-local" : "hoisted";

  return { status: "resolved", resolution, manifestPath: realPath, version };
}

/**
 * Evaluate a `turbopack.root` expression the way Next.js would, i.e. with
 * `__dirname` set to the app directory and `process.cwd()` returning it (the
 * dev script runs inside the app). Only pure path arithmetic is available in
 * the sandbox — imports other than node builtins are refused, and the config
 * file itself is never loaded by the doctor.
 */
function evaluateRootExpression({ appDir, configPath, source, expression }) {
  let vm;
  try {
    vm = require("vm");
  } catch {
    return null;
  }

  const sandbox = {
    path,
    fs,
    os: require("os"),
    URL,
    __dirname: appDir,
    __filename: configPath,
    console: { log() {}, warn() {}, error() {} },
    process: { cwd: () => appDir, env: {}, platform: process.platform },
    require: (id) => {
      if (/^(node:)?(path|fs|os|url)$/.test(String(id))) return require(id);
      throw new Error(`"${id}" is not available while diagnosing the bundler root`);
    },
  };

  try {
    vm.createContext(sandbox);
    const declaration =
      /(?:^|\n)[ \t]*(?:const|let|var)[ \t]+([A-Za-z_$][\w$]*)[ \t]*(?::[^=\n]+)?=[ \t]*([^;\n]+);?/g;
    let match;
    while ((match = declaration.exec(source)) !== null) {
      try {
        vm.runInContext(`${match[1]} = ${match[2]}`, sandbox, { timeout: 100 });
      } catch {
        /* declarations that need imports are skipped */
      }
    }
    const value = vm.runInContext(expression, sandbox, { timeout: 200 });
    if (typeof value === "string" && value.trim()) return path.resolve(value.trim());
  } catch {
    return null;
  }
  return null;
}

/**
 * Read the `turbopack.root` value from an app's Next config, if it sets one.
 * Prefers an evaluated value, falls back to a static literal, and reports an
 * unknown value rather than guessing.
 */
function readConfiguredRoot(appDir) {
  for (const name of CONFIG_FILE_NAMES) {
    const file = path.join(appDir, name);
    let source;
    try {
      source = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }

    const blockMatch = /turbopack\s*[:=]\s*\{([\s\S]*?)\}/.exec(source);
    if (!blockMatch) continue;
    const rootMatch =
      /\broot\s*:\s*([^,\n}]+)/.exec(blockMatch[1]) ||
      /(?:^|[\s{,])root\s*(?:,|$)/.exec(blockMatch[1]);
    if (!rootMatch) continue;

    const expression = (rootMatch[1] || "root").trim().replace(/,?\s*$/, "");

    const evaluated = evaluateRootExpression({ appDir, configPath: file, source, expression });
    if (evaluated) return { file, expression, value: evaluated, evaluation: "evaluated" };

    const literalMatch = /^(['"])(.*?)\1$/.exec(expression);
    if (literalMatch) {
      return {
        file,
        expression,
        value: path.resolve(appDir, literalMatch[2]),
        evaluation: "literal",
      };
    }

    return { file, expression, value: null, evaluation: "unknown" };
  }
  return null;
}

/**
 * Full read-only diagnosis for one app.
 *
 * @param {string} appDir
 * @returns {{appDir: string, ok: boolean, checks: Array<{label: string, value: string, status: string}>, failures: Array<{code: string, message: string, recovery: string[]}>, warnings: Array<{code: string, message: string}>, recovery: string[]}}
 */
function diagnoseApp(appDir) {
  const appRoot = path.resolve(appDir);
  const manifest = layout.readAppManifest(appRoot);
  const workspaceRoot = layout.resolveWorkspaceRoot(appRoot);
  const lockfile = layout.resolveLockfile(appRoot);
  const configuredRoot = readConfiguredRoot(appRoot);
  const bundlerRoot = configuredRoot && configuredRoot.value ? configuredRoot.value : workspaceRoot;

  const checks = [];
  const failures = [];
  const warnings = [];
  let recovery = [];

  checks.push({ label: "App directory", value: appRoot, status: "info" });
  checks.push({ label: "Workspace root", value: workspaceRoot, status: "info" });
  checks.push({
    label: "Lockfile",
    value: lockfile || "none found",
    status: lockfile ? "ok" : "warn",
  });
  checks.push({
    label: "Effective bundler root",
    value: bundlerRoot + (configuredRoot ? ` (from ${path.basename(configuredRoot.file)})` : " (workspace policy)"),
    status: "info",
  });

  if (configuredRoot && !configuredRoot.value) {
    warnings.push({
      code: "ROOT_NOT_STATICALLY_VERIFIABLE",
      message:
        `${path.basename(configuredRoot.file)} sets turbopack.root to a runtime-computed value ` +
        `("${configuredRoot.expression}"). Make sure it resolves to the workspace root ` +
        `(${workspaceRoot}) — a cwd-based root breaks when the app is started through ` +
        "Turborepo or from another directory.",
    });
  }

  if (!manifest) {
    failures.push({
      code: "APP_MANIFEST_MISSING",
      message: `No readable package.json in "${appRoot}".`,
      recovery: ["Check that you are running this from the repository checkout."],
    });
    return { appDir: appRoot, ok: false, checks, failures, warnings, recovery };
  }

  const declared =
    (manifest.json.dependencies || {}).next || (manifest.json.devDependencies || {}).next || null;

  checks.push({
    label: "Declared next",
    value: declared || "not declared",
    status: declared ? "ok" : "fail",
  });

  if (!declared) {
    failures.push({
      code: "NEXT_NOT_DECLARED",
      message: `"${manifest.json.name || appRoot}" does not declare "next" as a dependency.`,
      recovery: [
        `Add "next" to dependencies in ${manifest.path}.`,
        `Then run "npm install" at the repository root (${workspaceRoot}).`,
      ],
    });
  }

  const resolved = resolveNextPackage(appRoot);
  if (resolved.status === "missing") {
    checks.push({ label: "Resolved next", value: "not resolvable", status: "fail" });
    failures.push({
      code: "NEXT_NOT_INSTALLED",
      message: `Could not resolve "next/package.json" from "${appRoot}". The package is missing.`,
      recovery: [
        `Install dependencies once at the repository root: cd ${workspaceRoot} && npm ci`,
        lockfile ? `Lockfile in use: ${lockfile}` : "No lockfile was found — commit an install first.",
        `Environment variables that can affect resolution: ${RESOLUTION_ENV_VARS.join(", ")}.`,
      ],
    });
  } else if (resolved.status === "broken-link") {
    checks.push({
      label: "Resolved next",
      value: `${resolved.manifestPath} (broken link)`,
      status: "fail",
    });
    failures.push({
      code: "NEXT_BROKEN_LINK",
      message: `"next" resolves to "${resolved.manifestPath}" but that path is a broken link.`,
      recovery: [
        `Reinstall at the repository root: cd ${workspaceRoot} && rm -rf node_modules/next && npm ci`,
      ],
    });
  } else {
    checks.push({
      label: "Resolved next",
      value: `${resolved.manifestPath} (v${resolved.version || "unknown"}, ${resolved.resolution})`,
      status: "ok",
    });

    if (declared && resolved.version && !versionSatisfies(resolved.version, declared)) {
      warnings.push({
        code: "VERSION_MISMATCH",
        message: `Installed next v${resolved.version} does not satisfy the declared range "${declared}".`,
      });
    }

    const insideRoot = layout.isInside(bundlerRoot, path.dirname(resolved.manifestPath));
    checks.push({
      label: "Inside bundler root",
      value: insideRoot ? "yes" : "no",
      status: insideRoot ? "ok" : "fail",
    });

    if (!insideRoot) {
      const isConfigured = Boolean(configuredRoot && configuredRoot.value);
      failures.push({
        code: isConfigured ? "ROOT_MISCONFIGURED" : "NEXT_OUTSIDE_ROOT",
        message:
          `Installed "next" (${path.dirname(resolved.manifestPath)}) lives outside the ` +
          `effective bundler root (${bundlerRoot}). Files outside that root are not compiled, ` +
          "which reproduces the reported \"couldn't find the Next.js package\" / " +
          "build-manifest ENOENT startup failure.",
        recovery: isConfigured
          ? [
              `Set turbopack.root to the workspace root (${workspaceRoot}) in ${configuredRoot.file} ` +
                "instead of the app directory — dependencies are hoisted to the workspace root.",
              `Then reset the app cache: node scripts/reset-next-cache.js --app=<client|agro>`,
            ]
          : [
              `Reinstall at the repository root so next is hoisted inside ${workspaceRoot}: cd ${workspaceRoot} && npm ci`,
              `Then reset the app cache: node scripts/reset-next-cache.js --app=<client|agro>`,
            ],
      });
    } else if (configuredRoot && configuredRoot.value && path.resolve(configuredRoot.value) !== workspaceRoot) {
      warnings.push({
        code: "ROOT_NOT_WORKSPACE_ROOT",
        message:
          `${path.basename(configuredRoot.file)} sets turbopack.root to "${configuredRoot.value}", ` +
          `which is not the workspace root (${workspaceRoot}). Prefer the workspace root so hoisted ` +
          "dependencies stay inside the root.",
      });
    }
  }

  recovery = failures.flatMap((failure) => failure.recovery);

  return { appDir: appRoot, ok: failures.length === 0, checks, failures, warnings, recovery };
}

module.exports = {
  CONFIG_FILE_NAMES,
  RESOLUTION_ENV_VARS,
  compareVersions,
  baseVersionOf,
  versionSatisfies,
  resolveNextPackage,
  readConfiguredRoot,
  diagnoseApp,
};
