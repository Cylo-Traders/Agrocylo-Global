const fs = require("node:fs");
const path = require("node:path");

function checkServerDependencies(servers) {
  const failures = [];
  const [marketplace, production] = servers;
  const dependencies = (pkg) => ({ ...pkg.dependencies, ...pkg.devDependencies });
  const left = dependencies(marketplace);
  const right = dependencies(production);
  for (const name of Object.keys(left).filter((name) => name in right)) {
    const major = (spec) => /^\D*(\d+)/.exec(spec)?.[1];
    if (!major(left[name]) || major(left[name]) !== major(right[name])) {
      failures.push(`Shared server dependency ${name} must use one major (${left[name]} vs ${right[name]}).`);
    }
  }
  for (const name of ["node", "npm"]) {
    if (!marketplace.engines?.[name] || marketplace.engines[name] !== production.engines?.[name]) {
      failures.push(`Both servers must declare identical ${name} engines.`);
    }
  }
  return failures;
}

function checkRepository(root) {
  const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), "utf8"));
  const failures = checkServerDependencies([
    read("server/package.json"), read("agro-production/server/package.json"),
  ]);
  const expectedNode = fs.readFileSync(path.join(root, ".nvmrc"), "utf8").trim();
  for (const server of ["server", "agro-production/server"]) {
    if (fs.readFileSync(path.join(root, server, ".nvmrc"), "utf8").trim() !== expectedNode) {
      failures.push(`${server}/.nvmrc must match the root Node version.`);
    }
  }
  for (const app of ["client", "agro-production/client"]) {
    for (const [file, entry] of [["instrumentation.ts", "server"], ["instrumentation-client.ts", "client"]]) {
      const source = fs.readFileSync(path.join(root, app, "src", file), "utf8").trim();
      const exports = entry === "server" ? "register, onRequestError" : "onRouterTransitionStart";
      if (source !== `export { ${exports} } from "@agrocylo/instrumentation/${entry}";`) {
        failures.push(`${app}/src/${file} must delegate to the shared instrumentation package; do not regenerate duplicate implementations.`);
      }
    }
  }
  return failures;
}

module.exports = { checkServerDependencies, checkRepository };
