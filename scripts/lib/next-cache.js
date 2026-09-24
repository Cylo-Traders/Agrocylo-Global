"use strict";

/**
 * Reset only the selected app's generated Next.js output (`.next`).
 *
 * Design rules (Issue #921):
 *  - The target is resolved from the known workspace paths, never from
 *    arbitrary user input, and must sit directly inside the selected app.
 *  - A `.next` symlink is refused, so a malicious/accidental link can never
 *    redirect the deletion to a directory outside the app.
 *  - Idempotent: an already-absent cache is a success, not an error.
 *  - Nothing else is touched — no lockfiles, no node_modules, no .env files,
 *    no source files, no other app's cache.
 */

const fs = require("fs");
const path = require("path");

const layout = require("./workspace-layout");

class CacheResetError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "CacheResetError";
    this.code = code || "CACHE_RESET_ERROR";
  }
}

/** Absolute path of the generated output directory for an app. */
function resolveCacheDir(appDir, cacheDirName = layout.CACHE_DIR_NAME) {
  return path.join(path.resolve(appDir), cacheDirName || layout.CACHE_DIR_NAME);
}

/**
 * Inspect (but never modify) the cache directory.
 *
 * @returns {{appRoot: string, cachePath: string, state: "absent"|"directory"|"symlink"|"file", realPath: string|null}}
 */
function inspectCacheDir(appDir, options = {}) {
  const appRoot = path.resolve(appDir);
  const cachePath = resolveCacheDir(appRoot, options.cacheDirName);

  if (path.dirname(cachePath) !== appRoot || !layout.isInside(appRoot, cachePath)) {
    throw new CacheResetError(
      `Refusing to reset "${cachePath}": it is not inside the app directory "${appRoot}".`,
      "CACHE_TARGET_OUTSIDE_APP",
    );
  }

  const stat = layout.lstatOrNull(cachePath);
  let state = "absent";
  if (stat) {
    if (stat.isSymbolicLink()) state = "symlink";
    else if (stat.isDirectory()) state = "directory";
    else state = "file";
  }

  const realPath = state === "absent" ? null : layout.realpathOrNull(cachePath);

  // A symlink is reported as such and never validated through its target:
  // its whole point (to the harness) is that it must not be followed.
  if (state === "symlink") {
    return { appRoot, cachePath, state, realPath: realPath || null };
  }

  if (realPath && !layout.isInside(appRoot, realPath)) {
    throw new CacheResetError(
      `Refusing to reset "${cachePath}": it resolves outside the app directory ` +
        `("${realPath}" is not inside "${appRoot}").`,
      "CACHE_TARGET_OUTSIDE_APP",
    );
  }

  return { appRoot, cachePath, state, realPath: realPath || null };
}

/**
 * Remove the app's generated output directory.
 *
 * @param {string} appDir absolute path of the app (any directory in tests)
 * @param {{cacheDirName?: string, dryRun?: boolean, logger?: (msg: string) => void}} [options]
 * @returns {{removed: boolean, alreadyAbsent: boolean, dryRun: boolean, path: string, state: string}}
 */
function resetAppCache(appDir, options = {}) {
  const logger = typeof options.logger === "function" ? options.logger : () => {};
  const info = inspectCacheDir(appDir, { cacheDirName: options.cacheDirName });

  if (info.state === "symlink") {
    throw new CacheResetError(
      `Refusing to reset "${info.cachePath}": it is a symlink` +
        (info.realPath ? ` to "${info.realPath}"` : "") +
        ". Symlinked caches are never followed or deleted — remove the link manually " +
        "if you really meant to delete that directory.",
      "CACHE_IS_SYMLINK",
    );
  }

  if (info.state === "file") {
    throw new CacheResetError(
      `Refusing to reset "${info.cachePath}": expected a directory or nothing, found a file.`,
      "CACHE_NOT_A_DIRECTORY",
    );
  }

  if (info.state === "absent") {
    logger(`Nothing to remove: ${info.cachePath} does not exist (already clean).`);
    return {
      removed: false,
      alreadyAbsent: true,
      dryRun: false,
      path: info.cachePath,
      state: info.state,
    };
  }

  if (options.dryRun) {
    logger(`[dry-run] would remove ${info.cachePath}`);
    return {
      removed: false,
      alreadyAbsent: false,
      dryRun: true,
      path: info.cachePath,
      state: info.state,
    };
  }

  // maxRetries gives a running dev server a moment to release file locks
  // instead of racing it and failing with EBUSY/ENOTEMPTY.
  try {
    fs.rmSync(info.cachePath, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch (error) {
    const code = error && error.code;
    const transient = ["EBUSY", "EPERM", "ENOTEMPTY", "EISDIR"].includes(code);
    throw new CacheResetError(
      `Could not remove "${info.cachePath}" (${code || error.message}). ` +
        (transient
          ? "A dev server is probably still holding files open. Stop the app's dev process " +
            "(Ctrl+C on `npm run dev`) and run this command again."
          : "Stop any process using that directory and run this command again."),
      "CACHE_REMOVE_FAILED",
    );
  }

  logger(`Removed generated output: ${info.cachePath}`);
  return {
    removed: true,
    alreadyAbsent: false,
    dryRun: false,
    path: info.cachePath,
    state: info.state,
  };
}

module.exports = {
  CacheResetError,
  resolveCacheDir,
  inspectCacheDir,
  resetAppCache,
};
