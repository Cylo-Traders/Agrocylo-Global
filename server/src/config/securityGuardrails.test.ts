import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function productionSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) return productionSourceFiles(fullPath);
      if (!entry.name.endsWith(".ts")) return [];
      if (entry.name.endsWith(".test.ts")) return [];
      return [fullPath];
    }),
  );
  return files.flat();
}

describe("security guardrails", () => {
  it("does not use console logging in production source", async () => {
    const files = await productionSourceFiles(srcRoot);
    const offenders: string[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (/console\.(log|error|warn|info|debug)\s*\(/.test(source)) {
        offenders.push(path.relative(srcRoot, file));
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps service and controller database access on Prisma ORM APIs", async () => {
    const roots = [path.join(srcRoot, "services"), path.join(srcRoot, "controllers")];
    const files = (await Promise.all(roots.map(productionSourceFiles))).flat();
    const rawSqlPatterns = [/\$queryRaw/, /\$executeRaw/, /\bdb\.query\s*\(/, /\bclient\.query\s*\(/, /\bquery\s*\(/];
    const offenders: string[] = [];

    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (rawSqlPatterns.some((pattern) => pattern.test(source))) {
        offenders.push(path.relative(srcRoot, file));
      }
    }

    expect(offenders).toEqual([]);
  });
});
