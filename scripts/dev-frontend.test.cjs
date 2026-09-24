const assert = require("node:assert/strict");
const net = require("node:net");
const test = require("node:test");

const { assertPortAvailable, readPort } = require("./dev-frontend.cjs");

test("uses deterministic defaults and supports named environment overrides", () => {
  assert.equal(readPort([], {}, "marketplace", 3000).port, 3000);
  assert.equal(
    readPort([], { MARKETPLACE_PORT: "3100" }, "marketplace", 3000).port,
    3100,
  );
});

test("CLI port overrides environment values without forwarding duplicate flags", () => {
  const result = readPort(
    ["--hostname", "127.0.0.1", "--port", "3200"],
    { MARKETPLACE_PORT: "3100", PORT: "3300" },
    "marketplace",
    3000,
  );

  assert.equal(result.port, 3200);
  assert.deepEqual(result.forwardedArgs, ["--hostname", "127.0.0.1"]);
});

test("rejects invalid ports", () => {
  assert.throws(
    () => readPort(["--port=not-a-port"], {}, "marketplace", 3000),
    /Invalid port/,
  );
});

test("detects an occupied configured port", async () => {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, resolve));
  const address = server.address();

  try {
    await assert.rejects(
      assertPortAvailable(address.port),
      (error) => error.code === "EADDRINUSE",
    );
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
