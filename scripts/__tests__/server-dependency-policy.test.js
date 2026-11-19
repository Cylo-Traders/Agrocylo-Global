const { test } = require("node:test");
const assert = require("node:assert/strict");
const { checkServerDependencies } = require("../lib/server-dependency-policy");

const server = (version) => ({
  engines: { node: ">=22.13.0 <23", npm: ">=10.9.0 <11" },
  dependencies: { zod: version }, devDependencies: { vitest: "^4.1.1" },
});
test("shared server dependencies allow minor updates but reject major drift", () => {
  assert.deepEqual(checkServerDependencies([server("^4.3.6"), server("~4.4.0")]), []);
  assert.match(checkServerDependencies([server("^4.3.6"), server("^3.23.8")])[0], /zod/);
  const changed = server("^4.3.6");
  changed.devDependencies.vitest = "^2.1.0";
  assert.match(checkServerDependencies([server("^4.3.6"), changed])[0], /vitest/);
});
test("missing and mismatched server engines fail the policy", () => {
  const changed = server("^4.3.6");
  changed.engines.node = ">=20";
  assert.match(checkServerDependencies([server("^4.3.6"), changed])[0], /engines/);
  delete changed.engines;
  assert.equal(checkServerDependencies([server("^4.3.6"), changed]).length, 2);
});
