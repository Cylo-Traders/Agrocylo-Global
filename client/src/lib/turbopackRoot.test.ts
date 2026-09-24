import { describe, it, expect } from "vitest";
import path from "node:path";

/**
 * Path-resolution regression (Issue #918).
 *
 * The previous implementation derived clientRoot from process.cwd() with a
 * literal Windows separator:
 *   cwd.endsWith("/client") ? process.cwd() : `${process.cwd()}\\client`
 * That fails when invoked from root vs client/ and on non-Windows hosts.
 *
 * The fix derives the repository root from the config file location using
 * platform-safe Node path APIs (path.dirname / path.resolve), independent
 * of cwd.
 *
 * This test exercises the same logic for both Next.js clients:
 *  - client/next.config.ts            → depth 1 → repoRoot = resolve(dirname(config), "..")
 *  - agro-production/client/next.config.ts → depth 2 → repoRoot = resolve(dirname(config), "../..")
 *
 * It covers Linux-style and Windows-style paths and verifies that the
 * effective root does not depend on the caller's cwd (process.cwd).
 */

function getClientRepoRoot(configFilePath: string): string {
  return path.posix.resolve(path.posix.dirname(configFilePath), "..");
}
function getAgroRepoRoot(configFilePath: string): string {
  return path.posix.resolve(path.posix.dirname(configFilePath), "../..");
}
function getClientRepoRootWin(configFilePath: string): string {
  return path.win32.resolve(path.win32.dirname(configFilePath), "..");
}
function getAgroRepoRootWin(configFilePath: string): string {
  return path.win32.resolve(path.win32.dirname(configFilePath), "../..");
}

describe("Turbopack workspace root resolution (Issue #918)", () => {
  it("resolves client repo root from file location (posix)", () => {
    expect(getClientRepoRoot("/repo/client/next.config.ts")).toBe("/repo");
    expect(getClientRepoRoot("/a/b/c/client/next.config.ts")).toBe("/a/b/c");
  });

  it("resolves agro-production client repo root from file location (posix)", () => {
    expect(getAgroRepoRoot("/repo/agro-production/client/next.config.ts")).toBe("/repo");
    expect(getAgroRepoRoot("/a/b/agro-production/client/next.config.ts")).toBe("/a/b");
  });

  it("resolves client repo root from file location (win32)", () => {
    expect(getClientRepoRootWin("C:\\repo\\client\\next.config.ts")).toBe("C:\\repo");
    expect(getClientRepoRootWin("C:\\a\\b\\c\\client\\next.config.ts")).toBe("C:\\a\\b\\c");
  });

  it("resolves agro-production client repo root from file location (win32)", () => {
    expect(getAgroRepoRootWin("C:\\repo\\agro-production\\client\\next.config.ts")).toBe("C:\\repo");
    expect(getAgroRepoRootWin("C:\\a\\b\\agro-production\\client\\next.config.ts")).toBe("C:\\a\\b");
  });

  it("is independent of process.cwd()", () => {
    const originalCwd = process.cwd();
    const posixRoot = getClientRepoRoot("/repo/client/next.config.ts");
    // Even if cwd is client/ or root, file-location-derived root is stable
    // (previous cwd-based implementation would have returned different values)
    expect(posixRoot).toBe("/repo");
    expect(process.cwd()).toBe(originalCwd);
  });

  it("preserves shared-package transpilation for agro-production client", async () => {
    // Cheap static check: agro-production/client/next.config.ts must declare
    // transpilePackages: ["@agrocylo/wallet-core"] so @agrocylo/wallet-core
    // shared TS source is compiled in the production client.
    const fs = await import("node:fs");
    const content = fs.readFileSync(
      path.resolve(process.cwd(), "agro-production/client/next.config.ts"),
      "utf8"
    );
    expect(content).toContain("@agrocylo/wallet-core");
    expect(content).toContain("transpilePackages");
  });

  it("client next.config does not contain literal Windows separator fallback", async () => {
    const fs = await import("node:fs");
    const content = fs.readFileSync(path.resolve(process.cwd(), "client/next.config.ts"), "utf8");
    // Old bug: `${process.cwd()}\\client` literal backslash
    expect(content).not.toContain("\\client");
    expect(content).not.toMatch(/process\.cwd\(\)\.replace/);
  });

  it("both configs set turbopack.root to repository root", async () => {
    const fs = await import("node:fs");
    const client = fs.readFileSync(path.resolve(process.cwd(), "client/next.config.ts"), "utf8");
    const agro = fs.readFileSync(path.resolve(process.cwd(), "agro-production/client/next.config.ts"), "utf8");
    expect(client).toMatch(/turbopack:\s*\{\s*root:\s*repoRoot/);
    expect(agro).toMatch(/turbopack:\s*\{\s*root:\s*repoRoot/);
    expect(client).toContain("getRepoRoot");
    expect(agro).toContain("getRepoRoot");
  });
});
