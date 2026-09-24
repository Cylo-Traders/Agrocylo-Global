const assert = require("node:assert/strict");
const test = require("node:test");

const {
  isSupportedNode,
  isSupportedNpm,
  validateToolchain,
} = require("./check-toolchain.cjs");

test("accepts the pinned Node.js and npm releases", () => {
  assert.equal(isSupportedNode("22.13.0"), true);
  assert.equal(isSupportedNpm("10.9.2"), true);
  assert.deepEqual(validateToolchain("22.13.0", "10.9.2"), []);
});

test("rejects unsupported major and too-old minor versions actionably", () => {
  assert.equal(isSupportedNode("20.19.0"), false);
  assert.equal(isSupportedNode("22.12.0"), false);
  assert.equal(isSupportedNpm("11.0.0"), false);

  const errors = validateToolchain("20.19.0", "11.0.0");
  assert.match(errors[0], />=22\.13\.0 <23/);
  assert.match(errors[0], /nvm use/);
  assert.match(errors[1], />=10\.9\.0 <11/);
});
