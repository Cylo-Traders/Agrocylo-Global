"use strict";

/**
 * Shared workspace geometry helpers for the root developer-experience
 * scripts (doctor, cache reset, version policy, dev smoke).
 *
 * Kept dependency-free and CommonJS so it can run before `npm ci` and be
 * required directly by `node --test` fixtures.
 */

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..", "..");

/**
 * The two Next.js workspaces this repository ships. `dir` is resolved from
 * the repo root so the scripts behave the same no matter which directory
 * they are invoked from.
 */
const APPS = [
  {
    key: "client",
    npmName: "client",
    label: "marketplace client (client/)",
    dir: path.join(REPO_ROOT, "client"),
    aliases: ["client", "marketplace", "root-client"],
  },
  {
    key: "agro",
    npmName: "agro-production-client",
    label: "agro-production client (agro-production/client/)",
    dir: path.join(REPO_ROOT, "agro-production", "client"),
    aliases: [
      "agro",
      "agro-client",
      "agro-production",
      "agro-production/client",
      "agro-production-client",
    ],
  },
];

const LOCKFILE_NAMES = ["package-lock.json", "npm-shrinkwrap.json", "yarn.lock", "pnpm-lock.yaml"];

/** Directory Next.js writes its generated output into. */
const CACHE_DIR_NAME = ".next";

class WorkspaceError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "WorkspaceError";
    this.code = code || "WORKSPACE_ERROR";
  }
}

function listApps() {
  return APPS.map((app) => ({ ...app }));
}

/**
 * Resolve an app descriptor from a human selector (`client`, `agro`, …) or
 * from a directory path. Throws a WorkspaceError naming the valid selectors
 * so a typo never silently resolves to the wrong workspace.
 */
function resolveApp(selector) {
  const wanted = String(selector || "").trim().toLowerCase();
  if (!wanted) {
    throw new WorkspaceError(
      `No app selected. Use one of: ${APPS.map((a) => a.key).join(", ")}.`,
      "APP_REQUIRED",
    );
  }

  const wantedPath = path.resolve(wanted);
  for (const app of APPS) {
    if (app.key === wanted || app.npmName === wanted || app.aliases.includes(wanted)) {
      return { ...app };
    }
    if (wantedPath === app.dir) return { ...app };
  }

  throw new WorkspaceError(
    `Unknown app "${selector}". Expected one of: ${APPS.map((a) => a.key).join(", ")} ` +
      `(aliases: ${APPS.flatMap((a) => a.aliases).join(", ")}).`,
    "APP_UNKNOWN",
  );
}

/**
 * True when `child` is `parent` itself or lives underneath it.
 *
 * Uses path.relative() rather than string prefixes so `/repo/client-secret`
 * is never mistaken for being inside `/repo/client`.
 */
function isInside(parent, child) {
  const rel = path.relative(path.resolve(parent), path.resolve(child));
  if (rel === "") return true;
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

function realpathOrNull(target) {
  try {
    return fs.realpathSync(target);
  } catch {
    return null;
  }
}

function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}

/**
 * The workspace root the root lockfile and hoisted node_modules live in.
 * Walks up from `startDir` (or the repo root) to the nearest ancestor that
 * owns a lockfile, falling back to the repo root.
 *
 * This is the same root policy the Next.js configs rely on: dependencies are
 * hoisted to this directory, so it — not the app directory — is the root the
 * bundler has to be given.
 */
function resolveWorkspaceRoot(startDir = REPO_ROOT) {
  const start = path.resolve(startDir || REPO_ROOT);
  let dir = start;
  for (;;) {
    for (const name of LOCKFILE_NAMES) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return REPO_ROOT;
}

/** Path of the lockfile governing `startDir`, or null when there is none. */
function resolveLockfile(startDir = REPO_ROOT) {
  const root = resolveWorkspaceRoot(startDir);
  for (const name of LOCKFILE_NAMES) {
    const candidate = path.join(root, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

/** Read an app manifest, returning null when it is missing/unreadable. */
function readAppManifest(appDir) {
  const manifestPath = path.join(appDir, "package.json");
  try {
    return { path: manifestPath, json: readJson(manifestPath) };
  } catch {
    return null;
  }
}

module.exports = {
  REPO_ROOT,
  APPS,
  CACHE_DIR_NAME,
  LOCKFILE_NAMES,
  WorkspaceError,
  listApps,
  resolveApp,
  isInside,
  realpathOrNull,
  lstatOrNull,
  resolveWorkspaceRoot,
  resolveLockfile,
  readJson,
  readAppManifest,
};
