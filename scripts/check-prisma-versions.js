#!/usr/bin/env node
// Validate each backend's independently installed Prisma toolchain.
const fs = require("node:fs");
const path = require("node:path");
let failed = false;
for (const directory of ["server", "agro-production/server"]) {
  const root = path.join(__dirname, "..", directory);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const major = (version) => /^\D*(\d+)/.exec(version || "")?.[1];
  const names = ["prisma", "@prisma/client", "@prisma/adapter-pg"];
  const versions = names.flatMap((name) => [deps[name], lock.packages?.[`node_modules/${name}`]?.version]);
  if (versions.some((version) => !major(version)) || new Set(versions.map(major)).size !== 1) {
    console.error(`${directory}: Prisma CLI, client and adapter declared/locked versions must share one major. Regenerate this server's lockfile after upgrading all three.`);
    failed = true;
  } else {
    console.log(`${directory}: Prisma toolchain aligned at major ${major(versions[0])}.`);
  }
}
if (failed) process.exitCode = 1;
